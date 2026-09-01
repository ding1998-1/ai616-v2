"""会议辅助域服务。

该模块承接旧单体入口中仍被前端使用的会议辅助能力：Whisper 终审读取、
转写校订、发言人改派、实时待办、系统设置和旧文档下载兼容。

纪要生成与正式 DOCX 生成不在这里实现，分别复用
``outcome_service`` 和 ``meeting_document_service``，避免出现两套业务规则。
服务层不依赖 FastAPI Request/Response/HTTPException；HTTP 错误由路由层转换。
"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any, Mapping

from backend.config import APP_DB_LOCK, MEETING_FILES_DIR, MEETING_TRANSCRIPTS_LOCK
from backend.db import (
    _check_meeting_access,
    _db_connect,
    _db_load_transcripts_for_meeting,
    _init_app_db,
    _invalidate_transcripts_cache,
    _json_dumps,
    _load_meeting_transcripts,
    _load_meetings,
    _metadata_get,
    _metadata_set,
    _safe_meeting_id,
    _save_meeting_transcripts,
)
from backend.deps import _append_meeting_activity_light, _resolve_meeting_role, _now_text


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_WHITESPACE_RE = re.compile(r"\s+")


def _clean_text(value: Any) -> str:
    return _WHITESPACE_RE.sub(" ", str(value or "")).strip()


def _meeting_for_user(meeting_id: str, user: dict) -> tuple[str, dict]:
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    _check_meeting_access(user, meeting)
    return safe_id, meeting


def _event_is_whisper_review(event: Mapping[str, Any]) -> bool:
    return event.get("type") == "transcript" and event.get("action") == "whisper-review"


def list_whisper_reviews(meeting_id: str, user: dict) -> dict:
    """读取会议的 Whisper 终审事件，保持旧接口字段兼容。"""

    safe_id, meeting = _meeting_for_user(meeting_id, user)
    loaded = _db_load_transcripts_for_meeting(safe_id)
    results = []
    for event in loaded.get("events", []):
        if not _event_is_whisper_review(event):
            continue
        results.append(
            {
                "id": event.get("id", ""),
                "text": event.get("text", ""),
                "model": event.get("model", "Whisper-large-v3"),
                "serverTime": event.get("serverTime", ""),
                "sourceFiles": event.get("sourceFiles", 0),
                "segmentCount": len(event.get("segments") or []),
                "status": event.get("status", "done"),
            }
        )
    generated = meeting.get("generatedRecords") if isinstance(meeting.get("generatedRecords"), dict) else {}
    return {
        "meetingId": safe_id,
        "whisperReview": results,
        "whisperDocx": dict(generated.get("whisperDocx") or meeting.get("whisperDocx") or {}),
    }


def _document_artifact(records: Mapping[str, Any], kind: str) -> dict:
    documents = records.get("documents") if isinstance(records.get("documents"), Mapping) else {}
    value = documents.get(kind)
    return dict(value) if isinstance(value, Mapping) else {}


def get_document_status(meeting_id: str, user: dict) -> dict:
    """返回 v2 正式件/证据底稿与旧 Whisper 文档状态。"""

    safe_id, meeting = _meeting_for_user(meeting_id, user)
    records = meeting.get("generatedRecords") if isinstance(meeting.get("generatedRecords"), dict) else {}
    documents = records.get("documents") if isinstance(records.get("documents"), Mapping) else {}
    whisper_docx = dict(records.get("whisperDocx") or meeting.get("whisperDocx") or {})
    return {
        "meetingId": safe_id,
        "pipeline": records.get("pipeline") or "",
        "generated": bool(records.get("generated")),
        "proofreadPassed": bool(records.get("proofreadPassed")),
        "whisperDocx": whisper_docx,
        "documents": {
            "formal": _document_artifact(records, "formal"),
            "evidence": _document_artifact(records, "evidence"),
        },
        "status": "ready" if documents.get("formal") or whisper_docx.get("status") == "done" else "pending",
    }


def _safe_artifact_path(artifact: Mapping[str, Any]) -> Path | None:
    raw = str(artifact.get("path") or "").strip()
    if not raw:
        return None
    path = Path(raw)
    try:
        path.resolve().relative_to(MEETING_FILES_DIR.resolve())
    except (OSError, ValueError):
        return None
    return path if path.is_file() else None


def resolve_legacy_document(meeting_id: str, user: dict, kind: str) -> tuple[Path, str]:
    """解析旧下载入口到现有 v2 文档产物，不重新生成文件。"""

    _, meeting = _meeting_for_user(meeting_id, user)
    records = meeting.get("generatedRecords") if isinstance(meeting.get("generatedRecords"), dict) else {}
    if kind == "whisper":
        whisper_docx = records.get("whisperDocx") or meeting.get("whisperDocx") or {}
        path = _safe_artifact_path(whisper_docx)
        if path:
            return path, str(whisper_docx.get("fileName") or path.name)
        # v2 将完整原文放到 evidence 证据底稿；在旧文件不存在时保持下载入口可用。
        artifact = _document_artifact(records, "evidence")
    else:
        artifact = _document_artifact(records, "formal")
    path = _safe_artifact_path(artifact)
    if path:
        return path, str(artifact.get("filename") or path.name)
    raise FileNotFoundError("文档尚未生成")


def _transcript_from_loaded(data: dict, safe_id: str, transcript_id: str) -> tuple[dict, dict]:
    meeting = data.get(safe_id)
    if not meeting:
        raise KeyError("会议转写不存在")
    target = next((row for row in meeting.get("transcripts", []) if row.get("id") == transcript_id), None)
    if not target:
        raise KeyError("转写记录不存在")
    return meeting, target


def correct_transcript(
    meeting_id: str,
    transcript_id: str,
    corrected_transcript: str,
    signature_data: str,
    client_time: str | None,
    user: dict,
) -> dict:
    """校订并签署一条转写，保留原文以便证据追溯。"""

    safe_id, _ = _meeting_for_user(meeting_id, user)
    corrected = _clean_text(corrected_transcript)
    signature = str(signature_data or "").strip()
    if not corrected:
        raise ValueError("修正后的发言不能为空")
    if not signature.startswith("data:image/"):
        raise ValueError("请先完成手机手写签名")

    now = _now_text()
    role = _resolve_meeting_role(user)
    with MEETING_TRANSCRIPTS_LOCK:
        data = _load_meeting_transcripts()
        loaded_meeting, target = _transcript_from_loaded(data, safe_id, transcript_id)
        owner_username = str(target.get("username") or "").lower()
        current_username = str(user.get("username") or "").lower()
        if user.get("role") != "admin" and owner_username and owner_username != current_username:
            raise PermissionError("只能修正并签署本人发言")

        original = target.get("originalTranscript") or target.get("transcript") or ""
        target.update(
            {
                "originalTranscript": original,
                "transcript": corrected,
                "correctedTranscript": corrected,
                "correctionSigned": True,
                "correctionSignedAt": now,
                "correctionClientTime": client_time or "",
                "correctionAuthor": role["displayName"],
                "correctionUsername": role["username"],
                "signatureData": signature[:800000],
            }
        )
        event = {
            "id": f"correction_{uuid.uuid4().hex[:10]}",
            "type": "transcript-correction",
            "meetingId": safe_id,
            "transcriptId": transcript_id,
            "speakerName": target.get("speakerName"),
            "originalTranscript": original,
            "correctedTranscript": corrected,
            "signedAt": now,
            "signer": {
                "displayName": role["displayName"],
                "username": role["username"],
                "meetingRole": role["meetingRole"],
                "seat": role["seat"],
            },
            "serverTime": now,
        }
        loaded_meeting.setdefault("events", []).append(event)
        loaded_meeting["updatedAt"] = now
        _save_meeting_transcripts(data)
    _append_meeting_activity_light(safe_id, event)
    # A signed human correction is authoritative. Persist its project-scoped
    # terminology only after the transcript write succeeds.
    try:
        from backend.services.asr_hotword_learning_service import learn_signed_correction

        learn_signed_correction(safe_id, str(original), corrected)
    except Exception:
        # Transcript correction must not be rolled back by an auxiliary learner.
        # The audit event remains available for a later idempotent re-learn.
        pass
    return {"record": target, "event": event}


def update_transcript_speaker(
    meeting_id: str,
    transcript_id: str,
    speaker_name: str,
    speaker_role: str,
    speaker_dept: str,
    user: dict,
) -> dict:
    """人工改派转写发言人，并写入审计事件。"""

    safe_id, _ = _meeting_for_user(meeting_id, user)
    name = _clean_text(speaker_name)
    role_name = _clean_text(speaker_role)
    dept = _clean_text(speaker_dept)
    if not name:
        raise ValueError("发言人姓名不能为空")

    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT id, speaker_name, speaker_role, speaker_dept, payload_json FROM meeting_transcripts WHERE id = ? AND meeting_id = ?",
                (transcript_id, safe_id),
            ).fetchone()
            if not row:
                raise KeyError("转写记录不存在")
            old = {"name": row["speaker_name"], "role": row["speaker_role"], "dept": row["speaker_dept"]}
            payload = {}
            try:
                payload = json.loads(row["payload_json"] or "{}")
            except (TypeError, ValueError):
                payload = {}
            payload.update({"speakerName": name, "speakerRole": role_name, "speakerDept": dept, "speakerCorrected": True})
            conn.execute(
                "UPDATE meeting_transcripts SET speaker_name = ?, speaker_role = ?, speaker_dept = ?, payload_json = ? WHERE id = ? AND meeting_id = ?",
                (name, role_name, dept, _json_dumps(payload), transcript_id, safe_id),
            )

    _invalidate_transcripts_cache()
    now = _now_text()
    actor = _resolve_meeting_role(user)
    event = {
        "id": f"speaker_correction_{uuid.uuid4().hex[:10]}",
        "type": "speaker-correction",
        "meetingId": safe_id,
        "transcriptId": transcript_id,
        "oldSpeaker": old,
        "newSpeaker": {"name": name, "role": role_name, "dept": dept},
        "correctedBy": actor["displayName"],
        "serverTime": now,
    }
    _append_meeting_activity_light(safe_id, event)
    return {
        "transcriptId": transcript_id,
        "speakerName": name,
        "speakerRole": role_name,
        "speakerDept": dept,
        "event": event,
    }


def get_settings(user: dict) -> dict:
    """读取系统级会议设置。"""

    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            return {"orgName": _metadata_get(conn, "org_name") or ""}


def update_settings(body: Mapping[str, Any], user: dict) -> dict:
    """更新系统设置；仅管理员可修改。"""

    if user.get("role") != "admin":
        raise PermissionError("仅管理员可修改系统设置")
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            if "orgName" in body:
                _metadata_set(conn, "org_name", _clean_text(body.get("orgName")))
            return {"orgName": _metadata_get(conn, "org_name") or ""}


def _extract_json_object(text: str) -> dict | None:
    content = str(text or "").strip()
    if not content:
        return None
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.IGNORECASE | re.DOTALL).strip()
    try:
        value = json.loads(content)
        return value if isinstance(value, dict) else None
    except (TypeError, ValueError):
        pass
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(content[start : end + 1])
        return value if isinstance(value, dict) else None
    except (TypeError, ValueError):
        return None


def _normalise_realtime_todos(payload: Any) -> list[dict]:
    raw = payload.get("todos") if isinstance(payload, Mapping) else []
    if not isinstance(raw, list):
        return []
    rows = []
    seen = set()
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        task = _clean_text(item.get("task"))[:200]
        if not task or task in seen:
            continue
        seen.add(task)
        priority = _clean_text(item.get("priority"))
        if priority not in {"高", "中", "低"}:
            priority = "中"
        rows.append({
            "task": task,
            "owner": _clean_text(item.get("owner")) or "待确认",
            "priority": priority,
        })
        if len(rows) >= 5:
            break
    return rows


async def extract_realtime_todos(meeting_id: str, transcripts: list[dict], user: dict, llm_client=None) -> list[dict]:
    """从最近转写提取明确的实时待办。

    默认走内网 Qwen；失败时返回空列表，保持会中功能不阻断。
    ``llm_client`` 可注入测试替身。
    """

    safe_id, _ = _meeting_for_user(meeting_id, user)
    del safe_id  # 访问校验已完成，待办只依赖传入窗口
    compact = []
    for row in (transcripts or [])[-20:]:
        if not isinstance(row, Mapping):
            continue
        text = _clean_text(row.get("transcript") or row.get("text"))[:200]
        if not text:
            continue
        compact.append({
            "time": row.get("clientTime") or row.get("serverTime") or "",
            "speaker": row.get("speakerName") or row.get("speaker") or "",
            "text": text,
        })
    if not compact:
        return []
    if llm_client is None:
        from backend.llm_client import QwenLocalLLM

        llm_client = QwenLocalLLM()
    from langchain_core.messages import HumanMessage, SystemMessage
    prompt = (
        "从以下会议转写中提取最多5条明确分配的待办。忽略闲聊、试音和推测；"
        "不确定负责人填待确认。只输出 JSON："
        '{"todos":[{"task":"任务描述","owner":"责任人","priority":"高/中/低"}]}\n\n'
        f"转写：{json.dumps(compact, ensure_ascii=False)}"
    )
    try:
        from backend.llm_client import llm_semaphore

        async with llm_semaphore:
            result = await llm_client._agenerate(
                [SystemMessage(content="你是会议待办提取助手，只输出 JSON。"), HumanMessage(content=prompt)],
                enable_thinking=False,
            )
        text = result.generations[0].message.content if result.generations else ""
        return _normalise_realtime_todos(_extract_json_object(text) or {})
    except Exception:
        return []

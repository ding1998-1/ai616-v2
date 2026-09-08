"""会议会后成果服务：纪要快照、版本、标记和待办。

该服务只负责持久化与业务规则，不接收 FastAPI Request。AI 生成器可以在
上层异步调用后把结果写回 ``generatedRecords``，不会和人工修改混在一起。
"""

import asyncio
from copy import deepcopy
import hashlib
import json
import logging
import re
import uuid
from datetime import datetime

from backend.config import APP_DB_LOCK, MEETINGS_LOCK, MEETING_FILES_DIR
from backend.db import (
    _check_meeting_access,
    _db_connect,
    _init_app_db,
    _invalidate_meetings_cache,
    _load_meetings,
    _safe_meeting_id,
    _save_meetings,
)


FORMAL_RECORD_FIELDS = ("minutes", "decisions", "risks", "disclosures", "todos")
REVIEW_FIELD_LABELS = {
    "minutes": "会议纪要",
    "decisions": "议定事项",
    "risks": "风险事项",
    "disclosures": "披露事项",
    "todos": "待办事项",
}
logger = logging.getLogger(__name__)

# Keep exactly one shared generation task per meeting. Refreshes, duplicate
# clicks and multiple tabs must not fan out a complete MAP/REDUCE run.
_record_generation_tasks: dict[str, asyncio.Task] = {}
_record_generation_states: dict[str, dict] = {}


def _record_text(item: dict, field: str) -> str:
    keys = {
        "minutes": ("agenda", "formalSummary"),
        "decisions": ("content",),
        "risks": ("content",),
        "disclosures": ("content",),
        "todos": ("task",),
    }.get(field, ("content",))
    parts: list[str] = []
    for key in keys:
        value = item.get(key)
        if isinstance(value, list):
            parts.extend(str(part).strip() for part in value if str(part).strip())
        elif str(value or "").strip():
            parts.append(str(value).strip())
    return " ".join(parts)


def normalize_review_metadata(records: dict, previous: dict | None = None) -> dict:
    """Attach stable review metadata and preserve human-locked records on regeneration."""

    previous = previous if isinstance(previous, dict) else {}
    for field in FORMAL_RECORD_FIELDS:
        old_locked = {
            str(item.get("id") or ""): deepcopy(item)
            for item in previous.get(field) or []
            if isinstance(item, dict) and item.get("locked") and item.get("id")
        }
        rows: list[dict] = []
        for index, raw in enumerate(records.get(field) or []):
            if not isinstance(raw, dict):
                continue
            item = deepcopy(raw)
            identity = _record_text(item, field)
            item_id = str(item.get("id") or "").strip() or (
                f"{field[:3]}_{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:12]}"
            )
            item["id"] = item_id
            item.setdefault("supportStatus", "ai_suggested")
            item.setdefault("supportSource", "transcript")
            item.setdefault("editedByHuman", False)
            item.setdefault("locked", False)
            rows.append(old_locked.pop(item_id, item))
        rows.extend(old_locked.values())
        records[field] = rows
    summary = records.get("summary")
    if isinstance(summary, dict):
        summary["conclusions"] = deepcopy(records.get("decisions") or [])
        summary["risks"] = deepcopy(records.get("risks") or [])
        summary["todos"] = deepcopy(records.get("todos") or [])
    return records


def _check_review_permission(user: dict, meeting: dict) -> None:
    _check_meeting_access(user, meeting)
    role = str(user.get("role") or "").lower()
    roles = {str(value).lower() for value in user.get("roles") or []}
    if role in {"admin", "secretary", "recorder", "host", "reviewer"} or roles.intersection(
        {"admin", "secretary", "recorder", "host", "reviewer", "minutes_reviewer"}
    ):
        return
    name = str(user.get("name") or user.get("username") or "").strip()
    candidates = " ".join(str(meeting.get(key) or "") for key in ("creator", "host", "moderator", "recorder", "secretary"))
    if not candidates.strip():
        return
    if name and name in candidates:
        return
    raise PermissionError("当前账号没有正式会议成果核验或人工放行权限")


def basis_gate_status(records: dict | None) -> dict:
    """Return the single evidence gate used by confirm, export, and archive."""

    payload = records if isinstance(records, dict) else {}
    missing_by_field: dict[str, int] = {}
    invalid_items: list[dict] = []
    try:
        from backend.services.meeting_record_generation_service import _evidence_supports_item
    except Exception:  # pragma: no cover - import guard for stripped deployments
        _evidence_supports_item = None
    for field in FORMAL_RECORD_FIELDS:
        missing = 0
        for index, item in enumerate(payload.get(field) or []):
            if not isinstance(item, dict):
                missing += 1
                invalid_items.append({"field": field, "index": index, "reason": "记录格式无效"})
                continue
            basis = item.get("basis") if isinstance(item.get("basis"), dict) else {}
            quotes = [
                quote for quote in basis.get("quotes") or []
                if isinstance(quote, dict) and str(quote.get("text") or "").strip()
            ]
            segment_ids = [str(value) for value in basis.get("sourceSegmentIds") or [] if value]
            valid = bool(basis.get("evidenceValid") and quotes and segment_ids)
            if valid and _evidence_supports_item is not None:
                valid = bool(_evidence_supports_item(item, field))
            if not valid:
                missing += 1
                item_text = next((
                    str(item.get(key) or "").strip()
                    for key in ("agenda", "content", "task", "title", "description", "summary")
                    if str(item.get(key) or "").strip()
                ), "")
                invalid_items.append({
                    "field": field,
                    "index": index,
                    "itemId": str(item.get("id") or ""),
                    "content": item_text[:200],
                    "reason": "缺少可核验原文依据",
                })
        missing_by_field[field] = missing
    minutes_empty = not bool(payload.get("minutes"))
    total_invalid = sum(missing_by_field.values())
    ready = bool(payload.get("generated")) and not minutes_empty and total_invalid == 0
    return {
        "ready": ready,
        "minutesEmpty": minutes_empty,
        "invalidCount": total_invalid,
        "missingByField": missing_by_field,
        "invalidItems": invalid_items,
    }


def _manual_review_reason(item: dict, field: str) -> tuple[str, str] | None:
    """Return the business reason that prevents ordinary batch confirmation."""

    reason = str(item.get("reviewReason") or item.get("reason") or "").strip()
    basis = item.get("basis") if isinstance(item.get("basis"), dict) else {}
    if reason == "unsupported_ai_claim" or item.get("unsupportedAiClaim"):
        return "unsupported_ai_claim", "AI 表述与原始证据匹配不足，请核对原始发言"
    if (
        item.get("evidenceConflict")
        or item.get("unresolvedEvidenceConflict")
        or basis.get("conflict")
        or basis.get("evidenceConflict")
    ):
        return "evidence_conflict", "原始证据之间存在冲突，需要人工判断"
    if item.get("requiresHumanReview") or item.get("manualReviewRequired") or item.get("needsReview"):
        return "manual_review_required", "关键内容需要人工单独核验"
    gate = basis_gate_status({"generated": True, "minutes": [item] if field == "minutes" else [], field: [item]})
    field_invalid = int((gate.get("missingByField") or {}).get(field) or 0)
    if field_invalid:
        return "evidence_insufficient", "缺少可核验的原始发言依据"
    return None


def is_batch_support_eligible(item: dict, field: str) -> bool:
    """The server-side eligibility boundary for one AI-generated record."""

    return bool(
        isinstance(item, dict)
        and item.get("supportStatus", "ai_suggested") == "ai_suggested"
        and _manual_review_reason(item, field) is None
    )


def derive_review_summary(records: dict | None) -> dict:
    """Build one review summary shared by API responses and confirmation gates."""

    normalized = normalize_review_metadata(deepcopy(records or {}))
    totals = {"total": 0, "confirmed": 0, "batchEligible": 0, "manualRequired": 0, "rejected": 0}
    by_field: dict[str, dict] = {}
    manual_items: list[dict] = []
    for field in FORMAL_RECORD_FIELDS:
        counts = {"total": 0, "confirmed": 0, "batchEligible": 0, "manualRequired": 0, "rejected": 0}
        for item in normalized.get(field) or []:
            if not isinstance(item, dict):
                continue
            counts["total"] += 1
            totals["total"] += 1
            status = item.get("supportStatus", "ai_suggested")
            if status == "human_supported":
                key = "confirmed"
            elif status == "rejected":
                key = "rejected"
            elif is_batch_support_eligible(item, field):
                key = "batchEligible"
            else:
                key = "manualRequired"
                reason_code, reason_text = _manual_review_reason(item, field) or (
                    "manual_review_required", "需要人工单独核验",
                )
                basis = item.get("basis") if isinstance(item.get("basis"), dict) else {}
                manual_items.append({
                    "id": str(item.get("id") or ""),
                    "field": field,
                    "fieldLabel": REVIEW_FIELD_LABELS[field],
                    "reason": reason_code,
                    "reasonText": reason_text,
                    "content": _record_text(item, field),
                    "basis": deepcopy(basis),
                    "item": deepcopy(item),
                })
            counts[key] += 1
            totals[key] += 1
        by_field[field] = counts
    return {**totals, "byField": by_field, "manualItems": manual_items}


def get_review_summary(meeting_id: str, user: dict) -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    _check_review_permission(user, meeting)
    records = normalize_review_metadata(deepcopy(meeting.get("generatedRecords") or {}))
    return derive_review_summary(records)


def batch_support_eligible_records(meeting_id: str, user: dict) -> dict:
    """Confirm every currently eligible item as one audited, idempotent action."""

    safe_id = _safe_meeting_id(meeting_id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_review_permission(user, meeting)
        records = normalize_review_metadata(deepcopy(meeting.get("generatedRecords") or {}))
        if not records.get("generated"):
            raise ValueError("请先生成会议纪要")
        before = derive_review_summary(records)
        already_supported = before["confirmed"]
        skipped_items = [
            {key: item[key] for key in ("id", "field", "fieldLabel", "reason", "reasonText", "content")}
            for item in before["manualItems"]
        ]
        eligible = [
            (field, item)
            for field in FORMAL_RECORD_FIELDS
            for item in records.get(field) or []
            if is_batch_support_eligible(item, field)
        ]
        if not eligible:
            return {
                "batchId": "",
                "supported": 0,
                "alreadySupported": already_supported,
                "skipped": len(skipped_items),
                "skippedItems": skipped_items,
                "summary": before,
                "records": records,
            }
        now = _now_text()
        batch_id = f"review-batch-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8]}"
        reviewer_id = str(user.get("id") or user.get("username") or "")
        reviewer_name = str(user.get("name") or user.get("username") or "")
        for _, item in eligible:
            item.update({
                "supportStatus": "human_supported",
                "locked": True,
                "humanReview": {
                    "supported": True,
                    "reviewerId": reviewer_id,
                    "reviewerName": reviewer_name,
                    "reviewedAt": now,
                    "action": "batch_support",
                    "batchId": batch_id,
                    "reasonCode": "batch_verified",
                    "reasonText": "人工统一确认证据校验通过的内容",
                },
            })
        records["humanReviewed"] = True
        records["updatedAt"] = now
        summary = derive_review_summary(records)
        audit_event = {
            "id": f"review_batch_{uuid.uuid4().hex[:12]}",
            "type": "record-review-batch",
            "action": "批量确认AI提炼内容",
            "meetingId": safe_id,
            "operator": reviewer_name,
            "operatorId": reviewer_id,
            "serverTime": now,
            "batchId": batch_id,
            "supported": len(eligible),
            "skipped": len(skipped_items),
            "skippedItems": deepcopy(skipped_items),
        }
        meeting.setdefault("events", []).append(audit_event)
        meeting["events"] = meeting["events"][-200:]
        meeting["generatedRecords"] = records
        meeting["updatedAt"] = now
        meetings[safe_id] = meeting
        _save_meetings(meetings)
        _invalidate_meetings_cache()
        _save_version(
            safe_id,
            records,
            user,
            {"action": "batch_support", "batchId": batch_id, "supported": len(eligible)},
            edit_summary=f"批量确认 AI 提炼内容 {len(eligible)} 项，跳过 {len(skipped_items)} 项",
        )
        return {
            "batchId": batch_id,
            "supported": len(eligible),
            "alreadySupported": already_supported,
            "skipped": len(skipped_items),
            "skippedItems": skipped_items,
            "summary": summary,
            "records": records,
        }


def require_basis_gate(records: dict | None, *, action: str) -> dict:
    gate = basis_gate_status(records)
    if gate["ready"]:
        return gate
    labels = {
        "minutes": "会议记录",
        "decisions": "决议",
        "risks": "风险",
        "disclosures": "披露事项",
        "todos": "待办",
    }
    gaps = [
        f"{labels[field]}{count}条"
        for field, count in gate["missingByField"].items()
        if count
    ]
    if gate["minutesEmpty"]:
        gaps.insert(0, "会议记录为空")
    detail = "、".join(gaps) or "成果尚未生成"
    raise ValueError(f"无法{action}：仍有不可核验内容（{detail}），请重新生成或补齐原文依据")


def _basis_gate_fingerprint(gate: dict) -> str:
    snapshot = {
        "minutesEmpty": bool(gate.get("minutesEmpty")),
        "missingByField": gate.get("missingByField") or {},
        "invalidItems": gate.get("invalidItems") or [],
    }
    raw = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


def authorize_basis_override(
    records: dict,
    meeting: dict,
    user: dict,
    *,
    action: str,
    reason: str = "",
) -> tuple[dict, dict | None]:
    """Apply the shared evidence gate and optionally record an authorized exception."""

    gate = basis_gate_status(records)
    gate["fingerprint"] = _basis_gate_fingerprint(gate)
    if gate["ready"]:
        return gate, None
    reason = str(reason or "").strip()
    if not reason:
        require_basis_gate(records, action=action)
    if len(reason) < 8:
        raise ValueError("人工确认理由至少填写 8 个字")

    from backend.dependencies import can_manage_meeting

    if not can_manage_meeting(user, meeting):
        raise PermissionError("只有管理员、会议创建人、主持人或会议秘书可以人工放行")
    now = _now_text()
    actor = user.get("name") or user.get("username") or user.get("id") or ""
    override = {
        "id": f"override_{uuid.uuid4().hex[:12]}",
        "action": action,
        "reason": reason,
        "operator": actor,
        "operatorId": user.get("id") or user.get("username") or "",
        "operatorRole": user.get("meetingRole") or user.get("role") or "",
        "time": now,
        "gateFingerprint": gate["fingerprint"],
        "failedItems": deepcopy(gate.get("invalidItems") or []),
        "missingByField": deepcopy(gate.get("missingByField") or {}),
        "minutesEmpty": bool(gate.get("minutesEmpty")),
    }
    overrides = list(records.get("formalOverrides") or [])
    overrides.append(override)
    records["formalOverrides"] = overrides[-50:]
    records["latestFormalOverride"] = override
    meeting.setdefault("events", []).append({
        "id": override["id"],
        "type": "formal-override",
        "action": action,
        "operator": actor,
        "operatorId": override["operatorId"],
        "operatorRole": override["operatorRole"],
        "reason": reason,
        "gateFingerprint": gate["fingerprint"],
        "failedItems": deepcopy(override["failedItems"]),
        "serverTime": now,
    })
    meeting["events"] = meeting["events"][-200:]
    return gate, override


def authorize_review_export_override(
    records: dict,
    meeting: dict,
    user: dict,
    *,
    reason: str = "",
) -> dict | None:
    """Record an explicit exception when formal export omits unconfirmed AI content."""

    summary = derive_review_summary(records)
    unresolved = summary["batchEligible"] + summary["manualRequired"]
    if not unresolved:
        return None
    reason = str(reason or "").strip()
    if not reason:
        raise ValueError(
            f"仍有 {unresolved} 项内容未完成人工确认；请返回审核，或填写理由后生成缺项正式 Word"
        )
    if len(reason) < 8:
        raise ValueError("人工确认理由至少填写 8 个字")

    from backend.dependencies import can_manage_meeting

    if not can_manage_meeting(user, meeting):
        raise PermissionError("只有管理员、会议创建人、主持人或会议秘书可以生成缺项正式文件")
    now = _now_text()
    actor = user.get("name") or user.get("username") or user.get("id") or ""
    override = {
        "id": f"review_export_override_{uuid.uuid4().hex[:12]}",
        "action": "生成缺项正式文件",
        "reason": reason,
        "operator": actor,
        "operatorId": user.get("id") or user.get("username") or "",
        "operatorRole": user.get("meetingRole") or user.get("role") or "",
        "time": now,
        "unresolvedCount": unresolved,
        "batchEligible": summary["batchEligible"],
        "manualRequired": summary["manualRequired"],
        "unresolvedItems": deepcopy(summary.get("manualItems") or []),
    }
    records["reviewExportOverrides"] = [
        *list(records.get("reviewExportOverrides") or []), override,
    ][-50:]
    records["latestReviewExportOverride"] = override
    meeting.setdefault("events", []).append({
        "id": override["id"],
        "type": "review-export-override",
        **override,
    })
    return override


def _whisper_source_from_meeting(meeting: dict) -> list[dict]:
    """Return the newest complete Whisper review with audio-file attribution."""

    whisper_event = max(
        (
            event for event in meeting.get("events", [])
            if event.get("type") == "transcript"
            and event.get("action") == "whisper-review"
            and event.get("segments")
        ),
        key=lambda event: str(event.get("serverTime") or ""),
        default=None,
    )
    if not whisper_event:
        return []

    offsets = whisper_event.get("fileOffsets") or {}
    ordered_offsets = []
    if isinstance(offsets, dict):
        for file_name, offset in offsets.items():
            try:
                ordered_offsets.append((float(offset), str(file_name)))
            except (TypeError, ValueError):
                continue
    ordered_offsets.sort()

    rows = []
    for index, source in enumerate(whisper_event.get("segments") or []):
        if not isinstance(source, dict):
            continue
        row = dict(source)
        row.setdefault("segmentId", row.get("id") or f"whisper-{index + 1:05d}")
        try:
            start = float(row.get("start") or 0)
        except (TypeError, ValueError):
            start = 0.0
        file_name = "whisper-review"
        relative_start = start
        for offset, candidate in ordered_offsets:
            if offset > start:
                break
            file_name = candidate
            relative_start = max(0.0, start - offset)
        row.setdefault("fileId", file_name)
        row.setdefault("fileName", file_name)
        row["start"] = start
        if row.get("end") is not None:
            try:
                row["end"] = float(row["end"])
            except (TypeError, ValueError):
                pass
        row["fileRelativeStart"] = relative_start
        rows.append(row)
    return rows


def _realtime_source_from_meeting(meeting_id: str) -> list[dict]:
    """Load realtime transcript rows when Whisper review is unavailable."""

    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                """SELECT id, transcript, speaker_name, server_time, payload_json
                   FROM meeting_transcripts
                   WHERE meeting_id = ? AND is_final = 1
                   ORDER BY server_time,
                            CAST(COALESCE(json_extract(payload_json, '$.sentenceSeq'), 0) AS INTEGER),
                            id""",
                (meeting_id,),
            ).fetchall()
    result = []
    for row in rows:
        if not str(row["transcript"] or "").strip():
            continue
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            payload = {}
        result.append({
            "segmentId": row["id"],
            "fileId": "realtime",
            "fileName": "realtime",
            "text": row["transcript"],
            "speaker": row["speaker_name"],
            "time": row["server_time"],
            "source": "realtime",
            "start": payload.get("start"),
            "end": payload.get("end"),
            "sentenceSeq": payload.get("sentenceSeq"),
        })
    return result


def _select_records_source(whisper_source: list[dict], realtime_source: list[dict]) -> tuple[list[dict], str]:
    """Reject an obviously incomplete Whisper review instead of losing most evidence."""

    if whisper_source and (
        not realtime_source or len(whisper_source) >= max(1, int(len(realtime_source) * 0.3))
    ):
        return whisper_source, "whisper"
    if realtime_source:
        return realtime_source, "realtime-whisper-incomplete" if whisper_source else "realtime"
    return whisper_source, "whisper" if whisper_source else "empty"


def _should_preserve_existing_records(existing: dict, candidate: dict) -> bool:
    """Never replace a successful artifact with a degraded retry."""

    return bool(
        candidate.get("degraded")
        and existing.get("generated")
        and not existing.get("degraded")
    )


def auto_prepare_formal_records(
    meeting_id: str,
    *,
    meeting: dict | None = None,
    records: dict | None = None,
    persist: bool = True,
) -> dict:
    """Automatically repair old generated records into an exportable formal set."""

    from backend.services.meeting_record_generation_service import auto_resolve_formal_evidence

    safe_id = _safe_meeting_id(meeting_id)
    meeting = meeting or _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    current_records = records if isinstance(records, dict) else meeting.get("generatedRecords")
    if not isinstance(current_records, dict) or not current_records.get("generated"):
        raise ValueError("请先生成会议纪要")
    current_gate = basis_gate_status(current_records)
    if current_gate["ready"]:
        return current_records

    whisper_source = _whisper_source_from_meeting(meeting)
    realtime_source = _realtime_source_from_meeting(safe_id)
    source, source_kind = _select_records_source(whisper_source, realtime_source)
    if not source:
        raise ValueError("没有可用于自动核验的录音转写")
    repaired = deepcopy(current_records)
    auto_resolve_formal_evidence(repaired, repaired.get("mapResults") or [], source)
    repaired["basisGate"] = basis_gate_status(repaired)
    if not repaired["basisGate"]["ready"]:
        raise ValueError("系统自动依据恢复未形成可用会议记录，请重新生成纪要")
    repaired.update({
        "proofreadPassed": True,
        "proofreadStatus": "auto-evidence-verified",
        "proofreadAt": _now_text(),
        "proofreadBy": "系统自动核验",
        "humanReviewed": False,
        "autoPreparedAt": _now_text(),
        "source": source_kind,
    })
    if not persist:
        return repaired
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        current = meetings.get(safe_id)
        if not current:
            raise KeyError("会议不存在")
        current["generatedRecords"] = repaired
        current["updatedAt"] = repaired["autoPreparedAt"]
        meetings[safe_id] = current
        _save_meetings(meetings)
        _invalidate_meetings_cache()
    _save_version(
        safe_id,
        repaired,
        {"name": "系统自动核验"},
        {"autoEvidenceResolution": True},
        edit_summary="系统自动补齐原文依据并生成正式内容",
    )
    return repaired


def record_generation_status(meeting_id: str) -> dict:
    """Return recoverable UI state for the current or latest generation."""

    safe_id = _safe_meeting_id(meeting_id)
    state = dict(_record_generation_states.get(safe_id) or {})
    task = _record_generation_tasks.get(safe_id)
    if task is not None and not task.done():
        state["status"] = "running"
    meeting = _load_meetings().get(safe_id) or {}
    records = meeting.get("generatedRecords") if isinstance(meeting.get("generatedRecords"), dict) else {}
    if not state:
        state = {
            "status": "done" if records.get("generated") else "idle",
            "generationId": records.get("generationId", ""),
            "startedAt": "",
            "finishedAt": records.get("generatedAt", ""),
            "error": "",
            "joinedRequests": 0,
        }
    state["meetingId"] = safe_id
    state["hasRecords"] = bool(records.get("generated"))
    return state


async def generate_records_v2(meeting_id: str) -> dict:
    """Coalesce duplicate requests into one shielded Records Pipeline task."""

    safe_id = _safe_meeting_id(meeting_id)
    current = _record_generation_tasks.get(safe_id)
    if current is not None and not current.done():
        state = _record_generation_states.setdefault(safe_id, {})
        state["joinedRequests"] = int(state.get("joinedRequests") or 0) + 1
        return await asyncio.shield(current)

    generation_id = f"gen_{uuid.uuid4().hex[:12]}"
    _record_generation_states[safe_id] = {
        "status": "running",
        "generationId": generation_id,
        "startedAt": _now_text(),
        "finishedAt": "",
        "error": "",
        "joinedRequests": 0,
    }

    async def runner() -> dict:
        try:
            records = await _generate_records_v2_once(safe_id, generation_id=generation_id)
            _record_generation_states[safe_id].update({
                "status": "done",
                "finishedAt": records.get("generatedAt") or _now_text(),
            })
            return records
        except Exception as exc:
            _record_generation_states[safe_id].update({
                "status": "failed",
                "finishedAt": _now_text(),
                "error": str(exc)[:500],
            })
            raise

    task = asyncio.create_task(runner(), name=f"records-generation-{safe_id}-{generation_id}")
    _record_generation_tasks[safe_id] = task
    # A browser refresh or disconnected request must not cancel the shared job.
    return await asyncio.shield(task)


async def _generate_records_v2_once(meeting_id: str, *, generation_id: str) -> dict:
    """Generate and persist one Records Pipeline v2 result using local Qwen."""

    from backend.llm_client import QwenLocalLLM, llm_semaphore
    from backend.services.meeting_record_generation_service import MeetingRecordGenerationService

    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")

    whisper_source = _whisper_source_from_meeting(meeting)
    realtime_source = _realtime_source_from_meeting(safe_id)
    source, source_kind = _select_records_source(whisper_source, realtime_source)

    participants = meeting.get("participants") or meeting.get("attendees") or []
    agenda_rows = meeting.get("agendaDrafts") or []
    agenda_titles = [
        str(item.get("title") or item.get("agenda") or "").strip()
        for item in agenda_rows
        if isinstance(item, dict) and str(item.get("title") or item.get("agenda") or "").strip()
    ]
    cached = meeting.get("generatedRecords") if isinstance(meeting.get("generatedRecords"), dict) else {}

    async def v1_fallback(_segments, _context):
        return cached or {"summary": [], "minutes": [], "decisions": [], "todos": []}

    map_llm = QwenLocalLLM(max_tokens=4000)
    reduce_llm = QwenLocalLLM(max_tokens=4000)
    service = MeetingRecordGenerationService(
        map_call=map_llm,
        reduce_call=reduce_llm,
        v1_fallback=v1_fallback,
        semaphore=llm_semaphore,
        model_name=reduce_llm.get_active_model_name(),
    )
    records = await service.generate(
        safe_id,
        source,
        meeting_context={
            "title": meeting.get("title") or "",
            "project": meeting.get("project") or meeting.get("projectName") or "",
            "source": source_kind,
        },
        participants=participants,
        agenda_titles=agenda_titles,
    )
    from backend.services.meeting_record_cleanup_service import MeetingRecordCleanupService

    cleanup_service = MeetingRecordCleanupService(
        cleanup_call=map_llm,
        topic_reduce_call=reduce_llm,
        semaphore=llm_semaphore,
        concurrency=3,
        model_name=map_llm.get_active_model_name(),
    )
    cleanup_result = await cleanup_service.build_record_paragraphs(
        source,
        meeting_context={
            "title": meeting.get("title") or "",
            "project": meeting.get("project") or meeting.get("projectName") or "",
        },
        existing=cached.get("_recordParagraphs") or [],
        existing_topics=cached.get("recordTopics") or [],
    )
    records["_recordParagraphs"] = cleanup_result["recordParagraphs"]
    records["recordBlocks"] = cleanup_result["recordBlocks"]
    records["recordTopics"] = cleanup_result["recordTopics"]
    records["recordCleanupSnapshot"] = cleanup_result["snapshot"]
    normalize_review_metadata(records, cached)
    records["generated"] = True
    records["generatedAt"] = _now_text()
    records["generationId"] = generation_id
    records["source"] = source_kind
    records["whisperEnhanced"] = source_kind == "whisper"
    records["basisGate"] = basis_gate_status(records)

    # A failed REDUCE may still return deterministic fallback content.  Do not
    # let that lower-quality fallback replace an existing successful result;
    # the user can keep using the previous version and retry later.
    if _should_preserve_existing_records(cached, records):
        raise RuntimeError("本次纪要生成已降级，系统已保留上一份正常结果，请稍后重试")

    with MEETINGS_LOCK:
        meetings = _load_meetings()
        current = meetings.get(safe_id)
        if not current:
            raise KeyError("会议不存在")
        current["generatedRecords"] = records
        current["updatedAt"] = records["generatedAt"]
        meetings[safe_id] = current
        _save_meetings(meetings)
        _invalidate_meetings_cache()
    try:
        _save_version(
            safe_id,
            records,
            {"name": "AI 纪要生成器"},
            {"generated": True, "source": source_kind},
            edit_summary=(
                f"AI 生成纪要（{source_kind}，"
                f"{records.get('pipelineStatus') or 'unknown'}，任务 {generation_id}）"
            ),
        )
    except Exception:
        logger.exception("保存 AI 纪要历史版本失败 meeting=%s generation=%s", safe_id, generation_id)
    return records


async def regenerate_record_paragraphs(meeting_id: str) -> dict:
    """Rebuild only the readable meeting record from saved transcripts."""

    from backend.llm_client import QwenLocalLLM, llm_semaphore
    from backend.services.meeting_record_cleanup_service import MeetingRecordCleanupService

    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    records = meeting.get("generatedRecords") if isinstance(meeting.get("generatedRecords"), dict) else {}
    whisper_source = _whisper_source_from_meeting(meeting)
    realtime_source = _realtime_source_from_meeting(safe_id)
    source, source_kind = _select_records_source(whisper_source, realtime_source)
    if not source:
        raise ValueError("当前会议没有可整理的转写原文")
    llm = QwenLocalLLM(max_tokens=4000)
    service = MeetingRecordCleanupService(
        cleanup_call=llm,
        topic_reduce_call=llm,
        semaphore=llm_semaphore,
        concurrency=3,
        model_name=llm.get_active_model_name(),
    )
    result = await service.build_record_paragraphs(
        source,
        meeting_context={
            "title": meeting.get("title") or "",
            "project": meeting.get("project") or meeting.get("projectName") or "",
            "source": source_kind,
        },
        existing=records.get("_recordParagraphs") or [],
        existing_topics=records.get("recordTopics") or [],
    )
    records["_recordParagraphs"] = result["recordParagraphs"]
    records["recordBlocks"] = result["recordBlocks"]
    records["recordTopics"] = result["recordTopics"]
    records["recordCleanupSnapshot"] = result["snapshot"]
    records["updatedAt"] = _now_text()
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        current = meetings.get(safe_id)
        if not current:
            raise KeyError("会议不存在")
        current["generatedRecords"] = records
        current["updatedAt"] = records["updatedAt"]
        meetings[safe_id] = current
        _save_meetings(meetings)
        _invalidate_meetings_cache()
    return {"records": records, "cleanup": result["snapshot"]}


def generate_record_documents(
    meeting_id: str,
    template_id: str = "standard",
    *,
    user: dict | None = None,
    override_reason: str = "",
    publication_mode: str = "formal",
) -> dict:
    """Generate the formal minutes and independent evidence attachment."""

    from backend.services.meeting_document_service import generate_document_bundle

    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    records = meeting.get("generatedRecords")
    if not isinstance(records, dict) or not records.get("generated"):
        raise ValueError("请先生成会议纪要")
    records = normalize_review_metadata(deepcopy(records))
    publication_mode = "review" if publication_mode == "review" else "formal"
    if publication_mode == "formal":
        review_override = authorize_review_export_override(
            records,
            meeting,
            user or {},
            reason=override_reason,
        )
        formal_records = deepcopy(records)
        for field in FORMAL_RECORD_FIELDS:
            formal_records[field] = [
                item for item in formal_records.get(field) or []
                if isinstance(item, dict) and item.get("supportStatus") == "human_supported"
            ]
        if not any(formal_records.get(field) for field in FORMAL_RECORD_FIELDS):
            raise ValueError("尚无人工支持的内容，不能生成正式发布版")
    else:
        review_override = None
        formal_records = records
    if publication_mode == "formal":
        gate, override = authorize_basis_override(
            formal_records,
            meeting,
            user or {},
            action="生成正式文件",
            reason=override_reason,
        )
    else:
        gate, override = basis_gate_status(formal_records), None
    records["basisGate"] = gate
    if override:
        records.update({
            "proofreadPassed": True,
            "proofreadStatus": "human-authorized-exception",
            "proofreadAt": override["time"],
            "proofreadBy": override["operator"],
            "humanReviewed": True,
        })

    whisper_source = _whisper_source_from_meeting(meeting)
    realtime_source = _realtime_source_from_meeting(safe_id)
    source, _ = _select_records_source(whisper_source, realtime_source)
    whisper_event = max(
        (
            event for event in meeting.get("events") or []
            if event.get("type") == "transcript" and event.get("action") == "whisper-review"
        ),
        key=lambda event: str(event.get("serverTime") or ""),
        default={},
    )
    markers = [
        {"id": event.get("id"), **(event.get("payload") or {})}
        for event in meeting.get("events") or []
        if event.get("type") == "marker"
    ]
    output_dir = MEETING_FILES_DIR / safe_id / "records-v2"
    bundle = generate_document_bundle(
        safe_id,
        meeting,
        records,
        source,
        output_dir,
        file_offsets=whisper_event.get("fileOffsets") or {},
        markers=markers,
        require_proofread=publication_mode == "formal",
        template_id=template_id,
        publication_mode=publication_mode,
    )

    with MEETINGS_LOCK:
        meetings = _load_meetings()
        current = meetings.get(safe_id)
        if not current:
            raise KeyError("会议不存在")
        current_records = dict(current.get("generatedRecords") or {})
        if override or review_override:
            current_records["formalOverrides"] = records.get("formalOverrides") or []
            if override:
                current_records["latestFormalOverride"] = override
            current_records["reviewExportOverrides"] = records.get("reviewExportOverrides") or []
            if review_override:
                current_records["latestReviewExportOverride"] = review_override
            current["events"] = meeting.get("events") or current.get("events") or []
        current_records["documents"] = bundle
        current["generatedRecords"] = current_records
        current["updatedAt"] = _now_text()
        meetings[safe_id] = current
        _save_meetings(meetings)
        _invalidate_meetings_cache()
    from backend.services.asr_hotword_learning_service import learn_from_formal_records

    learning = learn_from_formal_records(safe_id, records, source)
    bundle["glossaryLearning"] = learning
    return bundle


def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _json_loads(value: str, default):
    try:
        return json.loads(value) if value else default
    except Exception:
        return default


def _json_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def get_records(meeting_id: str) -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    records = meeting.get("generatedRecords")
    if not isinstance(records, dict):
        records = {"generated": False, "summary": [], "minutes": [], "decisions": [], "todos": []}
    elif records.get("generated"):
        records = normalize_review_metadata(deepcopy(records))
    return {"meetingId": safe_id, "records": records}


def update_records(meeting_id: str, patch: dict, user: dict) -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)
        allowed = {"summary", "minutes", "decisions", "todos"}
        override = {key: value for key, value in (patch or {}).items() if key in allowed and value is not None}
        if not override:
            raise ValueError("没有可保存的会议成果")
        records = dict(meeting.get("generatedRecords") or {})
        records.update(override)
        records["generated"] = bool(records.get("generated", True))
        records["proofreadPassed"] = False
        records["proofreadStatus"] = "needs_review"
        records["humanReviewed"] = False
        records["formalOverrides"] = []
        records.pop("latestFormalOverride", None)
        records["basisGate"] = basis_gate_status(records)
        records["updatedAt"] = _now_text()
        meeting["generatedRecords"] = records
        meeting["updatedAt"] = records["updatedAt"]
        meetings[safe_id] = meeting
        _save_meetings(meetings)
        _invalidate_meetings_cache()
        _save_version(safe_id, records, user, override)
    return records


def review_record_item(
    meeting_id: str,
    field: str,
    item_id: str,
    action: str,
    user: dict,
    *,
    content: str = "",
    reason_code: str = "verified",
    reason_text: str = "",
) -> dict:
    """Review one generated item without losing the AI proposal or evidence chain."""

    if field not in FORMAL_RECORD_FIELDS:
        raise ValueError("不支持的成果类型")
    if action not in {"support", "edit_and_support", "reject"}:
        raise ValueError("不支持的核验动作")
    safe_id = _safe_meeting_id(meeting_id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_review_permission(user, meeting)
        records = normalize_review_metadata(deepcopy(meeting.get("generatedRecords") or {}))
        rows = records.get(field) or []
        index = next((idx for idx, row in enumerate(rows) if str(row.get("id") or "") == item_id), -1)
        if index < 0:
            raise KeyError("待核验内容不存在")
        item = deepcopy(rows[index])
        now = _now_text()
        reviewer_id = str(user.get("id") or user.get("username") or "")
        reviewer_name = str(user.get("name") or user.get("username") or "")
        if action == "edit_and_support":
            edited = str(content or "").strip()
            if not edited:
                raise ValueError("编辑后支持必须填写正式表述")
            if field == "minutes":
                original = "\n".join(str(value) for value in item.get("formalSummary") or [] if str(value).strip())
                item["originalAiSummary"] = item.get("originalAiSummary") or original
                item["formalSummary"] = [edited]
            else:
                key = "task" if field == "todos" else "content"
                item["originalAiSummary"] = item.get("originalAiSummary") or str(item.get(key) or "")
                item[key] = edited
            item["editedByHuman"] = True
        item["supportStatus"] = "rejected" if action == "reject" else "human_supported"
        item["locked"] = True
        item["humanReview"] = {
            "supported": action != "reject",
            "reviewerId": reviewer_id,
            "reviewerName": reviewer_name,
            "reviewedAt": now,
            "action": action,
            "batchId": "",
            "reasonCode": reason_code,
            "reasonText": reason_text,
        }
        rows[index] = item
        records[field] = rows
        normalize_review_metadata(records)
        records["humanReviewed"] = any(
            row.get("supportStatus") == "human_supported"
            for name in FORMAL_RECORD_FIELDS for row in records.get(name) or []
            if isinstance(row, dict)
        )
        records["updatedAt"] = now
        meeting["generatedRecords"] = records
        meeting["updatedAt"] = now
        meetings[safe_id] = meeting
        _save_meetings(meetings)
        _invalidate_meetings_cache()
        _save_version(
            safe_id,
            records,
            user,
            {"field": field, "itemId": item_id, "action": action},
            edit_summary=f"人工核验{field}：{action}",
        )
    return records


def confirm_records(meeting_id: str, user: dict, override_reason: str = "") -> dict:
    """Finish meeting-level review after item review has reached a stable state."""

    safe_id = _safe_meeting_id(meeting_id)
    initial_meeting = _load_meetings().get(safe_id)
    if not initial_meeting:
        raise KeyError("会议不存在")
    _check_meeting_access(user, initial_meeting)
    _check_review_permission(user, initial_meeting)
    initial_records = dict(initial_meeting.get("generatedRecords") or {})
    if not initial_records.get("generated"):
        raise ValueError("请先生成会议纪要")
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)
        records = normalize_review_metadata(deepcopy(meeting.get("generatedRecords") or {}))
        if not records.get("generated"):
            raise ValueError("请先生成会议纪要")
        summary = derive_review_summary(records)
        if not override_reason and summary["batchEligible"]:
            raise ValueError(f"还有 {summary['batchEligible']} 项证据正常内容待统一确认")
        if not override_reason and summary["manualRequired"]:
            raise ValueError(f"还有 {summary['manualRequired']} 项内容需要重点核验")
        gate, override = authorize_basis_override(
            records,
            meeting,
            user,
            action="确认纪要",
            reason=override_reason,
        )
        now = _now_text()
        reviewer = user.get("name") or user.get("username") or ""
        normalize_review_metadata(records)
        records.update({
            "proofreadPassed": True,
            "proofreadStatus": "human-authorized-exception" if override else "human-approved",
            "proofreadAt": now,
            "proofreadBy": reviewer,
            "humanReviewed": True,
            "basisGate": gate,
        })
        meeting["reviewDone"] = True
        meeting["phase"] = "纪要已确认"
        meeting["generatedRecords"] = records
        meeting["updatedAt"] = now
        meetings[safe_id] = meeting
        _save_meetings(meetings)
        _invalidate_meetings_cache()
        _save_version(
            safe_id,
            records,
            user,
            {"humanReviewed": True, "formalOverride": override or {}},
            edit_summary="人工确认并放行证据异常" if override else "人工确认会议纪要",
        )
    return records


def _save_version(
    meeting_id: str,
    records: dict,
    user: dict,
    override: dict,
    *,
    edit_summary: str = "",
) -> dict:
    _init_app_db()
    now = _now_text()
    editor = user.get("name") or user.get("username") or ""
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(MAX(version), 0) AS version FROM meeting_record_versions WHERE meeting_id = ?",
                (meeting_id,),
            ).fetchone()
            version = int(row["version"] or 0) + 1
            version_id = f"ver_{uuid.uuid4().hex[:10]}"
            conn.execute(
                """INSERT INTO meeting_record_versions
                   (id, meeting_id, version, editor, edit_summary, records_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (version_id, meeting_id, version, editor,
                 edit_summary or f"编辑了{', '.join(override.keys())}", _json_dumps(records), now),
            )
    return {"id": version_id, "meetingId": meeting_id, "version": version, "editor": editor, "createdAt": now}


def list_versions(meeting_id: str) -> list[dict]:
    _init_app_db()
    with _db_connect() as conn:
        rows = conn.execute(
            "SELECT id, meeting_id, version, editor, edit_summary, created_at FROM meeting_record_versions WHERE meeting_id = ? ORDER BY version DESC",
            (_safe_meeting_id(meeting_id),),
        ).fetchall()
    return [dict(row) for row in rows]


def get_version(meeting_id: str, version: int) -> dict:
    _init_app_db()
    with _db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM meeting_record_versions WHERE meeting_id = ? AND version = ?",
            (_safe_meeting_id(meeting_id), int(version)),
        ).fetchone()
    if not row:
        raise KeyError("版本不存在")
    return {
        "version": row["version"], "editor": row["editor"],
        "editSummary": row["edit_summary"], "createdAt": row["created_at"],
        "records": _json_loads(row["records_json"], {}),
    }


def list_todos(status: str = "", owner: str = "", priority: str = "", limit: int = 100, offset: int = 0) -> tuple[list[dict], int]:
    _init_app_db()
    conditions, params = [], []
    if status:
        conditions.append("status = ?")
        params.append(status)
    if owner:
        conditions.append("owner LIKE ?")
        params.append(f"%{owner}%")
    if priority:
        conditions.append("priority = ?")
        params.append(priority)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    limit = max(1, min(int(limit), 500))
    offset = max(0, int(offset))
    with _db_connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM meeting_todos {where} ORDER BY CASE priority WHEN '高' THEN 0 WHEN '中' THEN 1 ELSE 2 END, created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()
        total = conn.execute(f"SELECT COUNT(*) AS count FROM meeting_todos {where}", params).fetchone()["count"]
    return [_todo_from_row(row) for row in rows], int(total)


def _todo_from_row(row) -> dict:
    return {
        "id": row["id"], "meetingId": row["meeting_id"], "meetingTitle": row["meeting_title"],
        "task": row["task"], "owner": row["owner"], "deadline": row["deadline"],
        "priority": row["priority"], "status": row["status"], "source": row["source"],
        "reference": row["reference"], "createdAt": row["created_at"],
        "updatedAt": row["updated_at"], "completedAt": row["completed_at"],
    }


def create_todo(meeting_id: str, body: dict, user: dict) -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    _check_meeting_access(user, meeting)
    task = str(body.get("task") or "").strip()
    if not task:
        raise ValueError("待办内容不能为空")
    now = _now_text()
    todo_id = f"todo_{uuid.uuid4().hex[:10]}"
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                """INSERT INTO meeting_todos
                   (id, meeting_id, meeting_title, task, owner, deadline, priority,
                    status, source, reference, created_at, updated_at, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (todo_id, safe_id, meeting.get("title", ""), task, str(body.get("owner") or ""),
                 str(body.get("deadline") or ""), str(body.get("priority") or "中"), "待处理",
                 str(body.get("source") or "manual"), str(body.get("reference") or ""), now, now, _json_dumps(body)),
            )
            row = conn.execute("SELECT * FROM meeting_todos WHERE id = ?", (todo_id,)).fetchone()
    return _todo_from_row(row)


def update_todo(todo_id: str, patch: dict, user: dict) -> dict:
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute("SELECT * FROM meeting_todos WHERE id = ?", (todo_id,)).fetchone()
            if not row:
                raise KeyError("待办不存在")
            meeting = _load_meetings().get(row["meeting_id"])
            if not meeting:
                raise KeyError("会议不存在")
            _check_meeting_access(user, meeting)
            fields = {"task", "owner", "deadline", "priority", "status"}
            changes = {key: patch[key] for key in fields if key in patch}
            if not changes:
                raise ValueError("没有可更新的待办字段")
            now = _now_text()
            sets = [f"{key} = ?" for key in changes]
            values = list(changes.values())
            sets.append("updated_at = ?")
            values.append(now)
            if changes.get("status") in {"已完成", "已取消"}:
                sets.append("completed_at = ?")
                values.append(now)
            values.append(todo_id)
            conn.execute(f"UPDATE meeting_todos SET {', '.join(sets)} WHERE id = ?", values)
            return _todo_from_row(conn.execute("SELECT * FROM meeting_todos WHERE id = ?", (todo_id,)).fetchone())


def delete_todo(todo_id: str, user: dict) -> None:
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute("SELECT meeting_id FROM meeting_todos WHERE id = ?", (todo_id,)).fetchone()
            if not row:
                raise KeyError("待办不存在")
            meeting = _load_meetings().get(row["meeting_id"])
            if not meeting:
                raise KeyError("会议不存在")
            _check_meeting_access(user, meeting)
            conn.execute("DELETE FROM meeting_todos WHERE id = ?", (todo_id,))


def add_marker(meeting_id: str, marker: dict, user: dict) -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)
        now = _now_text()
        marker_id = f"marker_{uuid.uuid4().hex[:12]}"
        payload = {**marker, "createdBy": user.get("name") or user.get("username") or "记录员"}
        event = {"id": marker_id, "type": "marker", "serverTime": now, "payload": payload}
        meeting.setdefault("events", []).append(event)
        meeting["events"] = meeting["events"][-200:]
        meeting["updatedAt"] = now
        meetings[safe_id] = meeting
        _save_meetings(meetings)
    return {"id": marker_id, **payload}


def list_markers(meeting_id: str, user: dict) -> list[dict]:
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    _check_meeting_access(user, meeting)
    return [{"id": event.get("id"), **(event.get("payload") or {})} for event in meeting.get("events", []) if event.get("type") == "marker"]


def delete_marker(meeting_id: str, marker_id: str, user: dict) -> None:
    safe_id = _safe_meeting_id(meeting_id)
    marker_id = re.sub(r"[^a-zA-Z0-9_-]", "", marker_id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)
        events = meeting.get("events", [])
        updated = [event for event in events if event.get("id") != marker_id]
        if len(updated) == len(events):
            raise KeyError("标记不存在")
        meeting["events"] = updated
        meeting["updatedAt"] = _now_text()
        meetings[safe_id] = meeting
        _save_meetings(meetings)

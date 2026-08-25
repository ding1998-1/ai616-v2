"""会议会后成果服务：纪要快照、版本、标记和待办。

该服务只负责持久化与业务规则，不接收 FastAPI Request。AI 生成器可以在
上层异步调用后把结果写回 ``generatedRecords``，不会和人工修改混在一起。
"""

import json
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


def _whisper_source_from_meeting(meeting: dict) -> list[dict]:
    """Return the newest complete Whisper review with audio-file attribution."""

    whisper_event = None
    for event in meeting.get("events", []):
        if event.get("type") == "transcript" and event.get("action") == "whisper-review":
            if event.get("segments"):
                whisper_event = event
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
                """SELECT id, transcript, speaker_name, server_time
                   FROM meeting_transcripts
                   WHERE meeting_id = ? AND is_final = 1
                   ORDER BY server_time, id""",
                (meeting_id,),
            ).fetchall()
    return [
        {
            "segmentId": row["id"],
            "fileId": "realtime",
            "fileName": "realtime",
            "text": row["transcript"],
            "speaker": row["speaker_name"],
            "time": row["server_time"],
            "source": "realtime",
        }
        for row in rows
        if str(row["transcript"] or "").strip()
    ]


def _select_records_source(whisper_source: list[dict], realtime_source: list[dict]) -> tuple[list[dict], str]:
    """Reject an obviously incomplete Whisper review instead of losing most evidence."""

    if whisper_source and (
        not realtime_source or len(whisper_source) >= max(1, int(len(realtime_source) * 0.3))
    ):
        return whisper_source, "whisper"
    if realtime_source:
        return realtime_source, "realtime-whisper-incomplete" if whisper_source else "realtime"
    return whisper_source, "whisper" if whisper_source else "empty"


async def generate_records_v2(meeting_id: str) -> dict:
    """Generate and persist Records Pipeline v2 output using local Qwen only."""

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
    records["generated"] = True
    records["generatedAt"] = _now_text()
    records["source"] = source_kind

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
    return records


def generate_record_documents(meeting_id: str) -> dict:
    """Generate the formal minutes and independent evidence attachment."""

    from backend.services.meeting_document_service import generate_document_bundle

    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    records = meeting.get("generatedRecords")
    if not isinstance(records, dict) or not records.get("generated"):
        raise ValueError("请先生成会议纪要")

    whisper_source = _whisper_source_from_meeting(meeting)
    realtime_source = _realtime_source_from_meeting(safe_id)
    source, _ = _select_records_source(whisper_source, realtime_source)
    whisper_event = next(
        (
            event for event in reversed(meeting.get("events") or [])
            if event.get("type") == "transcript" and event.get("action") == "whisper-review"
        ),
        {},
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
        require_proofread=True,
    )

    with MEETINGS_LOCK:
        meetings = _load_meetings()
        current = meetings.get(safe_id)
        if not current:
            raise KeyError("会议不存在")
        current_records = dict(current.get("generatedRecords") or {})
        current_records["documents"] = bundle
        current["generatedRecords"] = current_records
        current["updatedAt"] = _now_text()
        meetings[safe_id] = current
        _save_meetings(meetings)
        _invalidate_meetings_cache()
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
        records["updatedAt"] = _now_text()
        meeting["generatedRecords"] = records
        meeting["updatedAt"] = records["updatedAt"]
        meetings[safe_id] = meeting
        _save_meetings(meetings)
        _invalidate_meetings_cache()
        _save_version(safe_id, records, user, override)
    return records


def _save_version(meeting_id: str, records: dict, user: dict, override: dict) -> dict:
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
                 f"编辑了{', '.join(override.keys())}", _json_dumps(records), now),
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

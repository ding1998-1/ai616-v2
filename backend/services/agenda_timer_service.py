"""会议议题计时服务。"""

from datetime import datetime

from backend.config import MEETINGS_LOCK
from backend.db import (
    _check_meeting_access,
    _db_connect,
    _init_app_db,
    _invalidate_meetings_cache,
    _load_meetings,
    _save_meetings,
    _safe_meeting_id,
)


def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def timer_action(meeting_id: str, agenda_id: str, action: str, extend_minutes: int, user: dict) -> dict:
    action = (action or "start").strip().lower()
    if action not in {"start", "extend", "advance", "reset"}:
        raise ValueError("不支持的计时操作")
    extend_minutes = max(1, min(int(extend_minutes or 5), 120))
    safe_id = _safe_meeting_id(meeting_id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)
        now = _now_text()
        drafts = list(meeting.get("agendaDrafts") or [])
        index = next((idx for idx, draft in enumerate(drafts) if draft.get("id") == agenda_id or draft.get("legacyDraftId") == agenda_id), -1)
        if action in {"start", "extend"} and index < 0:
            raise KeyError("议题不存在")
        if action == "start":
            for idx, draft in enumerate(drafts):
                draft["timerStartedAt"] = now if idx == index else ""
                draft.setdefault("timerExtended", 0)
            meeting["activeAgendaId"] = drafts[index].get("id") or agenda_id
        elif action == "extend":
            drafts[index]["timerExtended"] = int(drafts[index].get("timerExtended") or 0) + extend_minutes
        elif action == "advance":
            next_index = index + 1 if index >= 0 else 0
            for draft in drafts:
                draft["timerStartedAt"] = ""
            if next_index < len(drafts):
                drafts[next_index]["timerStartedAt"] = now
                drafts[next_index].setdefault("timerExtended", 0)
                meeting["activeAgendaId"] = drafts[next_index].get("id") or ""
            else:
                meeting["activeAgendaId"] = ""
        else:
            for draft in drafts:
                draft["timerStartedAt"] = ""
                draft["timerExtended"] = 0
            meeting["activeAgendaId"] = ""
        meeting["agendaDrafts"] = drafts
        meeting["updatedAt"] = now
        meetings[safe_id] = meeting
        _save_meetings(meetings)
        _invalidate_meetings_cache()
    return {
        "success": True,
        "agendaId": agenda_id,
        "action": action,
        "activeAgendaId": meeting.get("activeAgendaId", ""),
        "agendaDrafts": drafts,
    }


def meeting_timer_action(
    meeting_id: str,
    action: str,
    duration_minutes: int | None,
    user: dict,
) -> dict:
    """执行会议级计时操作。

    这是旧接口 ``POST /api/meetings/{meeting_id}/timer/{action}`` 的数据库版
    实现。会议级计时与议题计时是两套状态，故保留为独立函数，避免把旧接口
    的语义混入 ``timer_action``。
    """
    _init_app_db()
    safe_id = _safe_meeting_id(meeting_id)
    now = _now_text()
    with _db_connect() as conn:
        meeting = conn.execute("SELECT * FROM meetings WHERE id = ?", (safe_id,)).fetchone()
    if not meeting:
        raise KeyError("会议不存在")
    _check_meeting_access(user, dict(meeting))

    if action == "start":
        with _db_connect() as conn:
            conn.execute("UPDATE meetings SET timer_started_at = ? WHERE id = ?", (now, safe_id))
    elif action == "reset":
        with _db_connect() as conn:
            conn.execute("UPDATE meetings SET timer_started_at = '' WHERE id = ?", (safe_id,))
    elif action == "set-duration" and duration_minutes is not None:
        with _db_connect() as conn:
            conn.execute(
                "UPDATE meetings SET agenda_duration_minutes = ? WHERE id = ?",
                (duration_minutes, safe_id),
            )
    _invalidate_meetings_cache()
    return {
        "success": True,
        "meetingId": safe_id,
        "action": action,
        "timerStartedAt": now if action == "start" else (meeting["timer_started_at"] or ""),
        "durationMinutes": (
            duration_minutes
            if action == "set-duration"
            else (meeting["agenda_duration_minutes"] or 15)
        ),
    }

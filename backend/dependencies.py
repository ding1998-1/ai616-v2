"""FastAPI 依赖与业务上下文。

路由只负责 HTTP 参数和响应；会议/议题访问判断集中在这里，服务层不依赖
FastAPI Request 或 HTTPException 以保持可测试性。
"""

from fastapi import HTTPException, Request

from backend.db import _check_meeting_access, _db_connect, _init_app_db, _load_meetings, _safe_meeting_id
from backend.deps import _get_request_user
from backend.services.agenda_service import get_meeting_agenda, list_meeting_agendas
from backend.services.permission_service import can_view_agenda, has_agenda_permission


GOVERNOR_ROLES = {"主持人", "会议秘书", "秘书", "host", "secretary"}


def require_user(request: Request) -> dict:
    return _get_request_user(request, required=True)


def get_meeting_or_404(meeting_id: str) -> tuple[str, dict]:
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id) or {}
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    return safe_id, meeting


def require_meeting(request: Request, meeting_id: str) -> tuple[dict, str, dict]:
    user = require_user(request)
    safe_id, meeting = get_meeting_or_404(meeting_id)
    _check_meeting_access(user, meeting)
    return user, safe_id, meeting


def require_meeting_user(user: dict, meeting_id: str) -> tuple[str, dict]:
    safe_id, meeting = get_meeting_or_404(meeting_id)
    _check_meeting_access(user, meeting)
    return safe_id, meeting


def can_manage_meeting(user: dict, meeting: dict) -> bool:
    if user.get("role") == "admin":
        return True
    creator = meeting.get("creator") or ""
    name = user.get("name") or user.get("username") or ""
    if creator and (name in creator or creator in name):
        return True
    role = (user.get("meetingRole") or user.get("role") or "").strip()
    return role in GOVERNOR_ROLES


def require_agenda(
    request: Request, meeting_id: str, agenda_id: str, permission: str = "view"
) -> tuple[dict, str, dict, dict]:
    user, safe_id, meeting = require_meeting(request, meeting_id)
    agenda = get_meeting_agenda(safe_id, agenda_id)
    if not agenda:
        raise HTTPException(status_code=404, detail="议题不存在")
    if not has_agenda_permission(user, meeting, agenda, permission):
        raise HTTPException(status_code=403, detail="你没有该议题的操作权限")
    return user, safe_id, meeting, agenda


def visible_agenda_ids(user: dict, meeting_id: str, meeting: dict) -> set[str]:
    return {
        agenda["id"]
        for agenda in list_meeting_agendas(meeting_id)
        if agenda.get("id") and can_view_agenda(user, meeting, agenda)
    }


def require_signature(
    request: Request, meeting_id: str, agenda_id: str, permission: str = "view"
) -> tuple[dict, str, dict, dict | None]:
    """签字目标鉴权：议题成果继承 ACL，会议级成果要求会议访问/参会身份。"""
    if agenda_id:
        return require_agenda(request, meeting_id, agenda_id, permission)
    user, safe_id, meeting = require_meeting(request, meeting_id)
    if permission == "view" or user.get("role") == "admin":
        return user, safe_id, meeting, None
    role = (user.get("meetingRole") or user.get("role") or "").strip()
    if role in GOVERNOR_ROLES:
        return user, safe_id, meeting, None
    user_id = user.get("id") or user.get("username") or ""
    _init_app_db()
    with _db_connect() as conn:
        participant = conn.execute(
            "SELECT 1 FROM meeting_participants WHERE meeting_id = ? AND user_id = ? LIMIT 1",
            (safe_id, user_id),
        ).fetchone()
    if not participant:
        raise HTTPException(status_code=403, detail="只有本场参会人员可以签署会议级成果")
    return user, safe_id, meeting, None

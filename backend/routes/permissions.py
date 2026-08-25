"""全局角色与议题 ACL 路由。"""

from fastapi import APIRouter, HTTPException, Request

from backend.dependencies import require_agenda, require_user
from backend.db import _load_meetings, _safe_meeting_id
from backend.services.agenda_service import get_meeting_agenda, list_meeting_agendas
from backend.services.permission_service import (
    add_user_role,
    get_user_roles,
    grant_agenda_acl,
    list_agenda_acl,
    remove_user_role,
    revoke_agenda_acl,
)


router = APIRouter(prefix="/api", tags=["permissions"])


def _require_self_or_admin(user: dict, user_id: str):
    if user.get("role") != "admin" and user.get("id") != user_id:
        raise HTTPException(status_code=403, detail="只能查看自己的角色")


def _find_agenda_context(agenda_id: str):
    for meeting_id, meeting in _load_meetings().items():
        agenda = get_meeting_agenda(meeting_id, agenda_id)
        if agenda:
            return meeting_id, meeting, agenda
    return None, None, None


@router.get("/users/{user_id}/roles")
async def list_roles(request: Request, user_id: str):
    user = require_user(request)
    _require_self_or_admin(user, user_id)
    return {"success": True, "roles": get_user_roles(user_id)}


@router.post("/users/{user_id}/roles")
async def add_role(request: Request, user_id: str):
    user = require_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以管理全局角色")
    body = await request.json()
    role = str(body.get("role", "")).strip()
    try:
        roles = add_user_role(user_id, role, granted_by=user.get("username") or user.get("id") or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "roles": roles}


@router.delete("/users/{user_id}/roles/{role}")
async def remove_role(request: Request, user_id: str, role: str):
    user = require_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以管理全局角色")
    remove_user_role(user_id, role)
    return {"success": True, "roles": get_user_roles(user_id)}


@router.get("/agendas/{agenda_id}/acl")
async def list_acl(request: Request, agenda_id: str):
    require_agenda(request, _find_agenda_context(agenda_id)[0] or "", agenda_id, "admin")
    return {"success": True, "acl": list_agenda_acl(agenda_id)}


@router.post("/agendas/{agenda_id}/acl")
async def grant_acl(request: Request, agenda_id: str):
    body = await request.json()
    meeting_id = str(body.get("meetingId", "")).strip()
    target_user_id = str(body.get("userId", "")).strip()
    permission = str(body.get("permission", "view")).strip()
    if not meeting_id or not target_user_id:
        raise HTTPException(status_code=400, detail="缺少 meetingId 或 userId")
    user, safe_id, _, _ = require_agenda(request, meeting_id, agenda_id, "admin")
    try:
        acl = grant_agenda_acl(
            agenda_id,
            safe_id,
            target_user_id,
            permission,
            granted_by=user.get("name") or user.get("username") or "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "acl": acl}


@router.delete("/agendas/{agenda_id}/acl/{user_id}/{permission}")
async def revoke_acl(request: Request, agenda_id: str, user_id: str, permission: str):
    meeting_id, _, _ = _find_agenda_context(agenda_id)
    if not meeting_id:
        raise HTTPException(status_code=404, detail="议题不存在")
    require_agenda(request, meeting_id, agenda_id, "admin")
    revoke_agenda_acl(agenda_id, user_id, permission)
    return {"success": True}

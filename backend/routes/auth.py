"""认证与用户管理路由。"""
import json
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from backend.config import APP_DB, AUTH_SECRET, MEETINGS_LOCK
from backend.db import _load_users, _save_users, _default_users, _safe_meeting_id, _creator_from_user
from backend.deps import (
    _now_text, _today_text, _get_request_user, _require_admin,
    _issue_auth_token, _public_user, _save_departments, _load_departments,
    _hash_password, _verify_password, _needs_password_upgrade,
)
from backend.models import MeetingUpsertRequest

router = APIRouter(prefix="/api", tags=["auth"])


# ── models ──

class LoginRequest(BaseModel):
    username: str
    password: str
    meetingId: Optional[str] = None
    meetingTitle: Optional[str] = None
    agenda: Optional[str] = None
    meetingDate: Optional[str] = None
    roleLabel: Optional[str] = None


class MeetingRegisterRequest(BaseModel):
    meetingId: Optional[str] = None
    meetingTitle: Optional[str] = None
    meeting_id: Optional[str] = None    # 兼容前端 snake_case
    displayName: Optional[str] = None
    dept: Optional[str] = None
    meetingRole: Optional[str] = None
    meeting_role: Optional[str] = None  # 兼容前端 snake_case
    name: Optional[str] = None          # 兼容前端 name 字段
    password: Optional[str] = None
    username: Optional[str] = None
    meeting_seat: Optional[str] = None
    agenda: Optional[str] = None


class UserUpsertRequest(BaseModel):
    id: Optional[str] = None
    username: str
    password: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None
    dept: Optional[str] = None
    meetingRole: Optional[str] = None
    meetingSeat: Optional[str] = None
    is_meeting_participant: Optional[bool] = None
    lastLoginAt: Optional[str] = None


# ── auth routes ──

@router.post("/auth/login")
async def auth_login(body: LoginRequest):
    users = _load_users()
    user = next((u for u in users if u.get("username") == body.username), None)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    password = (body.password or "").strip()
    if not _verify_password(password, user.get("password", "")):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    # 自动升级：旧版明文密码首次登录时升级为 PBKDF2
    if _needs_password_upgrade(user.get("password", "")):
        user["password"] = _hash_password(password)
    user["lastLoginAt"] = _now_text()
    _save_users(users)
    token = _issue_auth_token(user)
    return {"success": True, "token": token, "user": _public_user(user)}


@router.post("/auth/meeting-register")
async def auth_meeting_register(body: MeetingRegisterRequest):
    # 兼容前端 snake_case 字段名
    meeting_id = body.meetingId or body.meeting_id or ""
    if not meeting_id:
        raise HTTPException(status_code=400, detail="缺少 meetingId")
    safe_id = _safe_meeting_id(meeting_id)
    display = body.displayName or body.name or f"参会人_{safe_id[-6:]}"
    dept = body.dept or "参会部门"
    role = body.meetingRole or body.meeting_role or "参会代表"
    raw_password = (body.password or "").strip()
    users = _load_users()
    user_id = f"participant_{safe_id[:16]}"
    existing = next((u for u in users if u.get("id") == user_id), None)
    if existing:
        existing["lastLoginAt"] = _now_text()
        if raw_password:
            existing["password"] = _hash_password(raw_password)
        _save_users(users)
        token = _issue_auth_token(existing)
        return {"success": True, "token": token, "user": _public_user(existing)}
    new_user = {
        "id": user_id, "username": display, "name": display, "role": "participant",
        "dept": dept, "meetingRole": role, "meetingSeat": "移动端席位",
        "password": _hash_password(raw_password) if raw_password else _hash_password("123456"),
        "createdAt": _now_text(), "lastLoginAt": _now_text(),
    }
    users.append(new_user)
    _save_users(users)
    token = _issue_auth_token(new_user)
    return {"success": True, "token": token, "user": _public_user(new_user)}


@router.get("/auth/me")
async def auth_me(request: Request):
    user = _get_request_user(request, required=True)
    return {"success": True, "user": _public_user(user)}


# ── user management ──

@router.get("/users")
async def list_users(request: Request):
    _require_admin(request)
    return {"success": True, "users": [_public_user(u) for u in _load_users()]}


@router.post("/users")
async def create_user(request: Request, body: UserUpsertRequest):
    _require_admin(request)
    users = _load_users()
    if any(u.get("username") == body.username for u in users):
        raise HTTPException(status_code=400, detail="用户名已存在")
    new_user = {
        "id": body.id or f"u_{body.username}", "username": body.username,
        "name": body.name or body.username, "role": body.role or "user",
        "dept": body.dept or "", "meetingRole": body.meetingRole or "",
        "meetingSeat": body.meetingSeat or "", "createdAt": _now_text(),
        "lastLoginAt": "",
    }
    if body.password:
        new_user["password"] = _hash_password(body.password)
    users.append(new_user)
    _save_users(users)
    return {"success": True, "user": _public_user(new_user)}


# ── departments ──

@router.get("/departments")
async def list_departments(request: Request):
    _get_request_user(request, required=True)
    return {"success": True, "departments": _load_departments()}


@router.post("/departments")
async def create_department(request: Request):
    _require_admin(request)
    body = await request.json()
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="部门名称不能为空")
    depts = _load_departments()
    if any(d.get("name") == name for d in depts):
        raise HTTPException(status_code=400, detail="部门已存在")
    depts.append({"id": f"dept_{len(depts)+1:03d}", "name": name})
    _save_departments(depts)
    return {"success": True, "departments": depts}


@router.put("/departments/{dept_id}")
async def rename_department(request: Request, dept_id: str):
    _require_admin(request)
    body = await request.json()
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="名称不能为空")
    depts = _load_departments()
    target = next((d for d in depts if d.get("id") == dept_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="部门不存在")
    old_name = target["name"]
    target["name"] = name
    _save_departments(depts)
    # 同步用户部门
    users = _load_users()
    for u in users:
        if u.get("dept") == old_name:
            u["dept"] = name
    _save_users(users)
    return {"success": True, "departments": depts}


@router.delete("/departments/{dept_id}")
async def delete_department(request: Request, dept_id: str):
    _require_admin(request)
    depts = _load_departments()
    target = next((d for d in depts if d.get("id") == dept_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="部门不存在")
    users = _load_users()
    if any(u.get("dept") == target["name"] for u in users):
        raise HTTPException(status_code=400, detail="该部门下还有用户，无法删除")
    depts = [d for d in depts if d.get("id") != dept_id]
    _save_departments(depts)
    return {"success": True, "departments": depts}

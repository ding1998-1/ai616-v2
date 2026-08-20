"""认证与用户管理路由。"""
import json
import random
import string
import uuid
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
    display = (body.displayName or body.name or "").strip()
    if not display:
        display = f"参会人_{safe_id[-6:]}"
    dept = body.dept or "参会部门"
    role = body.meetingRole or body.meeting_role or "参会代表"
    seat = body.meeting_seat or "移动端席位"
    raw_password = (body.password or "").strip()
    if raw_password and len(raw_password) < 6:
        raise HTTPException(status_code=400, detail="密码长度至少 6 位")
    users = _load_users()

    # ── 唯一身份：participant_{meeting}_{seq}，同一场会议的参与者各自独立 ──
    prefix = f"participant_{safe_id[:16]}"
    same_meeting = [u for u in users if u.get("id", "").startswith(prefix)]
    existing = next(
        (u for u in same_meeting if (u.get("username") == display or u.get("name") == display)),
        None,
    )
    if existing:
        # 已有身份：必须验证密码，禁止任何请求直接重置他人密码
        if not raw_password:
            raise HTTPException(status_code=401, detail="请输入密码")
        if not _verify_password(raw_password, existing.get("password", "")):
            raise HTTPException(status_code=401, detail="密码错误，请使用首次注册时设置的密码")
        existing["lastLoginAt"] = _now_text()
        _save_users(users)
        token = _issue_auth_token(existing)
        _sync_meeting_participant(safe_id, existing, role, dept, seat)
        return {"success": True, "token": token, "user": _public_user(existing)}

    # ── 新身份：禁止默认 123456；未设置密码则签发随机一次性密码（仅返回一次） ──
    one_time_password = None
    if not raw_password:
        one_time_password = _random_credential()
        raw_password = one_time_password
    seq = len(same_meeting) + 1
    user_id = f"{prefix}_{seq:03d}"
    if any(u.get("id") == user_id for u in users):
        user_id = f"{prefix}_{seq:03d}_{uuid.uuid4().hex[:4]}"
    new_user = {
        "id": user_id, "username": display, "name": display, "role": "participant",
        "dept": dept, "meetingRole": role, "meetingSeat": seat,
        "password": _hash_password(raw_password),
        "createdAt": _now_text(), "lastLoginAt": _now_text(),
    }
    users.append(new_user)
    _save_users(users)
    token = _issue_auth_token(new_user)
    _sync_meeting_participant(safe_id, new_user, role, dept, seat)
    resp = {"success": True, "token": token, "user": _public_user(new_user)}
    if one_time_password:
        # 一次性凭据仅此响应返回，前端应提示用户保存
        resp["oneTimePassword"] = one_time_password
    return resp


@router.get("/auth/me")
async def auth_me(request: Request):
    user = _get_request_user(request, required=True)
    return {"success": True, "user": _public_user(user)}


def _random_credential(length: int = 8) -> str:
    """生成随机一次性凭据（数字+字母，避免易混淆字符）。"""
    alphabet = "23456789abcdefghjkmnpqrstuvwxyz"
    return "".join(random.choice(alphabet) for _ in range(length))


def _sync_meeting_participant(meeting_id: str, user: dict, meeting_role: str, dept: str, seat: str):
    """将参会人写入 meeting_participants（本场参会人的真实来源）。

    user → meeting_participant：每人每场一条记录，row_id 稳定，可幂等 upsert。
    """
    from backend.db import _db_connect, _init_app_db
    _init_app_db()
    user_id = user.get("id", "")
    row_id = f"p_{meeting_id[:20]}_{user_id[-16:]}"
    now = _now_text()
    payload = json.dumps({
        "user_id": user_id,
        "meeting_role": meeting_role,
        "seat": seat,
        "dept": dept,
    }, ensure_ascii=False)
    try:
        with _db_connect() as conn:
            conn.execute(
                """
                INSERT INTO meeting_participants
                    (row_id, meeting_id, user_id, username, display_name, meeting_role, seat, dept, last_action, last_seen_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(row_id) DO UPDATE SET
                    meeting_role = excluded.meeting_role,
                    seat = excluded.seat,
                    dept = excluded.dept,
                    last_action = excluded.last_action,
                    last_seen_at = excluded.last_seen_at,
                    payload_json = excluded.payload_json
                """,
                (
                    row_id, meeting_id, user_id,
                    user.get("username", ""), user.get("name", "") or user.get("username", ""),
                    meeting_role, seat, dept, "register", now, payload,
                ),
            )
    except Exception:
        # 参会人落库失败不应阻断注册
        pass


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

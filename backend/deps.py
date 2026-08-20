"""共享依赖——供 route 模块和 backend_full.py 共同使用，避免循环导入。"""
import os, re, uuid, json, time as _time
from datetime import datetime
from typing import Optional, List, Dict, Any

import jwt
from fastapi import Request, HTTPException
from .config import AUTH_SECRET, APP_DB, MEETINGS_DB, MEETING_TRANSCRIPTS_DB, MAX_UPLOAD_BYTES
from .db import (
    _load_meetings, _save_meetings, _load_users, _save_users,
    _load_meeting_transcripts, _db_load_transcripts_for_meeting,
    _db_upsert_transcript, _invalidate_transcripts_cache,
    _safe_meeting_id, _check_meeting_access, _creator_from_user,
    _default_agenda_drafts, _phase_color, _normalize_meeting,
    _maybe_checkpoint_wal, _json_dumps,
    _clean_agenda_check_transcript,
)
from .models import MeetingUpsertRequest


# ═══════════════════════════════════════════════════════════
# 密码哈希
# ═══════════════════════════════════════════════════════════
import hashlib as _hashlib
_PBKDF2_ITERATIONS = 600_000
_HASH_ALGO = "sha256"

def _hash_password(password: str) -> str:
    """PBKDF2-SHA256 哈希，格式: $pbkdf2-sha256$iterations$salt$hash"""
    salt = os.urandom(16)
    dk = _hashlib.pbkdf2_hmac(_HASH_ALGO, password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"$pbkdf2-{_HASH_ALGO}${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"

def _verify_password(password: str, stored: str) -> bool:
    """验证密码。若 stored 不以 $pbkdf2 开头，视为旧版明文直接比对。"""
    if not stored or not password:
        return False
    if not stored.startswith("$pbkdf2-"):
        # 旧版明文密码 — 验证后返回 True（登录时自动升级哈希）
        return password == stored
    try:
        parts = stored.split("$")
        # parts[0]="", parts[1]="pbkdf2-sha256", parts[2]=iterations, parts[3]=salt, parts[4]=hash
        algo = parts[1].replace("pbkdf2-", "")
        iterations = int(parts[2])
        salt = bytes.fromhex(parts[3])
        expected = parts[4]
        dk = _hashlib.pbkdf2_hmac(algo, password.encode("utf-8"), salt, iterations)
        return dk.hex() == expected
    except Exception:
        return False

def _needs_password_upgrade(stored: str) -> bool:
    """密码是否仍是明文，需要升级为 PBKDF2"""
    return bool(stored) and not stored.startswith("$pbkdf2-")

# ═══════════════════════════════════════════════════════════
# 时间工具
# ═══════════════════════════════════════════════════════════

def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today_text() -> str:
    return datetime.now().strftime("%Y-%m-%d")


# ═══════════════════════════════════════════════════════════
# 网络工具
# ═══════════════════════════════════════════════════════════

def _get_public_host() -> str:
    return os.environ.get("PUBLIC_HOST", "").strip() or os.environ.get("BACKEND_PUBLIC_HOST", "").strip()


def _get_browser_backend_base(request: Request) -> str:
    host = _get_public_host()
    if host:
        scheme = "https" if host.startswith("https://") else "http"
        return f"{scheme}://{host.replace('https://', '').replace('http://', '').strip('/')}"
    forwarded = request.headers.get("x-forwarded-proto", request.url.scheme or "http")
    host_header = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost")
    return f"{forwarded}://{host_header}"


# ═══════════════════════════════════════════════════════════
# 认证工具
# ═══════════════════════════════════════════════════════════

def _issue_auth_token(user: dict) -> str:
    payload = {
        "sub": user.get("id", ""),
        "username": user.get("username", ""),
        "role": user.get("role", "user"),
        "iat": int(_time.time()),
        "jti": str(uuid.uuid4()),
        "exp": int(_time.time()) + 86400 * 1,  # 24h，商业产品标准
    }
    return jwt.encode(payload, AUTH_SECRET, algorithm="HS256")


def _get_user_from_auth_token(token: str, required: bool = False) -> Optional[dict]:
    try:
        payload = jwt.decode(token, AUTH_SECRET, algorithms=["HS256"])
        user_id = payload.get("sub", "")
        token_role = payload.get("role", "")
        for u in _load_users():
            if u.get("id") == user_id:
                # 如果用户角色自令牌签发后已变更，拒绝令牌
                if token_role and u.get("role") != token_role:
                    raise HTTPException(status_code=401, detail="用户权限已变更，请重新登录")
                return u
    except HTTPException:
        raise
    except Exception:
        pass
    if required:
        raise HTTPException(status_code=401, detail="未登录或令牌无效")
    return None


def _get_request_user(request: Request, required: bool = False) -> Optional[dict]:
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else request.query_params.get("token", "")
    if token:
        return _get_user_from_auth_token(token, required=required)
    if required:
        raise HTTPException(status_code=401, detail="未登录")
    return None


def _require_admin(request: Request) -> dict:
    user = _get_request_user(request, required=True)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


def _public_user(user: dict) -> dict:
    return {
        "id": user.get("id"), "username": user.get("username"),
        "name": user.get("name", ""), "role": user.get("role", "user"),
        "dept": user.get("dept", ""), "meetingRole": user.get("meetingRole", ""),
        "meetingSeat": user.get("meetingSeat", ""), "lastLoginAt": user.get("lastLoginAt", ""),
    }


# ═══════════════════════════════════════════════════════════
# 会议工具
# ═══════════════════════════════════════════════════════════

def _resolve_meeting_role(user: dict) -> dict:
    is_admin = user.get("role") == "admin"
    return {
        "displayName": user.get("name") or user.get("username") or "参会人",
        "meetingRole": user.get("meetingRole") or ("会议管理员" if is_admin else "参会代表"),
        "seat": user.get("meetingSeat") or ("主控席" if is_admin else "移动端席位"),
        "userId": user.get("id"), "username": user.get("username"),
        "dept": user.get("dept") or "参会部门", "systemRole": user.get("role"),
    }


def _build_meeting_from_request(body: MeetingUpsertRequest, user: dict, existing: Optional[dict] = None, explicit_fields: Optional[dict] = None) -> dict:
    now = _now_text()
    meeting_id = _safe_meeting_id(body.id or (existing or {}).get("id"))
    project_code = body.projectCode or body.project_code or (existing or {}).get("projectCode") or f"LOCAL-{datetime.now().strftime('%Y%m%d')}-001"
    issue_sources = body.issueSources if isinstance(body.issueSources, list) else (existing or {}).get("issueSources") or []
    agenda_drafts = body.agendaDrafts if isinstance(body.agendaDrafts, list) else (existing or {}).get("agendaDrafts") or []
    agenda = body.agenda or (existing or {}).get("agenda") or "待确认议题"
    project = body.project or (existing or {}).get("project") or "本地项目"
    raw_body = explicit_fields if explicit_fields is not None else body.dict(exclude_unset=True)
    meeting_mode = raw_body.get("meetingMode") or raw_body.get("meeting_mode") or (existing or {}).get("meetingMode") or "normal"
    if not agenda_drafts:
        agenda_drafts = _default_agenda_drafts(project, agenda)[:1]
    return {
        **(existing or {}),
        "id": meeting_id, "title": body.title or (existing or {}).get("title") or f"{project}专题会",
        "project": project, "projectCode": project_code, "agenda": agenda,
        "date": body.date or (existing or {}).get("date") or _today_text(),
        "type": body.type or (existing or {}).get("type") or "普通企业会议",
        "meetingNo": raw_body.get("meetingNo") or (existing or {}).get("meetingNo") or "",
        "requireFullSignature": bool(raw_body.get("requireFullSignature", (existing or {}).get("requireFullSignature", False))),
        "meetingMode": meeting_mode if meeting_mode in {"normal", "major"} else "normal",
        "creator": body.creator or (existing or {}).get("creator") or _creator_from_user(user),
        "createdAt": (existing or {}).get("createdAt") or now,
        "phase": body.phase or (existing or {}).get("phase") or "问题收集中",
        "issueSources": issue_sources, "agendaDrafts": agenda_drafts,
        "materials": body.materials if isinstance(body.materials, list) else (existing or {}).get("materials") or [],
        "events": (existing or {}).get("events") or [],
        "archived": bool((existing or {}).get("archived", False)),
        "projectBound": bool((existing or {}).get("projectBound", False)),
        "agendaFrozen": bool((existing or {}).get("agendaFrozen", False)),
        "reviewDone": bool((existing or {}).get("reviewDone", False)),
        "archiveDone": bool((existing or {}).get("archiveDone", False)),
        "updatedAt": now,
    }


def _append_meeting_activity_light(meeting_id: str, event: dict):
    """轻量写入事件——不触发 meeting 全量保存。"""
    from .db import _db_connect, _db_insert_transcript_row, _init_app_db
    _init_app_db()
    event.setdefault("id", f"evt_{uuid.uuid4().hex[:10]}")
    event.setdefault("serverTime", _now_text())
    with _db_connect() as conn:
        conn.execute(
            "INSERT INTO meeting_events (id, meeting_id, type, server_time, payload_json, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            (event["id"], meeting_id, event.get("type", ""), event["serverTime"], _json_dumps(event), 0),
        )
        # 自动裁剪旧事件
        conn.execute(
            "DELETE FROM meeting_events WHERE meeting_id = ? AND id NOT IN (SELECT id FROM meeting_events WHERE meeting_id = ? ORDER BY sort_order, server_time DESC LIMIT 2000)",
            (meeting_id, meeting_id),
        )


# ═══════════════════════════════════════════════════════════
# 部门管理
# ═══════════════════════════════════════════════════════════

def _save_departments(data: List[dict]):
    path = APP_DB.parent / "departments.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_departments() -> List[dict]:
    path = APP_DB.parent / "departments.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return [{"id": "dept_001", "name": "总经理办公室"}, {"id": "dept_002", "name": "项目管理部"}, {"id": "dept_003", "name": "审计监察部"}]
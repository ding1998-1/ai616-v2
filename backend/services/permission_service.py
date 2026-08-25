"""权限服务（backend/services/permission_service.py）

§25-26 多角色：user_roles（用户可同时拥有董事/股东/高管等多个全局角色）
§57-59 保密议题：agenda_acl（view/edit/sign/admin 四级），保密议题在 API 层过滤
（前端 CSS 隐藏禁止——内容根本不下发）。
"""
import json
import uuid
from datetime import datetime

from backend.config import APP_DB_LOCK
from backend.db import _db_connect, _init_app_db

# 保密级别：normal 所有人可见；其余级别需要授权
SECRET_LEVELS = {"internal", "confidential", "secret"}
ACL_PERMISSIONS = {"view", "edit", "sign", "admin"}


def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _json_loads(text: str, default):
    try:
        return json.loads(text) if text else default
    except Exception:
        return default


# ────────────────────────────────────────────────────────────────
# user_roles：全局多角色
# ────────────────────────────────────────────────────────────────

def get_user_roles(user_id: str) -> list:
    """用户全局角色列表（董事/股东/党委委员/高管/项目负责人/普通员工）。"""
    _init_app_db()
    if not user_id:
        return []
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                "SELECT role, granted_at, payload_json FROM user_roles WHERE user_id = ? ORDER BY granted_at",
                (user_id,),
            ).fetchall()
    return [{"role": r["role"], "grantedAt": r["granted_at"], "payload": _json_loads(r["payload_json"], {})} for r in rows]


def add_user_role(user_id: str, role: str, granted_by: str = "") -> list:
    """为用户添加一个全局角色。"""
    _init_app_db()
    if not user_id or not role:
        raise ValueError("user_id 与 role 不能为空")
    now = _now_text()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO user_roles (user_id, role, granted_at, granted_by, payload_json)
                   VALUES (?, ?, ?, ?, '{}')""",
                (user_id, role, now, granted_by),
            )
    return get_user_roles(user_id)


def remove_user_role(user_id: str, role: str):
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute("DELETE FROM user_roles WHERE user_id = ? AND role = ?", (user_id, role))


# ────────────────────────────────────────────────────────────────
# agenda_acl：议题级访问控制（§58）
# ────────────────────────────────────────────────────────────────

def list_agenda_acl(agenda_id: str) -> list:
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                "SELECT user_id, permission, granted_at FROM agenda_acl WHERE agenda_id = ? ORDER BY permission, granted_at",
                (agenda_id,),
            ).fetchall()
    return [{"userId": r["user_id"], "permission": r["permission"], "grantedAt": r["granted_at"]} for r in rows]


def grant_agenda_acl(agenda_id: str, meeting_id: str, user_id: str, permission: str = "view", granted_by: str = "") -> list:
    """授予某用户对议题的访问权限（view/edit/sign/admin）。"""
    _init_app_db()
    if permission not in ACL_PERMISSIONS:
        raise ValueError(f"不支持的权限: {permission}")
    now = _now_text()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO agenda_acl (agenda_id, meeting_id, user_id, permission, granted_at, payload_json)
                   VALUES (?, ?, ?, ?, ?, '{}')""",
                (agenda_id, meeting_id, user_id, permission, now),
            )
    return list_agenda_acl(agenda_id)


def revoke_agenda_acl(agenda_id: str, user_id: str, permission: str = "view"):
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                "DELETE FROM agenda_acl WHERE agenda_id = ? AND user_id = ? AND permission = ?",
                (agenda_id, user_id, permission),
            )


def _acl_permissions_for(user_id: str, agenda_id: str) -> set:
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                "SELECT permission FROM agenda_acl WHERE agenda_id = ? AND user_id = ?",
                (agenda_id, user_id),
            ).fetchall()
    return {r["permission"] for r in rows}


def can_view_agenda(user: dict, meeting: dict, agenda: dict) -> bool:
    """保密议题的 API 层访问判断（§57：后端过滤，非前端隐藏）。

    可见条件（任一）：
    1. 议题保密级别为 normal
    2. 管理员
    3. 会议主持人/秘书（本场治理者）
    4. 拥有该议题 view 及以上 ACL
    """
    if not agenda:
        return False
    level = agenda.get("confidentialityLevel") or "normal"
    if level not in SECRET_LEVELS:
        return True
    if not user:
        return False
    if user.get("role") == "admin":
        return True
    mr = (user.get("meetingRole") or "").strip()
    if mr in {"主持人", "会议秘书", "秘书", "host", "secretary"}:
        return True
    perms = _acl_permissions_for(user.get("id") or "", agenda.get("id") or "")
    return bool(perms)


def has_agenda_permission(user: dict, meeting: dict, agenda: dict, required: str = "view") -> bool:
    """统一议题子资源权限判断：view/edit/sign/admin。"""
    if not agenda or required not in ACL_PERMISSIONS:
        return False
    if user and user.get("role") == "admin":
        return True
    meeting_role = (user or {}).get("meetingRole") or (user or {}).get("role") or ""
    is_governor = meeting_role.strip() in {"主持人", "会议秘书", "秘书", "host", "secretary"}
    if is_governor:
        return True
    if required == "view" and can_view_agenda(user, meeting, agenda):
        return True
    perms = _acl_permissions_for((user or {}).get("id") or "", agenda.get("id") or "")
    if "admin" in perms:
        return True
    if required == "view":
        return bool(perms & {"view", "edit", "sign"})
    if required == "edit":
        return bool(perms & {"edit"})
    if required == "sign":
        return bool(perms & {"sign"})
    return False


def filter_agendas_for_user(user: dict, meeting: dict, agendas: list) -> list:
    """过滤保密议题：无权限的保密议题不下发内容，替换为脱敏占位（保留 ID 以便前端感知存在）。"""
    visible = []
    for agenda in agendas:
        if can_view_agenda(user, meeting, agenda):
            visible.append(agenda)
        else:
            stripped = dict(agenda)
            stripped["title"] = "（保密议题）"
            stripped["description"] = ""
            stripped["confidentialityLevel"] = agenda.get("confidentialityLevel") or "secret"
            stripped["proposerUserId"] = ""
            stripped["ownerUserId"] = ""
            stripped["payload"] = {}
            stripped["restricted"] = True
            visible.append(stripped)
    return visible

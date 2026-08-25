"""用户管理服务：账号资料更新、密码升级和安全删除。"""

from backend.db import _load_users, _save_users
from backend.deps import _hash_password, _public_user


def update_user(user_id: str, body: dict) -> dict:
    users = _load_users()
    target_index = next((index for index, item in enumerate(users) if item.get("id") == user_id), None)
    if target_index is None:
        raise KeyError("用户不存在")
    username = str(body.get("username") or "").strip()
    if not username:
        raise ValueError("用户名不能为空")
    if any(item.get("username") == username and item.get("id") != user_id for item in users):
        raise ValueError("用户名已存在")
    current = users[target_index]
    updated = {
        **current,
        "username": username,
        "name": str(body.get("name") or current.get("name") or username).strip(),
        "role": str(body.get("role") or current.get("role") or "user").strip(),
        "dept": str(body.get("dept") or current.get("dept") or "").strip(),
        "status": str(body.get("status") or current.get("status") or "active").strip(),
        "meetingRole": str(body.get("meetingRole") if body.get("meetingRole") is not None else current.get("meetingRole", "参会代表")),
        "meetingSeat": str(body.get("meetingSeat") if body.get("meetingSeat") is not None else current.get("meetingSeat", "")),
    }
    password = str(body.get("password") or "").strip()
    if password:
        if len(password) < 6:
            raise ValueError("密码长度至少 6 位")
        updated["password"] = _hash_password(password)
    users[target_index] = updated
    _save_users(users)
    return _public_user(updated)


def delete_user(user_id: str, current_user: dict) -> None:
    if current_user.get("id") == user_id:
        raise ValueError("不能删除当前登录管理员")
    users = _load_users()
    filtered = [item for item in users if item.get("id") != user_id]
    if len(filtered) == len(users):
        raise KeyError("用户不存在")
    _save_users(filtered)

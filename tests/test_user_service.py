from backend.services import user_service
from backend.routes import auth as auth_routes


def test_update_user_hashes_new_password_and_preserves_role(monkeypatch):
    users = [{"id": "u1", "username": "alice", "name": "Alice", "role": "user", "password": "old"}]
    saved = []
    monkeypatch.setattr(user_service, "_load_users", lambda: users)
    monkeypatch.setattr(user_service, "_save_users", lambda value: saved.append(value))
    monkeypatch.setattr(user_service, "_hash_password", lambda value: f"hashed:{value}")

    public = user_service.update_user("u1", {"username": "alice", "name": "Alice 2", "role": "secretary", "password": "newpass"})
    assert public["name"] == "Alice 2"
    assert public["status"] == "active"
    assert users[0]["password"] == "hashed:newpass"
    assert users[0]["role"] == "secretary"
    assert saved


def test_delete_user_cannot_remove_current_account(monkeypatch):
    monkeypatch.setattr(user_service, "_load_users", lambda: [{"id": "u1"}])
    monkeypatch.setattr(user_service, "_save_users", lambda value: None)
    try:
        user_service.delete_user("u1", {"id": "u1"})
    except ValueError as exc:
        assert "当前登录管理员" in str(exc)
    else:
        raise AssertionError("expected current-account deletion to be blocked")


def test_disabled_user_cannot_login(monkeypatch):
    monkeypatch.setattr(auth_routes, "_load_users", lambda: [{"id": "u1", "username": "alice", "status": "disabled", "password": "secret"}])
    import asyncio

    try:
        asyncio.run(auth_routes.auth_login(auth_routes.LoginRequest(username="alice", password="secret")))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 403
    else:
        raise AssertionError("expected disabled account login to be blocked")


def test_disabled_user_token_is_rejected(monkeypatch):
    monkeypatch.setattr(auth_routes, "_load_users", lambda: [{"id": "u1", "username": "alice", "role": "staff", "status": "disabled"}])
    monkeypatch.setattr(auth_routes, "AUTH_SECRET", "local-secret")
    monkeypatch.setattr(auth_routes, "_issue_auth_token", lambda user: "token")
    import backend.deps as deps
    monkeypatch.setattr(deps, "AUTH_SECRET", "local-secret")
    import jwt
    token = jwt.encode({"sub": "u1", "role": "staff"}, "local-secret", algorithm="HS256")
    try:
        deps._get_user_from_auth_token(token, required=True)
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401
    else:
        raise AssertionError("expected disabled account token to be rejected")


def test_external_meeting_login_binds_existing_account(monkeypatch):
    import asyncio

    user = {
        "id": "u1", "username": "alice", "name": "Alice", "role": "user",
        "status": "active", "password": "hashed", "dept": "项目部",
    }
    bindings = []
    monkeypatch.setattr(auth_routes, "_load_users", lambda: [user])
    monkeypatch.setattr(auth_routes, "_save_users", lambda value: None)
    monkeypatch.setattr(auth_routes, "_verify_password", lambda *_: True)
    monkeypatch.setattr(auth_routes, "_needs_password_upgrade", lambda *_: False)
    monkeypatch.setattr(auth_routes, "_load_meetings", lambda: {"meeting-1": {"id": "meeting-1"}})
    monkeypatch.setattr(auth_routes, "_sync_meeting_participant", lambda *args: bindings.append(args))
    monkeypatch.setattr(auth_routes, "_issue_auth_token", lambda _: "token")

    result = asyncio.run(auth_routes.auth_login(auth_routes.LoginRequest(
        username="alice", password="secret", meetingId="meeting-1", roleLabel="参会代表",
    )))

    assert result["token"] == "token"
    assert bindings[0][0] == "meeting-1"
    assert bindings[0][1]["id"] == "u1"

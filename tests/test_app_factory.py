from fastapi.testclient import TestClient

import pytest

from backend.app_factory import create_core_app
from backend.db import _load_users
from backend.deps import _issue_auth_token


def test_core_app_registers_health_and_user_routes():
    app = create_core_app()
    admin = next(user for user in _load_users() if user.get("username") == "admin")
    token = _issue_auth_token(admin)
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["checks"]["db"] == "ok"
        users = client.get("/api/users", headers=headers)
        assert users.status_code == 200
        assert isinstance(users.json()["users"], list)


def test_new_user_requires_password_and_can_login_immediately(monkeypatch):
    from backend.routes import auth as auth_routes

    stored_users = [{
        "id": "u_admin", "username": "admin", "name": "管理员",
        "role": "admin", "dept": "信息管理中心", "status": "active",
        "password": auth_routes._hash_password("admin-password"),
    }]
    monkeypatch.setattr(auth_routes, "_load_users", lambda: stored_users)
    monkeypatch.setattr(auth_routes, "_save_users", lambda users: stored_users.__setitem__(slice(None), users))

    app = create_core_app()
    token = _issue_auth_token(stored_users[0])
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as client:
        missing_password = client.post(
            "/api/users",
            headers=headers,
            json={"username": "new-user", "name": "新用户", "role": "staff", "dept": "业务部"},
        )
        assert missing_password.status_code == 400

        created = client.post(
            "/api/users",
            headers=headers,
            json={
                "username": "new-user", "password": "new-password",
                "name": "新用户", "role": "staff", "dept": "业务部", "status": "active",
            },
        )
        assert created.status_code == 200
        login = client.post("/api/auth/login", json={"username": "new-user", "password": "new-password"})
        assert login.status_code == 200
        assert login.json()["user"]["username"] == "new-user"


def test_main_entry_uses_factory_routes_once(monkeypatch):
    monkeypatch.setenv("APP_AUTH_SECRET", "local-test-secret-not-for-production-32chars")
    from backend import main

    paths = [route.path for route in main.app.routes]
    assert paths.count("/health") == 1
    assert "/" in paths
    assert not any("editor_page" in path or "callback" in path for path in paths)

    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200


def test_main_entry_rejects_missing_auth_secret(monkeypatch):
    monkeypatch.delenv("APP_AUTH_SECRET", raising=False)
    from backend import config, main

    monkeypatch.setattr(config, "AUTH_SECRET", "", raising=False)
    with pytest.raises(RuntimeError, match="APP_AUTH_SECRET is required"):
        with TestClient(main.app):
            pass


def test_optional_knowledge_prewarm_failure_does_not_block_api(monkeypatch):
    monkeypatch.setenv("APP_AUTH_SECRET", "local-test-secret-not-for-production-32chars")
    monkeypatch.setenv("KNOWLEDGE_PREWARM", "1")
    from backend import main

    def fail_prewarm():
        raise RuntimeError("optional vector dependency unavailable")

    monkeypatch.setattr(main, "_prewarm_knowledge", fail_prewarm)
    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200

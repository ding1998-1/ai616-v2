"""ASR route registration and authentication contract tests."""

from fastapi.testclient import TestClient

from backend.app_factory import create_core_app
from backend.db import _load_users
from backend.deps import _issue_auth_token


def test_modular_app_registers_both_asr_websockets():
    app = create_core_app()
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/meeting/asr/ws" in paths
    assert "/api/meeting/asr/qwen/ws" in paths
    assert "/api/meeting/asr/2pass/ws" in paths


def test_asr_websockets_reject_missing_token_before_upstream_connection():
    app = create_core_app()
    with TestClient(app) as client:
        for path in ("/api/meeting/asr/ws", "/api/meeting/asr/qwen/ws", "/api/meeting/asr/2pass/ws"):
            with client.websocket_connect(path) as websocket:
                message = websocket.receive_json()
                assert message == {"type": "error", "message": "未登录或令牌无效"}


def test_asr_websockets_reject_missing_meeting_id_before_model_connection():
    app = create_core_app()
    admin = next(user for user in _load_users() if user.get("username") == "admin")
    token = _issue_auth_token(admin)
    with TestClient(app) as client:
        for path in ("/api/meeting/asr/ws", "/api/meeting/asr/qwen/ws", "/api/meeting/asr/2pass/ws"):
            with client.websocket_connect(f"{path}?token={token}") as websocket:
                message = websocket.receive_json()
                assert message == {"type": "error", "message": "会议链接缺少会议 ID"}

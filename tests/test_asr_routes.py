"""ASR route registration and authentication contract tests."""

from fastapi.testclient import TestClient

from backend.app_factory import create_core_app


def test_modular_app_registers_both_asr_websockets():
    app = create_core_app()
    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/meeting/asr/ws" in paths
    assert "/api/meeting/asr/qwen/ws" in paths


def test_asr_websockets_reject_missing_token_before_upstream_connection():
    app = create_core_app()
    with TestClient(app) as client:
        for path in ("/api/meeting/asr/ws", "/api/meeting/asr/qwen/ws"):
            with client.websocket_connect(path) as websocket:
                message = websocket.receive_json()
                assert message == {"type": "error", "message": "未登录或令牌无效"}

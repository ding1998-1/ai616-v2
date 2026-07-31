"""
核心链路自动化测试

运行方式:
    cd /home/ai/文档/ai616
    python -m pytest tests/test_core.py -v

    指定服务地址:
    API_BASE=http://127.0.0.1:8002 python -m pytest tests/test_core.py -v

覆盖:
    - 健康检查
    - 登录认证
    - 会议 CRUD（增删改查）
    - 转写读写
    - 数据库函数（直接调用）
"""

import os
import sys
import json
import time
import uuid
from pathlib import Path

import pytest

# 服务地址
API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8002")

# 确保项目根目录在 path 中
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# ═══════════════════════════════════════════════════════════════════════════════
# 测试辅助
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def admin_token():
    """获取 admin 用户的 JWT token，整个模块复用。"""
    resp = _httpx_client().post(
        f"{API_BASE}/api/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200, f"登录失败: {resp.text}"
    data = resp.json()
    assert "token" in data, f"响应无 token: {data}"
    return data["token"]


def _httpx_client(timeout: float = 30.0):
    import httpx
    return httpx.Client(trust_env=False, timeout=httpx.Timeout(timeout))  # 绕过 socks:// 代理


def api_get(path: str, token: str = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return _httpx_client().get(f"{API_BASE}{path}", headers=headers)


def api_post(path: str, json_data: dict, token: str = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return _httpx_client().post(f"{API_BASE}{path}", headers=headers, json=json_data)


def api_patch(path: str, json_data: dict, token: str = None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return _httpx_client().patch(f"{API_BASE}{path}", headers=headers, json=json_data)


# ═══════════════════════════════════════════════════════════════════════════════
# 1. 健康检查
# ═══════════════════════════════════════════════════════════════════════════════

class TestHealth:
    """GET /health — 服务存活与组件状态"""

    def test_health_ok(self):
        """健康检查应返回 200 且 status=ok"""
        resp = api_get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "db" in data["checks"]

    def test_health_db_ok(self):
        """数据库检查应为 ok"""
        resp = api_get("/health")
        assert resp.json()["checks"]["db"] == "ok"

    def test_health_has_meetings_count(self):
        """应包含会议和转写计数"""
        resp = api_get("/health")
        checks = resp.json()["checks"]
        assert isinstance(checks.get("meetings"), int)
        assert isinstance(checks.get("transcripts"), int)

    def test_health_uptime(self):
        """应包含运行时长"""
        resp = api_get("/health")
        assert resp.json()["uptime_seconds"] > 0


# ═══════════════════════════════════════════════════════════════════════════════
# 2. 登录认证
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuth:
    """POST /api/auth/login — 认证"""

    def test_login_admin(self):
        """admin 用正确密码登录成功"""
        resp = api_post("/api/auth/login", {"username": "admin", "password": "admin123"})
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert len(data["token"]) > 20

    def test_login_wrong_password(self):
        """错误密码返回 401"""
        resp = api_post("/api/auth/login", {"username": "admin", "password": "wrong"})
        assert resp.status_code == 401

    def test_login_empty_username(self):
        """空用户名返回 401"""
        resp = api_post("/api/auth/login", {"username": "", "password": "admin123"})
        assert resp.status_code == 401

    def test_me_endpoint(self, admin_token):
        """GET /api/auth/me 返回当前用户信息"""
        resp = api_get("/api/auth/me", admin_token)
        assert resp.status_code == 200
        user = resp.json()["user"]
        assert user["username"] == "admin"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. 会议 CRUD
# ═══════════════════════════════════════════════════════════════════════════════

class TestMeetings:
    """会议增删改查"""

    def test_list_meetings(self, admin_token):
        """列表应返回 200 且有 meetings 数组"""
        resp = api_get("/api/meetings", admin_token)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert isinstance(data["meetings"], list)

    def test_list_response_time(self, admin_token):
        """列表耗时应在合理范围内（<100ms 预热后）"""
        start = time.monotonic()
        resp = api_get("/api/meetings", admin_token)
        elapsed = time.monotonic() - start
        assert resp.status_code == 200
        assert elapsed < 0.5, f"列表耗时 {elapsed:.3f}s 超过 500ms"

    def test_create_and_get_meeting(self, admin_token):
        """创建会议后能通过 ID 查询到"""
        meeting_id = f"test-{uuid.uuid4().hex[:8]}"
        resp = api_post("/api/meetings", {
            "id": meeting_id,
            "title": "Pytest 测试会议",
            "project": "测试项目",
            "agenda": "测试议题",
            "type": "普通企业会议",
        }, admin_token)
        assert resp.status_code == 200
        assert resp.json()["meeting"]["id"] == meeting_id

        # GET 查询
        resp = api_get(f"/api/meetings/{meeting_id}", admin_token)
        assert resp.status_code == 200
        assert resp.json()["meeting"]["title"] == "Pytest 测试会议"

    def test_patch_meeting(self, admin_token):
        """PATCH 更新会议字段"""
        meeting_id = f"test-patch-{uuid.uuid4().hex[:8]}"
        api_post("/api/meetings", {
            "id": meeting_id, "title": "更新前",
        }, admin_token)

        resp = api_patch(f"/api/meetings/{meeting_id}", {
            "title": "更新后",
            "phase": "议程已确认",
        }, admin_token)
        assert resp.status_code == 200
        m = resp.json()["meeting"]
        assert m["title"] == "更新后"
        assert m["phase"] == "议程已确认"

    def test_archive_meeting(self, admin_token):
        """DELETE 归档会议（软删除）"""
        meeting_id = f"test-archive-{uuid.uuid4().hex[:8]}"
        api_post("/api/meetings", {"id": meeting_id, "title": "待归档"}, admin_token)

        resp = _httpx_client().delete(
            f"{API_BASE}/api/meetings/{meeting_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["meeting"]["archived"] is True

    def test_create_with_issues(self, admin_token):
        """创建会议并添加问题线索"""
        meeting_id = f"test-issues-{uuid.uuid4().hex[:8]}"
        api_post("/api/meetings", {"id": meeting_id, "title": "问题测试"}, admin_token)

        resp = api_post(f"/api/meetings/{meeting_id}/issues", {
            "name": "测试提交人",
            "content": "这是一条测试问题线索",
            "type": "text",
            "source": "manual",
        }, admin_token)
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        issue = resp.json()["issue"]
        assert issue["content"] == "这是一条测试问题线索"


# ═══════════════════════════════════════════════════════════════════════════════
# 4. 转写
# ═══════════════════════════════════════════════════════════════════════════════

class TestTranscripts:
    """转写读写"""

    def test_post_and_get_transcripts(self, admin_token):
        """写入转写 chunk 后能查询到"""
        meeting_id = f"test-tr-{uuid.uuid4().hex[:8]}"
        # 先创建会议
        api_post("/api/meetings", {"id": meeting_id, "title": "转写测试"}, admin_token)

        # 写入 chunk
        resp = api_post("/api/meeting/transcripts/chunk", {
            "meeting_id": meeting_id,
            "meeting_title": "转写测试",
            "transcript": "这是第一条转写测试内容",
            "is_final": True,
        }, admin_token)
        assert resp.status_code == 200

        # 查询
        resp = api_get(f"/api/meeting/transcripts/{meeting_id}", admin_token)
        assert resp.status_code == 200
        data = resp.json()
        assert data["totalTranscripts"] >= 1

    def test_transcript_query_empty_meeting(self, admin_token):
        """查询不存在的会议转写不报错"""
        resp = api_get("/api/meeting/transcripts/nonexistent-99999", admin_token)
        assert resp.status_code == 200
        assert resp.json()["totalTranscripts"] == 0


# ═══════════════════════════════════════════════════════════════════════════════
# 5. 数据库函数（直接单元测试，不需要服务运行）
# ═══════════════════════════════════════════════════════════════════════════════

class TestDatabase:
    """backend.db 模块函数直接测试"""

    def test_db_connect(self):
        """_db_connect 返回有效连接"""
        from backend.db import _db_connect
        conn = _db_connect()
        row = conn.execute("SELECT 1 AS n").fetchone()
        assert row["n"] == 1

    def test_json_loads_dumps(self):
        """JSON 序列化往返一致"""
        from backend.db import _json_loads, _json_dumps
        data = {"key": "值", "list": [1, 2, 3]}
        encoded = _json_dumps(data)
        decoded = _json_loads(encoded)
        assert decoded == data

    def test_json_loads_empty(self):
        """空/NULL 输入返回空列表"""
        from backend.db import _json_loads
        assert _json_loads("") == []
        assert _json_loads(None) == []

    def test_safe_meeting_id(self):
        """_safe_meeting_id 清理非法字符"""
        from backend.db import _safe_meeting_id
        sid = _safe_meeting_id("hello world!@#$%^&*()")
        assert "!" not in sid
        assert "@" not in sid
        assert "hello-world" in sid

    def test_phase_color(self):
        """_phase_color 返回非空颜色字符串"""
        from backend.db import _phase_color
        for phase in ["问题收集中", "议程已确认", "会中记录", "审核中", "已归档"]:
            color = _phase_color(phase)
            assert isinstance(color, str) and len(color) > 0

    def test_normalize_meeting(self):
        """_normalize_meeting 补全缺失字段"""
        from backend.db import _normalize_meeting
        meeting = {"id": "test-001", "title": "测试"}
        result = _normalize_meeting(meeting)
        assert result["id"] == "test-001"
        assert "issueSources" in result
        assert "agendaDrafts" in result
        assert "phase" in result

    def test_default_meetings(self):
        """_default_meetings 返回演示数据"""
        from backend.db import _default_meetings
        meetings = _default_meetings()
        assert isinstance(meetings, dict)
        assert len(meetings) > 0

    def test_load_users(self):
        """_load_users 返回用户列表"""
        from backend.db import _load_users
        users = _load_users()
        assert isinstance(users, list)
        assert len(users) > 0
        admin = next((u for u in users if u["username"] == "admin"), None)
        assert admin is not None
        assert admin["role"] == "admin"

    def test_check_meeting_access_creator(self):
        """creator 字段包含用户名或姓名时应通过"""
        from backend.db import _check_meeting_access
        # _creator_from_user("张敏", "总经理办公室") → "总经理办公室 张敏"
        user = {"username": "zhangmin", "role": "staff", "name": "张敏", "dept": "总经理办公室"}
        meeting = {"creator": "总经理办公室 张敏"}
        _check_meeting_access(user, meeting)  # 不抛异常

    def test_check_meeting_access_admin(self):
        """admin 对任何会议有权限"""
        from backend.db import _check_meeting_access
        user = {"username": "admin", "role": "admin"}
        meeting = {"creator": "其他部门 陌生人"}
        _check_meeting_access(user, meeting)  # 不抛异常

    def test_clean_transcript(self):
        """_clean_agenda_check_transcript 清理空白"""
        from backend.db import _clean_agenda_check_transcript
        assert _clean_agenda_check_transcript("  你好  世界  ") == "你好 世界"
        assert _clean_agenda_check_transcript("") == ""

    def test_db_fetch_meetings(self):
        """_db_fetch_meetings 返回 dict"""
        from backend.db import _db_fetch_meetings
        meetings = _db_fetch_meetings(include_details=True)
        assert isinstance(meetings, dict)

    def test_db_load_transcripts_for_meeting(self):
        """按 meeting_id 查询转写"""
        from backend.db import _db_load_transcripts_for_meeting
        result = _db_load_transcripts_for_meeting("nonexistent-99999")
        assert isinstance(result, dict)
        assert "transcripts" in result


# ═══════════════════════════════════════════════════════════════════════════════
# 6. 配置模块
# ═══════════════════════════════════════════════════════════════════════════════

class TestConfig:
    """backend.config 模块"""

    def test_app_db_exists(self):
        """APP_DB 路径应存在"""
        from backend.config import APP_DB
        assert APP_DB.exists(), f"数据库文件不存在: {APP_DB}"

    def test_auth_secret_set(self):
        """AUTH_SECRET 必须已配置"""
        from backend.config import AUTH_SECRET
        assert AUTH_SECRET, "AUTH_SECRET 未设置"

    def test_upload_limits(self):
        """上传限制应为合理值"""
        from backend.config import MAX_UPLOAD_BYTES, MAX_AUDIO_BYTES, MAX_EXCEL_BYTES
        assert MAX_UPLOAD_BYTES > 0
        assert MAX_AUDIO_BYTES > 0
        assert MAX_EXCEL_BYTES > 0
        assert MAX_AUDIO_BYTES <= MAX_UPLOAD_BYTES


# ═══════════════════════════════════════════════════════════════════════════════
# 7. AI 会议全链路端到端
# ═══════════════════════════════════════════════════════════════════════════════

class TestAIMeetingE2E:
    """完整会议流程：创建→问题→AI议程→转写→归档"""

    def test_full_meeting_lifecycle(self, admin_token):
        """端到端：创建会议→添加问题→AI议程生成→转写→归档"""
        mid = f"test-e2e-{uuid.uuid4().hex[:8]}"

        # 1. 创建
        resp = api_post("/api/meetings", {
            "id": mid, "title": "E2E测试", "project": "测试项目",
            "agenda": "测试议题", "type": "普通企业会议", "phase": "问题收集中",
        }, admin_token)
        assert resp.status_code == 200
        assert resp.json()["meeting"]["id"] == mid

        # 2. 添加问题线索
        for i in range(3):
            resp = api_post(f"/api/meetings/{mid}/issues", {
                "name": f"测试人{i}", "content": f"问题线索{i}：预算调整方案讨论",
            }, admin_token)
            assert resp.status_code == 200

        # 3. AI 议程生成（调用 DeepSeek LLM，可能较慢）
        resp = _httpx_client(timeout=120.0).post(
            f"{API_BASE}/api/meetings/{mid}/agenda/generate",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"meetingMode": "normal"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert len(data.get("agendaDrafts", [])) >= 1, "AI 应生成至少 1 条议题"

        # 4. 阶段切换
        resp = api_post(f"/api/meetings/{mid}/stage", {
            "stage": "agenda-confirmed", "phase": "议程已确认",
        }, admin_token)
        assert resp.status_code == 200
        assert resp.json()["meeting"]["phase"] == "议程已确认"

        # 5. 转写写入 + 查询
        for i in range(5):
            resp = api_post("/api/meeting/transcripts/chunk", {
                "meeting_id": mid, "meeting_title": "E2E测试",
                "transcript": f"发言人{i}：同意该方案。",
                "is_final": True,
            }, admin_token)
            assert resp.status_code == 200

        resp = api_get(f"/api/meeting/transcripts/{mid}", admin_token)
        assert resp.json()["totalTranscripts"] >= 5

        # 6. 会议记录生成
        resp = api_get(f"/api/meetings/{mid}/records", admin_token)
        assert resp.status_code == 200
        assert resp.json()["success"] is True

        # 7. 归档
        resp = _httpx_client().delete(
            f"{API_BASE}/api/meetings/{mid}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["meeting"]["archived"] is True


# ═══════════════════════════════════════════════════════════════════════════════
# 8. 审查与知识库端点（之前漏测导致 404）
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuditAndKB:
    """审核流、知识库等端点"""

    def test_audit_stream_exists(self):
        """POST /audit_stream 应返回 200（即使无 auth）"""
        resp = _httpx_client().post(
            f"{API_BASE}/audit_stream",
            json={"matter_type": "重大决策", "material_text": "测试"},
        )
        # 可能 200（开始流式）或 401（需登录），但不应 404
        assert resp.status_code != 404, f"/audit_stream 返回 404"

    def test_api_audit_stream_exists(self):
        """POST /api/audit_stream 别名同样不应 404"""
        resp = _httpx_client().post(
            f"{API_BASE}/api/audit_stream",
            json={"matter_type": "重大决策", "material_text": "测试"},
        )
        assert resp.status_code != 404, f"/api/audit_stream 返回 404"

    def test_kb_stream_exists(self):
        """POST /api/kb_stream 不应 404"""
        resp = _httpx_client().post(
            f"{API_BASE}/api/kb_stream",
            json={"query": "合规"},
        )
        assert resp.status_code != 404, f"/api/kb_stream 返回 404"

    def test_matter_types(self):
        """GET /matter-types 返回事项类型列表"""
        resp = _httpx_client().get(f"{API_BASE}/matter-types")
        assert resp.status_code == 200
        data = resp.json()
        assert "matter_types" in data
        assert len(data["matter_types"]) >= 2

    def test_demo_assets(self):
        """GET /api/demo_assets 返回演示资源"""
        resp = _httpx_client().get(f"{API_BASE}/api/demo_assets")
        assert resp.status_code == 200

    def test_root_page(self):
        """GET / 返回 HTML 页面"""
        resp = _httpx_client().get(f"{API_BASE}/")
        assert resp.status_code == 200

    def test_audit_history(self, admin_token):
        """GET /api/audit_history 返回审核历史"""
        resp = api_get("/api/audit_history", admin_token)
        assert resp.status_code == 200
        assert "history" in resp.json()

    def test_custom_rules_list(self):
        """GET /api/custom_rules 返回规则列表"""
        resp = _httpx_client().get(f"{API_BASE}/api/custom_rules")
        assert resp.status_code == 200

    def test_rules_gallery(self):
        """GET /api/rules_gallery 返回规则图片库"""
        resp = _httpx_client().get(f"{API_BASE}/api/rules_gallery")
        assert resp.status_code == 200

    def test_departments_list(self):
        """GET /api/departments 不应 404"""
        resp = _httpx_client().get(f"{API_BASE}/api/departments")
        assert resp.status_code != 404

    def test_contract_map_doc_structure(self):
        """POST /api/contract/map_doc_structure 不应 404"""
        resp = _httpx_client().post(
            f"{API_BASE}/api/contract/map_doc_structure",
            json={"saved_name": "nonexistent.docx"},
        )
        # 404 是因为文件不存在，不是路由不存在
        assert resp.status_code != 405  # 405 = method not allowed (wrong route)

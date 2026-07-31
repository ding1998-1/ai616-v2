"""
backend/main.py — AI 会议合规系统主入口

启动方式:
    cd /home/ai/文档/ai616
    python -m backend.main

    或直接:
    python backend/main.py

模块结构:
    config.py    全局配置、常量、锁、缓存
    models.py    Pydantic 请求/响应模型
    db.py        SQLite 数据库层（连接、Schema、CRUD）
    llm_client.py DeepSeek LLM 客户端 + HTTP 连接池
    routes/      路由模块（按业务域拆分）:
        auth.py       登录、用户管理
        meetings.py   会议 CRUD、议题、材料、归档
        transcripts.py 转写、录音
        asr.py        Fun-ASR WebSocket 代理
        audit.py      合规审核流式接口
        knowledge.py  知识库、ChromaDB
        rules.py      制度规则
        docs.py       OnlyOffice 文档协作
        contract.py   合同审查
        misc.py       首页、健康检查、演示资源
"""

import os as _os
_os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
_os.environ.setdefault("HF_HUB_OFFLINE", "1")
_os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", _os.path.expanduser("~/.cache/huggingface/hub"))
del _os

import sys
from pathlib import Path

# 确保项目根目录在 sys.path 中
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ═══ 导入核心模块（触发初始化） ═════════════════════════════════════════════════
from backend.config import (  # noqa: E402
    AUTH_SECRET, DASHSCOPE_API_KEY, DASHSCOPE_WORKSPACE,
    PUBLIC_HOST, APP_DB, APP_DB_LOCK,
    llm_semaphore,
    get_public_host, get_browser_backend_base, now_text, today_text,
)
from backend.db import (  # noqa: E402
    _db_connect, _init_app_db,
    _load_meetings, _save_meetings,
    _load_meeting_transcripts, _save_meeting_transcripts,
    _load_users, _save_users,
    _migrate_legacy_meeting_json_once,
)
from backend.llm_client import llm  # noqa: E402

logger.info(f"【Net】Detected LAN IP: {PUBLIC_HOST}")

# ═══ FastAPI 应用 ═══════════════════════════════════════════════════════════════

import asyncio
import concurrent.futures
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动预热 ChromaDB / 模型 / 数据迁移；关闭时清理连接池。"""
    if not AUTH_SECRET:
        logger.critical("APP_AUTH_SECRET 未设置！服务器拒绝启动。请在 .env 中配置。")
        raise RuntimeError("APP_AUTH_SECRET is required")

    _warm_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="warmup-")
    loop = asyncio.get_event_loop()

    # 延迟导入重型模块，避免阻塞 API 导入
    from backend.routes.knowledge import _get_vectorstore, _get_case_db
    await asyncio.gather(
        loop.run_in_executor(_warm_executor, _migrate_legacy_meeting_json_once),
        loop.run_in_executor(_warm_executor, lambda: _get_vectorstore(False)),
        loop.run_in_executor(_warm_executor, _get_case_db),
    )
    _warm_executor.shutdown(wait=False)
    logger.info("【启动】预热完成 — ChromaDB、模型、数据迁移已就绪")
    yield
    # 关闭清理
    from backend.llm_client import _httpx_async_client, _httpx_sync_client, _llm_executor
    if _httpx_async_client and not _httpx_async_client.is_closed:
        await _httpx_async_client.aclose()
    if _httpx_sync_client and not _httpx_sync_client.is_closed:
        _httpx_sync_client.close()
    _llm_executor.shutdown(wait=True)
    logger.info("【关闭】HTTP 连接池和线程池已清理")


app = FastAPI(title="三重一大合规审核 API", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═══ 注册路由模块 ═══════════════════════════════════════════════════════════════

from backend.routes.misc import router as misc_router          # noqa: E402
from backend.routes.auth import router as auth_router          # noqa: E402
from backend.routes.meetings import router as meetings_router  # noqa: E402
from backend.routes.transcripts import router as transcripts_router  # noqa: E402
from backend.routes.asr import router as asr_router            # noqa: E402
from backend.routes.audit import router as audit_router        # noqa: E402
from backend.routes.knowledge import router as knowledge_router  # noqa: E402
from backend.routes.rules import router as rules_router        # noqa: E402
from backend.routes.docs import router as docs_router          # noqa: E402
from backend.routes.contract import router as contract_router  # noqa: E402

app.include_router(misc_router)
app.include_router(auth_router)
app.include_router(meetings_router)
app.include_router(transcripts_router)
app.include_router(asr_router)
app.include_router(audit_router)
app.include_router(knowledge_router)
app.include_router(rules_router)
app.include_router(docs_router)
app.include_router(contract_router)

# ═══ 直接启动 ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8002, workers=4)

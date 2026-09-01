"""AI 会议工作台唯一运行入口。

`backend.app_factory.create_core_app()` 负责所有路由装配；本模块只负责进程级
环境设置、启动/关闭生命周期和直接运行时的 uvicorn 配置。不要在这里导入
`backend_full`，也不要在这里重复 include_router。
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import inspect
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

# 本地部署不应在导入入口时访问 Hugging Face 网络；重型模型仍由业务模块按需加载。
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", os.path.expanduser("~/.cache/huggingface/hub"))

# 允许 `python backend/main.py` 与 `python -m backend.main` 都从项目根目录解析包。
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from backend import config as backend_config  # noqa: E402
from backend.app_factory import create_core_app  # noqa: E402
from backend.db import _migrate_legacy_meeting_json_once  # noqa: E402


logger = logging.getLogger(__name__)


def _auth_secret() -> str:
    """读取当前进程的认证密钥。

    `config` 通常在导入时已经读取 `.env`；优先读取环境变量是为了让部署检查
    与进程实际环境一致，也方便测试在不重载模块的情况下验证缺失配置。
    """

    return (os.environ.get("APP_AUTH_SECRET") or backend_config.AUTH_SECRET or "").strip()


def _require_auth_secret() -> None:
    secret = _auth_secret()
    if not secret:
        logger.critical("APP_AUTH_SECRET 未设置，拒绝启动。")
        raise RuntimeError("APP_AUTH_SECRET is required")


def _knowledge_prewarm_enabled() -> bool:
    value = os.environ.get("KNOWLEDGE_PREWARM", "0").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _prewarm_knowledge() -> Any:
    """按需预热向量库；Chroma/embedding 都属于可选重依赖。"""

    from backend.services.knowledge_service import get_vectorstore

    return get_vectorstore(create_if_missing=False)


async def _close_resource(resource: Any, close_method: str) -> None:
    """关闭一个可选资源，兼容异步和同步 close 实现。"""

    if resource is None:
        return
    try:
        closed = getattr(resource, "is_closed", None)
        if closed is True:
            return
        close = getattr(resource, close_method, None)
        if close is None:
            return
        result = close()
        if inspect.isawaitable(result):
            await result
    except Exception:
        logger.exception("关闭运行时资源失败：%s", type(resource).__name__)


async def _shutdown_runtime_resources() -> None:
    """关闭客户端并取消排队任务，但不等待不可中断的同步调用。"""

    try:
        from backend import llm_client
    except Exception:
        logger.exception("加载 LLM 清理模块失败")
        llm_client = None

    if llm_client is not None:
        await _close_resource(getattr(llm_client, "_httpx_async_client", None), "aclose")
        await _close_resource(getattr(llm_client, "_httpx_sync_client", None), "close")

    modules = (("config", backend_config),)
    if llm_client is not None:
        modules = (("llm_client", llm_client), *modules)
    for module_name, module in modules:
        executor = getattr(module, "_llm_executor", None)
        if executor is None or getattr(executor, "_shutdown", False):
            continue
        try:
            executor.shutdown(wait=False, cancel_futures=True)
        except Exception:
            logger.exception("关闭 %s 线程池失败", module_name)


@asynccontextmanager
async def lifespan(_app):
    """执行安全校验、幂等迁移、可选预热，并在关闭时释放资源。"""

    _require_auth_secret()
    loop = asyncio.get_running_loop()
    startup_executor = concurrent.futures.ThreadPoolExecutor(
        max_workers=2,
        thread_name_prefix="startup-",
    )
    asr_cleanup_task = None
    try:
        # 迁移属于数据一致性前置条件；失败时不应让服务带着未知数据状态启动。
        await loop.run_in_executor(startup_executor, _migrate_legacy_meeting_json_once)

        if _knowledge_prewarm_enabled():
            try:
                await loop.run_in_executor(startup_executor, _prewarm_knowledge)
                logger.info("知识库预热完成")
            except Exception:
                # 认证、会议、健康等基础 API 不应被可选向量依赖拖垮。
                logger.warning("知识库预热失败，继续启动基础 API", exc_info=True)
        from backend.routes.asr import cleanup_asr_pending_store

        asr_cleanup_task = asyncio.create_task(
            cleanup_asr_pending_store(),
            name="asr-pending-cleanup",
        )
        # 启动期任务已经结束，立即回收线程池，退出时不再承担迁移清理。
        startup_executor.shutdown(wait=True)
        startup_executor = None
        yield
    finally:
        if asr_cleanup_task is not None:
            asr_cleanup_task.cancel()
            try:
                await asr_cleanup_task
            except asyncio.CancelledError:
                pass
        try:
            from backend.services.whisper_review_service import shutdown_whisper_reviews

            await shutdown_whisper_reviews(timeout=2.0)
        except Exception:
            logger.exception("停止 Whisper 终审任务失败")
        if startup_executor is not None:
            startup_executor.shutdown(wait=False, cancel_futures=True)
        await _shutdown_runtime_resources()
        logger.info("运行时资源清理完成")


def create_app():
    """创建唯一模块化 FastAPI 应用，并挂载主入口生命周期。"""

    app = create_core_app()
    # app_factory 是唯一路由装配点；FastAPI Router 支持在应用装配后挂载 lifespan。
    app.router.lifespan_context = lifespan
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8002, workers=4)

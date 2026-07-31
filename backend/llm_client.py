"""
backend/llm_client.py — DeepSeek LLM 客户端 + HTTP 连接池

提供 DeepSeek V3 的 LangChain 兼容对话模型，支持思考模式 (reasoning_content)
和流式输出。同时管理全局 HTTP 连接池（同步/异步）与 LLM 专用线程池，
避免每次请求重复建立 TCP+TLS 握手，并防止 LLM 调用耗尽 asyncio 默认执行器。

依赖:
    - langchain_core (BaseChatModel, messages, outputs)
    - httpx (HTTP 连接池)
    - backend.config (AUTH_SECRET, DASHSCOPE_API_KEY, DASHSCOPE_WORKSPACE)

被依赖:
    - routes/audit.py (合规审核流式接口)
    - main.py (FastAPI 生命周期管理)

导出的公共符号:
    - llm: DeepSeekThinkingLLM 全局单例
    - _get_httpx_async(): 获取或创建全局异步 HTTP 客户端
    - _get_httpx_sync(): 获取或创建全局同步 HTTP 客户端
    - _httpx_async_client: 全局异步 HTTP 客户端引用（供 shutdown 清理）
    - _httpx_sync_client: 全局同步 HTTP 客户端引用（供 shutdown 清理）
    - _llm_executor: LLM 专用线程池（供 shutdown 清理）
    - llm_semaphore: 异步信号量，限制并发 LLM 请求数
    - current_request: 上下文变量，保存当前 FastAPI Request（用于流式断连检测）
    - DeepSeekThinkingLLM: 类本身（如需子类化或定制）
"""

import os
import json
import time
import asyncio
import logging
import contextvars
import concurrent.futures
from typing import Optional, List, Any, AsyncIterator, Dict

import httpx
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)
from langchain_core.outputs import ChatGeneration, ChatResult, ChatGenerationChunk

from backend.config import (
    AUTH_SECRET,           # APP 认证密钥 — 用于 JWT 签名与校验
    DASHSCOPE_API_KEY,     # 阿里云 DashScope API Key（Fun-ASR 实时语音识别）
    DASHSCOPE_WORKSPACE,   # DashScope 工作空间 ID（可选）
)

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════════
# 上下文变量 — 用于在流式 LLM 调用中感知客户端是否已断开连接
# ═══════════════════════════════════════════════════════════════════════════════════

current_request: contextvars.ContextVar = contextvars.ContextVar(
    "current_request", default=None
)
"""保存当前正在处理的 FastAPI Request 对象。

在流式审核路由中，通过 `current_request.set(http_request)` 注入当前请求，
LLM 流式输出循环中通过 `current_request.get()` 读取并检查 `is_disconnected()`,
从而在客户端断开时及时终止推理流，避免浪费 GPU/API 配额。
"""

# ═══════════════════════════════════════════════════════════════════════════════════
# 全局连接池与并发控制
# ═══════════════════════════════════════════════════════════════════════════════════

# 异步信号量：限制同时发往 LLM API 的并发请求数
# 通过环境变量 LLM_CONCURRENCY 控制，默认 5
llm_semaphore: asyncio.Semaphore = asyncio.Semaphore(
    int(os.environ.get("LLM_CONCURRENCY", "5"))
)
"""异步信号量，限制并发 LLM 请求数，防止 API 速率限制或服务端过载。"""

# LLM 专用线程池：避免同步 HTTP 调用（_generate）耗尽 asyncio 默认执行器
# max_workers=8 足够覆盖信号量上限 5 的并发需求，留有缓冲
_llm_executor: concurrent.futures.ThreadPoolExecutor = (
    concurrent.futures.ThreadPoolExecutor(max_workers=8, thread_name_prefix="llm-")
)
"""LLM 专用线程池，用于在异步上下文中执行同步的 LLM HTTP 调用。
与 asyncio 默认线程池隔离，确保 LLM 阻塞不干扰其他异步任务。
在应用关闭时由 main.py 的 lifespan shutdown 阶段调用 shutdown(wait=True) 清理。
"""

# 全局 HTTP 客户端（单例模式）— 连接复用，避免每次请求重新握手
_httpx_async_client: Optional[httpx.AsyncClient] = None
"""全局异步 HTTP 客户端引用。通过 _get_httpx_async() 延迟创建，
在应用关闭时由 lifespan shutdown 阶段调用 aclose() 释放连接。"""

_httpx_sync_client: Optional[httpx.Client] = None
"""全局同步 HTTP 客户端引用。通过 _get_httpx_sync() 延迟创建，
在应用关闭时由 lifespan shutdown 阶段调用 close() 释放连接。"""


def _get_httpx_async() -> httpx.AsyncClient:
    """获取或创建全局异步 HTTP 客户端（单例，懒加载）。

    连接池配置：
        - 总超时 180s，连接超时 10s — 适应 LLM 长响应
        - 最大 keep-alive 连接数 20，总连接数 50 — 支撑高并发流式请求
        - 禁用 HTTP/2 — DeepSeek API 使用 HTTP/1.1

    Returns:
        httpx.AsyncClient: 已就绪的全局异步 HTTP 客户端实例。
    """
    global _httpx_async_client
    if _httpx_async_client is None or _httpx_async_client.is_closed:
        _httpx_async_client = httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
            http2=False,
            trust_env=False,  # 忽略环境代理（避免 socks:// 不支持导致崩溃）
        )
    return _httpx_async_client


def _get_httpx_sync() -> httpx.Client:
    """获取或创建全局同步 HTTP 客户端（单例，懒加载）。

    连接池配置：
        - 总超时 180s，连接超时 10s — 适应 LLM 长响应
        - 最大 keep-alive 连接数 10，总连接数 30 — 同异步池隔离，避免资源争抢
        - 禁用 HTTP/2 — DeepSeek API 使用 HTTP/1.1

    Returns:
        httpx.Client: 已就绪的全局同步 HTTP 客户端实例。
    """
    global _httpx_sync_client
    if _httpx_sync_client is None or _httpx_sync_client.is_closed:
        _httpx_sync_client = httpx.Client(
            timeout=httpx.Timeout(180.0, connect=10.0),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=30),
            http2=False,
            trust_env=False,  # 忽略环境代理（避免 socks:// 不支持导致崩溃）
        )
    return _httpx_sync_client


# ═══════════════════════════════════════════════════════════════════════════════════
# DeepSeek Thinking LLM — LangChain BaseChatModel 子类
# ═══════════════════════════════════════════════════════════════════════════════════

class DeepSeekThinkingLLM(BaseChatModel):
    """兼容 reasoning_content 字段的 DeepSeek V3 客户端。

    支持思考模式（thinking enabled），能够返回推理链（reasoning_content）和
    最终回答（content）。同时支持同步生成、异步生成和流式输出三种调用方式。

    工作流程:
        1. 将 LangChain message 列表转换为 DeepSeek API 格式（_convert_messages）
        2. 通过全局 HTTP 连接池发送 POST 请求到 DeepSeek API
        3. 解析响应中的 content 和 reasoning_content 字段
        4. 流式模式下，将 thinking chunk 和 content chunk 分别 yield，
           前端可根据 chunk_type 区分显示样式（折叠思考链 / 展示正文）

    Attributes:
        api_key: DeepSeek API 密钥，从环境变量 DEEPSEEK_API_KEY 读取
        api_base: DeepSeek API 端点 URL
        model_name: 模型名称，默认 deepseek-chat
        temperature: 生成温度，默认 0.1（低随机性，适合合规审核场景）
        max_tokens: 最大生成 token 数，默认 8000
        timeout: HTTP 请求超时时间（秒）
    """
    # 按照文档说明，这里调用官方 api，如果需要在环境变量注入密钥则取消注释或在这里明文修改
    api_key: str = os.environ.get("DEEPSEEK_API_KEY", "")
    api_base: str = "https://api.deepseek.com/chat/completions"
    model_name: str = "deepseek-chat"
    temperature: float = 0.1
    max_tokens: int = 8000
    timeout: float = 180.0

    @property
    def _llm_type(self) -> str:
        """返回 LLM 类型标识，供 LangChain 内部日志和回调使用。"""
        return "deepseek-thinking"

    def _convert_messages(self, messages: List[Any]) -> List[dict]:
        """将 LangChain 消息列表转换为 DeepSeek API 要求的字典格式。

        处理规则:
            - str: 直接视为 user 消息
            - SystemMessage: 映射为 system 角色
            - HumanMessage: 映射为 user 角色
            - AIMessage: 映射为 assistant 角色，同时保留 additional_kwargs
              中的 reasoning_content（用于多轮工具调用场景）
            - 其他类型: 尝试读取 content 属性，兜底为 user 角色

        Args:
            messages: LangChain 消息对象列表（可能包含 str、SystemMessage、
                      HumanMessage、AIMessage 或其他类型）

        Returns:
            List[dict]: DeepSeek API 兼容的消息字典列表，
                       每项包含 role 和 content 键，AIMessage 额外包含
                       reasoning_content（如果存在）。
        """
        result = []
        for m in messages:
            if isinstance(m, str):
                result.append({"role": "user", "content": m})
            elif isinstance(m, SystemMessage):
                result.append({"role": "system", "content": m.content})
            elif isinstance(m, HumanMessage):
                result.append({"role": "user", "content": m.content})
            elif isinstance(m, AIMessage):
                msg_dict = {"role": "assistant", "content": m.content or ""}

                # 保留 additional_kwargs 中的 reasoning_content（多轮工具调用场景）
                if m.additional_kwargs and "reasoning_content" in m.additional_kwargs:
                    msg_dict["reasoning_content"] = m.additional_kwargs["reasoning_content"]

                result.append(msg_dict)
            else:
                result.append({"role": "user", "content": str(getattr(m, 'content', m))})
        return result

    def _generate(
        self,
        messages: List[BaseMessage],
        stop=None,
        run_manager=None,
        enable_thinking: bool = True,
        **kwargs
    ) -> ChatResult:
        """同步调用 DeepSeek API 生成回复。

        使用全局同步 HTTP 客户端发送 POST 请求，支持思考模式开关。
        默认启用 thinking，模型会先进行内部推理（返回 reasoning_content），
        再输出最终回答（content）。

        重要: 仅使用 content 字段作为最终输出。如果 content 为空（模型仅输出
        思考链而无实质回答），会记录警告日志并返回空字符串。

        Args:
            messages: LangChain 消息列表
            stop: 停止词列表（LangChain 标准参数，DeepSeek API 暂不直接支持）
            run_manager: LangChain 回调管理器
            enable_thinking: 是否启用深度思考模式，默认 True
            **kwargs: 额外参数（传递给 API payload）

        Returns:
            ChatResult: 包含 AI 回复的 LangChain ChatResult 对象
        """
        payload = {
            "model": self.model_name,
            "messages": self._convert_messages(messages),
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        if enable_thinking:
            payload["thinking"] = {"type": "enabled"}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        client = _get_httpx_sync()
        _RETRYABLE_STATUS = {429, 502, 503, 504}
        resp = None
        for attempt in range(3):
            resp = client.post(self.api_base, json=payload, headers=headers)
            if resp.status_code in _RETRYABLE_STATUS and attempt < 2:
                delay = min(2 ** attempt, 8)
                logger.warning(
                    f"DeepSeek 返回 {resp.status_code}，{delay}s 后重试 ({attempt+1}/3)"
                )
                time.sleep(delay)
                continue
            break
        if resp.status_code >= 400:
            logger.error(
                f"DeepSeek 错误响应: {resp.text} "
                f"payload: {json.dumps(payload, ensure_ascii=False)}"
            )
        resp.raise_for_status()
        data = resp.json()

        msg = data["choices"][0]["message"]
        # 重要：Agent 调用必须使用 content 字段。
        text = msg.get("content") or ""
        if not text:
            # 如果 content 为空，说明模型只输出了思考链而没有实质回答，记录警告便于调试
            rc = msg.get("reasoning_content", "")
            logger.warning(
                f"【LLM】content 为空，模型可能仅输出了思考链（reasoning_content 长度={len(rc)}）。"
                f"建议检查模型是否支持当前请求格式，当前返回空字符串。"
            )
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text))])

    async def _agenerate(
        self,
        messages: List[BaseMessage],
        stop=None,
        run_manager=None,
        **kwargs
    ) -> ChatResult:
        """异步调用 DeepSeek API 生成回复。

        将同步 _generate 方法提交到 LLM 专用线程池执行，避免阻塞 asyncio 事件循环。

        Args:
            messages: LangChain 消息列表
            stop: 停止词列表
            run_manager: LangChain 回调管理器
            **kwargs: 额外参数（透传给 _generate）

        Returns:
            ChatResult: 包含 AI 回复的 LangChain ChatResult 对象
        """
        return await asyncio.get_event_loop().run_in_executor(
            _llm_executor, lambda: self._generate(messages, stop, run_manager, **kwargs)
        )

    async def _astream(
        self,
        messages: List[BaseMessage],
        stop=None,
        run_manager=None,
        enable_thinking: bool = True,
        **kwargs
    ) -> AsyncIterator[ChatGenerationChunk]:
        """流式调用 DeepSeek API，逐块产出推理链和回答内容。

        使用全局异步 HTTP 客户端建立 SSE 长连接，逐行解析 `data: ` 前缀的
        JSON 事件流。每收到一个 delta 块，根据字段类型分别 yield：
            - reasoning_content → chunk_type="thinking"（思考过程，前端可折叠显示）
            - content → chunk_type="content"（正文，前端直接渲染）

        内置断连检测：在每行解析后检查 current_request 上下文变量中保存的
        FastAPI Request 是否已断开。如果客户端断开，立即抛出 asyncio.CancelledError
        终止流，避免浪费 API 配额。

        Args:
            messages: LangChain 消息列表
            stop: 停止词列表（流式模式下暂不处理）
            run_manager: LangChain 回调管理器
            enable_thinking: 是否启用深度思考模式，默认 True
            **kwargs: 额外参数

        Yields:
            ChatGenerationChunk: 每个 delta 对应的 LangChain 流式块，
                                附加 additional_kwargs["chunk_type"] 标记类型
        """
        payload = {
            "model": self.model_name,
            "messages": self._convert_messages(messages),
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": True,
        }
        if enable_thinking:
            payload["thinking"] = {"type": "enabled"}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        client = _get_httpx_async()
        async with client.stream("POST", self.api_base, json=payload, headers=headers) as response:
            if response.status_code >= 400:
                text_err = await response.aread()
                logger.error(
                    f"DeepSeek 流式响应错误 {response.status_code}: "
                    f"{text_err.decode('utf-8')} "
                    f"Payload: {json.dumps(payload, ensure_ascii=False)}"
                )
            response.raise_for_status()
            async for line in response.aiter_lines():
                # ── 客户端断连检测 ──
                req = current_request.get()
                if req and getattr(req, "is_disconnected", None):
                    if await req.is_disconnected():
                        logger.info("【LLM】Client disconnected, aborting LLM stream.")
                        raise asyncio.CancelledError()

                line = line.strip()
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                    delta = data["choices"][0].get("delta", {})
                    r_text = delta.get("reasoning_content") or ""
                    c_text = delta.get("content") or ""

                    # Yield thinking chunk（推理过程）
                    if r_text:
                        chunk = ChatGenerationChunk(
                            message=AIMessageChunk(
                                content=r_text,
                                additional_kwargs={"chunk_type": "thinking"},
                            )
                        )
                        if run_manager:
                            await run_manager.on_llm_new_token(r_text, chunk=chunk)
                        yield chunk

                    # Yield answer chunk（正文回答）
                    if c_text:
                        chunk = ChatGenerationChunk(
                            message=AIMessageChunk(
                                content=c_text,
                                additional_kwargs={"chunk_type": "content"},
                            )
                        )
                        if run_manager:
                            await run_manager.on_llm_new_token(c_text, chunk=chunk)
                        yield chunk
                except Exception:
                    pass


# ═══════════════════════════════════════════════════════════════════════════════════
# 全局单例 — 供路由模块和 Agent 框架使用
# ═══════════════════════════════════════════════════════════════════════════════════

llm = DeepSeekThinkingLLM()
"""DeepSeek LLM 全局单例实例。

在路由和 Agent 中直接导入使用:
    from backend.llm_client import llm

    result = llm.invoke([HumanMessage(content="...")])
"""

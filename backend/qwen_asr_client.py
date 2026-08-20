"""
backend/qwen_asr_client.py — Qwen3-ASR 流式转录服务的异步 HTTP 客户端。

用于 ai616 后端连接本地 Qwen3-ASR 服务，将会话管理封装为简单的 async 接口。

使用:
    from backend.qwen_asr_client import QwenASRClient

    client = QwenASRClient(base_url="http://127.0.0.1:8091")
    session_id = await client.start()
    for chunk in audio_chunks:
        result = await client.send_chunk(session_id, chunk)
        print(result["text"])
    final = await client.finish(session_id)
"""

import asyncio
import logging
from typing import Dict, Optional

import httpx

logger = logging.getLogger(__name__)

# 默认服务地址
DEFAULT_QWEN_ASR_URL = "http://127.0.0.1:8091"


# ── P0-13: ASR 异常分类 ──────────────────────────────────────────────
class ASRError(Exception):
    """ASR 基础异常。"""
    pass

class ASRUnavailableError(ASRError):
    """ASR 服务不可用（连接失败/5xx/超时）。"""
    pass

class ASRSessionExpiredError(ASRError):
    """ASR session 失效（400/404/session not found）。"""
    pass

class ASRChunkTimeoutError(ASRError):
    """单个 chunk 处理超时。"""
    pass


class QwenASRClient:
    """Qwen3-ASR 流式转录服务客户端。

    封装了 HTTP 会话管理（start → chunk* → finish），
    内置健康检查和超时处理。
    """

    def __init__(
        self,
        base_url: str = DEFAULT_QWEN_ASR_URL,
        timeout: float = 10.0,
        chunk_timeout: float = 5.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.chunk_timeout = chunk_timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout),
                limits=httpx.Limits(max_keepalive_connections=20, max_connections=50),
            )
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------
    # 健康检查
    # ------------------------------------------------------------------
    async def health(self) -> Dict:
        """检查服务是否可用。返回服务状态字典，不可用时返回 {"status": "unavailable"}。"""
        try:
            client = await self._get_client()
            r = await client.get(f"{self.base_url}/api/health")
            return r.json()
        except Exception as e:
            logger.warning("Qwen3-ASR 健康检查失败: %s", e)
            return {"status": "unavailable", "error": str(e)}

    async def is_available(self) -> bool:
        """返回服务是否可用。"""
        try:
            client = await self._get_client()
            r = await client.get(f"{self.base_url}/api/health", timeout=3.0)
            return r.status_code == 200 and r.json().get("status") == "ok"
        except Exception:
            return False

    # ------------------------------------------------------------------
    # 流式识别会话
    # ------------------------------------------------------------------
    async def start(self, hotwords: Optional[list[str]] = None, metadata: Optional[Dict] = None) -> str:
        """创建新的识别会话，返回 session_id。

        如果服务端支持热词/上下文参数，会一并传入；不支持时会静默降级。
        """
        client = await self._get_client()
        payload: Dict = {}
        if hotwords:
            payload["hotwords"] = [word for word in hotwords if isinstance(word, str) and word.strip()]
        if metadata:
            payload["metadata"] = metadata
        if payload:
            r = await client.post(f"{self.base_url}/api/start", json=payload)
        else:
            r = await client.post(f"{self.base_url}/api/start")
        r.raise_for_status()
        data = r.json()
        return data["session_id"]

    async def send_chunk(self, session_id: str, audio_bytes: bytes,
                         retries: int = 1, chunk_timeout: float = None) -> Dict:
        """发送一个音频块进行增量识别（带重试）。

        Args:
            session_id: 会话 ID
            audio_bytes: 原始 PCM 字节 (int16)
            retries: 首次失败后的重试次数（默认 1 = 共 2 次尝试）
            chunk_timeout: 单次尝试超时秒数（默认使用 self.chunk_timeout）

        Returns:
            {"language": "...", "text": "...", "chunk_id": N}

        Raises:
            ASRChunkTimeoutError: chunk 处理超时
            ASRSessionExpiredError: session 失效 (400/404)
            ASRUnavailableError: ASR 服务不可用 (连接失败/5xx)
        """
        if chunk_timeout is None:
            chunk_timeout = self.chunk_timeout
        client = await self._get_client()
        last_exc = None
        for attempt in range(retries + 1):
            try:
                r = await client.post(
                    f"{self.base_url}/api/chunk",
                    params={"session_id": session_id},
                    content=audio_bytes,
                    headers={"Content-Type": "application/octet-stream"},
                    timeout=httpx.Timeout(chunk_timeout),
                )
                # Session 失效 → ASRSessionExpiredError
                if r.status_code in (400, 404):
                    raise ASRSessionExpiredError(
                        f"Session {session_id} 失效 (HTTP {r.status_code})"
                    )
                r.raise_for_status()
                return r.json()
            except httpx.TimeoutException as e:
                last_exc = ASRChunkTimeoutError(f"Chunk 超时 ({chunk_timeout}s): {e}")
                if attempt < retries:
                    logger.warning("ASR chunk retry %d/%d for session %s: %s",
                                   attempt + 1, retries, session_id, e)
                    await asyncio.sleep(0.5)
            except (httpx.ConnectError, httpx.RemoteProtocolError) as e:
                last_exc = ASRUnavailableError(f"ASR 连接失败: {e}")
                if attempt < retries:
                    logger.warning("ASR chunk retry %d/%d for session %s: %s",
                                   attempt + 1, retries, session_id, e)
                    await asyncio.sleep(0.5)
            except (ASRSessionExpiredError, ASRError):
                raise  # 已经是分类异常，直接抛出
            except httpx.HTTPStatusError as e:
                if e.response.status_code >= 500:
                    last_exc = ASRUnavailableError(f"ASR 服务错误 (HTTP {e.response.status_code})")
                else:
                    last_exc = ASRError(f"ASR 请求失败: {e}")
                if attempt < retries:
                    logger.warning("ASR chunk retry %d/%d for session %s: %s",
                                   attempt + 1, retries, session_id, e)
                    await asyncio.sleep(0.5)
        raise last_exc

    async def finish(self, session_id: str) -> Dict:
        """结束识别，返回最终结果。"""
        client = await self._get_client()
        r = await client.post(
            f"{self.base_url}/api/finish",
            params={"session_id": session_id},
        )
        r.raise_for_status()
        return r.json()

    async def get_session_info(self, session_id: str) -> Optional[Dict]:
        """查询会话状态（调试用）。"""
        try:
            client = await self._get_client()
            r = await client.get(f"{self.base_url}/api/session/{session_id}")
            if r.status_code == 400:
                return None
            r.raise_for_status()
            return r.json()
        except Exception:
            return None

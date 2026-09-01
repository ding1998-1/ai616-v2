"""Async client for the isolated Qwen3-ASR sentence review service."""

from __future__ import annotations

import io
import time
import wave
from dataclasses import dataclass
from typing import Optional

import httpx


@dataclass(frozen=True)
class OfflineASRResult:
    text: str
    language: str
    sentence_id: str
    duration_ms: int
    backend: str


class OfflineASRUnavailable(RuntimeError):
    pass


def pcm16_to_wav(pcm: bytes, sample_rate: int = 16_000) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm)
    return output.getvalue()


class OfflineASRClient:
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8092",
        timeout_seconds: float = 8.0,
        failure_threshold: int = 3,
        recovery_seconds: float = 20.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.failure_threshold = failure_threshold
        self.recovery_seconds = recovery_seconds
        self._client: Optional[httpx.AsyncClient] = None
        self._consecutive_failures = 0
        self._circuit_opened_at = 0.0

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(self.timeout_seconds),
                limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
            )
        return self._client

    def _circuit_is_open(self) -> bool:
        if self._consecutive_failures < self.failure_threshold:
            return False
        return time.monotonic() - self._circuit_opened_at < self.recovery_seconds

    async def transcribe(
        self,
        pcm: bytes,
        *,
        context: str,
        sentence_id: str,
        language: str = "Chinese",
        sample_rate: int = 16_000,
    ) -> OfflineASRResult:
        if self._circuit_is_open():
            raise OfflineASRUnavailable("offline ASR circuit is open")
        if len(pcm) < 800:
            raise ValueError("sentence audio is too short")
        client = await self._http()
        try:
            response = await client.post(
                f"{self.base_url}/api/transcribe",
                files={"file": ("sentence.wav", pcm16_to_wav(pcm, sample_rate), "audio/wav")},
                data={
                    "context": context[:2000],
                    "language": language,
                    "sentence_id": sentence_id,
                    "sample_rate": str(sample_rate),
                },
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            self._consecutive_failures += 1
            if self._consecutive_failures >= self.failure_threshold:
                self._circuit_opened_at = time.monotonic()
            raise OfflineASRUnavailable(str(exc)) from exc
        self._consecutive_failures = 0
        self._circuit_opened_at = 0.0
        return OfflineASRResult(
            text=str(payload.get("text") or "").strip(),
            language=str(payload.get("language") or language),
            sentence_id=str(payload.get("sentence_id") or sentence_id),
            duration_ms=int(payload.get("duration_ms") or 0),
            backend=str(payload.get("backend") or "qwen3-asr-1.7b"),
        )

    async def health(self) -> dict:
        try:
            response = await (await self._http()).get(
                f"{self.base_url}/api/health",
                timeout=3.0,
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            return {"status": "unavailable", "error": str(exc)}

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

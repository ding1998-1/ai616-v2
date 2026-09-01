"""Standalone online ASR service for the 2-pass meeting transcription pipeline.

This module preserves the existing 8091 HTTP contract while replacing the
batch-like recognizer with Paraformer Streaming, FSMN-VAD and final-only
CT-PUNC.  It is intentionally independent from the meeting API process so a
recognizer failure cannot interrupt recording uploads or acknowledgements.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import re
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, Optional

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse


SAMPLE_RATE = 16_000
BYTES_PER_SAMPLE = 2
VAD_FRAME_MS = 60
VAD_FRAME_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * VAD_FRAME_MS // 1000
ONLINE_CHUNK_MS = 300
ONLINE_CHUNK_SAMPLES = SAMPLE_RATE * ONLINE_CHUNK_MS // 1000
PRE_ROLL_MS = 540
PRE_ROLL_FRAMES = PRE_ROLL_MS // VAD_FRAME_MS
END_SILENCE_MS = 900
MAX_SENTENCE_MS = 15_000
MAX_SENTENCE_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * MAX_SENTENCE_MS // 1000
SESSION_TTL_SEC = 10 * 60
STREAM_CHUNK_SIZE = [0, 5, 2]
ENCODER_CHUNK_LOOK_BACK = 4
DECODER_CHUNK_LOOK_BACK = 1

DEFAULT_ONLINE_MODEL = (
    "/home/ai/.cache/modelscope/hub/models/shuai1618/"
    "paraformer-zh-streaming"
)
DEFAULT_VAD_MODEL = (
    "/home/ai/.cache/modelscope/hub/models/iic/"
    "speech_fsmn_vad_zh-cn-16k-common-pytorch"
)
DEFAULT_PUNC_MODEL = (
    "/home/ai/.cache/modelscope/hub/models/iic/"
    "punc_ct-transformer_cn-en-common-vocab471067-large"
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("asr-online")

online_model: Any = None
vad_model: Any = None
punc_model: Any = None
inference_lock: Optional[asyncio.Lock] = None
settings: Any = None


def _clean_text(value: str) -> str:
    text = re.sub(
        r"<\|.*?\|>|NEUTRAL|Speech|withitn|EMO_UNKNOWN|UNKNOWN",
        "",
        str(value or ""),
    )
    return re.sub(r"\s+", "", text).strip()


def _append_incremental(existing: str, incoming: str) -> str:
    """Append a streaming fragment without duplicating an overlapping prefix."""
    incoming = _clean_text(incoming)
    if not incoming:
        return existing
    if incoming.startswith(existing):
        return incoming
    if existing.endswith(incoming):
        return existing
    overlap_limit = min(len(existing), len(incoming), 32)
    for size in range(overlap_limit, 0, -1):
        if existing[-size:] == incoming[:size]:
            return existing + incoming[size:]
    return existing + incoming


def _pcm_float(raw: bytes):
    import numpy as np

    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def _extract_text(result: Any) -> str:
    if not result:
        return ""
    item = result[0] if isinstance(result, list) else result
    return _clean_text(item.get("text", "") if isinstance(item, dict) else item)


@dataclass
class OnlineSession:
    metadata: Dict[str, Any] = field(default_factory=dict)
    hotwords: list[str] = field(default_factory=list)
    raw_pending: bytearray = field(default_factory=bytearray)
    online_pending: bytearray = field(default_factory=bytearray)
    sentence_pcm: bytearray = field(default_factory=bytearray)
    pre_roll: Deque[bytes] = field(
        default_factory=lambda: deque(maxlen=PRE_ROLL_FRAMES)
    )
    vad_cache: dict = field(default_factory=dict)
    online_cache: dict = field(default_factory=dict)
    current_text: str = ""
    finalized_texts: list[str] = field(default_factory=list)
    sentence_seq: int = 0
    speaking: bool = False
    continuation_pending: bool = False
    chunk_count: int = 0
    processed_audio_bytes: int = 0
    created_at: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def cumulative_text(self) -> str:
        return "".join(self.finalized_texts) + self.current_text

    @property
    def current_sentence_id(self) -> str:
        if not self.speaking or self.sentence_seq <= 0:
            return ""
        return f"{self.created_at:.6f}:{self.sentence_seq}"


sessions: Dict[str, OnlineSession] = {}
sessions_lock = asyncio.Lock()


def _get_session(session_id: str) -> Optional[OnlineSession]:
    session = sessions.get(session_id)
    if session:
        session.last_seen = time.time()
    return session


async def _run_model(model: Any, **kwargs: Any) -> Any:
    if inference_lock is None:
        raise RuntimeError("inference lock is not initialized")
    async with inference_lock:
        return await asyncio.to_thread(model.generate, **kwargs)


async def _run_vad(session: OnlineSession, frame: bytes, is_final: bool = False) -> list:
    result = await _run_model(
        vad_model,
        input=[_pcm_float(frame)],
        cache=session.vad_cache,
        is_final=is_final,
        chunk_size=VAD_FRAME_MS,
        max_end_silence_time=END_SILENCE_MS,
    )
    if not result:
        return []
    return result[0].get("value", [])


async def _run_online(
    session: OnlineSession,
    audio: bytes,
    *,
    is_final: bool,
) -> str:
    if not audio and not is_final:
        return ""
    if audio:
        pcm = _pcm_float(audio)
    else:
        import numpy as np

        pcm = np.zeros(160, dtype=np.float32)
    result = await _run_model(
        online_model,
        input=pcm,
        cache=session.online_cache,
        is_final=is_final,
        chunk_size=STREAM_CHUNK_SIZE,
        encoder_chunk_look_back=ENCODER_CHUNK_LOOK_BACK,
        decoder_chunk_look_back=DECODER_CHUNK_LOOK_BACK,
        hotword=" ".join(session.hotwords[:100]),
    )
    fragment = _extract_text(result)
    session.current_text = _append_incremental(session.current_text, fragment)
    return fragment


async def _punctuate(text: str) -> str:
    if not text or punc_model is None:
        return text
    try:
        result = await _run_model(punc_model, input=text)
        punctuated = _extract_text(result)
        return punctuated or text
    except Exception:
        logger.warning("CT-PUNC failed; returning original ASR text", exc_info=True)
        return text


async def _drain_online(session: OnlineSession, *, final: bool = False) -> None:
    while len(session.online_pending) >= ONLINE_CHUNK_SAMPLES * BYTES_PER_SAMPLE:
        size = ONLINE_CHUNK_SAMPLES * BYTES_PER_SAMPLE
        chunk = bytes(session.online_pending[:size])
        del session.online_pending[:size]
        await _run_online(session, chunk, is_final=False)
    if final:
        tail = bytes(session.online_pending)
        session.online_pending.clear()
        await _run_online(session, tail, is_final=True)


def _start_sentence(session: OnlineSession, current_frame: bytes) -> None:
    session.sentence_seq += 1
    session.current_text = ""
    session.online_cache = {}
    buffered = b"".join(session.pre_roll) + current_frame
    session.sentence_pcm = bytearray(buffered)
    session.online_pending = bytearray(buffered)
    session.pre_roll.clear()
    session.speaking = True


async def _finish_sentence(session: OnlineSession) -> Optional[dict]:
    if not session.speaking:
        return None
    await _drain_online(session, final=True)
    raw_text = session.current_text
    final_text = await _punctuate(raw_text)
    if final_text:
        session.finalized_texts.append(final_text)
    end_ms = session.processed_audio_bytes // (SAMPLE_RATE * BYTES_PER_SAMPLE // 1000)
    duration_ms = len(session.sentence_pcm) // (SAMPLE_RATE * BYTES_PER_SAMPLE // 1000)
    event = {
        "event": "sentence_final",
        "sentence_id": session.current_sentence_id,
        "sentence_seq": session.sentence_seq,
        "online_text": raw_text,
        "final_text": final_text,
        "audio_bytes": len(session.sentence_pcm),
        "start_ms": max(0, end_ms - duration_ms),
        "end_ms": end_ms,
    }
    session.current_text = ""
    session.sentence_pcm.clear()
    session.online_pending.clear()
    session.online_cache = {}
    session.speaking = False
    return event


async def _process_frame(session: OnlineSession, frame: bytes) -> Optional[dict]:
    session.processed_audio_bytes += len(frame)
    was_speaking = session.speaking
    signals = await _run_vad(session, frame)
    has_start = any(start >= 0 and end == -1 for start, end in signals)
    has_end = any(start == -1 and end >= 0 for start, end in signals)
    has_complete = any(start >= 0 and end >= 0 for start, end in signals)

    if not was_speaking and (has_start or has_complete or session.continuation_pending):
        session.continuation_pending = False
        _start_sentence(session, frame)
    elif was_speaking:
        session.sentence_pcm.extend(frame)
        session.online_pending.extend(frame)
    else:
        session.pre_roll.append(frame)

    if session.speaking:
        await _drain_online(session)
    if session.speaking and (has_end or has_complete):
        return await _finish_sentence(session)
    if session.speaking and len(session.sentence_pcm) >= MAX_SENTENCE_BYTES:
        event = await _finish_sentence(session)
        session.vad_cache = {}
        session.continuation_pending = True
        if event:
            event["forced_split"] = True
        return event
    return None


async def _gc_sessions() -> None:
    while True:
        await asyncio.sleep(30)
        now = time.time()
        async with sessions_lock:
            expired = [
                session_id
                for session_id, session in sessions.items()
                if now - session.last_seen > SESSION_TTL_SEC
            ]
            for session_id in expired:
                sessions.pop(session_id, None)
        if expired:
            logger.info("expired sessions: %d", len(expired))


@asynccontextmanager
async def lifespan(_: FastAPI):
    global online_model, vad_model, punc_model, inference_lock
    from funasr import AutoModel

    inference_lock = asyncio.Lock()
    logger.info("loading online model: %s", settings.online_model)
    online_model = AutoModel(
        model=settings.online_model,
        device=settings.device,
        disable_update=True,
        disable_pbar=True,
    )
    logger.info("loading FSMN-VAD on CPU: %s", settings.vad_model)
    vad_model = AutoModel(
        model=settings.vad_model,
        device="cpu",
        disable_update=True,
        disable_pbar=True,
    )
    logger.info("loading CT-PUNC on CPU: %s", settings.punc_model)
    punc_model = AutoModel(
        model=settings.punc_model,
        device="cpu",
        disable_update=True,
        disable_pbar=True,
    )
    gc_task = asyncio.create_task(_gc_sessions())
    yield
    gc_task.cancel()
    try:
        await gc_task
    except asyncio.CancelledError:
        pass
    sessions.clear()


app = FastAPI(title="Meeting Online ASR", version="6.0.0", lifespan=lifespan)


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok",
        "backend": "paraformer-streaming-2pass-online",
        "model": settings.online_model,
        "vad": "fsmn-vad",
        "punc": "ct-punc-final-only",
        "device": settings.device,
        "sessions": len(sessions),
    }


@app.post("/api/start")
async def start(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    session_id = uuid.uuid4().hex
    session = OnlineSession(
        metadata=payload.get("metadata") or {},
        hotwords=[
            value.strip()
            for value in payload.get("hotwords", [])
            if isinstance(value, str) and value.strip()
        ][:100],
    )
    async with sessions_lock:
        sessions[session_id] = session
    return {"session_id": session_id}


@app.post("/api/chunk")
async def chunk(request: Request, session_id: str = Query(...)):
    session = _get_session(session_id)
    if session is None:
        return JSONResponse({"error": "invalid session_id"}, status_code=400)
    raw = await request.body()
    if not raw:
        return JSONResponse({"error": "empty body"}, status_code=400)
    async with session.lock:
        session.chunk_count += 1
        session.raw_pending.extend(raw)
        final_event = None
        while len(session.raw_pending) >= VAD_FRAME_BYTES:
            frame = bytes(session.raw_pending[:VAD_FRAME_BYTES])
            del session.raw_pending[:VAD_FRAME_BYTES]
            event = await _process_frame(session, frame)
            if event:
                final_event = event
        response = {
            "language": "zh",
            "text": session.cumulative_text,
            "preview_text": session.current_text,
            "chunk_id": session.chunk_count,
            "is_speaking": session.speaking,
            "sentence_id": session.current_sentence_id,
            "sentence_seq": session.sentence_seq,
            "backend": "paraformer-streaming",
        }
        if final_event:
            response.update(final_event)
        return response


@app.post("/api/finish")
async def finish(session_id: str = Query(...)):
    session = _get_session(session_id)
    if session is None:
        return JSONResponse({"error": "invalid session_id"}, status_code=400)
    async with session.lock:
        final_event = None
        if session.raw_pending:
            padded = bytes(session.raw_pending).ljust(VAD_FRAME_BYTES, b"\0")
            session.raw_pending.clear()
            final_event = await _process_frame(session, padded)
        if session.speaking:
            await _run_vad(session, b"\0" * VAD_FRAME_BYTES, is_final=True)
            final_event = await _finish_sentence(session)
        result = {
            "language": "zh",
            "text": session.cumulative_text,
            "chunk_id": session.chunk_count,
            "audio_chunks": session.chunk_count,
            "backend": "paraformer-streaming",
        }
        if final_event:
            result.update(final_event)
    async with sessions_lock:
        sessions.pop(session_id, None)
    return result


@app.get("/api/session/{session_id}")
async def session_info(session_id: str):
    session = _get_session(session_id)
    if session is None:
        return JSONResponse({"error": "invalid session_id"}, status_code=400)
    return {
        "session_id": session_id,
        "text": session.cumulative_text,
        "preview_text": session.current_text,
        "chunk_count": session.chunk_count,
        "pending_bytes": len(session.raw_pending),
        "is_speaking": session.speaking,
        "sentence_seq": session.sentence_seq,
        "age_sec": round(time.time() - session.created_at, 1),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Meeting online ASR server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18091)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--online-model", default=DEFAULT_ONLINE_MODEL)
    parser.add_argument("--vad-model", default=DEFAULT_VAD_MODEL)
    parser.add_argument("--punc-model", default=DEFAULT_PUNC_MODEL)
    return parser.parse_args()


def main() -> None:
    global settings
    settings = parse_args()
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()

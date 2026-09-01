"""Qwen3-ASR sentence review service for the second pass of transcription."""

from __future__ import annotations

import argparse
import asyncio
import io
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse


DEFAULT_MODEL = "/home/ai/.cache/modelscope/hub/models/Qwen/Qwen3-ASR-1.7B"
MAX_CONTEXT_CHARS = 2_000
MAX_AUDIO_SECONDS = 90

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("qwen3-offline-asr")

model: Any = None
inference_lock: Optional[asyncio.Lock] = None
settings: Any = None


def _decode_audio(data: bytes, sample_rate: int):
    import numpy as np
    import soundfile as sf

    try:
        audio, decoded_rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        return np.asarray(audio, dtype=np.float32), int(decoded_rate)
    except Exception:
        if len(data) % 2:
            raise ValueError("raw PCM byte length must be even")
        audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        return audio, sample_rate


def _transcribe(audio, sample_rate: int, context: str, language: str):
    results = model.transcribe(
        audio=(audio, sample_rate),
        context=context,
        language=language or None,
    )
    if not results:
        return "", language or ""
    result = results[0]
    return str(result.text or "").strip(), str(result.language or language or "")


@asynccontextmanager
async def lifespan(_: FastAPI):
    global model, inference_lock
    import torch
    from qwen_asr import Qwen3ASRModel

    inference_lock = asyncio.Lock()
    logger.info("loading Qwen3-ASR model: %s", settings.model)
    model = Qwen3ASRModel.from_pretrained(
        settings.model,
        dtype=torch.bfloat16,
        device_map=settings.device,
        max_inference_batch_size=1,
        max_new_tokens=settings.max_new_tokens,
        local_files_only=True,
    )
    logger.info("Qwen3-ASR ready on %s", settings.device)
    yield
    model = None


app = FastAPI(title="Meeting Qwen3 Offline ASR", version="1.0.0", lifespan=lifespan)


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok" if model is not None else "loading",
        "backend": "qwen3-asr-transformers",
        "model": settings.model,
        "device": settings.device,
    }


@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    context: str = Form(""),
    language: str = Form("Chinese"),
    sentence_id: str = Form(""),
    sample_rate: int = Form(16_000),
):
    started = time.perf_counter()
    data = await file.read()
    if len(data) < 800:
        return JSONResponse({"error": "audio too short"}, status_code=400)
    try:
        audio, decoded_rate = _decode_audio(data, sample_rate)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    duration_seconds = len(audio) / max(decoded_rate, 1)
    if duration_seconds > MAX_AUDIO_SECONDS:
        return JSONResponse(
            {"error": f"sentence exceeds {MAX_AUDIO_SECONDS} seconds"},
            status_code=413,
        )
    if inference_lock is None:
        return JSONResponse({"error": "model is not ready"}, status_code=503)
    safe_context = str(context or "")[:MAX_CONTEXT_CHARS]
    try:
        async with inference_lock:
            text, detected_language = await asyncio.to_thread(
                _transcribe,
                audio,
                decoded_rate,
                safe_context,
                language,
            )
    except Exception as exc:
        logger.exception("offline transcription failed")
        return JSONResponse({"error": str(exc)}, status_code=500)
    return {
        "text": text,
        "language": detected_language,
        "sentence_id": sentence_id,
        "audio_duration_ms": round(duration_seconds * 1000),
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "backend": "qwen3-asr-1.7b",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Qwen3-ASR offline review server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18092)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-new-tokens", type=int, default=256)
    return parser.parse_args()


def main() -> None:
    global settings
    settings = parse_args()
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()

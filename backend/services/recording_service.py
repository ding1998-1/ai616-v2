"""录音文件服务：分块幂等落盘、合并和事件查询。

该服务不依赖 FastAPI。录音原始分块不会被自动删除，满足录音证据可追溯要求。
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from backend.config import MEETING_FILES_DIR
from backend.db import _db_connect, _db_get_audio_client, _init_app_db


AUDIO_EXTENSIONS = {".webm", ".mp3", ".m4a", ".wav", ".ogg", ".mp4"}
_MANIFEST_LOCK = threading.Lock()
_COMPLETION_LOCKS: dict[str, asyncio.Lock] = {}
_COMPLETION_LOCKS_GUARD = threading.Lock()


def recording_dir(meeting_id: str) -> Path:
    path = MEETING_FILES_DIR / "recordings" / meeting_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def recording_completion_lock(meeting_id: str, session_id: str) -> asyncio.Lock:
    """Serialize concurrent completion retries for one recording session."""
    key = f"{meeting_id}:{sanitize_client_id(session_id) or 'legacy'}"
    with _COMPLETION_LOCKS_GUARD:
        lock = _COMPLETION_LOCKS.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _COMPLETION_LOCKS[key] = lock
        return lock


def sanitize_client_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "", value or "")[:32]


def extension_for_mime(mime: str, filename: str = "") -> str:
    mime = (mime or "").lower()
    if "mp4" in mime:
        return ".mp4"
    if "webm" in mime:
        return ".webm"
    if "ogg" in mime:
        return ".ogg"
    suffix = Path(filename or "").suffix.lower()
    return suffix if suffix in AUDIO_EXTENSIONS else ".webm"


def chunk_name(
    client_id: str,
    username: str,
    chunk_index: int,
    extension: str,
    session_id: str = "",
) -> str:
    owner = sanitize_client_id(client_id) or sanitize_client_id(username) or "unknown"
    session = sanitize_client_id(session_id)
    if session:
        return f"chunk_{owner}_{session}_{int(chunk_index):06d}{extension}"
    return f"chunk_{owner}_{int(chunk_index):06d}{extension}"


def legacy_chunk_name(chunk_index: int, extension: str) -> str:
    return f"chunk_{int(chunk_index):06d}{extension}"


def atomic_write(path: Path, content: bytes) -> None:
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        with tmp.open("wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def _manifest_path(directory: Path, session_id: str) -> Path:
    return directory / f"recording_{sanitize_client_id(session_id) or 'legacy'}.manifest.json"


def _load_manifest(directory: Path, session_id: str) -> dict:
    path = _manifest_path(directory, session_id)
    if not path.exists():
        return {"sessionId": session_id, "chunks": {}, "finalized": False}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"sessionId": session_id, "chunks": {}, "finalized": False, "recovered": True}


def get_recording_manifest(directory: Path, session_id: str) -> dict:
    """Read one session manifest for idempotent completion checks."""
    with _MANIFEST_LOCK:
        return dict(_load_manifest(directory, session_id))


def record_chunk_receipt(directory: Path, session_id: str, chunk_index: int, path: Path,
                         client_id: str, user_id: str, chunk_start_ms: int | None = None,
                         duration_ms: int | None = None) -> dict:
    """Persist a recovery manifest after the chunk has been durably stored."""
    with _MANIFEST_LOCK:
        manifest = _load_manifest(directory, session_id)
        manifest.update({"sessionId": session_id, "clientId": client_id, "userId": user_id})
        manifest.setdefault("chunks", {})[str(chunk_index)] = {
            "index": chunk_index, "fileName": path.name, "size": path.stat().st_size,
            "startMs": chunk_start_ms, "durationMs": duration_ms,
            "receivedAt": datetime.now(timezone.utc).isoformat(),
        }
        chunks = sorted(manifest["chunks"].values(), key=lambda item: item["index"])
        manifest["receivedChunks"] = [item["index"] for item in chunks]
        manifest["checkpoints"] = [
            {"checkpoint": offset // 10, "startChunk": group[0]["index"], "endChunk": group[-1]["index"],
             "bytes": sum(int(item.get("size") or 0) for item in group), "startMs": group[0].get("startMs"),
             "endMs": ((group[-1].get("startMs") or 0) + (group[-1].get("durationMs") or 0)
                       if group[-1].get("startMs") is not None else None)}
            for offset in range(0, len(chunks), 10) for group in [chunks[offset:offset + 10]]
        ]
        atomic_write(_manifest_path(directory, session_id), json.dumps(manifest, ensure_ascii=False).encode("utf-8"))
        return manifest


def finalize_recording_manifest(directory: Path, session_id: str, final_chunk_count: int,
                                output: Path, recording_start_time: str | None,
                                audio_event_id: str = "") -> dict:
    with _MANIFEST_LOCK:
        manifest = _load_manifest(directory, session_id)
        manifest.update({"finalized": True, "finalChunkCount": final_chunk_count,
                         "recordingStartTime": recording_start_time, "outputFile": output.name,
                         "audioEventId": audio_event_id,
                         "outputBytes": output.stat().st_size,
                         "finalizedAt": datetime.now(timezone.utc).isoformat()})
        atomic_write(_manifest_path(directory, session_id), json.dumps(manifest, ensure_ascii=False).encode("utf-8"))
        return manifest


def store_chunk(directory: Path, name: str, content: bytes) -> tuple[Path, bool]:
    path = directory / name
    if path.exists() and path.stat().st_size > 0:
        return path, True
    atomic_write(path, content)
    return path, False


def audio_client_owned_by(meeting_id: str, client_id: str, user: dict) -> bool:
    """判断设备是否属于当前身份；首次见到的设备由当前身份注册。"""
    safe_client = sanitize_client_id(client_id)
    if not safe_client:
        return True
    owner = _db_get_audio_client(meeting_id, safe_client)
    if not owner:
        return True
    user_id = str(user.get("id") or user.get("username") or "")
    owner_id = str(owner.get("user_id") or owner.get("username") or "")
    return bool(user.get("role") == "admin" or (user_id and user_id == owner_id))


def _probe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "csv=p=0", str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    try:
        return float(result.stdout.strip())
    except (TypeError, ValueError):
        return 0.0


def _join_continuous_chunks(chunks: list[Path], output: Path) -> None:
    """MediaRecorder 后续分片是连续 cluster，必须原样顺序拼接。"""

    with output.open("wb") as target:
        for chunk in chunks:
            with chunk.open("rb") as source:
                shutil.copyfileobj(source, target, length=1024 * 1024)
        target.flush()
        os.fsync(target.fileno())


async def merge_chunks(
    directory: Path,
    chunks: list[Path],
    audio_id: str,
    expected_duration_seconds: int | None = None,
) -> Path:
    """恢复连续 MediaRecorder 容器并 remux，拒绝伪成功的残缺音频。"""
    output = directory / f"{audio_id}.mp4"
    temp_output = directory / f".{audio_id}.tmp.mp4"
    joined_input = directory / f".{audio_id}.joined{chunks[0].suffix.lower()}"
    try:
        await asyncio.to_thread(_join_continuous_chunks, chunks, joined_input)
        process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-i", str(joined_input),
            "-c", "copy", "-movflags", "+faststart", str(temp_output),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await process.communicate()
        if process.returncode != 0 or not temp_output.exists() or temp_output.stat().st_size == 0:
            detail = stderr.decode("utf-8", errors="ignore")[-500:]
            raise RuntimeError(detail or "录音 remux 失败")
        actual_duration = await asyncio.to_thread(_probe_duration, temp_output)
        if actual_duration <= 0:
            raise RuntimeError("录音合并结果无法读取时长")
        expected = float(expected_duration_seconds or 0)
        if expected >= 5 and actual_duration < expected * 0.8:
            raise RuntimeError(
                f"录音合并不完整：期望约 {expected:.0f} 秒，实际 {actual_duration:.1f} 秒"
            )
        temp_output.replace(output)
    finally:
        joined_input.unlink(missing_ok=True)
        temp_output.unlink(missing_ok=True)
    return output


def store_single_audio(directory: Path, audio_id: str, extension: str, content: bytes) -> Path:
    path = directory / f"{audio_id}{extension}"
    atomic_write(path, content)
    return path


def find_audio_event(meeting_id: str, audio_id: str) -> dict | None:
    _init_app_db()
    with _db_connect() as conn:
        row = conn.execute(
            "SELECT payload_json FROM meeting_events WHERE meeting_id = ? AND id = ? AND type = 'audio'",
            (meeting_id, audio_id),
        ).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["payload_json"] or "{}")
    except Exception:
        return None

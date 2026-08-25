"""录音文件服务：分块幂等落盘、合并和事件查询。

该服务不依赖 FastAPI。录音原始分块不会被自动删除，满足录音证据可追溯要求。
"""

import asyncio
import json
import os
import re
import uuid
from pathlib import Path

from backend.config import MEETING_FILES_DIR
from backend.db import _db_connect, _db_get_audio_client, _init_app_db


AUDIO_EXTENSIONS = {".webm", ".mp3", ".m4a", ".wav", ".ogg", ".mp4"}


def recording_dir(meeting_id: str) -> Path:
    path = MEETING_FILES_DIR / "recordings" / meeting_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def sanitize_client_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "", value or "")[:32]


def extension_for_mime(mime: str, filename: str = "") -> str:
    mime = (mime or "").lower()
    if "mp4" in mime:
        return ".mp4"
    if "ogg" in mime:
        return ".ogg"
    suffix = Path(filename or "").suffix.lower()
    return suffix if suffix in AUDIO_EXTENSIONS else ".webm"


def chunk_name(client_id: str, username: str, chunk_index: int, extension: str) -> str:
    owner = sanitize_client_id(client_id) or sanitize_client_id(username) or "unknown"
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


async def merge_chunks(directory: Path, chunks: list[Path], audio_id: str) -> Path:
    """使用 ffmpeg 封装；失败时保留可恢复的二进制拼接结果。"""
    output = directory / f"{audio_id}.mp4"
    temp_output = directory / f".{audio_id}.tmp.mp4"
    concat_list = directory / f".{audio_id}.concat.txt"
    try:
        concat_list.write_text(
            "".join(f"file '{chunk.as_posix().replace(chr(39), chr(39) + chr(39) + chr(39))}'\n" for chunk in chunks),
            encoding="utf-8",
        )
        process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-c", "copy", "-movflags", "+faststart", str(temp_output),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await process.communicate()
        if process.returncode != 0 or not temp_output.exists() or temp_output.stat().st_size == 0:
            # 不删除原始分块，降级结果仍然可被后续人工/任务恢复。
            atomic_write(temp_output, b"".join(chunk.read_bytes() for chunk in chunks))
        temp_output.replace(output)
    finally:
        concat_list.unlink(missing_ok=True)
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

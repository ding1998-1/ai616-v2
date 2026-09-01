"""会后 Whisper 终审任务。

任务固定使用 ``backend.whisper_transcribe`` 的本地模型，不调用外部 ASR。
调度状态和最终结果都写入会议事件，进程重启后页面仍能得到真实状态。
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.config import MEETING_FILES_DIR, MEETINGS_LOCK
from backend.db import _load_meetings
from backend.deps import _append_meeting_activity_light


logger = logging.getLogger(__name__)
_semaphore = asyncio.Semaphore(1)
_tasks: dict[str, asyncio.Task] = {}
_audio_extensions = {".webm", ".mp4", ".m4a", ".wav", ".mp3", ".ogg"}


def _meeting_events(meeting_id: str) -> list[dict]:
    with MEETINGS_LOCK:
        meeting = _load_meetings().get(meeting_id) or {}
        return list(meeting.get("events") or [])


def whisper_review_status(meeting_id: str) -> dict[str, Any]:
    events = _meeting_events(meeting_id)
    results = [
        item for item in events
        if item.get("type") == "transcript" and item.get("action") == "whisper-review"
    ]
    result = max(results, key=lambda item: str(item.get("serverTime") or ""), default=None)
    status_rank = {"queued": 1, "running": 2, "interrupted": 3, "failed": 4, "done": 5}
    statuses = [item for item in events if item.get("action") == "whisper-review-status"]
    status_event = max(
        statuses,
        key=lambda item: (
            str(item.get("serverTime") or ""),
            status_rank.get(str(item.get("status") or ""), 0),
        ),
        default=None,
    )
    task = _tasks.get(meeting_id)
    if task and not task.done():
        persisted = (status_event or {}).get("status")
        status = persisted if persisted in {"queued", "running"} else "queued"
    elif result:
        status = "done"
    else:
        status = (status_event or {}).get("status") or "idle"
    return {
        "status": status,
        "updatedAt": (status_event or result or {}).get("serverTime", ""),
        "error": (status_event or {}).get("error", "") if status == "failed" else "",
        "sourceFiles": (result or {}).get("sourceFiles", 0),
        "segmentCount": len((result or {}).get("segments") or []),
    }


def _append_status(meeting_id: str, status: str, error: str = "") -> None:
    _append_meeting_activity_light(
        meeting_id,
        {
            "id": f"whisper_status_{uuid.uuid4().hex[:10]}",
            "type": "system",
            "action": "whisper-review-status",
            "meetingId": meeting_id,
            "status": status,
            "error": error,
            "serverTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
    )


def _audio_files(meeting_id: str) -> list[Path]:
    directory = MEETING_FILES_DIR / "recordings" / meeting_id
    if not directory.is_dir():
        return []
    candidates = sorted(
        path
        for path in directory.iterdir()
        if path.is_file()
        and path.suffix.lower() in _audio_extensions
        and not path.name.startswith(("chunk_", "_merged_whisper"))
    )
    if not candidates:
        return []
    by_name = {path.name: path for path in candidates}
    selected: list[Path] = []
    seen_sessions: set[str] = set()
    seen_names: set[str] = set()
    # A client may retry /audio/complete. Keep only the newest file for each
    # recording session so Whisper never transcribes the same recording twice.
    for event in reversed(_meeting_events(meeting_id)):
        if event.get("type") != "audio" or event.get("action") != "audio-uploaded":
            continue
        name = str(event.get("storedName") or event.get("fileName") or "")
        path = by_name.get(name)
        if path is None:
            continue
        session_id = str(event.get("sessionId") or "")
        if session_id and session_id in seen_sessions:
            continue
        if name in seen_names:
            continue
        if session_id:
            seen_sessions.add(session_id)
        seen_names.add(name)
        selected.append(path)
    # Preserve legacy/direct uploads that have no matching event metadata.
    referenced_audio_names = {
        str(event.get("storedName") or event.get("fileName") or "")
        for event in _meeting_events(meeting_id)
        if event.get("type") == "audio"
    }
    selected.extend(
        path for path in candidates
        if path.name not in seen_names
        and (not path.name.startswith("audio_") or path.name not in referenced_audio_names)
    )
    return sorted(selected)


def _valid_audio_files(files: list[Path]) -> list[Path]:
    valid = []
    for path in files:
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                capture_output=True,
                timeout=15,
                check=False,
            )
            if probe.returncode == 0 and probe.stdout.strip():
                valid.append(path)
        except (OSError, subprocess.SubprocessError):
            logger.warning("Whisper 跳过无效录音：%s", path)
    return valid


def _merge_audio(files: list[Path], output: Path) -> None:
    input_args: list[str] = []
    for path in files:
        input_args.extend(["-i", str(path)])
    if len(files) == 1:
        command = [
            "ffmpeg", "-y", *input_args, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000", str(output),
        ]
    else:
        command = [
            "ffmpeg", "-y", *input_args,
            "-filter_complex", f"concat=n={len(files)}:v=0:a=1[out];[out]loudnorm=I=-16:TP=-1.5:LRA=11[norm]",
            "-map", "[norm]", "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000", str(output),
        ]
    result = subprocess.run(command, capture_output=True, timeout=600, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", errors="ignore")[-500:] or "ffmpeg 合并失败")


async def _run_review(meeting_id: str, force: bool) -> None:
    async with _semaphore:
        if not force and whisper_review_status(meeting_id)["status"] == "done":
            return
        _append_status(meeting_id, "running")
        merged = MEETING_FILES_DIR / "recordings" / meeting_id / "_merged_whisper.wav"
        try:
            files = _valid_audio_files(_audio_files(meeting_id))
            if not files:
                raise RuntimeError("没有可用于 Whisper 终审的完整录音")
            await asyncio.to_thread(_merge_audio, files, merged)
            if not merged.is_file() or merged.stat().st_size < 32000:
                raise RuntimeError("合并后的录音为空或过短")
            from backend.whisper_transcribe import transcribe_file

            result = await asyncio.to_thread(
                transcribe_file,
                str(merged),
                model_size="large-v3",
                language="zh",
            )
            text = str(result.get("text") or "").strip()
            if not text:
                raise RuntimeError("Whisper 未返回有效文字")
            _append_meeting_activity_light(
                meeting_id,
                {
                    "id": f"whisper_review_{uuid.uuid4().hex[:10]}",
                    "type": "transcript",
                    "action": "whisper-review",
                    "meetingId": meeting_id,
                    "serverTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "text": text,
                    "model": "Whisper-large-v3",
                    "sourceFiles": len(files),
                    "segments": result.get("segments") or [],
                    "duration": result.get("duration") or 0,
                    "sourceFileNames": [path.name for path in files],
                },
            )
            _append_status(meeting_id, "done")
        except asyncio.CancelledError:
            logger.warning("Whisper 终审因服务停机中断 meeting=%s", meeting_id)
            _append_status(meeting_id, "interrupted", "服务重启，任务可重新执行")
            raise
        except Exception as exc:
            logger.exception("Whisper 终审失败 meeting=%s", meeting_id)
            _append_status(meeting_id, "failed", str(exc)[:500])
        finally:
            merged.unlink(missing_ok=True)


def schedule_whisper_review(meeting_id: str, force: bool = False) -> dict[str, Any]:
    current = _tasks.get(meeting_id)
    if current and not current.done():
        return whisper_review_status(meeting_id)
    if not force and whisper_review_status(meeting_id)["status"] == "done":
        return whisper_review_status(meeting_id)
    _append_status(meeting_id, "queued")
    task = asyncio.create_task(_run_review(meeting_id, force), name=f"whisper-review-{meeting_id}")
    _tasks[meeting_id] = task
    task.add_done_callback(lambda _: _tasks.pop(meeting_id, None))
    return {"status": "queued", "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "error": ""}


async def shutdown_whisper_reviews(timeout: float = 2.0) -> None:
    """有界取消当前进程调度的终审任务，避免阻塞 8002 退出。"""

    active = [task for task in tuple(_tasks.values()) if not task.done()]
    if not active:
        return
    for task in active:
        task.cancel()
    done, pending = await asyncio.wait(active, timeout=max(0.0, timeout))
    for task in done:
        try:
            task.result()
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Whisper 终审任务退出时异常")
    if pending:
        logger.warning("仍有 %s 个 Whisper 终审任务超过停机清理时限", len(pending))

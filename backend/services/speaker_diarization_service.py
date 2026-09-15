"""PC 完整录音的异步说话人分离派生任务。"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import hashlib
import threading
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.config import MEETING_FILES_DIR, MEETINGS_LOCK, sse_manager
from backend.db import _load_meetings
from backend.services.gpu_job_coordinator import GPU_POST_PROCESSING_SEMAPHORE
from backend.services.recording_service import find_audio_event


logger = logging.getLogger(__name__)
_tasks: dict[str, asyncio.Task] = {}
_semaphore = GPU_POST_PROCESSING_SEMAPHORE
_queued_fingerprints: dict[str, set[str]] = {}
_identity_lock = threading.RLock()


def _identities(meeting_id: str) -> dict:
    try:
        return json.loads((_result_dir(meeting_id) / "identities.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"names": {}, "history": []}


def set_speaker_name(meeting_id: str, audio_event_id: str, speaker_id: str, name: str, user: dict) -> dict:
    """Persist meeting-local annotations without rewriting source evidence."""
    with _identity_lock:
        try:
            state = json.loads(_audio_state_path(meeting_id, audio_event_id).read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError("没有可确认的分离结果") from exc
        if state.get("status") != "done" or not any(s.get("speakerId") == speaker_id for s in state.get("speakers", [])):
            raise ValueError("发言人不存在或分离尚未完成")
        data = _identities(meeting_id)
        key = json.dumps([audio_event_id, speaker_id], ensure_ascii=False, separators=(",", ":"))
        previous = data["names"].get(key, "")
        name = name.strip()
        data["names"][key] = name
        data["history"].append({
            "audioEventId": audio_event_id, "speakerId": speaker_id,
            "previousName": previous, "name": name,
            "actor": user.get("username") or user.get("id") or "",
            "confirmedAt": datetime.now().isoformat(timespec="seconds"),
        })
        path = _result_dir(meeting_id) / "identities.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
    return diarization_status(meeting_id)


def _invalidate_speaker_names(meeting_id: str, audio_event_id: str) -> None:
    """A new clustering run must not inherit names from old speaker IDs."""
    data = _identities(meeting_id)
    changed = False
    for key, name in list(data["names"].items()):
        try:
            recording_id, speaker_id = json.loads(key)
        except (ValueError, TypeError):
            continue
        if recording_id == audio_event_id and name:
            data["names"][key] = ""
            data["history"].append({"audioEventId": audio_event_id, "speakerId": speaker_id,
                "previousName": name, "name": "", "actor": "system",
                "reason": "diarization_rerun", "confirmedAt": datetime.now().isoformat(timespec="seconds")})
            changed = True
    if changed:
        path = _result_dir(meeting_id) / "identities.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)


def _audio_state_path(meeting_id: str, audio_event_id: str) -> Path:
    key = hashlib.sha256(audio_event_id.encode()).hexdigest()
    return _result_dir(meeting_id) / f"audio-{key}.json"


def diarization_enabled() -> bool:
    return os.environ.get("SPEAKER_DIARIZATION_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _result_dir(meeting_id: str) -> Path:
    return MEETING_FILES_DIR / "recordings" / meeting_id / "derived" / "speaker-diarization"


def _state_path(meeting_id: str) -> Path:
    return _result_dir(meeting_id) / "latest.json"


def _read_state(meeting_id: str) -> dict[str, Any]:
    path = _state_path(meeting_id)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_state(meeting_id: str, state: dict[str, Any]) -> None:
    path = _state_path(meeting_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)
    if state.get("audioEventId"):
        audio_path = _audio_state_path(meeting_id, state["audioEventId"])
        audio_temporary = audio_path.with_suffix(".tmp")
        audio_temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        audio_temporary.replace(audio_path)


def _fingerprint(path: Path) -> str:
    stat = path.stat()
    return f"{path.name}:{stat.st_size}:{stat.st_mtime_ns}"


def _normalize_audio(source: Path, output: Path) -> None:
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(source), "-vn", "-acodec", "pcm_s16le",
            "-ac", "1", "-ar", "16000", str(output),
        ],
        capture_output=True,
        timeout=1800,
        check=False,
    )
    if result.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
        detail = result.stderr.decode("utf-8", errors="ignore")[-500:]
        raise RuntimeError(detail or "PC 录音标准化失败")


async def _run_isolated_worker(source: Path, output: Path) -> list[dict[str, Any]]:
    worker_python = os.environ.get("SPEAKER_DIARIZATION_PYTHON", "").strip()
    if not worker_python:
        raise RuntimeError("未配置独立说话人分离运行环境")
    executable = Path(worker_python)
    if not executable.is_file():
        raise RuntimeError("独立说话人分离解释器不存在")
    project_root = Path(__file__).resolve().parents[2]
    model = os.environ.get(
        "SPEAKER_DIARIZATION_MODEL",
        "pyannote/speaker-diarization-community-1",
    ).strip()
    env = os.environ.copy()
    env.setdefault("TRANSFORMERS_OFFLINE", "1")
    env.setdefault("HF_HUB_OFFLINE", "1")
    process = await asyncio.create_subprocess_exec(
        str(executable), "-m", "backend.speaker_diarization_worker",
        "--input", str(source), "--output", str(output),
        "--device", os.environ.get("SPEAKER_DIARIZATION_DEVICE", "cuda:1"),
        "--model", model,
        cwd=str(project_root),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    timeout = max(60, int(os.environ.get("SPEAKER_DIARIZATION_TIMEOUT_SECONDS", "7200")))
    try:
        _, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except (asyncio.CancelledError, asyncio.TimeoutError):
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
        raise
    if process.returncode != 0:
        detail = stderr.decode("utf-8", errors="ignore")[-1000:]
        raise RuntimeError(detail or f"说话人分离子进程退出码 {process.returncode}")
    try:
        payload = json.loads(output.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("说话人分离结果文件无效") from exc
    segments = payload.get("segments") if isinstance(payload, dict) else None
    if not isinstance(segments, list) or not segments:
        raise RuntimeError("说话人分离未返回有效片段")
    return segments


def _stable_speaker_labels(segments: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    ordered = sorted(segments, key=lambda item: (float(item.get("start", 0)), float(item.get("end", 0))))
    labels: dict[str, str] = {}
    normalized = []
    for item in ordered:
        raw_label = str(item.get("speaker") or "UNKNOWN")
        if raw_label not in labels:
            labels[raw_label] = f"发言人 {len(labels) + 1}"
        normalized.append({
            "start": round(float(item.get("start", 0)), 3),
            "end": round(float(item.get("end", 0)), 3),
            "speakerId": raw_label,
            "speakerLabel": labels[raw_label],
        })
    return normalized, labels


def _latest_whisper_segments(meeting_id: str, source_file: str = "") -> list[dict[str, Any]]:
    with MEETINGS_LOCK:
        events = list((_load_meetings().get(meeting_id) or {}).get("events") or [])
    reviews = [
        item for item in events
        if item.get("type") == "transcript" and item.get("action") == "whisper-review"
    ]
    latest = max(reviews, key=lambda item: str(item.get("serverTime") or ""), default={})
    if source_file and latest.get("sourceFileNames") != [source_file]:
        return []
    return list(latest.get("segments") or [])


def _align_whisper_segments(
    whisper_segments: list[dict[str, Any]],
    diarization_segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    aligned = []
    for whisper in whisper_segments:
        start = float(whisper.get("start", 0))
        end = float(whisper.get("end", start))
        best = None
        best_overlap = 0.0
        for speaker in diarization_segments:
            overlap = max(0.0, min(end, float(speaker["end"])) - max(start, float(speaker["start"])))
            if overlap > best_overlap:
                best_overlap = overlap
                best = speaker
        duration = max(0.001, end - start)
        accepted = best is not None and best_overlap / duration >= 0.25
        aligned.append({
            **whisper,
            "speakerId": best.get("speakerId") if accepted else "",
            "speakerLabel": best.get("speakerLabel") if accepted else "会议室麦克风",
            "identifiedBy": "speaker-diarization" if accepted else "room-microphone",
            "speakerOverlapRatio": round(best_overlap / duration, 4) if accepted else 0,
        })
    return aligned


def refresh_whisper_alignment(meeting_id: str) -> dict[str, Any]:
    state = _read_state(meeting_id)
    if state.get("status") != "done" or not state.get("segments"):
        return diarization_status(meeting_id)
    whisper_segments = _latest_whisper_segments(meeting_id, state.get("sourceFile", ""))
    if whisper_segments:
        state["alignedWhisperSegments"] = _align_whisper_segments(whisper_segments, state["segments"])
        state["alignedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        _write_state(meeting_id, state)
    return diarization_status(meeting_id)


async def _publish_status(meeting_id: str, state: dict[str, Any]) -> None:
    await sse_manager.publish(meeting_id, "speaker-diarization", {
        "meetingId": meeting_id,
        "status": state.get("status", "idle"),
        "speakerCount": state.get("speakerCount", 0),
        "segmentCount": state.get("segmentCount", 0),
        "error": state.get("error", ""),
        "updatedAt": state.get("updatedAt", ""),
    })


async def _run(meeting_id: str, audio_path: Path, audio_event_id: str, fingerprint: str) -> None:
    async with _semaphore:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        state = {
            "status": "running", "meetingId": meeting_id, "audioEventId": audio_event_id,
            "sourceFile": audio_path.name, "sourceFingerprint": fingerprint, "updatedAt": now,
            "error": "", "segments": [], "speakers": [],
        }
        with _identity_lock:
            _invalidate_speaker_names(meeting_id, audio_event_id)
            _write_state(meeting_id, state)
        await _publish_status(meeting_id, state)
        result_dir = _result_dir(meeting_id)
        result_dir.mkdir(parents=True, exist_ok=True)
        normalized_audio = result_dir / f"{audio_event_id}.16k-mono.wav"
        worker_output = result_dir / f"{audio_event_id}.worker.json"
        try:
            await asyncio.to_thread(_normalize_audio, audio_path, normalized_audio)
            raw_segments = await _run_isolated_worker(normalized_audio, worker_output)
            if not raw_segments:
                raise RuntimeError("说话人分离未返回有效片段")
            segments, label_map = _stable_speaker_labels(raw_segments)
            state.update({
                "status": "done",
                "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "segments": segments,
                "speakers": [
                    {"speakerId": speaker_id, "speakerLabel": speaker_label, "identity": None}
                    for speaker_id, speaker_label in label_map.items()
                ],
                "segmentCount": len(segments),
                "speakerCount": len(label_map),
            })
            whisper_segments = _latest_whisper_segments(meeting_id, audio_path.name)
            if whisper_segments:
                state["alignedWhisperSegments"] = _align_whisper_segments(whisper_segments, segments)
                state["alignedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            _write_state(meeting_id, state)
            await _publish_status(meeting_id, state)
        except asyncio.CancelledError:
            state.update({"status": "interrupted", "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
            _write_state(meeting_id, state)
            await _publish_status(meeting_id, state)
            raise
        except Exception as exc:
            logger.exception("PC 说话人分离失败 meeting=%s audio=%s", meeting_id, audio_path.name)
            state.update({
                "status": "failed", "error": str(exc)[:500],
                "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            })
            _write_state(meeting_id, state)
            await _publish_status(meeting_id, state)
        finally:
            normalized_audio.unlink(missing_ok=True)
            worker_output.unlink(missing_ok=True)


async def _run_after_whisper_priority_window(
    meeting_id: str, audio_path: Path, audio_event_id: str, fingerprint: str,
) -> None:
    try:
        delay = max(0.0, float(os.environ.get("SPEAKER_DIARIZATION_START_DELAY_SECONDS", "15")))
        if delay:
            await asyncio.sleep(delay)
        await _run(meeting_id, audio_path, audio_event_id, fingerprint)
    except asyncio.CancelledError:
        state = _read_state(meeting_id)
        if state.get("status") == "queued":
            state.update({
                "status": "interrupted", "error": "服务重启，任务可重新执行",
                "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            })
            _write_state(meeting_id, state)
        raise


def diarization_status(meeting_id: str) -> dict[str, Any]:
    state = _read_state(meeting_id)
    recordings = []
    for path in sorted(_result_dir(meeting_id).glob("audio-*.json")):
        try:
            recordings.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    task = _tasks.get(meeting_id)
    active = bool(task and not task.done())
    if active and state.get("status") not in {"queued", "running"}:
        state["status"] = "queued"
    if not active:
        for item in [state, *recordings]:
            if item.get("status") in {"queued", "running"}:
                item.update(status="interrupted", error="任务已中断，可重新执行本段分离")
    return {
        "enabled": diarization_enabled(),
        "status": state.get("status", "idle"),
        "updatedAt": state.get("updatedAt", ""),
        "error": state.get("error", ""),
        "audioEventId": state.get("audioEventId", ""),
        "sourceFile": state.get("sourceFile", ""),
        "speakerCount": state.get("speakerCount", 0),
        "segmentCount": state.get("segmentCount", 0),
        "speakers": state.get("speakers", []),
        "segments": state.get("segments", []),
        "alignedWhisperSegments": state.get("alignedWhisperSegments", []),
        "recordings": recordings,
        "identities": _identities(meeting_id),
    }


def schedule_speaker_diarization(
    meeting_id: str,
    audio_path: Path,
    audio_event_id: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    if not diarization_enabled():
        return diarization_status(meeting_id)
    meeting = _load_meetings().get(meeting_id) or {}
    if meeting.get("type") != "快速会议":
        return {**diarization_status(meeting_id), "eligible": False, "reason": "仅快速会议支持电脑说话人分离"}
    expected_path = MEETING_FILES_DIR / "recordings" / meeting_id / audio_path.name
    source_event = find_audio_event(meeting_id, audio_event_id) or {}
    trusted = (source_event.get("storedName") == audio_path.name
        and source_event.get("deviceType") == "desktop" and not source_event.get("clientId"))
    if audio_path.resolve() != expected_path.resolve() or not trusted:
        return {**diarization_status(meeting_id), "eligible": False, "reason": "缺少已保存的电脑录音凭据"}
    if not audio_path.is_file() or audio_path.stat().st_size == 0:
        return {**diarization_status(meeting_id), "status": "failed", "error": "完整录音不存在"}
    fingerprint = _fingerprint(audio_path)
    if fingerprint in _queued_fingerprints.get(meeting_id, set()):
        return diarization_status(meeting_id)
    current = _tasks.get(meeting_id)
    previous = _read_state(meeting_id)
    saved_path = _audio_state_path(meeting_id, audio_event_id)
    if saved_path.is_file():
        try:
            previous = json.loads(saved_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    if not force and previous.get("status") == "done" and previous.get("sourceFingerprint") == fingerprint:
        return diarization_status(meeting_id)
    _write_state(meeting_id, {
        "status": "queued", "meetingId": meeting_id, "audioEventId": audio_event_id,
        "sourceFile": audio_path.name, "sourceFingerprint": fingerprint,
        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "error": "",
    })
    async def run_queued():
        if current and not current.done():
            await asyncio.gather(current, return_exceptions=True)
        await _run_after_whisper_priority_window(meeting_id, audio_path, audio_event_id, fingerprint)

    _queued_fingerprints.setdefault(meeting_id, set()).add(fingerprint)
    task = asyncio.create_task(
        run_queued(),
        name=f"speaker-diarization-{meeting_id}",
    )
    _tasks[meeting_id] = task
    def finished(completed):
        _queued_fingerprints.get(meeting_id, set()).discard(fingerprint)
        if _tasks.get(meeting_id) is completed:
            _tasks.pop(meeting_id, None)
    task.add_done_callback(finished)
    asyncio.create_task(_publish_status(meeting_id, _read_state(meeting_id)))
    return diarization_status(meeting_id)


def retry_speaker_diarization(meeting_id: str, audio_event_id: str = "") -> dict[str, Any]:
    state = _read_state(meeting_id)
    if audio_event_id:
        try:
            state = json.loads(_audio_state_path(meeting_id, audio_event_id).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"status": "failed", "error": "没有可重试的录音结果"}
    source_file = str(state.get("sourceFile") or "")
    audio_event_id = str(state.get("audioEventId") or "")
    audio_path = MEETING_FILES_DIR / "recordings" / meeting_id / source_file
    if source_file != Path(source_file).name:
        return {"status": "failed", "error": "录音路径无效"}
    if not source_file or not audio_event_id:
        return {**diarization_status(meeting_id), "status": "failed", "error": "没有可重试的 PC 完整录音"}
    return schedule_speaker_diarization(meeting_id, audio_path, audio_event_id, force=True)


async def shutdown_speaker_diarization(timeout: float = 2.0) -> None:
    active = [task for task in tuple(_tasks.values()) if not task.done()]
    for task in active:
        task.cancel()
    if active:
        await asyncio.wait(active, timeout=max(0.0, timeout))

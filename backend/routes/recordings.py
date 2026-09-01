"""多人手机录音：会话、分块、完整音频和下载。"""

import asyncio
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from backend.config import MAX_AUDIO_BYTES, sse_manager
from backend.dependencies import require_meeting
from backend.deps import _append_meeting_activity_light, _resolve_meeting_role
from backend.models import MeetingRecorderSessionRequest
from backend.services.recording_service import (
    AUDIO_EXTENSIONS,
    chunk_name,
    extension_for_mime,
    find_audio_event,
    merge_chunks,
    record_chunk_receipt,
    finalize_recording_manifest,
    get_recording_manifest,
    recording_dir,
    recording_completion_lock,
    sanitize_client_id,
    store_chunk,
    store_single_audio,
    audio_client_owned_by,
)
from backend.db import _db_upsert_audio_client


router = APIRouter(prefix="/api/meeting/recorder", tags=["recordings"])


@router.get("/audio/status")
async def audio_upload_status(
    request: Request,
    meeting_id: str = Query(...),
    client_id: str = Query(""),
    session_id: str = Query(""),
):
    """Return durable server ACK state so a refreshed phone can upload only the difference."""
    user, safe_id, _ = require_meeting(request, meeting_id)
    if client_id and not audio_client_owned_by(safe_id, client_id, user):
        raise HTTPException(status_code=403, detail="该录音设备已绑定其他参会人")
    username = (user.get("username") or user.get("name") or "unknown").strip()
    owner = sanitize_client_id(client_id) or sanitize_client_id(username)
    session = sanitize_client_id(session_id)
    pattern = f"chunk_{owner}_{session}_*" if owner and session else f"chunk_{owner}_*"
    received = []
    for chunk in recording_dir(safe_id).glob(pattern):
        match = re.search(r"_(\d{6})\.(?:webm|mp4|ogg)$", chunk.name)
        if match and chunk.is_file() and chunk.stat().st_size > 0:
            received.append(int(match.group(1)))
    return {"success": True, "receivedChunks": sorted(set(received))}


async def _read_upload(file: UploadFile, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        block = await file.read(1024 * 1024)
        if not block:
            break
        total += len(block)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail=f"文件不能超过 {max_bytes // (1024 * 1024)}MB")
        chunks.append(block)
    return b"".join(chunks)


@router.post("/session")
async def recorder_session(request: Request, body: MeetingRecorderSessionRequest):
    user, safe_id, _ = require_meeting(request, body.meeting_id)
    role = _resolve_meeting_role(user)
    client_id = (body.device_id or "").strip()
    if client_id and body.action in {"start", "join", "resume"}:
        _db_upsert_audio_client(safe_id, client_id, user, {
            "device_type": body.device_type or "mobile",
            "device_label": body.device_label or "手机麦克风",
            "firmware_version": body.firmware_version or "",
            "transport": body.transport or "web-mobile",
        })
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    event = {
        "id": f"session_{uuid.uuid4().hex[:12]}",
        "type": "session",
        "action": body.action,
        "meetingId": safe_id,
        "meetingTitle": body.meeting_title,
        "agenda": body.agenda,
        "audioSize": body.audio_size,
        "durationSeconds": body.duration_seconds,
        "deviceType": body.device_type or "mobile",
        "deviceId": body.device_id or "",
        "deviceLabel": body.device_label or "手机麦克风",
        "channel": body.channel or "primary",
        "transport": body.transport or "web-mobile",
        "firmwareVersion": body.firmware_version or "",
        "serverTime": now,
        "speaker": role,
    }
    _append_meeting_activity_light(safe_id, event)
    asyncio.create_task(sse_manager.publish(safe_id, "session", {
        "meetingId": safe_id, "action": body.action, "speaker": role, "serverTime": now,
    }))
    return {"success": True, "event": event, "speaker": role}


@router.post("/audio/chunk")
async def upload_audio_chunk(
    request: Request,
    meeting_id: str = Form(...),
    chunk_index: int = Form(0),
    client_id: str = Form(""),
    session_id: str = Form(""),
    chunk_start_ms: int | None = Form(None),
    chunk_duration_ms: int | None = Form(None),
    file: UploadFile = File(...),
):
    user, safe_id, _ = require_meeting(request, meeting_id)
    username = (user.get("username") or user.get("name") or "unknown").strip()
    if client_id and not audio_client_owned_by(safe_id, client_id, user):
        raise HTTPException(status_code=403, detail="该录音设备已绑定其他参会人")
    if chunk_index < 0:
        raise HTTPException(status_code=400, detail="chunk_index 不能为负数")
    content = await _read_upload(file, 50 * 1024 * 1024)
    extension = extension_for_mime(file.content_type or "", file.filename or "")
    name = chunk_name(client_id, username, chunk_index, extension, session_id)
    path, duplicate = store_chunk(recording_dir(safe_id), name, content)
    manifest = record_chunk_receipt(
        recording_dir(safe_id), session_id, chunk_index, path, client_id,
        str(user.get("id") or user.get("username") or ""), chunk_start_ms, chunk_duration_ms,
    )
    response = {"success": True, "ack": chunk_index, "chunkIndex": chunk_index, "size": path.stat().st_size, "user": username}
    response["checkpoint"] = chunk_index // 10
    response["receivedChunks"] = manifest.get("receivedChunks", [])
    if duplicate:
        response["duplicate"] = True
    return response


@router.post("/audio/complete")
async def complete_audio(
    request: Request,
    meeting_id: str = Form(...),
    meeting_title: str = Form(""),
    agenda: str = Form(""),
    duration_seconds: int | None = Form(None),
    total_chunks: int = Form(0),
    recording_start_time: str | None = Form(None),
    client_id: str = Form(""),
    session_id: str = Form(""),
):
    user, safe_id, _ = require_meeting(request, meeting_id)
    username = (user.get("username") or user.get("name") or "unknown").strip()
    if client_id and not audio_client_owned_by(safe_id, client_id, user):
        raise HTTPException(status_code=403, detail="该录音设备已绑定其他参会人")
    directory = recording_dir(safe_id)
    owner = sanitize_client_id(client_id) or sanitize_client_id(username)
    session = sanitize_client_id(session_id)
    patterns = [f"chunk_{owner}_{session}_*"] if owner and session else ([f"chunk_{owner}_*"] if owner else [])
    chunks = []
    for pattern in patterns:
        chunks.extend(directory.glob(pattern))
    if not chunks and not client_id:
        # 只兼容旧版纯数字命名，禁止把其他参会人的分块混入当前文件。
        chunks = [path for path in directory.glob("chunk_*.*") if re.fullmatch(r"chunk_\d{6}\.(webm|mp4|ogg)", path.name)]
    chunks = sorted({path for path in chunks if path.suffix.lower() in {".webm", ".mp4", ".ogg"} and path.is_file()})
    if not chunks:
        raise HTTPException(status_code=404, detail="无录音片段")
    missing_indexes: list[int] = []
    if total_chunks > 0:
        received_indexes = set()
        for chunk in chunks:
            match = re.search(r"_(\d{6})\.(?:webm|mp4|ogg)$", chunk.name)
            if match:
                received_indexes.add(int(match.group(1)))
        missing_indexes = [index for index in range(total_chunks) if index not in received_indexes]
        if missing_indexes:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "录音分片尚未完整回传，禁止生成不完整录音",
                    "missingChunks": missing_indexes,
                    "receivedChunks": sorted(received_indexes),
                },
            )
    async with recording_completion_lock(safe_id, session_id):
        # Re-read after acquiring the lock: another concurrent request may have
        # completed while this request was validating its chunk list.
        existing_manifest = get_recording_manifest(directory, session_id)
        existing_name = str(existing_manifest.get("outputFile") or "")
        existing_path = directory / existing_name if existing_name else None
        if (
            session_id
            and existing_manifest.get("finalized")
            and existing_path is not None
            and existing_path.is_file()
            and existing_path.stat().st_size > 0
        ):
            existing_id = str(existing_manifest.get("audioEventId") or existing_path.stem)
            return {
                "success": True,
                "duplicate": True,
                "event": {
                    "id": existing_id,
                    "type": "audio",
                    "action": "audio-uploaded",
                    "meetingId": safe_id,
                    "fileName": existing_name,
                    "storedName": existing_name,
                    "audioSize": existing_path.stat().st_size,
                    "sessionId": session_id,
                    "playbackUrl": f"/api/meeting/recorder/audio/{safe_id}/{existing_id}",
                },
                "audioSize": existing_path.stat().st_size,
                "sourceChunksPreserved": True,
            }

        audio_id = f"audio_{uuid.uuid4().hex[:12]}"
        try:
            path = await merge_chunks(
                directory,
                chunks,
                audio_id,
                expected_duration_seconds=duration_seconds,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        manifest = finalize_recording_manifest(
            directory, session_id, total_chunks or len(chunks), path, recording_start_time, audio_id,
        )
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        event = {
            "id": audio_id,
            "type": "audio",
            "action": "audio-uploaded",
            "meetingId": safe_id,
            "meetingTitle": meeting_title,
            "agenda": agenda,
            "serverTime": now,
            "speaker": _resolve_meeting_role(user),
            "fileName": path.name,
            "storedName": path.name,
            "audioSize": path.stat().st_size,
            "durationSeconds": duration_seconds,
            "recordingStartTime": recording_start_time,
            "clientId": client_id,
            "sessionId": session_id,
            "sourceChunks": [chunk.name for chunk in chunks],
            "missingChunks": 0,
            "playbackUrl": f"/api/meeting/recorder/audio/{safe_id}/{audio_id}",
            "checkpoints": manifest.get("checkpoints", []),
        }
        _append_meeting_activity_light(safe_id, event)
        return {"success": True, "event": event, "audioSize": path.stat().st_size, "sourceChunksPreserved": True}


@router.post("/audio")
async def upload_audio(
    request: Request,
    meeting_id: str = Form(...),
    meeting_title: str = Form(""),
    agenda: str = Form(""),
    duration_seconds: int | None = Form(None),
    file: UploadFile = File(...),
):
    user, safe_id, _ = require_meeting(request, meeting_id)
    content = await _read_upload(file, MAX_AUDIO_BYTES)
    extension = extension_for_mime(file.content_type or "", file.filename or "")
    audio_id = f"audio_{uuid.uuid4().hex[:12]}"
    path = store_single_audio(recording_dir(safe_id), audio_id, extension, content)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    event = {
        "id": audio_id, "type": "audio", "action": "audio-uploaded", "meetingId": safe_id,
        "meetingTitle": meeting_title, "agenda": agenda, "serverTime": now,
        "speaker": _resolve_meeting_role(user), "fileName": file.filename or path.name,
        "storedName": path.name, "audioSize": len(content), "durationSeconds": duration_seconds,
        "playbackUrl": f"/api/meeting/recorder/audio/{safe_id}/{audio_id}",
    }
    _append_meeting_activity_light(safe_id, event)
    return {"success": True, "event": event}


@router.get("/audio/{meeting_id}/{audio_id}")
async def download_audio(request: Request, meeting_id: str, audio_id: str):
    _, safe_id, _ = require_meeting(request, meeting_id)
    target = find_audio_event(safe_id, audio_id)
    if not target:
        raise HTTPException(status_code=404, detail="录音文件不存在")
    stored_name = target.get("storedName") or ""
    path = recording_dir(safe_id) / stored_name
    if not stored_name or not path.exists() or path.parent != recording_dir(safe_id):
        raise HTTPException(status_code=404, detail="录音文件不存在")
    media = {".webm": "audio/webm", ".mp4": "audio/mp4", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg"}
    return FileResponse(path, filename=target.get("fileName") or path.name, media_type=media.get(path.suffix.lower(), "audio/webm"))

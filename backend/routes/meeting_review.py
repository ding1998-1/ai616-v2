"""会议辅助域兼容路由。"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from backend.dependencies import require_meeting, require_user
from backend.models import MeetingTranscriptCorrectionRequest
from backend.services.meeting_review_service import (
    DOCX_MIME,
    correct_transcript,
    extract_realtime_todos,
    get_document_status,
    get_settings,
    list_whisper_reviews,
    resolve_legacy_document,
    update_settings,
    update_transcript_speaker,
)
from backend.services.outcome_service import generate_record_documents
from backend.services.whisper_review_service import schedule_whisper_review, whisper_review_status


router = APIRouter(prefix="/api", tags=["meeting-review"])


@router.get("/meetings/{meeting_id}/whisper-review")
async def whisper_review(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        result = list_whisper_reviews(meeting_id, user)
        result["whisperStatus"] = whisper_review_status(meeting_id)
        return result
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/meetings/{meeting_id}/whisper-review/run")
async def run_whisper_review(request: Request, meeting_id: str, force: bool = False):
    _, safe_id, _ = require_meeting(request, meeting_id)
    return {"success": True, "meetingId": safe_id, "whisperStatus": schedule_whisper_review(safe_id, force)}


@router.get("/meetings/{meeting_id}/documents/status")
async def meeting_document_status(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        return {"success": True, **get_document_status(meeting_id, user)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/meetings/{meeting_id}/records/documents/status")
async def records_document_status(request: Request, meeting_id: str):
    """v2 文档状态别名，避免旧前端把 status 当成 kind 下载。"""

    return await meeting_document_status(request, meeting_id)


@router.get("/meetings/{meeting_id}/whisper-docx/status")
async def whisper_document_status(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        status = get_document_status(meeting_id, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"success": True, "meetingId": meeting_id, "whisperDocx": status["whisperDocx"], "documents": status["documents"], "status": status["status"]}


@router.get("/meetings/{meeting_id}/whisper-docx")
async def download_whisper_document(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        path, filename = resolve_legacy_document(meeting_id, user, "whisper")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, filename=filename, media_type=DOCX_MIME)


@router.get("/meetings/{meeting_id}/archive/docx")
async def download_archive_document(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        path, filename = resolve_legacy_document(meeting_id, user, "formal")
    except FileNotFoundError:
        # 旧前端把“记录已生成”等同于“DOCX 已生成”。兼容接口在首次下载时
        # 补建正式件，避免用户得到无法解释的 404。
        try:
            generate_record_documents(meeting_id)
            path, filename = resolve_legacy_document(meeting_id, user, "formal")
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, filename=filename, media_type=DOCX_MIME)


@router.post("/meeting/transcripts/{meeting_id}/{transcript_id}/correction")
async def correct_meeting_transcript(request: Request, meeting_id: str, transcript_id: str, body: MeetingTranscriptCorrectionRequest):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        result = correct_transcript(
            meeting_id,
            transcript_id,
            body.corrected_transcript,
            body.signature_data,
            body.client_time,
            user,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, **result}


@router.post("/meeting/transcripts/{meeting_id}/{transcript_id}/speaker")
async def correct_meeting_speaker(request: Request, meeting_id: str, transcript_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    body = await request.json()
    try:
        result = update_transcript_speaker(
            meeting_id,
            transcript_id,
            body.get("speakerName", ""),
            body.get("speakerRole", ""),
            body.get("speakerDept", ""),
            user,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, **result}


@router.post("/meetings/{meeting_id}/realtime-todos")
async def realtime_todos(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    body = await request.json()
    transcripts = body.get("transcripts", []) if isinstance(body, dict) else []
    return {"success": True, "todos": await extract_realtime_todos(meeting_id, transcripts, user)}


@router.get("/settings")
async def read_settings(request: Request):
    user = require_user(request)
    return {"success": True, **get_settings(user)}


@router.put("/settings")
async def write_settings(request: Request):
    user = require_user(request)
    try:
        result = update_settings(await request.json(), user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {"success": True, **result}

"""会议容器 HTTP 路由。"""

from fastapi import APIRouter, HTTPException, Request

from backend.dependencies import require_meeting, require_user
from backend.db import _public_meeting
from backend.models import MeetingPatchRequest, MeetingStageRequest, MeetingUpsertRequest
from backend.services.meeting_service import (
    archive_meeting,
    get_meeting,
    list_meetings,
    patch_meeting,
    update_stage,
    upsert_meeting,
)
from backend.services.voiceprint_preflight_service import (
    VoiceprintPreflightError,
    check_meeting_voiceprints,
)


router = APIRouter(prefix="/api/meetings", tags=["meetings"])


@router.get("")
async def list_meeting_route(request: Request, include_archived: bool = False, limit: int = 50, offset: int = 0):
    require_user(request)
    return {"success": True, **list_meetings(include_archived, limit, offset)}


@router.post("")
async def upsert_meeting_route(request: Request, body: MeetingUpsertRequest):
    user = require_user(request)
    if body.id:
        current = get_meeting(body.id)
        if current:
            # 更新已有会议时必须具备本场访问权。
            _, _, _ = require_meeting(request, body.id)
    meeting, existed = upsert_meeting(body, user)
    return {"success": True, "meeting": _public_meeting(meeting, include_detail=True)}


@router.get("/{meeting_id}")
async def get_meeting_route(request: Request, meeting_id: str):
    _, safe_id, _ = require_meeting(request, meeting_id)
    meeting = get_meeting(safe_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="会议不存在")
    return {"success": True, "meeting": _public_meeting(meeting, include_detail=True)}


@router.patch("/{meeting_id}")
async def patch_meeting_route(request: Request, meeting_id: str, body: MeetingPatchRequest):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        meeting = patch_meeting(meeting_id, body.model_dump(exclude_unset=True), user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {"success": True, "meeting": _public_meeting(meeting, include_detail=True)}


@router.post("/{meeting_id}/stage")
async def update_stage_route(request: Request, meeting_id: str, body: MeetingStageRequest):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        meeting = update_stage(meeting_id, body.stage, body.phase, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except VoiceprintPreflightError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    response = {"success": True, "meeting": _public_meeting(meeting, include_detail=True)}
    if body.stage == "audit":
        from backend.services.asr_hotword_learning_service import learn_meeting_context
        from backend.services.whisper_review_service import schedule_whisper_review

        response["asrHotwords"] = learn_meeting_context(meeting_id)
        response["whisperStatus"] = schedule_whisper_review(meeting_id)
    return response


@router.get("/{meeting_id}/asr-hotwords")
async def meeting_asr_hotwords_route(request: Request, meeting_id: str):
    _, safe_id, _ = require_meeting(request, meeting_id)
    from backend.services.asr_hotword_learning_service import learned_hotwords_for_meeting

    return {"success": True, **learned_hotwords_for_meeting(safe_id)}


@router.post("/{meeting_id}/asr-hotwords/learn")
async def learn_meeting_asr_hotwords_route(request: Request, meeting_id: str):
    _, safe_id, _ = require_meeting(request, meeting_id)
    from backend.services.asr_hotword_learning_service import learn_meeting_context

    return {"success": True, **learn_meeting_context(safe_id)}


@router.get("/{meeting_id}/voiceprint-preflight")
async def voiceprint_preflight_route(request: Request, meeting_id: str):
    _, safe_id, _ = require_meeting(request, meeting_id)
    return {"success": True, **check_meeting_voiceprints(safe_id)}


@router.delete("/{meeting_id}")
async def archive_meeting_route(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        meeting = archive_meeting(meeting_id, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"success": True, "meeting": _public_meeting(meeting, include_detail=False)}

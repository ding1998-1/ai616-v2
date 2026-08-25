"""议题计时路由。"""

from fastapi import APIRouter, HTTPException, Request

from backend.dependencies import can_manage_meeting, require_meeting, require_user
from backend.services.agenda_timer_service import meeting_timer_action, timer_action


router = APIRouter(prefix="/api/meetings", tags=["agenda-timer"])


@router.post("/{meeting_id}/timer/{action}")
async def meeting_timer(
    request: Request,
    meeting_id: str,
    action: str,
    duration_minutes: int | None = None,
):
    """会议计时器：start / pause / reset / set-duration。"""
    user = require_user(request)
    try:
        return meeting_timer_action(meeting_id, action, duration_minutes, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{meeting_id}/agenda-timer/{agenda_id}")
async def agenda_timer(request: Request, meeting_id: str, agenda_id: str, action: str = "start", extend_minutes: int = 5):
    user, _, meeting = require_meeting(request, meeting_id)
    if not can_manage_meeting(user, meeting):
        raise HTTPException(status_code=403, detail="仅主持人或会议秘书可以操作议题计时")
    try:
        return timer_action(meeting_id, agenda_id, action, extend_minutes, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

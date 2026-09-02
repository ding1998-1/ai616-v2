"""实时转写写入、分页读取与 SSE 推送。"""

import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend.config import sse_manager
from backend.db import _db_load_transcripts_for_meeting, _db_upsert_audio_client
from backend.dependencies import require_agenda, require_meeting, require_meeting_user, visible_agenda_ids
from backend.deps import _append_meeting_activity_light, _get_request_user, _get_user_from_auth_token, _resolve_meeting_role
from backend.models import MeetingTranscriptChunkRequest
from backend.services.recording_service import audio_client_owned_by
from backend.services.transcript_service import (
    build_record,
    clean_asr_text,
    persist_record,
    record_owned_by,
    resolve_agenda_id,
)


router = APIRouter(tags=["transcripts"])


@router.post("/api/meeting/transcripts/chunk")
async def post_transcript_chunk(request: Request, body: MeetingTranscriptChunkRequest):
    user, safe_id, _ = require_meeting(request, body.meeting_id)
    transcript = clean_asr_text(body.transcript)
    if not transcript:
        raise HTTPException(status_code=400, detail="转写内容不能为空或无效")
    try:
        agenda_id = resolve_agenda_id(safe_id, body.agenda_id or "")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    record = build_record(user, body, safe_id, transcript, agenda_id, now)
    if record.get("audioClientId"):
        if not audio_client_owned_by(safe_id, record["audioClientId"], user):
            raise HTTPException(status_code=403, detail="该录音设备已绑定其他参会人")
        _db_upsert_audio_client(safe_id, record["audioClientId"], user, {"device_type": "mobile", "transport": "transcript-push"})
    record, duplicate = persist_record(record)
    if duplicate:
        return {"success": True, "duplicate": True}
    _append_meeting_activity_light(safe_id, {
        "id": f"transcript_event_{record['id']}", "type": "transcript", "transcriptId": record["id"],
        "speakerName": record["speakerName"], "speakerRole": record["speakerRole"],
        "transcript": record["transcript"], "serverTime": now,
    })
    await sse_manager.publish(safe_id, "transcript", {
        "id": record["id"], "meeting_id": safe_id, "speakerName": record["speakerName"],
        "speakerRole": record["speakerRole"], "transcript": record["transcript"],
        "time": record.get("clientTime") or now, "isFinal": body.is_final,
    })
    return {"success": True, "record": record}


@router.get("/api/meetings/{meeting_id}/transcripts/sse")
async def transcripts_sse(request: Request, meeting_id: str):
    token = request.query_params.get("token")
    user = _get_user_from_auth_token(token, required=True) if token else _get_request_user(request, required=True)
    safe_id, meeting = require_meeting_user(user, meeting_id)
    queue = sse_manager.subscribe(safe_id)

    async def events():
        try:
            yield f"data: {json.dumps({'type': 'connected', 'meetingId': safe_id}, ensure_ascii=False)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            sse_manager.unsubscribe(safe_id, queue)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})


@router.get("/api/meeting/transcripts/{meeting_id}")
async def get_transcripts(
    request: Request,
    meeting_id: str,
    limit: int = 200,
    offset: int = 0,
    agenda_id: str = "",
    owner_only: bool = False,
):
    user, safe_id, meeting = require_meeting(request, meeting_id)
    if agenda_id:
        require_agenda(request, safe_id, agenda_id, "view")
    loaded = _db_load_transcripts_for_meeting(safe_id)
    if agenda_id:
        loaded["transcripts"] = [row for row in loaded.get("transcripts", []) if row.get("agendaId") == agenda_id]
        loaded["events"] = [row for row in loaded.get("events", []) if row.get("agendaId") in {"", agenda_id}]
    elif visible_agenda_ids(user, safe_id, meeting):
        allowed = visible_agenda_ids(user, safe_id, meeting)
        loaded["transcripts"] = [row for row in loaded.get("transcripts", []) if not row.get("agendaId") or row.get("agendaId") in allowed]
    all_events = loaded.get("events", [])
    all_transcripts = loaded.get("transcripts", [])
    if owner_only:
        role = _resolve_meeting_role(user)
        all_events = [row for row in all_events if record_owned_by(row, user, role)]
        all_transcripts = [row for row in all_transcripts if record_owned_by(row, user, role)]
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)
    loaded["events"] = all_events[-(limit + offset):-offset] if offset else all_events[-limit:]
    loaded["transcripts"] = all_transcripts[-(limit + offset):-offset] if offset else all_transcripts[-limit:]
    return {
        "success": True, "meetingId": safe_id, "meetingTitle": loaded.get("meetingTitle", ""),
        "agenda": loaded.get("agenda", ""), "meetingPhase": loaded.get("phase", ""),
        "updatedAt": loaded.get("updatedAt"), "events": loaded["events"], "transcripts": loaded["transcripts"],
        "totalEvents": len(all_events), "totalTranscripts": len(all_transcripts),
        "totalAudioEvents": sum(1 for row in all_events if row.get("type") == "audio"),
    }

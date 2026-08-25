"""会议成果签字与签字可信链路。"""

from fastapi import APIRouter, HTTPException, Request

from backend.dependencies import require_signature, visible_agenda_ids
from backend.models import MeetingSignatureRequest
from backend.services.agenda_service import list_meeting_agendas
from backend.services.signature_service import (
    compute_content_hash,
    is_fully_signed,
    list_signatures,
    required_signer_count,
    resolve_sign_target,
    sign_target,
    signed_signer_count,
)


router = APIRouter(prefix="/api/meetings", tags=["signatures"])


@router.get("/{meeting_id}/signatures")
async def list_meeting_signatures(request: Request, meeting_id: str):
    params = request.query_params
    agenda_id = params.get("agenda_id", "")
    user, safe_id, meeting, _ = require_signature(request, meeting_id, agenda_id, "view")
    signatures = list_signatures(
        safe_id,
        agenda_id=agenda_id,
        target_type=params.get("target_type", ""),
        target_id=params.get("target_id", ""),
    )
    if not agenda_id and list_meeting_agendas(safe_id):
        allowed = visible_agenda_ids(user, safe_id, meeting)
        signatures = [row for row in signatures if not row.get("agendaId") or row.get("agendaId") in allowed]
    return {
        "success": True,
        "signatures": signatures,
        "signedCount": signed_signer_count(safe_id),
        "requiredCount": required_signer_count(safe_id),
        "fullySigned": is_fully_signed(safe_id),
    }


@router.post("/{meeting_id}/signatures")
async def sign_meeting_target(request: Request, meeting_id: str, body: MeetingSignatureRequest):
    user, safe_id, _, _ = require_signature(request, meeting_id, body.agendaId, "sign")
    try:
        signature = sign_target(
            safe_id,
            body.agendaId,
            body.targetType,
            body.targetId,
            body.version,
            body.content,
            signer_user_id=user.get("id") or "",
            signer_name=body.signerName or user.get("name") or user.get("username") or "",
            signer_role=body.signerRole or user.get("meetingRole") or "",
            signature_data=body.signatureData,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "signature": signature}


@router.post("/{meeting_id}/signatures/hash")
async def signature_hash(request: Request, meeting_id: str, body: MeetingSignatureRequest):
    _, safe_id, _, _ = require_signature(request, meeting_id, body.agendaId, "view")
    try:
        target = resolve_sign_target(safe_id, body.agendaId, body.targetType, body.targetId)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "success": True,
        "target": {
            "targetId": target["targetId"],
            "agendaId": target["agendaId"],
            "version": target["version"],
        },
        "contentHash": compute_content_hash(
            safe_id, target["agendaId"], target["targetId"], target["version"], target["content"]
        ),
    }

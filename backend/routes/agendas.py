"""正式议题及议题级记录/决议路由。

会议是容器，议题是最小业务单元。本路由只处理 HTTP 编排，持久化和版本规则
由 ``backend.services.agenda_service`` 提供。
"""

from fastapi import APIRouter, HTTPException, Request

from backend.dependencies import (
    can_manage_meeting,
    require_agenda,
    require_meeting,
    visible_agenda_ids,
)
from backend.deps import _append_meeting_activity_light
from backend.models import (
    AgendaCreateRequest,
    AgendaPatchRequest,
    AgendaRecordRequest,
    AgendaDecisionRequest,
    AgendaDecisionPatchRequest,
)
from backend.services.agenda_service import (
    activate_meeting_agenda,
    create_agenda_decision,
    create_agenda_record,
    create_meeting_agenda,
    delete_agenda_decision,
    delete_meeting_agenda,
    generate_decisions_for_agenda,
    get_meeting_active_agenda,
    list_agenda_decisions,
    list_agenda_records,
    list_meeting_agendas,
    update_agenda_decision,
    update_meeting_agenda,
)
from backend.services.permission_service import can_view_agenda, filter_agendas_for_user


router = APIRouter(prefix="/api/meetings", tags=["agendas"])


@router.get("/{meeting_id}/agendas")
async def list_agendas(request: Request, meeting_id: str):
    user, safe_id, meeting = require_meeting(request, meeting_id)
    agendas = filter_agendas_for_user(user, meeting, list_meeting_agendas(safe_id))
    active = get_meeting_active_agenda(safe_id)
    if active and not any(row.get("id") == active.get("id") and not row.get("restricted") for row in agendas):
        active = None
    return {
        "success": True,
        "agendas": agendas,
        "activeAgendaId": (active or {}).get("id", ""),
        "activeAgenda": active,
    }


@router.get("/{meeting_id}/agendas/{agenda_id}")
async def get_agenda(request: Request, meeting_id: str, agenda_id: str):
    user, safe_id, meeting = require_meeting(request, meeting_id)
    from backend.services.agenda_service import get_meeting_agenda

    agenda = get_meeting_agenda(safe_id, agenda_id)
    if not agenda:
        raise HTTPException(status_code=404, detail="议题不存在")
    if not can_view_agenda(user, meeting, agenda):
        agenda["title"] = "（保密议题）"
        agenda["description"] = ""
        agenda["restricted"] = True
    return {"success": True, "agenda": agenda}


@router.post("/{meeting_id}/agendas")
async def create_agenda(request: Request, meeting_id: str, body: AgendaCreateRequest):
    user, safe_id, meeting = require_meeting(request, meeting_id)
    if body.agendaType == "temporary" and not can_manage_meeting(user, meeting):
        raise HTTPException(status_code=403, detail="仅主持人或会议秘书可以创建临时议题")
    try:
        agenda = create_meeting_agenda(
            safe_id,
            body.title,
            body.description,
            agenda_type=body.agendaType or "standard",
            source=body.source or ("in_meeting" if body.agendaType == "temporary" else "prepared"),
            confidentiality_level=body.confidentialityLevel or "normal",
            permission_level=body.permissionLevel,
            proposer_user_id=body.proposerUserId,
            owner_user_id=body.ownerUserId,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _append_meeting_activity_light(safe_id, {"type": "agenda.created", "payload": {"agendaId": agenda["id"], "title": agenda["title"]}})
    return {"success": True, "agenda": agenda}


@router.patch("/{meeting_id}/agendas/{agenda_id}")
async def patch_agenda(request: Request, meeting_id: str, agenda_id: str, body: AgendaPatchRequest):
    user, safe_id, meeting = require_meeting(request, meeting_id)
    if not can_manage_meeting(user, meeting):
        raise HTTPException(status_code=403, detail="仅主持人或会议秘书可以修改议题")
    try:
        agenda = update_meeting_agenda(safe_id, agenda_id, body.model_dump(exclude_unset=True))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="议题不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "agenda": agenda}


@router.delete("/{meeting_id}/agendas/{agenda_id}")
async def remove_agenda(request: Request, meeting_id: str, agenda_id: str):
    user, safe_id, meeting = require_meeting(request, meeting_id)
    if not can_manage_meeting(user, meeting):
        raise HTTPException(status_code=403, detail="仅主持人或会议秘书可以删除议题")
    delete_meeting_agenda(safe_id, agenda_id)
    _append_meeting_activity_light(safe_id, {"type": "agenda.deleted", "payload": {"agendaId": agenda_id}})
    return {"success": True}


@router.post("/{meeting_id}/agendas/{agenda_id}/activate")
async def activate_agenda(request: Request, meeting_id: str, agenda_id: str):
    user, safe_id, meeting = require_meeting(request, meeting_id)
    if not can_manage_meeting(user, meeting):
        raise HTTPException(status_code=403, detail="仅主持人或会议秘书可以切换议题")
    try:
        agenda = activate_meeting_agenda(safe_id, agenda_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="议题不存在") from exc
    _append_meeting_activity_light(safe_id, {"type": "agenda.activated", "payload": {"agendaId": agenda_id, "previous": agenda.get("previousAgendaId")}})
    return {"success": True, "agenda": agenda}


@router.get("/{meeting_id}/agendas/{agenda_id}/records")
async def list_records(request: Request, meeting_id: str, agenda_id: str):
    if agenda_id == "all":
        user, safe_id, meeting = require_meeting(request, meeting_id)
        rows = list_agenda_records(safe_id, "")
        formal = list_meeting_agendas(safe_id)
        if formal:
            rows = [row for row in rows if row.get("agendaId") in visible_agenda_ids(user, safe_id, meeting)]
    else:
        _, safe_id, _, _ = require_agenda(request, meeting_id, agenda_id, "view")
        rows = list_agenda_records(safe_id, agenda_id)
    return {"success": True, "records": rows, "total": len(rows)}


@router.post("/{meeting_id}/agendas/{agenda_id}/records")
async def create_record(request: Request, meeting_id: str, agenda_id: str, body: AgendaRecordRequest):
    user, safe_id, _, _ = require_agenda(request, meeting_id, agenda_id, "edit")
    try:
        record = create_agenda_record(
            safe_id,
            agenda_id,
            body.content,
            speaker_name=body.speakerName or user.get("name") or user.get("username") or "",
            speaker_user_id=user.get("id") or "",
            record_type=body.recordType,
            transcript_id=body.transcriptId,
            source=body.source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "record": record, "records": record}


@router.get("/{meeting_id}/agendas/{agenda_id}/decisions")
async def list_decisions(request: Request, meeting_id: str, agenda_id: str):
    if agenda_id == "all":
        user, safe_id, meeting = require_meeting(request, meeting_id)
        rows = list_agenda_decisions(safe_id, "")
        formal = list_meeting_agendas(safe_id)
        if formal:
            rows = [row for row in rows if row.get("agendaId") in visible_agenda_ids(user, safe_id, meeting)]
    else:
        _, safe_id, _, _ = require_agenda(request, meeting_id, agenda_id, "view")
        rows = list_agenda_decisions(safe_id, agenda_id)
    return {"success": True, "decisions": rows, "total": len(rows)}


@router.post("/{meeting_id}/agendas/{agenda_id}/decisions/generate")
async def generate_decisions(request: Request, meeting_id: str, agenda_id: str):
    user, safe_id, _, _ = require_agenda(request, meeting_id, agenda_id, "edit")
    result = generate_decisions_for_agenda(safe_id, agenda_id, created_by=user.get("name") or user.get("username") or "")
    return {"success": True, **result}


@router.post("/{meeting_id}/agendas/{agenda_id}/decisions")
async def create_decision(request: Request, meeting_id: str, agenda_id: str, body: AgendaDecisionRequest):
    user, safe_id, _, _ = require_agenda(request, meeting_id, agenda_id, "edit")
    try:
        decision = create_agenda_decision(
            safe_id,
            agenda_id,
            body.title,
            body.content,
            created_by=user.get("name") or user.get("username") or "",
            source=body.source,
            status=body.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "decision": decision, "decisions": decision}


@router.patch("/{meeting_id}/agendas/{agenda_id}/decisions/{decision_id}")
async def patch_decision(request: Request, meeting_id: str, agenda_id: str, decision_id: str, body: AgendaDecisionPatchRequest):
    _, safe_id, _, _ = require_agenda(request, meeting_id, agenda_id, "edit")
    try:
        decision = update_agenda_decision(safe_id, agenda_id, decision_id, body.model_dump(exclude_unset=True))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="决议不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "decision": decision}


@router.delete("/{meeting_id}/agendas/{agenda_id}/decisions/{decision_id}")
async def remove_decision(request: Request, meeting_id: str, agenda_id: str, decision_id: str):
    _, safe_id, _, _ = require_agenda(request, meeting_id, agenda_id, "admin")
    delete_agenda_decision(safe_id, agenda_id, decision_id)
    return {"success": True}

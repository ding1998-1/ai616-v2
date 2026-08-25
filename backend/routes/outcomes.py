"""会后成果、待办与会中标记 HTTP 路由。"""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from backend.dependencies import require_meeting, require_user
from backend.config import MEETING_FILES_DIR, RECORDS_PIPELINE
from backend.models import MeetingMarkerRequest, MeetingRecordsUpdateRequest
from backend.services.outcome_service import (
    add_marker,
    create_todo,
    delete_marker,
    delete_todo,
    get_records,
    generate_records_v2,
    generate_record_documents,
    get_version,
    list_markers,
    list_todos,
    list_versions,
    update_records,
    update_todo,
)


router = APIRouter(prefix="/api", tags=["outcomes"])


@router.get("/meetings/{meeting_id}/records")
async def meeting_records(request: Request, meeting_id: str, force: bool = False):
    require_meeting(request, meeting_id)
    try:
        current = get_records(meeting_id)
        records = current.get("records") or {}
        if RECORDS_PIPELINE == "v2" and (force or not records.get("generated")):
            records = await generate_records_v2(meeting_id)
            return {"success": True, "meetingId": meeting_id, "records": records}
        return {"success": True, **get_records(meeting_id)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/meetings/{meeting_id}/records/generate")
async def generate_meeting_records(request: Request, meeting_id: str):
    require_meeting(request, meeting_id)
    if RECORDS_PIPELINE != "v2":
        raise HTTPException(status_code=409, detail="Records Pipeline v2 尚未启用")
    try:
        records = await generate_records_v2(meeting_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"success": True, "meetingId": meeting_id, "records": records}


@router.post("/meetings/{meeting_id}/records/documents")
async def generate_meeting_documents(request: Request, meeting_id: str):
    require_meeting(request, meeting_id)
    try:
        bundle = generate_record_documents(meeting_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"success": True, "meetingId": meeting_id, "documents": bundle}


@router.get("/meetings/{meeting_id}/records/documents/{kind}")
async def download_meeting_document(request: Request, meeting_id: str, kind: str):
    require_meeting(request, meeting_id)
    if kind not in {"formal", "evidence"}:
        raise HTTPException(status_code=404, detail="文档类型不存在")
    records = get_records(meeting_id).get("records") or {}
    artifact = ((records.get("documents") or {}).get(kind) or {})
    path = Path(str(artifact.get("path") or ""))
    try:
        path.resolve().relative_to(MEETING_FILES_DIR.resolve())
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="文档路径无效")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文档尚未生成")
    return FileResponse(
        path,
        filename=str(artifact.get("filename") or path.name),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@router.post("/meetings/{meeting_id}/records/update")
async def update_meeting_records(request: Request, meeting_id: str, body: MeetingRecordsUpdateRequest):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        records = update_records(meeting_id, body.model_dump(exclude_unset=True), user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "meetingId": meeting_id, "records": records}


@router.get("/meetings/{meeting_id}/versions")
async def meeting_versions(request: Request, meeting_id: str):
    require_meeting(request, meeting_id)
    return {"success": True, "versions": list_versions(meeting_id)}


@router.get("/meetings/{meeting_id}/versions/{version}")
async def meeting_version(request: Request, meeting_id: str, version: int):
    require_meeting(request, meeting_id)
    try:
        return {"success": True, **get_version(meeting_id, version)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/meetings/{meeting_id}/markers")
async def create_marker(request: Request, meeting_id: str, body: MeetingMarkerRequest):
    user, _, _ = require_meeting(request, meeting_id)
    marker = body.model_dump()
    try:
        result = add_marker(meeting_id, marker, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"success": True, "meetingId": meeting_id, "marker": result, "markerId": result["id"]}


@router.get("/meetings/{meeting_id}/markers")
async def markers(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        return {"success": True, "meetingId": meeting_id, "markers": list_markers(meeting_id, user)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/meetings/{meeting_id}/markers/{marker_id}")
async def remove_marker(request: Request, meeting_id: str, marker_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        delete_marker(meeting_id, marker_id, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"success": True, "meetingId": meeting_id, "markerId": marker_id}


@router.get("/todos")
async def todos(request: Request, status: str = "", owner: str = "", priority: str = "", limit: int = 100, offset: int = 0):
    require_user(request)
    rows, total = list_todos(status, owner, priority, limit, offset)
    return {"success": True, "todos": rows, "total": total}


@router.post("/meetings/{meeting_id}/todos")
async def create_meeting_todo(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        todo = create_todo(meeting_id, await request.json(), user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "todo": todo, "id": todo["id"]}


@router.put("/todos/{todo_id}")
async def edit_todo(request: Request, todo_id: str):
    user = require_user(request)
    try:
        todo = update_todo(todo_id, await request.json(), user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "todo": todo}


@router.delete("/todos/{todo_id}")
async def remove_todo(request: Request, todo_id: str):
    user = require_user(request)
    try:
        delete_todo(todo_id, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"success": True}

"""会议材料上传与下载路由。"""

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from backend.config import MAX_UPLOAD_BYTES
from backend.db import _public_meeting
from backend.dependencies import require_meeting
from backend.services.material_service import list_materials, resolve_material, save_material


router = APIRouter(prefix="/api/meetings", tags=["materials"])


async def _read_upload(file: UploadFile) -> bytes:
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="材料不能超过 100MB")
    return content


@router.get("/{meeting_id}/materials")
async def materials(request: Request, meeting_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    return {"success": True, "materials": list_materials(meeting_id, user)}


@router.post("/{meeting_id}/materials/upload")
async def upload_material(request: Request, meeting_id: str, file: UploadFile = File(...), material_name: str = Form("支撑材料")):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        record, meeting = save_material(meeting_id, material_name, file.filename or "meeting-material", await _read_upload(file), user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "material": record, "meeting": _public_meeting(meeting, include_detail=True)}


@router.get("/{meeting_id}/materials/{material_id}/download")
async def download_material(request: Request, meeting_id: str, material_id: str):
    user, _, _ = require_meeting(request, meeting_id)
    try:
        material, path = resolve_material(meeting_id, material_id, user)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, filename=material.get("fileName") or path.name)

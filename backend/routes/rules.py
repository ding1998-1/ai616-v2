"""制度规则与规则图片路由。"""

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from backend.config import MAX_UPLOAD_BYTES
from backend.dependencies import require_user
from backend.services.rules_service import (
    RULES_DB,
    create_custom_rule,
    delete_custom_rule,
    list_rules_gallery,
    load_custom_rules,
    resolve_rules_image,
)


router = APIRouter(tags=["rules"])


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="制度文件不能超过 100MB")
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")
    return raw


@router.get("/matter-types")
async def matter_types(request: Request):
    require_user(request)
    return {"matter_types": list(RULES_DB.keys())}


@router.get("/api/custom_rules")
async def list_rules(request: Request):
    require_user(request)
    return {"success": True, "files": load_custom_rules()}


@router.post("/api/custom_rules/upload")
async def upload_rule(request: Request, file: UploadFile = File(...), matter_type: str = "通用"):
    require_user(request)
    try:
        record = create_custom_rule(file.filename or "未命名制度文件", await _read_upload(file), matter_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"success": True, "file": record}


@router.delete("/api/custom_rules/{rule_id}")
async def remove_rule(request: Request, rule_id: str):
    require_user(request)
    if not delete_custom_rule(rule_id):
        raise HTTPException(status_code=404, detail="制度文件不存在")
    return {"success": True}


@router.get("/api/rules_gallery")
async def rules_gallery(request: Request):
    require_user(request)
    return {"success": True, "items": list_rules_gallery()}


@router.get("/api/rules_images/{filename}")
async def rules_image(filename: str):
    try:
        path = resolve_rules_image(filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path)

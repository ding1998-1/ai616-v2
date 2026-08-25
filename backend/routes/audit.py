"""合规审核与公文起草 SSE 路由。"""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from backend.dependencies import require_user
from backend.models import ChatRequest
from backend.services.audit_service import audit_history, stream_audit, stream_template


router = APIRouter(tags=["audit"])


@router.post("/audit_stream")
@router.post("/api/audit_stream")
async def audit_stream_route(request: Request, body: ChatRequest):
    require_user(request)
    return StreamingResponse(
        stream_audit(request, body.matter_type, body.material_text, body.custom_rule_ids),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/audit_history")
async def audit_history_route(request: Request):
    require_user(request)
    return JSONResponse({"success": True, "history": audit_history()})


class TemplateRequest(BaseModel):
    message: str


@router.post("/generate_template")
@router.post("/api/generate_template")
async def generate_template_route(request: Request, body: TemplateRequest):
    require_user(request)
    return StreamingResponse(
        stream_template(request, body.message),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

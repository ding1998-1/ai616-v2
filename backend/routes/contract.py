"""合同审查与合同草案路由。"""

from __future__ import annotations

import io
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.dependencies import require_user
from backend.services.contract_service import (
    analyze_contract,
    delete_contract_issues,
    draft_contract,
    export_contract_draft,
    get_contract_issues,
    map_doc_structure,
    re_analyze_contract,
)


router = APIRouter(tags=["contract"])


class ContractMapRequest(BaseModel):
    saved_name: str


class ContractAnalyzeRequest(BaseModel):
    saved_name: str
    doc_structure: Optional[list[dict]] = None
    extra_questions: list[str] = Field(default_factory=list)


class ContractReAnalyzeRequest(BaseModel):
    saved_name: str
    doc_structure: list[dict] = Field(default_factory=list)
    extra_questions: list[str] = Field(default_factory=list)
    previous_issues: list[dict] = Field(default_factory=list)


class ContractDraftRequest(BaseModel):
    contract_type: str = "采购合同"
    requirements: str


class ContractDraftExportRequest(BaseModel):
    markdown: str
    title: str = "合同草案"


@router.post("/contract/map_doc_structure")
@router.post("/api/contract/map_doc_structure")
async def map_structure(request: Request, body: ContractMapRequest):
    require_user(request)
    try:
        return map_doc_structure(body.saved_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/contract/analyze")
@router.post("/api/contract/analyze")
async def analyze(request: Request, body: ContractAnalyzeRequest):
    require_user(request)
    try:
        return analyze_contract(body.saved_name, body.doc_structure, body.extra_questions)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/contract/re_analyze")
@router.post("/api/contract/re_analyze")
async def re_analyze(request: Request, body: ContractReAnalyzeRequest):
    require_user(request)
    try:
        return re_analyze_contract(body.saved_name, body.doc_structure, body.extra_questions, body.previous_issues)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/contract/issues/{saved_name}")
@router.get("/api/contract/issues/{saved_name}")
async def issues(request: Request, saved_name: str):
    require_user(request)
    try:
        return get_contract_issues(saved_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/contract/issues/{saved_name}")
@router.delete("/api/contract/issues/{saved_name}")
async def delete_issues(request: Request, saved_name: str):
    require_user(request)
    delete_contract_issues(saved_name)
    return {"success": True}


@router.post("/contract/draft")
@router.post("/api/contract/draft")
async def draft(request: Request, body: ContractDraftRequest):
    require_user(request)
    return draft_contract(body.contract_type, body.requirements)


@router.post("/contract/draft/export")
@router.post("/api/contract/draft/export")
async def draft_export(request: Request, body: ContractDraftExportRequest):
    require_user(request)
    filename, content = export_contract_draft(body.markdown, body.title)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

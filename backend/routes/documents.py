"""普通文档上传、解析、下载和审查版导出。

刻意不提供 OnlyOffice 的 edit_url、editor_page、plugin、callback、selection、
suggestion 接口；产品不再依赖在线编辑器才能完成普通文档流转。
"""

from __future__ import annotations

import base64
import os
import re

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.config import DASHSCOPE_API_KEY, DASHSCOPE_WORKSPACE, MAX_UPLOAD_BYTES
from backend.dependencies import require_user
from backend.services.document_service import (
    DOCS_DIR,
    delete_document,
    export_reviewed_docx,
    extract_bookmarks,
    list_documents,
    parse_document_bytes,
    resolve_document,
    upload_document,
)
from backend.services.knowledge_service import ingest_document


router = APIRouter(tags=["documents"])


async def _read_upload(file: UploadFile) -> bytes:
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="文件不能超过 100MB")
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")
    return raw


@router.post("/parse_file")
@router.post("/api/parse_file")
async def parse_file(request: Request, file: UploadFile = File(...)):
    require_user(request)
    raw = await _read_upload(file)
    text = parse_document_bytes(file.filename or "document", raw)
    return {"text": text, "filename": file.filename or "document", "char_count": len(text)}


@router.post("/api/ocr/image")
async def ocr_image(request: Request, file: UploadFile = File(...)):
    require_user(request)
    if not DASHSCOPE_API_KEY:
        raise HTTPException(status_code=503, detail="未配置 DASHSCOPE_API_KEY，无法调用百炼 OCR")
    content_type = file.content_type or "image/jpeg"
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="OCR 仅支持图片文件")
    raw = await file.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="图片超过 10MB，请压缩后上传")
    if not raw:
        raise HTTPException(status_code=400, detail="图片内容为空")
    model = os.environ.get("DASHSCOPE_OCR_MODEL", "qwen-vl-ocr")
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "请对图片做 OCR，提取所有可见中文和数字。只返回纯文本，不要解释，不要 Markdown。"},
            {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"}},
        ]}],
        "temperature": 0,
    }
    headers = {"Authorization": f"Bearer {DASHSCOPE_API_KEY}", "Content-Type": "application/json"}
    if DASHSCOPE_WORKSPACE:
        headers["X-DashScope-WorkSpace"] = DASHSCOPE_WORKSPACE
    try:
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            response = await client.post("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", headers=headers, json=payload)
        if response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"百炼 OCR 调用失败：HTTP {response.status_code}")
        data = response.json()
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content", "")
        if isinstance(content, list):
            content = "\n".join(str(item.get("text", "")) for item in content if isinstance(item, dict))
        text = re.sub(r"\n{3,}", "\n\n", str(content or "")).strip()
        return {"success": True, "filename": file.filename or "image", "model": model, "text": text, "char_count": len(text)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OCR 处理失败：{exc}") from exc


@router.post("/doc/upload")
@router.post("/api/doc/upload")
async def upload_doc(request: Request, file: UploadFile = File(...), vectorize: bool = False):
    require_user(request)
    raw = await _read_upload(file)
    result = upload_document(file.filename or "document", raw)
    if vectorize:
        try:
            result["vectorize_result"] = ingest_document(file.filename or "document", raw)
            result["vectorized"] = True
        except Exception as exc:
            # 上传成功与向量化解耦：索引失败不能丢失原始文件。
            result["vectorized"] = False
            result["vectorize_warning"] = str(exc)
    else:
        result["vectorized"] = False
    return result


@router.get("/doc/list")
@router.get("/api/doc/list")
async def list_doc(request: Request):
    require_user(request)
    files = list_documents()
    return {"files": files, "count": len(files)}


@router.get("/doc/download/{saved_name}")
@router.get("/api/doc/download/{saved_name}")
async def download_doc(request: Request, saved_name: str):
    require_user(request)
    path = resolve_document(saved_name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path, filename=path.name, media_type="application/octet-stream")


@router.delete("/doc/delete/{saved_name}")
@router.delete("/api/doc/delete/{saved_name}")
async def delete_doc(request: Request, saved_name: str):
    require_user(request)
    delete_document(saved_name)
    return {"success": True, "message": "文件已删除"}


@router.get("/doc/extract_bookmarks/{saved_name}")
@router.get("/api/doc/extract_bookmarks/{saved_name}")
async def bookmarks(request: Request, saved_name: str):
    require_user(request)
    return extract_bookmarks(saved_name)


class ReviewedDocExportRequest(BaseModel):
    saved_name: str
    edits: dict[str, str] = {}


@router.post("/doc/export_reviewed")
@router.post("/api/doc/export_reviewed")
async def export_reviewed(request: Request, body: ReviewedDocExportRequest):
    require_user(request)
    export_name, download_name, applied_count = export_reviewed_docx(body.saved_name, body.edits)
    return {
        "success": True,
        "saved_name": export_name,
        "filename": download_name,
        "applied_count": applied_count,
        "download_url": f"/doc/download/{export_name}",
        "message": f"已生成留痕审查版文件，共写入 {applied_count} 处修订",
    }

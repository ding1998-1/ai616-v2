"""知识库、议题检索和知识文件路由。"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.config import MAX_UPLOAD_BYTES, llm_semaphore
from backend.dependencies import require_user
from backend.llm_client import llm
from backend.models import KBQueryRequest
from backend.services.knowledge_service import (
    create_knowledge_file,
    delete_knowledge_file,
    get_knowledge_files,
    get_vectorstore,
    ingest_document,
    knowledge_stats,
    search_agenda_knowledge,
    toggle_link,
    update_knowledge_file,
    vectorize_record,
    vectorstore_error,
)


logger = logging.getLogger(__name__)
router = APIRouter(tags=["knowledge"])


def _sse(event_type: str, **payload) -> str:
    return f"data: {json.dumps({'type': event_type, **payload}, ensure_ascii=False)}\n\n"


@router.get("/api/knowledge/agenda-search")
async def agenda_search(request: Request, q: str = "", limit: int = 20):
    user = require_user(request)
    try:
        limit = max(1, min(int(limit), 50))
    except (TypeError, ValueError):
        limit = 20
    return search_agenda_knowledge(q, limit=limit, user=user)


@router.post("/kb_stream")
@router.post("/api/kb_stream")
async def knowledge_stream(request: Request, body: KBQueryRequest):
    require_user(request)

    async def generator():
        try:
            store = get_vectorstore()
            if store is None:
                yield _sse("error", detail=vectorstore_error() or "知识库未初始化，请联系管理员建立索引。")
                return
            yield _sse("tool_start", tool="检索本地文档库(MMR)")
            docs = store.max_marginal_relevance_search(body.query, k=4, fetch_k=12)
            context = "\n\n".join(f"【参考资料 {index + 1}】\n{doc.page_content}" for index, doc in enumerate(docs))
            sources = []
            for index, doc in enumerate(docs):
                meta = getattr(doc, "metadata", None) or {}
                page = meta.get("page")
                total = meta.get("total_pages")
                location = f"第{page}/{total}页" if page and total else (f"第{page}页" if page else f"片段{meta.get('chunk', 0)}")
                sources.append({
                    "index": index + 1,
                    "source": meta.get("source", "未知来源"),
                    "location": location,
                    "page": page,
                    "total_pages": total,
                    "chunk": meta.get("chunk", 0),
                    "doc_id": meta.get("doc_id", ""),
                    "snippet": doc.page_content[:200] + ("..." if len(doc.page_content) > 200 else ""),
                })
            yield _sse("sources", sources=sources)
            yield _sse("tool_end", tool=f"检索完毕，找到 {len(docs)} 条相关资料")
            if not getattr(llm, "api_key", ""):
                yield _sse("degraded", reason="未配置 LLM，返回本地资料片段")
                yield _sse("report", content=context or "本地知识库未找到相关资料。")
                yield 'data: {"type": "done"}\n\n'
                return
            from langchain_core.messages import HumanMessage, SystemMessage

            prompt = f"""请根据以下内部资料回答用户提问。严格基于资料，不得捏造；答案中用[参考N]标记来源，全部使用简体中文。
内部资料：\n{context}\n\n用户提问：{body.query}"""
            response_text = ""
            async with llm_semaphore:
                async for chunk in llm._astream(
                    [SystemMessage(content="你是企业合规知识库助手。"), HumanMessage(content=prompt)],
                    enable_thinking=False,
                ):
                    if await request.is_disconnected():
                        raise asyncio.CancelledError()
                    text = chunk.message.content
                    if text:
                        response_text += text
                        yield _sse("llm_chunk", content=text)
            yield _sse("report", content=response_text)
            yield 'data: {"type": "done"}\n\n'
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("知识库检索失败")
            yield _sse("error", detail=str(exc))

    return StreamingResponse(generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/ingest_file")
async def ingest_file(request: Request, file: UploadFile = File(...)):
    require_user(request)
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="文件不能超过 100MB")
    try:
        return ingest_document(file.filename or "document", raw)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400 if isinstance(exc, ValueError) else 503, detail=str(exc)) from exc


@router.get("/kb_stats")
@router.get("/api/kb_stats")
async def kb_stats(request: Request):
    require_user(request)
    return knowledge_stats()


class KnowledgeFile(BaseModel):
    id: str
    name: str
    type: str
    size: str
    date: str
    tags: list[str] = Field(default_factory=list)
    linked: bool = False
    vectorized: bool = False
    uploader: str = ""
    uploaderRole: str = ""
    dept: str = ""
    libraryCategory: str | None = None
    parsedText: str | None = None
    savedName: str | None = None


class KnowledgeFileUpdate(BaseModel):
    id: str | None = None
    name: str | None = None
    type: str | None = None
    size: str | None = None
    date: str | None = None
    tags: list[str] | None = None
    linked: bool | None = None
    vectorized: bool | None = None
    uploader: str | None = None
    uploaderRole: str | None = None
    dept: str | None = None
    libraryCategory: str | None = None
    parsedText: str | None = None
    savedName: str | None = None


@router.get("/api/knowledge_files")
async def list_files(request: Request):
    require_user(request)
    return {"files": get_knowledge_files()}


@router.post("/api/knowledge_files")
async def add_file(request: Request, file: KnowledgeFile):
    require_user(request)
    record = file.model_dump(exclude_none=True)
    created, saved = create_knowledge_file(record)
    if not created:
        return {"success": False, "message": "文件已存在"}
    return {"success": True, "file": saved}


@router.put("/api/knowledge_files/{file_id}")
async def edit_file(request: Request, file_id: str, update: KnowledgeFileUpdate):
    require_user(request)
    saved = update_knowledge_file(file_id, update.model_dump(exclude_none=True))
    if saved is None:
        raise HTTPException(status_code=404, detail="文件不存在")
    return {"success": True, "file": saved}


@router.delete("/api/knowledge_files/{file_id}")
async def remove_file(request: Request, file_id: str):
    require_user(request)
    if not delete_knowledge_file(file_id):
        raise HTTPException(status_code=404, detail="文件不存在")
    return {"success": True}


@router.post("/api/knowledge_files/{file_id}/vectorize")
async def vectorize_file(request: Request, file_id: str):
    require_user(request)
    try:
        result = vectorize_record(file_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"success": True, **result}


@router.post("/api/knowledge_files/{file_id}/link")
async def link_file(request: Request, file_id: str):
    require_user(request)
    linked = toggle_link(file_id)
    if linked is None:
        raise HTTPException(status_code=404, detail="文件不存在")
    return {"success": True, "linked": linked}

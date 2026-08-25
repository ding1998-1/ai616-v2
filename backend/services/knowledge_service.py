"""议题级知识检索（backend/services/knowledge_service.py）

§60-64：一个议题 = 一个历史知识对象。检索返回 具体会议 + 具体议题 + 最终决议，
而不是整场会议标题。

实现说明：本模块不依赖向量库/embedding 模型（生产服务器上 Chroma 可用时仍走
现有 /kb_stream；此服务用于"历史会议/议题"检索通道），采用关键词相关度检索，
并在 API 层过滤保密议题（§57 权限原则）。
"""
import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from datetime import datetime

from backend.config import APP_DB_LOCK
from backend.db import _db_connect, _init_app_db
from backend.services.permission_service import can_view_agenda
from backend.services.document_service import parse_document_bytes
from backend.config import PERSIST_DIR

STOPWORDS = {"的", "了", "在", "是", "和", "与", "或", "及", "有", "对", "于", "就", "都", "吗", "呢", "吧"}
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE_FILES_DIR = PROJECT_ROOT / "data" / "knowledge_files"
KNOWLEDGE_FILES_DIR.mkdir(parents=True, exist_ok=True)
KNOWLEDGE_FILES_DB = KNOWLEDGE_FILES_DIR / "files.json"

_vectorstore = None
_vectorstore_error = ""


def load_knowledge_files() -> list[dict]:
    if KNOWLEDGE_FILES_DB.exists():
        try:
            data = json.loads(KNOWLEDGE_FILES_DB.read_text(encoding="utf-8"))
            if isinstance(data, list) and data:
                return data
        except (OSError, json.JSONDecodeError):
            logger.warning("知识库文件索引读取失败，将使用内置样例")
    try:
        from demo_content import get_seed_knowledge_files

        return get_seed_knowledge_files()
    except Exception:
        return []


def save_knowledge_files(files: list[dict]) -> None:
    KNOWLEDGE_FILES_DB.write_text(json.dumps(files, ensure_ascii=False, indent=2), encoding="utf-8")


def _resolve_saved_name(record: dict, docs_dir: Path | None = None) -> str | None:
    docs_dir = docs_dir or (PROJECT_ROOT / "data" / "docs")
    current = record.get("savedName")
    if current and (docs_dir / Path(str(current)).name).exists():
        return Path(str(current)).name
    source_name = str(record.get("name") or "").strip()
    if str(record.get("type") or "").lower() not in {"doc", "docx"} or not source_name or not docs_dir.exists():
        return None
    candidates = [
        path
        for path in docs_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".doc", ".docx"} and (path.name == source_name or path.name.endswith(f"_{source_name}"))
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.stat().st_mtime).name


def repair_knowledge_files(files: list[dict], persist: bool = False) -> list[dict]:
    changed = False
    for record in files:
        saved_name = _resolve_saved_name(record)
        if saved_name and record.get("savedName") != saved_name:
            record["savedName"] = saved_name
            changed = True
        if saved_name and "可编辑" not in (record.get("tags") or []):
            record["tags"] = [*(record.get("tags") or []), "可编辑"]
            changed = True
    if changed and persist:
        save_knowledge_files(files)
    return files


def discover_orphaned_docs(files: list[dict], persist: bool = False) -> list[dict]:
    docs_dir = PROJECT_ROOT / "data" / "docs"
    if not docs_dir.exists():
        return files
    tracked = {item.get("savedName") for item in files if item.get("savedName")}
    tracked_names = {item.get("name") for item in files}
    discovered = []
    for path in sorted(docs_dir.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
        if not path.is_file() or path.suffix.lower() not in {".doc", ".docx"}:
            continue
        if path.name in tracked or path.name.startswith("meeting-"):
            continue
        original_name = path.name.split("_", 1)[-1]
        if original_name in tracked_names or "审查版" in original_name or "留痕审查版" in original_name:
            continue
        discovered.append(
            {
                "id": f"discovered_{path.name.replace('.', '_')[:40]}",
                "name": original_name,
                "type": "docx",
                "size": f"{round(path.stat().st_size / 1024)} KB",
                "date": datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d"),
                "tags": ["合同审查", "可编辑"],
                "linked": False,
                "vectorized": False,
                "uploader": "系统",
                "uploaderRole": "admin",
                "dept": "信息管理中心",
                "libraryCategory": "cases",
                "parsedText": None,
                "savedName": path.name,
            }
        )
        tracked.add(path.name)
    if discovered:
        files = discovered + files
        if persist:
            save_knowledge_files(files)
    return files


def get_knowledge_files() -> list[dict]:
    files = repair_knowledge_files(load_knowledge_files(), persist=True)
    return discover_orphaned_docs(files, persist=True)


def create_knowledge_file(record: dict) -> tuple[bool, dict | None]:
    files = load_knowledge_files()
    if any(item.get("id") == record.get("id") for item in files):
        return False, None
    files.insert(0, record)
    save_knowledge_files(files)
    return True, record


def update_knowledge_file(file_id: str, patch: dict) -> dict | None:
    files = load_knowledge_files()
    for index, item in enumerate(files):
        if item.get("id") == file_id:
            updated = {**item, **{key: value for key, value in patch.items() if value is not None}, "id": file_id}
            files[index] = updated
            save_knowledge_files(files)
            return updated
    return None


def delete_knowledge_file(file_id: str) -> bool:
    files = load_knowledge_files()
    filtered = [item for item in files if item.get("id") != file_id]
    if len(filtered) == len(files):
        return False
    save_knowledge_files(filtered)
    return True


def toggle_link(file_id: str) -> bool | None:
    files = load_knowledge_files()
    for item in files:
        if item.get("id") == file_id:
            item["linked"] = not bool(item.get("linked"))
            save_knowledge_files(files)
            return item["linked"]
    return None


def chunk_text_with_pages(text: str, pages: list[str] | None = None, chunk_size: int = 500, overlap: int = 50, source: str = "", doc_id_prefix: str = "") -> tuple[list[str], list[dict], list[str]]:
    chunks: list[str] = []
    metadatas: list[dict] = []
    ids: list[str] = []
    if pages:
        total_pages = len(pages)
        for page_number, page in enumerate(pages, start=1):
            page = (page or "").strip()
            start = 0
            while start < len(page):
                chunk = page[start : start + chunk_size]
                if chunk.strip():
                    chunks.append(chunk)
                    metadatas.append({"source": source, "doc_id": doc_id_prefix, "page": page_number, "chunk": len(chunks) - 1, "total_pages": total_pages})
                    ids.append(f"{doc_id_prefix}_p{page_number}_c{len(chunks) - 1}")
                start += max(1, chunk_size - overlap)
    else:
        start = 0
        while start < len(text):
            chunk = text[start : start + chunk_size]
            if chunk.strip():
                chunks.append(chunk)
                metadatas.append({"source": source, "doc_id": doc_id_prefix, "page": None, "chunk": len(chunks) - 1})
                ids.append(f"{doc_id_prefix}_c{len(chunks) - 1}")
            start += max(1, chunk_size - overlap)
    return chunks, metadatas, ids


def get_vectorstore(create_if_missing: bool = False):
    """懒加载 Chroma，基础登录/会议接口不被向量模型拖慢。"""
    global _vectorstore, _vectorstore_error
    if _vectorstore is not None:
        return _vectorstore
    persist_path = Path(PERSIST_DIR)
    if not persist_path.exists():
        if not create_if_missing:
            return None
        persist_path.mkdir(parents=True, exist_ok=True)
    try:
        from langchain_chroma import Chroma
        from sentence_transformers import SentenceTransformer

        class Embeddings:
            def __init__(self):
                self.model = SentenceTransformer("shibing624/text2vec-base-chinese")

            def embed_documents(self, texts):
                return self.model.encode(texts, normalize_embeddings=True).tolist()

            def embed_query(self, text):
                return self.model.encode([text], normalize_embeddings=True).tolist()[0]

        import chromadb

        client = chromadb.PersistentClient(path=str(persist_path))
        _vectorstore = Chroma(client=client, collection_name="langchain", embedding_function=Embeddings())
        return _vectorstore
    except Exception as exc:
        _vectorstore_error = str(exc)
        logger.warning("知识库向量索引不可用：%s", exc)
        return None


def vectorstore_error() -> str:
    return _vectorstore_error


def ingest_document(filename: str, raw: bytes) -> dict:
    ext = Path(filename or "").suffix.lower().lstrip(".")
    text = parse_document_bytes(filename, raw)
    if not text:
        raise ValueError("文件内容为空，无法入库")
    pages = None
    if ext == "pdf":
        # parse_document_bytes intentionally returns normalized text; page-level metadata
        # is optional and is restored only when pdfplumber is available.
        try:
            import io
            import pdfplumber

            with pdfplumber.open(io.BytesIO(raw)) as pdf:
                pages = [page.extract_text() or "" for page in pdf.pages]
        except Exception:
            pages = None
    prefix = f"ingest_{uuid.uuid4().hex[:10]}"
    chunks, metadatas, ids = chunk_text_with_pages(text, pages=pages, source=filename, doc_id_prefix=prefix)
    store = get_vectorstore(create_if_missing=True)
    if store is None:
        raise RuntimeError(vectorstore_error() or "向量数据库未就绪")
    store.add_texts(texts=chunks, metadatas=metadatas, ids=ids)
    return {"success": True, "filename": filename, "chunks": len(chunks), "char_count": len(text), "message": f"文件已成功入库，生成 {len(chunks)} 个语义片段，可在合规问答中检索。"}


def vectorize_record(file_id: str) -> dict:
    files = load_knowledge_files()
    target = next((item for item in files if item.get("id") == file_id), None)
    if not target:
        raise KeyError("文件不存在")
    if target.get("vectorized"):
        target["vectorized"] = False
        target["linked"] = False
        save_knowledge_files(files)
        return {"vectorized": False, "linked": False}
    if not target.get("parsedText"):
        raise ValueError("文件未解析，无法向量化")
    store = get_vectorstore(create_if_missing=True)
    if store is None:
        raise RuntimeError(vectorstore_error() or "向量数据库未就绪")
    store.add_texts(texts=[target["parsedText"]], metadatas=[{"source": target.get("name", ""), "file_id": file_id}], ids=[file_id])
    target["vectorized"] = True
    target["linked"] = True
    target["tags"] = [tag for tag in target.get("tags", []) if tag != "待入库"] + ["已入库"]
    save_knowledge_files(files)
    return {"vectorized": True, "linked": True}


def knowledge_stats() -> dict:
    store = get_vectorstore()
    if store is None:
        return {"available": False, "count": 0, "message": _vectorstore_error or "知识库未就绪"}
    try:
        count = store._collection.count()
        return {"available": True, "count": count, "message": f"知识库已就绪，共 {count} 个语义片段"}
    except Exception as exc:
        return {"available": False, "count": 0, "message": str(exc)}


def search_legal_provisions(query: str, top_k: int = 5) -> list[dict]:
    store = get_vectorstore()
    if store is None:
        return []
    try:
        results = store.similarity_search_with_score(query, k=top_k)
        return [{"content": doc.page_content[:500], "source": (doc.metadata or {}).get("source", ""), "score": float(score)} for doc, score in results]
    except Exception as exc:
        logger.warning("知识库条款检索失败：%s", exc)
        return []


def _tokenize(query: str) -> list:
    """中文检索：按 2-gram + 关键词拆分，过滤停用词。"""
    q = re.sub(r"\s+", "", query or "")
    tokens = set()
    # 二元组
    for i in range(len(q) - 1):
        bi = q[i:i + 2]
        if bi not in STOPWORDS:
            tokens.add(bi)
    # 单个汉字也纳入（人名/专名）
    for ch in q:
        if ch not in STOPWORDS and re.match(r"[\u4e00-\u9fffA-Za-z0-9]", ch):
            tokens.add(ch)
    return list(tokens)


def _agenda_knowledge_rows():
    """组装议题知识对象：议题 + 决议 + 会议基本信息。"""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            meetings = {r["id"]: r for r in conn.execute(
                "SELECT id, title, meeting_type, meeting_no, meeting_date, phase, archived FROM meetings"
            ).fetchall()}
            agendas = conn.execute(
                "SELECT * FROM meeting_agendas ORDER BY created_at"
            ).fetchall()
            decisions = conn.execute(
                "SELECT * FROM meeting_agenda_decisions ORDER BY created_at"
            ).fetchall()
    dec_by_agenda = {}
    for d in decisions:
        dec_by_agenda.setdefault(d["agenda_id"], []).append({
            "title": d["title"], "content": d["content"],
            "status": d["status"], "version": d["version"],
            "decisionNo": d["decision_no"],
        })
    rows = []
    for a in agendas:
        meeting = meetings.get(a["meeting_id"])
        if not meeting:
            continue
        rows.append({
            "meeting_id": a["meeting_id"],
            "meeting_title": meeting["title"] or "",
            "meeting_no": meeting["meeting_no"] or "",
            "meeting_type": meeting["meeting_type"] or "",
            "date": meeting["meeting_date"] or "",
            "archived": bool(meeting["archived"]),
            "agenda_id": a["id"],
            "agenda_title": a["title"] or "",
            "agenda_no": a["agenda_no"],
            "description": a["description"] or "",
            "confidentiality_level": a["confidentiality_level"] or "normal",
            "status": a["status"] or "",
            "decisions": dec_by_agenda.get(a["id"], []),
        })
    return rows


def search_agenda_knowledge(query: str, limit: int = 20, user: dict = None) -> dict:
    """按关键词检索历史议题知识。

    Args:
        query: 检索词（如"设备采购"、"去年总经理办公会"）
        limit: 返回条数上限
        user: 当前用户（保密议题过滤依据）
    """
    q = re.sub(r"\s+", "", query or "")
    if len(q) < 2:
        return {"results": [], "query": query, "total": 0}
    tokens = _tokenize(q)
    rows = _agenda_knowledge_rows()
    scored = []
    for row in rows:
        # 保密议题过滤：无权限的保密议题不出现在知识检索结果中
        if (row.get("confidentiality_level") or "normal") != "normal":
            fake_meeting = {"creator": "", "meetingMode": row.get("meeting_type") or ""}
            fake_agenda = {
                "id": row["agenda_id"],
                "confidentialityLevel": row.get("confidentiality_level"),
            }
            if not can_view_agenda(user, fake_meeting, fake_agenda):
                continue
        haystack = " ".join([
            row["meeting_title"], row["meeting_no"], row["meeting_type"],
            row["agenda_title"], row["description"],
            " ".join(d["title"] + " " + d["content"] for d in row["decisions"]),
        ])
        score = 0
        for token in tokens:
            score += haystack.count(token) * 2 if len(token) == 1 else haystack.count(token)
        # 决议内容命中加权
        for d in row["decisions"]:
            for token in tokens:
                if token in (d["title"] + d["content"]):
                    score += 3
        if score > 0:
            scored.append((score, row))
    scored.sort(key=lambda x: (-x[0], x[1].get("date") or ""))
    results = [{"score": s, **r} for s, r in scored[:limit]]
    return {"results": results, "query": query, "total": len(results)}

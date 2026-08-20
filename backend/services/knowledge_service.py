"""议题级知识检索（backend/services/knowledge_service.py）

§60-64：一个议题 = 一个历史知识对象。检索返回 具体会议 + 具体议题 + 最终决议，
而不是整场会议标题。

实现说明：本模块不依赖向量库/embedding 模型（生产服务器上 Chroma 可用时仍走
现有 /kb_stream；此服务用于"历史会议/议题"检索通道），采用关键词相关度检索，
并在 API 层过滤保密议题（§57 权限原则）。
"""
import re
from datetime import datetime

from backend.config import APP_DB_LOCK
from backend.db import _db_connect, _init_app_db
from backend.services.permission_service import can_view_agenda

STOPWORDS = {"的", "了", "在", "是", "和", "与", "或", "及", "有", "对", "于", "就", "都", "吗", "呢", "吧"}


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

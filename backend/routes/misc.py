"""系统辅助接口、演示资源、通知、搜索和数据导出。

这里保留前端需要的跨域轻量接口；业务规则、知识库、审核、合同和普通文档
分别归属各自 route 模块。OnlyOffice 相关接口不在本模块。
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from audit_persistence import persistence
from backend.config import MEETING_FILES_DIR
from backend.db import _check_meeting_access, _db_connect, _init_app_db, _load_meetings, _safe_meeting_id
from backend.dependencies import require_user
from backend.services.agenda_service import get_meeting_agenda
from backend.services.meeting_search_service import build_authorized_search_results, ensure_legacy_agendas_searchable, search_meeting_documents
from backend.services.permission_service import can_view_agenda


router = APIRouter(tags=["misc"])


@router.get("/")
async def root():
    return {"message": "AI 会议工作台 API 服务已启动"}


@router.get("/api/demo_assets")
async def demo_assets(request: Request):
    require_user(request)
    from demo_content import get_demo_assets

    return {"success": True, **get_demo_assets()}


@router.get("/api/audit_history")
async def audit_history_compat(request: Request):
    """历史接口由 audit route 提供；保留这里仅用于旧装配器的兼容导入。"""
    require_user(request)
    try:
        from demo_content import build_archive_history

        return {"success": True, "history": build_archive_history(persistence.get_history())}
    except Exception:
        return {"success": True, "history": []}


@router.get("/legal-case-types")
async def legal_case_types(request: Request):
    require_user(request)
    try:
        from legal_case_db import LegalCaseDatabase

        cases = LegalCaseDatabase().get_all_cases()
        values = sorted({case.case_type for case in cases})
    except Exception:
        values = []
    return {"legal_case_types": values}


class LegalCompareRequest(BaseModel):
    case_type: str
    case_description: str
    case_amount: float = 0.0


@router.post("/legal-compare")
async def legal_compare(request: Request, body: LegalCompareRequest):
    require_user(request)
    # 合同/合规审查已迁移到独立域；这里保留轻量兼容响应，避免旧页面 404。
    return {
        "success": True,
        "message": "法务对比请求已接收",
        "report": f"案件类型：{body.case_type}\n案件金额：{body.case_amount}\n待分析内容：{body.case_description}",
    }


@router.get("/ongoing-cases")
async def ongoing_cases(request: Request):
    require_user(request)
    try:
        from ongoing_case_tracker import OngoingCaseTracker

        cases = OngoingCaseTracker().get_all_ongoing_cases()
        return {"success": True, "total": len(cases), "cases": [case.to_dict() for case in cases]}
    except Exception:
        return {"success": True, "total": 0, "cases": []}


@router.get("/upcoming-hearings")
async def upcoming_hearings(request: Request):
    require_user(request)
    try:
        from ongoing_case_tracker import OngoingCaseTracker

        cases = OngoingCaseTracker().get_upcoming_hearings(30)
        return {"success": True, "total": len(cases), "hearings": [case.to_dict() for case in cases]}
    except Exception:
        return {"success": True, "total": 0, "hearings": []}


def _check_deadlines(conn):
    """通知拉取时轻量检查待办期限，失败不影响通知读取。"""
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        rows = conn.execute("SELECT * FROM meeting_todos WHERE status NOT IN ('已完成', '已取消') AND deadline != '' AND deadline IS NOT NULL").fetchall()
    except Exception:
        return
    for row in rows:
        deadline = row["deadline"] or ""
        if len(deadline) < 10:
            continue
        if deadline[:10] > today:
            continue
        key = f"notif_deadline_{row['id']}_{today}"
        if conn.execute("SELECT 1 FROM notifications WHERE id = ?", (key,)).fetchone():
            continue
        title = "待办已逾期" if deadline[:10] < today else "待办今日到期"
        conn.execute(
            "INSERT OR IGNORE INTO notifications (id, user_id, type, title, body, meeting_id, created_at, read) VALUES (?, '', 'warning', ?, ?, ?, ?, 0)",
            (key, title, f"{row['owner'] or '待确认'}：{row['task'] or ''}"[:120], row["meeting_id"] or "", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )


@router.get("/api/notifications")
async def notifications(request: Request):
    user = require_user(request)
    _init_app_db()
    user_id = user.get("id") or user.get("username", "")
    with _db_connect() as conn:
        _check_deadlines(conn)
        rows = conn.execute("SELECT * FROM notifications WHERE user_id = ? OR user_id = '' ORDER BY created_at DESC LIMIT 50", (user_id,)).fetchall()
        return {"notifications": [dict(row) for row in rows]}


@router.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(request: Request, notification_id: str):
    require_user(request)
    _init_app_db()
    with _db_connect() as conn:
        conn.execute("UPDATE notifications SET read = 1 WHERE id = ?", (notification_id,))
    return {"success": True}


@router.get("/api/meetings/search")
async def search_meetings(request: Request, q: str = "", limit: int = 30):
    user = require_user(request)
    keyword = (q or "").strip()
    if len(keyword) < 2:
        return {"results": [], "query": keyword, "total": 0}
    safe_limit = max(1, min(int(limit or 30), 100))
    ensure_legacy_agendas_searchable()
    meetings = _load_meetings()

    def can_access_meeting(meeting_id: str) -> bool:
        meeting = meetings.get(meeting_id) or {}
        if not meeting:
            return False
        try:
            _check_meeting_access(user, meeting)
        except HTTPException:
            return False
        return True

    def can_access_agenda(meeting_id: str, agenda_id: str) -> bool:
        meeting = meetings.get(meeting_id) or {}
        agenda = get_meeting_agenda(meeting_id, agenda_id)
        return bool(meeting and agenda and can_view_agenda(user, meeting, agenda))

    candidates = search_meeting_documents(keyword, safe_limit)
    results = build_authorized_search_results(
        candidates,
        safe_limit,
        can_access_meeting,
        can_access_agenda,
    )
    return {"results": results, "query": keyword, "total": len(results)}


def _meeting_export_payload(conn, meeting_id: str | None = None) -> list[dict]:
    query = "SELECT * FROM meetings ORDER BY created_at DESC" if meeting_id is None else "SELECT * FROM meetings WHERE id = ?"
    rows = conn.execute(query, () if meeting_id is None else (meeting_id,)).fetchall()
    payload = []
    for meeting in rows:
        mid = meeting["id"]
        transcripts = [dict(row) for row in conn.execute("SELECT * FROM meeting_transcripts WHERE meeting_id = ? ORDER BY client_time, id", (mid,)).fetchall()]
        todos = [dict(row) for row in conn.execute("SELECT * FROM meeting_todos WHERE meeting_id = ? ORDER BY created_at", (mid,)).fetchall()]
        raw_records = meeting["generated_records_json"] or ""
        try:
            records = json.loads(raw_records) if raw_records else {}
        except json.JSONDecodeError:
            records = {}
        payload.append({"id": mid, "title": meeting["title"], "project": meeting["project"], "agenda": meeting["agenda"], "meetingDate": meeting["meeting_date"], "meetingType": meeting["meeting_type"], "creator": meeting["creator"], "phase": meeting["phase"], "createdAt": meeting["created_at"], "transcripts": transcripts, "generatedRecords": records, "todos": todos})
    return payload


@router.get("/api/export/meetings")
async def export_all(request: Request):
    user = require_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可导出数据")
    _init_app_db()
    with _db_connect() as conn:
        meetings = _meeting_export_payload(conn)
    export = {"exportedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "meetingCount": len(meetings), "transcriptCount": sum(len(item["transcripts"]) for item in meetings), "todoCount": sum(len(item["todos"]) for item in meetings), "meetings": meetings}
    content = json.dumps(export, ensure_ascii=False, indent=2).encode("utf-8")
    return StreamingResponse(io.BytesIO(content), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="ai616_export_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json"'})


@router.get("/api/export/meetings/{meeting_id}")
async def export_single(request: Request, meeting_id: str):
    require_user(request)
    safe_id = _safe_meeting_id(meeting_id)
    _init_app_db()
    with _db_connect() as conn:
        meetings = _meeting_export_payload(conn, safe_id)
        if not meetings:
            raise HTTPException(status_code=404, detail="会议不存在")
        data = {"meeting": meetings[0], "exportedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("data.json", json.dumps(data, ensure_ascii=False, indent=2))
            for folder in (MEETING_FILES_DIR / "recordings" / safe_id, MEETING_FILES_DIR / safe_id):
                if folder.exists():
                    for path in folder.iterdir():
                        if path.is_file() and path.suffix.lower() in {".docx", ".pdf", ".xlsx", ".wav", ".webm", ".mp3", ".m4a"}:
                            archive.write(path, f"files/{path.name}")
    content.seek(0)
    return StreamingResponse(content, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{safe_id}_export_{datetime.now().strftime("%Y%m%d")}.zip"'})


@router.get("/api/dashboard/stats")
async def dashboard_stats(request: Request):
    require_user(request)
    _init_app_db()
    with _db_connect() as conn:
        total = conn.execute("SELECT COUNT(*) AS cnt FROM meetings").fetchone()["cnt"]
        active = conn.execute("SELECT COUNT(*) AS cnt FROM meetings WHERE phase NOT IN ('已归档', '')").fetchone()["cnt"]
        archived = conn.execute("SELECT COUNT(*) AS cnt FROM meetings WHERE phase = '已归档'").fetchone()["cnt"]
        total_transcripts = conn.execute("SELECT COUNT(*) AS cnt FROM meeting_transcripts").fetchone()["cnt"]
        recent = conn.execute("SELECT id, title, project, phase, meeting_date, updated_at FROM meetings ORDER BY updated_at DESC LIMIT 5").fetchall()
    return {"totalMeetings": total, "activeMeetings": active, "archivedMeetings": archived, "totalTranscripts": total_transcripts, "recentMeetings": [dict(row) for row in recent]}

"""会议会前素材与议题生成服务。"""

import re
import uuid
from datetime import datetime

from backend.config import MEETINGS_LOCK
from backend.db import (
    _check_meeting_access,
    _db_connect,
    _init_app_db,
    _load_meetings,
    _save_meetings,
    _safe_meeting_id,
    _invalidate_meetings_cache,
)


def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _meeting_or_error(meeting_id: str, user: dict) -> tuple[str, dict]:
    safe_id = _safe_meeting_id(meeting_id)
    meetings = _load_meetings()
    meeting = meetings.get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    _check_meeting_access(user, meeting)
    return safe_id, meeting


def append_issue(meeting_id: str, body: dict, user: dict) -> tuple[dict, dict]:
    with MEETINGS_LOCK:
        safe_id, meeting = _meeting_or_error(meeting_id, user)
        content = _clean_text(body.get("content"))
        if not content:
            raise ValueError("问题内容不能为空")
        now = _now_text()
        issue = {
            "id": f"issue_source_{uuid.uuid4().hex[:10]}",
            "name": _clean_text(body.get("name")) or user.get("name") or user.get("username") or "参会人",
            "time": datetime.now().strftime("%H:%M"),
            "type": _clean_text(body.get("type")) or "text",
            "content": content,
            "meta": _clean_text(body.get("meta")),
            "source": _clean_text(body.get("source")) or "manual",
            "serverTime": now,
            "userId": user.get("id") or "",
        }
        sources = list(meeting.get("issueSources") or [])
        sources.append(issue)
        meeting["issueSources"] = sources[-300:]
        meeting["phase"] = meeting.get("phase") or "问题收集中"
        meeting["updatedAt"] = now
        _save_meetings({**_load_meetings(), safe_id: meeting})
        _invalidate_meetings_cache()
    return issue, meeting


def _drafts_from_issues(issues: list[dict], meeting_mode: str = "normal") -> list[dict]:
    drafts = []
    seen = set()
    for index, issue in enumerate(issues):
        content = _clean_text(issue.get("content"))
        if not content:
            continue
        title = content.split("。", 1)[0].split("；", 1)[0].strip()[:56]
        title = title or f"议题 {index + 1}"
        key = re.sub(r"\W+", "", title)
        if key in seen:
            continue
        seen.add(key)
        drafts.append({
            "id": f"agenda-draft-{issue.get('id') or index + 1}",
            "title": title,
            "description": content,
            "source": issue.get("source") or "manual",
            "type": "major" if meeting_mode == "major" else "normal",
            "project": "",
            "issueIds": [issue.get("id")],
        })
    return drafts[:30]


def generate_agenda(meeting_id: str, user: dict) -> tuple[list[dict], dict]:
    with MEETINGS_LOCK:
        safe_id, meeting = _meeting_or_error(meeting_id, user)
        issues = list(meeting.get("issueSources") or [])
        if not issues:
            raise ValueError("请先收集至少一条问题或素材")
        drafts = _drafts_from_issues(issues, meeting.get("meetingMode") or "normal")
        if not drafts:
            raise ValueError("当前素材不足，无法生成议题")
        now = _now_text()
        meeting["agendaDrafts"] = drafts
        meeting["agenda"] = "；".join(item["title"] for item in drafts)[:180]
        meeting["updatedAt"] = now
        meetings = _load_meetings()
        meetings[safe_id] = meeting
        _save_meetings(meetings)
        _invalidate_meetings_cache()
    return drafts, meeting


def realtime_check(meeting_id: str, agenda_drafts: list[dict], latest_transcripts: list[dict], user: dict) -> list[dict]:
    _, meeting = _meeting_or_error(meeting_id, user)
    drafts = agenda_drafts[:8] or list(meeting.get("agendaDrafts") or [])[:8]
    if not drafts and meeting.get("agenda"):
        drafts = [{"id": "agenda-current", "title": meeting.get("agenda")}]
    if not drafts:
        raise ValueError("缺少会议议题，无法实时比对")
    text = " ".join(_clean_text(item.get("transcript") or item.get("text")) for item in latest_transcripts[-12:])
    results = []
    for draft in drafts:
        title = _clean_text(draft.get("title"))
        keywords = [part for part in re.split(r"[\s，,、；;：:。.!?！？（）()]+", title) if len(part) >= 2]
        hits = [word for word in keywords if word in text]
        results.append({
            "agendaId": draft.get("id") or "",
            "title": title,
            "status": "on_topic" if hits else "unconfirmed",
            "matchedKeywords": hits[:6],
            "evidence": text[-160:] if hits else "尚未在最近转写中发现对应关键词",
        })
    return results


def get_carryover_todos(meeting_id: str) -> list[dict]:
    """读取创建会议时自动带入的历史待办。

    该查询对应旧接口 ``GET /api/meetings/{meeting_id}/carryover-todos``。
    旧接口在数据库异常时返回空列表，以免历史待办读取失败阻塞会议流程，
    因此这里保留同样的降级语义；鉴权由 HTTP 路由层负责。
    """
    safe_id = _safe_meeting_id(meeting_id)
    try:
        _init_app_db()
        with _db_connect() as conn:
            rows = conn.execute(
                """
                SELECT id, task, owner, deadline, priority, status, reference
                FROM meeting_todos
                WHERE meeting_id = ? AND source = 'carryover'
                ORDER BY created_at DESC
                """,
                (safe_id,),
            ).fetchall()
        return [
            {
                "id": row["id"],
                "task": row["task"],
                "owner": row["owner"],
                "deadline": row["deadline"],
                "priority": row["priority"],
                "status": row["status"],
                "reference": row["reference"],
            }
            for row in rows
        ]
    except Exception:
        return []

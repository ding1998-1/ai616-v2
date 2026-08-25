"""Permission-agnostic meeting and agenda search candidate retrieval."""

from backend.config import APP_DB_LOCK
from backend.db import _db_connect, _init_app_db


def ensure_legacy_agendas_searchable() -> None:
    """Materialize only meetings that still have drafts but no formal agendas."""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            meeting_ids = [
                row["meeting_id"]
                for row in conn.execute(
                    """
                    SELECT DISTINCT drafts.meeting_id
                    FROM meeting_agenda_drafts drafts
                    WHERE NOT EXISTS (
                        SELECT 1 FROM meeting_agendas agendas
                        WHERE agendas.meeting_id = drafts.meeting_id
                    )
                    """
                ).fetchall()
            ]
    if not meeting_ids:
        return

    # list_meeting_agendas performs the existing idempotent agendaDrafts migration.
    # Keep it outside the database lock because it loads the meeting cache internally.
    from backend.services.agenda_service import list_meeting_agendas

    for meeting_id in meeting_ids:
        list_meeting_agendas(meeting_id)



def _match_snippet(text: str, keyword: str, radius: int = 42) -> str:
    value = " ".join(str(text or "").split())
    if not value:
        return ""
    index = value.lower().find(keyword.lower())
    if index < 0:
        return value[: radius * 2]
    start = max(0, index - radius)
    end = min(len(value), index + len(keyword) + radius)
    return f"{'…' if start else ''}{value[start:end]}{'…' if end < len(value) else ''}"


def search_meeting_documents(keyword: str, limit: int = 30) -> list[dict]:
    """Return ranked raw candidates; HTTP layer applies user/agenda ACL rules."""
    query = str(keyword or "").strip()
    if len(query) < 2:
        return []
    safe_limit = max(1, min(int(limit or 30), 100))
    like = f"%{query}%"
    prefix = f"{query}%"
    candidate_limit = min(safe_limit * 5, 500)
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                """
                SELECT d.*, m.title AS meeting_title, m.meeting_date,
                       m.meeting_type, m.phase AS meeting_phase
                FROM meeting_search_documents d
                JOIN meetings m ON m.id = d.meeting_id
                WHERE d.title LIKE ? OR d.content LIKE ?
                ORDER BY
                    CASE
                        WHEN lower(d.title) = lower(?) THEN 0
                        WHEN d.title LIKE ? THEN 1
                        WHEN d.title LIKE ? THEN 2
                        ELSE 3
                    END,
                    d.updated_at DESC,
                    d.title
                LIMIT ?
                """,
                (like, like, query, prefix, like, candidate_limit),
            ).fetchall()
    candidates = []
    for row in rows:
        title = row["title"] or ""
        content = row["content"] or ""
        matched_source = title if query.lower() in title.lower() else content
        candidates.append(
            {
                "type": row["entity_type"],
                "entityId": row["entity_id"],
                "meetingId": row["meeting_id"],
                "title": title,
                "content": content,
                "matchText": _match_snippet(matched_source, query),
                "status": row["status"] or "",
                "confidentialityLevel": row["confidentiality_level"] or "normal",
                "updatedAt": row["updated_at"] or "",
                "meetingTitle": row["meeting_title"] or "未命名会议",
                "meetingDate": row["meeting_date"] or "",
                "meetingType": row["meeting_type"] or "会议",
                "meetingPhase": row["meeting_phase"] or "",
            }
        )
    return candidates


def build_authorized_search_results(
    candidates: list[dict],
    limit: int,
    can_access_meeting,
    can_access_agenda,
) -> list[dict]:
    """Shape candidates after caller-provided meeting and agenda permission checks."""
    safe_limit = max(1, min(int(limit or 30), 100))
    results = []
    seen = set()
    for candidate in candidates:
        if not can_access_meeting(candidate["meetingId"]):
            continue
        if candidate["type"] == "agenda":
            if not can_access_agenda(candidate["meetingId"], candidate["entityId"]):
                continue
            result_key = f"agenda:{candidate['entityId']}"
            if result_key in seen:
                continue
            seen.add(result_key)
            results.append(
                {
                    "type": "agenda",
                    "agendaId": candidate["entityId"],
                    "agendaTitle": candidate["title"],
                    "agendaStatus": candidate["status"],
                    "meetingId": candidate["meetingId"],
                    "meetingTitle": candidate["meetingTitle"],
                    "meetingDate": candidate["meetingDate"],
                    "meetingType": candidate["meetingType"],
                    "meetingPhase": candidate["meetingPhase"],
                    "matchType": "议题",
                    "matchText": candidate["matchText"],
                }
            )
        else:
            result_key = f"meeting:{candidate['meetingId']}"
            if result_key in seen:
                continue
            seen.add(result_key)
            results.append(
                {
                    "type": "meeting",
                    "meetingId": candidate["meetingId"],
                    "meetingTitle": candidate["meetingTitle"],
                    "meetingDate": candidate["meetingDate"],
                    "meetingType": candidate["meetingType"],
                    "meetingPhase": candidate["meetingPhase"],
                    "matchType": "会议",
                    "matchText": candidate["matchText"],
                }
            )
        if len(results) >= safe_limit:
            break
    return results

import pytest

import backend.db as db
from backend.services.meeting_search_service import (
    build_authorized_search_results,
    ensure_legacy_agendas_searchable,
    search_meeting_documents,
)


@pytest.fixture
def temp_database(monkeypatch, tmp_path):
    existing = getattr(db._db_conn_local, "conn", None)
    if existing is not None:
        existing.close()
        delattr(db._db_conn_local, "conn")
    monkeypatch.setattr(db, "APP_DB", tmp_path / "app.db")
    monkeypatch.setattr(db, "_meetings_cache", None)
    monkeypatch.setattr(db, "_meetings_cache_time", 0.0)
    db._init_app_db()
    yield
    connection = getattr(db._db_conn_local, "conn", None)
    if connection is not None:
        connection.close()
        delattr(db._db_conn_local, "conn")


def test_search_documents_follow_meeting_and_agenda_writes(temp_database):
    with db._db_connect() as conn:
        conn.execute(
            """
            INSERT INTO meetings (
                id, title, project, creator, meeting_date, meeting_type,
                phase, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "meeting-search-1", "周二项目例会", "城市更新项目", "张三",
                "2026-08-25 10:00", "经营例会", "会前确认",
                "2026-08-24 10:00:00", "2026-08-24 10:00:00",
            ),
        )
        conn.execute(
            """
            INSERT INTO meeting_agendas (
                id, meeting_id, agenda_no, title, description, status,
                sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "agenda-search-1", "meeting-search-1", 1,
                "预算调整与责任分工", "讨论延期原因和下一阶段负责人",
                "scheduled", 1, "2026-08-24 10:00:00", "2026-08-24 10:00:00",
            ),
        )

    agenda_results = search_meeting_documents("责任分工")
    assert len(agenda_results) == 1
    assert agenda_results[0]["type"] == "agenda"
    assert agenda_results[0]["meetingId"] == "meeting-search-1"
    assert agenda_results[0]["meetingTitle"] == "周二项目例会"

    meeting_results = search_meeting_documents("城市更新")
    assert len(meeting_results) == 1
    assert meeting_results[0]["type"] == "meeting"

    with db._db_connect() as conn:
        conn.execute(
            "UPDATE meeting_agendas SET title = ?, updated_at = ? WHERE id = ?",
            ("预算复核", "2026-08-24 11:00:00", "agenda-search-1"),
        )
    assert search_meeting_documents("预算复核")[0]["entityId"] == "agenda-search-1"


def test_legacy_agenda_drafts_are_materialized_and_searchable(temp_database):
    with db._db_connect() as conn:
        conn.execute(
            """
            INSERT INTO meetings (
                id, title, meeting_date, meeting_type, phase, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "meeting-legacy-1", "历史办公会", "2026-08-20 10:00",
                "总经理办公会", "会前确认", "2026-08-20 09:00:00", "2026-08-20 09:00:00",
            ),
        )
        conn.execute(
            """
            INSERT INTO meeting_agenda_drafts (
                row_id, meeting_id, draft_id, title, source, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "legacy-row-1", "meeting-legacy-1", "legacy-draft-1",
                "历史预算复盘", "legacy-import", 0,
            ),
        )
    db._meetings_cache = None
    ensure_legacy_agendas_searchable()
    with db._db_connect() as conn:
        agenda = conn.execute(
            "SELECT id, meeting_id, title FROM meeting_agendas WHERE meeting_id = ?",
            ("meeting-legacy-1",),
        ).fetchone()
    assert agenda is not None
    assert agenda["title"] == "历史预算复盘"
    results = search_meeting_documents("历史预算复盘")
    assert any(item["type"] == "agenda" and item["meetingTitle"] == "历史办公会" for item in results)


def test_search_results_filter_meeting_and_confidential_agenda():
    candidates = [
        {
            "type": "agenda", "entityId": "agenda-visible", "meetingId": "visible",
            "title": "可见议题", "status": "scheduled", "matchText": "可见议题",
            "meetingTitle": "可见会议", "meetingDate": "2026-08-25 10:00",
            "meetingType": "普通会议", "meetingPhase": "会前确认",
        },
        {
            "type": "agenda", "entityId": "agenda-secret", "meetingId": "visible",
            "title": "保密议题", "status": "scheduled", "matchText": "保密议题",
            "meetingTitle": "可见会议", "meetingDate": "2026-08-25 10:00",
            "meetingType": "普通会议", "meetingPhase": "会前确认",
        },
        {
            "type": "meeting", "entityId": "hidden", "meetingId": "hidden",
            "title": "隐藏会议", "status": "会前确认", "matchText": "隐藏会议",
            "meetingTitle": "隐藏会议", "meetingDate": "2026-08-25 14:00",
            "meetingType": "普通会议", "meetingPhase": "会前确认",
        },
    ]

    results = build_authorized_search_results(
        candidates,
        30,
        can_access_meeting=lambda meeting_id: meeting_id != "hidden",
        can_access_agenda=lambda _meeting_id, agenda_id: agenda_id != "agenda-secret",
    )
    assert len(results) == 1
    assert results[0]["agendaId"] == "agenda-visible"
    assert results[0]["meetingTitle"] == "可见会议"

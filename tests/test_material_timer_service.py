import sqlite3

from backend.services import agenda_timer_service, material_service


def test_material_upload_is_atomic_and_resolvable(monkeypatch, tmp_path):
    meetings = {"m1": {"id": "m1", "title": "例会", "materials": [], "events": []}}
    monkeypatch.setattr(material_service, "MEETING_FILES_DIR", tmp_path)
    monkeypatch.setattr(material_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(material_service, "_save_meetings", lambda value: None)
    monkeypatch.setattr(material_service, "_check_meeting_access", lambda user, meeting: None)
    monkeypatch.setattr(material_service, "_invalidate_meetings_cache", lambda: None)

    record, _ = material_service.save_material("m1", "预算说明", "../预算说明.pdf", b"pdf-bytes", {"name": "张三"})
    assert record["fileName"] == "预算说明.pdf"
    resolved, path = material_service.resolve_material("m1", record["id"], {"name": "张三"})
    assert resolved["id"] == record["id"]
    assert path.read_bytes() == b"pdf-bytes"


def test_agenda_timer_start_extend_and_reset(monkeypatch):
    meetings = {"m1": {"id": "m1", "agendaDrafts": [{"id": "a1", "title": "预算", "timerExtended": 0}]}}
    monkeypatch.setattr(agenda_timer_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(agenda_timer_service, "_save_meetings", lambda value: None)
    monkeypatch.setattr(agenda_timer_service, "_check_meeting_access", lambda user, meeting: None)
    monkeypatch.setattr(agenda_timer_service, "_invalidate_meetings_cache", lambda: None)
    user = {"id": "u1"}

    started = agenda_timer_service.timer_action("m1", "a1", "start", 5, user)
    assert started["activeAgendaId"] == "a1"
    extended = agenda_timer_service.timer_action("m1", "a1", "extend", 5, user)
    assert extended["agendaDrafts"][0]["timerExtended"] == 5
    reset = agenda_timer_service.timer_action("m1", "a1", "reset", 5, user)
    assert reset["activeAgendaId"] == ""
    assert reset["agendaDrafts"][0]["timerStartedAt"] == ""


def test_meeting_timer_legacy_actions_preserve_response_shape(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE meetings (
            id TEXT PRIMARY KEY,
            timer_started_at TEXT NOT NULL DEFAULT '',
            agenda_duration_minutes INTEGER NOT NULL DEFAULT 15,
            creator TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute(
        "INSERT INTO meetings (id, timer_started_at, agenda_duration_minutes) VALUES (?, ?, ?)",
        ("m1", "2026-08-24 09:00:00", 15),
    )
    conn.commit()

    monkeypatch.setattr(agenda_timer_service, "_db_connect", lambda: conn)
    monkeypatch.setattr(agenda_timer_service, "_init_app_db", lambda: None)
    monkeypatch.setattr(agenda_timer_service, "_safe_meeting_id", lambda value: value)
    monkeypatch.setattr(agenda_timer_service, "_check_meeting_access", lambda user, meeting: None)
    monkeypatch.setattr(agenda_timer_service, "_invalidate_meetings_cache", lambda: None)
    monkeypatch.setattr(agenda_timer_service, "_now_text", lambda: "2026-08-24 10:00:00")

    started = agenda_timer_service.meeting_timer_action("m1", "start", None, {"id": "u1"})
    assert started == {
        "success": True,
        "meetingId": "m1",
        "action": "start",
        "timerStartedAt": "2026-08-24 10:00:00",
        "durationMinutes": 15,
    }

    reset = agenda_timer_service.meeting_timer_action("m1", "reset", None, {"id": "u1"})
    # The legacy handler reads the meeting row before applying reset, so it
    # returns the previous timestamp in this response field.
    assert reset["action"] == "reset"
    assert reset["timerStartedAt"] == "2026-08-24 10:00:00"
    assert reset["durationMinutes"] == 15

    changed = agenda_timer_service.meeting_timer_action("m1", "set-duration", 45, {"id": "u1"})
    assert changed["durationMinutes"] == 45
    assert changed["action"] == "set-duration"


def test_meeting_timer_missing_meeting_is_not_silently_created(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE meetings (id TEXT PRIMARY KEY, timer_started_at TEXT, agenda_duration_minutes INTEGER)")
    conn.commit()
    monkeypatch.setattr(agenda_timer_service, "_db_connect", lambda: conn)
    monkeypatch.setattr(agenda_timer_service, "_init_app_db", lambda: None)
    monkeypatch.setattr(agenda_timer_service, "_safe_meeting_id", lambda value: value)
    monkeypatch.setattr(agenda_timer_service, "_now_text", lambda: "2026-08-24 10:00:00")

    import pytest

    with pytest.raises(KeyError, match="会议不存在"):
        agenda_timer_service.meeting_timer_action("missing", "start", None, {"id": "u1"})

import sqlite3

from backend.services import meeting_support_service


def test_issue_generation_creates_topic_drafts(monkeypatch):
    meetings = {"m1": {"id": "m1", "meetingMode": "normal", "issueSources": []}}
    monkeypatch.setattr(meeting_support_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(meeting_support_service, "_save_meetings", lambda value: None)
    monkeypatch.setattr(meeting_support_service, "_check_meeting_access", lambda user, meeting: None)
    monkeypatch.setattr(meeting_support_service, "_invalidate_meetings_cache", lambda: None)

    issue, _ = meeting_support_service.append_issue("m1", {"content": "预算调整方案需要补充测算", "source": "manual"}, {"id": "u1", "name": "张三"})
    drafts, meeting = meeting_support_service.generate_agenda("m1", {"id": "u1"})
    assert issue["content"] == "预算调整方案需要补充测算"
    assert drafts[0]["title"] == "预算调整方案需要补充测算"
    assert meeting["agendaDrafts"] == drafts


def test_realtime_check_returns_local_evidence(monkeypatch):
    meeting = {"id": "m1", "agendaDrafts": [{"id": "a1", "title": "预算调整方案"}]}
    monkeypatch.setattr(meeting_support_service, "_load_meetings", lambda: {"m1": meeting})
    monkeypatch.setattr(meeting_support_service, "_check_meeting_access", lambda user, value: None)
    results = meeting_support_service.realtime_check("m1", [], [{"transcript": "今天讨论预算调整方案"}], {"id": "u1"})
    assert results[0]["status"] == "on_topic"
    assert "预算调整方案" in results[0]["matchedKeywords"]


def test_get_carryover_todos_returns_legacy_projection(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE meeting_todos (
            id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL,
            task TEXT,
            owner TEXT,
            deadline TEXT,
            priority TEXT,
            status TEXT,
            source TEXT,
            reference TEXT,
            created_at TEXT
        )
        """
    )
    conn.executemany(
        """
        INSERT INTO meeting_todos
            (id, meeting_id, task, owner, deadline, priority, status, source, reference, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ("todo-1", "m1", "补充测算", "张三", "2026-08-30", "高", "待处理", "carryover", "来自：例会", "2026-08-24 10:00:00"),
            ("todo-2", "m1", "确认预算", "李四", "", "中", "进行中", "ai", "", "2026-08-24 11:00:00"),
        ],
    )
    conn.commit()
    monkeypatch.setattr(meeting_support_service, "_db_connect", lambda: conn)
    monkeypatch.setattr(meeting_support_service, "_init_app_db", lambda: None)
    monkeypatch.setattr(meeting_support_service, "_safe_meeting_id", lambda value: value)

    assert meeting_support_service.get_carryover_todos("m1") == [
        {
            "id": "todo-1",
            "task": "补充测算",
            "owner": "张三",
            "deadline": "2026-08-30",
            "priority": "高",
            "status": "待处理",
            "reference": "来自：例会",
        }
    ]


def test_get_carryover_todos_degrades_to_empty_on_database_error(monkeypatch):
    monkeypatch.setattr(meeting_support_service, "_init_app_db", lambda: None)
    monkeypatch.setattr(meeting_support_service, "_db_connect", lambda: (_ for _ in ()).throw(RuntimeError("db down")))
    monkeypatch.setattr(meeting_support_service, "_safe_meeting_id", lambda value: value)

    assert meeting_support_service.get_carryover_todos("m1") == []

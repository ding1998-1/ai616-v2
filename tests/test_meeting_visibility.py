import pytest
import sqlite3
from contextlib import contextmanager
from fastapi import HTTPException

from backend import db
from backend.db import _check_meeting_access
from backend.services import meeting_service


def test_same_department_does_not_implicitly_grant_meeting_access():
    user = {"name": "dzq", "dept": "信息管理中心", "role": "staff"}
    meeting = {"id": "meeting-admin", "creator": "信息管理中心 系统管理员"}
    with pytest.raises(HTTPException) as exc:
        _check_meeting_access(user, meeting)
    assert exc.value.status_code == 403


def test_short_name_does_not_match_another_creator_by_substring():
    user = {"name": "李", "dept": "综合部", "role": "staff"}
    meeting = {"id": "meeting-other-li", "creator": "综合部 李明"}
    with pytest.raises(HTTPException) as exc:
        _check_meeting_access(user, meeting)
    assert exc.value.status_code == 403


def test_regular_user_list_only_contains_owned_meetings(monkeypatch):
    meetings = {
        "meeting-admin": {
            "id": "meeting-admin", "title": "管理员会议", "creator": "信息管理中心 系统管理员",
            "phase": "会前确认", "updatedAt": "2026-09-17 11:00:00", "archived": False,
        },
        "meeting-dzq": {
            "id": "meeting-dzq", "title": "dzq会议", "creator": "信息管理中心 dzq",
            "phase": "会前确认", "updatedAt": "2026-09-17 12:00:00", "archived": False,
        },
    }
    monkeypatch.setattr(meeting_service, "_load_meetings", lambda: meetings)
    result = meeting_service.list_meetings({"name": "dzq", "dept": "信息管理中心", "role": "staff"})
    assert [item["id"] for item in result["meetings"]] == ["meeting-dzq"]


def test_admin_list_contains_all_meetings(monkeypatch):
    meetings = {
        "meeting-a": {"id": "meeting-a", "creator": "A", "updatedAt": "1", "archived": False},
        "meeting-b": {"id": "meeting-b", "creator": "B", "updatedAt": "2", "archived": False},
    }
    monkeypatch.setattr(meeting_service, "_load_meetings", lambda: meetings)
    result = meeting_service.list_meetings({"name": "管理员", "role": "admin"})
    assert {item["id"] for item in result["meetings"]} == {"meeting-a", "meeting-b"}


def test_meeting_list_exposes_compact_agenda_titles(monkeypatch):
    meetings = {
        "meeting-agendas": {
            "id": "meeting-agendas",
            "creator": "管理员",
            "updatedAt": "2",
            "archived": False,
            "agenda": "待确认议题",
            "agendaDrafts": [
                {"id": "a1", "title": "年度预算审议"},
                {"id": "a2", "title": "重点项目推进"},
            ],
        },
        "meeting-empty": {
            "id": "meeting-empty",
            "creator": "管理员",
            "updatedAt": "1",
            "archived": False,
            "agenda": "待确认议题",
            "agendaDrafts": [],
        },
    }
    monkeypatch.setattr(meeting_service, "_load_meetings", lambda: meetings)

    result = meeting_service.list_meetings({"name": "管理员", "role": "admin"})

    assert result["meetings"][0]["agendaTitles"] == ["年度预算审议", "重点项目推进"]
    assert result["meetings"][0]["issueCount"] == 2
    assert result["meetings"][1]["agendaTitles"] == []
    assert result["meetings"][1]["issueCount"] == 0


def test_legacy_transcript_identity_grants_historical_meeting_access(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.executescript(
        """
        CREATE TABLE meeting_participants (meeting_id TEXT, user_id TEXT);
        CREATE TABLE meeting_transcripts (
            meeting_id TEXT, speaker_user_id TEXT, username TEXT
        );
        CREATE TABLE meeting_events (meeting_id TEXT, payload_json TEXT);
        INSERT INTO meeting_transcripts VALUES (
            'meeting-history', 'participant_e5f5786603', 'zyy'
        );
        """
    )

    @contextmanager
    def fake_db_connect():
        yield conn

    monkeypatch.setattr(db, "_db_connect", fake_db_connect)
    _check_meeting_access(
        {
            "id": "participant_e5f5786603", "username": "zyy",
            "name": "zyy", "dept": "参会单位", "role": "participant",
        },
        {"id": "meeting-history", "creator": "信息管理中心 系统管理员"},
    )

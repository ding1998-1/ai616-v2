"""成果签署服务的纯内存测试，不触碰项目数据库。"""

import sqlite3

import pytest

from backend.services import signature_service
from backend.services.signature_service import _resolve_target, compute_content_hash


def _connection():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE meeting_agenda_decisions (
            id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL,
            agenda_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL
        );
        CREATE TABLE meeting_record_versions (
            id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            records_json TEXT NOT NULL
        );
        CREATE TABLE meetings (
            id TEXT PRIMARY KEY,
            generated_records_json TEXT NOT NULL
        );
        """
    )
    return conn


def test_resolve_decision_uses_database_content_and_version():
    conn = _connection()
    conn.execute(
        "INSERT INTO meeting_agenda_decisions VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("dec-1", "m-1", "ag-1", 3, "预算", "同意通过", "draft"),
    )
    target = _resolve_target(conn, "m-1", "ag-1", "decision", "dec-1")
    assert target == {
        "targetId": "dec-1",
        "agendaId": "ag-1",
        "version": 3,
        "content": "预算\n同意通过",
    }


def test_resolve_target_rejects_cross_agenda_and_archived_decision():
    conn = _connection()
    conn.execute(
        "INSERT INTO meeting_agenda_decisions VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("dec-1", "m-1", "ag-1", 1, "预算", "同意", "archived"),
    )
    with pytest.raises(ValueError, match="不存在或不属于"):
        _resolve_target(conn, "m-1", "ag-2", "decision", "dec-1")
    with pytest.raises(ValueError, match="已归档"):
        _resolve_target(conn, "m-1", "ag-1", "decision", "dec-1")


def test_content_hash_binds_agenda_target_version_and_content():
    first = compute_content_hash("m-1", "ag-1", "dec-1", 1, "同意")
    assert first != compute_content_hash("m-1", "ag-2", "dec-1", 1, "同意")
    assert first != compute_content_hash("m-1", "ag-1", "dec-1", 2, "同意")
    assert first != compute_content_hash("m-1", "ag-1", "dec-1", 1, "不同内容")


def test_decision_must_be_confirmed_and_becomes_signed_after_all_sign(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE meeting_agenda_decisions (
            id TEXT PRIMARY KEY, meeting_id TEXT, agenda_id TEXT, version INTEGER,
            title TEXT, content TEXT, status TEXT, updated_at TEXT
        );
        CREATE TABLE meeting_participants (meeting_id TEXT, user_id TEXT);
        CREATE TABLE meeting_signatures (
            id TEXT PRIMARY KEY, meeting_id TEXT, agenda_id TEXT, target_type TEXT,
            target_id TEXT, version INTEGER, content_hash TEXT, signer_user_id TEXT,
            signer_name TEXT, signer_role TEXT, signature_data TEXT, status TEXT,
            signed_at TEXT, payload_json TEXT
        );
        """
    )
    conn.execute(
        "INSERT INTO meeting_agenda_decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("dec-1", "m-1", "ag-1", 1, "预算", "同意", "draft", ""),
    )
    conn.executemany(
        "INSERT INTO meeting_participants VALUES (?, ?)",
        [("m-1", "u-1"), ("m-1", "u-2")],
    )
    conn.commit()
    monkeypatch.setattr(signature_service, "_init_app_db", lambda: None)
    monkeypatch.setattr(signature_service, "_db_connect", lambda: conn)

    with pytest.raises(ValueError, match="必须先确认"):
        signature_service.sign_target(
            "m-1", "ag-1", "decision", "dec-1", 1, "预算\n同意", "u-1", "张三"
        )

    conn.execute("UPDATE meeting_agenda_decisions SET status = 'confirmed' WHERE id = 'dec-1'")
    conn.commit()
    signature_service.sign_target(
        "m-1", "ag-1", "decision", "dec-1", 1, "预算\n同意", "u-1", "张三"
    )
    assert conn.execute("SELECT status FROM meeting_agenda_decisions").fetchone()["status"] == "signing"

    signature_service.sign_target(
        "m-1", "ag-1", "decision", "dec-1", 1, "预算\n同意", "u-2", "李四"
    )
    assert conn.execute("SELECT status FROM meeting_agenda_decisions").fetchone()["status"] == "signed"
    conn.close()

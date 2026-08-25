"""议题决议确认/修改/否决闭环测试。

通过内存 SQLite 验证状态和版本规则，避免修改项目数据库。
"""

import sqlite3

import pytest

from backend.services import agenda_service, signature_service


@pytest.fixture
def decision_db(monkeypatch):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE meeting_agenda_decisions (
            id TEXT PRIMARY KEY,
            meeting_id TEXT NOT NULL,
            agenda_id TEXT NOT NULL,
            decision_no TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT NOT NULL,
            source TEXT NOT NULL,
            version INTEGER NOT NULL,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            confirmed_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
        """
    )
    monkeypatch.setattr(agenda_service, "_init_app_db", lambda: None)
    monkeypatch.setattr(agenda_service, "_db_connect", lambda: conn)
    yield conn
    conn.close()


def test_confirm_modify_invalidates_signature_and_reopens_draft(decision_db, monkeypatch):
    invalidated = []
    monkeypatch.setattr(
        signature_service,
        "invalidate_target_signatures",
        lambda *args: invalidated.append(args),
    )

    created = agenda_service.create_agenda_decision(
        "m-1", "ag-1", "预算调整", "同意调整预算", created_by="秘书"
    )
    assert created["status"] == "draft"
    assert created["version"] == 1
    assert created["confirmedAt"] == ""

    confirmed = agenda_service.update_agenda_decision(
        "m-1", "ag-1", created["id"], {"status": "confirmed"}
    )
    assert confirmed["status"] == "confirmed"
    assert confirmed["version"] == 1
    assert confirmed["confirmedAt"]

    modified = agenda_service.update_agenda_decision(
        "m-1", "ag-1", created["id"], {"content": "同意调整预算并补充资金来源"}
    )
    assert modified["status"] == "draft"
    assert modified["version"] == 2
    assert modified["confirmedAt"] == ""
    assert invalidated == [("m-1", "decision", created["id"])]


def test_rejected_requires_reopen_before_reconfirm(decision_db):
    created = agenda_service.create_agenda_decision(
        "m-1", "ag-1", "方案", "暂缓", created_by="秘书"
    )
    rejected = agenda_service.update_agenda_decision(
        "m-1", "ag-1", created["id"], {"status": "否决"}
    )
    assert rejected["status"] == "rejected"
    assert rejected["confirmedAt"] == ""

    with pytest.raises(ValueError, match="不能从 rejected 变更为 confirmed"):
        agenda_service.update_agenda_decision(
            "m-1", "ag-1", created["id"], {"status": "confirmed"}
        )

    reopened = agenda_service.update_agenda_decision(
        "m-1", "ag-1", created["id"], {"status": "draft"}
    )
    assert reopened["status"] == "draft"
    confirmed = agenda_service.update_agenda_decision(
        "m-1", "ag-1", created["id"], {"status": "confirmed"}
    )
    assert confirmed["status"] == "confirmed"
    assert confirmed["confirmedAt"]


def test_status_chain_and_archive_immutability(decision_db):
    created = agenda_service.create_agenda_decision(
        "m-1", "ag-1", "项目", "按方案执行", created_by="秘书"
    )
    decision_id = created["id"]
    for status in ("confirmed", "signing", "signed", "archived"):
        created = agenda_service.update_agenda_decision(
            "m-1", "ag-1", decision_id, {"status": status}
        )
        assert created["status"] == status

    with pytest.raises(ValueError, match="已归档决议不可修改"):
        agenda_service.update_agenda_decision(
            "m-1", "ag-1", decision_id, {"content": "违规修改"}
        )

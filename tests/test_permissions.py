"""参会人会议访问判断的纯内存测试。"""

import pytest
from fastapi import HTTPException

import backend.db as db


class _FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, _sql, _args):
        return self

    def fetchone(self):
        return {"ok": 1}


def test_registered_participant_can_access_meeting(monkeypatch):
    monkeypatch.setattr(db, "_db_connect", lambda: _FakeConn())
    db._check_meeting_access(
        {"id": "participant-1", "name": "李四", "role": "participant"},
        {"id": "meeting-1", "creator": "张三"},
    )


def test_unregistered_user_is_rejected(monkeypatch):
    class _NoParticipant(_FakeConn):
        def fetchone(self):
            return None

    monkeypatch.setattr(db, "_db_connect", lambda: _NoParticipant())
    with pytest.raises(HTTPException) as exc_info:
        db._check_meeting_access(
            {"id": "outsider", "name": "王五", "role": "participant"},
            {"id": "meeting-1", "creator": "张三"},
        )
    assert exc_info.value.status_code == 403

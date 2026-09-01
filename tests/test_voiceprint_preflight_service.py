"""会前声纹预检与阶段拦截测试。

测试只替换服务的读库函数，不触碰项目 data/app.db。
"""

import pytest

from backend.services import meeting_service, voiceprint_preflight_service


def test_check_meeting_voiceprints_reports_missing_and_enrolled(monkeypatch):
    participants = [
        {
            "rowId": "p-1", "userId": "u-1", "username": "alice",
            "displayName": "张三", "meetingRole": "主持人", "dept": "办公室",
        },
        {
            "rowId": "p-2", "userId": "u-2", "username": "bob",
            "displayName": "李四", "meetingRole": "参会人", "dept": "工程部",
        },
    ]
    monkeypatch.setattr(voiceprint_preflight_service, "_load_participants", lambda _meeting_id: participants)
    monkeypatch.setattr(
        voiceprint_preflight_service,
        "_load_profiles",
        lambda _user_ids: {
            "u-1": {
                "user_id": "u-1", "display_name": "张三", "sample_count": 2,
                "embedding": b"embedding", "updated_at": "2026-08-21 10:00:00",
            }
        },
    )

    result = voiceprint_preflight_service.check_meeting_voiceprints("m-1")

    assert result["ok"] is False
    assert result["participantCount"] == 2
    assert result["enrolledCount"] == 1
    assert result["missingCount"] == 1
    assert result["missing"][0]["userId"] == "u-2"
    assert result["missing"][0]["reason"] == "voiceprint_not_enrolled"


def test_missing_participant_user_id_never_matches_username_profile(monkeypatch):
    participants = [
        {
            "rowId": "p-1", "userId": "", "username": "alice",
            "displayName": "张三", "meetingRole": "参会人", "dept": "",
        }
    ]
    monkeypatch.setattr(voiceprint_preflight_service, "_load_participants", lambda _meeting_id: participants)
    monkeypatch.setattr(
        voiceprint_preflight_service,
        "_load_profiles",
        lambda _user_ids: {
            "alice": {
                "user_id": "alice", "display_name": "张三", "sample_count": 1,
                "embedding": b"embedding", "updated_at": "2026-08-21 10:00:00",
            }
        },
    )

    result = voiceprint_preflight_service.check_meeting_voiceprints("m-1")

    assert result["ok"] is False
    assert result["missing"][0]["reason"] == "participant_missing_user_id"


def test_require_voiceprints_raises_structured_409(monkeypatch):
    monkeypatch.setattr(
        voiceprint_preflight_service,
        "check_meeting_voiceprints",
        lambda _meeting_id: {
            "ok": False, "meetingId": "m-1", "missing": [{"userId": "u-2"}],
            "missingCount": 1,
        },
    )

    with pytest.raises(voiceprint_preflight_service.VoiceprintPreflightError) as exc_info:
        voiceprint_preflight_service.require_meeting_voiceprints("m-1")

    error = exc_info.value
    assert error.status_code == 409
    assert error.detail["code"] == "voiceprint_enrollment_required"
    assert error.detail["missing"][0]["userId"] == "u-2"


def test_update_stage_does_not_require_voiceprint_enrollment(monkeypatch):
    meetings = {"m-1": {"id": "m-1", "phase": "会前确认", "events": []}}
    calls = []

    monkeypatch.setattr(meeting_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(meeting_service, "_save_meetings", lambda _meetings: calls.append("saved"))
    monkeypatch.setattr(meeting_service, "_check_meeting_access", lambda _user, _meeting: None)

    result = meeting_service.update_stage("m-1", "meeting", "会中记录", {"id": "u-admin"})

    assert calls == ["saved"]
    assert result["phase"] == "会中记录"


def test_voiceprint_preflight_remains_optional_diagnostic(monkeypatch):
    meetings = {"m-1": {"id": "m-1", "phase": "会前确认", "events": []}}
    calls = []

    monkeypatch.setattr(meeting_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(meeting_service, "_save_meetings", lambda _meetings: calls.append("saved"))
    monkeypatch.setattr(meeting_service, "_check_meeting_access", lambda _user, _meeting: None)
    result = meeting_service.update_stage("m-1", "meeting", "会中记录", {"id": "u-admin"})

    assert calls == ["saved"]
    assert result["phase"] == "会中记录"
    assert result["events"][-1]["stage"] == "meeting"

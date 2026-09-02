import asyncio

import pytest

from backend.services import transcript_service
from backend.routes import transcripts as transcript_routes


def test_record_owned_by_prefers_stable_user_id():
    user = {"id": "user-1", "username": "new-login", "name": "新姓名"}
    role = {"userId": "user-1", "username": "new-login", "displayName": "新姓名"}
    assert transcript_service.record_owned_by({"speakerUserId": "user-1"}, user, role)
    assert not transcript_service.record_owned_by({"speakerUserId": "user-2"}, user, role)


def test_record_owned_by_keeps_historical_username_and_speaker_fallbacks():
    user = {"id": "user-1", "username": "dzq", "name": "丁志强"}
    role = {"userId": "user-1", "username": "dzq", "displayName": "丁志强"}
    assert transcript_service.record_owned_by({"username": "DZQ"}, user, role)
    assert transcript_service.record_owned_by(
        {"speaker": {"displayName": "丁志强"}}, user, role
    )
    assert not transcript_service.record_owned_by(
        {"username": "other", "speakerName": "其他人"}, user, role
    )


def test_owner_only_filters_before_pagination(monkeypatch):
    user = {"id": "user-1", "username": "dzq", "name": "丁志强"}
    own_rows = [
        {"id": f"own-{index}", "username": "dzq", "transcript": str(index)}
        for index in range(49)
    ]
    other_rows = [
        {"id": f"other-{index}", "username": "other", "transcript": str(index)}
        for index in range(250)
    ]
    monkeypatch.setattr(
        transcript_routes,
        "require_meeting",
        lambda *_: (user, "meeting-1", {"id": "meeting-1"}),
    )
    monkeypatch.setattr(transcript_routes, "visible_agenda_ids", lambda *_: set())
    monkeypatch.setattr(
        transcript_routes,
        "_resolve_meeting_role",
        lambda *_: {"userId": "user-1", "username": "dzq", "displayName": "丁志强"},
    )
    monkeypatch.setattr(
        transcript_routes,
        "_db_load_transcripts_for_meeting",
        lambda *_: {"transcripts": own_rows + other_rows, "events": []},
    )

    result = asyncio.run(
        transcript_routes.get_transcripts(
            object(), "meeting-1", limit=30, offset=0, agenda_id="", owner_only=True
        )
    )

    assert result["totalTranscripts"] == 49
    assert len(result["transcripts"]) == 30
    assert all(row["username"] == "dzq" for row in result["transcripts"])


def test_requested_agenda_must_belong_to_meeting(monkeypatch):
    monkeypatch.setattr(transcript_service, "get_meeting_active_agenda", lambda _: {"id": "ag-active"})
    monkeypatch.setattr(
        transcript_service,
        "get_meeting_agenda",
        lambda meeting_id, agenda_id: {"id": agenda_id} if agenda_id == "ag-owned" else None,
    )

    assert transcript_service.resolve_agenda_id("m1", "ag-owned") == "ag-owned"
    with pytest.raises(ValueError, match="不属于当前会议"):
        transcript_service.resolve_agenda_id("m1", "ag-other")


def test_missing_requested_agenda_uses_persisted_active_agenda(monkeypatch):
    monkeypatch.setattr(transcript_service, "get_meeting_active_agenda", lambda _: {"id": "ag-active"})
    monkeypatch.setattr(transcript_service, "get_meeting_agenda", lambda *_: None)
    assert transcript_service.resolve_agenda_id("m1") == "ag-active"


def test_final_transcripts_are_not_concatenated(monkeypatch):
    stored = []
    monkeypatch.setattr(
        transcript_service,
        "recent_transcripts",
        lambda *args, **kwargs: [stored[-1]] if stored else [],
    )
    monkeypatch.setattr(transcript_service, "_db_upsert_transcript", lambda record: stored.append(dict(record)))
    monkeypatch.setattr(transcript_service, "_invalidate_transcripts_cache", lambda: None)

    first = {"id": "tr-1", "meetingId": "m1", "username": "admin", "speakerName": "主持人", "transcript": "第一条", "serverTime": "2026-08-20 10:00:00", "isFinal": True}
    second = {"id": "tr-2", "meetingId": "m1", "username": "admin", "speakerName": "主持人", "transcript": "第二条", "serverTime": "2026-08-20 10:00:01", "isFinal": True}
    transcript_service.persist_record(first)
    result, duplicate = transcript_service.persist_record(second)
    assert duplicate is False
    assert result["id"] == "tr-2"
    assert result["transcript"] == "第二条"

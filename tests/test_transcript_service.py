import pytest

from backend.services import transcript_service


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

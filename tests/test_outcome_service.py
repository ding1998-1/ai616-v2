from backend.services import outcome_service


def test_records_update_creates_versionable_payload(monkeypatch):
    meetings = {"m1": {"id": "m1", "title": "季度例会", "generatedRecords": {"generated": True, "summary": ["旧"]}}}
    saved_versions = []
    monkeypatch.setattr(outcome_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(outcome_service, "_save_meetings", lambda value: None)
    monkeypatch.setattr(outcome_service, "_check_meeting_access", lambda user, meeting: None)
    monkeypatch.setattr(outcome_service, "_invalidate_meetings_cache", lambda: None)
    monkeypatch.setattr(
        outcome_service,
        "_save_version",
        lambda meeting_id, records, user, override: saved_versions.append((meeting_id, records, override)) or {"version": 2},
    )

    records = outcome_service.update_records("m1", {"summary": ["新"], "ignored": "x"}, {"name": "主持人"})
    assert records["summary"] == ["新"]
    assert records["generated"] is True
    assert saved_versions[0][0] == "m1"
    assert saved_versions[0][2] == {"summary": ["新"]}


def test_marker_lifecycle_is_scoped_to_meeting(monkeypatch):
    meetings = {"m1": {"id": "m1", "events": []}}
    monkeypatch.setattr(outcome_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(outcome_service, "_save_meetings", lambda value: None)
    monkeypatch.setattr(outcome_service, "_check_meeting_access", lambda user, meeting: None)

    marker = outcome_service.add_marker("m1", {"marker_type": "decision", "note": "确认预算"}, {"username": "alice"})
    assert marker["marker_type"] == "decision"
    assert outcome_service.list_markers("m1", {"username": "alice"})[0]["note"] == "确认预算"

    outcome_service.delete_marker("m1", marker["id"], {"username": "alice"})
    assert outcome_service.list_markers("m1", {"username": "alice"}) == []


def test_incomplete_whisper_review_falls_back_to_full_realtime_source():
    whisper = [{"segmentId": f"w-{index}"} for index in range(4)]
    realtime = [{"segmentId": f"r-{index}"} for index in range(721)]
    selected, source_kind = outcome_service._select_records_source(whisper, realtime)
    assert selected is realtime
    assert source_kind == "realtime-whisper-incomplete"


def test_complete_whisper_review_remains_authoritative():
    whisper = [{"segmentId": f"w-{index}"} for index in range(300)]
    realtime = [{"segmentId": f"r-{index}"} for index in range(721)]
    selected, source_kind = outcome_service._select_records_source(whisper, realtime)
    assert selected is whisper
    assert source_kind == "whisper"

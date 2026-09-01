from backend.services import meeting_service, outcome_service, signature_service


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


def test_records_confirmation_enables_formal_documents(monkeypatch):
    meetings = {"m1": {"id": "m1", "generatedRecords": {
        "generated": True,
        "proofreadPassed": False,
        "minutes": [{
            "agenda": "预算调整",
            "keyPoints": [],
            "basis": {
                "evidenceValid": True,
                "sourceSegmentIds": ["seg-1"],
                "quotes": [{"text": "会议讨论预算调整"}],
            },
        }],
    }}}
    saved_versions = []
    monkeypatch.setattr(outcome_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(outcome_service, "_save_meetings", lambda value: None)
    monkeypatch.setattr(outcome_service, "_check_meeting_access", lambda user, meeting: None)
    monkeypatch.setattr(outcome_service, "_invalidate_meetings_cache", lambda: None)
    monkeypatch.setattr(
        outcome_service,
        "_save_version",
        lambda meeting_id, records, user, override: saved_versions.append((meeting_id, records, override)),
    )

    records = outcome_service.confirm_records("m1", {"name": "主持人"})

    assert records["proofreadPassed"] is True
    assert records["proofreadStatus"] == "human-approved"
    assert records["proofreadBy"] == "主持人"
    assert records["humanReviewed"] is True
    assert saved_versions[0][2] == {"humanReviewed": True}


def test_records_confirmation_blocks_unverifiable_decisions_and_todos(monkeypatch):
    meetings = {"m1": {"id": "m1", "generatedRecords": {
        "generated": True,
        "minutes": [{
            "agenda": "预算调整", "keyPoints": [],
            "basis": {
                "evidenceValid": True,
                "sourceSegmentIds": ["seg-1"],
                "quotes": [{"text": "会议讨论预算调整"}],
            },
        }],
        "decisions": [{"content": "同意调整预算", "basis": {"evidenceValid": False}}],
        "todos": [{"task": "周五提交方案", "basis": {"evidenceValid": False}}],
    }}}
    monkeypatch.setattr(outcome_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(outcome_service, "_check_meeting_access", lambda user, meeting: None)

    try:
        outcome_service.confirm_records("m1", {"name": "主持人"})
    except ValueError as exc:
        message = str(exc)
        assert "无法确认纪要" in message
        assert "决议1条" in message
        assert "待办1条" in message
    else:
        raise AssertionError("expected basis gate to block confirmation")


def test_basis_gate_requires_verbatim_quote_and_segment_id():
    records = {
        "generated": True,
        "minutes": [{
            "agenda": "项目立项",
            "keyPoints": [],
            "basis": {
                "evidenceValid": True,
                "sourceSegmentIds": [],
                "quotes": [{"text": "同意项目立项"}],
            },
        }],
    }

    gate = outcome_service.basis_gate_status(records)

    assert gate["ready"] is False
    assert gate["invalidCount"] == 1
    assert gate["missingByField"]["minutes"] == 1


def test_archive_stage_is_blocked_before_signature_check_when_basis_is_invalid(monkeypatch):
    meetings = {"m1": {"id": "m1", "generatedRecords": {
        "generated": True,
        "minutes": [{"agenda": "预算调整", "basis": {"evidenceValid": False}}],
    }}}
    monkeypatch.setattr(meeting_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(meeting_service, "_save_meetings", lambda value: None)
    monkeypatch.setattr(meeting_service, "_check_meeting_access", lambda user, meeting: None)
    monkeypatch.setattr(signature_service, "is_fully_signed", lambda meeting_id: True)

    try:
        meeting_service.update_stage("m1", "archive", "待归档", {"name": "主持人"})
    except ValueError as exc:
        assert "无法进入归档" in str(exc)
        assert "会议记录1条" in str(exc)
    else:
        raise AssertionError("expected archive basis gate to block the stage update")


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

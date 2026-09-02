import asyncio

from backend.services import meeting_service, outcome_service, signature_service


def test_concurrent_record_generation_requests_share_one_task(monkeypatch):
    calls = []

    async def fake_generate(meeting_id, *, generation_id):
        calls.append((meeting_id, generation_id))
        await asyncio.sleep(0.03)
        return {
            "generated": True,
            "generatedAt": "2026-09-01 16:30:00",
            "generationId": generation_id,
        }

    monkeypatch.setattr(outcome_service, "_generate_records_v2_once", fake_generate)
    outcome_service._record_generation_tasks.clear()
    outcome_service._record_generation_states.clear()

    async def exercise():
        results = await asyncio.gather(*(
            outcome_service.generate_records_v2("m1") for _ in range(5)
        ))
        status = outcome_service.record_generation_status("m1")
        return results, status

    monkeypatch.setattr(outcome_service, "_load_meetings", lambda: {
        "m1": {"id": "m1", "generatedRecords": {"generated": True}},
    })
    results, status = asyncio.run(exercise())

    assert len(calls) == 1
    assert len({item["generationId"] for item in results}) == 1
    assert status["status"] == "done"
    assert status["joinedRequests"] == 4


def test_record_generation_failure_is_exposed_without_starting_duplicate(monkeypatch):
    async def fake_generate(meeting_id, *, generation_id):
        await asyncio.sleep(0)
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(outcome_service, "_generate_records_v2_once", fake_generate)
    monkeypatch.setattr(outcome_service, "_load_meetings", lambda: {
        "m1": {"id": "m1", "generatedRecords": {"generated": True}},
    })
    outcome_service._record_generation_tasks.clear()
    outcome_service._record_generation_states.clear()

    try:
        asyncio.run(outcome_service.generate_records_v2("m1"))
    except RuntimeError as exc:
        assert str(exc) == "LLM unavailable"
    else:
        raise AssertionError("expected generation failure")

    status = outcome_service.record_generation_status("m1")
    assert status["status"] == "failed"
    assert status["hasRecords"] is True
    assert status["error"] == "LLM unavailable"


def test_degraded_retry_cannot_replace_existing_successful_records():
    existing = {"generated": True, "pipelineStatus": "ok", "degraded": False}
    degraded = {"generated": True, "pipelineStatus": "degraded", "degraded": True}

    assert outcome_service._should_preserve_existing_records(existing, degraded) is True
    assert outcome_service._should_preserve_existing_records({}, degraded) is False


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
        lambda meeting_id, records, user, override, **kwargs: saved_versions.append((meeting_id, records, override)),
    )

    records = outcome_service.confirm_records("m1", {"name": "主持人"})

    assert records["proofreadPassed"] is True
    assert records["proofreadStatus"] == "human-approved"
    assert records["proofreadBy"] == "主持人"
    assert records["humanReviewed"] is True
    assert saved_versions[0][2] == {"humanReviewed": True, "formalOverride": {}}


def test_records_confirmation_keeps_invalid_items_and_allows_audited_override(monkeypatch):
    meetings = {"m1": {"id": "m1", "creator": "主持人", "events": [], "generatedRecords": {
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
    monkeypatch.setattr(outcome_service, "_save_meetings", lambda value: None)
    monkeypatch.setattr(outcome_service, "_check_meeting_access", lambda user, meeting: None)
    monkeypatch.setattr(outcome_service, "_invalidate_meetings_cache", lambda: None)
    monkeypatch.setattr(outcome_service, "_whisper_source_from_meeting", lambda meeting: [{
        "segmentId": "seg-1", "fileId": "whisper", "start": 0, "end": 3,
        "text": "会议讨论预算调整", "speaker": "主持人",
    }])
    monkeypatch.setattr(outcome_service, "_realtime_source_from_meeting", lambda meeting_id: [])
    saved_versions = []
    monkeypatch.setattr(
        outcome_service,
        "_save_version",
        lambda meeting_id, records, user, override, **kwargs: saved_versions.append((records, override, kwargs)),
    )

    records = outcome_service.confirm_records(
        "m1",
        {"name": "主持人"},
        "已核对录音原文，同意人工确认并继续",
    )

    assert len(records["decisions"]) == 1
    assert len(records["todos"]) == 1
    assert records["proofreadStatus"] == "human-authorized-exception"
    assert records["basisGate"]["ready"] is False
    assert records["latestFormalOverride"]["reason"] == "已核对录音原文，同意人工确认并继续"
    assert len(records["latestFormalOverride"]["failedItems"]) == 2
    assert meetings["m1"]["events"][-1]["type"] == "formal-override"
    assert len(saved_versions) == 1


def test_records_confirmation_requires_reason_and_manager_for_invalid_gate(monkeypatch):
    meetings = {"m1": {"id": "m1", "creator": "主持人", "generatedRecords": {
        "generated": True,
        "minutes": [{"agenda": "预算调整", "basis": {"evidenceValid": False}}],
    }}}
    monkeypatch.setattr(outcome_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(outcome_service, "_check_meeting_access", lambda user, meeting: None)

    try:
        outcome_service.confirm_records("m1", {"name": "主持人"})
    except ValueError as exc:
        assert "不可核验内容" in str(exc)
    else:
        raise AssertionError("expected evidence gate to block without a reason")

    try:
        outcome_service.confirm_records("m1", {"name": "普通参会人"}, "已经核对原始录音并确认内容")
    except PermissionError as exc:
        assert "人工放行" in str(exc)
    else:
        raise AssertionError("expected non-manager override to be forbidden")


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


def test_archive_override_is_audited_but_does_not_bypass_signatures(monkeypatch):
    meetings = {"m1": {"id": "m1", "creator": "主持人", "events": [], "generatedRecords": {
        "generated": True,
        "minutes": [{"agenda": "预算调整", "basis": {"evidenceValid": False}}],
    }}}
    monkeypatch.setattr(meeting_service, "_load_meetings", lambda: meetings)
    monkeypatch.setattr(meeting_service, "_save_meetings", lambda value: None)
    monkeypatch.setattr(meeting_service, "_check_meeting_access", lambda user, meeting: None)
    monkeypatch.setattr(signature_service, "is_fully_signed", lambda meeting_id: False)
    monkeypatch.setattr(signature_service, "signed_signer_count", lambda meeting_id: 1)
    monkeypatch.setattr(signature_service, "required_signer_count", lambda meeting_id: 2)

    try:
        meeting_service.update_stage(
            "m1",
            "archive",
            "待归档",
            {"name": "主持人"},
            "已经核对录音原文并确认归档",
        )
    except ValueError as exc:
        assert "尚未全员签字" in str(exc)
    else:
        raise AssertionError("expected signatures to remain mandatory")

    assert meetings["m1"].get("archiveDone") is not True


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

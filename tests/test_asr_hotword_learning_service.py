import json

from backend.services import asr_hotword_learning_service as service
from backend.routes import asr


def _meeting(project="慢行一期", meeting_type="项目会"):
    return {
        "id": "m1",
        "title": "慢行一期推进会",
        "project": project,
        "type": meeting_type,
        "agenda": "慢行系统预算调整",
        "agendaDrafts": [{"title": "林改耕手续办理", "project": project}],
        "materials": [{"name": "慢行系统初设批复.pdf"}],
    }


def _setup(monkeypatch, tmp_path, meetings=None, transcripts=None):
    target = tmp_path / "learned_hotwords.json"
    monkeypatch.setattr(service, "ASR_LEARNED_HOTWORDS_DB", target)
    monkeypatch.setattr(service, "_load_meetings", lambda: meetings or {"m1": _meeting()})
    monkeypatch.setattr(
        service,
        "_db_load_transcripts_for_meeting",
        lambda meeting_id: {"transcripts": transcripts or []},
    )
    return target


def test_meeting_context_learns_authoritative_terms_and_raw_is_candidate(monkeypatch, tmp_path):
    target = _setup(
        monkeypatch,
        tmp_path,
        transcripts=[{"transcript": "办行系统建设方案办行系统建设方案办行系统建设方案", "isFinal": True}],
    )
    result = service.learn_meeting_context("m1")
    active = {row["word"] for row in result["hotwords"] if row["approved"]}
    candidates = {row["word"] for row in result["candidates"]}
    assert "慢行系统预算调整" in active
    assert "林改耕手续办理" in active
    assert "办行系统" not in active
    assert any("办行系统" in word for word in candidates)
    assert json.loads(target.read_text(encoding="utf-8"))["version"] == 1


def test_signed_correction_learns_alias_and_is_idempotent(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    original = "本次讨论办行系统预算调整以及GPD接口"
    corrected = "本次讨论慢行系统预算调整以及GPT接口"
    service.learn_signed_correction("m1", original, corrected)
    result = service.learn_signed_correction("m1", original, corrected)
    corrections = {(row["wrong"], row["right"]) for row in result["corrections"]}
    assert ("办行系统预算调整", "慢行系统预算调整") in corrections
    assert ("GPD", "GPT") in corrections
    assert len([row for row in result["corrections"] if row["right"] == "GPT"]) == 1


def test_project_scope_reuses_within_project_only(monkeypatch, tmp_path):
    meetings = {
        "m1": _meeting(),
        "m2": {**_meeting(meeting_type="办公会"), "id": "m2"},
        "m3": {**_meeting(project="其他项目"), "id": "m3"},
    }
    _setup(monkeypatch, tmp_path, meetings=meetings)
    service.learn_meeting_context("m1")
    assert "林改耕手续办理" in service.learned_hotwords_for_context(meetings["m2"])
    assert "林改耕手续办理" not in service.learned_hotwords_for_context(meetings["m3"])


def test_current_and_learned_terms_are_prioritised_before_generic_templates(monkeypatch):
    monkeypatch.setattr(service, "learned_hotwords_for_context", lambda meeting: ["慢行系统", "林改耕"])
    words = asr._build_asr_hotwords(
        "项目推进会", "预算调整", "慢行一期", meeting={"project": "慢行一期", "type": "项目会"}
    )
    assert words[:5] == ["项目推进会", "预算调整", "慢行一期", "慢行系统", "林改耕"]


def test_formal_records_write_verified_pair_to_glossary(monkeypatch, tmp_path):
    target = _setup(monkeypatch, tmp_path)
    glossary = tmp_path / "glossary.json"
    monkeypatch.setattr("backend.services.meeting_proofread_service.DEFAULT_GLOSSARY_PATH", glossary)
    result = service.learn_from_formal_records(
        "m1",
        {
            "minutes": [{"content": "确认采用慢行系统方案"}],
            "proofreadLog": [{"original": "办行系统", "fixed": "慢行系统", "confidence": 0.96}],
        },
        [{"rawText": "原始发言确认采用办行系统方案"}],
    )
    assert result["approvedCount"] == 1
    payload = json.loads(glossary.read_text(encoding="utf-8"))
    entry = next(item for item in payload["terms"] if item["term"] == "慢行系统")
    assert "办行系统" in entry["aliases"]
    learned = json.loads(target.read_text(encoding="utf-8"))
    assert learned["corrections"][0]["wrong"] == "办行系统"


def test_formal_records_reject_unverified_free_form_difference(monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    result = service.learn_from_formal_records(
        "m1",
        {"minutes": [{"content": "慢行系统"}], "proofreadLog": []},
        [{"rawText": "办行系统"}],
    )
    assert result["approvedCount"] == 0

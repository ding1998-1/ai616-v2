from backend.services.meeting_proofread_service import (
    find_dictionary_candidates,
    load_glossary,
    normalise_glossary,
    proofread_records,
    proofread_text,
    records_are_proofread,
)


def test_project_glossary_contains_required_domain_terms():
    glossary = load_glossary()
    terms = {entry["term"] for entry in glossary}
    assert {"引债", "批复", "初设", "美林街道", "桃园"}.issubset(terms)
    candidates = find_dictionary_candidates("本项目需要引赛批复", glossary)
    assert any(item["original"] == "引赛" and item["suggested"] == "引债" for item in candidates)


def test_compact_glossary_mapping_keeps_canonical_key():
    entries = normalise_glossary({"引债": {"aliases": ["引赛"]}})
    assert entries == [{"term": "引债", "aliases": ["引赛"], "category": "", "reason": "领域词典候选"}]


def test_proofread_preserves_raw_text_and_audits_correction():
    def corrector(text, candidates, context):
        assert context["path"] == "decisions[0]"
        return {
            "correctedText": text.replace("引赛", "引债"),
            "corrections": [{"original": "引赛", "fixed": "引债", "reason": "词典+LLM"}],
        }

    result = proofread_records(
        {"decisions": [{"content": "关于引赛事项的决定"}]},
        glossary=[{"term": "引债", "aliases": ["引赛"]}],
        llm_corrector=corrector,
    )
    item = result["decisions"][0]
    assert item["rawContent"] == "关于引赛事项的决定"
    assert item["content"] == "关于引债事项的决定"
    assert result["proofreadPassed"] is True
    assert records_are_proofread(result)
    assert result["proofreadLog"][0]["corrections"][0]["fixed"] == "引债"


def test_without_llm_cannot_enter_formal_document_when_candidate_exists():
    result = proofread_text(
        "本次讨论引赛事项",
        glossary=[{"term": "引债", "aliases": ["引赛"]}],
        llm_corrector=None,
        require_llm=True,
    )
    assert result["proofreadPassed"] is False
    assert result["proofreadStatus"] == "needs_review"

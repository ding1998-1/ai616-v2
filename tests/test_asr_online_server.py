from backend.asr_online_server import _append_incremental, _clean_text


def test_clean_text_removes_model_tokens_and_spaces():
    assert _clean_text("<|zh|> 会 议 UNKNOWN") == "会议"


def test_append_incremental_accepts_cumulative_result():
    assert _append_incremental("预算调", "预算调整") == "预算调整"


def test_append_incremental_merges_overlapping_fragment():
    assert _append_incremental("本次会议讨论", "讨论预算事项") == "本次会议讨论预算事项"


def test_append_incremental_ignores_repeated_fragment():
    assert _append_incremental("本次会议", "会议") == "本次会议"

import asyncio
from contextlib import contextmanager
from types import SimpleNamespace

import backend.asr_online_server as online
from backend.routes.asr import _apply_asr_homophone_corrections
from backend.services.asr_2pass_service import (
    ContinuationFinalBuffer,
    OrderedFinalBuffer,
    join_continuation_text,
    plausible_chinese_meeting_text,
    plausible_offline_review,
    review_with_fallback,
)
from backend.services import transcript_service


def test_vad_pre_roll_keeps_every_buffered_frame_and_trigger_frame():
    session = online.OnlineSession()
    session.pre_roll.extend([b"first", b"second"])

    online._start_sentence(session, b"trigger")

    assert bytes(session.sentence_pcm) == b"firstsecondtrigger"
    assert bytes(session.online_pending) == b"firstsecondtrigger"
    assert not session.pre_roll


def test_sentence_end_event_is_emitted_only_once(monkeypatch):
    session = online.OnlineSession(speaking=True, sentence_seq=1, current_text="会议开始")

    async def end_signal(*_args, **_kwargs):
        return [[-1, 600]]

    async def no_drain(*_args, **_kwargs):
        return None

    async def identity(text):
        return text

    monkeypatch.setattr(online, "_run_vad", end_signal)
    monkeypatch.setattr(online, "_drain_online", no_drain)
    monkeypatch.setattr(online, "_punctuate", identity)

    first = asyncio.run(online._process_frame(session, b"a" * online.VAD_FRAME_BYTES))
    second = asyncio.run(online._process_frame(session, b"b" * online.VAD_FRAME_BYTES))

    assert first and first["event"] == "sentence_final"
    assert second is None


def test_sentence_final_contains_audio_relative_timestamps(monkeypatch):
    session = online.OnlineSession(speaking=True, sentence_seq=1, current_text="预算调整")
    session.sentence_pcm = bytearray(b"x" * online.SAMPLE_RATE * online.BYTES_PER_SAMPLE)
    session.processed_audio_bytes = online.SAMPLE_RATE * online.BYTES_PER_SAMPLE * 3

    async def no_drain(*_args, **_kwargs):
        return None

    async def identity(text):
        return text

    monkeypatch.setattr(online, "_drain_online", no_drain)
    monkeypatch.setattr(online, "_punctuate", identity)
    event = asyncio.run(online._finish_sentence(session))

    assert event["start_ms"] == 2000
    assert event["end_ms"] == 3000


def test_long_sentence_forced_split_resets_sentence_caches(monkeypatch):
    frame = b"x" * online.VAD_FRAME_BYTES
    session = online.OnlineSession(
        speaking=True,
        sentence_seq=1,
        current_text="很长的句子",
        sentence_pcm=bytearray(b"x" * (online.MAX_SENTENCE_BYTES - len(frame))),
        online_cache={"state": "dirty"},
        vad_cache={"state": "dirty"},
    )

    async def no_signal(*_args, **_kwargs):
        return []

    async def no_drain(*_args, **_kwargs):
        return None

    async def identity(text):
        return text

    monkeypatch.setattr(online, "_run_vad", no_signal)
    monkeypatch.setattr(online, "_drain_online", no_drain)
    monkeypatch.setattr(online, "_punctuate", identity)

    event = asyncio.run(online._process_frame(session, frame))

    assert event and event["forced_split"] is True
    assert session.sentence_pcm == bytearray()
    assert session.online_pending == bytearray()
    assert session.online_cache == {}
    assert session.vad_cache == {}
    assert session.continuation_pending is True


def test_offline_timeout_returns_online_final():
    async def timeout():
        raise asyncio.TimeoutError()

    result = asyncio.run(review_with_fallback(timeout, "预算调整。", str.strip))

    assert result == ("预算调整。", "paraformer-streaming", False)


def test_offline_context_echo_is_rejected():
    context = "会议名称：例会；当前议题：预算；参会人及术语：三重一大、党委前置、预算调整、项目立项"
    assert plausible_offline_review("讨论预算", context, context) is False


def test_offline_results_are_committed_in_sentence_order():
    buffer = OrderedFinalBuffer()

    assert buffer.add({"sentenceSeq": 2, "sentenceId": "s2", "newText": "二"}) == []
    ready = buffer.add({"sentenceSeq": 1, "sentenceId": "s1", "newText": "一"})

    assert [item["newText"] for item in ready] == ["一", "二"]


def test_forced_split_fragments_are_committed_as_one_logical_sentence():
    buffer = ContinuationFinalBuffer()
    first = {
        "sentenceSeq": 1,
        "sentenceId": "s1",
        "startMs": 0,
        "endMs": 15000,
        "newText": "这个方案最便",
        "onlineText": "这个方案最便",
        "backend": "qwen3-asr-1.7b",
        "corrected": False,
        "forcedSplit": True,
    }
    second = {
        "sentenceSeq": 2,
        "sentenceId": "s2",
        "startMs": 15000,
        "endMs": 22000,
        "newText": "便宜的，但是风险更高。",
        "onlineText": "便宜的，但是风险更高。",
        "backend": "qwen3-asr-1.7b",
        "corrected": True,
        "forcedSplit": False,
    }

    assert buffer.add(first) == []
    ready = buffer.add(second)

    assert len(ready) == 1
    assert ready[0]["sentenceId"] == "s1"
    assert ready[0]["sentenceSeq"] == 1
    assert ready[0]["startMs"] == 0
    assert ready[0]["endMs"] == 22000
    assert ready[0]["newText"] == "这个方案最便宜的，但是风险更高。"
    assert ready[0]["continuationSentenceIds"] == ["s1", "s2"]
    assert ready[0]["continued"] is True
    assert ready[0]["corrected"] is True


def test_forced_split_without_overlap_is_joined_and_flushes_once():
    buffer = ContinuationFinalBuffer()
    assert join_continuation_text("这是一个很", "容易低估的问题") == "这是一个很容易低估的问题"
    assert buffer.add({
        "sentenceSeq": 3,
        "sentenceId": "s3",
        "newText": "还没有说完",
        "onlineText": "还没有说完",
        "forcedSplit": True,
    }) == []

    flushed = buffer.flush()

    assert [item["newText"] for item in flushed] == ["还没有说完"]
    assert buffer.flush() == []


def test_forced_split_overlap_ignores_inserted_boundary_punctuation():
    assert join_continuation_text("监管覆盖全程。", "全程实时监测。") == "监管覆盖全程实时监测。"
    assert join_continuation_text("国防军工。", "国防军工领域需要加强。") == "国防军工领域需要加强。"


def test_sentence_id_is_durable_and_duplicate_insert_is_rejected(monkeypatch):
    body = SimpleNamespace(
        meeting_title="例会",
        agenda="预算",
        is_final=True,
        client_time="10:00:00",
        confidence=None,
        speaker_name=None,
        speaker_role=None,
        speaker_dept=None,
        speaker_confidence=None,
        identified_by=None,
        audio_client_id="client-1",
        sentence_id="session-1:7",
        sentence_seq=7,
        start_ms=2000,
        end_ms=3500,
    )
    user = {"id": "u1", "username": "alice", "name": "Alice", "role": "user", "dept": "财务部"}
    monkeypatch.setattr(transcript_service, "_db_find_participant_row", lambda *_: "participant-1")
    monkeypatch.setattr(
        "backend.deps._resolve_meeting_role",
        lambda _user: {
            "userId": "u1", "displayName": "Alice", "meetingRole": "参会人",
            "dept": "财务部", "seat": "", "username": "alice",
        },
    )
    record_a = transcript_service.build_record(user, body, "meeting-1", "预算调整", "agenda-1", "2026-08-28 10:00:00")
    record_b = transcript_service.build_record(user, body, "meeting-1", "预算调整", "agenda-1", "2026-08-28 10:00:01")
    assert record_a["id"] == record_b["id"]
    assert record_a["sentenceSeq"] == 7
    assert record_a["start"] == 2.0
    assert record_a["end"] == 3.5

    class FakeConnection:
        def execute(self, *_args, **_kwargs):
            return SimpleNamespace(fetchone=lambda: (record_a["id"],))

    @contextmanager
    def fake_connect():
        yield FakeConnection()

    monkeypatch.setattr(transcript_service, "_init_app_db", lambda: None)
    monkeypatch.setattr(transcript_service, "_db_connect", fake_connect)
    _, duplicate = transcript_service.persist_record(record_b)
    assert duplicate is True


def test_ct_punc_failure_returns_original_text(monkeypatch):
    online.punc_model = object()

    async def fail(*_args, **_kwargs):
        raise RuntimeError("punc unavailable")

    monkeypatch.setattr(online, "_run_model", fail)
    assert asyncio.run(online._punctuate("这是原文")) == "这是原文"


def test_domain_correction_requires_explicit_canonical_term_context():
    raw = "这次讨论三种一大事项"

    assert _apply_asr_homophone_corrections(raw, []) == raw
    assert _apply_asr_homophone_corrections(raw, ["三重一大"]) == "这次讨论三重一大事项"


def test_foreign_language_and_repetition_hallucinations_are_rejected():
    assert plausible_chinese_meeting_text("Something for every morning.") is False
    assert plausible_chinese_meeting_text("No no.") is False
    assert plausible_chinese_meeting_text("日本人です。") is False
    assert plausible_chinese_meeting_text("这老哒哒哒哒哒哒哒哒。") is False
    assert plausible_chinese_meeting_text("喂。") is False
    assert plausible_chinese_meeting_text("项目预算需要重新调整。") is True
    assert plausible_chinese_meeting_text("AI 项目进入评审阶段。") is True
    assert plausible_chinese_meeting_text("ASR") is True


def test_filler_noise_is_not_committed_when_both_passes_are_weak():
    async def reviewed_filler():
        return SimpleNamespace(text="嗯。", backend="qwen3-asr-1.7b")

    result = asyncio.run(review_with_fallback(reviewed_filler, "嗯。", str.strip))

    assert result == ("", "filtered", False)

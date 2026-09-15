import asyncio
import json

from backend.services import speaker_diarization_service as service


def test_disabled_scheduler_does_not_create_task_or_derived_files(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "MEETING_FILES_DIR", tmp_path)
    monkeypatch.delenv("SPEAKER_DIARIZATION_ENABLED", raising=False)
    audio = tmp_path / "recordings" / "meeting-1" / "audio.webm"
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b"audio")

    result = service.schedule_speaker_diarization("meeting-1", audio, "audio-1")

    assert result["enabled"] is False
    assert result["status"] == "idle"
    assert not (audio.parent / "derived").exists()


def test_stable_labels_follow_first_speaking_order():
    segments, speakers = service._stable_speaker_labels([
        {"start": 3.0, "end": 4.0, "speaker": "SPEAKER_00"},
        {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_02"},
        {"start": 2.0, "end": 3.0, "speaker": "SPEAKER_00"},
    ])

    assert speakers == {"SPEAKER_02": "发言人 1", "SPEAKER_00": "发言人 2"}
    assert [item["speakerLabel"] for item in segments] == ["发言人 1", "发言人 2", "发言人 2"]


def test_whisper_alignment_uses_largest_overlap_and_keeps_uncertain_anonymous():
    diarization = [
        {"start": 0.0, "end": 2.0, "speakerId": "S0", "speakerLabel": "发言人 1"},
        {"start": 2.0, "end": 5.0, "speakerId": "S1", "speakerLabel": "发言人 2"},
    ]
    aligned = service._align_whisper_segments([
        {"start": 1.5, "end": 3.5, "text": "second speaker wins"},
        {"start": 8.0, "end": 9.0, "text": "no overlap"},
    ], diarization)

    assert aligned[0]["speakerLabel"] == "发言人 2"
    assert aligned[0]["identifiedBy"] == "speaker-diarization"
    assert aligned[1]["speakerLabel"] == "会议室麦克风"
    assert aligned[1]["identifiedBy"] == "room-microphone"


def test_whisper_and_diarization_share_one_gpu_gate():
    from backend.services import whisper_review_service

    assert service._semaphore is whisper_review_service._semaphore


def test_worker_requires_separate_python_environment(tmp_path, monkeypatch):
    monkeypatch.delenv("SPEAKER_DIARIZATION_PYTHON", raising=False)

    try:
        asyncio.run(service._run_isolated_worker(tmp_path / "input.wav", tmp_path / "output.json"))
    except RuntimeError as exc:
        assert "独立说话人分离运行环境" in str(exc)
    else:
        raise AssertionError("missing isolated runtime must fail closed")


def test_scheduler_is_idempotent_for_same_audio(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "MEETING_FILES_DIR", tmp_path)
    monkeypatch.setenv("SPEAKER_DIARIZATION_ENABLED", "true")
    audio = tmp_path / "recordings" / "meeting-1" / "audio.webm"
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b"same complete audio")
    fingerprint = service._fingerprint(audio)
    result_dir = audio.parent / "derived" / "speaker-diarization"
    result_dir.mkdir(parents=True)
    (result_dir / "latest.json").write_text(json.dumps({
        "status": "done", "sourceFingerprint": fingerprint, "speakerCount": 2,
    }), encoding="utf-8")

    result = service.schedule_speaker_diarization("meeting-1", audio, "audio-1")

    assert result["status"] == "done"
    assert result["speakerCount"] == 2
    assert "meeting-1" not in service._tasks


def test_failed_diarization_is_persisted_without_raising(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "MEETING_FILES_DIR", tmp_path)
    audio = tmp_path / "recordings" / "meeting-1" / "audio.webm"
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b"audio")
    monkeypatch.setattr(service, "_normalize_audio", lambda *_: (_ for _ in ()).throw(RuntimeError("bad audio")))

    asyncio.run(service._run("meeting-1", audio, "audio-1", "fingerprint"))

    state = service._read_state("meeting-1")
    assert state["status"] == "failed"
    assert "bad audio" in state["error"]
    assert audio.read_bytes() == b"audio"


def test_successful_sidecar_preserves_source_and_persists_derived_result(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "MEETING_FILES_DIR", tmp_path)
    audio = tmp_path / "recordings" / "meeting-1" / "audio.webm"
    audio.parent.mkdir(parents=True)
    original = b"immutable source audio"
    audio.write_bytes(original)

    def normalize(_source, output):
        output.write_bytes(b"RIFF normalized")

    async def publish(*_args, **_kwargs):
        return None

    monkeypatch.setattr(service, "_normalize_audio", normalize)
    async def run_worker(*_args):
        return [
            {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_05"},
            {"start": 1.0, "end": 2.0, "speaker": "SPEAKER_02"},
        ]

    monkeypatch.setattr(service, "_run_isolated_worker", run_worker)
    monkeypatch.setattr(service, "_latest_whisper_segments", lambda _meeting_id: [])
    monkeypatch.setattr(service.sse_manager, "publish", publish)

    asyncio.run(service._run("meeting-1", audio, "audio-1", "fingerprint"))

    state = service._read_state("meeting-1")
    assert state["status"] == "done"
    assert state["speakerCount"] == 2
    assert state["segments"][0]["speakerLabel"] == "发言人 1"
    assert audio.read_bytes() == original
    assert not list((audio.parent / "derived").rglob("*.wav"))

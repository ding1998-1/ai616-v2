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
    monkeypatch.setattr(service, "_load_meetings", lambda: {"meeting-1": {"type": "快速会议", "events": [{"id": "audio-1", "type": "audio", "storedName": "audio.webm", "deviceType": "desktop"}]}})
    monkeypatch.setattr(service, "MEETING_FILES_DIR", tmp_path)
    monkeypatch.setenv("SPEAKER_DIARIZATION_ENABLED", "true")
    audio = tmp_path / "recordings" / "meeting-1" / "audio.webm"
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b"same complete audio")
    monkeypatch.setattr(service, "find_audio_event", lambda *_: {"storedName": "audio.webm", "deviceType": "desktop"})
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
    monkeypatch.setattr(service, "_latest_whisper_segments", lambda *_args: [])
    monkeypatch.setattr(service.sse_manager, "publish", publish)

    asyncio.run(service._run("meeting-1", audio, "audio-1", "fingerprint"))

    state = service._read_state("meeting-1")
    assert state["status"] == "done"
    assert state["speakerCount"] == 2
    assert state["segments"][0]["speakerLabel"] == "发言人 1"
    assert audio.read_bytes() == original
    assert not list((audio.parent / "derived").rglob("*.wav"))


def test_existing_meetings_are_excluded_even_when_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv("SPEAKER_DIARIZATION_ENABLED", "true")
    monkeypatch.setattr(service, "MEETING_FILES_DIR", tmp_path)
    monkeypatch.setattr(service, "_load_meetings", lambda: {"meeting-old": {"type": "普通企业会议"}})
    result = service.schedule_speaker_diarization("meeting-old", tmp_path / "absent.wav", "audio-old", force=True)
    assert result["eligible"] is False
    assert "meeting-old" not in service._tasks
    assert list(tmp_path.iterdir()) == []


def test_name_annotations_preserve_source_and_are_recording_scoped(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'MEETING_FILES_DIR', tmp_path)
    for audio_id in ['a1', 'a2']:
        service._write_state('meeting-names', {
            'audioEventId': audio_id, 'status': 'done',
            'speakers': [{'speakerId': 'S0', 'speakerLabel': '发言人 1'}],
            'segments': [{'speakerId': 'S0', 'start': 0, 'end': 1}],
        })
    before = service._audio_state_path('meeting-names', 'a1').read_bytes()
    result = service.set_speaker_name('meeting-names', 'a1', 'S0', '张三', {'username': 'tester'})
    assert result['identities']['names']['["a1","S0"]'] == '张三'
    assert '["a2","S0"]' not in result['identities']['names']
    assert service._audio_state_path('meeting-names', 'a1').read_bytes() == before
    result = service.set_speaker_name('meeting-names', 'a1', 'S0', '', {'username': 'tester'})
    assert len(result['identities']['history']) == 2
    assert result['identities']['names']['["a1","S0"]'] == ''


def test_two_recordings_queue_without_dropping_second(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'MEETING_FILES_DIR', tmp_path)
    monkeypatch.setenv('SPEAKER_DIARIZATION_ENABLED', 'true')
    monkeypatch.setattr(service, '_load_meetings', lambda: {'meeting-queue': {'type': '快速会议', 'events': [{'id': aid, 'type': 'audio', 'storedName': filename, 'deviceType': 'desktop'} for aid, filename in [('a1', 'a.wav'), ('a2', 'b.wav')]]}})
    directory = tmp_path / 'recordings' / 'meeting-queue'
    directory.mkdir(parents=True)
    first, second = directory / 'a.wav', directory / 'b.wav'
    first.write_bytes(b'first')
    second.write_bytes(b'second')
    monkeypatch.setattr(service, 'find_audio_event', lambda mid, aid: {'storedName': {'a1': 'a.wav', 'a2': 'b.wav'}[aid], 'deviceType': 'desktop'})
    called = []

    async def exercise():
        blocker = asyncio.Event()
        async def run(mid, path, audio_id, fingerprint):
            called.append(audio_id)
            if audio_id == 'a1':
                await blocker.wait()
        monkeypatch.setattr(service, '_run_after_whisper_priority_window', run)
        service.schedule_speaker_diarization('meeting-queue', first, 'a1')
        await asyncio.sleep(0)
        service.schedule_speaker_diarization('meeting-queue', second, 'a2')
        service.schedule_speaker_diarization('meeting-queue', second, 'a2')
        tail = service._tasks['meeting-queue']
        blocker.set()
        await tail
        assert called == ['a1', 'a2']
    asyncio.run(exercise())


def test_rerun_clears_only_affected_recording_names_and_keeps_history(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'MEETING_FILES_DIR', tmp_path)
    for audio_id in ['a1', 'a2']:
        service._write_state('meeting-rerun', {'audioEventId': audio_id, 'status': 'done',
            'speakers': [{'speakerId': 'S0'}]})
        service.set_speaker_name('meeting-rerun', audio_id, 'S0', 'Known Person', {'username': 'tester'})
    with service._identity_lock:
        service._invalidate_speaker_names('meeting-rerun', 'a1')
    identities = service._identities('meeting-rerun')
    assert identities['names']['["a1","S0"]'] == ''
    assert identities['names']['["a2","S0"]'] == 'Known Person'
    assert identities['history'][-1]['reason'] == 'diarization_rerun'


def test_stale_recording_job_is_read_as_retryable_without_writes(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'MEETING_FILES_DIR', tmp_path)
    service._write_state('meeting-stale', {'audioEventId': 'a1', 'status': 'running'})
    before = service._audio_state_path('meeting-stale', 'a1').read_bytes()
    result = service.diarization_status('meeting-stale')
    assert result['recordings'][0]['status'] == 'interrupted'
    assert result['status'] == 'interrupted'
    assert service._audio_state_path('meeting-stale', 'a1').read_bytes() == before


def test_quick_type_cannot_schedule_without_saved_desktop_event(tmp_path, monkeypatch):
    monkeypatch.setattr(service, 'MEETING_FILES_DIR', tmp_path)
    monkeypatch.setenv('SPEAKER_DIARIZATION_ENABLED', 'true')
    monkeypatch.setattr(service, '_load_meetings', lambda: {'meeting-evidence': {'type': '快速会议'}})
    audio = tmp_path / 'recordings' / 'meeting-evidence' / 'audio.webm'
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b'complete audio')
    for event in [None, {'storedName': 'audio.webm', 'deviceType': 'mobile', 'clientId': 'h5'}]:
        monkeypatch.setattr(service, 'find_audio_event', lambda *_: event)
        result = service.schedule_speaker_diarization('meeting-evidence', audio, 'a1', force=True)
        assert result['eligible'] is False
        assert 'meeting-evidence' not in service._tasks

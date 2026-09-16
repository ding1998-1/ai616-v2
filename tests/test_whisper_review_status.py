import asyncio

from backend.services import whisper_review_service as service
from backend.services.outcome_service import _whisper_source_from_meeting


def test_pending_whisper_task_reports_queued(monkeypatch):
    async def exercise():
        blocker = asyncio.Event()
        task = asyncio.create_task(blocker.wait())
        service._tasks["meeting-queued"] = task
        monkeypatch.setattr(
            service,
            "_meeting_events",
            lambda _meeting_id: [{"action": "whisper-review-status", "status": "queued", "serverTime": "now"}],
        )
        try:
            assert service.whisper_review_status("meeting-queued")["status"] == "queued"
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            service._tasks.pop("meeting-queued", None)

    asyncio.run(exercise())


def test_whisper_audio_selection_deduplicates_recording_session(tmp_path, monkeypatch):
    meeting_id = "meeting-audio-dedupe"
    directory = tmp_path / "recordings" / meeting_id
    directory.mkdir(parents=True)
    (directory / "audio_old.mp4").write_bytes(b"old")
    (directory / "audio_new.mp4").write_bytes(b"new")
    monkeypatch.setattr(service, "MEETING_FILES_DIR", tmp_path)
    monkeypatch.setattr(
        service,
        "_meeting_events",
        lambda _meeting_id: [
            {"type": "audio", "action": "audio-uploaded", "sessionId": "session-1", "fileName": "audio_old.mp4"},
            {"type": "audio", "action": "audio-uploaded", "sessionId": "session-1", "fileName": "audio_new.mp4"},
        ],
    )

    assert [path.name for path in service._audio_files(meeting_id)] == ["audio_new.mp4"]


def test_whisper_status_uses_newest_timestamp_not_list_position(monkeypatch):
    monkeypatch.setattr(
        service,
        "_meeting_events",
        lambda _meeting_id: [
            {"action": "whisper-review-status", "status": "done", "serverTime": "2026-08-31 19:33:56"},
            {"action": "whisper-review-status", "status": "queued", "serverTime": "2026-08-31 19:18:38"},
        ],
    )
    assert service.whisper_review_status("meeting-unordered")["status"] == "done"


def test_records_source_uses_newest_whisper_result():
    meeting = {
        "events": [
            {
                "type": "transcript", "action": "whisper-review",
                "serverTime": "2026-08-31 19:33:56",
                "segments": [{"start": 2, "end": 3, "text": "最新终审"}],
            },
            {
                "type": "transcript", "action": "whisper-review",
                "serverTime": "2026-08-31 19:18:38",
                "segments": [{"start": 0, "end": 1, "text": "旧终审"}],
            },
        ]
    }
    assert _whisper_source_from_meeting(meeting)[0]["text"] == "最新终审"


def test_recording_override_requires_audited_stage_event(monkeypatch):
    monkeypatch.setattr(
        service,
        "_meeting_events",
        lambda _meeting_id: [
            {"type": "system", "recordingOverride": {"reason": "untrusted"}},
            {"type": "stage", "stage": "meeting", "recordingOverride": {"reason": "wrong stage"}},
            {"type": "stage", "stage": "audit", "recordingOverride": {"reason": "admin override"}},
        ],
    )
    assert service.has_recording_override("meeting") is True


def test_recording_override_is_false_for_normal_meeting(monkeypatch):
    monkeypatch.setattr(
        service,
        "_meeting_events",
        lambda _meeting_id: [{"type": "stage", "stage": "audit"}],
    )
    assert service.has_recording_override("meeting") is False


def test_schedule_passes_recording_override_to_review_task(monkeypatch):
    async def exercise():
        received = {}

        async def fake_run(meeting_id, force, allow_incomplete_recordings=False):
            received.update(
                meeting_id=meeting_id,
                force=force,
                allow_incomplete_recordings=allow_incomplete_recordings,
            )

        monkeypatch.setattr(service, "_run_review", fake_run)
        monkeypatch.setattr(service, "_append_status", lambda *args, **kwargs: None)
        monkeypatch.setattr(service, "whisper_review_status", lambda _meeting_id: {"status": "failed"})
        service.schedule_whisper_review("meeting-force", True, allow_incomplete_recordings=True)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert received == {
            "meeting_id": "meeting-force",
            "force": True,
            "allow_incomplete_recordings": True,
        }

    asyncio.run(exercise())

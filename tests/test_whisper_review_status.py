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

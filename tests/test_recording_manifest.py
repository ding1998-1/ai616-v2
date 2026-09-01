from backend.services.recording_service import (
    finalize_recording_manifest,
    get_recording_manifest,
    recording_completion_lock,
)
import asyncio


def test_finalized_manifest_keeps_audio_event_identity(tmp_path):
    output = tmp_path / "audio_once.mp4"
    output.write_bytes(b"audio")

    finalize_recording_manifest(
        tmp_path,
        "session-1",
        3,
        output,
        "2026-08-31T10:00:00Z",
        "audio_once",
    )

    manifest = get_recording_manifest(tmp_path, "session-1")
    assert manifest["finalized"] is True
    assert manifest["outputFile"] == "audio_once.mp4"
    assert manifest["audioEventId"] == "audio_once"


def test_recording_completion_lock_serializes_same_session():
    async def exercise():
        lock_a = recording_completion_lock("meeting-1", "session-1")
        lock_b = recording_completion_lock("meeting-1", "session-1")
        assert lock_a is lock_b
        order = []

        async def worker(name):
            async with recording_completion_lock("meeting-1", "session-1"):
                order.append(f"{name}-start")
                await asyncio.sleep(0)
                order.append(f"{name}-end")

        await asyncio.gather(worker("a"), worker("b"))
        assert order in (["a-start", "a-end", "b-start", "b-end"], ["b-start", "b-end", "a-start", "a-end"])

    asyncio.run(exercise())

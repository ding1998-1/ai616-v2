import asyncio

from backend import main
from backend.services import whisper_review_service


class _FakeExecutor:
    _shutdown = False

    def __init__(self):
        self.calls = []

    def shutdown(self, **kwargs):
        self.calls.append(kwargs)
        self._shutdown = True


def test_runtime_shutdown_never_waits_for_executor(monkeypatch):
    fake = _FakeExecutor()
    monkeypatch.setattr(main.backend_config, "_llm_executor", fake)
    monkeypatch.setattr(main, "_close_resource", lambda *_: asyncio.sleep(0))

    from backend import llm_client

    monkeypatch.setattr(llm_client, "_llm_executor", None)
    asyncio.run(main._shutdown_runtime_resources())

    assert fake.calls == [{"wait": False, "cancel_futures": True}]


def test_shutdown_whisper_reviews_is_bounded_and_cancels():
    async def exercise():
        started = asyncio.Event()

        async def pending_review():
            started.set()
            await asyncio.Event().wait()

        task = asyncio.create_task(pending_review())
        whisper_review_service._tasks["meeting-shutdown-test"] = task
        await started.wait()

        await asyncio.wait_for(
            whisper_review_service.shutdown_whisper_reviews(timeout=0.1),
            timeout=0.5,
        )

        assert task.cancelled()
        whisper_review_service._tasks.pop("meeting-shutdown-test", None)

    asyncio.run(exercise())

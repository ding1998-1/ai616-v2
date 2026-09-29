import asyncio
from types import SimpleNamespace

from backend.routes import knowledge


def run_query(monkeypatch, documents, fail=False):
    calls = []

    class LocalModel:
        async def _astream(self, messages, **kwargs):
            calls.append(messages)
            if fail:
                raise RuntimeError('local model unavailable')
            yield SimpleNamespace(message=SimpleNamespace(content='本地回答[参考1]'))

    class Request:
        async def is_disconnected(self):
            return False

    monkeypatch.setattr(knowledge, 'require_user', lambda request: {'id': 'test-user'})
    monkeypatch.setattr(knowledge, 'get_vectorstore', lambda: SimpleNamespace(max_marginal_relevance_search=lambda *args, **kwargs: documents))
    monkeypatch.setattr(knowledge, 'knowledge_llm', LocalModel())

    async def collect():
        response = await knowledge.knowledge_stream(Request(), knowledge.KBQueryRequest(query='问题'))
        return ''.join([chunk async for chunk in response.body_iterator])

    return asyncio.run(collect()), calls


def test_local_answer_does_not_require_cloud_key(monkeypatch):
    output, calls = run_query(monkeypatch, [SimpleNamespace(page_content='内部资料', metadata={})])
    assert len(calls) == 1
    assert '内部资料' in calls[0][1].content
    assert '本地回答[参考1]' in output
    assert '"type": "done"' in output
    assert 'degraded' not in output


def test_no_sources_does_not_generate_unsupported_answer(monkeypatch):
    output, calls = run_query(monkeypatch, [])
    assert not calls
    assert '未找到相关资料' in output


def test_local_failure_is_reported_not_cloud_fallback(monkeypatch):
    output, calls = run_query(monkeypatch, [SimpleNamespace(page_content='资料', metadata={})], fail=True)
    assert len(calls) == 1
    assert '"type": "error"' in output
    assert 'local model unavailable' in output
    assert '"type": "done"' not in output

"""SSE 实时推送 — 桌面端不用轮询，手机端写入后毫秒级推送到订阅者。"""

import json
import asyncio
import logging
from fastapi import Request
from fastapi.responses import StreamingResponse

from backend.config import sse_manager

logger = logging.getLogger(__name__)


async def sse_transcript_stream(request: Request, meeting_id: str):
    """GET /api/meetings/{meeting_id}/transcripts/sse
    返回 text/event-stream，推送转写和会话事件。"""
    q = sse_manager.subscribe(meeting_id)

    async def event_generator():
        try:
            # 发送初始连接事件
            yield f"data: {json.dumps({'type': 'connected', 'meetingId': meeting_id}, ensure_ascii=False)}\n\n"

            while True:
                if await request.is_disconnected():
                    break

                try:
                    # 等待事件，30 秒心跳
                    payload = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # 心跳保持连接
                    yield ": heartbeat\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            sse_manager.unsubscribe(meeting_id, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

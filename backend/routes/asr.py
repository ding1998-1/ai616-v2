"""ASR WebSocket routes.

The two endpoints in this module preserve the legacy browser/mobile protocol:

* ``/api/meeting/asr/ws`` proxies DashScope Fun-ASR.
* ``/api/meeting/asr/qwen/ws`` proxies the local Qwen/FunASR service.

This module deliberately has no dependency on ``backend_full``.  Keeping the
ASR state here also makes the modular application safe to import in tests and
in the production entry point.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from array import array
from collections import deque
from pathlib import Path
from typing import Dict, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from backend.config import (
    ASR_CORRECTIONS_DB,
    ASR_HOTWORDS_DB,
    ASR_RECONNECT_BASE_DELAY,
    ASR_RECONNECT_MAX_DELAY,
    ASR_RECONNECT_MAX_RETRIES,
    DASHSCOPE_API_KEY,
    DASHSCOPE_FUN_ASR_WS_URL,
    DASHSCOPE_WORKSPACE,
    QWEN_ASR_URL,
)
from backend.deps import _get_user_from_auth_token, _resolve_meeting_role
from backend.db import _db_load_transcripts_for_meeting, _load_meetings, _safe_meeting_id


logger = logging.getLogger(__name__)
router = APIRouter(tags=["asr"])


def _pcm16_rms(pcm_bytes: bytes) -> int:
    """Return RMS energy for little-endian signed PCM16 without audioop.

    ``audioop`` was removed in Python 3.13, while production and local test
    environments may use different Python minor versions.
    """
    usable = len(pcm_bytes) - (len(pcm_bytes) % 2)
    if usable <= 0:
        return 0
    samples = array("h")
    samples.frombytes(pcm_bytes[:usable])
    if os.sys.byteorder != "little":
        samples.byteswap()
    return int((sum(sample * sample for sample in samples) / len(samples)) ** 0.5)


async def _dashscope_connect(url: str, headers: Dict[str, str], retries: int = 3):
    """Connect to DashScope with retry on transient failures."""
    import websockets

    last_err = None
    for attempt in range(retries):
        try:
            return await websockets.connect(
                url,
                additional_headers=headers,
                max_size=8 * 1024 * 1024,
                ping_interval=20,
                ping_timeout=20,
            )
        except TypeError:
            # websockets < 14 uses ``extra_headers``.
            try:
                return await websockets.connect(
                    url,
                    extra_headers=headers,
                    max_size=8 * 1024 * 1024,
                    ping_interval=20,
                    ping_timeout=20,
                )
            except Exception as exc:
                last_err = exc
        except Exception as exc:
            last_err = exc
        if attempt < retries - 1:
            delay = min(ASR_RECONNECT_BASE_DELAY * (2 ** attempt), ASR_RECONNECT_MAX_DELAY)
            await asyncio.sleep(delay)
    raise last_err or RuntimeError("Failed to connect to DashScope")


def _dashscope_text_result(message: dict) -> dict:
    output = ((message.get("payload") or {}).get("output") or {})
    sentence = output.get("sentence") or {}
    text = sentence.get("text") or output.get("text") or ""
    return {
        "text": text,
        "isFinal": bool(
            sentence.get("sentence_end")
            or sentence.get("sentenceEnd")
            or output.get("is_final")
        ),
        "beginTime": sentence.get("begin_time") or sentence.get("beginTime"),
        "endTime": sentence.get("end_time") or sentence.get("endTime"),
    }


@router.websocket("/api/meeting/asr/ws")
async def meeting_asr_websocket(websocket: WebSocket):
    """DashScope Fun-ASR proxy used by the legacy mobile recorder."""
    await websocket.accept()
    token = websocket.query_params.get("token", "")
    try:
        user = _get_user_from_auth_token(token, required=True)
    except HTTPException as exc:
        await websocket.send_json({"type": "error", "message": exc.detail})
        await websocket.close(code=4401)
        return

    if not DASHSCOPE_API_KEY:
        await websocket.send_json({
            "type": "error",
            "message": "未配置 DASHSCOPE_API_KEY，已无法连接 Fun-ASR。",
        })
        await websocket.close(code=1011)
        return

    meeting_id = websocket.query_params.get("meetingId") or "meeting-gxq-fc-2026-02"
    meeting_title = websocket.query_params.get("meetingTitle") or ""
    agenda = websocket.query_params.get("agenda") or ""
    user_role = _resolve_meeting_role(user)
    task_id = f"asr_{uuid.uuid4().hex}"
    headers = {
        "Authorization": f"Bearer {DASHSCOPE_API_KEY}",
        "user-agent": "ai-compliance-demo/fun-asr-mobile-recorder",
    }
    if DASHSCOPE_WORKSPACE:
        headers["X-DashScope-WorkSpace"] = DASHSCOPE_WORKSPACE

    dash_ws = None
    dash_to_client_task = None
    task_started = asyncio.Event()
    reconnect_attempt = 0

    async def _run_dashscope_session():
        nonlocal dash_ws, task_id, dash_to_client_task
        dash_ws = await _dashscope_connect(DASHSCOPE_FUN_ASR_WS_URL, headers)
        task_id = f"asr_{uuid.uuid4().hex}"
        run_task = {
            "header": {"action": "run-task", "task_id": task_id, "streaming": "duplex"},
            "payload": {
                "task_group": "audio", "task": "asr", "function": "recognition",
                "model": os.environ.get("DASHSCOPE_FUN_ASR_MODEL", "paraformer-realtime-v2"),
                "parameters": {"format": "pcm", "sample_rate": 16000, "language_hints": ["zh"]},
                "input": {},
            },
        }
        await dash_ws.send(json.dumps(run_task, ensure_ascii=False))

        async def dashscope_to_client():
            async for raw_message in dash_ws:
                if isinstance(raw_message, bytes):
                    continue
                try:
                    message = json.loads(raw_message)
                except Exception:
                    await websocket.send_json({"type": "raw", "message": raw_message})
                    continue
                event = (message.get("header") or {}).get("event") or ""
                if event == "task-started":
                    task_started.set()
                    await websocket.send_json({
                        "type": "ready", "taskId": task_id,
                        "meetingId": meeting_id, "speaker": user_role,
                    })
                elif event == "result-generated":
                    result = _dashscope_text_result(message)
                    await websocket.send_json({
                        "type": "result", "taskId": task_id,
                        "meetingId": meeting_id, "meetingTitle": meeting_title,
                        "agenda": agenda, **result,
                    })
                elif event == "task-finished":
                    await websocket.send_json({"type": "finished", "taskId": task_id})
                    return True
                elif event in ("task-failed", "error"):
                    err = (message.get("header") or {}).get("error_message") or "Fun-ASR 错误"
                    await websocket.send_json({"type": "error", "message": err})
                    return False

        dash_to_client_task = asyncio.create_task(dashscope_to_client())
        await asyncio.wait_for(task_started.wait(), timeout=15)
        return True

    async def _cleanup_session():
        nonlocal dash_to_client_task, dash_ws
        if dash_to_client_task and not dash_to_client_task.done():
            dash_to_client_task.cancel()
        if dash_ws:
            try:
                await dash_ws.close()
            except Exception:
                pass

    try:
        await _run_dashscope_session()
        audio_buffer: list[bytes] = []
        while True:
            try:
                client_message = await websocket.receive()
            except WebSocketDisconnect:
                break
            if client_message.get("type") == "websocket.disconnect":
                break
            audio_bytes = client_message.get("bytes")
            if audio_bytes:
                audio_buffer.append(audio_bytes)
                if len(audio_buffer) > 100:
                    audio_buffer = audio_buffer[-50:]
                if not dash_ws:
                    continue
                try:
                    await dash_ws.send(audio_bytes)
                except Exception:
                    reconnect_attempt += 1
                    if reconnect_attempt > ASR_RECONNECT_MAX_RETRIES:
                        await websocket.send_json({"type": "error", "message": "Fun-ASR 重连次数超限"})
                        break
                    delay = min(
                        ASR_RECONNECT_BASE_DELAY * (2 ** (reconnect_attempt - 1)),
                        ASR_RECONNECT_MAX_DELAY,
                    )
                    logger.warning("Fun-ASR 连接断开，%ds 后重连 (第 %d 次)", delay, reconnect_attempt)
                    await websocket.send_json({"type": "reconnecting", "attempt": reconnect_attempt, "delay": delay})
                    await _cleanup_session()
                    task_started.clear()
                    await asyncio.sleep(delay)
                    try:
                        await _run_dashscope_session()
                        reconnect_attempt = 0
                        await websocket.send_json({"type": "reconnected", "taskId": task_id})
                        for buf_bytes in audio_buffer[-40:]:
                            try:
                                await dash_ws.send(buf_bytes)
                            except Exception:
                                break
                    except Exception as exc:
                        logger.exception("Fun-ASR 重连失败")
                        await websocket.send_json({"type": "error", "message": f"重连失败: {exc}"})
                continue
            text = client_message.get("text")
            if not text:
                continue
            try:
                command = json.loads(text)
            except Exception:
                continue
            if command.get("type") == "finish":
                finish_task = {
                    "header": {"action": "finish-task", "task_id": task_id, "streaming": "duplex"},
                    "payload": {"input": {}},
                }
                try:
                    await dash_ws.send(json.dumps(finish_task, ensure_ascii=False))
                except Exception:
                    pass
                break
        if dash_to_client_task:
            try:
                await asyncio.wait_for(dash_to_client_task, timeout=8)
            except asyncio.TimeoutError:
                pass
    except Exception as exc:
        logger.exception("Fun-ASR websocket proxy failed")
        try:
            await websocket.send_json({"type": "error", "message": f"Fun-ASR 连接失败：{exc}"})
        except Exception:
            pass
    finally:
        await _cleanup_session()
        try:
            await websocket.close()
        except Exception:
            pass


# SenseVoice 标签清洗：只杀模型内部尖括号标签，不碰任何汉字。
_TOK_RE = re.compile(r"<\|.*?\|>")

_GOVERNMENT_ASR_HOTWORDS = [
    "党委会", "党组会", "三重一大", "党委前置", "前置研究", "集体决策", "会议纪要", "议题",
    "审议", "研究", "讨论", "表决", "通过", "同意", "原则同意", "暂缓", "再议",
    "法务审查", "合规审查", "纪检监督", "风险评估", "可研报告", "资金测算", "预算控制",
    "重大项目安排", "大额度资金运作", "重要人事任免", "重大事项决策", "项目立项",
    "招投标", "合同签订", "工程变更", "付款审批", "资产处置", "安全生产", "消防改造",
    "党委办公室", "总经理办公室", "财务部", "法务部", "合规部", "审计部", "项目管理部",
    "人力资源部", "纪检监察部", "党群工作部", "综合管理部",
]

_UNIT_ASR_HOTWORD_TEMPLATE = [
    "党委会议", "党委会审议", "党组会议", "前置研究讨论", "书记办公会", "总经理办公会", "班子会",
    "纪委", "纪检组", "监督检查", "整改落实", "责任追究", "议题申报", "会前沟通",
    "可研", "立项", "招采", "采购审批", "合同审批", "工程签证", "预算调整", "资金计划",
    "投标文件", "中标通知书", "法务意见", "审计意见", "风险提示", "合规意见",
    "人事任免", "干部考察", "民主推荐", "任前公示", "试用期", "绩效考核",
    "消防验收", "安全生产责任", "资产盘点", "资产处置", "信息化建设", "系统上线", "数据治理",
]

_SYNONYM_CORRECTIONS = {
    "三种一大": "三重一大", "党外前置": "党委前置", "党委钱置": "党委前置",
    "发务审查": "法务审查", "合贵审查": "合规审查", "合规市查": "合规审查",
    "纪检监都": "纪检监督", "项目立响": "项目立项", "招头标": "招投标",
    "合同签定": "合同签订", "资金额算": "资金测算", "预算控置": "预算控制",
    "党委办": "党委办公室", "总办": "总经理办公室", "法务办": "法务部", "合规办": "合规部",
}


def _load_json_list(path: Path) -> list:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8")) or []
    except Exception:
        pass
    return []


def _load_asr_custom_hotwords() -> list[str]:
    words: list[str] = []
    for item in _load_json_list(ASR_HOTWORDS_DB):
        if not isinstance(item, dict) or item.get("enabled", True) is False:
            continue
        word = str(item.get("word") or "").strip()
        if word and word not in words:
            words.append(word)
    return words


def _load_asr_corrections() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for item in _load_json_list(ASR_CORRECTIONS_DB):
        if not isinstance(item, dict) or item.get("enabled", True) is False:
            continue
        wrong = str(item.get("wrong") or "").strip()
        right = str(item.get("right") or "").strip()
        if wrong and right:
            mapping[wrong] = right
    return mapping


def _build_asr_hotwords(
    meeting_title: str = "", agenda: str = "", project: str = "", extra: Optional[list[str]] = None,
    meeting: Optional[dict] = None,
) -> list[str]:
    # Put current-meeting and learned project terms first. The recognizer has a
    # bounded hotword window, so generic templates must never crowd them out.
    words: list[str] = []
    for text in (meeting_title, agenda, project):
        for part in re.split(r"[\s，,、；;：:。.!?！？（）()【】\[\]《》\"'‘’/\\-]+", str(text or "")):
            part = part.strip()
            if len(part) >= 2 and part not in words:
                words.append(part)
    if meeting:
        from backend.services.asr_hotword_learning_service import learned_hotwords_for_context

        for word in learned_hotwords_for_context(meeting):
            if word not in words:
                words.append(word)
    for word in extra or []:
        word = str(word or "").strip()
        if len(word) >= 2 and word not in words:
            words.append(word)
    for word in _load_asr_custom_hotwords() + _GOVERNMENT_ASR_HOTWORDS + _UNIT_ASR_HOTWORD_TEMPLATE:
        if word not in words:
            words.append(word)
    return words[:160]


def _apply_asr_homophone_corrections(
    text: str,
    allowed_terms: Optional[list[str]] = None,
    meeting: Optional[dict] = None,
) -> str:
    value = str(text or "")
    corrections = dict(_SYNONYM_CORRECTIONS)
    corrections.update(_load_asr_corrections())
    if meeting:
        from backend.services.asr_hotword_learning_service import learned_corrections_for_context

        corrections.update(learned_corrections_for_context(meeting))
    for wrong, right in corrections.items():
        if allowed_terms is None or right in allowed_terms:
            value = value.replace(wrong, right)
    return re.sub(
        r"\b(党委|党组|法务|合规|纪检|预算|资金|项目|合同|招投标|人事)\s*([办部处]|审查|前置|立项|控制|测算)\b",
        lambda match: match.group(0).replace(" ", ""),
        value,
    )


_REPEAT_RE = re.compile(r"(.)\1{5,}")
_asr_pending_store: dict = {}
_ASR_PENDING_TTL_SEC = 5 * 60
_ACTIVE_ASR_SESSIONS: dict = {}
_qwen_asr_client = None
_qwen_client_lock = asyncio.Lock()


async def _get_qwen_client():
    """Return the application-level Qwen ASR client singleton."""
    from backend.qwen_asr_client import QwenASRClient

    global _qwen_asr_client
    if _qwen_asr_client is not None:
        return _qwen_asr_client
    async with _qwen_client_lock:
        if _qwen_asr_client is None:
            _qwen_asr_client = QwenASRClient(base_url=QWEN_ASR_URL, chunk_timeout=5.0)
    return _qwen_asr_client


async def cleanup_asr_pending_store() -> None:
    """Background cleanup hook for the application lifespan."""
    while True:
        await asyncio.sleep(60)
        now = time.time()
        expired = [
            key for key, value in _asr_pending_store.items()
            if isinstance(value, dict) and now - value.get("timestamp", 0) > _ASR_PENDING_TTL_SEC
        ]
        for key in expired:
            _asr_pending_store.pop(key, None)
        if expired:
            logger.info("ASR pending store: cleaned %d expired entries", len(expired))


def _fuzzy_lcp(left: str, right: str, tolerance: int = 2) -> int:
    """Return the common prefix length while tolerating ASR substitutions."""
    limit = min(len(left), len(right))
    mismatches = 0
    for index in range(limit):
        if left[index] != right[index]:
            mismatches += 1
            if mismatches > tolerance:
                return index - mismatches + 1 if index >= mismatches else 0
    return limit


@router.websocket("/api/meeting/asr/qwen/ws")
async def meeting_asr_qwen_websocket(websocket: WebSocket):
    """Local Qwen/FunASR WebSocket with the legacy ``ready/preview/final`` protocol."""
    from backend.qwen_asr_client import (
        ASRError,
        ASRChunkTimeoutError,
        ASRSessionExpiredError,
        ASRUnavailableError,
    )

    await websocket.accept()
    token = websocket.query_params.get("token", "")
    try:
        user = _get_user_from_auth_token(token, required=True)
    except HTTPException as exc:
        await websocket.send_json({"type": "error", "message": exc.detail})
        await websocket.close(code=4401)
        return

    meeting_id = websocket.query_params.get("meetingId") or "meeting-gxq-fc-2026-02"
    meeting_title = websocket.query_params.get("meetingTitle") or ""
    agenda = websocket.query_params.get("agenda") or ""
    user_role = _resolve_meeting_role(user)
    task_id = f"asr_{uuid.uuid4().hex}"
    qwen_client = await _get_qwen_client()
    if not await qwen_client.is_available():
        await websocket.send_json({"type": "error", "message": f"本地 ASR 不可用 ({QWEN_ASR_URL})"})
        await websocket.close(code=1011)
        return

    def clean_text(text: str) -> str:
        value = _TOK_RE.sub("", str(text or "")).strip()
        value = re.sub(r"([。，？！,?!])\1+", r"\1", value)
        return _apply_asr_homophone_corrections(value)

    # Session state is intentionally scoped to this WebSocket.  The global map
    # only serves as a gate to finish a zombie session after a reconnect.
    session_key = f"{user.get('username', '')}_{meeting_id}"
    old_session = _ACTIVE_ASR_SESSIONS.pop(session_key, None)
    if old_session:
        try:
            await qwen_client.finish(old_session)
        except Exception:
            logger.debug("failed to finish stale ASR session %s", old_session, exc_info=True)

    session_id: Optional[str] = None
    recv_loop_alive = asyncio.Event()
    monitor_task: Optional[asyncio.Task] = None
    asr_task: Optional[asyncio.Task] = None
    pending_buffer_ref = [""]
    pending_buffer = ""
    sent_tail = ""
    last_full_text = ""
    committed_text = ""
    bubble_start = 0
    last_change_time = time.monotonic()
    speaker_id = ""

    # Optional voiceprint enrichment.  Failure is deliberately non-fatal to ASR.
    vp_engine = None
    vp_enrolled: dict = {}
    vp_user_ref = [None]
    vp_name_ref = [""]
    vp_confidence_ref = [0.0]
    vp_identified_by_ref = ["manual"]
    try:
        from backend.voiceprint import deserialize_embedding, get_voiceprint_engine

        vp_engine = get_voiceprint_engine()
        if vp_engine and vp_engine.is_ready:
            from backend.db import _db_load_voiceprint_profiles

            for profile in _db_load_voiceprint_profiles():
                vp_enrolled[profile["user_id"]] = deserialize_embedding(profile["embedding"])
        if not vp_enrolled:
            vp_engine = None
    except Exception as exc:
        logger.debug("声纹加载失败，ASR 继续: %s", exc)
        vp_engine = None

    def enrich(message: dict) -> dict:
        if vp_user_ref[0] and message.get("type") in {"final", "preview"}:
            message["speaker_name"] = vp_name_ref[0]
            message["speaker_confidence"] = round(vp_confidence_ref[0], 4)
            message["identified_by"] = vp_identified_by_ref[0]
        return message

    async def send_final(text: str, full_text: str, *, is_preview: bool = False) -> None:
        if not text.strip():
            return
        payload = {
            "type": "preview" if is_preview else "final",
            "taskId": task_id,
            "meetingId": meeting_id,
            "meetingTitle": meeting_title,
            "agenda": agenda,
            "text": text if is_preview else None,
            "newText": None if is_preview else text,
            "fullText": full_text,
            "isFinal": not is_preview,
            "backend": "paraformer",
            "spk": speaker_id,
        }
        # The old preview shape has ``text`` and the old final shape has
        # ``newText``/``fullText``.  Do not add a null field to either shape.
        if is_preview:
            payload.pop("newText")
        else:
            payload.pop("text")
        await websocket.send_json(enrich(payload))

    try:
        await websocket.send_json({
            "type": "ready", "taskId": task_id, "meetingId": meeting_id,
            "speaker": user_role, "backend": "paraformer",
        })

        if websocket.query_params.get("resume") and session_key in _asr_pending_store:
            entry = _asr_pending_store.pop(session_key)
            restored = entry.get("text", "") if isinstance(entry, dict) else str(entry)
            if restored:
                await send_final(restored, restored)
                sent_tail = restored[-50:]

        async def silence_flush_monitor() -> None:
            nonlocal pending_buffer, sent_tail, last_change_time
            nonlocal committed_text, last_full_text, bubble_start, session_id
            while recv_loop_alive.is_set():
                await asyncio.sleep(0.2)
                if not recv_loop_alive.is_set() or not pending_buffer:
                    continue
                if time.monotonic() - last_change_time <= 0.8:
                    continue
                bubble = last_full_text[bubble_start:]
                if bubble.strip() and not (bubble == sent_tail[-len(bubble):] and len(bubble) >= 3):
                    await send_final(bubble, last_full_text)
                if session_id:
                    try:
                        await qwen_client.finish(session_id)
                    except Exception:
                        pass
                session_id = await qwen_client.start(
                    hotwords=_build_asr_hotwords(
                        meeting_title, agenda, extra=[user_role.get("displayName", ""), user_role.get("meetingRole", "")]
                    )
                )
                _ACTIVE_ASR_SESSIONS[session_key] = session_id
                committed_text = ""
                last_full_text = ""
                pending_buffer = ""
                sent_tail = ""
                bubble_start = 0
                last_change_time = time.monotonic()

        recv_loop_alive.set()
        monitor_task = asyncio.create_task(silence_flush_monitor())
        audio_queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue(maxsize=120)

        async def receiver() -> None:
            while True:
                try:
                    message = await websocket.receive()
                except WebSocketDisconnect:
                    break
                if message.get("type") == "websocket.disconnect":
                    break
                if message.get("text"):
                    try:
                        command = json.loads(message["text"])
                    except Exception:
                        continue
                    if command.get("type") == "finish":
                        break
                    if command.get("type") == "ping":
                        await websocket.send_json({"type": "pong", "timestamp": command.get("timestamp")})
                    continue
                audio_bytes = message.get("bytes")
                if audio_bytes:
                    try:
                        audio_queue.put_nowait(audio_bytes)
                    except asyncio.QueueFull:
                        # Recording is persisted by the HTTP recorder route;
                        # dropping only the ASR queue is intentional.
                        logger.warning("[AUDIO] ASR queue full, dropping chunk")

        async def asr_worker() -> None:
            nonlocal session_id, pending_buffer, sent_tail, last_full_text
            nonlocal committed_text, bubble_start, last_change_time, speaker_id
            from backend.silero_vad import SileroVAD

            vad = SileroVAD(threshold=0.42)
            audio_buffer = bytearray()
            vp_audio_buffer = bytearray()
            chunk_count = 0
            stale_count = 0
            consecutive_failures = 0
            degraded = False
            last_recovery_check = 0.0
            previous_full_text = ""
            repeat_burst = 0
            energy_speech_streak = 0
            filtered_chunk_count = 0
            asr_chunk_bytes = 16000

            while recv_loop_alive.is_set():
                try:
                    audio_bytes = await asyncio.wait_for(audio_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if audio_bytes is None:
                    break
                is_speech, speech_probability = vad.process(audio_bytes)
                # Mobile microphones and browser AGC can produce speech that is
                # quieter than Silero's confidence threshold.  RMS is a safety
                # net only. Require sustained voice-level energy so keyboard,
                # air-conditioning and handling noise cannot generate text.
                rms = _pcm16_rms(audio_bytes)
                if rms >= 650:
                    energy_speech_streak += 1
                else:
                    energy_speech_streak = 0
                is_speech = is_speech or energy_speech_streak >= 2
                if not is_speech:
                    filtered_chunk_count += 1
                    if filtered_chunk_count % 20 == 0:
                        logger.debug(
                            "[AUDIO] silence filtered meeting=%s bytes=%d vad=%.3f rms=%d",
                            meeting_id, len(audio_bytes), speech_probability, rms,
                        )
                    continue

                if degraded:
                    now = time.monotonic()
                    if now - last_recovery_check > 10:
                        last_recovery_check = now
                        if await qwen_client.is_available():
                            degraded = False
                            consecutive_failures = 0
                            session_id = await qwen_client.start(
                                hotwords=_build_asr_hotwords(meeting_title, agenda)
                            )
                            _ACTIVE_ASR_SESSIONS[session_key] = session_id
                            audio_buffer.clear()
                    continue

                if vp_engine and vp_enrolled and not vp_user_ref[0]:
                    vp_audio_buffer.extend(audio_bytes)
                    if len(vp_audio_buffer) >= 64000:
                        sample = bytes(vp_audio_buffer[:64000])
                        del vp_audio_buffer[:64000]
                        try:
                            identified, confidence = await asyncio.get_running_loop().run_in_executor(
                                None, lambda: vp_engine.identify_speaker_from_bytes(sample, vp_enrolled)
                            )
                            if identified:
                                vp_user_ref[0] = identified
                                vp_confidence_ref[0] = confidence
                                vp_identified_by_ref[0] = "voiceprint-realtime"
                                from backend.db import _db_get_voiceprint_by_user

                                profile = _db_get_voiceprint_by_user(identified)
                                vp_name_ref[0] = (profile or {}).get("display_name", identified)
                        except Exception:
                            logger.debug("声纹识别失败", exc_info=True)

                if session_id is None:
                    session_id = await qwen_client.start(
                        hotwords=_build_asr_hotwords(
                            meeting_title, agenda,
                            extra=[user_role.get("displayName", ""), user_role.get("meetingRole", "")],
                        )
                    )
                    _ACTIVE_ASR_SESSIONS[session_key] = session_id
                    audio_buffer.clear()

                audio_buffer.extend(audio_bytes)
                if len(audio_buffer) < asr_chunk_bytes:
                    continue
                send_bytes = bytes(audio_buffer[:asr_chunk_bytes])
                del audio_buffer[:asr_chunk_bytes]
                chunk_count += 1

                try:
                    result = await qwen_client.send_chunk(session_id, send_bytes)
                    raw_text = str(result.get("text", "")).strip()
                    speaker_id = result.get("spk", "")
                    consecutive_failures = 0
                except ASRSessionExpiredError:
                    consecutive_failures += 1
                    try:
                        session_id = await qwen_client.start()
                        _ACTIVE_ASR_SESSIONS[session_key] = session_id
                        result = await qwen_client.send_chunk(session_id, send_bytes)
                        raw_text = str(result.get("text", "")).strip()
                        speaker_id = result.get("spk", "")
                        consecutive_failures = 0
                    except Exception:
                        if consecutive_failures >= 3:
                            degraded = True
                            last_recovery_check = time.monotonic()
                        continue
                except (ASRChunkTimeoutError, ASRUnavailableError, ASRError):
                    consecutive_failures += 1
                    if consecutive_failures >= 3:
                        degraded = True
                        last_recovery_check = time.monotonic()
                    continue

                current = clean_text(raw_text)
                if not current or current == last_full_text:
                    stale_count += 1
                else:
                    prefix = _fuzzy_lcp(committed_text, current)
                    new_content = current[prefix:]
                    if not new_content:
                        stale_count += 1
                    else:
                        stale_count = 0
                        last_full_text = current
                        last_change_time = time.monotonic()
                        if _REPEAT_RE.search(current):
                            try:
                                await qwen_client.finish(session_id)
                            except Exception:
                                pass
                            session_id = await qwen_client.start()
                            _ACTIVE_ASR_SESSIONS[session_key] = session_id
                            committed_text = ""
                            last_full_text = ""
                            pending_buffer = ""
                            sent_tail = ""
                            bubble_start = 0
                            continue
                        if current == previous_full_text:
                            repeat_burst += 1
                            if repeat_burst >= 3:
                                try:
                                    await qwen_client.finish(session_id)
                                except Exception:
                                    pass
                                session_id = await qwen_client.start()
                                _ACTIVE_ASR_SESSIONS[session_key] = session_id
                                committed_text = ""
                                last_full_text = ""
                                previous_full_text = ""
                                pending_buffer = ""
                                sent_tail = ""
                                bubble_start = 0
                                repeat_burst = 0
                                continue
                        else:
                            previous_full_text = current
                            repeat_burst = 0

                        await send_final(current[bubble_start:], current, is_preview=True)
                        if current.endswith(("。", "？", "！", "…")):
                            bubble = current[bubble_start:]
                            await send_final(bubble, current)
                            bubble_start = len(current)
                            committed_text = current
                            pending_buffer = ""
                        else:
                            pending_buffer += new_content
                            if len(pending_buffer) >= 8:
                                if not (pending_buffer == sent_tail[-len(pending_buffer):] and len(pending_buffer) >= 3):
                                    await send_final(pending_buffer, current)
                                    sent_tail = (sent_tail + pending_buffer)[-50:]
                                committed_text = current
                                bubble_start = len(current)
                                pending_buffer = ""

                if stale_count >= 30 and session_id:
                    try:
                        await qwen_client.finish(session_id)
                    except Exception:
                        pass
                    session_id = await qwen_client.start()
                    _ACTIVE_ASR_SESSIONS[session_key] = session_id
                    committed_text = ""
                    last_full_text = ""
                    previous_full_text = ""
                    pending_buffer = ""
                    sent_tail = ""
                    bubble_start = 0
                    stale_count = 0
                    repeat_burst = 0

            pending_buffer_ref[0] = pending_buffer

        asr_task = asyncio.create_task(asr_worker())
        await receiver()
        try:
            audio_queue.put_nowait(None)
        except asyncio.QueueFull:
            pass
    except Exception as exc:
        logger.exception("本地 ASR WS 异常")
        try:
            await websocket.send_json({"type": "error", "message": f"ASR 错误: {exc}"})
        except Exception:
            pass
    finally:
        recv_loop_alive.clear()
        if monitor_task:
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass
        if asr_task:
            asr_task.cancel()
            try:
                await asyncio.wait_for(asr_task, timeout=2)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
        _ACTIVE_ASR_SESSIONS.pop(session_key, None)
        if session_id:
            try:
                await qwen_client.finish(session_id)
            except Exception:
                pass
        if pending_buffer_ref[0]:
            _asr_pending_store[session_key] = {
                "text": pending_buffer_ref[0], "timestamp": time.time(), "version": 1,
            }
        try:
            await websocket.send_json({"type": "finished", "taskId": task_id})
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/api/meeting/asr/2pass/ws")
async def meeting_asr_2pass_websocket(websocket: WebSocket):
    """Stream continuous PCM to 8091 and review complete sentences on 8092."""
    from backend.qwen_asr_client import ASRError
    from backend.services.offline_asr_client import OfflineASRClient
    from backend.services.asr_2pass_service import (
        ContinuationFinalBuffer,
        OrderedFinalBuffer,
        review_with_fallback,
    )

    await websocket.accept()
    token = websocket.query_params.get("token", "")
    try:
        user = _get_user_from_auth_token(token, required=True)
    except HTTPException as exc:
        await websocket.send_json({"type": "error", "message": exc.detail})
        await websocket.close(code=4401)
        return

    meeting_id = websocket.query_params.get("meetingId") or ""
    meeting_title = websocket.query_params.get("meetingTitle") or ""
    agenda = websocket.query_params.get("agenda") or ""
    meeting = _load_meetings().get(_safe_meeting_id(meeting_id), {}) if meeting_id else {}
    meeting_title = meeting_title or str(meeting.get("title") or "")
    project = str(meeting.get("project") or "")
    user_role = _resolve_meeting_role(user)
    task_id = f"asr2_{uuid.uuid4().hex}"
    online_client = await _get_qwen_client()
    offline_client = OfflineASRClient(
        base_url=os.environ.get("QWEN_OFFLINE_ASR_URL", "http://127.0.0.1:8092"),
        timeout_seconds=8.0,
    )
    if not await online_client.is_available():
        await websocket.send_json({"type": "error", "message": "本地实时转写暂不可用"})
        await websocket.close(code=1011)
        return

    hotwords = _build_asr_hotwords(
        meeting_title,
        agenda,
        project,
        extra=[user_role.get("displayName", ""), user_role.get("meetingRole", "")],
        meeting=meeting,
    )
    context = "；".join(
        part
        for part in [
            f"会议名称：{meeting_title}" if meeting_title else "",
            f"当前议题：{agenda}" if agenda else "",
            f"所属项目：{project}" if project else "",
            f"参会人及术语：{'、'.join(hotwords[:100])}" if hotwords else "",
        ]
        if part
    )
    try:
        recent_items = _db_load_transcripts_for_meeting(meeting_id).get("transcripts", [])[-8:]
        recent_text = "".join(
            str(item.get("transcript") or "") for item in recent_items
        )[-600:]
        if recent_text:
            context = f"{context}；最近发言：{recent_text}" if context else f"最近发言：{recent_text}"
    except Exception:
        logger.debug("读取 2pass 重连上下文失败 meeting=%s", meeting_id, exc_info=True)
    session_id: Optional[str] = None
    send_lock = asyncio.Lock()
    result_lock = asyncio.Lock()
    review_tasks: set[asyncio.Task] = set()
    final_buffer = OrderedFinalBuffer()
    continuation_buffer = ContinuationFinalBuffer()
    committed_sentences: list[str] = []
    pre_roll = deque(maxlen=3)
    current_pcm = bytearray()
    was_speaking = False
    last_preview = ""

    async def send(payload: dict) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    async def emit_committed(payload: dict) -> None:
        if not str(payload.get("newText") or "").strip():
            return
        committed_sentences.append(payload["newText"])
        payload["fullText"] = "".join(committed_sentences)
        await send(payload)

    async def commit_result(result_payload: dict) -> None:
        async with result_lock:
            ready = final_buffer.add(result_payload)
            for ordered_payload in ready:
                for payload in continuation_buffer.add(ordered_payload):
                    await emit_committed(payload)

    async def review_sentence(
        sentence_id: str,
        sentence_seq: int,
        pcm: bytes,
        online_text: str,
        start_ms: int,
        end_ms: int,
        forced_split: bool,
    ) -> None:
        async def offline_call():
            if not pcm:
                raise ValueError("empty sentence audio")
            return await offline_client.transcribe(
                    pcm,
                    context=context,
                    sentence_id=sentence_id,
                )
        final_text, backend_name, corrected = await review_with_fallback(
            offline_call, online_text, clean_text_2pass, context
        )
        payload = {
            "type": "final",
            "taskId": task_id,
            "meetingId": meeting_id,
            "meetingTitle": meeting_title,
            "agenda": agenda,
            "sentenceId": sentence_id,
            "sentenceSeq": sentence_seq,
            "startMs": start_ms,
            "endMs": end_ms,
            "newText": final_text,
            "onlineText": clean_text_2pass(online_text),
            "isFinal": True,
            "backend": backend_name,
            "corrected": corrected,
            "forcedSplit": forced_split,
        }
        await commit_result(payload)

    def clean_text_2pass(value: str) -> str:
        text = _TOK_RE.sub("", str(value or "")).strip()
        text = re.sub(r"([。，？！,?!])\1+", r"\1", text)
        return _apply_asr_homophone_corrections(text, hotwords, meeting=meeting)

    def schedule_review(result: dict, pcm: bytes) -> None:
        sentence_seq = int(result.get("sentence_seq") or 0)
        sentence_id = str(result.get("sentence_id") or f"{task_id}:{sentence_seq}")
        online_text = str(result.get("final_text") or result.get("online_text") or "")
        start_ms = max(0, int(result.get("start_ms") or 0))
        end_ms = max(start_ms, int(result.get("end_ms") or start_ms))
        forced_split = bool(result.get("forced_split"))
        if sentence_seq <= 0 or not online_text.strip():
            return
        task = asyncio.create_task(
            review_sentence(
                sentence_id,
                sentence_seq,
                pcm,
                online_text,
                start_ms,
                end_ms,
                forced_split,
            )
        )
        review_tasks.add(task)
        task.add_done_callback(review_tasks.discard)

    try:
        session_id = await online_client.start(
            hotwords=hotwords,
            metadata={"meeting_id": meeting_id, "agenda": agenda},
        )
        await send(
            {
                "type": "ready",
                "taskId": task_id,
                "meetingId": meeting_id,
                "speaker": user_role,
                "backend": "paraformer-streaming-2pass",
            }
        )
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("text"):
                try:
                    command = json.loads(message["text"])
                except Exception:
                    continue
                if command.get("type") == "finish":
                    break
                if command.get("type") == "ping":
                    await send({"type": "pong", "timestamp": command.get("timestamp")})
                continue
            audio = message.get("bytes")
            if not audio:
                continue

            if not was_speaking:
                pre_roll.append(audio)
            result = await online_client.send_chunk(
                session_id,
                audio,
                retries=1,
                chunk_timeout=5.0,
            )
            is_speaking = bool(result.get("is_speaking"))
            if not was_speaking and is_speaking:
                current_pcm = bytearray(b"".join(pre_roll))
                pre_roll.clear()
            elif was_speaking:
                current_pcm.extend(audio)

            preview = clean_text_2pass(result.get("preview_text", ""))
            if preview and preview != last_preview:
                last_preview = preview
                await send(
                    {
                        "type": "preview",
                        "taskId": task_id,
                        "sentenceId": result.get("sentence_id"),
                        "sentenceSeq": result.get("sentence_seq"),
                        "text": preview,
                        "backend": "paraformer-streaming",
                    }
                )
            if result.get("event") == "sentence_final":
                schedule_review(result, bytes(current_pcm))
                current_pcm.clear()
                last_preview = ""
                pre_roll.clear()
                pre_roll.append(audio)
            was_speaking = is_speaking
    except WebSocketDisconnect:
        pass
    except ASRError as exc:
        logger.warning("2pass online ASR failed meeting=%s: %s", meeting_id, exc)
        try:
            await send({"type": "error", "message": "实时转写暂时中断，录音仍在保存"})
        except Exception:
            pass
    except Exception:
        logger.exception("2pass ASR WebSocket failed meeting=%s", meeting_id)
    finally:
        if session_id:
            try:
                result = await online_client.finish(session_id)
                if result.get("event") == "sentence_final":
                    schedule_review(result, bytes(current_pcm))
            except Exception:
                logger.debug("failed to finish 2pass online session", exc_info=True)
        if review_tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*list(review_tasks), return_exceptions=True),
                    timeout=10.0,
                )
            except asyncio.TimeoutError:
                logger.warning("2pass review drain timed out meeting=%s", meeting_id)
        async with result_lock:
            for payload in continuation_buffer.flush():
                await emit_committed(payload)
        await offline_client.close()
        try:
            await send({"type": "finished", "taskId": task_id})
            await websocket.close()
        except Exception:
            pass

"""Faithful AI cleanup layer between immutable ASR evidence and Word records."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping, Sequence

from backend.services.meeting_record_generation_service import (
    TranscriptSegment,
    normalise_transcript_segments,
)


MAX_RAW_GROUP_SECONDS = 180
MAX_RAW_GROUP_CHARS = 4000
MAX_SEGMENTS_PER_GROUP = 120
MAX_OUTPUT_PARAGRAPH_CHARS = 800
CLEANUP_PROMPT_VERSION = "meeting-record-cleanup-v2.3"
TOPIC_REDUCE_PROMPT_VERSION = "meeting-record-topic-reduce-v1"
CONTENT_TYPES = {
    "meeting_speech", "presentation", "background_media",
    "operation", "noise", "uncertain",
}
QUALITY_VALUES = {"high", "medium", "low"}
INFORMATION_VALUES = {"high", "medium", "low", "none"}
STATEMENT_TYPES = {"fact", "discussion", "proposal", "opinion", "decision", "action", "risk", "uncertain"}
MODALITY_VALUES = {"confirmed", "planned", "proposed", "discussed", "uncertain"}
HUMAN_REVIEW_VALUES = {"unreviewed", "confirmed", "edited", "rejected"}

_MEDIA_RE = re.compile(
    r"点赞|订阅|转发|打赏|关注.{0,6}(频道|账号)|感谢观看|广告|宣传片|演示视频",
    re.IGNORECASE,
)
_BACKGROUND_MEDIA_SOURCE_RE = re.compile(
    r"(?:播放|观看|展示|打开).{0,12}(?:视频|宣传片|录音)|"
    r"(?:我们|这个|相关).{0,12}(?:小区|平台).{0,8}的(?:相关)?视频|"
    r"频道推广|感谢观看|点赞|订阅|转发|打赏",
    re.IGNORECASE,
)
_DECISION_RE = re.compile(r"会议决定|会议明确|会议要求|审议通过|确定由")
_FORBIDDEN_REASONING_RE = re.compile(
    r"原文|根据语境|结合上下文|推测为|疑似(?:指|为)?|"
    r"可能指|原始转写|转写|注：|规则禁止|规则要求|故标记|故保留|"
    r"考虑到|无法确认为|ASR错误|AI判断"
)
_OPERATION_RE = re.compile(r"^(?:请)?(?:点一下|再看看|放大一点|往下拉|打不开|太卡了|切一下|返回去)[。！ ]*$")
_FILLER_ONLY_RE = re.compile(r"^(?:嗯|啊|哦|好|对|谢谢|行|可以|是)+[，。！？ ]*$")
_UNCLEAR_RE = re.compile(r"\[听辨不清\]|听辨不清|无法辨识|无法确认含义")
_PARENTHETICAL_GUESS_RE = re.compile(r"（[^（）]{0,30}(?:/|或[^（）]{0,12})[^（）]{0,30}）")


@dataclass(frozen=True)
class CleanupChunk:
    id: str
    segments: tuple[TranscriptSegment, ...]

    @property
    def source_segment_ids(self) -> list[str]:
        return list(dict.fromkeys(item.id for item in self.segments))

    @property
    def start(self) -> float | None:
        values = [item.start for item in self.segments if item.start is not None]
        return min(values) if values else None

    @property
    def end(self) -> float | None:
        values = [item.end for item in self.segments if item.end is not None]
        return max(values) if values else None

    @property
    def text(self) -> str:
        return "\n".join(
            f"[{item.id}] {_format_seconds(item.start)}-{_format_seconds(item.end)} "
            f"{item.speaker or '发言人未确认'}：{item.text}"
            for item in self.segments
        )

    @property
    def input_hash(self) -> str:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()


def _format_seconds(value: float | None) -> str:
    if value is None:
        return ""
    total = max(0, int(value))
    return f"{total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}"


def _is_media(segment: TranscriptSegment) -> bool:
    return bool(_MEDIA_RE.search(segment.text or ""))


def _normalize_record_text(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(
        r"(^|[。！？])发言人(?:未确认)?(?:表示|指出|说明|介绍|开始|邀请|继续)?[，： ]*",
        r"\1会议中提到，",
        text,
    )
    text = text.replace("会议中了", "会议中介绍了")
    text = text.replace("发言人", "有参会人员")
    text = re.sub(r"会议中提到[，,： ]*(?:会议中)?提到[，,： ]*", "会议中提到，", text)
    text = text.replace("有有参会人员", "有参会人员")
    return text


def _enforce_deterministic_content_type(
    item: Mapping[str, Any],
    *,
    source_text: str = "",
) -> dict[str, Any]:
    """Reapply non-AI classification rules to fresh and cached records."""

    normalized = dict(item)
    normalized["recordText"] = _normalize_record_text(normalized.get("recordText"))
    if normalized.get("contentType") == "speech":
        normalized["contentType"] = "meeting_speech"
    if _BACKGROUND_MEDIA_SOURCE_RE.search(source_text):
        normalized["contentType"] = "background_media"
        normalized["informationValue"] = "none"
        normalized["recordText"] = ""
        normalized["includeInRecord"] = False
    elif normalized.get("contentType") == "meeting_speech" and _MEDIA_RE.search(str(normalized.get("recordText") or "")):
        normalized["contentType"] = "background_media"
        normalized["informationValue"] = "none"
        normalized["includeInRecord"] = False
    normalized.setdefault("quality", "medium")
    normalized.setdefault("informationValue", "medium")
    normalized.setdefault("statementType", "discussion")
    normalized.setdefault("modality", "discussed")
    normalized.setdefault("reviewNotes", [])
    normalized.setdefault("includeInRecord", normalized.get("contentType") in {"meeting_speech", "presentation"})
    normalized.setdefault("humanReviewStatus", "unreviewed")
    normalized.setdefault("humanEdited", False)
    normalized.setdefault("locked", False)
    return normalized


def _parse_time(value: Any) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    if ":" not in text:
        try:
            return max(0.0, float(text))
        except ValueError:
            return 0.0
    parts = text.split(":")
    try:
        numbers = [float(item) for item in parts]
    except ValueError:
        return 0.0
    if len(numbers) == 3:
        return max(0.0, numbers[0] * 3600 + numbers[1] * 60 + numbers[2])
    if len(numbers) == 2:
        return max(0.0, numbers[0] * 60 + numbers[1])
    return 0.0


def build_cleanup_chunks(source: Any) -> list[CleanupChunk]:
    """Build bounded chunks without treating an unknown speaker as identity."""

    segments = normalise_transcript_segments(source)
    chunks: list[CleanupChunk] = []
    current: list[TranscriptSegment] = []
    chars = 0

    def flush() -> None:
        nonlocal current, chars
        if current:
            chunks.append(CleanupChunk(f"record-chunk-{len(chunks) + 1:04d}", tuple(current)))
        current = []
        chars = 0

    for segment in segments:
        if current:
            first_start = current[0].start
            elapsed = (
                (segment.end if segment.end is not None else segment.start) - first_start
                if first_start is not None and (segment.end is not None or segment.start is not None)
                else 0
            )
            hard_break = (
                segment.file_id != current[-1].file_id
                or elapsed >= MAX_RAW_GROUP_SECONDS
                or chars + len(segment.text) >= MAX_RAW_GROUP_CHARS
                or len(current) >= MAX_SEGMENTS_PER_GROUP
                or _is_media(segment) != _is_media(current[-1])
            )
            if hard_break:
                flush()
        current.append(segment)
        chars += len(segment.text)
    flush()
    return chunks


def build_cleanup_prompt(chunk: CleanupChunk, meeting_context: Mapping[str, Any] | None = None) -> str:
    context = meeting_context or {}
    return f"""你是会议过程记录整理助手。你的任务不是生成逐字稿或会议纪要，而是生成忠于原意、可阅读、可追溯的会议过程记录块。

绝对规则：
1. 不新增事实、数字、人名、责任人、期限、决定、结论或要求，不修正无法证实的事实。
2. 不把 discussion、proposal、planned 或疑问升级为 decision/confirmed。
3. 删除无信息语气词、重复确认、操作口令和无意义重复；核心语义不可靠时不猜测。
4. 局部不清但整体明确时使用中性表达；高噪声内容 quality=low 且 includeInRecord=false。
5. 背景视频、广告、电视、宣传片标记 background_media；无会议价值时 recordText 为空且 includeInRecord=false。
6. 页面或系统演示标记 presentation；“点一下/放大/太卡了”等标记 operation，原则上不进入记录。
7. recordText 禁止写推理过程，禁止出现：原文、转写、根据语境、结合上下文、推测为、疑似、可能指、规则禁止、故标记、故保留、ASR错误、AI判断。
8. 禁止在 recordText 中用括号给出修词说明、同义猜测或多个候选词；不确定内容只写入 reviewNotes，正文使用不改变事实的中性表达或不输出。
9. 不要在 recordText 中堆叠[听辨不清]；疑点写入 reviewNotes，reviewNotes 不面向 Word。
10. 每块建议100至500字，最长800字；每条必须引用本块真实 sourceSegmentIds。
11. 数字、金额、比例、日期、责任人必须有明确 sourceSegmentIds；否则使用不含具体数值的中性表达或不输出。
12. contentType：meeting_speech/presentation/background_media/operation/noise/uncertain。
13. quality：high/medium/low；informationValue：high/medium/low/none。
14. statementType：fact/discussion/proposal/opinion/decision/action/risk/uncertain。
15. modality：confirmed/planned/proposed/discussed/uncertain。

会议：{context.get('title') or ''}
项目：{context.get('project') or ''}

仅返回 JSON：
{{"blocks":[{{"title":"主题","recordText":"忠实整理内容","reviewNotes":[],"contentType":"meeting_speech","informationValue":"high","quality":"high","statementType":"discussion","modality":"discussed","includeInRecord":true,"sourceSegmentIds":["segment-id"]}}]}}

原始转写：
{chunk.text}
"""


def build_topic_reduce_prompt(blocks: Sequence[Mapping[str, Any]], meeting_context: Mapping[str, Any] | None = None) -> str:
    context = meeting_context or {}
    rows = [{
        "seq": index,
        "id": item.get("id"),
        "title": item.get("title") or item.get("topic"),
        "startTime": item.get("startTime"),
        "endTime": item.get("endTime"),
        "informationValue": item.get("informationValue"),
        "statementType": item.get("statementType"),
        "modality": item.get("modality"),
        "recordText": item.get("recordText"),
    } for index, item in enumerate((item for item in blocks if item.get("includeInRecord")), 1)]
    return f"""你是会议记录结构整理助手。你只组织已经清洗的记录块，不改写事实。

规则：
1. 不新增内容，不改变事实强度，不把 proposed/planned/discussed 升级为 decision/confirmed。
2. 相邻、同一业务对象、时间连续的短块优先合并。
3. 本会议约{int(max((_parse_time(x.get('endTime')) for x in blocks), default=0) / 60)}分钟，一级主题目标为8至12个；真实语义需要时可在6至15个之间。
4. 正文少于50字且 informationValue!=high 的块不得单独成为一级主题。
5. 只能按照输入 seq 的顺序切分连续区间，禁止跨时间把不相邻 block 合并；所有区间必须首尾衔接、完整覆盖输入。
6. 每个主题返回 startBlockId 和 endBlockId；它们之间的全部 block 自动归入该主题，不要返回跳跃的 blockIds。
7. 标题使用客观业务名词，不写结论，不输出推理过程。
8. 只返回 JSON。

会议：{context.get('title') or ''}
输入块：{json.dumps(rows, ensure_ascii=False)}

输出：{{"topics":[{{"id":"topic-001","title":"一级主题","startBlockId":"record-id","endBlockId":"record-id","subTopics":[{{"title":"二级主题","startBlockId":"record-id","endBlockId":"record-id"}}]}}]}}
"""


def _extract_json(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    if hasattr(value, "content"):
        value = value.content
    text = str(value or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I | re.S).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("cleanup response is not JSON")
        parsed = json.loads(text[start:end + 1])
    if not isinstance(parsed, Mapping):
        raise ValueError("cleanup response must be an object")
    return parsed


async def _invoke(handler: Any, prompt: str) -> Any:
    if hasattr(handler, "ainvoke"):
        result = handler.ainvoke(prompt)
    elif hasattr(handler, "invoke"):
        result = handler.invoke(prompt)
    else:
        result = handler(prompt)
    return await result if inspect.isawaitable(result) else result


def _split_text(text: str, limit: int = MAX_OUTPUT_PARAGRAPH_CHARS) -> list[str]:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(text) <= limit:
        return [text] if text else []
    pieces: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= limit:
            pieces.append(remaining)
            break
        cut = max(remaining.rfind(mark, 0, limit + 1) for mark in "。！？；")
        cut = cut + 1 if cut >= limit // 2 else limit
        pieces.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    return [item for item in pieces if item]


def validate_cleanup_result(payload: Mapping[str, Any], chunk: CleanupChunk) -> list[dict[str, Any]]:
    allowed_ids = set(chunk.source_segment_ids)
    by_id = {item.id: item for item in chunk.segments}
    output: list[dict[str, Any]] = []
    raw_text = " ".join(item.text for item in chunk.segments)
    raw_has_decision = bool(_DECISION_RE.search(raw_text))
    raw_blocks = payload.get("blocks") if isinstance(payload.get("blocks"), list) else payload.get("records") or []
    for raw in raw_blocks:
        if not isinstance(raw, Mapping):
            continue
        content_type = str(raw.get("contentType") or "meeting_speech").strip()
        if content_type == "speech":
            content_type = "meeting_speech"
        if content_type not in CONTENT_TYPES:
            continue
        quality = str(raw.get("quality") or "medium").strip()
        information_value = str(raw.get("informationValue") or "medium").strip()
        statement_type = str(raw.get("statementType") or "discussion").strip()
        modality = str(raw.get("modality") or "discussed").strip()
        if quality not in QUALITY_VALUES or information_value not in INFORMATION_VALUES:
            continue
        if statement_type not in STATEMENT_TYPES or modality not in MODALITY_VALUES:
            continue
        source_ids = [str(item) for item in raw.get("sourceSegmentIds") or [] if str(item) in allowed_ids]
        source_ids = list(dict.fromkeys(source_ids))
        text = _normalize_record_text(raw.get("recordText"))
        review_notes = [str(item).strip() for item in raw.get("reviewNotes") or [] if str(item).strip()]
        if not source_ids:
            continue
        if _FORBIDDEN_REASONING_RE.search(text) or _PARENTHETICAL_GUESS_RE.search(text):
            raise ValueError("recordText contains AI review reasoning")
        suspicious = bool(_DECISION_RE.search(text)) and not raw_has_decision
        if suspicious or (statement_type == "decision" and not raw_has_decision):
            raise ValueError("record block upgraded discussion to decision")
        referenced = [by_id[item] for item in source_ids]
        # Deterministic guardrail: obvious promotional/media phrases must never
        # enter the participant speech stream even if the model misclassifies
        # the record. Media chunks are isolated before inference, so checking
        # both the rewritten text and its cited source is safe and traceable.
        referenced_text = " ".join(item.text for item in referenced)
        if _BACKGROUND_MEDIA_SOURCE_RE.search(referenced_text):
            content_type = "background_media"
            information_value = "none"
            text = ""
        elif content_type == "meeting_speech" and (
            _MEDIA_RE.search(text) or _MEDIA_RE.search(referenced_text)
        ):
            content_type = "background_media"
            information_value = "none"
            text = ""
        if _FILLER_ONLY_RE.fullmatch(text) or _OPERATION_RE.fullmatch(text):
            content_type = "operation" if text else "noise"
            information_value = "none"
            text = ""
        unclear_count = len(_UNCLEAR_RE.findall(text))
        if unclear_count >= 2 or (text and unclear_count and len(text) < 80):
            quality = "low"
            review_notes.append("原始转写核心语义不稳定，未纳入会议记录正文。")
            text = ""
        include_in_record = bool(raw.get("includeInRecord", True))
        if quality == "low" or information_value == "none" or content_type in {"background_media", "operation", "noise", "uncertain"}:
            include_in_record = False
        if include_in_record and not text:
            continue
        starts = [item.start for item in referenced if item.start is not None]
        ends = [item.end for item in referenced if item.end is not None]
        start = min(starts) if starts else chunk.start
        end = max(ends) if ends else chunk.end
        pieces = _split_text(text) if text else [""]
        for piece_index, piece in enumerate(pieces):
            output.append({
                "id": f"{chunk.id}-{len(output) + 1:03d}",
                "title": str(raw.get("title") or raw.get("topic") or "会议过程记录").strip()[:100],
                "topic": str(raw.get("title") or raw.get("topic") or "会议过程记录").strip()[:100],
                "startTime": _format_seconds(start),
                "endTime": _format_seconds(end),
                "speaker": str(raw.get("speaker") or "发言人未确认").strip() or "发言人未确认",
                "recordText": piece,
                "contentType": content_type,
                "informationValue": information_value,
                "quality": quality,
                "statementType": statement_type,
                "modality": modality,
                "reviewNotes": review_notes,
                "includeInRecord": include_in_record,
                "humanReviewStatus": "unreviewed",
                "humanEdited": False,
                "sourceSegmentIds": source_ids,
                "sourceFileIds": list(dict.fromkeys(item.file_id for item in referenced)),
                "aiGenerated": True,
                "locked": False,
                "suspicious": suspicious,
                "inputHash": chunk.input_hash,
                "promptVersion": CLEANUP_PROMPT_VERSION,
                "part": piece_index + 1,
            })
    return output


def cleanup_failure_paragraph(chunk: CleanupChunk, error: str = "") -> dict[str, Any]:
    return {
        "id": f"{chunk.id}-pending",
        "topic": "本段待整理",
        "startTime": _format_seconds(chunk.start),
        "endTime": _format_seconds(chunk.end),
        "speaker": "发言人未确认",
        "recordText": "本段会议记录暂未完成 AI 整理，请查看证据核验附件。",
        "contentType": "uncertain",
        "informationValue": "medium",
        "quality": "low",
        "statementType": "uncertain",
        "modality": "uncertain",
        "reviewNotes": [str(error or "cleanup failed")[:300]],
        "includeInRecord": True,
        "humanReviewStatus": "unreviewed",
        "humanEdited": False,
        "sourceSegmentIds": chunk.source_segment_ids,
        "sourceFileIds": list(dict.fromkeys(item.file_id for item in chunk.segments)),
        "aiGenerated": False,
        "locked": False,
        "cleanupFailed": True,
        "cleanupError": str(error or "cleanup failed")[:300],
        "inputHash": chunk.input_hash,
        "promptVersion": CLEANUP_PROMPT_VERSION,
    }


def cleanup_noise_paragraph(chunk: CleanupChunk) -> dict[str, Any]:
    """Keep a traceable audit row for a semantically empty short chunk."""

    return {
        "id": f"{chunk.id}-noise",
        "topic": "无独立语义短句",
        "startTime": _format_seconds(chunk.start),
        "endTime": _format_seconds(chunk.end),
        "speaker": "发言人未确认",
        "recordText": "无独立语义短句，会议记录正文略。",
        "contentType": "noise",
        "informationValue": "none",
        "quality": "low",
        "statementType": "uncertain",
        "modality": "uncertain",
        "reviewNotes": ["无独立语义短句，原始证据继续保留。"],
        "includeInRecord": False,
        "humanReviewStatus": "unreviewed",
        "humanEdited": False,
        "sourceSegmentIds": chunk.source_segment_ids,
        "sourceFileIds": list(dict.fromkeys(item.file_id for item in chunk.segments)),
        "aiGenerated": False,
        "locked": False,
        "inputHash": chunk.input_hash,
        "promptVersion": CLEANUP_PROMPT_VERSION,
    }


def _topic_from_blocks(topic_id: str, title: str, block_ids: Sequence[str], by_id: Mapping[str, Mapping[str, Any]], sub_topics: Sequence[Mapping[str, Any]] | None = None) -> dict[str, Any]:
    valid_ids = [item for item in block_ids if item in by_id]
    starts = [_parse_time(by_id[item].get("startTime")) for item in valid_ids]
    ends = [_parse_time(by_id[item].get("endTime")) for item in valid_ids]
    return {
        "id": topic_id,
        "title": re.sub(r"\s+", " ", str(title or "会议讨论")).strip()[:80] or "会议讨论",
        "startTime": _format_seconds(min(starts) if starts else 0),
        "endTime": _format_seconds(max(ends) if ends else 0),
        "blockIds": valid_ids,
        "subTopics": [
            {
                "title": re.sub(r"\s+", " ", str(item.get("title") or "讨论内容")).strip()[:80],
                "blockIds": [block_id for block_id in item.get("blockIds") or [] if block_id in valid_ids],
            }
            for item in sub_topics or []
            if isinstance(item, Mapping)
        ],
    }


def validate_topic_reduce_result(payload: Mapping[str, Any], blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    included = [item for item in blocks if item.get("includeInRecord") and item.get("recordText")]
    by_id = {str(item.get("id")): item for item in included if item.get("id")}
    ordered_ids = [str(item.get("id")) for item in included if item.get("id")]
    positions = {block_id: index for index, block_id in enumerate(ordered_ids)}
    raw_topics = [item for item in payload.get("topics") or [] if isinstance(item, Mapping)]
    boundary_topics = [item for item in raw_topics if str(item.get("startBlockId") or "") in positions]
    if boundary_topics:
        by_start: dict[int, Mapping[str, Any]] = {}
        for item in boundary_topics:
            by_start.setdefault(positions[str(item.get("startBlockId"))], item)
        if 0 not in by_start:
            by_start[0] = {
                "title": by_id[ordered_ids[0]].get("title") or "会议开场讨论",
                "startBlockId": ordered_ids[0],
                "subTopics": [],
            }
        starts = sorted(by_start)
        boundary_topics = [by_start[item] for item in starts]
        if len(included) >= 20 and not 6 <= len(boundary_topics) <= 15:
            raise ValueError("topic reduce produced an unsuitable topic count")
        topics: list[dict[str, Any]] = []
        for index, raw in enumerate(boundary_topics):
            start_pos = starts[index]
            end_pos = starts[index + 1] - 1 if index + 1 < len(starts) else len(ordered_ids) - 1
            ids = ordered_ids[start_pos:end_pos + 1]
            raw_sub_topics = [item for item in raw.get("subTopics") or [] if isinstance(item, Mapping)]
            sub_starts = sorted({
                positions[str(item.get("startBlockId"))]
                for item in raw_sub_topics
                if str(item.get("startBlockId") or "") in positions
                and start_pos <= positions[str(item.get("startBlockId"))] <= end_pos
            })
            if not sub_starts or sub_starts[0] != start_pos:
                sub_starts.insert(0, start_pos)
            sub_topics = []
            for sub_index, sub_start in enumerate(sub_starts):
                sub_end = sub_starts[sub_index + 1] - 1 if sub_index + 1 < len(sub_starts) else end_pos
                matching = next((item for item in raw_sub_topics if positions.get(str(item.get("startBlockId") or "")) == sub_start), None)
                sub_topics.append({
                    "title": (matching or {}).get("title") or by_id[ordered_ids[sub_start]].get("title") or "讨论内容",
                    "blockIds": ordered_ids[sub_start:sub_end + 1],
                })
            topics.append(_topic_from_blocks(
                f"topic-{index + 1:03d}", str(raw.get("title") or "会议讨论"), ids, by_id, sub_topics,
            ))
        return topics
    seen: set[str] = set()
    topics: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_topics, 1):
        if not isinstance(raw, Mapping):
            continue
        start_id = str(raw.get("startBlockId") or "")
        end_id = str(raw.get("endBlockId") or "")
        if start_id in positions and end_id in positions and positions[start_id] <= positions[end_id]:
            ids = ordered_ids[positions[start_id]:positions[end_id] + 1]
        else:
            ids = [str(item) for item in raw.get("blockIds") or [] if str(item) in by_id]
        if not ids:
            continue
        id_positions = [positions[item] for item in ids]
        if id_positions != list(range(min(id_positions), max(id_positions) + 1)):
            raise ValueError("topic reduce merged non-contiguous blocks")
        if any(item in seen for item in ids):
            raise ValueError("topic reduce duplicated record blocks")
        sub_topics = []
        for sub in raw.get("subTopics") or []:
            if not isinstance(sub, Mapping):
                continue
            sub_start = str(sub.get("startBlockId") or "")
            sub_end = str(sub.get("endBlockId") or "")
            if sub_start in positions and sub_end in positions and positions[sub_start] <= positions[sub_end]:
                sub_ids = ordered_ids[positions[sub_start]:positions[sub_end] + 1]
            else:
                sub_ids = [str(item) for item in sub.get("blockIds") or [] if str(item) in ids]
            sub_ids = [item for item in sub_ids if item in ids]
            if sub_ids:
                sub_topics.append({"title": sub.get("title") or "讨论内容", "blockIds": sub_ids})
        topic = _topic_from_blocks(
            f"topic-{index:03d}", str(raw.get("title") or "会议讨论"), ids, by_id,
            sub_topics,
        )
        topics.append(topic)
        seen.update(ids)
    if len(included) >= 20 and not 6 <= len(topics) <= 15:
        raise ValueError("topic reduce produced an unsuitable topic count")
    if seen != set(ordered_ids):
        raise ValueError("topic reduce did not cover every record block")
    flattened = [block_id for topic in topics for block_id in topic["blockIds"]]
    if flattened != ordered_ids:
        raise ValueError("topic reduce changed the meeting chronology")
    return topics


def build_fallback_topics(blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Keep Word usable when Topic Reduce fails without exposing raw ASR."""

    included = [item for item in blocks if item.get("includeInRecord") and item.get("recordText")]
    if not included:
        return []
    target = min(12, max(1, round(max(_parse_time(item.get("endTime")) for item in included) / 720)))
    group_size = max(1, (len(included) + target - 1) // target)
    by_id = {str(item.get("id")): item for item in included}
    topics: list[dict[str, Any]] = []
    for offset in range(0, len(included), group_size):
        group = included[offset:offset + group_size]
        title_candidates = []
        for item in group:
            candidate = str(item.get("title") or item.get("topic") or "").strip()
            if candidate and candidate not in title_candidates and not item.get("cleanupFailed"):
                title_candidates.append(candidate)
            if len(title_candidates) == 2:
                break
        first_title = "与".join(title_candidates) or "会议讨论"
        sub_topics = [{"title": str(item.get("title") or item.get("topic") or "讨论内容"), "blockIds": [str(item.get("id"))]} for item in group]
        topics.append(_topic_from_blocks(
            f"topic-{len(topics) + 1:03d}", first_title,
            [str(item.get("id")) for item in group], by_id, sub_topics,
        ))
    return topics


def reuse_existing_topics(
    existing_topics: Sequence[Mapping[str, Any]] | None,
    blocks: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Remap the last valid semantic outline onto regenerated record blocks.

    Cleanup retries can replace a small number of block ids while leaving the
    meeting chronology unchanged.  Topic Reduce is an organisational layer, so
    a transient LLM failure must not throw away a previously accepted outline.
    """

    included = [item for item in blocks if item.get("includeInRecord") and item.get("recordText")]
    if not included or not existing_topics:
        return []
    ordered = sorted(
        included,
        key=lambda item: (_parse_time(item.get("startTime")), _parse_time(item.get("endTime")), str(item.get("id") or "")),
    )
    by_id = {str(item.get("id")): item for item in ordered if item.get("id")}

    def nearest_id(value: Any) -> str:
        target = _parse_time(value)
        candidate = min(
            ordered,
            key=lambda item: (
                abs(_parse_time(item.get("startTime")) - target),
                _parse_time(item.get("startTime")),
            ),
        )
        return str(candidate.get("id") or "")

    raw_topics: list[dict[str, Any]] = []
    for topic in existing_topics:
        if not isinstance(topic, Mapping):
            continue
        existing_ids = [str(item) for item in topic.get("blockIds") or []]
        start_id = next((item for item in existing_ids if item in by_id), "")
        if not start_id:
            start_id = nearest_id(topic.get("startTime"))
        sub_topics = []
        for sub_topic in topic.get("subTopics") or []:
            if not isinstance(sub_topic, Mapping):
                continue
            sub_ids = [str(item) for item in sub_topic.get("blockIds") or []]
            sub_start_id = next((item for item in sub_ids if item in by_id), "")
            if not sub_start_id and sub_ids:
                old_start = next(
                    (
                        item.get("startTime")
                        for item in blocks
                        if str(item.get("id") or "") == sub_ids[0]
                    ),
                    topic.get("startTime"),
                )
                sub_start_id = nearest_id(old_start)
            if sub_start_id:
                sub_topics.append({"title": sub_topic.get("title") or "讨论内容", "startBlockId": sub_start_id})
        raw_topics.append({
            "title": topic.get("title") or "会议讨论",
            "startBlockId": start_id,
            "subTopics": sub_topics,
        })
    try:
        return validate_topic_reduce_result({"topics": raw_topics}, ordered)
    except (TypeError, ValueError):
        return []


class MeetingRecordCleanupService:
    def __init__(self, *, cleanup_call: Any, topic_reduce_call: Any | None = None, semaphore: asyncio.Semaphore | None = None, concurrency: int = 3, model_name: str = "local-qwen"):
        self.cleanup_call = cleanup_call
        self.topic_reduce_call = topic_reduce_call or cleanup_call
        self.semaphore = semaphore or asyncio.Semaphore(max(1, concurrency))
        self.model_name = model_name

    async def _cleanup_one(self, chunk: CleanupChunk, context: Mapping[str, Any]) -> list[dict[str, Any]]:
        prompt = build_cleanup_prompt(chunk, context)
        error = ""
        for attempt in range(3):
            try:
                async with self.semaphore:
                    response = await _invoke(self.cleanup_call, prompt)
                payload = _extract_json(response)
                result = validate_cleanup_result(payload, chunk)
                if result:
                    if attempt < 2 and any(item.get("suspicious") for item in result):
                        prompt += "\n上一次输出把讨论升级成了决定。请重新输出中性、忠实的会议过程表述，不得使用会议决定、会议明确、会议要求、审议通过或确定由。"
                        continue
                    return result
                returned_rows = payload.get("blocks") if isinstance(payload.get("blocks"), list) else payload.get("records")
                if isinstance(returned_rows, list) and not returned_rows and sum(len(item.text.strip()) for item in chunk.segments) <= 20:
                    return [cleanup_noise_paragraph(chunk)]
                error = "cleanup returned no valid records"
            except Exception as exc:
                error = str(exc)
                if attempt < 2:
                    prompt += "\n上一次输出未通过安全校验。重新输出时必须把内部审校信息放入reviewNotes，recordText只能保留干净、忠实的会议记录正文；不得强化事实，不得猜测。"
        return [cleanup_failure_paragraph(chunk, error)]

    async def _reduce_topics(
        self,
        blocks: Sequence[Mapping[str, Any]],
        context: Mapping[str, Any],
        existing_topics: Sequence[Mapping[str, Any]] | None = None,
    ) -> tuple[list[dict[str, Any]], bool, bool]:
        prompt = build_topic_reduce_prompt(blocks, context)
        for attempt in range(3):
            try:
                async with self.semaphore:
                    response = await _invoke(self.topic_reduce_call, prompt)
                topics = validate_topic_reduce_result(_extract_json(response), blocks)
                if topics:
                    return topics, False, False
            except Exception as exc:
                if attempt < 2:
                    prompt += f"\n上一次结果未通过校验：{exc}。请严格按seq顺序切分连续区间，完整覆盖且不得重叠。"
        reused = reuse_existing_topics(existing_topics, blocks)
        if reused:
            return reused, False, True
        return build_fallback_topics(blocks), True, False

    async def build_record_paragraphs(
        self,
        source: Any,
        *,
        meeting_context: Mapping[str, Any] | None = None,
        existing: Sequence[Mapping[str, Any]] | None = None,
        existing_topics: Sequence[Mapping[str, Any]] | None = None,
    ) -> dict[str, Any]:
        chunks = build_cleanup_chunks(source)
        locked = [
            _enforce_deterministic_content_type(item)
            for item in existing or []
            if isinstance(item, Mapping) and item.get("locked")
        ]
        locked_ids = {str(segment_id) for item in locked for segment_id in item.get("sourceSegmentIds") or []}
        cached_by_hash: dict[str, list[dict[str, Any]]] = {}
        for item in existing or []:
            if not isinstance(item, Mapping) or item.get("locked") or item.get("cleanupFailed"):
                continue
            input_hash = str(item.get("inputHash") or "")
            if input_hash and item.get("promptVersion") == CLEANUP_PROMPT_VERSION:
                cached_by_hash.setdefault(input_hash, []).append(dict(item))
        cached: list[dict[str, Any]] = []
        pending: list[CleanupChunk] = []
        for chunk in chunks:
            if locked_ids.intersection(chunk.source_segment_ids):
                continue
            if chunk.input_hash in cached_by_hash:
                cached.extend(
                    _enforce_deterministic_content_type(item, source_text=chunk.text)
                    for item in cached_by_hash[chunk.input_hash]
                )
            else:
                pending.append(chunk)
        results = await asyncio.gather(*(self._cleanup_one(chunk, meeting_context or {}) for chunk in pending))
        paragraphs = locked + cached + [
            _enforce_deterministic_content_type(item)
            for group in results
            for item in group
        ]
        all_source_ids = {item.id for item in normalise_transcript_segments(source)}
        covered_ids = {str(segment_id) for item in paragraphs for segment_id in item.get("sourceSegmentIds") or []}
        omitted_ids = sorted(all_source_ids - covered_ids)
        if omitted_ids:
            paragraphs.append({
                "id": "record-omitted-audit", "title": "未纳入正文的原始片段",
                "topic": "未纳入正文的原始片段", "startTime": "", "endTime": "",
                "speaker": "发言人未确认", "recordText": "",
                "contentType": "noise", "informationValue": "none", "quality": "low",
                "statementType": "uncertain", "modality": "uncertain",
                "reviewNotes": ["清洗模型未引用这些片段，原始证据继续保留。"],
                "includeInRecord": False, "humanReviewStatus": "unreviewed", "humanEdited": False,
                "sourceSegmentIds": omitted_ids, "sourceFileIds": [], "aiGenerated": False,
                "locked": False, "inputHash": "", "promptVersion": CLEANUP_PROMPT_VERSION,
            })
        paragraphs.sort(key=lambda item: (str(item.get("startTime") or ""), str(item.get("id") or "")))
        topics, topic_reduce_fallback, topic_outline_reused = await self._reduce_topics(
            paragraphs,
            meeting_context or {},
            existing_topics,
        )
        return {
            "recordParagraphs": paragraphs,
            "recordBlocks": paragraphs,
            "recordTopics": topics,
            "snapshot": {
                "model": self.model_name,
                "promptVersion": CLEANUP_PROMPT_VERSION,
                "generatedAt": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
                "chunkCount": len(chunks),
                "cachedChunkCount": len({item.get('inputHash') for item in cached if item.get('inputHash')}),
                "failedChunkCount": sum(1 for item in paragraphs if item.get("cleanupFailed")),
                "includedBlockCount": sum(1 for item in paragraphs if item.get("includeInRecord")),
                "topicCount": len(topics),
                "topicReducePromptVersion": TOPIC_REDUCE_PROMPT_VERSION,
                "topicReduceFallback": topic_reduce_fallback,
                "topicOutlineReused": topic_outline_reused,
                "sourceSegmentCount": len(normalise_transcript_segments(source)),
            },
        }


__all__ = [
    "CLEANUP_PROMPT_VERSION",
    "TOPIC_REDUCE_PROMPT_VERSION",
    "CONTENT_TYPES",
    "MAX_OUTPUT_PARAGRAPH_CHARS",
    "MAX_RAW_GROUP_CHARS",
    "MAX_RAW_GROUP_SECONDS",
    "MAX_SEGMENTS_PER_GROUP",
    "MeetingRecordCleanupService",
    "build_cleanup_chunks",
    "build_cleanup_prompt",
    "build_topic_reduce_prompt",
    "build_fallback_topics",
    "reuse_existing_topics",
    "cleanup_failure_paragraph",
    "cleanup_noise_paragraph",
    "validate_cleanup_result",
    "validate_topic_reduce_result",
]

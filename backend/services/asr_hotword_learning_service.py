"""Learn trusted ASR terms from meetings without reinforcing recognition errors."""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from datetime import datetime
from collections import Counter
from typing import Any

from backend.config import ASR_LEARNED_HOTWORDS_DB
from backend.db import _db_load_transcripts_for_meeting, _load_meetings, _safe_meeting_id


_LOCK = threading.RLock()
_SPLIT_RE = re.compile(r"[\s，,、；;：:。.!?！？（）()【】\[\]《》\"'‘’/\\]+")
_GENERIC_TERMS = {
    "会议", "议题", "项目", "讨论", "汇报", "事项", "普通会议", "临时议题",
    "会议纪要", "待确认议题", "系统讨论", "本地测试", "当前用户",
}
_KNOWN_ACRONYMS = {"AI", "ASR", "GPT", "PPT", "PDF", "CAD", "OCR", "LLM", "DeepSeek", "Qwen"}
_CANDIDATE_STOP = {
    "这个", "那个", "我们", "你们", "他们", "就是", "然后", "因为", "所以", "现在", "已经",
    "可以", "还是", "一个", "一下", "什么", "没有", "不是", "如果", "但是", "可能", "需要",
}


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _empty_store() -> dict[str, Any]:
    return {"version": 1, "updatedAt": "", "terms": [], "corrections": [], "candidates": []}


def _load_store() -> dict[str, Any]:
    try:
        data = json.loads(ASR_LEARNED_HOTWORDS_DB.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return {**_empty_store(), **data}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return _empty_store()


def _save_store(data: dict[str, Any]) -> None:
    ASR_LEARNED_HOTWORDS_DB.parent.mkdir(parents=True, exist_ok=True)
    data["updatedAt"] = _now()
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    fd, temporary = tempfile.mkstemp(
        prefix=".learned_hotwords_", suffix=".json", dir=str(ASR_LEARNED_HOTWORDS_DB.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, ASR_LEARNED_HOTWORDS_DB)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _clean_term(value: Any) -> str:
    value = re.sub(r"\.(docx?|xlsx?|pptx?|pdf|txt|md)$", "", str(value or ""), flags=re.I)
    value = re.sub(r"^\d+[、.．)）\s]+", "", value).strip(" -—_：:，,。")
    return value


def _term_parts(value: Any) -> list[str]:
    text = _clean_term(value)
    parts = [text] if 2 <= len(text) <= 32 else []
    parts.extend(_clean_term(part) for part in _SPLIT_RE.split(text))
    result: list[str] = []
    for part in parts:
        if not (2 <= len(part) <= 24) or part in _GENERIC_TERMS or part.isdigit():
            continue
        if re.fullmatch(r"20\d{2}年?\d{0,2}月?\d{0,2}日?", part):
            continue
        if re.fullmatch(r"20\d{2}年\d{1,2}月\d{1,2}日会议", part):
            continue
        if part not in result:
            result.append(part)
    return result


def _meeting_scope(meeting: dict[str, Any]) -> dict[str, str]:
    return {
        "project": str(meeting.get("project") or "").strip(),
        "meetingType": str(meeting.get("type") or meeting.get("meetingType") or "").strip(),
    }


def _trusted_meeting_terms(meeting: dict[str, Any]) -> list[tuple[str, str]]:
    values: list[tuple[Any, str]] = [
        (meeting.get("title"), "meeting-title"),
        (meeting.get("project"), "project"),
        (meeting.get("agenda"), "agenda"),
    ]
    for agenda in meeting.get("agendaDrafts") or []:
        if isinstance(agenda, dict):
            values.extend(((agenda.get("title"), "agenda-title"), (agenda.get("project"), "agenda-project")))
    for material in meeting.get("materials") or []:
        values.append(((material.get("name") if isinstance(material, dict) else material), "material-name"))
    result: list[tuple[str, str]] = []
    for value, source in values:
        result.extend((term, source) for term in _term_parts(value))
    return list(dict.fromkeys(result))


def _upsert_term(
    store: dict[str, Any], word: str, meeting_id: str, scope: dict[str, str], source: str,
    confidence: float = 0.9, approved: bool = True,
) -> None:
    terms = store.setdefault("terms", [])
    row = next(
        (item for item in terms if item.get("word") == word and item.get("project", "") == scope["project"]),
        None,
    )
    if row is None:
        row = {
            "word": word, "project": scope["project"], "meetingType": scope["meetingType"],
            "meetingIds": [], "sources": [], "occurrences": 0, "confidence": confidence,
            "approved": approved, "enabled": True, "updatedAt": "",
        }
        terms.append(row)
    if meeting_id not in row["meetingIds"]:
        row["meetingIds"].append(meeting_id)
    if source not in row["sources"]:
        row["sources"].append(source)
    row["occurrences"] = max(int(row.get("occurrences") or 0), len(row["meetingIds"]))
    row["confidence"] = max(float(row.get("confidence") or 0), confidence)
    row["approved"] = bool(row.get("approved")) or approved
    row["updatedAt"] = _now()


def _upsert_correction(
    store: dict[str, Any], wrong: str, right: str, meeting_id: str, scope: dict[str, str]
) -> None:
    if wrong == right or not (1 <= len(wrong) <= 24 and 2 <= len(right) <= 24):
        return
    rows = store.setdefault("corrections", [])
    row = next(
        (item for item in rows if item.get("wrong") == wrong and item.get("right") == right
         and item.get("project", "") == scope["project"]),
        None,
    )
    if row is None:
        row = {
            "wrong": wrong, "right": right, "project": scope["project"],
            "meetingType": scope["meetingType"], "meetingIds": [], "source": "signed-correction",
            "confidence": 1.0, "approved": True, "enabled": True, "updatedAt": "",
        }
        rows.append(row)
    if meeting_id not in row["meetingIds"]:
        row["meetingIds"].append(meeting_id)
    row["updatedAt"] = _now()


def learn_meeting_context(meeting_id: str) -> dict[str, Any]:
    """Persist authoritative meeting metadata as scoped active hotwords."""
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    scope = _meeting_scope(meeting)
    with _LOCK:
        store = _load_store()
        for word, source in _trusted_meeting_terms(meeting):
            _upsert_term(store, word, safe_id, scope, source)
        _update_transcript_candidates(store, safe_id, scope)
        _save_store(store)
    return learned_hotwords_for_meeting(safe_id)


def _aligned_alias(original: str, corrected: str, canonical: str) -> str:
    """Return a same-position alias only when alignment is unambiguous."""
    index = corrected.find(canonical)
    if index < 0 or canonical in original or index + len(canonical) > len(original):
        return ""
    alias = original[index:index + len(canonical)].strip()
    if alias == canonical or not alias or any(char in alias for char in "，。！？；\n"):
        return ""
    return alias


def learn_signed_correction(meeting_id: str, original: str, corrected: str) -> dict[str, Any]:
    """Learn only from a human-signed correction, never from raw ASR alone."""
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    scope = _meeting_scope(meeting)
    trusted = {word for word, _ in _trusted_meeting_terms(meeting)}
    trusted.update(term for term in _KNOWN_ACRONYMS if term in corrected)
    with _LOCK:
        store = _load_store()
        for canonical in sorted(trusted, key=len, reverse=True):
            if canonical not in corrected:
                continue
            _upsert_term(store, canonical, safe_id, scope, "signed-correction", confidence=1.0)
            alias = _aligned_alias(original, corrected, canonical)
            if alias:
                _upsert_correction(store, alias, canonical, safe_id, scope)
        _save_store(store)
    return learned_hotwords_for_meeting(safe_id)


def _records_text(records: dict[str, Any]) -> str:
    values: list[str] = []
    for field in ("summary", "minutes", "decisions", "risks", "disclosures", "todos"):
        rows = records.get(field) or []
        rows = rows if isinstance(rows, list) else [rows]
        for row in rows:
            if isinstance(row, str):
                values.append(row)
                continue
            if not isinstance(row, dict):
                continue
            for key in ("content", "text", "title", "agenda", "decision", "task", "description", "summary"):
                if row.get(key):
                    values.append(str(row[key]))
            values.extend(str(item) for item in (row.get("keyPoints") or row.get("key_points") or []) if item)
    return "\n".join(values)


def _structured_record_corrections(records: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in records.get("proofreadLog") or []:
        if not isinstance(item, dict):
            continue
        nested = item.get("corrections") if isinstance(item.get("corrections"), list) else [item]
        for row in nested:
            if not isinstance(row, dict):
                continue
            wrong = str(row.get("original") or row.get("wrong") or row.get("raw") or "").strip()
            right = str(row.get("fixed") or row.get("corrected") or row.get("right") or "").strip()
            try:
                confidence = float(row.get("confidence", 0.9))
            except (TypeError, ValueError):
                confidence = 0.0
            if wrong and right and wrong != right:
                result.append({"wrong": wrong, "right": right, "confidence": confidence})
    return result


def learn_from_formal_records(
    meeting_id: str,
    records: dict[str, Any],
    source_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Write verified formal-record corrections back to glossary and ASR state.

    Formal prose is often a summary rather than a sentence-level rewrite, so
    free-form diffs are never treated as corrections. Only structured
    proofread pairs that are present on both evidence sides are auto-approved.
    """
    from backend.services.meeting_proofread_service import merge_glossary_entries

    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    raw_text = "\n".join(
        str(row.get("rawText") or row.get("text") or row.get("transcript") or "")
        for row in source_rows if isinstance(row, dict)
    )
    formal_text = _records_text(records)
    scope = _meeting_scope(meeting)
    approved: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    with _LOCK:
        store = _load_store()
        for pair in _structured_record_corrections(records):
            valid = (
                pair["confidence"] >= 0.85
                and pair["wrong"] in raw_text
                and pair["right"] in formal_text
                and 1 <= len(pair["wrong"]) <= 24
                and 2 <= len(pair["right"]) <= 24
            )
            if valid:
                _upsert_term(store, pair["right"], safe_id, scope, "formal-record-proofread", confidence=pair["confidence"])
                _upsert_correction(store, pair["wrong"], pair["right"], safe_id, scope)
                approved.append(pair)
            else:
                rejected.append(pair)
        _save_store(store)
    if approved:
        merge_glossary_entries([
            {
                "term": pair["right"],
                "aliases": [pair["wrong"]],
                "category": "会议自学习",
                "reason": f"正式纪要与原始 ASR 对比（{safe_id}）",
                "confidence": pair["confidence"],
            }
            for pair in approved
        ])
    return {"approved": approved, "candidates": rejected, "approvedCount": len(approved)}


def _scope_matches(row: dict[str, Any], meeting: dict[str, Any]) -> bool:
    project = str(row.get("project") or "")
    meeting_type = str(row.get("meetingType") or "")
    if project:
        return project == str(meeting.get("project") or "")
    return not meeting_type or meeting_type == str(meeting.get("type") or meeting.get("meetingType") or "")


def _update_transcript_candidates(store: dict[str, Any], meeting_id: str, scope: dict[str, str]) -> None:
    """Collect repeated raw phrases as disabled candidates for later review."""
    loaded = _db_load_transcripts_for_meeting(meeting_id)
    chunks = []
    for row in loaded.get("transcripts", []):
        if not row.get("isFinal", True):
            continue
        chunks.extend(re.findall(r"[\u4e00-\u9fff]{4,24}", str(row.get("transcript") or "")))
    counts: Counter[str] = Counter()
    for chunk in chunks:
        for size in (4, 5, 6):
            for index in range(max(0, len(chunk) - size + 1)):
                phrase = chunk[index:index + size]
                if not any(stop in phrase for stop in _CANDIDATE_STOP):
                    counts[phrase] += 1
    candidates = store.setdefault("candidates", [])
    for word, count in counts.most_common(30):
        if count < 3:
            break
        row = next(
            (item for item in candidates if item.get("word") == word and item.get("project", "") == scope["project"]),
            None,
        )
        if row is None:
            row = {
                "word": word, "project": scope["project"], "meetingType": scope["meetingType"],
                "meetingIds": [], "occurrences": 0, "confidence": 0.4, "approved": False,
                "enabled": False, "source": "repeated-transcript-candidate", "updatedAt": "",
            }
            candidates.append(row)
        if meeting_id not in row["meetingIds"]:
            row["meetingIds"].append(meeting_id)
        row["occurrences"] = max(int(row.get("occurrences") or 0), count)
        row["updatedAt"] = _now()


def learned_hotwords_for_context(meeting: dict[str, Any]) -> list[str]:
    with _LOCK:
        store = _load_store()
    return [
        str(row.get("word")) for row in store.get("terms", [])
        if row.get("enabled", True) and row.get("approved") and _scope_matches(row, meeting)
    ]


def learned_corrections_for_context(meeting: dict[str, Any]) -> dict[str, str]:
    with _LOCK:
        store = _load_store()
    return {
        str(row.get("wrong")): str(row.get("right")) for row in store.get("corrections", [])
        if row.get("enabled", True) and row.get("approved") and _scope_matches(row, meeting)
    }


def learned_hotwords_for_meeting(meeting_id: str) -> dict[str, Any]:
    safe_id = _safe_meeting_id(meeting_id)
    meeting = _load_meetings().get(safe_id)
    if not meeting:
        raise KeyError("会议不存在")
    with _LOCK:
        store = _load_store()
    return {
        "meetingId": safe_id,
        "hotwords": [row for row in store.get("terms", []) if _scope_matches(row, meeting)],
        "corrections": [row for row in store.get("corrections", []) if _scope_matches(row, meeting)],
        "candidates": [row for row in store.get("candidates", []) if _scope_matches(row, meeting)],
        "updatedAt": store.get("updatedAt", ""),
    }

"""Meeting transcript proofread helpers.

The proofread layer is deliberately independent from the HTTP and persistence
layers.  It exposes dictionary candidates, an optional one-pass LLM callback,
and an auditable ``rawText``/``correctedText`` pair.  A glossary is a source of
candidates only; it is never used for a blind global replacement.

The callback contract is intentionally small so the records pipeline can use
the local Qwen client without making this service depend on an LLM SDK::

    def corrector(text, candidates, context) -> dict | str:
        return {
            "correctedText": "...",
            "corrections": [{"original": "引赛", "fixed": "引债", "reason": "LLM"}],
        }

All returned payloads are JSON serialisable and can be stored in generated
records or a JSON audit log without a schema migration.
"""

from __future__ import annotations

import copy
import difflib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence


PROOFREAD_VERSION = "meeting-proofread-v1"
DEFAULT_GLOSSARY_PATH = Path(__file__).resolve().parents[2] / "data" / "glossary.json"
_CORRECTOR = Callable[[str, list[dict[str, Any]], Mapping[str, Any]], Any]


class ProofreadRequiredError(ValueError):
    """Raised when a formal document is requested before proofreading passes."""


def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalise_aliases(value: Any) -> list[str]:
    if isinstance(value, str):
        return [_as_text(value)] if _as_text(value) else []
    if not isinstance(value, (list, tuple, set)):
        return []
    result: list[str] = []
    for item in value:
        text = _as_text(item)
        if text and text not in result:
            result.append(text)
    return result


def _normalise_entry(entry: Any, canonical: str = "") -> dict[str, Any] | None:
    if isinstance(entry, str):
        term = _as_text(entry)
        return {"term": term, "aliases": [], "category": "", "reason": "领域词典"} if term else None
    if not isinstance(entry, Mapping):
        return None
    term = _as_text(entry.get("term") or entry.get("canonical") or entry.get("name") or canonical)
    if not term:
        return None
    aliases = _normalise_aliases(entry.get("aliases") or entry.get("variants") or entry.get("wrong"))
    aliases = [item for item in aliases if item != term]
    result: dict[str, Any] = {
        "term": term,
        "aliases": aliases,
        "category": _as_text(entry.get("category")),
        "reason": _as_text(entry.get("reason")) or "领域词典候选",
    }
    if entry.get("confidence") is not None:
        try:
            result["confidence"] = max(0.0, min(1.0, float(entry["confidence"])))
        except (TypeError, ValueError):
            pass
    return result


def normalise_glossary(payload: Any) -> list[dict[str, Any]]:
    """Normalise supported glossary JSON shapes while preserving entry order."""

    if isinstance(payload, Mapping):
        if isinstance(payload.get("terms"), list):
            raw_entries: Iterable[Any] = payload["terms"]
        else:
            # Also support the compact ``{"引债": ["引赛"]}`` shape.  Keep
            # the mapping key as the canonical term when the value is itself
            # a mapping; otherwise ``{"aliases": value, "term": key}`` is
            # sufficient.  Losing the key here silently turns a valid
            # dictionary into an empty glossary entry.
            raw_entries = []
            for key, value in payload.items():
                if key in {"version", "updatedAt", "metadata"}:
                    continue
                if isinstance(value, Mapping):
                    item = dict(value)
                    item.setdefault("term", key)
                    raw_entries.append(item)
                else:
                    raw_entries.append({"aliases": value, "term": key})
    elif isinstance(payload, list):
        raw_entries = payload
    else:
        raw_entries = []

    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_entries:
        item = _normalise_entry(raw)
        if not item or item["term"] in seen:
            continue
        seen.add(item["term"])
        result.append(item)
    return result


def load_glossary(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Load a glossary without creating or modifying files."""

    glossary_path = Path(path) if path else DEFAULT_GLOSSARY_PATH
    if not glossary_path.exists():
        return []
    try:
        payload = json.loads(glossary_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return []
    return normalise_glossary(payload)


def merge_glossary_entries(
    entries: Sequence[Mapping[str, Any] | str],
    path: str | Path | None = None,
) -> list[dict[str, Any]]:
    """Append missing glossary entries, preserving an existing file's content.

    This function is explicit rather than being called during proofread.  The
    records pipeline can opt into glossary curation after a human review, and
    existing user entries are never overwritten.
    """

    glossary_path = Path(path) if path else DEFAULT_GLOSSARY_PATH
    merged = load_glossary(glossary_path)
    by_term = {item["term"]: item for item in merged}
    for raw in entries:
        item = _normalise_entry(raw)
        if not item:
            continue
        current = by_term.get(item["term"])
        if current is None:
            merged.append(item)
            by_term[item["term"]] = item
            continue
        aliases = list(current.get("aliases") or [])
        for alias in item.get("aliases") or []:
            if alias not in aliases and alias != item["term"]:
                aliases.append(alias)
        current["aliases"] = aliases
        for key in ("category", "reason", "confidence"):
            if not current.get(key) and item.get(key):
                current[key] = item[key]

    glossary_path.parent.mkdir(parents=True, exist_ok=True)
    glossary_path.write_text(
        json.dumps({"version": 1, "terms": merged}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return merged


def find_dictionary_candidates(
    text: str,
    glossary: Sequence[Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Return possible domain-term corrections with offsets.

    Candidates are suggestions only.  The caller must confirm them through an
    LLM or a human before they can enter an official document.
    """

    raw = _as_text(text)
    if not raw:
        return []
    entries = glossary if glossary is not None else load_glossary()
    candidates: list[dict[str, Any]] = []
    for raw_entry in entries:
        entry = _normalise_entry(raw_entry)
        if not entry:
            continue
        for alias in entry.get("aliases") or []:
            if not alias:
                continue
            for match in re.finditer(re.escape(alias), raw, flags=re.IGNORECASE):
                candidate = {
                    "original": match.group(0),
                    "suggested": entry["term"],
                    "term": entry["term"],
                    "start": match.start(),
                    "end": match.end(),
                    "category": entry.get("category", ""),
                    "reason": entry.get("reason") or "领域词典候选",
                    "confidence": entry.get("confidence", 0.7),
                }
                candidates.append(candidate)
    candidates.sort(key=lambda item: (int(item["start"]), int(item["end"])))
    return candidates


def _normalise_correction(raw: Any, text: str, source: str = "LLM") -> dict[str, Any] | None:
    if not isinstance(raw, Mapping):
        return None
    original = _as_text(raw.get("original") or raw.get("raw") or raw.get("before"))
    fixed = _as_text(raw.get("fixed") or raw.get("corrected") or raw.get("after"))
    if not original or not fixed or original == fixed or original not in text:
        return None
    result: dict[str, Any] = {
        "original": original,
        "fixed": fixed,
        "reason": _as_text(raw.get("reason")) or source,
        "source": _as_text(raw.get("source")) or source,
    }
    if raw.get("confidence") is not None:
        try:
            result["confidence"] = max(0.0, min(1.0, float(raw["confidence"])))
        except (TypeError, ValueError):
            pass
    if raw.get("start") is not None:
        try:
            result["start"] = int(raw["start"])
        except (TypeError, ValueError):
            pass
    if raw.get("end") is not None:
        try:
            result["end"] = int(raw["end"])
        except (TypeError, ValueError):
            pass
    return result


def apply_confirmed_corrections(text: str, corrections: Sequence[Mapping[str, Any]]) -> str:
    """Apply only explicit corrections, from right to left for stable offsets."""

    corrected = _as_text(text)
    replacements: list[tuple[int, int, str]] = []
    cursor = len(corrected)
    for raw in corrections:
        original = _as_text(raw.get("original"))
        fixed = _as_text(raw.get("fixed"))
        if not original or not fixed or original == fixed:
            continue
        start = raw.get("start")
        end = raw.get("end")
        if isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(corrected):
            if corrected[start:end] == original:
                replacements.append((start, end, fixed))
                cursor = start
                continue
        position = corrected.rfind(original, 0, cursor)
        if position >= 0:
            replacements.append((position, position + len(original), fixed))
            cursor = position
    for start, end, fixed in sorted(replacements, key=lambda item: item[0], reverse=True):
        corrected = corrected[:start] + fixed + corrected[end:]
    return corrected


def _derive_corrections(raw: str, corrected: str, source: str = "LLM") -> list[dict[str, Any]]:
    if raw == corrected:
        return []
    matcher = difflib.SequenceMatcher(a=raw, b=corrected, autojunk=False)
    result: list[dict[str, Any]] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        original = raw[i1:i2]
        fixed = corrected[j1:j2]
        if original and fixed:
            result.append({"original": original, "fixed": fixed, "reason": source, "source": source, "start": i1, "end": i2})
    return result


def _parse_corrector_result(result: Any, raw: str) -> tuple[str, list[dict[str, Any]], str]:
    if isinstance(result, str):
        return _as_text(result), _derive_corrections(raw, _as_text(result)), "LLM"
    if not isinstance(result, Mapping):
        return raw, [], "LLM"
    corrected = _as_text(result.get("correctedText") or result.get("corrected_text") or result.get("text")) or raw
    source = _as_text(result.get("source")) or "LLM"
    raw_corrections = result.get("corrections") if isinstance(result.get("corrections"), list) else []
    corrections = [item for item in (_normalise_correction(value, raw, source) for value in raw_corrections) if item]
    if not corrections:
        corrections = _derive_corrections(raw, corrected, source)
    # A callback can return a corrected text but omit a correction log.  The
    # diff above keeps the audit trail complete; it never invents a replacement.
    corrected = apply_confirmed_corrections(raw, corrections) if corrections else corrected
    return corrected, corrections, source


def proofread_text(
    text: str,
    *,
    glossary: Sequence[Mapping[str, Any]] | None = None,
    llm_corrector: _CORRECTOR | None = None,
    context: Mapping[str, Any] | None = None,
    require_llm: bool = True,
) -> dict[str, Any]:
    """Proofread one text value and return an auditable result."""

    raw = _as_text(text)
    candidates = find_dictionary_candidates(raw, glossary)
    corrected = raw
    corrections: list[dict[str, Any]] = []
    source = "dictionary"
    callback_error = ""
    if llm_corrector is not None:
        try:
            corrected, corrections, source = _parse_corrector_result(
                llm_corrector(raw, candidates, context or {}), raw,
            )
        except Exception as exc:  # callback failures are represented, not hidden
            callback_error = str(exc)
    unresolved = [candidate for candidate in candidates if not any(
        item.get("original") == candidate.get("original") and item.get("fixed") == candidate.get("suggested")
        for item in corrections
    )]
    if callback_error:
        status = "failed"
    elif require_llm and llm_corrector is None:
        status = "needs_review" if candidates else "not_run"
    elif unresolved:
        status = "needs_review"
    else:
        status = "passed"
    result = {
        "rawText": raw,
        "correctedText": corrected,
        "dictionaryCandidates": candidates,
        "corrections": corrections,
        "proofreadPassed": status == "passed",
        "proofreadStatus": status,
        "proofreadVersion": PROOFREAD_VERSION,
        "proofreadSource": source if llm_corrector is not None else "dictionary-candidate",
        "reviewedAt": _now_text(),
    }
    if callback_error:
        result["error"] = callback_error
    if unresolved:
        result["unresolvedCandidates"] = unresolved
    return result


def _proofread_item_field(
    item: Mapping[str, Any],
    field: str,
    *,
    path: str,
    glossary: Sequence[Mapping[str, Any]] | None,
    llm_corrector: _CORRECTOR | None,
    context: Mapping[str, Any] | None,
    require_llm: bool,
) -> tuple[dict[str, Any], dict[str, Any]]:
    result = proofread_text(
        _as_text(item.get(field)), glossary=glossary, llm_corrector=llm_corrector,
        context={**(context or {}), "path": path, "field": field}, require_llm=require_llm,
    )
    updated = dict(item)
    if field == "content":
        updated["rawContent"] = result["rawText"]
        updated["correctedContent"] = result["correctedText"]
        updated[field] = result["correctedText"]
    elif field == "task":
        updated["rawTask"] = result["rawText"]
        updated["correctedTask"] = result["correctedText"]
        updated[field] = result["correctedText"]
    else:
        updated[f"raw{field[0].upper()}{field[1:]}"] = result["rawText"]
        updated[f"corrected{field[0].upper()}{field[1:]}"] = result["correctedText"]
        updated[field] = result["correctedText"]
    updated["proofread"] = result
    return updated, {"path": path, **result}


def proofread_records(
    records: Mapping[str, Any],
    *,
    glossary: Sequence[Mapping[str, Any]] | None = None,
    llm_corrector: _CORRECTOR | None = None,
    context: Mapping[str, Any] | None = None,
    require_llm: bool = True,
) -> dict[str, Any]:
    """Proofread distilled record fields while preserving raw evidence fields."""

    output = copy.deepcopy(dict(records or {}))
    log: list[dict[str, Any]] = []
    passed = True

    def process_list(field: str, text_fields: Sequence[str]) -> None:
        nonlocal passed
        values = output.get(field)
        if not isinstance(values, list):
            return
        processed: list[Any] = []
        for index, value in enumerate(values):
            path = f"{field}[{index}]"
            if isinstance(value, str):
                result = proofread_text(value, glossary=glossary, llm_corrector=llm_corrector,
                                        context={**(context or {}), "path": path}, require_llm=require_llm)
                processed.append(result["correctedText"])
                log.append({"path": path, **result})
                passed = passed and bool(result["proofreadPassed"])
                continue
            if not isinstance(value, Mapping):
                processed.append(value)
                continue
            item = dict(value)
            chosen = next((field_name for field_name in text_fields if _as_text(item.get(field_name))), "")
            if chosen:
                item, result = _proofread_item_field(
                    item, chosen, path=path, glossary=glossary, llm_corrector=llm_corrector,
                    context=context, require_llm=require_llm,
                )
                log.append(result)
                passed = passed and bool(result["proofreadPassed"])
            # keyPoints are distilled content; evidence/quotes are intentionally
            # excluded because they must remain verbatim audit anchors.
            if isinstance(item.get("keyPoints"), list):
                raw_points = list(item["keyPoints"])
                corrected_points: list[Any] = []
                point_log: list[dict[str, Any]] = []
                for point_index, point in enumerate(raw_points):
                    if not isinstance(point, str):
                        corrected_points.append(point)
                        continue
                    result = proofread_text(point, glossary=glossary, llm_corrector=llm_corrector,
                                            context={**(context or {}), "path": f"{path}.keyPoints[{point_index}]"},
                                            require_llm=require_llm)
                    corrected_points.append(result["correctedText"])
                    point_log.append(result)
                    log.append({"path": f"{path}.keyPoints[{point_index}]", **result})
                    passed = passed and bool(result["proofreadPassed"])
                item["rawKeyPoints"] = raw_points
                item["keyPoints"] = corrected_points
                item["proofreadKeyPoints"] = point_log
            processed.append(item)
        output[field] = processed

    process_list("summary", ("content", "text", "summary"))
    process_list("minutes", ("content", "summary", "title", "agenda"))
    process_list("decisions", ("content", "title"))
    process_list("risks", ("content", "description", "title"))
    process_list("risks_disclosures", ("content", "description", "title"))
    process_list("disclosures", ("content", "description", "title"))
    process_list("todos", ("task", "content", "title"))

    output["proofreadLog"] = log
    output["proofreadPassed"] = bool(passed and (bool(log) or not require_llm))
    output["proofreadStatus"] = "passed" if output["proofreadPassed"] else ("not_run" if not log else "needs_review")
    output["proofreadVersion"] = PROOFREAD_VERSION
    output["proofreadAt"] = _now_text()
    return output


def proofread_chronicle(
    chronicle: Sequence[Mapping[str, Any]],
    *,
    glossary: Sequence[Mapping[str, Any]] | None = None,
    llm_corrector: _CORRECTOR | None = None,
    context: Mapping[str, Any] | None = None,
    require_llm: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Attach correction traces to evidence rows without replacing raw text."""

    rows: list[dict[str, Any]] = []
    log: list[dict[str, Any]] = []
    for index, raw_row in enumerate(chronicle or []):
        row = dict(raw_row)
        raw_text = _as_text(row.get("content") or row.get("text"))
        result = proofread_text(
            raw_text, glossary=glossary, llm_corrector=llm_corrector,
            context={**(context or {}), "path": f"chronicle[{index}]"}, require_llm=require_llm,
        )
        # Evidence remains verbatim.  The corrected form is an adjacent field.
        row["rawContent"] = raw_text
        row["correctedContent"] = result["correctedText"]
        row["proofread"] = result
        rows.append(row)
        log.append({"path": f"chronicle[{index}]", **result})
    return rows, log


def records_are_proofread(records: Mapping[str, Any]) -> bool:
    """Return whether a records payload is eligible for a formal document."""

    return bool(records and records.get("proofreadPassed") is True)


__all__ = [
    "DEFAULT_GLOSSARY_PATH",
    "PROOFREAD_VERSION",
    "ProofreadRequiredError",
    "apply_confirmed_corrections",
    "find_dictionary_candidates",
    "load_glossary",
    "merge_glossary_entries",
    "normalise_glossary",
    "proofread_chronicle",
    "proofread_records",
    "proofread_text",
    "records_are_proofread",
]

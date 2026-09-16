"""Small, deterministic coordination primitives for the ASR 2-pass path."""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any, Awaitable, Callable


@dataclass
class OrderedFinalBuffer:
    """Buffer concurrently completed finals and expose them in sentence order."""

    next_seq: int = 1
    pending: dict[int, dict[str, Any]] = field(default_factory=dict)
    committed_ids: set[str] = field(default_factory=set)

    def add(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        seq = int(payload.get("sentenceSeq") or 0)
        sentence_id = str(payload.get("sentenceId") or "")
        if seq <= 0 or (sentence_id and sentence_id in self.committed_ids):
            return []
        self.pending.setdefault(seq, payload)
        ready: list[dict[str, Any]] = []
        while self.next_seq in self.pending:
            item = self.pending.pop(self.next_seq)
            item_id = str(item.get("sentenceId") or "")
            if not item_id or item_id not in self.committed_ids:
                ready.append(item)
                if item_id:
                    self.committed_ids.add(item_id)
            self.next_seq += 1
        return ready


def join_continuation_text(left: str, right: str, max_overlap: int = 24) -> str:
    """Join forced ASR sentence fragments without repeating boundary text."""

    prefix = str(left or "").strip()
    suffix = str(right or "").strip()
    if not prefix:
        return suffix
    if not suffix:
        return prefix
    overlap_limit = min(len(prefix), len(suffix), max(1, int(max_overlap)))
    for size in range(overlap_limit, 0, -1):
        if prefix[-size:] == suffix[:size]:
            return prefix + suffix[size:]
    # The punctuation model may finalize the forced fragment with a full stop,
    # while the next fragment repeats its last word ("全程。" + "全程实时").
    # Treat that punctuation as an internal boundary, not a semantic sentence end.
    boundary_punctuation = "，。！？、,.!?;；:："
    prefix_core = prefix.rstrip(boundary_punctuation).rstrip()
    suffix_core = suffix.lstrip(boundary_punctuation).lstrip()
    overlap_limit = min(len(prefix_core), len(suffix_core), max(1, int(max_overlap)))
    for size in range(overlap_limit, 1, -1):
        if prefix_core[-size:] == suffix_core[:size]:
            return prefix_core + suffix_core[size:]
    if prefix[-1].isascii() and prefix[-1].isalnum() and suffix[0].isascii() and suffix[0].isalnum():
        return f"{prefix} {suffix}"
    return prefix + suffix


@dataclass
class ContinuationFinalBuffer:
    """Collapse internal forced splits into one durable logical utterance."""

    held: dict[str, Any] | None = None

    def add(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        current = dict(payload)
        current["forcedSplit"] = bool(current.get("forcedSplit"))
        if self.held is None:
            if current["forcedSplit"]:
                self.held = current
                self.held["continuationSentenceIds"] = [
                    str(current.get("sentenceId") or "")
                ]
                return []
            return [current]

        held = self.held
        held["newText"] = join_continuation_text(
            str(held.get("newText") or ""), str(current.get("newText") or "")
        )
        held["onlineText"] = join_continuation_text(
            str(held.get("onlineText") or ""), str(current.get("onlineText") or "")
        )
        held["endMs"] = max(int(held.get("endMs") or 0), int(current.get("endMs") or 0))
        held["corrected"] = bool(held.get("corrected") or current.get("corrected"))
        if current.get("backend"):
            held["backend"] = current["backend"]
        sentence_ids = held.setdefault("continuationSentenceIds", [])
        current_id = str(current.get("sentenceId") or "")
        if current_id and current_id not in sentence_ids:
            sentence_ids.append(current_id)
        held["continued"] = True
        held["forcedSplit"] = bool(current["forcedSplit"])
        if current["forcedSplit"]:
            return []
        self.held = None
        return [held]

    def flush(self) -> list[dict[str, Any]]:
        if self.held is None:
            return []
        payload = self.held
        self.held = None
        payload["forcedSplit"] = False
        payload["continued"] = True
        return [payload]


def plausible_offline_review(online_text: str, reviewed_text: str, context: str = "") -> bool:
    """Reject context echoes and implausible expansions from the offline model."""

    online = str(online_text or "").strip()
    reviewed = str(reviewed_text or "").strip()
    reference = str(context or "").strip()
    if not reviewed:
        return False
    if len(reviewed) > max(240, len(online) * 4 + 40):
        return False
    if len(reviewed) >= 20 and reviewed in reference:
        return False
    if reviewed.startswith(("会议名称：", "当前议题：", "参会人及术语：")):
        return False
    return True


_FILLER_TEXTS = {
    "嗯", "嗯嗯", "啊", "哎", "呃", "哦", "好", "好的", "是", "对", "对吧",
    "嗯哎", "哎嗯", "好好", "继续", "继续吧",
}

_ALLOWED_LATIN_TERMS = {
    "AI", "API", "APP", "ASR", "CPU", "DOCX", "FUNASR", "GPU", "H5",
    "HTTP", "HTTPS", "LLM", "NGINX", "OCR", "PC", "QWEN", "WHISPER",
}


def plausible_chinese_meeting_text(value: str) -> bool:
    """拦截短噪声、外语幻觉和循环输出，保留正常中文与常见缩写。"""

    text = re.sub(r"[\s，。！？、,.!?;；:：'\"“”‘’()（）-]", "", str(value or ""))
    if not text or text in _FILLER_TEXTS:
        return False
    if re.search(r"[\u3040-\u30ff]", text):
        return False
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", text))
    latin_count = len(re.findall(r"[A-Za-z]", text))
    if cjk_count == 1 and latin_count == 0:
        return False
    if cjk_count == 0 and latin_count:
        latin_terms = {term.upper() for term in re.findall(r"[A-Za-z][A-Za-z0-9-]*", text)}
        return bool(latin_terms) and latin_terms.issubset(_ALLOWED_LATIN_TERMS)
    if latin_count > max(6, cjk_count * 2):
        return False
    if re.search(r"(.{1,8})\1\1", text, flags=re.IGNORECASE):
        return False
    return cjk_count > 0


async def review_with_fallback(
    offline_call: Callable[[], Awaitable[Any]],
    online_text: str,
    clean: Callable[[str], str],
    context: str = "",
) -> tuple[str, str, bool]:
    """Return a reviewed final, falling back to the online final on any error."""

    baseline = clean(online_text)
    try:
        reviewed = await offline_call()
        reviewed_text = clean(getattr(reviewed, "text", "") or "")
        if (
            plausible_offline_review(baseline, reviewed_text, context)
            and plausible_chinese_meeting_text(reviewed_text)
        ):
            return (
                reviewed_text,
                str(getattr(reviewed, "backend", "") or "qwen3-asr-1.7b"),
                reviewed_text != baseline,
            )
    except Exception:
        pass
    if plausible_chinese_meeting_text(baseline):
        return baseline, "paraformer-streaming", False
    return "", "filtered", False

"""实时转写服务：清洗、议题绑定、幂等和连续发言合并。"""

import difflib
import hashlib
import re
import uuid
from datetime import datetime, timedelta

from backend.config import APP_DB_LOCK
from backend.db import (
    _db_connect,
    _db_find_participant_row,
    _invalidate_transcripts_cache,
    _db_upsert_transcript,
    _init_app_db,
)
from backend.services.agenda_service import get_meeting_active_agenda, get_meeting_agenda


def record_owned_by(record: dict, user: dict, role: dict | None = None) -> bool:
    """Return whether a transcript/event belongs to the current recorder identity."""
    role = role or {}
    speaker = record.get("speaker") if isinstance(record.get("speaker"), dict) else {}
    user_ids = {
        str(value).strip()
        for value in (user.get("id"), role.get("userId"))
        if str(value or "").strip()
    }
    usernames = {
        str(value).strip().lower()
        for value in (user.get("username"), role.get("username"))
        if str(value or "").strip()
    }
    display_names = {
        str(value).strip()
        for value in (user.get("name"), role.get("displayName"))
        if str(value or "").strip()
    }
    record_user_ids = {
        str(value).strip()
        for value in (record.get("speakerUserId"), speaker.get("userId"))
        if str(value or "").strip()
    }
    record_usernames = {
        str(value).strip().lower()
        for value in (record.get("username"), speaker.get("username"))
        if str(value or "").strip()
    }
    record_names = {
        str(value).strip()
        for value in (record.get("speakerName"), speaker.get("displayName"), speaker.get("name"))
        if str(value or "").strip()
    }
    return bool(
        user_ids.intersection(record_user_ids)
        or usernames.intersection(record_usernames)
        or display_names.intersection(record_names)
    )


def clean_asr_text(text: str) -> str:
    if not text or not text.strip():
        return ""
    text = re.sub(r"([嗯啊哎哦呢吧啦哈嘿哟哇]){2,}", r"\1", text)
    text = re.sub(r"([。.？?！!，,、]){2,}", r"\1", text)
    text = re.sub(r"\s+", " ", text)
    return text.replace("..", ".").replace("。。", "。").replace("？？", "？").replace("！！", "！").strip()


def resolve_agenda_id(meeting_id: str, requested_agenda_id: str = "") -> str:
    active = get_meeting_active_agenda(meeting_id)
    active_id = (active or {}).get("id") or ""
    requested = (requested_agenda_id or "").strip()
    if requested:
        if not get_meeting_agenda(meeting_id, requested):
            raise ValueError("指定的议题不属于当前会议")
        return requested
    return active_id


def recent_transcripts(meeting_id: str, username: str, seconds: int = 30, limit: int = 50) -> list[dict]:
    _init_app_db()
    cutoff = (datetime.now() - timedelta(seconds=seconds)).strftime("%Y-%m-%d %H:%M:%S")
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                "SELECT id, transcript, server_time, username FROM meeting_transcripts "
                "WHERE meeting_id = ? AND server_time >= ? ORDER BY server_time DESC LIMIT ?",
                (meeting_id, cutoff, limit),
            ).fetchall()
    return [{"id": row[0], "transcript": row[1], "serverTime": row[2], "username": row[3]} for row in rows]


def _same_recent_text(previous: dict, current_text: str, now: str) -> bool:
    previous_time = previous.get("serverTime") or ""
    try:
        delta = (datetime.strptime(now, "%Y-%m-%d %H:%M:%S") - datetime.strptime(previous_time, "%Y-%m-%d %H:%M:%S")).total_seconds()
    except Exception:
        return False
    if delta < 0 or delta > 5:
        return False
    return re.sub(r"\s+", "", str(previous.get("transcript") or "")) == re.sub(r"\s+", "", current_text)


def build_record(user: dict, body, meeting_id: str, transcript: str, agenda_id: str, now: str) -> dict:
    from backend.deps import _resolve_meeting_role

    role = _resolve_meeting_role(user)
    participant_id = _db_find_participant_row(meeting_id, role.get("userId") or "") or ""
    speaker_name = getattr(body, "speaker_name", None) or role["displayName"]
    speaker_role = getattr(body, "speaker_role", None) or role["meetingRole"]
    speaker_dept = getattr(body, "speaker_dept", None) or role["dept"]
    sentence_id = str(getattr(body, "sentence_id", None) or "").strip()
    sentence_seq = max(0, int(getattr(body, "sentence_seq", None) or 0))
    start_ms = max(0, int(getattr(body, "start_ms", None) or 0))
    end_ms = max(start_ms, int(getattr(body, "end_ms", None) or start_ms))
    record_id = (
        f"tr_asr_{hashlib.sha256(f'{meeting_id}:{sentence_id}'.encode()).hexdigest()[:20]}"
        if sentence_id
        else f"tr_{uuid.uuid4().hex[:12]}"
    )
    return {
        "id": record_id,
        "meetingId": meeting_id,
        "meetingTitle": body.meeting_title,
        "agenda": body.agenda,
        "speakerName": speaker_name,
        "speakerRole": speaker_role,
        "speakerDept": speaker_dept,
        "seat": role["seat"],
        "username": role["username"],
        "transcript": transcript,
        "isFinal": body.is_final,
        "clientTime": body.client_time,
        "serverTime": now,
        "confidence": body.confidence if body.confidence is not None else 0.92,
        "source": "mobile-recorder",
        "speakerConfidence": body.speaker_confidence or 0,
        "identifiedBy": body.identified_by or "manual",
        "agendaId": agenda_id,
        "speakerUserId": role.get("userId") or "",
        "participantId": participant_id,
        "audioClientId": getattr(body, "audio_client_id", None) or "",
        "sentenceId": sentence_id,
        "sentenceSeq": sentence_seq,
        "start": start_ms / 1000,
        "end": end_ms / 1000,
        "startMs": start_ms,
        "endMs": end_ms,
    }


def persist_record(record: dict) -> tuple[dict, bool]:
    """写入转写；返回（最终记录、是否去重）。"""
    now = record["serverTime"]
    if record.get("sentenceId"):
        _init_app_db()
        with APP_DB_LOCK:
            with _db_connect() as conn:
                existing = conn.execute(
                    "SELECT id FROM meeting_transcripts WHERE id = ?",
                    (record["id"],),
                ).fetchone()
        if existing:
            return record, True
    recent = recent_transcripts(record["meetingId"], record["username"])
    if any(_same_recent_text(item, record["transcript"], now) for item in recent):
        return record, True

    previous = next(
        (
            item for item in recent
            if item.get("username") == record["username"]
            and (not record.get("speakerName") or item.get("speakerName") in {"", record.get("speakerName")})
        ),
        None,
    )
    # 最终发言是独立证据；只有非最终 ASR 增量允许合并/修订，避免把同秒内
    # 的多条正式发言拼成一条。
    if previous and not bool(record.get("isFinal", True)):
        try:
            delta = (datetime.strptime(now, "%Y-%m-%d %H:%M:%S") - datetime.strptime(previous["serverTime"], "%Y-%m-%d %H:%M:%S")).total_seconds()
        except Exception:
            delta = 999
        if 0 < delta <= 10 and len(previous.get("transcript", "")) + len(record["transcript"]) <= 200:
            record["id"] = previous["id"]
            record["transcript"] = previous.get("transcript", "") + record["transcript"]
        elif previous.get("transcript") and difflib.SequenceMatcher(None, previous["transcript"], record["transcript"]).ratio() > 0.85:
            record["id"] = previous["id"]
            record["transcript"] = record["transcript"]
    _db_upsert_transcript(record)
    _invalidate_transcripts_cache()
    return record, False

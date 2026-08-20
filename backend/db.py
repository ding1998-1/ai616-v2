"""
backend/db.py — SQLite 数据库模块

负责：
- 会议数据（meetings、issue_sources、agenda_drafts、materials、events）的 CRUD
- 转写数据（meeting_transcripts）的 CRUD
- 应用元数据（app_metadata）的读写
- 旧 JSON 数据的迁移
- WAL 文件 checkpoint 防无限增长
- 内存缓存变量与辅助工具函数

所有 SQLite 操作通过 _db_connect() 获取线程本地连接，写操作由 APP_DB_LOCK 互斥保护。
"""

import os
import json
import sqlite3
import threading
import time
import re
import uuid
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, Any, List, Dict

from fastapi import HTTPException

from .config import (
    APP_DB,
    APP_DB_LOCK,
    MEETING_FILES_DIR,
    MEETINGS_DB,
    MEETING_TRANSCRIPTS_DB,
    MEETING_DATA_DIR,
    now_text as _now_text,
    today_text as _today_text,
    _meetings_cache,
    _meetings_cache_time,
    _meetings_cache_ttl,
    _meetings_cache_max_keys,
    _transcripts_cache,
    _transcripts_cache_time,
    _transcripts_cache_ttl,
    _transcripts_cache_max_keys,
    _transcripts_cache_max_rows,
    _WAL_CHECKPOINT_INTERVAL,
    _last_wal_checkpoint,
)

logger = logging.getLogger(__name__)

# ═══ 本地路径常量 ══════════════════════════════════════════════════════════════════

_script_dir = Path(os.path.dirname(os.path.abspath(__file__))).parent

AUTH_DATA_DIR = _script_dir / "data" / "auth"
AUTH_DATA_DIR.mkdir(parents=True, exist_ok=True)
USERS_DB = AUTH_DATA_DIR / "users.json"

RULES_IMAGES_DIR = _script_dir / "rules"

# ═══ 线程本地数据库连接 ═══════════════════════════════════════════════════════════

_db_conn_local = threading.local()


# ══════════════════════════════════════════════════════════════════════════════════
# 数据库连接与初始化
# ══════════════════════════════════════════════════════════════════════════════════

def _db_connect():
    """获取当前线程的 SQLite 连接（线程本地单例）。

    首次调用时创建连接并配置 WAL 模式、外键、缓存等 PRAGMA。
    可通过 ``with _db_connect() as conn:`` 作为上下文管理器使用。
    """
    conn = getattr(_db_conn_local, 'conn', None)
    if conn is not None:
        return conn
    APP_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(APP_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA cache_size = -64000")
    _db_conn_local.conn = conn
    return conn


def _init_app_db():
    """初始化应用数据库，创建所有表（如不存在则创建）。

    包含以下表：
    - app_metadata        应用元数据键值表
    - meetings            会议主表
    - meeting_issue_sources  议题来源明细
    - meeting_agenda_drafts  议题草稿
    - meeting_materials      会议材料
    - meeting_events         会议事件
    - meeting_transcripts    实时转写记录
    - meeting_participants   参会人

    同时执行数据库迁移（如添加 meeting_mode 列）。
    写操作由 APP_DB_LOCK 互斥保护。
    """
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS app_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS meetings (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '',
                    project TEXT NOT NULL DEFAULT '',
                    project_code TEXT NOT NULL DEFAULT '',
                    agenda TEXT NOT NULL DEFAULT '',
                    meeting_date TEXT NOT NULL DEFAULT '',
                    meeting_type TEXT NOT NULL DEFAULT '普通企业会议',
                    meeting_mode TEXT NOT NULL DEFAULT 'normal',
                    creator TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT '',
                    phase TEXT NOT NULL DEFAULT '问题收集中',
                    archived INTEGER NOT NULL DEFAULT 0,
                    project_bound INTEGER NOT NULL DEFAULT 0,
                    agenda_frozen INTEGER NOT NULL DEFAULT 0,
                    review_done INTEGER NOT NULL DEFAULT 0,
                    archive_done INTEGER NOT NULL DEFAULT 0,
                    generated_records_json TEXT NOT NULL DEFAULT '',
                    meeting_no TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS meeting_issue_sources (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    name TEXT NOT NULL DEFAULT '',
                    time TEXT NOT NULL DEFAULT '',
                    type TEXT NOT NULL DEFAULT 'text',
                    content TEXT NOT NULL DEFAULT '',
                    meta TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT 'manual',
                    server_time TEXT NOT NULL DEFAULT '',
                    user_id TEXT NOT NULL DEFAULT '',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_agenda_drafts (
                    row_id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    draft_id TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT '',
                    project TEXT NOT NULL DEFAULT '',
                    type TEXT NOT NULL DEFAULT '',
                    risk TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT '',
                    changes_json TEXT NOT NULL DEFAULT '[]',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_materials (
                    row_id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    name TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT '',
                    tone TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_events (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    type TEXT NOT NULL DEFAULT '',
                    server_time TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_transcripts (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    meeting_title TEXT NOT NULL DEFAULT '',
                    agenda TEXT NOT NULL DEFAULT '',
                    speaker_name TEXT NOT NULL DEFAULT '',
                    speaker_role TEXT NOT NULL DEFAULT '',
                    speaker_dept TEXT NOT NULL DEFAULT '',
                    seat TEXT NOT NULL DEFAULT '',
                    username TEXT NOT NULL DEFAULT '',
                    transcript TEXT NOT NULL DEFAULT '',
                    is_final INTEGER NOT NULL DEFAULT 1,
                    client_time TEXT NOT NULL DEFAULT '',
                    server_time TEXT NOT NULL DEFAULT '',
                    confidence REAL NOT NULL DEFAULT 0.92,
                    source TEXT NOT NULL DEFAULT 'mobile-recorder',
                    payload_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS meeting_participants (
                    row_id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    user_id TEXT NOT NULL DEFAULT '',
                    username TEXT NOT NULL DEFAULT '',
                    display_name TEXT NOT NULL DEFAULT '',
                    meeting_role TEXT NOT NULL DEFAULT '',
                    seat TEXT NOT NULL DEFAULT '',
                    dept TEXT NOT NULL DEFAULT '',
                    last_action TEXT NOT NULL DEFAULT '',
                    last_seen_at TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_agendas (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    agenda_no INTEGER NOT NULL DEFAULT 0,
                    title TEXT NOT NULL DEFAULT '',
                    description TEXT NOT NULL DEFAULT '',
                    agenda_type TEXT NOT NULL DEFAULT 'standard',
                    source TEXT NOT NULL DEFAULT 'prepared',
                    confidentiality_level TEXT NOT NULL DEFAULT 'normal',
                    permission_level TEXT NOT NULL DEFAULT '',
                    proposer_user_id TEXT NOT NULL DEFAULT '',
                    owner_user_id TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'draft',
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT '',
                    started_at TEXT NOT NULL DEFAULT '',
                    ended_at TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_audio_clients (
                    client_id TEXT NOT NULL,
                    meeting_id TEXT NOT NULL,
                    participant_row_id TEXT NOT NULL DEFAULT '',
                    user_id TEXT NOT NULL DEFAULT '',
                    username TEXT NOT NULL DEFAULT '',
                    display_name TEXT NOT NULL DEFAULT '',
                    device_type TEXT NOT NULL DEFAULT 'mobile',
                    device_label TEXT NOT NULL DEFAULT '手机麦克风',
                    firmware_version TEXT NOT NULL DEFAULT '',
                    transport TEXT NOT NULL DEFAULT 'web-mobile',
                    first_seen_at TEXT NOT NULL DEFAULT '',
                    last_seen_at TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    PRIMARY KEY (client_id, meeting_id)
                );

                CREATE TABLE IF NOT EXISTS meeting_agenda_records (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    agenda_id TEXT NOT NULL DEFAULT '',
                    transcript_id TEXT NOT NULL DEFAULT '',
                    speaker_user_id TEXT NOT NULL DEFAULT '',
                    participant_id TEXT NOT NULL DEFAULT '',
                    speaker_name TEXT NOT NULL DEFAULT '',
                    record_type TEXT NOT NULL DEFAULT 'discussion',
                    content TEXT NOT NULL DEFAULT '',
                    corrected_content TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT 'manual',
                    created_at TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_agenda_decisions (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    agenda_id TEXT NOT NULL,
                    decision_no TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    content TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'draft',
                    source TEXT NOT NULL DEFAULT 'manual',
                    version INTEGER NOT NULL DEFAULT 1,
                    created_by TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT '',
                    confirmed_at TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS meeting_signatures (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    agenda_id TEXT NOT NULL DEFAULT '',
                    target_type TEXT NOT NULL DEFAULT 'decision',
                    target_id TEXT NOT NULL DEFAULT '',
                    version INTEGER NOT NULL DEFAULT 1,
                    content_hash TEXT NOT NULL DEFAULT '',
                    signer_user_id TEXT NOT NULL DEFAULT '',
                    signer_name TEXT NOT NULL DEFAULT '',
                    signer_role TEXT NOT NULL DEFAULT '',
                    signature_data TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'valid',
                    signed_at TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS user_roles (
                    user_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    granted_at TEXT NOT NULL DEFAULT '',
                    granted_by TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    PRIMARY KEY (user_id, role)
                );

                CREATE TABLE IF NOT EXISTS agenda_acl (
                    agenda_id TEXT NOT NULL,
                    meeting_id TEXT NOT NULL,
                    user_id TEXT NOT NULL DEFAULT '',
                    permission TEXT NOT NULL DEFAULT 'view',
                    granted_at TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    PRIMARY KEY (agenda_id, user_id, permission)
                );
                """
            )
            # Migration: add meeting_mode column for databases created before 2026-06-15
            cols = {row[1] for row in conn.execute("PRAGMA table_info('meetings')").fetchall()}
            if "meeting_mode" not in cols:
                conn.execute("ALTER TABLE meetings ADD COLUMN meeting_mode TEXT NOT NULL DEFAULT 'normal'")
            # Migration: timer columns
            if "timer_started_at" not in cols:
                conn.execute("ALTER TABLE meetings ADD COLUMN timer_started_at TEXT NOT NULL DEFAULT ''")
            if "agenda_duration_minutes" not in cols:
                conn.execute("ALTER TABLE meetings ADD COLUMN agenda_duration_minutes INTEGER NOT NULL DEFAULT 15")
            if "generated_records_json" not in cols:
                conn.execute("ALTER TABLE meetings ADD COLUMN generated_records_json TEXT NOT NULL DEFAULT ''")
            if "meeting_no" not in cols:
                conn.execute("ALTER TABLE meetings ADD COLUMN meeting_no TEXT NOT NULL DEFAULT ''")
            if "active_agenda_id" not in cols:
                conn.execute("ALTER TABLE meetings ADD COLUMN active_agenda_id TEXT NOT NULL DEFAULT ''")
            if "require_full_signature" not in cols:
                conn.execute("ALTER TABLE meetings ADD COLUMN require_full_signature INTEGER NOT NULL DEFAULT 0")
            # notifications table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS notifications (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT '',
                    type TEXT NOT NULL DEFAULT 'info',
                    title TEXT NOT NULL DEFAULT '',
                    body TEXT NOT NULL DEFAULT '',
                    meeting_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT '',
                    read INTEGER NOT NULL DEFAULT 0
                );
            """)
            # Migration: signing columns on meeting_transcripts (2026-07-10)
            t_cols = {row[1] for row in conn.execute("PRAGMA table_info('meeting_transcripts')").fetchall()}
            if "correction_signed" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN correction_signed INTEGER NOT NULL DEFAULT 0")
            if "correction_signed_at" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN correction_signed_at TEXT NOT NULL DEFAULT ''")
            if "signature_data" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN signature_data TEXT NOT NULL DEFAULT ''")
            if "corrected_transcript" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN corrected_transcript TEXT NOT NULL DEFAULT ''")
            # Migration: agenda/participant binding on meeting_transcripts (2026-08-20)
            if "agenda_id" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN agenda_id TEXT NOT NULL DEFAULT ''")
            if "speaker_user_id" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN speaker_user_id TEXT NOT NULL DEFAULT ''")
            if "participant_id" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN participant_id TEXT NOT NULL DEFAULT ''")
            if "audio_client_id" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN audio_client_id TEXT NOT NULL DEFAULT ''")
            # meeting_todos table (2026-07-10)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS meeting_todos (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    meeting_title TEXT NOT NULL DEFAULT '',
                    task TEXT NOT NULL DEFAULT '',
                    owner TEXT NOT NULL DEFAULT '',
                    deadline TEXT NOT NULL DEFAULT '',
                    priority TEXT NOT NULL DEFAULT '中',
                    status TEXT NOT NULL DEFAULT '待处理',
                    source TEXT NOT NULL DEFAULT 'ai',
                    reference TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT '',
                    completed_at TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}'
                );
            """)
            # meeting_record_versions table (2026-07-10)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS meeting_record_versions (
                    id TEXT PRIMARY KEY,
                    meeting_id TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    editor TEXT NOT NULL DEFAULT '',
                    edit_summary TEXT NOT NULL DEFAULT '',
                    records_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT ''
                );
            """)
            # voiceprint_profiles table (2026-07-13)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS voiceprint_profiles (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT '',
                    display_name TEXT NOT NULL DEFAULT '',
                    role TEXT NOT NULL DEFAULT '',
                    dept TEXT NOT NULL DEFAULT '',
                    embedding BLOB NOT NULL,
                    sample_duration REAL NOT NULL DEFAULT 0,
                    sample_count INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL DEFAULT '{}'
                );
            """)
            # Migration: voiceprint columns on meeting_transcripts (2026-07-13)
            if "speaker_confidence" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN speaker_confidence REAL NOT NULL DEFAULT 0")
            if "identified_by" not in t_cols:
                conn.execute("ALTER TABLE meeting_transcripts ADD COLUMN identified_by TEXT NOT NULL DEFAULT 'manual'")


# ══════════════════════════════════════════════════════════════════════════════════
# 元数据读写
# ══════════════════════════════════════════════════════════════════════════════════

def _metadata_get(conn, key: str) -> Optional[str]:
    """从 app_metadata 表读取指定 key 的值。

    Args:
        conn: SQLite 连接
        key: 元数据键名

    Returns:
        值字符串，不存在则返回 None
    """
    row = conn.execute("SELECT value FROM app_metadata WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def _metadata_set(conn, key: str, value: str):
    """向 app_metadata 表写入或更新指定 key 的值。

    Args:
        conn: SQLite 连接
        key: 元数据键名
        value: 元数据值
    """
    conn.execute(
        """
        INSERT INTO app_metadata (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value, _now_text()),
    )


# ══════════════════════════════════════════════════════════════════════════════════
# 行 → 字典转换
# ══════════════════════════════════════════════════════════════════════════════════

def _meeting_from_row(row: sqlite3.Row) -> dict:
    """将 meetings 表的一行转换为会议字典（不含子表数据）。

    子表数据（issueSources、agendaDrafts、materials、events）初始化为空列表，
    由 _db_fetch_meetings 在后续查询中填充。

    Args:
        row: meetings 表的 sqlite3.Row 对象

    Returns:
        会议字典
    """
    gr_json = row["generated_records_json"] if "generated_records_json" in row.keys() else ""
    generated_records = _json_loads(gr_json, {}) if gr_json else {}
    return {
        "id": row["id"],
        "title": row["title"],
        "project": row["project"],
        "projectCode": row["project_code"],
        "agenda": row["agenda"],
        "date": row["meeting_date"],
        "type": row["meeting_type"],
        "meetingNo": row["meeting_no"] if "meeting_no" in row.keys() else "",
        "requireFullSignature": bool(row["require_full_signature"]) if "require_full_signature" in row.keys() else False,
        "meetingMode": row["meeting_mode"],
        "activeAgendaId": row["active_agenda_id"] if "active_agenda_id" in row.keys() else "",
        "creator": row["creator"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "phase": row["phase"],
        "archived": bool(row["archived"]),
        "projectBound": bool(row["project_bound"]),
        "agendaFrozen": bool(row["agenda_frozen"]),
        "reviewDone": bool(row["review_done"]),
        "archiveDone": bool(row["archive_done"]),
        "generatedRecords": generated_records,
        "issueSources": [],
        "agendaDrafts": [],
        "materials": [],
        "events": [],
    }


# ══════════════════════════════════════════════════════════════════════════════════
# 会议读取
# ══════════════════════════════════════════════════════════════════════════════════

def _db_fetch_meetings(include_details: bool = True) -> dict:
    """从数据库加载全部会议。

    先查询主表，再按需 JOIN 子表（issue_sources、agenda_drafts、materials、events），
    以 meeting_id 为键组装完整字典。

    Args:
        include_details: 是否同时加载子表数据，默认 True

    Returns:
        {meeting_id: meeting_dict} 的字典
    """
    _init_app_db()
    with _db_connect() as conn:
        rows = conn.execute("SELECT * FROM meetings").fetchall()
        meetings = {row["id"]: _meeting_from_row(row) for row in rows}
        if not include_details or not meetings:
            return meetings

        # 参会人数：以 meeting_participants 为真实来源（预留表，未写入时返回 0）
        try:
            for row in conn.execute(
                "SELECT meeting_id, COUNT(*) AS c FROM meeting_participants GROUP BY meeting_id"
            ).fetchall():
                meeting = meetings.get(row["meeting_id"])
                if meeting:
                    meeting["participantCount"] = int(row["c"])
        except Exception:
            pass

        for row in conn.execute("SELECT * FROM meeting_issue_sources ORDER BY sort_order, server_time, id").fetchall():
            meeting = meetings.get(row["meeting_id"])
            if not meeting:
                continue
            meeting["issueSources"].append({
                "id": row["id"],
                "name": row["name"],
                "time": row["time"],
                "type": row["type"],
                "content": row["content"],
                "meta": row["meta"],
                "source": row["source"],
                "serverTime": row["server_time"],
                "userId": row["user_id"],
            })

        for row in conn.execute("SELECT * FROM meeting_agenda_drafts ORDER BY sort_order, row_id").fetchall():
            meeting = meetings.get(row["meeting_id"])
            if not meeting:
                continue
            meeting["agendaDrafts"].append({
                "id": row["draft_id"],
                "title": row["title"],
                "source": row["source"],
                "project": row["project"],
                "type": row["type"],
                "risk": row["risk"],
                "status": row["status"],
                "changes": _json_loads(row["changes_json"], []),
            })

        for row in conn.execute("SELECT * FROM meeting_materials ORDER BY sort_order, row_id").fetchall():
            meeting = meetings.get(row["meeting_id"])
            if not meeting:
                continue
            payload = _json_loads(row["payload_json"], {})
            meeting["materials"].append({
                **payload,
                "name": row["name"],
                "status": row["status"],
                "tone": row["tone"],
            })

        for row in conn.execute("SELECT * FROM meeting_events ORDER BY sort_order, server_time, id").fetchall():
            meeting = meetings.get(row["meeting_id"])
            if not meeting:
                continue
            payload = _json_loads(row["payload_json"], {})
            meeting["events"].append(payload)

        return meetings


# ══════════════════════════════════════════════════════════════════════════════════
# 会议写入
# ══════════════════════════════════════════════════════════════════════════════════

def _db_save_meetings(meetings: dict):
    """全量重建所有会议（仅用于迁移/初始化）。

    先清空所有会议相关表，再逐条插入。此操作较重，
    日常写操作用 _db_upsert_meeting 代替。

    Args:
        meetings: {meeting_id: meeting_dict} 的字典
    """
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute("DELETE FROM meeting_issue_sources")
            conn.execute("DELETE FROM meeting_agenda_drafts")
            conn.execute("DELETE FROM meeting_materials")
            conn.execute("DELETE FROM meeting_events")
            conn.execute("DELETE FROM meetings")
            for meeting in meetings.values():
                _db_insert_meeting_rows(conn, meeting)


def _db_delete_meeting_rows(conn, meeting_id: str):
    """删除指定会议的所有相关行（在已有事务内执行）。

    删除 meeting_issue_sources、meeting_agenda_drafts、meeting_materials、
    meeting_events、meeting_transcripts 和 meetings 主表中与该 meeting_id 关联的行。

    Args:
        conn: SQLite 连接（需已在事务中）
        meeting_id: 会议 ID
    """
    conn.execute("DELETE FROM meeting_issue_sources WHERE meeting_id = ?", (meeting_id,))
    conn.execute("DELETE FROM meeting_agenda_drafts WHERE meeting_id = ?", (meeting_id,))
    conn.execute("DELETE FROM meeting_materials WHERE meeting_id = ?", (meeting_id,))
    conn.execute("DELETE FROM meeting_events WHERE meeting_id = ?", (meeting_id,))
    conn.execute("DELETE FROM meeting_transcripts WHERE meeting_id = ?", (meeting_id,))
    conn.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))


def _db_insert_meeting_rows(conn, meeting: dict):
    """插入单个会议及其所有子表数据（在已有事务内执行）。

    先通过 _normalize_meeting 规范化数据，再依次写入 meetings 主表及
    issue_sources、agenda_drafts、materials、events 四个子表。

    Args:
        conn: SQLite 连接（需已在事务中）
        meeting: 会议字典
    """
    normalized = _normalize_meeting(meeting)
    meeting_mode_val = normalized.get("meetingMode") if normalized.get("meetingMode") in {"normal", "major"} else "normal"
    conn.execute(
        """
        INSERT INTO meetings (
            id, title, project, project_code, agenda, meeting_date, meeting_type,
            meeting_mode, creator, created_at, updated_at, phase, archived,
            project_bound, agenda_frozen, review_done, archive_done,
            generated_records_json, meeting_no, active_agenda_id, require_full_signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            normalized.get("id"),
            normalized.get("title", ""),
            normalized.get("project", ""),
            normalized.get("projectCode", ""),
            normalized.get("agenda", ""),
            normalized.get("date", ""),
            normalized.get("type", "普通企业会议"),
            meeting_mode_val,
            normalized.get("creator", ""),
            normalized.get("createdAt", ""),
            normalized.get("updatedAt", ""),
            normalized.get("phase", "问题收集中"),
            int(bool(normalized.get("archived", False))),
            int(bool(normalized.get("projectBound", False))),
            int(bool(normalized.get("agendaFrozen", False))),
            int(bool(normalized.get("reviewDone", False))),
            int(bool(normalized.get("archiveDone", False))),
            _json_dumps(normalized.get("generatedRecords", {})),
            normalized.get("meetingNo", ""),
            normalized.get("activeAgendaId", ""),
            int(bool(normalized.get("requireFullSignature", False))),
        ),
    )
    _db_insert_issue_sources(conn, normalized)
    _db_insert_agenda_drafts(conn, normalized)
    _db_insert_materials(conn, normalized)
    _db_insert_events(conn, normalized)


def _db_insert_issue_sources(conn, normalized: dict):
    """向 meeting_issue_sources 表插入议题来源记录。

    Args:
        conn: SQLite 连接
        normalized: 规范化后的会议字典
    """
    for index, item in enumerate(normalized.get("issueSources", [])):
        raw_issue_id = str(item.get("id") or f"issue_source_{uuid.uuid4().hex[:10]}")
        issue_id = raw_issue_id if raw_issue_id.startswith(f"{normalized['id']}:issue:") else f"{normalized['id']}:issue:{raw_issue_id}:{index}"
        conn.execute(
            """
            INSERT INTO meeting_issue_sources (
                id, meeting_id, name, time, type, content, meta, source,
                server_time, user_id, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                issue_id, normalized["id"],
                item.get("name", ""), item.get("time", ""),
                item.get("type", "text"), item.get("content", ""),
                item.get("meta", ""), item.get("source", "manual"),
                item.get("serverTime", ""), item.get("userId", ""), index,
            ),
        )


def _db_insert_agenda_drafts(conn, normalized: dict):
    """向 meeting_agenda_drafts 表插入议题草稿记录。

    Args:
        conn: SQLite 连接
        normalized: 规范化后的会议字典
    """
    for index, item in enumerate(normalized.get("agendaDrafts", [])):
        draft_id = str(item.get("id") or f"issue-{index + 1:03d}")
        conn.execute(
            """
            INSERT INTO meeting_agenda_drafts (
                row_id, meeting_id, draft_id, title, source, project, type,
                risk, status, changes_json, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"{normalized['id']}:{draft_id}:{index}", normalized["id"],
                draft_id, item.get("title", ""), item.get("source", ""),
                item.get("project", ""), item.get("type", ""),
                item.get("risk", ""), item.get("status", ""),
                _json_dumps(item.get("changes", [])), index,
            ),
        )


def _db_insert_materials(conn, normalized: dict):
    """向 meeting_materials 表插入会议材料记录。

    Args:
        conn: SQLite 连接
        normalized: 规范化后的会议字典
    """
    for index, item in enumerate(normalized.get("materials", [])):
        conn.execute(
            """
            INSERT INTO meeting_materials (
                row_id, meeting_id, name, status, tone, payload_json, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"{normalized['id']}:material:{index}", normalized["id"],
                item.get("name", ""), item.get("status", ""),
                item.get("tone", ""), _json_dumps(item), index,
            ),
        )


def _db_insert_events(conn, normalized: dict):
    """向 meeting_events 表插入会议事件记录。

    Args:
        conn: SQLite 连接
        normalized: 规范化后的会议字典
    """
    for index, event in enumerate(normalized.get("events", [])):
        event_id = str(event.get("id") or f"event_{uuid.uuid4().hex[:10]}")
        conn.execute(
            """
            INSERT INTO meeting_events (
                id, meeting_id, type, server_time, payload_json, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event_id, normalized["id"],
                event.get("type", ""), event.get("serverTime", ""),
                _json_dumps(event), index,
            ),
        )


def _db_upsert_meeting(meeting: dict):
    """原子化 upsert 单个会议 —— 不删 meeting_transcripts。

    在事务内先删除旧元数据再插入新数据，保证原子性。
    注意：不删除 meeting_transcripts，避免误清空所有转写。
    """
    _init_app_db()
    mid = meeting.get("id")
    if not mid:
        return
    with APP_DB_LOCK:
        with _db_connect() as conn:
            # 只删除元数据子表，保留 meeting_transcripts
            conn.execute("DELETE FROM meeting_issue_sources WHERE meeting_id = ?", (mid,))
            conn.execute("DELETE FROM meeting_agenda_drafts WHERE meeting_id = ?", (mid,))
            conn.execute("DELETE FROM meeting_materials WHERE meeting_id = ?", (mid,))
            conn.execute("DELETE FROM meeting_events WHERE meeting_id = ?", (mid,))
            conn.execute("DELETE FROM meetings WHERE id = ?", (mid,))
            _db_insert_meeting_rows(conn, meeting)


def _db_delete_meeting_by_id(meeting_id: str):
    """删除单个会议及其所有关联数据。

    Args:
        meeting_id: 要删除的会议 ID
    """
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            _db_delete_meeting_rows(conn, meeting_id)


# ══════════════════════════════════════════════════════════════════════════════════
# 转写读取
# ══════════════════════════════════════════════════════════════════════════════════

def _db_load_transcripts() -> dict:
    """从数据库加载全部转写记录。

    以 meeting_id 为键分组，每组包含 transcripts 列表、meetingTitle、agenda、
    updatedAt 等元信息。同时读取 type 为 session 或 transcript 的 meeting_events。

    Returns:
        {meeting_id: {events, transcripts, meetingTitle, agenda, updatedAt}} 的字典
    """
    _init_app_db()
    with _db_connect() as conn:
        meetings = {}
        for row in conn.execute("SELECT * FROM meeting_transcripts ORDER BY server_time, id").fetchall():
            meeting = meetings.setdefault(row["meeting_id"], {"events": [], "transcripts": [], "meetingTitle": row["meeting_title"], "agenda": row["agenda"], "updatedAt": row["server_time"]})
            payload = _json_loads(row["payload_json"], {})
            record = {
                **payload,
                "id": row["id"],
                "meetingId": row["meeting_id"],
                "meetingTitle": row["meeting_title"],
                "agenda": row["agenda"],
                "speakerName": row["speaker_name"],
                "speakerRole": row["speaker_role"],
                "speakerDept": row["speaker_dept"],
                "seat": row["seat"],
                "username": row["username"],
                "transcript": row["transcript"],
                "isFinal": bool(row["is_final"]),
                "clientTime": row["client_time"],
                "serverTime": row["server_time"],
                "confidence": row["confidence"],
                "source": row["source"],
            }
            meeting["transcripts"].append(record)
            meeting["meetingTitle"] = row["meeting_title"] or meeting.get("meetingTitle", "")
            meeting["agenda"] = row["agenda"] or meeting.get("agenda", "")
            meeting["updatedAt"] = row["server_time"] or meeting.get("updatedAt", "")

        for row in conn.execute("SELECT * FROM meeting_events ORDER BY sort_order, server_time, id").fetchall():
            payload = _json_loads(row["payload_json"], {})
            if payload.get("type") not in ("session", "transcript", "audio"):
                continue
            meeting = meetings.setdefault(row["meeting_id"], {"events": [], "transcripts": [], "updatedAt": row["server_time"]})
            meeting["events"].append(payload)
            meeting["updatedAt"] = row["server_time"] or meeting.get("updatedAt", "")
        return meetings


def _db_load_transcripts_for_meeting(meeting_id: str) -> dict:
    """加载单个会议的转写记录 —— 避免加载全部会议。

    Args:
        meeting_id: 会议 ID

    Returns:
        {events, transcripts, meetingTitle, agenda, updatedAt} 的字典
    """
    _init_app_db()
    with _db_connect() as conn:
        meeting = {"events": [], "transcripts": [], "meetingTitle": "", "agenda": "", "updatedAt": ""}
        for row in conn.execute(
            "SELECT * FROM meeting_transcripts WHERE meeting_id = ? ORDER BY COALESCE(client_time, server_time), id",
            (meeting_id,)
        ).fetchall():
            payload = _json_loads(row["payload_json"], {})
            record = {
                **payload,
                "id": row["id"], "meetingId": row["meeting_id"],
                "meetingTitle": row["meeting_title"], "agenda": row["agenda"],
                "speakerName": row["speaker_name"], "speakerRole": row["speaker_role"],
                "speakerDept": row["speaker_dept"], "seat": row["seat"],
                "username": row["username"], "transcript": row["transcript"],
                "isFinal": bool(row["is_final"]),
                "clientTime": row["client_time"], "serverTime": row["server_time"],
                "confidence": row["confidence"], "source": row["source"],
            }
            # 签名字段：专用列优先，payload_json 兜底
            if row["correction_signed"]:
                record["correctionSigned"] = bool(row["correction_signed"])
            if row["signature_data"]:
                record["signatureData"] = row["signature_data"]
            if row["correction_signed_at"]:
                record["correctionSignedAt"] = row["correction_signed_at"]
            if row["corrected_transcript"]:
                record["correctedTranscript"] = row["corrected_transcript"]
            meeting["transcripts"].append(record)
            meeting["meetingTitle"] = row["meeting_title"] or meeting.get("meetingTitle", "")
            meeting["agenda"] = row["agenda"] or meeting.get("agenda", "")
            meeting["updatedAt"] = row["server_time"] or meeting.get("updatedAt", "")
        # 加载 meeting_events 表中的音频/会话事件
        for row in conn.execute(
            "SELECT * FROM meeting_events WHERE meeting_id = ? ORDER BY sort_order, server_time",
            (meeting_id,)
        ).fetchall():
            payload = _json_loads(row["payload_json"], {})
            event = {
                **payload,
                "id": row["id"], "type": row["type"],
                "meetingId": row["meeting_id"], "serverTime": row["server_time"],
            }
            meeting["events"].append(event)
        return meeting


# ══════════════════════════════════════════════════════════════════════════════════
# 转写写入
# ══════════════════════════════════════════════════════════════════════════════════

def _db_save_transcripts(data: dict):
    """全量重建转写表 —— 仅用于迁移/旧数据导入。

    先清空 meeting_transcripts 表，再逐条插入。

    Args:
        data: {meeting_id: {transcripts: [...], ...}} 的字典
    """
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute("DELETE FROM meeting_transcripts")
            for meeting_id, meeting in data.items():
                for record in meeting.get("transcripts", []):
                    _db_insert_transcript_row(conn, record, meeting_id, meeting)


def _db_insert_transcript_row(conn, record: dict, meeting_id: str, meeting: dict):
    """向 meeting_transcripts 表插入单条转写记录（在已有事务内执行）。

    Args:
        conn: SQLite 连接（需已在事务中）
        record: 转写记录字典
        meeting_id: 所属会议 ID
        meeting: 所属会议字典（用于回填 meetingTitle、agenda）
    """
    conn.execute(
        """
        INSERT INTO meeting_transcripts (
            id, meeting_id, meeting_title, agenda, speaker_name, speaker_role,
            speaker_dept, seat, username, transcript, is_final, client_time,
            server_time, confidence, source, payload_json,
            correction_signed, correction_signed_at, signature_data, corrected_transcript,
            speaker_confidence, identified_by,
            agenda_id, speaker_user_id, participant_id, audio_client_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            record.get("id") or f"tr_{uuid.uuid4().hex[:12]}",
            record.get("meetingId") or meeting_id,
            record.get("meetingTitle") or meeting.get("meetingTitle", ""),
            record.get("agenda") or meeting.get("agenda", ""),
            record.get("speakerName") or "",
            record.get("speakerRole") or "",
            record.get("speakerDept") or "",
            record.get("seat") or "",
            record.get("username") or "",
            record.get("transcript") or "",
            int(bool(record.get("isFinal", True))),
            record.get("clientTime") or "",
            record.get("serverTime") or "",
            float(record.get("confidence", 0.92) or 0.92),
            record.get("source") or "mobile-recorder",
            _json_dumps(record),
            int(bool(record.get("correctionSigned", False))),
            record.get("correctionSignedAt") or "",
            record.get("signatureData") or "",
            record.get("correctedTranscript") or "",
            float(record.get("speakerConfidence", 0) or 0),
            record.get("identifiedBy") or "manual",
            record.get("agendaId") or "",
            record.get("speakerUserId") or "",
            record.get("participantId") or "",
            record.get("audioClientId") or "",
        ),
    )


def _db_upsert_transcript(record: dict):
    """插入或更新单条转写记录 —— 用于实时分块写入。

    如果 record["id"] 已存在则执行 UPDATE（更新 transcript、is_final、
    confidence、server_time、payload_json），否则执行 INSERT。

    Args:
        record: 转写记录字典
    """
    _init_app_db()
    rec_id = record.get("id") or f"tr_{uuid.uuid4().hex[:12]}"
    with APP_DB_LOCK:
        with _db_connect() as conn:
            existing = conn.execute(
                "SELECT id FROM meeting_transcripts WHERE id = ?", (rec_id,)
            ).fetchone()
            if existing:
                conn.execute(
                    """UPDATE meeting_transcripts SET
                        transcript = ?, is_final = ?, confidence = ?,
                        server_time = ?, payload_json = ?,
                        speaker_confidence = ?, identified_by = ?
                    WHERE id = ?""",
                    (
                        record.get("transcript", ""),
                        int(bool(record.get("isFinal", True))),
                        float(record.get("confidence", 0.92) or 0.92),
                        record.get("serverTime", ""),
                        _json_dumps(record),
                        float(record.get("speakerConfidence", 0) or 0),
                        record.get("identifiedBy") or "manual",
                        rec_id,
                    ),
                )
            else:
                _db_insert_transcript_row(conn, record, record.get("meetingId", ""), record)


def _db_upsert_audio_client(meeting_id: str, client_id: str, user: dict, extra: dict = None):
    """注册/更新录音客户端（meeting_audio_clients），每人每设备一条。

    Args:
        meeting_id: 会议 ID
        client_id: 前端生成的设备级唯一 ID（persisted，跨刷新不变）
        user: 用户字典（参与者身份）
        extra: 可选的 device_type/device_label/firmware_version/transport 等
    """
    _init_app_db()
    if not client_id:
        return None
    extra = extra or {}
    now = _now_text()
    display = user.get("name") or user.get("username") or "参会人"
    row_id = f"p_{meeting_id[:20]}_{(user.get('id') or 'x')[-16:]}"
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                """
                INSERT INTO meeting_audio_clients (
                    client_id, meeting_id, participant_row_id, user_id, username,
                    display_name, device_type, device_label, firmware_version,
                    transport, first_seen_at, last_seen_at, status, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(client_id, meeting_id) DO UPDATE SET
                    user_id = excluded.user_id, username = excluded.username,
                    display_name = excluded.display_name,
                    device_type = excluded.device_type, device_label = excluded.device_label,
                    firmware_version = excluded.firmware_version, transport = excluded.transport,
                    last_seen_at = excluded.last_seen_at, status = excluded.status,
                    payload_json = excluded.payload_json
                """,
                (
                    client_id, meeting_id, row_id,
                    user.get("id", ""), user.get("username", ""), display,
                    extra.get("device_type", "mobile"),
                    extra.get("device_label", "手机麦克风"),
                    extra.get("firmware_version", ""),
                    extra.get("transport", "web-mobile"),
                    now, now, "active", _json_dumps(extra or {}),
                ),
            )
    return {"clientId": client_id, "meetingId": meeting_id, "displayName": display}


def _db_find_participant_row(meeting_id: str, user_id: str) -> str:
    """按 meeting_id + user_id 查询 meeting_participants 的 row_id（幂等读取）。"""
    _init_app_db()
    if not user_id:
        return ""
    try:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT row_id FROM meeting_participants WHERE meeting_id = ? AND user_id = ? ORDER BY last_seen_at DESC LIMIT 1",
                (meeting_id, user_id),
            ).fetchone()
            return row["row_id"] if row else ""
    except Exception:
        return ""


# ══════════════════════════════════════════════════════════════════════════════════
# WAL checkpoint
# ══════════════════════════════════════════════════════════════════════════════════

def _wal_checkpoint():
    """当 WAL 文件超过 10MB 时执行 TRUNCATE checkpoint 以回收磁盘空间。

    失败时静默忽略，不影响正常业务。
    """
    try:
        wal_path = Path(str(APP_DB) + "-wal")
        if wal_path.exists() and wal_path.stat().st_size > 10 * 1024 * 1024:
            with _db_connect() as conn:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            logger.info("WAL checkpoint executed, wal size was %d MB", wal_path.stat().st_size // (1024 * 1024))
    except Exception:
        pass


def _maybe_checkpoint_wal():
    """按固定时间间隔触发 WAL checkpoint。

    通过全局变量 _last_wal_checkpoint 记录上次 checkpoint 时间，
    间隔由 _WAL_CHECKPOINT_INTERVAL（默认 300 秒）控制。
    """
    global _last_wal_checkpoint
    now = time.monotonic()
    if now - _last_wal_checkpoint > _WAL_CHECKPOINT_INTERVAL:
        _wal_checkpoint()
        _last_wal_checkpoint = now


# ══════════════════════════════════════════════════════════════════════════════════
# 旧数据迁移
# ══════════════════════════════════════════════════════════════════════════════════

def _migrate_legacy_meeting_json_once():
    """一次性将旧版 JSON 文件中的数据迁移到 SQLite。

    策略：
    1. 如果已标记迁移完成（legacy_meetings_migrated == "yes"），直接返回
    2. 如果 meetings 表为空且 MEETINGS_DB（meetings.json）存在，导入旧会议
    3. 如果仍为空，写入默认会议数据
    4. 同理处理转写数据（MEETING_TRANSCRIPTS_DB → meeting_transcripts 表）
    5. 迁移成功后写入标记

    此函数设计为幂等，可重复调用。
    """
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            if _metadata_get(conn, "legacy_meetings_migrated") == "yes":
                return
            migration_ok = True
            existing_count = conn.execute("SELECT COUNT(*) AS c FROM meetings").fetchone()["c"]
            if existing_count == 0 and MEETINGS_DB.exists():
                try:
                    legacy_meetings = json.loads(MEETINGS_DB.read_text(encoding="utf-8"))
                    if isinstance(legacy_meetings, dict) and legacy_meetings:
                        _db_save_meetings(legacy_meetings)
                except Exception:
                    migration_ok = False
                    logger.exception("旧会议 JSON 迁移失败")
            elif existing_count == 0:
                _db_save_meetings(_default_meetings())

            transcript_count = conn.execute("SELECT COUNT(*) AS c FROM meeting_transcripts").fetchone()["c"]
            if transcript_count == 0 and MEETING_TRANSCRIPTS_DB.exists():
                try:
                    legacy_transcripts = json.loads(MEETING_TRANSCRIPTS_DB.read_text(encoding="utf-8"))
                    if isinstance(legacy_transcripts, dict) and legacy_transcripts:
                        _db_save_transcripts(legacy_transcripts)
                except Exception:
                    migration_ok = False
                    logger.exception("旧转写 JSON 迁移失败")
            if migration_ok:
                _metadata_set(conn, "legacy_meetings_migrated", "yes")


# ══════════════════════════════════════════════════════════════════════════════════
# JSON 序列化工具
# ══════════════════════════════════════════════════════════════════════════════════

def _json_dumps(value: Any) -> str:
    """将任意值序列化为 JSON 字符串，None 视为空数组。

    Args:
        value: 要序列化的值

    Returns:
        JSON 字符串，ensure_ascii=False
    """
    return json.dumps(value if value is not None else [], ensure_ascii=False)


def _json_loads(value: Optional[str], fallback: Any = None) -> Any:
    """将 JSON 字符串反序列化，失败时返回 fallback。

    Args:
        value: JSON 字符串，可为 None 或空字符串
        fallback: 解析失败时的默认返回值，默认为 []

    Returns:
        解析后的 Python 对象
    """
    if value is None or value == "":
        return [] if fallback is None else fallback
    try:
        return json.loads(value)
    except Exception:
        return [] if fallback is None else fallback


# ══════════════════════════════════════════════════════════════════════════════════
# 默认数据 / 种子数据
# ══════════════════════════════════════════════════════════════════════════════════

def _default_issue_sources() -> List[dict]:
    """返回内置的默认议题来源样例数据。"""
    return [
        {"id": 1, "name": "项目管理部 王明", "time": "08:42", "type": "text", "content": "高新区二期厂房改造想下周上会，现场变更导致预算要追加 860 万。"},
        {"id": 2, "name": "财务部 李倩", "time": "08:46", "type": "text", "content": "这个项目之前有一期合同，二期资金来源还没看到完整测算表。"},
        {"id": 3, "name": "审计监察部 王磊", "time": "08:51", "type": "image", "content": "现场签证单照片", "meta": "识别到：签证变更、预算追加、施工单位"},
        {"id": 4, "name": "总经理办公室 张敏", "time": "09:02", "type": "text", "content": "干部任免也要一起上会，张某拟任项目公司副总。"},
    ]


def _default_agenda_drafts(project: str = "高新区二期厂房消防改造", agenda: str = "高新区二期厂房改造追加预算审议") -> List[dict]:
    """返回内置的默认议题草稿样例数据。

    Args:
        project: 项目名称
        agenda: 议题标题

    Returns:
        议题草稿列表
    """
    return [
        {
            "id": "issue-001",
            "title": agenda,
            "source": "3 条文字 + 1 张图片",
            "project": project,
            "type": "重大项目安排 / 大额度资金运作",
            "risk": "高风险",
            "status": "限期中",
            "changes": ["08:42 首次识别预算追加", "08:51 图片补充现场签证", "09:10 AI 建议创建本地项目"],
        },
        {
            "id": "issue-002",
            "title": "张某拟任项目公司副总经理事项",
            "source": "1 条文字",
            "project": "待绑定干部档案",
            "type": "重要人事任免",
            "risk": "中风险",
            "status": "待确认",
            "changes": ["09:02 从复合发言中拆分独立审查线"],
        },
    ]


def _default_meetings() -> dict:
    """返回内置的默认会议种子数据。

    包含三场示例会议，覆盖不同阶段（问题收集中、待创建会议、会前确认），
    用于首次使用时初始化数据库。

    Returns:
        {meeting_id: meeting_dict} 的字典
    """
    now = _now_text()
    seed = [
        {
            "id": "meeting-gxq-fc-2026-02",
            "title": "高新区二期厂房消防改造专题会",
            "project": "高新区二期厂房消防改造",
            "projectCode": "LOCAL-20260609-001",
            "agenda": "高新区二期厂房改造追加预算审议",
            "date": "2026-06-09",
            "type": "普通企业会议",
            "creator": "总经理办公室 张敏",
            "createdAt": "2026-06-09 09:12",
            "phase": "问题收集中",
            "issueSources": _default_issue_sources(),
            "agendaDrafts": _default_agenda_drafts(),
        },
        {
            "id": "meeting-rsrm-2026-04",
            "title": "项目公司干部任免专题会",
            "project": "项目公司干部调整",
            "projectCode": "LOCAL-20260611-001",
            "agenda": "张某拟任项目公司副总经理事项",
            "date": "2026-06-11",
            "type": "专题会",
            "creator": "组织人事部 周宁",
            "createdAt": "2026-06-08 16:30",
            "phase": "待创建会议",
            "issueSources": [{"id": 1, "name": "组织人事部 周宁", "time": "16:20", "type": "text", "content": "张某拟任项目公司副总经理，需要上会审议并留痕。"}],
            "agendaDrafts": [_default_agenda_drafts("项目公司干部调整", "张某拟任项目公司副总经理事项")[1]],
        },
        {
            "id": "meeting-cg-2026-11",
            "title": "消防设施年度采购审议会",
            "project": "消防设施年度采购",
            "projectCode": "LOCAL-20260614-001",
            "agenda": "年度消防设施采购预算审议",
            "date": "2026-06-14",
            "type": "总经理办公会",
            "creator": "采购中心 何丽",
            "createdAt": "2026-06-07 10:05",
            "phase": "会前确认",
            "issueSources": [{"id": 1, "name": "采购中心 何丽", "time": "10:05", "type": "text", "content": "年度消防设施采购预算需进入总经理办公会，预算金额超过部门授权线。"}],
            "agendaDrafts": _default_agenda_drafts("消防设施年度采购", "年度消防设施采购预算审议")[:1],
        },
    ]
    return {
        item["id"]: {
            **item,
            "materials": item.get("materials", []),
            "events": item.get("events", []),
            "archived": False,
            "projectBound": item.get("phase") not in ("问题收集中", "待创建会议"),
            "agendaFrozen": item.get("phase") not in ("问题收集中", "待创建会议"),
            "reviewDone": False,
            "archiveDone": item.get("phase") == "已归档",
            "updatedAt": item.get("updatedAt") or now,
        }
        for item in seed
    }


# ══════════════════════════════════════════════════════════════════════════════════
# 用户数据管理（JSON 文件存储）
# ══════════════════════════════════════════════════════════════════════════════════

def _default_users() -> List[dict]:
    """返回内置的默认用户列表（admin + 若干 staff 角色）。"""
    _HASH_123456 = "$pbkdf2-sha256$600000$747c110af22137ea23483838c9dc939e$151f9dd15d25416825f0cd18de39960172a7508bbb9c207152203292d0a9e7fa"
    _HASH_ADMIN = "$pbkdf2-sha256$600000$25baef1811fb9395e3dd790d675206d9$4e46250caa32bfac08814c1c46669164ca2a9daaae6a7d3347eabf6266bbca5b"
    return [
        {
            "id": "u_admin",
            "username": "admin",
            "password": _HASH_ADMIN,
            "name": "系统管理员",
            "role": "admin",
            "dept": "信息管理中心",
            "status": "active",
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        {
            "id": "u_zhangmin",
            "username": "zhangmin",
            "password": _HASH_123456,
            "name": "张敏",
            "role": "staff",
            "dept": "总经理办公室",
            "status": "active",
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        {
            "id": "u_liuqiang",
            "username": "liuqiang",
            "password": _HASH_123456,
            "name": "刘强",
            "role": "staff",
            "dept": "经营管理层",
            "status": "active",
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        {
            "id": "u_chenwei",
            "username": "chenwei",
            "password": _HASH_123456,
            "name": "陈伟",
            "role": "staff",
            "dept": "经营管理层",
            "status": "active",
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        {
            "id": "u_wanglei",
            "username": "wanglei",
            "password": _HASH_123456,
            "name": "王磊",
            "role": "staff",
            "dept": "审计监察部",
            "status": "active",
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        {
            "id": "u_wangming",
            "username": "wangming",
            "password": _HASH_123456,
            "name": "王明",
            "role": "staff",
            "dept": "项目管理部",
            "status": "active",
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
        {
            "id": "u_audit",
            "username": "zhangsan",
            "password": _HASH_123456,
            "name": "张三",
            "role": "staff",
            "dept": "合规法务部",
            "status": "active",
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
    ]


def _load_users() -> List[dict]:
    """从 users.json 加载用户列表，文件不存在则写入默认数据。

    Returns:
        用户字典列表
    """
    if USERS_DB.exists():
        try:
            with open(USERS_DB, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data:
                    return data
        except Exception:
            pass
    data = _default_users()
    with open(USERS_DB, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data


def _save_users(users: List[dict]):
    """将用户列表持久化到 users.json。

    Args:
        users: 用户字典列表
    """
    with open(USERS_DB, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


# ══════════════════════════════════════════════════════════════════════════════════
# 会议数据处理工具
# ══════════════════════════════════════════════════════════════════════════════════

def _check_meeting_access(user: dict, meeting: dict):
    """检查当前用户是否有权访问指定会议，无权限则抛出 403。

    权限判断逻辑：
    1. 用户的 name 或 dept+name 出现在会议的 creator 字段中 → 放行
    2. 用户角色为 admin → 放行
    3. 否则抛出 HTTPException(403)

    Args:
        user: 当前登录用户字典
        meeting: 会议字典

    Raises:
        HTTPException: 无权限时抛出 403
    """
    creator = (meeting.get("creator") or "").strip()
    user_name = (user.get("name") or user.get("username") or "").strip()
    user_dept = (user.get("dept") or "").strip()
    # Check if user's name or dept+name appears in the creator field
    if user_name and user_name in creator:
        return
    if user_dept and user_name and f"{user_dept} {user_name}" in creator:
        return
    # For demo: allow admin to access any meeting
    if user.get("role") == "admin":
        return
    raise HTTPException(status_code=403, detail="您不是该会议的创建人或参与人，无权操作此会议。")


def _phase_color(phase: str) -> str:
    """根据会议阶段返回对应的 UI 颜色标签。

    Args:
        phase: 会议阶段字符串

    Returns:
        颜色名称（blue / orange / green / red / default）
    """
    if phase in ("问题收集中", "会中记录"):
        return "blue"
    if phase in ("待创建会议", "会前确认"):
        return "orange" if phase == "待创建会议" else "green"
    if phase == "会后终审":
        return "red"
    if phase == "已归档":
        return "green"
    return "default"


def _normalize_meeting(meeting: dict) -> dict:
    """将会议字典规范化，补充计算字段和默认值。

    处理内容包括：
    - 确保列表字段（issueSources、agendaDrafts、materials、events）为列表
    - 统一 projectCode 来源
    - 补充 statusColor、issueCount 等计算字段
    - bool 类型转换

    Args:
        meeting: 原始会议字典

    Returns:
        规范化后的会议字典
    """
    issue_sources = meeting.get("issueSources") if isinstance(meeting.get("issueSources"), list) else []
    agenda_drafts = meeting.get("agendaDrafts") if isinstance(meeting.get("agendaDrafts"), list) else []
    phase = meeting.get("phase") or "问题收集中"
    return {
        **meeting,
        "projectCode": meeting.get("projectCode") or meeting.get("project_code") or "",
        "issueSources": issue_sources,
        "agendaDrafts": agenda_drafts,
        "materials": meeting.get("materials") if isinstance(meeting.get("materials"), list) else [],
        "events": meeting.get("events") if isinstance(meeting.get("events"), list) else [],
        "phase": phase,
        "statusColor": _phase_color(phase),
        "issueCount": len(agenda_drafts) or max(1, len(issue_sources)),
        "archived": bool(meeting.get("archived", False)),
        "projectBound": bool(meeting.get("projectBound", False)),
        "agendaFrozen": bool(meeting.get("agendaFrozen", False)),
        "reviewDone": bool(meeting.get("reviewDone", False)),
        "archiveDone": bool(meeting.get("archiveDone", False)),
    }


def _public_meeting(meeting: dict, include_detail: bool = False) -> dict:
    """将会议字典转换为对外暴露的公开格式。

    去掉内部字段，仅保留前端需要的字段。可选是否包含详细信息
    （issueSources、agendaDrafts、materials、events 最近 100 条）。

    Args:
        meeting: 原始会议字典
        include_detail: 是否包含子数据详情

    Returns:
        公开格式的会议字典
    """
    normalized = _normalize_meeting(meeting)
    base = {
        "id": normalized.get("id"),
        "title": normalized.get("title", ""),
        "project": normalized.get("project", ""),
        "projectCode": normalized.get("projectCode", ""),
        "agenda": normalized.get("agenda", ""),
        "date": normalized.get("date", ""),
        "type": normalized.get("type", "普通企业会议"),
        "meetingNo": normalized.get("meetingNo", ""),
        "requireFullSignature": bool(normalized.get("requireFullSignature", False)),
        "meetingMode": normalized.get("meetingMode", "normal"),
        "activeAgendaId": normalized.get("activeAgendaId", ""),
        "creator": normalized.get("creator", ""),
        "createdAt": normalized.get("createdAt", ""),
        "updatedAt": normalized.get("updatedAt", ""),
        "phase": normalized.get("phase", "问题收集中"),
        "statusColor": normalized.get("statusColor", "default"),
        "issueCount": normalized.get("issueCount", 0),
        "participantCount": normalized.get("participantCount", 0),
        "projectBound": normalized.get("projectBound", False),
        "agendaFrozen": normalized.get("agendaFrozen", False),
        "reviewDone": normalized.get("reviewDone", False),
        "archiveDone": normalized.get("archiveDone", False),
        "archived": normalized.get("archived", False),
    }
    if include_detail:
        base.update({
            "issueSources": normalized.get("issueSources", []),
            "agendaDrafts": normalized.get("agendaDrafts", []),
            "materials": normalized.get("materials", []),
            "events": normalized.get("events", [])[-100:],
            "generatedRecords": normalized.get("generatedRecords", {}),
        })
    return base


def _safe_meeting_id(raw_id: Optional[str] = None) -> str:
    """生成安全的会议 ID（只保留字母数字下划线连字符）。

    Args:
        raw_id: 原始 ID 字符串，可为 None

    Returns:
        清理后的会议 ID，最多 80 字符；无效时生成带时间戳的默认 ID
    """
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "-", raw_id or "").strip("-")
    if cleaned:
        return cleaned[:80]
    return f"meeting-local-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"


def _safe_storage_filename(filename: str) -> str:
    """将文件名清理为安全的存储文件名（去除路径和非法字符）。

    Args:
        filename: 原始文件名

    Returns:
        安全的文件名，最多 120 字符
    """
    name = os.path.basename(filename or "meeting-material")
    name = re.sub(r"[\\/:*?\"<>|]+", "_", name).strip()
    return name[:120] or "meeting-material"


def _creator_from_user(user: dict) -> str:
    """根据用户字典生成创建者字符串（"部门 姓名" 格式）。

    Args:
        user: 用户字典

    Returns:
        "dept name" 格式的创建者字符串
    """
    dept = user.get("dept") or "总经理办公室"
    name = user.get("name") or user.get("username") or "当前用户"
    return f"{dept} {name}"


def _derive_agenda_drafts(meeting: dict) -> List[dict]:
    """从会议的 issueSources 自动推演议题草稿。

    根据会议模式（normal / major）采用不同的推演逻辑：
    - normal 模式：从句子的内容中提取标题，生成最多 6 个普通议题草稿
    - major 模式（或议题为空时）：基于最新素材生成带风险评估的主议题

    内置关键词检测（预算、资金、合同等）用于自动评估风险等级。

    Args:
        meeting: 会议字典

    Returns:
        推演出的议题草稿列表
    """
    issue_sources = meeting.get("issueSources") if isinstance(meeting.get("issueSources"), list) else []
    if not issue_sources:
        return meeting.get("agendaDrafts") or _default_agenda_drafts(meeting.get("project", "本地项目"), meeting.get("agenda", "待确认议题"))[:1]
    joined = "\n".join(str(item.get("content", "")) for item in issue_sources)
    project = meeting.get("project") or "本地项目"
    agenda = meeting.get("agenda") or "待确认议题"
    if meeting.get("meetingMode") == "normal":
        drafts = []
        seen_titles = set()
        for index, item in enumerate(issue_sources[-12:], start=1):
            content = re.sub(r"^(问题描述|图片素材|附件文字)[:：]\s*", "", str(item.get("content") or "").strip())
            content = re.sub(r"\s+", " ", content)
            if not content:
                continue
            title = re.split(r"[；;\n。]", content)[0].strip()[:34] or f"待确认讨论事项 {index}"
            title = re.sub(r"^(关于|需要|请|帮忙)", "", title).strip() or title
            if title in seen_titles:
                continue
            seen_titles.add(title)
            drafts.append({
                "id": f"issue-{len(drafts) + 1:03d}",
                "title": title,
                "source": f"{item.get('name') or '填报人'}提交",
                "project": "本次会议",
                "type": "普通会议议题",
                "risk": "普通",
                "status": "待确认",
                "todoText": "确认讨论范围，安排会议讨论",
                "changes": [
                    f"{item.get('time', '--:--')} 收集问题",
                    "本地规则按普通会议生成待讨论事项",
                ],
            })
            if len(drafts) >= 6:
                break
        if drafts:
            return drafts
    if agenda in {"待确认议题", "待梳理议题", "AI 会议问题收集"}:
        latest_content = str((issue_sources[-1] or {}).get("content") or "").strip()
        title_seed = re.sub(r"^(问题描述|图片素材|附件文字)[:：]\s*", "", latest_content)
        title_seed = re.split(r"[；;\n。]", title_seed)[0].strip()
        agenda = title_seed[:36] or "待讨论事项"
    risk = "高风险" if any(word in joined for word in ["预算", "资金", "合同", "采购", "改造", "追加", "重大"]) else "中风险"
    issue_type = "重大项目安排 / 大额度资金运作" if risk == "高风险" else "重要事项决策"
    sources = f"{len(issue_sources)} 条素材"
    changes = [
        f"{issue_sources[0].get('time', '--:--')} 首次收集问题",
        f"{issue_sources[-1].get('time', '--:--')} 最新补充进入议题池",
        "AI 建议绑定本地项目并创建会议",
    ]
    primary = {
        "id": "issue-001",
        "title": agenda,
        "source": sources,
        "project": project,
        "type": issue_type,
        "risk": risk,
        "status": "限期中",
        "changes": changes,
    }
    people_issue = None
    if any(word in joined for word in ["任免", "干部", "副总", "岗位"]):
        people_issue = {
            "id": "issue-002",
            "title": "干部任免事项审议",
            "source": "AI 从复合发言中拆分",
            "project": "待绑定干部档案",
            "type": "重要人事任免",
            "risk": "中风险",
            "status": "待确认",
            "changes": ["从问题收集池拆分独立审查线"],
        }
    return [primary, people_issue] if people_issue else [primary]


def _clean_agenda_check_transcript(text: str) -> str:
    """清理转写文本（合并连续空白字符并去除首尾空白）。

    用于议题比对前的文本预处理。

    Args:
        text: 原始转写文本

    Returns:
        清理后的文本
    """
    return re.sub(r"\s+", " ", str(text or "")).strip()


# ═══════════════════════════════════════════════════════════════════════════════
# 缓存层 — 会议 / 转写的内存缓存包装
# ═══════════════════════════════════════════════════════════════════════════════

def _load_meetings(include_details: bool = True) -> dict:
    """加载全部会议（带 2s TTL 内存缓存）。

    缓存命中直接返回；缓存未命中从 SQLite 加载并写入缓存。
    缓存始终包含完整详情——列表端点自行裁剪不需要的字段。

    Args:
        include_details: 保留参数，兼容旧调用。始终加载全量数据。

    Returns:
        {meeting_id: meeting_dict} 的字典
    """
    global _meetings_cache, _meetings_cache_time
    now = time.monotonic()
    if _meetings_cache is not None and (now - _meetings_cache_time) < _meetings_cache_ttl:
        if len(_meetings_cache) <= _meetings_cache_max_keys:
            return _meetings_cache
    _migrate_legacy_meeting_json_once()
    data = _db_fetch_meetings(include_details=True)
    if data:
        _meetings_cache = data
        _meetings_cache_time = now
        return data
    data = _default_meetings()
    _save_meetings(data)
    _meetings_cache = data
    _meetings_cache_time = now
    return data


def _save_meetings(data: dict):
    """保存全部会议（逐个 upsert，写后刷新缓存）。

    永远不会走 DELETE ALL 路径——每个会议独立 upsert，安全且高效。

    Args:
        data: {meeting_id: meeting_dict} 的完整字典
    """
    global _meetings_cache, _meetings_cache_time
    for meeting in data.values():
        _db_upsert_meeting(meeting)
    _meetings_cache = data
    _meetings_cache_time = time.monotonic()
    _maybe_checkpoint_wal()


def _load_meeting_transcripts() -> dict:
    """加载全部转写（带 1s TTL 内存缓存，有上限保护）。

    缓存未命中或超过上限阈值时从 SQLite 重建。

    Returns:
        {meeting_id: {transcripts: [...], events: [...]}} 的字典
    """
    global _transcripts_cache, _transcripts_cache_time
    now = time.monotonic()
    if _transcripts_cache is not None and (now - _transcripts_cache_time) < _transcripts_cache_ttl:
        total_rows = sum(len(m.get("transcripts", [])) for m in _transcripts_cache.values())
        if len(_transcripts_cache) <= _transcripts_cache_max_keys and total_rows <= _transcripts_cache_max_rows:
            return _transcripts_cache
    _migrate_legacy_meeting_json_once()
    data = _db_load_transcripts()
    _transcripts_cache = data
    _transcripts_cache_time = now
    return data


def _save_meeting_transcripts(data: dict):
    """保存全部转写（全量重建，写后刷新缓存）。

    Args:
        data: {meeting_id: {transcripts: [...], events: [...]}} 的完整字典
    """
    global _transcripts_cache, _transcripts_cache_time
    _db_save_transcripts(data)
    _transcripts_cache = data
    _transcripts_cache_time = time.monotonic()
    _maybe_checkpoint_wal()


def _invalidate_transcripts_cache():
    """清空转写缓存，强制下次读取从 DB 重建。

    在增量写入转写 chunk 后调用，确保轮询端拿到最新数据。
    """
    global _transcripts_cache, _transcripts_cache_time
    _transcripts_cache = None
    _transcripts_cache_time = 0.0


def _invalidate_meetings_cache():
    """清空会议缓存，强制下次读取从 DB 重建。

    在写入 generatedRecords 后调用，确保其他 worker 能读到最新数据。
    """
    global _meetings_cache, _meetings_cache_time
    _meetings_cache = None
    _meetings_cache_time = 0.0


# ══════════════════════════════════════════════════════════════════════════════════
# 声纹配置 CRUD
# ══════════════════════════════════════════════════════════════════════════════════

def _db_load_voiceprint_profiles() -> List[Dict]:
    """从数据库加载所有声纹配置。"""
    with _db_connect() as conn:
        rows = conn.execute(
            "SELECT * FROM voiceprint_profiles ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(row) for row in rows]


def _db_save_voiceprint_profile(profile: Dict):
    """保存或更新声纹配置。"""
    with _db_connect() as conn:
        with APP_DB_LOCK:
            conn.execute(
                """
                INSERT INTO voiceprint_profiles
                    (id, user_id, display_name, role, dept, embedding,
                     sample_duration, sample_count, created_at, updated_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    role = excluded.role,
                    dept = excluded.dept,
                    embedding = excluded.embedding,
                    sample_duration = excluded.sample_duration,
                    sample_count = excluded.sample_count,
                    updated_at = excluded.updated_at,
                    payload_json = excluded.payload_json
                """,
                (
                    profile["id"], profile["user_id"], profile["display_name"],
                    profile["role"], profile["dept"], profile["embedding"],
                    profile["sample_duration"], profile["sample_count"],
                    profile["created_at"], profile["updated_at"],
                    profile.get("payload_json", "{}"),
                ),
            )


def _db_delete_voiceprint_profile(profile_id: str):
    """删除指定声纹配置。"""
    with _db_connect() as conn:
        with APP_DB_LOCK:
            conn.execute("DELETE FROM voiceprint_profiles WHERE id = ?", (profile_id,))


def _db_get_voiceprint_by_user(user_id: str) -> Optional[Dict]:
    """按 user_id 获取声纹配置。"""
    with _db_connect() as conn:
        row = conn.execute(
            "SELECT * FROM voiceprint_profiles WHERE user_id = ? LIMIT 1",
            (user_id,),
        ).fetchone()
        return dict(row) if row else None

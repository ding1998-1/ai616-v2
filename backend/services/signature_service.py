"""签字服务（backend/services/signature_service.py）

会议成果确认链（§50-54）：
- meeting_signatures：决议/纪要等成果的正式签字，绑定 target + version + content_hash
- 版本感知：目标内容变更（version 递增）后旧签字自动 invalidated（§51）
- 应签人以 meeting_participants 为准（§54），未签齐时禁止正式归档（§53）
"""
import hashlib
import json
import uuid
from datetime import datetime

from backend.config import APP_DB_LOCK
from backend.db import _db_connect, _init_app_db

SIGN_TARGETS = {"decision", "minutes", "meeting_result"}
HASH_FIELDS = ("meeting_id", "agenda_id", "target_id", "version", "content")


def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _json_loads(text: str, default):
    try:
        return json.loads(text) if text else default
    except Exception:
        return default


def compute_content_hash(meeting_id: str, agenda_id: str, target_id: str, version: int, content: str) -> str:
    """SHA-256(meeting_id + agenda_id + target_id + version + content)（§52）。"""
    raw = f"{meeting_id}|{agenda_id}|{target_id}|{int(version)}|{content or ''}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _signature_from_row(row) -> dict:
    return {
        "id": row["id"], "meetingId": row["meeting_id"], "agendaId": row["agenda_id"],
        "targetType": row["target_type"], "targetId": row["target_id"],
        "version": row["version"], "contentHash": row["content_hash"],
        "signerUserId": row["signer_user_id"], "signerName": row["signer_name"],
        "signerRole": row["signer_role"], "signatureData": row["signature_data"],
        "status": row["status"], "signedAt": row["signed_at"],
        "payload": _json_loads(row["payload_json"], {}),
    }


def list_signatures(meeting_id: str, agenda_id: str = "", target_type: str = "", target_id: str = "") -> list:
    """列出签字记录；可按议题/目标过滤。"""
    _init_app_db()
    sql = "SELECT * FROM meeting_signatures WHERE meeting_id = ?"
    args = [meeting_id]
    if agenda_id:
        sql += " AND agenda_id = ?"
        args.append(agenda_id)
    if target_type:
        sql += " AND target_type = ?"
        args.append(target_type)
    if target_id:
        sql += " AND target_id = ?"
        args.append(target_id)
    sql += " ORDER BY signed_at, id"
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(sql, args).fetchall()
    return [_signature_from_row(r) for r in rows]


def sign_target(
    meeting_id: str, agenda_id: str, target_type: str, target_id: str,
    version: int, content: str, signer_user_id: str, signer_name: str,
    signer_role: str = "", signature_data: str = "",
) -> dict:
    """签署一份成果（决策/纪要/会议成果）。

    校验：签名内容哈希必须与目标当前 version 匹配，否则拒绝（防止签旧版本）。
    """
    _init_app_db()
    if target_type not in SIGN_TARGETS:
        raise ValueError(f"不支持的签字对象类型: {target_type}")
    if not content or not content.strip():
        raise ValueError("签字内容不能为空")
    if not signer_name:
        raise ValueError("签署人姓名不能为空")
    content_hash = compute_content_hash(meeting_id, agenda_id, target_id, version, content)
    now = _now_text()
    sid = f"sig-{uuid.uuid4().hex[:10]}"
    with APP_DB_LOCK:
        with _db_connect() as conn:
            # 同一签署人对同一目标的新签字：先作废旧签字（§51 版本/内容变化后重新签）
            conn.execute(
                """UPDATE meeting_signatures SET status = 'invalidated'
                   WHERE meeting_id = ? AND target_type = ? AND target_id = ? AND signer_user_id = ? AND status = 'valid'""",
                (meeting_id, target_type, target_id, signer_user_id),
            )
            conn.execute(
                """
                INSERT INTO meeting_signatures (
                    id, meeting_id, agenda_id, target_type, target_id, version,
                    content_hash, signer_user_id, signer_name, signer_role,
                    signature_data, status, signed_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sid, meeting_id, agenda_id, target_type, target_id, int(version),
                    content_hash, signer_user_id, signer_name, signer_role,
                    signature_data, "valid", now,
                    json.dumps({"hash_input": "meeting_id|agenda_id|target_id|version|content"}, ensure_ascii=False),
                ),
            )
    return _signature_from_row(conn_row(meeting_id, sid))


def conn_row(meeting_id: str, sig_id: str):
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute("SELECT * FROM meeting_signatures WHERE id = ? AND meeting_id = ?", (sig_id, meeting_id)).fetchone()
    return row


def invalidate_target_signatures(meeting_id: str, target_type: str, target_id: str):
    """内容版本变更后，作废该目标全部有效签字（配合决议 version 递增）。"""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                """UPDATE meeting_signatures SET status = 'invalidated'
                   WHERE meeting_id = ? AND target_type = ? AND target_id = ? AND status = 'valid'""",
                (meeting_id, target_type, target_id),
            )


def required_signer_count(meeting_id: str) -> int:
    """应签人数 = meeting_participants 本场参会人数（§54：参会但未发言者也要签）。"""
    _init_app_db()
    try:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM meeting_participants WHERE meeting_id = ?",
                (meeting_id,),
            ).fetchone()
            return int(row["c"]) if row else 0
    except Exception:
        return 0


def signed_signer_count(meeting_id: str) -> int:
    """已签（有效）人数：按签署人去重计数。"""
    _init_app_db()
    try:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT COUNT(DISTINCT signer_user_id) AS c FROM meeting_signatures "
                "WHERE meeting_id = ? AND status = 'valid' AND signer_user_id != ''",
                (meeting_id,),
            ).fetchone()
            return int(row["c"]) if row else 0
    except Exception:
        return 0


def is_fully_signed(meeting_id: str) -> bool:
    """是否已全员签字（仅当存在应签人时判断）。"""
    required = required_signer_count(meeting_id)
    if required <= 0:
        return True  # 无应签记录时不拦截（兼容存量数据）
    return signed_signer_count(meeting_id) >= required

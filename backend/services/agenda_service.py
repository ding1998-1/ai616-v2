"""议程服务（backend/services/agenda_service.py）

议题是会议的最小业务单元。本模块提供：
- meeting_agendas 表的 CRUD（正式议题实体，稳定 agenda_id）
- 旧 agendaDrafts 的兼容物化迁移（双读：表空时从会议 agendaDrafts 派生）
- 当前议题切换（active_agenda_id 后端持久化，结束旧议题 / 激活新议题）
- 会中临时议题（agenda_type=temporary, source=in_meeting）

依赖：backend/db.py 的 SQLite 连接与全局锁。
"""
import json
import uuid
from datetime import datetime

from backend.config import APP_DB_LOCK
from backend.db import _db_connect, _init_app_db

AGENDA_STATUS_ORDER = [
    "draft", "scheduled", "in_progress", "discussed",
    "decision_pending", "confirmed", "signed", "archived",
]

# 议题决议的状态不是普通议题状态。这里保留 ``decision_pending`` 作为
# 存量数据别名，但新写入统一使用 draft，避免“待确认”和“已确认”混用。
DECISION_STATUS_ALIASES = {
    "decision_pending": "draft",
    "pending": "draft",
    "待确认": "draft",
    "草案": "draft",
    "确认": "confirmed",
    "否决": "rejected",
    "驳回": "rejected",
    "修改": "draft",
}
DECISION_STATUSES = {"draft", "confirmed", "rejected", "signing", "signed", "archived"}
DECISION_STATUS_TRANSITIONS = {
    "draft": {"draft", "confirmed", "rejected"},
    "confirmed": {"confirmed", "signing", "draft"},
    "rejected": {"rejected", "draft"},
    "signing": {"signing", "signed", "draft"},
    "signed": {"signed", "archived", "draft"},
    "archived": {"archived"},
}


def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _new_agenda_id() -> str:
    return f"ag-{uuid.uuid4().hex[:10]}"


def _agenda_from_row(row) -> dict:
    return {
        "id": row["id"],
        "meetingId": row["meeting_id"],
        "agendaNo": row["agenda_no"],
        "title": row["title"],
        "description": row["description"],
        "agendaType": row["agenda_type"],
        "source": row["source"],
        "confidentialityLevel": row["confidentiality_level"],
        "permissionLevel": row["permission_level"],
        "proposerUserId": row["proposer_user_id"],
        "ownerUserId": row["owner_user_id"],
        "status": row["status"],
        "sortOrder": row["sort_order"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "payload": _json_loads(row["payload_json"], {}),
    }


def _json_loads(text: str, default):
    try:
        return json.loads(text) if text else default
    except Exception:
        return default


def _json_dumps(data) -> str:
    try:
        return json.dumps(data, ensure_ascii=False)
    except Exception:
        return "{}"


def _normalize_decision_status(status: str) -> str:
    """将接口/存量状态转换为决议状态机使用的 canonical 值。"""
    value = str(status or "draft").strip().lower()
    return DECISION_STATUS_ALIASES.get(value, value)


def _validate_decision_status(status: str) -> str:
    value = _normalize_decision_status(status)
    if value not in DECISION_STATUSES:
        raise ValueError(f"不支持的决议状态: {status}")
    return value


# ────────────────────────────────────────────────────────────────
# 读取
# ────────────────────────────────────────────────────────────────

def list_meeting_agendas(meeting_id: str) -> list:
    """列出会议全部正式议题；表为空时先从 agendaDrafts 兼容物化。"""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                "SELECT * FROM meeting_agendas WHERE meeting_id = ? ORDER BY sort_order, agenda_no, created_at",
                (meeting_id,),
            ).fetchall()
    if not rows:
        _ensure_agendas_from_drafts(meeting_id)
        with APP_DB_LOCK:
            with _db_connect() as conn:
                rows = conn.execute(
                    "SELECT * FROM meeting_agendas WHERE meeting_id = ? ORDER BY sort_order, agenda_no, created_at",
                    (meeting_id,),
                ).fetchall()
    return [_agenda_from_row(r) for r in rows]


def get_meeting_agenda(meeting_id: str, agenda_id: str):
    """获取单个议题，不存在返回 None。"""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT * FROM meeting_agendas WHERE id = ? AND meeting_id = ?",
                (agenda_id, meeting_id),
            ).fetchone()
    return _agenda_from_row(row) if row else None


def get_meeting_active_agenda(meeting_id: str):
    """读取会议当前议题（meetings.active_agenda_id 后端持久化）。"""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT active_agenda_id FROM meetings WHERE id = ?", (meeting_id,)
            ).fetchone()
            active_id = (row["active_agenda_id"] if row else "") or ""
            if not active_id:
                return None
            agenda_row = conn.execute(
                "SELECT * FROM meeting_agendas WHERE id = ? AND meeting_id = ?",
                (active_id, meeting_id),
            ).fetchone()
    return _agenda_from_row(agenda_row) if agenda_row else None


# ────────────────────────────────────────────────────────────────
# 兼容迁移：agendaDrafts → meeting_agendas（旧数据继续可用，双读）
# ────────────────────────────────────────────────────────────────

def _ensure_agendas_from_drafts(meeting_id: str):
    """meeting_agendas 为空时，从会议 agendaDrafts 物化正式议题（幂等）。

    旧数据不删除；后续以 meeting_agendas 为准，agendaDrafts 仅保留作为创建期草稿。
    注意：不在 APP_DB_LOCK 内调用 _save_meetings（其内部会再次取锁，导致死锁）。
    """
    from backend.db import _load_meetings
    _init_app_db()
    # 锁外读取会议（含 agendaDrafts 与当前 activeAgendaId）
    meetings = _load_meetings()
    meeting = meetings.get(meeting_id) or {}
    drafts = meeting.get("agendaDrafts") or []
    if not drafts:
        return
    now = _now_text()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            cnt = conn.execute(
                "SELECT COUNT(*) AS c FROM meeting_agendas WHERE meeting_id = ?", (meeting_id,)
            ).fetchone()["c"]
            if cnt:
                return
            for idx, draft in enumerate(drafts):
                aid = f"ag-{meeting_id[:40]}-{idx + 1:03d}"
                conn.execute(
                    """
                    INSERT INTO meeting_agendas (
                        id, meeting_id, agenda_no, title, description, agenda_type,
                        source, confidentiality_level, permission_level,
                        proposer_user_id, owner_user_id, status, sort_order,
                        created_at, updated_at, started_at, ended_at, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        aid, meeting_id, idx + 1,
                        draft.get("title") or f"议题 {idx + 1}",
                        draft.get("description") or "",
                        "standard",
                        draft.get("source") or "prepared",
                        draft.get("confidentialityLevel") or "normal",
                        draft.get("permissionLevel") or "",
                        draft.get("proposerUserId") or "",
                        draft.get("ownerUserId") or draft.get("project") or "",
                        "scheduled", idx,
                        now, now, "", "",
                        _json_dumps({"from": "agendaDrafts", "draft_id": draft.get("id", "")}),
                    ),
                )
            # 默认激活首个议题（仅当会议尚未设置 active_agenda_id）
            if not meeting.get("activeAgendaId"):
                conn.execute(
                    "UPDATE meetings SET active_agenda_id = ? WHERE id = ?",
                    (f"ag-{meeting_id[:40]}-001", meeting_id),
                )


# ────────────────────────────────────────────────────────────────
# 写操作
# ────────────────────────────────────────────────────────────────

def create_meeting_agenda(
    meeting_id: str,
    title: str,
    description: str = "",
    agenda_type: str = "standard",
    source: str = "prepared",
    confidentiality_level: str = "normal",
    permission_level: str = "",
    proposer_user_id: str = "",
    owner_user_id: str = "",
) -> dict:
    """新增正式议题（含会中临时议题：agenda_type=temporary, source=in_meeting）。"""
    _init_app_db()
    if not title or not title.strip():
        raise ValueError("议题名称不能为空")
    now = _now_text()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            # 计算下一序号
            row = conn.execute(
                "SELECT COALESCE(MAX(sort_order), 0) AS mx FROM meeting_agendas WHERE meeting_id = ?",
                (meeting_id,),
            ).fetchone()
            next_sort = int(row["mx"]) + 1
            aid = _new_agenda_id()
            conn.execute(
                """
                INSERT INTO meeting_agendas (
                    id, meeting_id, agenda_no, title, description, agenda_type,
                    source, confidentiality_level, permission_level,
                    proposer_user_id, owner_user_id, status, sort_order,
                    created_at, updated_at, started_at, ended_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    aid, meeting_id, next_sort, title.strip(), description,
                    agenda_type, source, confidentiality_level, permission_level,
                    proposer_user_id, owner_user_id,
                    "in_progress" if agenda_type == "temporary" else "scheduled",
                    next_sort, now, now, "", "",
                    _json_dumps({"created_in_meeting": agenda_type == "temporary"}),
                ),
            )
            return _agenda_from_row(conn.execute(
                "SELECT * FROM meeting_agendas WHERE id = ?", (aid,)
            ).fetchone())


def update_meeting_agenda(meeting_id: str, agenda_id: str, patch: dict) -> dict:
    """字段级更新议题（title/description/confidentialityLevel/proposer/owner/status 等）。"""
    _init_app_db()
    allowed = {
        "title", "description", "agendaType", "confidentialityLevel",
        "permissionLevel", "proposerUserId", "ownerUserId", "status", "sortOrder",
    }
    clean = {k: v for k, v in (patch or {}).items() if k in allowed and v is not None}
    if not clean:
        raise ValueError("没有可更新的字段")
    now = _now_text()
    sets = []
    args = []
    col_map = {
        "title": "title", "description": "description", "agendaType": "agenda_type",
        "confidentialityLevel": "confidentiality_level", "permissionLevel": "permission_level",
        "proposerUserId": "proposer_user_id", "ownerUserId": "owner_user_id",
        "status": "status", "sortOrder": "sort_order",
    }
    for k, v in clean.items():
        sets.append(f"{col_map[k]} = ?")
        args.append(v)
    sets.append("updated_at = ?")
    args.append(now)
    args += [agenda_id, meeting_id]
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                f"UPDATE meeting_agendas SET {', '.join(sets)} WHERE id = ? AND meeting_id = ?",
                args,
            )
            row = conn.execute(
                "SELECT * FROM meeting_agendas WHERE id = ? AND meeting_id = ?",
                (agenda_id, meeting_id),
            ).fetchone()
    if not row:
        raise KeyError("议题不存在")
    return _agenda_from_row(row)


def delete_meeting_agenda(meeting_id: str, agenda_id: str):
    """删除议题；若为当前议题则同时清空 active_agenda_id。"""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                "DELETE FROM meeting_agendas WHERE id = ? AND meeting_id = ?",
                (agenda_id, meeting_id),
            )
            conn.execute(
                "UPDATE meetings SET active_agenda_id = '' WHERE id = ? AND active_agenda_id = ?",
                (meeting_id, agenda_id),
            )


def activate_meeting_agenda(meeting_id: str, agenda_id: str) -> dict:
    """切换当前议题（§28：结束当前 → 新议题 started_at → active_agenda_id 持久化）。

    仅主持人/秘书等具备 agenda:activate 权限者调用（由路由层校验）。
    """
    _init_app_db()
    now = _now_text()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT * FROM meeting_agendas WHERE id = ? AND meeting_id = ?",
                (agenda_id, meeting_id),
            ).fetchone()
            if not row:
                raise KeyError("议题不存在")
            # 结束当前议题
            cur = conn.execute(
                "SELECT active_agenda_id FROM meetings WHERE id = ?", (meeting_id,)
            ).fetchone()
            prev_id = (cur["active_agenda_id"] if cur else "") or ""
            if prev_id and prev_id != agenda_id:
                conn.execute(
                    "UPDATE meeting_agendas SET status = 'discussed', ended_at = ?, updated_at = ? WHERE id = ?",
                    (now, now, prev_id),
                )
            # 激活新议题（同议题重复激活视为继续）
            new_status = "in_progress" if row["status"] in ("scheduled", "discussed", "in_progress") else row["status"]
            conn.execute(
                "UPDATE meeting_agendas SET status = ?, started_at = CASE WHEN ? = '' THEN started_at ELSE ? END, ended_at = '', updated_at = ? WHERE id = ?",
                (new_status, row["started_at"], now, now, agenda_id),
            )
            conn.execute(
                "UPDATE meetings SET active_agenda_id = ?, updated_at = ? WHERE id = ?",
                (agenda_id, now, meeting_id),
            )
            result = _agenda_from_row(conn.execute(
                "SELECT * FROM meeting_agendas WHERE id = ?", (agenda_id,)
            ).fetchone())
            result["previousAgendaId"] = prev_id or None
            return result


# ────────────────────────────────────────────────────────────────
# 议题级会议记录（讨论过程）与决议（最终结果）—— §37-41
# ────────────────────────────────────────────────────────────────

def list_agenda_records(meeting_id: str, agenda_id: str = "") -> list:
    """列出议题讨论记录（record=讨论过程）。agenda_id 为空时返回整场。"""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            if agenda_id:
                rows = conn.execute(
                    "SELECT * FROM meeting_agenda_records WHERE meeting_id = ? AND agenda_id = ? ORDER BY created_at, id",
                    (meeting_id, agenda_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM meeting_agenda_records WHERE meeting_id = ? ORDER BY created_at, id",
                    (meeting_id,),
                ).fetchall()
    return [{
        "id": r["id"], "meetingId": r["meeting_id"], "agendaId": r["agenda_id"],
        "transcriptId": r["transcript_id"], "speakerUserId": r["speaker_user_id"],
        "participantId": r["participant_id"], "speakerName": r["speaker_name"],
        "recordType": r["record_type"], "content": r["content"],
        "correctedContent": r["corrected_content"], "source": r["source"],
        "createdAt": r["created_at"],
        "payload": _json_loads(r["payload_json"], {}),
    } for r in rows]


def create_agenda_record(
    meeting_id: str, agenda_id: str, content: str,
    speaker_name: str = "", speaker_user_id: str = "",
    participant_id: str = "", record_type: str = "discussion",
    transcript_id: str = "", source: str = "manual",
) -> dict:
    """新增一条议题讨论记录。"""
    _init_app_db()
    if not content or not content.strip():
        raise ValueError("记录内容不能为空")
    now = _now_text()
    rid = f"rec-{uuid.uuid4().hex[:10]}"
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                """
                INSERT INTO meeting_agenda_records (
                    id, meeting_id, agenda_id, transcript_id, speaker_user_id,
                    participant_id, speaker_name, record_type, content,
                    corrected_content, source, created_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rid, meeting_id, agenda_id, transcript_id, speaker_user_id,
                    participant_id, speaker_name, record_type, content.strip(),
                    "", source, now, _json_dumps({"auto_from_transcript": source == "auto"}),
                ),
            )
            row = conn.execute(
                "SELECT * FROM meeting_agenda_records WHERE id = ?", (rid,)
            ).fetchone()
    return {
        "id": row["id"], "meetingId": row["meeting_id"], "agendaId": row["agenda_id"],
        "transcriptId": row["transcript_id"], "speakerUserId": row["speaker_user_id"],
        "participantId": row["participant_id"], "speakerName": row["speaker_name"],
        "recordType": row["record_type"], "content": row["content"],
        "correctedContent": row["corrected_content"], "source": row["source"],
        "createdAt": row["created_at"], "payload": _json_loads(row["payload_json"], {}),
    }


def list_agenda_decisions(meeting_id: str, agenda_id: str = "") -> list:
    """列出议题决议（decision=最终结果）。agenda_id 为空时返回整场。"""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            if agenda_id:
                rows = conn.execute(
                    "SELECT * FROM meeting_agenda_decisions WHERE meeting_id = ? AND agenda_id = ? ORDER BY decision_no, created_at",
                    (meeting_id, agenda_id),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM meeting_agenda_decisions WHERE meeting_id = ? ORDER BY decision_no, created_at",
                    (meeting_id,),
                ).fetchall()
    return [{
        "id": r["id"], "meetingId": r["meeting_id"], "agendaId": r["agenda_id"],
        "decisionNo": r["decision_no"], "title": r["title"], "content": r["content"],
        "status": r["status"], "source": r["source"], "version": r["version"],
        "createdBy": r["created_by"], "createdAt": r["created_at"],
        "updatedAt": r["updated_at"], "confirmedAt": r["confirmed_at"],
        "payload": _json_loads(r["payload_json"], {}),
    } for r in rows]


def create_agenda_decision(
    meeting_id: str, agenda_id: str, title: str, content: str,
    created_by: str = "", source: str = "manual", status: str = "draft",
) -> dict:
    """新增决议（正式绑定 agenda_id，version 从 1 开始）。"""
    _init_app_db()
    if not title or not title.strip():
        raise ValueError("决议标题不能为空")
    status = _validate_decision_status(status)
    if status in {"signing", "signed", "archived"}:
        raise ValueError("新建决议只能处于草案、已确认或已否决状态")
    now = _now_text()
    confirmed_at = now if status == "confirmed" else ""
    did = f"dec-{uuid.uuid4().hex[:10]}"
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM meeting_agenda_decisions WHERE meeting_id = ? AND agenda_id = ?",
                (meeting_id, agenda_id),
            ).fetchone()
            next_no = int(row["c"]) + 1
            decision_no = f"D-{next_no:03d}"
            conn.execute(
                """
                INSERT INTO meeting_agenda_decisions (
                    id, meeting_id, agenda_id, decision_no, title, content,
                    status, source, version, created_by, created_at, updated_at,
                    confirmed_at, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    did, meeting_id, agenda_id, decision_no, title.strip(),
                    content or "", status, source, 1, created_by, now, now, confirmed_at,
                    _json_dumps({}),
                ),
            )
            row = conn.execute(
                "SELECT * FROM meeting_agenda_decisions WHERE id = ?", (did,)
            ).fetchone()
    return {
        "id": row["id"], "meetingId": row["meeting_id"], "agendaId": row["agenda_id"],
        "decisionNo": row["decision_no"], "title": row["title"], "content": row["content"],
        "status": row["status"], "source": row["source"], "version": row["version"],
        "createdBy": row["created_by"], "createdAt": row["created_at"],
        "updatedAt": row["updated_at"], "confirmedAt": row["confirmed_at"],
        "payload": _json_loads(row["payload_json"], {}),
    }


def update_agenda_decision(meeting_id: str, agenda_id: str, decision_id: str, patch: dict) -> dict:
    """更新决议并执行确认/修改/否决状态机。

    - 确认：``draft -> confirmed``，写入 ``confirmed_at``；
    - 否决：``draft -> rejected``，清空确认时间；
    - 修改：标题或正文变化时 version + 1，自动退回 draft，旧签字失效；
    - signing/signed/archived 只能按顺序推进，已归档内容不可修改。

    内容变化与状态确认不能在一次请求中绕过“重新确认”步骤；即使客户端
    同时传入 status=confirmed，内容变化仍会回到 draft。
    """
    _init_app_db()
    allowed = {"title", "content", "status"}
    clean = {k: v for k, v in (patch or {}).items() if k in allowed and v is not None}
    if not clean:
        raise ValueError("没有可更新的字段")
    now = _now_text()
    bump = False
    with APP_DB_LOCK:
        with _db_connect() as conn:
            row = conn.execute(
                "SELECT * FROM meeting_agenda_decisions WHERE id = ? AND meeting_id = ? AND agenda_id = ?",
                (decision_id, meeting_id, agenda_id),
            ).fetchone()
            if not row:
                raise KeyError("决议不存在")
            bump = any(k in clean for k in ("title", "content")) and (
                clean.get("title", row["title"]) != row["title"]
                or clean.get("content", row["content"]) != row["content"]
            )
            current_status = _normalize_decision_status(row["status"])
            if current_status not in DECISION_STATUSES:
                raise ValueError(f"存量决议状态无效: {row['status']}")

            requested_status = None
            if "status" in clean:
                requested_status = _validate_decision_status(clean["status"])

            if current_status == "archived" and bump:
                raise ValueError("已归档决议不可修改")

            if bump:
                # 任何内容修改都必须重新走确认，不能在同一次 patch 中把
                # 草案直接伪装成已确认版本。
                if requested_status not in (None, "draft"):
                    raise ValueError("决议内容已修改，请保存草案后重新确认")
                next_status = "draft"
            elif requested_status is None:
                next_status = row["status"]
            else:
                if requested_status not in DECISION_STATUS_TRANSITIONS[current_status]:
                    raise ValueError(
                        f"决议状态不能从 {row['status']} 变更为 {requested_status}"
                    )
                next_status = requested_status

            new_version = int(row["version"]) + 1 if bump else int(row["version"])
            confirmed_at = row["confirmed_at"] or ""
            payload = _json_loads(row["payload_json"], {})
            if not isinstance(payload, dict):
                payload = {}
            if bump:
                confirmed_at = ""
                payload.pop("confirmedBy", None)
                payload["lastAction"] = "modified"
                payload["lastModifiedAt"] = now
            elif next_status == "confirmed":
                if current_status != "confirmed" or not confirmed_at:
                    confirmed_at = now
                payload["lastAction"] = "confirmed"
                payload["confirmedAt"] = confirmed_at
            elif next_status == "rejected":
                confirmed_at = ""
                payload.pop("confirmedAt", None)
                payload["lastAction"] = "rejected"
                payload["rejectedAt"] = now
            elif next_status == "draft" and current_status != "draft":
                confirmed_at = ""
                payload.pop("confirmedAt", None)
                payload["lastAction"] = "reopened"

            sets = [
                "title = ?", "content = ?", "status = ?", "updated_at = ?",
                "version = ?", "confirmed_at = ?", "payload_json = ?",
            ]
            args = [
                clean.get("title", row["title"]), clean.get("content", row["content"]),
                next_status, now, new_version, confirmed_at, _json_dumps(payload), decision_id,
            ]
            conn.execute(f"UPDATE meeting_agenda_decisions SET {', '.join(sets)} WHERE id = ?", args)
            result_row = conn.execute(
                "SELECT * FROM meeting_agenda_decisions WHERE id = ?", (decision_id,)
            ).fetchone()
    if bump:
        from backend.services.signature_service import invalidate_target_signatures
        invalidate_target_signatures(meeting_id, "decision", decision_id)
    return {
        "id": result_row["id"], "meetingId": result_row["meeting_id"], "agendaId": result_row["agenda_id"],
        "decisionNo": result_row["decision_no"], "title": result_row["title"],
        "content": result_row["content"], "status": result_row["status"],
        "source": result_row["source"], "version": result_row["version"],
        "createdBy": result_row["created_by"], "createdAt": result_row["created_at"],
        "updatedAt": result_row["updated_at"], "confirmedAt": result_row["confirmed_at"],
        "payload": _json_loads(result_row["payload_json"], {}),
    }


def delete_agenda_decision(meeting_id: str, agenda_id: str, decision_id: str):
    """删除决议。"""
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            conn.execute(
                "DELETE FROM meeting_agenda_decisions WHERE id = ? AND meeting_id = ? AND agenda_id = ?",
                (decision_id, meeting_id, agenda_id),
            )


def generate_decisions_for_agenda(meeting_id: str, agenda_id: str, created_by: str = "") -> dict:
    """按议题从转写/记录提取决议候选（本地规则，关键词辅助——正式数据仍以 agenda_id 为准）。

    规则：扫描该议题下 transcripts，取含表决/结论关键词的句子生成草稿决议。
    不整场生成再猜测归属（§40 逐议题原则）。
    """
    _init_app_db()
    keywords = ("同意", "通过", "批准", "决定", "暂缓", "否决", "原则同意", "审议通过")
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                "SELECT speaker_name, transcript FROM meeting_transcripts "
                "WHERE meeting_id = ? AND agenda_id = ? ORDER BY server_time",
                (meeting_id, agenda_id),
            ).fetchall()
    sentences = []
    for r in rows:
        text = (r["transcript"] or "").strip()
        if not text:
            continue
        for kw in keywords:
            idx = text.find(kw)
            if idx >= 0:
                sentences.append({"speaker": r["speaker_name"] or "", "text": text[max(0, idx - 30):idx + 40]})
                break
    created = []
    for i, s in enumerate(sentences[:5]):
        title = f"{'决议'}{i + 1}（{s['speaker'] or '发言人'}）"
        created.append(create_agenda_decision(
            meeting_id, agenda_id, title, s["text"], created_by=created_by, source="auto", status="draft",
        ))
    return {"agendaId": agenda_id, "generated": len(created), "decisions": created}

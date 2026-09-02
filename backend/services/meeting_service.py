"""会议容器服务：CRUD、阶段推进和归档。"""

from datetime import datetime

from backend.config import MEETINGS_LOCK
from backend.db import (
    _check_meeting_access,
    _derive_agenda_drafts,
    _load_meetings,
    _public_meeting,
    _safe_meeting_id,
    _save_meetings,
)
from backend.deps import _now_text
from backend.deps import _build_meeting_from_request


PHASE_BY_STAGE = {"collect": "会前确认", "meeting": "会中记录", "audit": "会后终审", "archive": "已归档"}


def list_meetings(include_archived: bool = False, limit: int = 50, offset: int = 0) -> dict:
    rows = [_public_meeting(item, include_detail=False) for item in _load_meetings().values()]
    if not include_archived:
        rows = [item for item in rows if not item.get("archived")]
    rows.sort(key=lambda item: item.get("updatedAt") or item.get("createdAt") or "", reverse=True)
    total = len(rows)
    limit = max(0, min(int(limit), 1000))
    offset = max(0, int(offset))
    page = rows[offset:offset + limit] if limit > 0 else rows[offset:]
    return {"meetings": page, "total": total, "limit": limit, "offset": offset}


def get_meeting(meeting_id: str) -> dict | None:
    return _load_meetings().get(_safe_meeting_id(meeting_id))


def upsert_meeting(body, user: dict) -> tuple[dict, bool]:
    safe_id = _safe_meeting_id(body.id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        existing = meetings.get(safe_id)
        explicit_fields = {**body.model_dump(exclude_unset=True), "id": safe_id}
        normalized_body = body.model_copy(update={"id": safe_id})
        meeting = _build_meeting_from_request(normalized_body, user, existing, explicit_fields)
        meeting["agendaDrafts"] = _derive_agenda_drafts(meeting)
        meetings[meeting["id"]] = meeting
        _save_meetings(meetings)
    return meeting, existing is not None


def patch_meeting(meeting_id: str, patch: dict, user: dict) -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)
        if meeting.get("agendaFrozen") and user.get("role") != "admin":
            blocked = [key for key in patch if key in {"agendaDrafts", "agenda", "issueSources", "agendaTitle", "agendaFrozen"}]
            if blocked:
                raise PermissionError(f"议题已冻结，无法修改：{', '.join(blocked)}。如需修改请联系管理员。")
        if patch.get("meeting_mode"):
            patch["meetingMode"] = patch.pop("meeting_mode")
        if patch.get("project_code"):
            patch["projectCode"] = patch.pop("project_code")
        patch.pop("project_code", None)
        patch.pop("meeting_mode", None)
        for key, value in patch.items():
            if value is not None:
                meeting[key] = value
        meeting["updatedAt"] = _now_text()
        if "issueSources" in patch and "agendaDrafts" not in patch:
            meeting["agendaDrafts"] = _derive_agenda_drafts(meeting)
        meetings[safe_id] = meeting
        _save_meetings(meetings)
    return meeting


def update_stage(
    meeting_id: str,
    stage: str,
    phase: str,
    user: dict,
    override_reason: str = "",
) -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    stage = stage if stage in PHASE_BY_STAGE else "collect"
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)

        # 声纹属于会后说话人校准能力，不是开会门槛。现场只要求身份与录音
        # 客户端绑定可靠；缺少声纹时仍允许开会、终审和进入签字流程。
        if stage == "archive":
            from backend.services.signature_service import is_fully_signed, required_signer_count, signed_signer_count
            from backend.services.outcome_service import authorize_basis_override

            records = dict(meeting.get("generatedRecords") or {})
            gate, override = authorize_basis_override(
                records, meeting, user, action="进入归档", reason=override_reason,
            )
            records["basisGate"] = gate
            if override:
                meeting["generatedRecords"] = records
            if not is_fully_signed(safe_id):
                raise ValueError(
                    f"尚未全员签字（已签 {signed_signer_count(safe_id)} / 应签 {required_signer_count(safe_id)}），无法正式归档"
                )

        meeting["phase"] = phase or PHASE_BY_STAGE[stage]
        if stage in {"meeting", "audit", "archive"}:
            meeting["projectBound"] = True
            meeting["agendaFrozen"] = True
        if stage == "archive":
            meeting["reviewDone"] = True
            meeting["archiveDone"] = True
        event = {"id": f"stage_{datetime.now().strftime('%Y%m%d%H%M%S%f')}", "type": "stage", "stage": stage, "phase": meeting["phase"], "serverTime": _now_text()}
        meeting.setdefault("events", []).append(event)
        meeting["events"] = meeting["events"][-200:]
        meeting["updatedAt"] = event["serverTime"]
        meetings[safe_id] = meeting
        _save_meetings(meetings)
    return meeting


def archive_meeting(meeting_id: str, user: dict, override_reason: str = "") -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)
        from backend.services.signature_service import is_fully_signed, required_signer_count, signed_signer_count
        from backend.services.outcome_service import authorize_basis_override

        records = dict(meeting.get("generatedRecords") or {})
        gate, override = authorize_basis_override(
            records, meeting, user, action="正式归档", reason=override_reason,
        )
        records["basisGate"] = gate
        if override:
            meeting["generatedRecords"] = records
        if not is_fully_signed(safe_id):
            raise ValueError(f"尚未全员签字（已签 {signed_signer_count(safe_id)} / 应签 {required_signer_count(safe_id)}），无法正式归档")
        meeting["archived"] = True
        meeting["updatedAt"] = _now_text()
        meetings[safe_id] = meeting
        _save_meetings(meetings)
    return meeting

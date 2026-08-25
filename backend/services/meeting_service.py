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
from backend.services.voiceprint_preflight_service import require_meeting_voiceprints


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


def update_stage(meeting_id: str, stage: str, phase: str, user: dict) -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    stage = stage if stage in PHASE_BY_STAGE else "collect"
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)

        # 声纹是会中多人录音与说话人归属的前置条件。必须先完成会议
        # 存在性和访问权校验，再执行预检，避免无权用户探测参会人信息。
        # 预检发生在阶段写入前；缺失时不会改变会议状态。
        # 允许空参会名单通过（创建会议时可以暂不指定参会人）；一旦已有名单，
        # require_meeting_voiceprints 会返回具体缺失人员并抛出 409 语义异常。
        if stage in {"meeting", "audit", "archive"}:
            require_meeting_voiceprints(safe_id)

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


def archive_meeting(meeting_id: str, user: dict) -> dict:
    safe_id = _safe_meeting_id(meeting_id)
    with MEETINGS_LOCK:
        meetings = _load_meetings()
        meeting = meetings.get(safe_id)
        if not meeting:
            raise KeyError("会议不存在")
        _check_meeting_access(user, meeting)
        if meeting.get("requireFullSignature"):
            from backend.services.signature_service import is_fully_signed, required_signer_count, signed_signer_count

            if not is_fully_signed(safe_id):
                raise ValueError(f"尚未全员签字（已签 {signed_signer_count(safe_id)} / 应签 {required_signer_count(safe_id)}），无法正式归档")
        meeting["archived"] = True
        meeting["updatedAt"] = _now_text()
        meetings[safe_id] = meeting
        _save_meetings(meetings)
    return meeting

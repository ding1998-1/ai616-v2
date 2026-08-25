"""会前声纹预检服务。

声纹是会中多人录音和会后说话人标注的前置条件。这里仅检查既有的
``meeting_participants`` 与 ``voiceprint_profiles`` 数据，不新增表，也不
触发模型加载；真正的 embedding 提取仍由 :mod:`backend.voiceprint` 负责。

路由层可以捕获 :class:`VoiceprintPreflightError` 并转换成 HTTP 409。异常
本身携带结构化 ``detail``，因此前端可以直接展示缺失的参会人和跳转到
声纹录入入口。
"""

from __future__ import annotations

from typing import Any

from backend.config import APP_DB_LOCK
from backend.db import _db_connect, _init_app_db


class VoiceprintPreflightError(ValueError):
    """会前声纹不完整时抛出的可路由化错误。

    ``status_code`` 固定为 409，避免路由层把业务前置条件误报成 400。
    ``detail`` 保留完整预检结果，供 API 层原样返回。
    """

    status_code = 409
    code = "voiceprint_enrollment_required"

    def __init__(self, result: dict[str, Any]):
        self.result = result
        self.detail = {
            "code": self.code,
            "message": "请先完成全部参会人的声纹录入，再进入会中",
            **result,
        }
        super().__init__(self.detail["message"])


def _text(value: Any) -> str:
    return str(value or "").strip()


def _profile_is_usable(row: Any) -> bool:
    """判断既有 profile 是否足以作为已录入标记。

    旧库没有单独的 profile status 字段，因此同时要求有效 user_id、至少
    一次样本以及非空 embedding。这样可以避免残留的空记录放行会中。
    """

    if not _text(row["user_id"]):
        return False
    try:
        sample_count = int(row["sample_count"] or 0)
    except (TypeError, ValueError):
        sample_count = 0
    embedding = row["embedding"]
    try:
        has_embedding = bool(embedding) and len(embedding) > 0
    except TypeError:
        has_embedding = bool(embedding)
    return sample_count > 0 and has_embedding


def _load_participants(meeting_id: str) -> list[dict[str, str]]:
    _init_app_db()
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                """
                SELECT row_id, user_id, username, display_name, meeting_role, dept
                FROM meeting_participants
                WHERE meeting_id = ?
                ORDER BY row_id
                """,
                (meeting_id,),
            ).fetchall()
    return [
        {
            "rowId": _text(row["row_id"]),
            "userId": _text(row["user_id"]),
            "username": _text(row["username"]),
            "displayName": _text(row["display_name"]),
            "meetingRole": _text(row["meeting_role"]),
            "dept": _text(row["dept"]),
        }
        for row in rows
    ]


def _load_profiles(user_ids: set[str]) -> dict[str, Any]:
    if not user_ids:
        return {}
    _init_app_db()
    placeholders = ",".join("?" for _ in user_ids)
    with APP_DB_LOCK:
        with _db_connect() as conn:
            rows = conn.execute(
                f"""
                SELECT user_id, display_name, sample_count, embedding, updated_at
                FROM voiceprint_profiles
                WHERE user_id IN ({placeholders})
                ORDER BY updated_at DESC
                """,
                tuple(sorted(user_ids)),
            ).fetchall()
    # A legacy database may contain duplicate profiles for one user. The query
    # is newest-first, so keep the first usable row and ignore stale duplicates.
    profiles: dict[str, Any] = {}
    for row in rows:
        user_id = _text(row["user_id"])
        if user_id not in profiles or (_profile_is_usable(row) and not _profile_is_usable(profiles[user_id])):
            profiles[user_id] = row
    return profiles


def check_meeting_voiceprints(meeting_id: str) -> dict[str, Any]:
    """检查会议参会人是否全部具备可用声纹。

    该函数是纯查询，不抛异常，适合会前页面展示检查结果。空参会名单
    按兼容策略视为通过；创建会议后尚未指定参会人时不会被错误拦截。
    """

    safe_meeting_id = _text(meeting_id)
    if not safe_meeting_id:
        raise ValueError("会议 ID 不能为空")

    participants = _load_participants(safe_meeting_id)

    # participant.user_id 是正式绑定键；历史数据可能只写 username，按同一
    # 标识检查 profile，但在结果中保留 rowId，便于管理员补齐数据。
    candidates: set[str] = set()
    participant_keys: dict[str, list[dict[str, str]]] = {}
    for participant in participants:
        candidate = participant["userId"] or participant["username"]
        if not candidate:
            candidate = f"row:{participant['rowId']}"
        candidates.add(candidate)
        participant_keys.setdefault(candidate, []).append(participant)

    profiles = _load_profiles(candidates)
    missing: list[dict[str, Any]] = []
    enrolled: list[dict[str, Any]] = []
    for candidate, rows in participant_keys.items():
        participant = rows[0]
        # 没有正式 user_id 时，即使 username 恰好命中 profile，也不认为已
        # 完成正式绑定，避免多人扫码时把设备身份错误归给同一用户。
        if not participant["userId"]:
            missing.append(
                {
                    "rowId": participant["rowId"],
                    "userId": "",
                    "username": participant["username"],
                    "displayName": participant["displayName"] or participant["username"] or "未识别参会人",
                    "meetingRole": participant["meetingRole"],
                    "dept": participant["dept"],
                    "reason": "participant_missing_user_id",
                }
            )
            continue

        profile = profiles.get(candidate)
        if not profile or not _profile_is_usable(profile):
            missing.append(
                {
                    "rowId": participant["rowId"],
                    "userId": participant["userId"],
                    "username": participant["username"],
                    "displayName": participant["displayName"] or participant["username"] or participant["userId"],
                    "meetingRole": participant["meetingRole"],
                    "dept": participant["dept"],
                    "reason": "voiceprint_not_enrolled",
                }
            )
            continue

        enrolled.append(
            {
                "userId": participant["userId"],
                "displayName": participant["displayName"]
                or _text(profile["display_name"])
                or participant["username"]
                or participant["userId"],
                "sampleCount": int(profile["sample_count"] or 0),
                "updatedAt": _text(profile["updated_at"]),
            }
        )

    participant_count = len(participant_keys)
    result = {
        "ok": not missing,
        "meetingId": safe_meeting_id,
        "required": True,
        "participantCount": participant_count,
        "enrolledCount": len(enrolled),
        "missingCount": len(missing),
        "enrolled": enrolled,
        "missing": missing,
        # 声纹缺失时仍允许会后输出泛化标签，姓名回填由人工校订完成；本
        # 服务不负责 diarization，因此只把策略传递给后续调用方。
        "diarizationFallback": {
            "enabled": True,
            "labels": ["说话人A", "说话人B"],
            "requiresManualRelabel": bool(missing),
        },
    }
    return result


def require_meeting_voiceprints(meeting_id: str) -> dict[str, Any]:
    """会前强制预检，缺失声纹时抛出可转换为 HTTP 409 的异常。"""

    result = check_meeting_voiceprints(meeting_id)
    if not result["ok"]:
        raise VoiceprintPreflightError(result)
    return result


# 便于阶段服务和未来路由使用的语义别名。
assert_meeting_voiceprint_ready = require_meeting_voiceprints


__all__ = [
    "VoiceprintPreflightError",
    "check_meeting_voiceprints",
    "require_meeting_voiceprints",
    "assert_meeting_voiceprint_ready",
]

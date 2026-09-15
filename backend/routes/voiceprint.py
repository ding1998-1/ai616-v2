"""
backend/routes/voiceprint.py — 声纹识别 API 路由

提供会后声纹校准所需的档案、补录和测试接口。声纹不作为开会前置条件。

依赖: backend.voiceprint, backend.db, backend.config
"""

import uuid
import logging
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from pydantic import BaseModel, Field

from ..config import now_text
from ..db import (
    _db_load_voiceprint_profiles,
    _db_save_voiceprint_profile,
    _db_delete_voiceprint_profile,
    _db_get_voiceprint_by_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voiceprint", tags=["voiceprint"])


class SpeakerNameRequest(BaseModel):
    audioEventId: str = Field(min_length=1, max_length=200)
    speakerId: str = Field(min_length=1, max_length=200)
    name: str = Field(default="", max_length=80)


@router.post("/meetings/{meeting_id}/diarization/name")
async def confirm_speaker_name(request: Request, meeting_id: str, body: SpeakerNameRequest):
    from backend.dependencies import require_meeting, can_manage_meeting
    from backend.services.speaker_diarization_service import set_speaker_name

    user, safe_id, meeting = require_meeting(request, meeting_id)
    if not can_manage_meeting(user, meeting) or meeting.get("archiveDone"):
        raise HTTPException(status_code=403, detail="仅会议管理人员可在归档前确认发言人姓名")
    if meeting.get("type") != "快速会议":
        raise HTTPException(status_code=409, detail="仅快速会议支持此操作")
    try:
        return set_speaker_name(safe_id, body.audioEventId, body.speakerId, body.name, user)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/meetings/{meeting_id}/diarization")
async def meeting_diarization_status(request: Request, meeting_id: str):
    from backend.dependencies import require_meeting
    from backend.services.speaker_diarization_service import diarization_status

    _, safe_id, _ = require_meeting(request, meeting_id)
    return diarization_status(safe_id)


@router.post("/meetings/{meeting_id}/diarization/retry")
async def retry_meeting_diarization(request: Request, meeting_id: str, audio_event_id: str = ""):
    from backend.dependencies import require_meeting, can_manage_meeting
    from backend.services.speaker_diarization_service import retry_speaker_diarization

    user, safe_id, meeting = require_meeting(request, meeting_id)
    if not can_manage_meeting(user, meeting) or meeting.get("archiveDone"):
        raise HTTPException(status_code=403, detail="仅会议管理人员可在归档前重试分离")
    result = retry_speaker_diarization(safe_id, audio_event_id)
    if result.get("eligible") is False:
        raise HTTPException(status_code=409, detail=result.get("reason"))
    if result.get("status") == "failed":
        raise HTTPException(status_code=409, detail=result.get("error") or "无法重试说话人分离")
    return result


def _voiceprint_runtime():
    """延迟加载可选声纹依赖，避免未安装模型时拖垮整个会议后端。"""
    from ..voiceprint import (
        deserialize_embedding,
        get_voiceprint_engine,
        merge_embeddings,
        serialize_embedding,
    )

    return get_voiceprint_engine, serialize_embedding, deserialize_embedding, merge_embeddings


@router.get("/status")
async def voiceprint_status():
    """检查声纹引擎状态。"""
    try:
        get_voiceprint_engine, _, _, _ = _voiceprint_runtime()
        engine = get_voiceprint_engine()
    except Exception as exc:
        logger.warning("声纹运行时不可用: %s", exc)
        engine = None
    return {
        "ready": engine is not None and engine.is_ready,
        "profiles_count": len(_db_load_voiceprint_profiles()),
        "engine": "pyannote",
    }


@router.get("/profiles")
async def list_profiles():
    """获取所有已注册声纹配置。"""
    profiles = _db_load_voiceprint_profiles()
    # 不返回 embedding 二进制数据
    result = []
    for p in profiles:
        result.append({
            "id": p["id"],
            "user_id": p["user_id"],
            "display_name": p["display_name"],
            "role": p["role"],
            "dept": p["dept"],
            "sample_duration": p["sample_duration"],
            "sample_count": p["sample_count"],
            "created_at": p["created_at"],
            "updated_at": p["updated_at"],
        })
    return result


@router.post("/enroll")
async def enroll_voiceprint(
    audio: UploadFile = File(...),
    user_id: str = Form(...),
    display_name: str = Form(""),
    role: str = Form(""),
    dept: str = Form(""),
):
    """会后补录声纹样本，供完整录音的说话人校准使用。

    Args:
        audio: 音频文件（WAV 或 PCM16）
        user_id: 用户 ID
        display_name: 显示名称
        role: 角色
        dept: 部门

    Returns:
        注册结果
    """
    get_voiceprint_engine, serialize_embedding, deserialize_embedding, merge_embeddings = _voiceprint_runtime()
    engine = get_voiceprint_engine()
    if engine is None or not engine.is_ready:
        raise HTTPException(status_code=503, detail="声纹引擎未初始化，请检查后端日志")

    # 读取音频
    audio_bytes = await audio.read()
    if len(audio_bytes) < 1000:
        raise HTTPException(status_code=400, detail="音频文件太短，请录制至少 3 秒")

    # 提取 embedding
    embedding = engine.extract_embedding_from_bytes(audio_bytes)
    if embedding is None:
        raise HTTPException(status_code=400, detail="无法从音频中提取声纹特征，请确保音频质量")

    # 检查是否已有该用户的声纹
    existing = _db_get_voiceprint_by_user(user_id)
    now = now_text()

    if existing:
        # 合并已有 embedding 和新 embedding
        old_emb = deserialize_embedding(existing["embedding"])
        new_count = existing["sample_count"] + 1
        # 旧 embedding 权重为已有次数，新 embedding 权重为 1
        merged = merge_embeddings([old_emb, embedding], weights=[existing["sample_count"], 1.0])

        profile = {
            "id": existing["id"],
            "user_id": user_id,
            "display_name": display_name or existing["display_name"],
            "role": role or existing["role"],
            "dept": dept or existing["dept"],
            "embedding": serialize_embedding(merged),
            "sample_duration": existing["sample_duration"],  # 会在下面更新
            "sample_count": new_count,
            "created_at": existing["created_at"],
            "updated_at": now,
        }
    else:
        profile = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "display_name": display_name,
            "role": role,
            "dept": dept,
            "embedding": serialize_embedding(embedding),
            "sample_duration": 0,
            "sample_count": 1,
            "created_at": now,
            "updated_at": now,
        }

    # 估算音频时长
    try:
        if audio_bytes[:4] == b'RIFF':
            import wave
            import io
            with wave.open(io.BytesIO(audio_bytes), 'rb') as wf:
                duration = wf.getnframes() / wf.getframerate()
        else:
            duration = len(audio_bytes) / (16000 * 2)  # 假设 16kHz 16bit
        profile["sample_duration"] = max(profile.get("sample_duration", 0), duration)
    except Exception:
        pass

    _db_save_voiceprint_profile(profile)

    return {
        "ok": True,
        "user_id": user_id,
        "display_name": profile["display_name"],
        "sample_count": profile["sample_count"],
        "message": f"声纹注册成功（第 {profile['sample_count']} 次采样）",
    }


@router.post("/test")
async def test_voiceprint(
    audio: UploadFile = File(...),
):
    """测试声纹识别：上传音频，与所有已注册声纹比对。

    Args:
        audio: 音频文件（WAV 或 PCM16）

    Returns:
        识别结果
    """
    get_voiceprint_engine, _, deserialize_embedding, _ = _voiceprint_runtime()
    engine = get_voiceprint_engine()
    if engine is None or not engine.is_ready:
        raise HTTPException(status_code=503, detail="声纹引擎未初始化")

    audio_bytes = await audio.read()
    if len(audio_bytes) < 1000:
        raise HTTPException(status_code=400, detail="音频文件太短")

    # 加载所有已注册声纹
    profiles = _db_load_voiceprint_profiles()
    if not profiles:
        return {"matched": False, "message": "没有已注册的声纹"}

    enrolled = {}
    profile_map = {}
    for p in profiles:
        emb = deserialize_embedding(p["embedding"])
        enrolled[p["user_id"]] = emb
        profile_map[p["user_id"]] = p

    # 识别
    user_id, confidence = engine.identify_speaker_from_bytes(audio_bytes, enrolled)

    if user_id:
        p = profile_map[user_id]
        return {
            "matched": True,
            "user_id": user_id,
            "display_name": p["display_name"],
            "role": p["role"],
            "dept": p["dept"],
            "confidence": round(confidence, 4),
        }
    else:
        return {
            "matched": False,
            "confidence": round(confidence, 4),
            "message": "未匹配到已注册声纹",
        }


@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str):
    """删除指定声纹配置。"""
    _db_delete_voiceprint_profile(profile_id)
    return {"ok": True, "message": "声纹已删除"}

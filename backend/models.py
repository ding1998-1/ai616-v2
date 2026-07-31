"""
backend/models.py — Pydantic 请求/响应模型

所有 API 的入参校验和响应类型在此定义。
依赖: pydantic, typing
被依赖: routes/*, main.py
"""

from pydantic import BaseModel
from typing import Optional, List


class ChatResponse(BaseModel):
    """合规审核 / 法律对比等 AI 接口的统一响应"""
    success: bool
    message: str
    report: Optional[str] = None
    legal_analysis: Optional[dict] = None


class LegalCompareRequest(BaseModel):
    """法律案例对比请求"""
    case_type: str
    case_description: str
    case_amount: float = 0.0


class KBQueryRequest(BaseModel):
    """知识库查询"""
    query: str


class LoginRequest(BaseModel):
    """登录"""
    username: str
    password: str


# MeetingRegisterRequest 实际定义在 backend/routes/auth.py
# 此处保留兼容别名（与 auth.py 一致）
class MeetingRegisterRequest(BaseModel):
    meetingId: Optional[str] = None
    meetingTitle: Optional[str] = None
    meeting_id: Optional[str] = None
    displayName: Optional[str] = None
    name: Optional[str] = None
    dept: Optional[str] = None
    meetingRole: Optional[str] = None
    meeting_role: Optional[str] = None
    password: Optional[str] = None
    username: Optional[str] = None

class UserUpsertRequest(BaseModel):
    """用户创建/更新"""
    username: str
    name: str
    role: str
    dept: str
    password: Optional[str] = None
    status: str = "active"


class MeetingTranscriptChunkRequest(BaseModel):
    """转写片段（手机端实时推流）"""
    meeting_id: str
    meeting_title: str = ""
    agenda: str = ""
    transcript: str
    is_final: bool = True
    client_time: Optional[str] = None
    confidence: Optional[float] = None
    speaker_name: Optional[str] = None
    speaker_role: Optional[str] = None
    speaker_dept: Optional[str] = None
    speaker_confidence: Optional[float] = None
    identified_by: Optional[str] = None  # "manual" / "voiceprint-realtime" / "voiceprint-diarization"


class MeetingRecorderSessionRequest(BaseModel):
    """录音会话事件"""
    meeting_id: str
    meeting_title: str = ""
    agenda: str = ""
    action: str
    audio_size: Optional[int] = None
    duration_seconds: Optional[int] = None
    device_type: Optional[str] = None
    device_id: Optional[str] = None
    device_label: Optional[str] = None
    channel: Optional[str] = None
    transport: Optional[str] = None
    firmware_version: Optional[str] = None


class MeetingRecorderAudioMetaRequest(BaseModel):
    """录音元数据"""
    meeting_id: str
    meeting_title: str = ""
    agenda: str = ""
    duration_seconds: Optional[int] = None


class MeetingUpsertRequest(BaseModel):
    """会议创建/更新"""
    id: Optional[str] = None
    title: str = ""
    project: str = ""
    projectCode: str = ""
    project_code: str = ""
    agenda: str = ""
    date: str = ""
    type: str = "普通企业会议"
    meetingMode: str = "normal"
    meeting_mode: str = ""
    phase: str = "问题收集中"
    creator: str = ""
    issueSources: Optional[List[dict]] = None
    agendaDrafts: Optional[List[dict]] = None
    materials: Optional[List[dict]] = None


class MeetingPatchRequest(BaseModel):
    """会议字段级更新"""
    title: Optional[str] = None
    project: Optional[str] = None
    projectCode: Optional[str] = None
    project_code: Optional[str] = None
    agenda: Optional[str] = None
    date: Optional[str] = None
    type: Optional[str] = None
    meetingMode: Optional[str] = None
    meeting_mode: Optional[str] = None
    phase: Optional[str] = None
    archived: Optional[bool] = None
    projectBound: Optional[bool] = None
    agendaFrozen: Optional[bool] = None
    reviewDone: Optional[bool] = None
    archiveDone: Optional[bool] = None
    issueSources: Optional[List[dict]] = None
    agendaDrafts: Optional[List[dict]] = None
    materials: Optional[List[dict]] = None


class MeetingIssueRequest(BaseModel):
    """问题线索提交"""
    name: str = "当前用户"
    content: str
    type: str = "text"
    meta: str = ""
    source: str = "manual"


class MeetingStageRequest(BaseModel):
    """会议阶段切换"""
    stage: str
    phase: str = ""


class MeetingAgendaRealtimeCheckRequest(BaseModel):
    """实时议题比对"""
    agendaDrafts: List[dict] = []
    latestTranscripts: List[dict] = []
    meetingMode: str = "normal"


class MeetingTranscriptCorrectionRequest(BaseModel):
    """转写修正 + 签字"""
    corrected_transcript: str
    signature_data: str
    client_time: Optional[str] = None


class MeetingMarkerRequest(BaseModel):
    """会中快捷标记"""
    marker_type: str  # decision / todo / dispute / material
    agenda_id: str = ""
    agenda_title: str = ""
    transcript_id: str = ""
    transcript_text: str = ""
    transcript_time: str = ""
    transcript_speaker: str = ""
    note: str = ""


class MeetingRecordsUpdateRequest(BaseModel):
    """会议成果（纪要/决议/待办）更新"""
    summary: Optional[List[str]] = None
    minutes: Optional[List[dict]] = None
    decisions: Optional[List[dict]] = None
    todos: Optional[List[dict]] = None


class ChatRequest(BaseModel):
    """流式审核请求"""
    matter_type: str
    material_text: str = ""
    custom_rule_ids: Optional[List[str]] = None
    file_name: str = ""

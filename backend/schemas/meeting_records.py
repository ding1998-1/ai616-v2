"""JSON schemas used by the Records Pipeline v2.

The records pipeline deliberately keeps these models small and serialisable.
They describe the boundary between the transcript map/reduce workers and the
document/HTTP layers; they do not introduce a database schema.  The service
normalises model output before constructing these models, so malformed LLM
fields are ignored instead of being allowed to leak into an official record.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class RecordModel(BaseModel):
    """Pydantic v1/v2 compatible base model for LLM JSON payloads."""

    class Config:
        extra = "ignore"


class HumanReview(RecordModel):
    supported: bool = False
    reviewerId: str = ""
    reviewerName: str = ""
    reviewedAt: str = ""
    reasonCode: str = ""
    reasonText: str = ""


class ReviewableRecord(RecordModel):
    id: str = ""
    supportStatus: str = "ai_suggested"
    supportSource: str = "transcript"
    humanReview: Optional[HumanReview] = None
    originalAiSummary: str = ""
    editedByHuman: bool = False
    locked: bool = False


class EvidenceQuote(RecordModel):
    """A verbatim quote anchored to one source segment."""

    time: str = ""
    speaker: str = ""
    text: str = ""
    segmentId: str = ""


class Basis(RecordModel):
    """Traceability information attached to minutes, decisions, and todos."""

    timeRange: str = ""
    quotes: List[EvidenceQuote] = Field(default_factory=list)
    sourceSegmentIds: List[str] = Field(default_factory=list)
    evidenceValid: bool = False


class TopicExtraction(RecordModel):
    title: str = ""
    timeRange: str = ""
    evidence: str = ""
    time: str = ""
    basis: Optional[Basis] = None


class ConclusionExtraction(RecordModel):
    content: str = ""
    type: str = "知悉"
    evidence: str = ""
    time: str = ""
    basis: Optional[Basis] = None
    confidence: Optional[float] = None


class RiskDisclosureExtraction(RecordModel):
    content: str = ""
    severity: str = "中"
    evidence: str = ""
    time: str = ""
    kind: str = "risk"
    basis: Optional[Basis] = None


class TodoExtraction(RecordModel):
    task: str = ""
    owner: str = "待确认"
    deadline: str = "待定"
    evidence: str = ""
    time: str = ""
    basis: Optional[Basis] = None


class Correction(RecordModel):
    original: str = ""
    fixed: str = ""
    reason: str = ""


class MapOutput(RecordModel):
    """Strict logical shape requested from one map invocation."""

    chunkSummary: str = ""
    topics: List[TopicExtraction] = Field(default_factory=list)
    conclusions: List[ConclusionExtraction] = Field(default_factory=list)
    risks_disclosures: List[RiskDisclosureExtraction] = Field(default_factory=list)
    todos: List[TodoExtraction] = Field(default_factory=list)
    key_numbers: List[str] = Field(default_factory=list)
    corrections: List[Correction] = Field(default_factory=list)


class MinuteRecord(ReviewableRecord):
    agenda: str = ""
    status: str = "待整理"
    keyPoints: List[str] = Field(default_factory=list)
    formalSummary: List[str] = Field(default_factory=list)
    basis: Basis = Field(default_factory=Basis)


class DecisionRecord(ReviewableRecord):
    content: str = ""
    type: str = "知悉"
    outcomeType: str = ""
    confidence: Optional[float] = None
    status: str = "待确认"
    basis: Basis = Field(default_factory=Basis)


class RiskRecord(ReviewableRecord):
    content: str = ""
    severity: str = "中"
    basis: Basis = Field(default_factory=Basis)


class DisclosureRecord(ReviewableRecord):
    content: str = ""
    audience: str = ""
    deadline: str = "待定"
    basis: Basis = Field(default_factory=Basis)


class TodoRecord(ReviewableRecord):
    task: str = ""
    owner: str = "待确认"
    deadline: str = "待定"
    basis: Basis = Field(default_factory=Basis)


class SummarySections(RecordModel):
    """The user-facing summary columns, intentionally not an agenda stream."""

    conclusions: List[DecisionRecord] = Field(default_factory=list)
    risks: List[RiskRecord] = Field(default_factory=list)
    todos: List[TodoRecord] = Field(default_factory=list)


class GenerationSnapshot(RecordModel):
    provider: str = "local"
    model: str = ""
    pipeline: str = "records-v2"
    pipelineVersion: str = "records-v2"
    promptVersion: str = "records-v2-map-reduce-v1"
    schemaVersion: str = "meeting-records-v2"
    glossaryVersion: str = "1"
    inputSha256: str = ""
    chunkStrategy: str = "audio-file-boundary+time-4000-chars"
    chunkPolicy: str = "audio-file-boundary+time-4000-chars"
    chunkCount: int = 0
    mapCallCount: int = 0
    reduceCallCount: int = 0
    generatedAt: str = ""


class CoverageReport(RecordModel):
    sourceSegmentCount: int = 0
    assignedSegmentCount: int = 0
    assignedSegmentIds: List[str] = Field(default_factory=list)
    unassignedSegmentIds: List[str] = Field(default_factory=list)
    coverageRatio: float = 0.0
    evidenceSegmentCount: int = 0
    evidenceSegmentIds: List[str] = Field(default_factory=list)
    evidenceCoverageRatio: float = 0.0
    sourceFileCount: int = 0
    sourceCharCount: int = 0


class ReduceOutput(RecordModel):
    """Reduced meeting records emitted by the final reduce invocation."""

    summary: SummarySections = Field(default_factory=SummarySections)
    minutes: List[MinuteRecord] = Field(default_factory=list)
    decisions: List[DecisionRecord] = Field(default_factory=list)
    risks: List[RiskRecord] = Field(default_factory=list)
    disclosures: List[DisclosureRecord] = Field(default_factory=list)
    todos: List[TodoRecord] = Field(default_factory=list)


__all__ = [
    "Basis",
    "ConclusionExtraction",
    "Correction",
    "CoverageReport",
    "DecisionRecord",
    "DisclosureRecord",
    "EvidenceQuote",
    "GenerationSnapshot",
    "MapOutput",
    "MinuteRecord",
    "ReduceOutput",
    "RiskDisclosureExtraction",
    "RiskRecord",
    "SummarySections",
    "TodoExtraction",
    "TodoRecord",
    "TopicExtraction",
]

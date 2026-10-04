from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MetricObservation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    metric_id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=100)
    value: float
    unit: str = Field(min_length=1, max_length=30)
    confidence: float = Field(ge=0, le=1)
    baseline_value: float | None = None
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_window(self):
        if self.start_ms is not None and self.end_ms is not None and self.end_ms < self.start_ms:
            raise ValueError("end_ms must be at least start_ms")
        return self


class EvidenceRef(BaseModel):
    source_type: Literal["metric", "knowledge"]
    source_id: str = Field(min_length=1)
    note: str = Field(min_length=1)


class CoachingObservation(BaseModel):
    claim: str = Field(min_length=1)
    evidence: list[EvidenceRef] = Field(min_length=1)


class DrillRecommendation(BaseModel):
    name: str
    steps: list[str] = Field(min_length=1)
    success_criterion: str
    evidence: list[EvidenceRef] = Field(min_length=1)


class CoachingReport(BaseModel):
    summary: str = Field(min_length=1)
    observations: list[CoachingObservation] = Field(default_factory=list)
    next_drill: DrillRecommendation | None = None
    limitations: list[str] = Field(default_factory=list)


class MetricSet(BaseModel):
    metrics: list[MetricObservation] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_metric_ids(self):
        ids = [metric.metric_id for metric in self.metrics]
        if len(ids) != len(set(ids)):
            raise ValueError("metric_id values must be unique within a session")
        return self


class CoachRequest(MetricSet):
    session_id: str = Field(min_length=1, max_length=100)
    question: str = Field(min_length=3, max_length=1500)
    skill_level: Literal["beginner", "intermediate"] = "beginner"
    focus_metric_id: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def focus_is_in_session(self):
        if self.focus_metric_id and not any(
            metric.metric_id == self.focus_metric_id for metric in self.metrics
        ):
            raise ValueError("focus_metric_id must refer to a measurement in this session")
        return self


class SessionCreate(MetricSet):
    title: str = Field(min_length=1, max_length=100)
    skill_level: Literal["beginner", "intermediate"] = "beginner"
    notes: str = Field(default="", max_length=2000)


class SessionRecord(SessionCreate):
    session_id: str
    created_at: datetime
    is_demo: bool = False


class ReportRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1500)
    mode: Literal["demo", "bedrock"] = "demo"
    focus_metric_id: str | None = Field(default=None, min_length=1, max_length=120)


class KnowledgeSource(BaseModel):
    source_id: str
    source: str
    text: str
    score: float | None = None


class TraceEvent(BaseModel):
    step: str
    detail: str
    elapsed_ms: float


class RunRecord(BaseModel):
    run_id: str
    session_id: str
    created_at: datetime
    question: str
    focus_metric_id: str | None = None
    mode: Literal["demo", "bedrock"]
    model_id: str | None = None
    retrieval_method: str
    report: CoachingReport
    sources: list[KnowledgeSource]
    trace: list[TraceEvent]
    latency_ms: float
    input_tokens: int
    output_tokens: int
    citation_count: int
    citation_ids_valid: bool

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


class MetricObservation(BaseModel):
    """A measured value emitted by the motion-analysis pipeline."""

    metric_id: str = Field(min_length=1, description="Stable ID used to cite this measurement")
    name: str = Field(min_length=1)
    value: float
    unit: str
    confidence: float = Field(ge=0.0, le=1.0)
    baseline_value: float | None = None
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)


class EvidenceRef(BaseModel):
    source_type: Literal["metric", "knowledge"]
    source_id: str
    note: str = Field(description="Short explanation of how this source supports the claim")


class CoachingObservation(BaseModel):
    claim: str
    evidence: list[EvidenceRef] = Field(default_factory=list)


class DrillRecommendation(BaseModel):
    name: str
    steps: list[str]
    success_criterion: str
    evidence: list[EvidenceRef] = Field(default_factory=list)


class CoachingReport(BaseModel):
    summary: str
    observations: list[CoachingObservation] = Field(default_factory=list)
    next_drill: DrillRecommendation | None = None
    limitations: list[str] = Field(default_factory=list)


class CoachRequest(BaseModel):
    session_id: str = Field(min_length=1)
    question: str = Field(min_length=3, max_length=1500)
    skill_level: Literal["beginner", "intermediate"] = "beginner"
    metrics: list[MetricObservation] = Field(min_length=1, max_length=100)

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field, model_validator


class SourceRef(BaseModel):
    document_id: str
    document_name: str
    page: int | None = None
    chunk_id: str
    quote: str


class Fact(BaseModel):
    attribute: str
    value: str | float | int | None
    unit: str | None = None
    numeric_value: float | None = None
    direction: Literal["higher", "lower", "target", "qualitative"] = "qualitative"
    source: SourceRef
    confidence: float = Field(ge=0, le=1)


class Option(BaseModel):
    id: str
    name: str
    summary: str
    facts: list[Fact] = []
    pros: list[str] = []
    cons: list[str] = []


class Criterion(BaseModel):
    id: str
    name: str
    attribute: str
    weight: float = Field(ge=0, le=1)
    direction: Literal["higher", "lower", "target", "qualitative"] = "higher"
    target: float | None = None
    minimum: float | None = None
    maximum: float | None = None
    unit: str | None = None


class Constraint(BaseModel):
    criterion_id: str
    operator: Literal["gte", "lte", "eq"]
    value: float
    unit: str | None = None


class DocumentRecord(BaseModel):
    id: str
    name: str
    size: int
    pages: int
    summary: str
    status: Literal["ready", "failed"] = "ready"
    error: str | None = None


class CriteriaState(BaseModel):
    criteria: list[Criterion]
    constraints: list[Constraint] = []

    @model_validator(mode="after")
    def weights_sum_to_one(self):
        if self.criteria and abs(sum(c.weight for c in self.criteria) - 1) > 0.005:
            raise ValueError("Criterion weights must sum to 1.0")
        return self


class CriteriaProposal(BaseModel):
    reply: str
    needs_clarification: bool = False
    clarification_question: str | None = None
    proposed_state: CriteriaState | None = None
    change_summary: list[str] = []
    intent: Literal["criteria_update", "scenario", "evidence_question", "comparison", "general"] = "general"
    scenario_only: bool = False


class CriteriaUpdate(BaseModel):
    state: CriteriaState


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class ScenarioRequest(BaseModel):
    name: str = "Untitled scenario"
    weights: dict[str, float]


class ScoreCell(BaseModel):
    score: float | None
    evidence: list[SourceRef] = []
    explanation: str


class RankedOption(BaseModel):
    option_id: str
    option_name: str
    score: float | None
    evidence_coverage: float
    eligible: bool
    rank: int | None
    criterion_scores: dict[str, ScoreCell]
    unmet_constraints: list[str] = []


class DecisionResult(BaseModel):
    criteria: list[Criterion]
    options: list[RankedOption]
    recommendation_id: str | None
    recommendation_explanation: str
    follow_up_questions: list[str]
    total_options: int


class Workspace(BaseModel):
    documents: list[DocumentRecord]
    options: list[Option]
    criteria_state: CriteriaState
    decision: DecisionResult

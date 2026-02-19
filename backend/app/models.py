"""Pydantic models for API requests and responses."""
from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TargetKind(str, Enum):
    Pod = "Pod"
    Deployment = "Deployment"
    StatefulSet = "StatefulSet"
    Node = "Node"


class AnalyzeRequest(BaseModel):
    context: str | None = None
    namespace: str | None = None
    kind: TargetKind
    name: str = Field(..., min_length=1)
    include_previous_logs: bool = False


class RootCauseItem(BaseModel):
    cause: str
    confidence: str  # e.g. "high", "medium", "low"
    evidence_refs: list[str] = Field(default_factory=list)


class AnalysisJson(BaseModel):
    summary: str = ""
    likely_root_causes: list[RootCauseItem] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    kubectl_commands: list[str] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)
    risk_notes: list[str] = Field(default_factory=list)


class TruncationReport(BaseModel):
    truncated: bool = False
    sections_truncated: list[str] = Field(default_factory=list)
    total_chars_before: int = 0
    total_chars_after: int = 0


class AnalyzeResponse(BaseModel):
    analysis_json: AnalysisJson = Field(default_factory=AnalysisJson)
    analysis_markdown: str = ""
    evidence: dict[str, Any] = Field(default_factory=dict)
    truncation_report: TruncationReport = Field(default_factory=TruncationReport)
    tokens_used: int = 0
    response_time_ms: int = 0
    error: str | None = None


class ResourceItem(BaseModel):
    name: str
    namespace: str | None = None
    kind: str


class HealthResponse(BaseModel):
    status: str = "ok"
    kube_connected: bool = False
    llm_configured: bool = False
    llm_provider: str = ""  # "groq" | "openai_compatible" for display as Groq / Local


# --- Scan ---


class ScanRequest(BaseModel):
    context: str | None = None
    scope: str = "namespace"  # "namespace" | "cluster"
    namespace: str | None = None
    include_logs: bool = False


class ScanFindingItem(BaseModel):
    id: str
    severity: str
    category: str
    title: str
    description: str | None = None
    affected_refs: list[dict[str, Any]] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    suggested_commands: list[str] = Field(default_factory=list)
    evidence_snippet: str | None = None
    occurred_at: str | None = None  # When the issue happened (ISO), for display


class ScanResponse(BaseModel):
    id: str
    created_at: str | None = None  # ISO timestamp when scan was run
    summary_markdown: str | None = None
    error: str | None = None
    findings: list[ScanFindingItem] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)  # by severity
    duration_ms: int | None = None  # scan execution time


class ScanListItem(BaseModel):
    id: str
    created_at: str
    context: str | None
    scope: str
    namespace: str | None
    findings_count: int
    error: str | None = None


# --- Compare ---


class CompareRequest(BaseModel):
    analysis_id_a: str = Field(..., min_length=1)
    analysis_id_b: str = Field(..., min_length=1)


class CompareChangeItem(BaseModel):
    type: str
    path: str
    before: Any = None
    after: Any = None
    impact: str


class CompareResponse(BaseModel):
    diff_summary: str = ""  # Markdown from LLM
    changes: list[CompareChangeItem] = Field(default_factory=list)
    likely_reasoning: str = ""  # LLM explanation citing diff items
    analysis_a: dict[str, Any] = Field(default_factory=dict)  # metadata for UI
    analysis_b: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None


# --- Incidents ---


class CreateIncidentRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: str | None = None
    severity: str | None = None  # low|medium|high|critical
    tags: list[str] = Field(default_factory=list)


class AddIncidentItemRequest(BaseModel):
    type: str = Field(..., pattern="^(analysis|scan)$")
    ref_id: str = Field(..., min_length=1)


class ExportIncidentRequest(BaseModel):
    format: str = Field(..., pattern="^(markdown|json)$")


class IncidentListItem(BaseModel):
    id: str
    created_at: str
    title: str
    description: str | None
    severity: str | None
    tags: list[str] = Field(default_factory=list)
    status: str = "open"


class IncidentDetail(BaseModel):
    id: str
    created_at: str
    title: str
    description: str | None
    severity: str | None
    tags: list[str] = Field(default_factory=list)
    status: str
    items: list[dict[str, Any]] = Field(default_factory=list)
    notes: list[dict[str, Any]] = Field(default_factory=list)
    timeline: list[dict[str, Any]] = Field(default_factory=list)


# --- Schedules ---


class CreateScheduleRequest(BaseModel):
    context: str | None = None
    scope: str = "namespace"  # namespace | cluster
    namespace: str | None = None
    cron: str = Field(..., min_length=1, max_length=100)  # 5-part cron
    enabled: bool = True


class UpdateScheduleRequest(BaseModel):
    context: str | None = None
    scope: str | None = None
    namespace: str | None = None
    cron: str | None = None
    enabled: bool | None = None


class ScheduleListItem(BaseModel):
    id: str
    created_at: str
    context: str | None
    scope: str
    namespace: str | None
    cron: str
    enabled: bool

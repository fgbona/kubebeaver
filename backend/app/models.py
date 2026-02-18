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

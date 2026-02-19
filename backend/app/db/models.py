"""SQLAlchemy models for analysis history and scan runs."""
from __future__ import annotations

from typing import Any

from sqlalchemy import Integer, String, Text, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models."""


class Analysis(Base):
    """Analysis history model."""

    __tablename__ = "analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # UUID as string
    created_at: Mapped[str] = mapped_column(String(30), nullable=False)  # ISO format timestamp
    context: Mapped[str | None] = mapped_column(String(255), nullable=True)
    namespace: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    analysis_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON string
    analysis_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)  # Truncated JSON summary
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary (for API responses)."""
        import json

        return {
            "id": self.id,
            "created_at": self.created_at,
            "context": self.context,
            "namespace": self.namespace,
            "kind": self.kind,
            "name": self.name,
            "analysis_json": json.loads(self.analysis_json) if self.analysis_json else {},
            "analysis_markdown": self.analysis_markdown or "",
            "evidence_summary": self.evidence_summary,
            "error": self.error,
        }


class ScanRun(Base):
    """Scan run metadata."""

    __tablename__ = "scan_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(30), nullable=False)
    context: Mapped[str | None] = mapped_column(String(255), nullable=True)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)  # namespace | cluster
    namespace: Mapped[str | None] = mapped_column(String(255), nullable=True)
    summary_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    findings_count: Mapped[int] = mapped_column(Integer, default=0)  # Denormalized for list view

    findings: Mapped[list["ScanFinding"]] = relationship("ScanFinding", back_populates="scan_run", cascade="all, delete-orphan")


class ScanFinding(Base):
    """Single finding from a scan."""

    __tablename__ = "scan_findings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    scan_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("scan_runs.id", ondelete="CASCADE"), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)  # info|low|medium|high|critical
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    affected_refs: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of {kind, namespace, name}
    evidence_refs: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of paths
    suggested_commands: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of kubectl commands
    evidence_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)  # Truncated sanitized evidence for detail
    occurred_at: Mapped[str | None] = mapped_column(String(40), nullable=True)  # When the issue happened (ISO)

    scan_run: Mapped["ScanRun"] = relationship("ScanRun", back_populates="findings")


class Incident(Base):
    """Incident container for grouping analyses and scans with notes."""

    __tablename__ = "incidents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[str | None] = mapped_column(String(20), nullable=True)  # low|medium|high|critical
    tags: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of strings
    status: Mapped[str] = mapped_column(String(30), nullable=False, server_default="open")

    items: Mapped[list["IncidentItem"]] = relationship("IncidentItem", back_populates="incident", cascade="all, delete-orphan")
    notes: Mapped[list["IncidentNote"]] = relationship("IncidentNote", back_populates="incident", cascade="all, delete-orphan")


class IncidentItem(Base):
    """Link from an incident to an analysis or scan."""

    __tablename__ = "incident_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    incident_id: Mapped[str] = mapped_column(String(36), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False)
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)  # analysis | scan
    ref_id: Mapped[str] = mapped_column(String(36), nullable=False)  # analysis id or scan_run id
    created_at: Mapped[str] = mapped_column(String(30), nullable=False)

    incident: Mapped["Incident"] = relationship("Incident", back_populates="items")


class IncidentNote(Base):
    """Note or status update on an incident."""

    __tablename__ = "incident_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    incident_id: Mapped[str] = mapped_column(String(36), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String(30), nullable=False)

    incident: Mapped["Incident"] = relationship("Incident", back_populates="notes")

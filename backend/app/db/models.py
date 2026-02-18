"""SQLAlchemy models for analysis history."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


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

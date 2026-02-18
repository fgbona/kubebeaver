"""Repository pattern for analysis history operations."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Analysis

logger = logging.getLogger(__name__)


class HistoryRepository:
    """Repository for analysis history operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def save_analysis(
        self,
        context: str | None,
        namespace: str | None,
        kind: str,
        name: str,
        analysis_json: dict[str, Any],
        analysis_markdown: str,
        evidence: dict[str, Any],
        error: str | None,
    ) -> str:
        """Save analysis to database. Returns analysis ID."""
        uid = str(uuid4())
        created = datetime.utcnow().isoformat() + "Z"
        evidence_summary = json.dumps(evidence, default=str)[:10000]  # Summary only for list view

        analysis = Analysis(
            id=uid,
            created_at=created,
            context=context,
            namespace=namespace,
            kind=kind,
            name=name,
            analysis_json=json.dumps(analysis_json, default=str) if analysis_json else None,
            analysis_markdown=analysis_markdown or None,
            evidence_summary=evidence_summary or None,
            error=error,
        )

        self.session.add(analysis)
        await self.session.commit()
        return uid

    async def list_analyses(self, limit: int = 50) -> list[dict[str, Any]]:
        """List recent analyses."""
        try:
            stmt = (
                select(Analysis)
                .order_by(Analysis.created_at.desc())
                .limit(limit)
            )
            result = await self.session.execute(stmt)
            analyses = result.scalars().all()
            return [
                {
                    "id": a.id,
                    "created_at": a.created_at,
                    "context": a.context,
                    "namespace": a.namespace,
                    "kind": a.kind,
                    "name": a.name,
                    "error": a.error,
                }
                for a in analyses
            ]
        except Exception as e:
            logger.warning("list_analyses failed: %s", e)
            return []

    async def get_analysis(self, analysis_id: str) -> dict[str, Any] | None:
        """Get analysis by ID."""
        try:
            stmt = select(Analysis).where(Analysis.id == analysis_id)
            result = await self.session.execute(stmt)
            analysis = result.scalar_one_or_none()
            if not analysis:
                return None
            return analysis.to_dict()
        except Exception as e:
            logger.warning("get_analysis failed: %s", e)
            return None

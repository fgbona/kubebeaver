"""Repository pattern for analysis history and scan operations."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Analysis, ScanRun, ScanFinding, Incident, IncidentItem, IncidentNote

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


class ScanRepository:
    """Repository for scan run and findings."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def save_scan_run(
        self,
        context: str | None,
        scope: str,
        namespace: str | None,
        summary_markdown: str | None,
        error: str | None,
        findings: list[dict[str, Any]],
    ) -> str:
        """Save scan run and its findings. Returns scan_run id."""
        run_id = str(uuid4())
        created = datetime.utcnow().isoformat() + "Z"
        run = ScanRun(
            id=run_id,
            created_at=created,
            context=context,
            scope=scope,
            namespace=namespace,
            summary_markdown=summary_markdown,
            error=error,
            findings_count=len(findings),
        )
        self.session.add(run)
        for f in findings:
            finding_id = str(uuid4())
            aff = f.get("affected_refs") or []
            ev_refs = f.get("evidence_refs") or []
            cmds = f.get("suggested_commands") or []
            finding = ScanFinding(
                id=finding_id,
                scan_run_id=run_id,
                severity=f.get("severity", "info"),
                category=f.get("category", "unknown"),
                title=(f.get("title") or "")[:500],
                description=f.get("description"),
                affected_refs=json.dumps(aff) if aff else None,
                evidence_refs=json.dumps(ev_refs) if ev_refs else None,
                suggested_commands=json.dumps(cmds) if cmds else None,
                evidence_snippet=f.get("evidence_snippet"),
                occurred_at=f.get("occurred_at"),
            )
            self.session.add(finding)
        await self.session.commit()
        return run_id

    async def list_scans(self, limit: int = 50) -> list[dict[str, Any]]:
        """List recent scan runs."""
        try:
            stmt = (
                select(ScanRun)
                .order_by(ScanRun.created_at.desc())
                .limit(limit)
            )
            result = await self.session.execute(stmt)
            runs = result.scalars().all()
            return [
                {
                    "id": r.id,
                    "created_at": r.created_at,
                    "context": r.context,
                    "scope": r.scope,
                    "namespace": r.namespace,
                    "findings_count": r.findings_count,
                    "error": r.error,
                }
                for r in runs
            ]
        except Exception as e:
            logger.warning("list_scans failed: %s", e)
            return []

    async def get_scan(self, scan_id: str) -> dict[str, Any] | None:
        """Get scan run with findings by ID."""
        try:
            stmt = select(ScanRun).where(ScanRun.id == scan_id).options(selectinload(ScanRun.findings))
            result = await self.session.execute(stmt)
            run = result.scalar_one_or_none()
            if not run:
                return None
            findings = [
                {
                    "id": f.id,
                    "severity": f.severity,
                    "category": f.category,
                    "title": f.title,
                    "description": f.description,
                    "affected_refs": json.loads(f.affected_refs) if f.affected_refs else [],
                    "evidence_refs": json.loads(f.evidence_refs) if f.evidence_refs else [],
                    "suggested_commands": json.loads(f.suggested_commands) if f.suggested_commands else [],
                    "evidence_snippet": f.evidence_snippet,
                    "occurred_at": f.occurred_at,
                }
                for f in run.findings
            ]
            return {
                "id": run.id,
                "created_at": run.created_at,
                "context": run.context,
                "scope": run.scope,
                "namespace": run.namespace,
                "summary_markdown": run.summary_markdown,
                "error": run.error,
                "findings_count": run.findings_count,
                "findings": findings,
            }
        except Exception as e:
            logger.warning("get_scan failed: %s", e)
            return None


class IncidentRepository:
    """Repository for incidents, incident items, and notes."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_incident(
        self,
        title: str,
        description: str | None = None,
        severity: str | None = None,
        tags: list[str] | None = None,
    ) -> str:
        """Create incident. Returns incident id."""
        uid = str(uuid4())
        created = datetime.utcnow().isoformat() + "Z"
        tags_json = json.dumps(tags) if tags else None
        incident = Incident(
            id=uid,
            created_at=created,
            title=title[:500],
            description=description,
            severity=severity,
            tags=tags_json,
        )
        self.session.add(incident)
        await self.session.commit()
        return uid

    async def add_item(self, incident_id: str, item_type: str, ref_id: str) -> str | None:
        """Add analysis or scan to incident. Returns item id or None if incident not found."""
        stmt = select(Incident).where(Incident.id == incident_id)
        result = await self.session.execute(stmt)
        incident = result.scalar_one_or_none()
        if not incident:
            return None
        item_id = str(uuid4())
        created = datetime.utcnow().isoformat() + "Z"
        item = IncidentItem(
            id=item_id,
            incident_id=incident_id,
            item_type=item_type,
            ref_id=ref_id,
            created_at=created,
        )
        self.session.add(item)
        await self.session.commit()
        return item_id

    async def list_incidents(self, limit: int = 50) -> list[dict[str, Any]]:
        """List incidents (newest first)."""
        try:
            stmt = (
                select(Incident)
                .order_by(Incident.created_at.desc())
                .limit(limit)
            )
            result = await self.session.execute(stmt)
            incidents = result.scalars().all()
            return [
                {
                    "id": i.id,
                    "created_at": i.created_at,
                    "title": i.title,
                    "description": i.description,
                    "severity": i.severity,
                    "tags": json.loads(i.tags) if i.tags else [],
                    "status": i.status,
                }
                for i in incidents
            ]
        except Exception as e:
            logger.warning("list_incidents failed: %s", e)
            return []

    async def get_incident(self, incident_id: str) -> dict[str, Any] | None:
        """Get incident by id (no timeline)."""
        try:
            stmt = select(Incident).where(Incident.id == incident_id)
            result = await self.session.execute(stmt)
            inc = result.scalar_one_or_none()
            if not inc:
                return None
            return {
                "id": inc.id,
                "created_at": inc.created_at,
                "title": inc.title,
                "description": inc.description,
                "severity": inc.severity,
                "tags": json.loads(inc.tags) if inc.tags else [],
                "status": inc.status,
            }
        except Exception as e:
            logger.warning("get_incident failed: %s", e)
            return None

    async def get_incident_with_timeline(self, incident_id: str) -> dict[str, Any] | None:
        """Get incident with items and notes, ordered by created_at (timeline)."""
        try:
            stmt = (
                select(Incident)
                .where(Incident.id == incident_id)
                .options(
                    selectinload(Incident.items),
                    selectinload(Incident.notes),
                )
            )
            result = await self.session.execute(stmt)
            inc = result.scalar_one_or_none()
            if not inc:
                return None
            items = [{"id": i.id, "item_type": i.item_type, "ref_id": i.ref_id, "created_at": i.created_at} for i in inc.items]
            notes = [{"id": n.id, "content": n.content, "created_at": n.created_at} for n in inc.notes]
            # Build timeline: incident created + items + notes, sorted by created_at
            timeline: list[dict[str, Any]] = [
                {"type": "incident_created", "created_at": inc.created_at, "incident_id": inc.id},
            ]
            for i in items:
                timeline.append({"type": "item", "created_at": i["created_at"], "item_type": i["item_type"], "ref_id": i["ref_id"], "item_id": i["id"]})
            for n in notes:
                timeline.append({"type": "note", "created_at": n["created_at"], "content": n["content"], "note_id": n["id"]})
            timeline.sort(key=lambda x: x["created_at"])
            return {
                "id": inc.id,
                "created_at": inc.created_at,
                "title": inc.title,
                "description": inc.description,
                "severity": inc.severity,
                "tags": json.loads(inc.tags) if inc.tags else [],
                "status": inc.status,
                "items": items,
                "notes": notes,
                "timeline": timeline,
            }
        except Exception as e:
            logger.warning("get_incident_with_timeline failed: %s", e)
            return None

    async def add_note(self, incident_id: str, content: str) -> str | None:
        """Add note to incident. Returns note id or None if incident not found."""
        stmt = select(Incident).where(Incident.id == incident_id)
        result = await self.session.execute(stmt)
        if result.scalar_one_or_none() is None:
            return None
        note_id = str(uuid4())
        created = datetime.utcnow().isoformat() + "Z"
        note = IncidentNote(id=note_id, incident_id=incident_id, content=content, created_at=created)
        self.session.add(note)
        await self.session.commit()
        return note_id

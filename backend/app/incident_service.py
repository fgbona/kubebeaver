"""Incident CRUD and export."""
from __future__ import annotations

import json
import logging
from typing import Any

from app.db.factory import get_session_maker
from app.db.repository import IncidentRepository
from app.history import get_analysis
from app.scan_service import get_scan

logger = logging.getLogger(__name__)


async def create_incident(
    title: str,
    description: str | None = None,
    severity: str | None = None,
    tags: list[str] | None = None,
) -> str:
    """Create incident. Returns id."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = IncidentRepository(session)
        return await repo.create_incident(title=title, description=description, severity=severity, tags=tags)


async def add_incident_item(incident_id: str, item_type: str, ref_id: str) -> str | None:
    """Add analysis or scan to incident. Returns item id or None."""
    if item_type not in ("analysis", "scan"):
        return None
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = IncidentRepository(session)
        return await repo.add_item(incident_id, item_type=item_type, ref_id=ref_id)


async def add_incident_note(incident_id: str, content: str) -> str | None:
    """Add note to incident. Returns note id or None."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = IncidentRepository(session)
        return await repo.add_note(incident_id, content=content)


async def list_incidents(limit: int = 50) -> list[dict[str, Any]]:
    """List incidents."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = IncidentRepository(session)
        return await repo.list_incidents(limit=limit)


async def get_incident_with_timeline(incident_id: str) -> dict[str, Any] | None:
    """Get incident with timeline (items + notes sorted by created_at)."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = IncidentRepository(session)
        return await repo.get_incident_with_timeline(incident_id)


def _ref_summary(item_type: str, ref_id: str, resolved: dict[str, Any] | None) -> dict[str, Any]:
    """Build a small deterministic summary for a timeline item."""
    if not resolved:
        return {"type": item_type, "ref_id": ref_id, "resolved": False}
    if item_type == "analysis":
        return {
            "type": "analysis",
            "ref_id": ref_id,
            "resolved": True,
            "kind": resolved.get("kind"),
            "name": resolved.get("name"),
            "namespace": resolved.get("namespace"),
            "created_at": resolved.get("created_at"),
            "summary": (resolved.get("analysis_json") or {}).get("summary", "")[:500] if isinstance(resolved.get("analysis_json"), dict) else "",
        }
    # scan
    return {
        "type": "scan",
        "ref_id": ref_id,
        "resolved": True,
        "scope": resolved.get("scope"),
        "namespace": resolved.get("namespace"),
        "created_at": resolved.get("created_at"),
        "findings_count": resolved.get("findings_count", 0),
    }


async def export_incident(incident_id: str, fmt: str) -> tuple[str, str] | None:
    """
    Export incident as markdown or JSON. Deterministic and reproducible.
    Returns (content, media_type) or None if incident not found.
    """
    inc = await get_incident_with_timeline(incident_id)
    if not inc:
        return None
    timeline = inc.get("timeline") or []
    # Resolve refs for each item (deterministic order)
    resolved_timeline: list[dict[str, Any]] = []
    for entry in timeline:
        if entry.get("type") == "item":
            ref_id = entry.get("ref_id")
            item_type = entry.get("item_type", "analysis")
            resolved = await (get_analysis(ref_id) if item_type == "analysis" else get_scan(ref_id))
            summary = _ref_summary(item_type, ref_id or "", resolved)
            resolved_timeline.append({
                "type": "item",
                "created_at": entry.get("created_at"),
                "item_type": item_type,
                "ref_id": ref_id,
                "summary": summary,
            })
        elif entry.get("type") == "note":
            resolved_timeline.append({
                "type": "note",
                "created_at": entry.get("created_at"),
                "content": entry.get("content"),
            })
        else:
            resolved_timeline.append(dict(entry))

    if fmt == "json":
        payload = {
            "incident": {
                "id": inc["id"],
                "created_at": inc["created_at"],
                "title": inc["title"],
                "description": inc.get("description"),
                "severity": inc.get("severity"),
                "tags": inc.get("tags") or [],
                "status": inc.get("status"),
            },
            "timeline": resolved_timeline,
        }
        return json.dumps(payload, indent=2, default=str), "application/json"

    # markdown
    lines = [
        f"# Incident: {inc['title']}",
        "",
        f"- **ID**: {inc['id']}",
        f"- **Created**: {inc['created_at']}",
        f"- **Status**: {inc.get('status', 'open')}",
    ]
    if inc.get("severity"):
        lines.append(f"- **Severity**: {inc['severity']}")
    if inc.get("tags"):
        lines.append(f"- **Tags**: {', '.join(inc['tags'])}")
    if inc.get("description"):
        lines.append("")
        lines.append("## Description")
        lines.append("")
        lines.append(inc["description"])
    lines.append("")
    lines.append("## Timeline")
    lines.append("")
    for entry in resolved_timeline:
        at = entry.get("created_at", "")
        if entry.get("type") == "incident_created":
            lines.append(f"- **{at}** — Incident created")
        elif entry.get("type") == "item":
            s = entry.get("summary") or {}
            if s.get("resolved"):
                if s.get("type") == "analysis":
                    lines.append(f"- **{at}** — Analysis: {s.get('kind')} {s.get('name')} (ns: {s.get('namespace') or 'N/A'})")
                    if s.get("summary"):
                        lines.append(f"  - Summary: {s['summary'][:200]}{'…' if len(s.get('summary', '')) > 200 else ''}")
                else:
                    lines.append(f"- **{at}** — Scan: {s.get('scope')} (ns: {s.get('namespace') or 'N/A'}), {s.get('findings_count', 0)} findings")
            else:
                lines.append(f"- **{at}** — {entry.get('item_type')} `{entry.get('ref_id')}` (not found)")
        elif entry.get("type") == "note":
            lines.append(f"- **{at}** — Note: {entry.get('content', '')}")
        lines.append("")
    md = "\n".join(lines)
    return md, "text/markdown"

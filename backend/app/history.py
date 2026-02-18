"""Persist analysis history in SQLite."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any
from uuid import uuid4

import aiosqlite

from app.config import settings

logger = logging.getLogger(__name__)


def _db_path() -> str:
    p = settings.history_db_path
    if not os.path.isabs(p):
        p = os.path.join(os.path.dirname(os.path.dirname(__file__)), p)
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    return p


async def init_db() -> None:
    path = _db_path()
    async with aiosqlite.connect(path) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS analyses (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                context TEXT,
                namespace TEXT,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                analysis_json TEXT,
                analysis_markdown TEXT,
                evidence_summary TEXT,
                error TEXT
            )
        """)
        await db.commit()


async def save_analysis(
    context: str | None,
    namespace: str | None,
    kind: str,
    name: str,
    analysis_json: dict[str, Any],
    analysis_markdown: str,
    evidence: dict[str, Any],
    error: str | None,
) -> str:
    """Save analysis to DB. Returns id."""
    uid = str(uuid4())
    created = datetime.utcnow().isoformat() + "Z"
    evidence_summary = json.dumps(evidence, default=str)[:10000]  # summary only for list view
    path = _db_path()
    async with aiosqlite.connect(path) as db:
        await db.execute(
            """INSERT INTO analyses (id, created_at, context, namespace, kind, name, analysis_json, analysis_markdown, evidence_summary, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                uid,
                created,
                context,
                namespace,
                kind,
                name,
                json.dumps(analysis_json, default=str),
                analysis_markdown,
                evidence_summary,
                error,
            ),
        )
        await db.commit()
    return uid


async def list_analyses(limit: int = 50) -> list[dict[str, Any]]:
    path = _db_path()
    rows: list[dict[str, Any]] = []
    try:
        async with aiosqlite.connect(path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT id, created_at, context, namespace, kind, name, error FROM analyses ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ) as cur:
                async for row in cur:
                    rows.append({
                        "id": row["id"],
                        "created_at": row["created_at"],
                        "context": row["context"],
                        "namespace": row["namespace"],
                        "kind": row["kind"],
                        "name": row["name"],
                        "error": row["error"],
                    })
    except Exception as e:
        logger.warning("list_analyses failed: %s", e)
    return rows


async def get_analysis(analysis_id: str) -> dict[str, Any] | None:
    path = _db_path()
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, created_at, context, namespace, kind, name, analysis_json, analysis_markdown, evidence_summary, error FROM analyses WHERE id = ?",
            (analysis_id,),
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "context": row["context"],
        "namespace": row["namespace"],
        "kind": row["kind"],
        "name": row["name"],
        "analysis_json": json.loads(row["analysis_json"]) if row["analysis_json"] else {},
        "analysis_markdown": row["analysis_markdown"] or "",
        "evidence_summary": row["evidence_summary"],
        "error": row["error"],
    }

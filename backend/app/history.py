"""Persist analysis history using SQLAlchemy repository pattern."""
from __future__ import annotations

import logging
from typing import Any

from app.db.factory import get_session_maker
from app.db.repository import HistoryRepository

logger = logging.getLogger(__name__)


async def init_db() -> None:
    """Initialize database (create tables if needed)."""
    from app.db.factory import init_database

    await init_database()


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
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = HistoryRepository(session)
        return await repo.save_analysis(
            context=context,
            namespace=namespace,
            kind=kind,
            name=name,
            analysis_json=analysis_json,
            analysis_markdown=analysis_markdown,
            evidence=evidence,
            error=error,
        )


async def list_analyses(limit: int = 50, context: str | None = None) -> list[dict[str, Any]]:
    """List recent analyses, optionally filtered by context."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = HistoryRepository(session)
        return await repo.list_analyses(limit=limit, context=context)


async def delete_analysis(analysis_id: str) -> bool:
    """Delete analysis by ID. Returns True if deleted, False if not found."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = HistoryRepository(session)
        return await repo.delete_analysis(analysis_id)


async def get_analysis(analysis_id: str) -> dict[str, Any] | None:
    """Get analysis by ID."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = HistoryRepository(session)
        return await repo.get_analysis(analysis_id)

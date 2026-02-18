"""Scan persistence and execution."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.db.factory import get_session_maker
from app.db.repository import ScanRepository
from app.scanner import run_scan

logger = logging.getLogger(__name__)


async def execute_and_save_scan(
    context: str | None,
    scope: str,
    namespace: str | None,
    include_logs: bool,
) -> tuple[str, str | None, list[dict[str, Any]], dict[str, int], str | None, int]:
    """
    Run scanner (in thread) and persist. Returns (scan_id, summary_markdown, findings, counts, error, duration_ms).
    """
    start = time.perf_counter()
    findings, summary_markdown, scan_error = await asyncio.to_thread(
        run_scan,
        context=context,
        scope=scope,
        namespace=namespace,
        include_logs=include_logs,
    )
    duration_ms = int((time.perf_counter() - start) * 1000)
    counts: dict[str, int] = {}
    for f in findings:
        sev = f.get("severity", "info")
        counts[sev] = counts.get(sev, 0) + 1

    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = ScanRepository(session)
        scan_id = await repo.save_scan_run(
            context=context,
            scope=scope,
            namespace=namespace,
            summary_markdown=summary_markdown,
            error=scan_error,
            findings=findings,
        )
    return scan_id, summary_markdown, findings, counts, scan_error, duration_ms


async def list_scans(limit: int = 50) -> list[dict[str, Any]]:
    """List recent scans."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = ScanRepository(session)
        return await repo.list_scans(limit=limit)


async def get_scan(scan_id: str) -> dict[str, Any] | None:
    """Get scan by ID with findings."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        repo = ScanRepository(session)
        return await repo.get_scan(scan_id)

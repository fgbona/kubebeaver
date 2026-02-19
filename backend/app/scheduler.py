"""Built-in scheduler for scan_schedules (APScheduler). Does not require Redis."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.db.factory import get_session_maker
from app.db.repository import ScheduleRepository
from app.scan_service import execute_and_save_scan, get_scan
from app.notifications import notify_on_findings

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


async def _run_scheduled_scan(schedule_id: str, context: str | None, scope: str, namespace: str | None) -> None:
    """Execute scan and optionally send notifications. Swallows errors so app does not crash."""
    try:
        scan_id, _summary, _findings, counts, scan_error, _duration = await execute_and_save_scan(
            context=context,
            scope=scope,
            namespace=namespace,
            include_logs=False,
        )
        if scan_error:
            logger.warning("Scheduled scan %s (schedule %s) had error: %s", scan_id, schedule_id, scan_error)
        # Notify on critical/high with top findings
        scan_row = await get_scan(scan_id)
        findings = (scan_row.get("findings") or []) if scan_row else []
        await notify_on_findings(scan_id, counts, findings)
    except Exception as e:
        logger.exception("Scheduled scan (schedule %s) failed: %s", schedule_id, e)


def _job_run_scan(schedule_id: str, context: str | None, scope: str, namespace: str | None) -> None:
    """Sync wrapper for scheduler thread: run async _run_scheduled_scan."""
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_run_scheduled_scan(schedule_id, context, scope, namespace))
        finally:
            loop.close()
    except Exception as e:
        logger.exception("Scheduler job (schedule %s) failed: %s", schedule_id, e)


async def _load_enabled_schedules() -> list[dict[str, Any]]:
    """Load enabled schedules from DB."""
    try:
        session_maker = get_session_maker()
        async with session_maker() as session:
            repo = ScheduleRepository(session)
            return await repo.list_enabled()
    except Exception as e:
        logger.warning("Failed to load schedules for scheduler: %s", e)
        return []


def _add_jobs_sync(schedules: list[dict[str, Any]]) -> None:
    """Add job entries to scheduler (sync). Call with list from DB."""
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.remove_all_jobs()
    for s in schedules:
        sid = s["id"]
        cron = s.get("cron", "").strip()
        if not cron:
            continue
        parts = cron.split()
        if len(parts) != 5:
            logger.warning("Schedule %s invalid cron (need 5 parts): %s", sid, cron)
            continue
        try:
            trigger = CronTrigger.from_crontab(cron)
        except Exception as e:
            logger.warning("Schedule %s cron parse error: %s", sid, e)
            continue
        _scheduler.add_job(
            _job_run_scan,
            trigger=trigger,
            id=sid,
            args=[sid, s.get("context"), s["scope"], s.get("namespace")],
            replace_existing=True,
        )
    logger.info("Scheduler loaded %d job(s)", len(_scheduler.get_jobs()))


def start_scheduler() -> None:
    """Start APScheduler (no jobs yet). Does not require Redis. Call reload_scheduler_jobs_async after."""
    global _scheduler
    if _scheduler is not None:
        return
    try:
        _scheduler = BackgroundScheduler()
        _scheduler.start()
    except Exception as e:
        logger.exception("Failed to start scheduler: %s", e)
        _scheduler = None


def stop_scheduler() -> None:
    """Stop scheduler. Safe to call if not started."""
    global _scheduler
    if _scheduler is None:
        return
    try:
        _scheduler.shutdown(wait=False)
    except Exception as e:
        logger.warning("Scheduler shutdown error: %s", e)
    _scheduler = None


async def reload_scheduler_jobs_async() -> None:
    """Load enabled schedules from DB and add jobs. Call from lifespan or after schedule CRUD."""
    schedules = await _load_enabled_schedules()
    _add_jobs_sync(schedules)


def reload_scheduler_jobs_sync() -> None:
    """Reload jobs using a new event loop (for use from sync context, e.g. CLI). Prefer reload_scheduler_jobs_async from app."""
    async def _run() -> None:
        await reload_scheduler_jobs_async()

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_run())
    finally:
        loop.close()

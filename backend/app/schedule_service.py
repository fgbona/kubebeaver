"""Schedule CRUD and scheduler reload."""
from __future__ import annotations

from app.db.factory import get_session_maker
from app.db.repository import ScheduleRepository
from app.scheduler import reload_scheduler_jobs_async


async def create_schedule(
    context: str | None,
    scope: str,
    namespace: str | None,
    cron: str,
    enabled: bool = True,
) -> str:
    """Create schedule and reload scheduler jobs. Returns schedule id."""
    session_maker = get_session_maker()
    async with session_maker() as session:
        repo = ScheduleRepository(session)
        sid = await repo.create(
            context=context,
            scope=scope,
            namespace=namespace,
            cron=cron,
            enabled=enabled,
        )
    await reload_scheduler_jobs_async()
    return sid


async def list_schedules(limit: int = 100) -> list[dict]:
    """List all schedules."""
    session_maker = get_session_maker()
    async with session_maker() as session:
        repo = ScheduleRepository(session)
        return await repo.list_all(limit=limit)


async def get_schedule(schedule_id: str) -> dict | None:
    """Get schedule by id."""
    session_maker = get_session_maker()
    async with session_maker() as session:
        repo = ScheduleRepository(session)
        return await repo.get(schedule_id)


async def update_schedule(
    schedule_id: str,
    *,
    context: str | None = None,
    scope: str | None = None,
    namespace: str | None = None,
    cron: str | None = None,
    enabled: bool | None = None,
) -> bool:
    """Update schedule and reload scheduler jobs. Returns True if found."""
    session_maker = get_session_maker()
    async with session_maker() as session:
        repo = ScheduleRepository(session)
        ok = await repo.update(
            schedule_id,
            context=context,
            scope=scope,
            namespace=namespace,
            cron=cron,
            enabled=enabled,
        )
    if ok:
        await reload_scheduler_jobs_async()
    return ok


async def delete_schedule(schedule_id: str) -> bool:
    """Delete schedule and reload scheduler jobs. Returns True if found."""
    session_maker = get_session_maker()
    async with session_maker() as session:
        repo = ScheduleRepository(session)
        ok = await repo.delete(schedule_id)
    if ok:
        await reload_scheduler_jobs_async()
    return ok

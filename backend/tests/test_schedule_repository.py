"""Tests for schedule repository."""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.db.models import Base
from app.db.repository import ScheduleRepository


@pytest_asyncio.fixture
async def db_session():
    """In-memory SQLite session for tests."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async_session_maker = sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with async_session_maker() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_schedule(db_session: AsyncSession):
    """Test creating a schedule."""
    repo = ScheduleRepository(db_session)
    sid = await repo.create(
        context="ctx1",
        scope="namespace",
        namespace="default",
        cron="0 * * * *",
        enabled=True,
    )
    assert sid is not None
    assert len(sid) == 36


@pytest.mark.asyncio
async def test_list_all(db_session: AsyncSession):
    """Test listing schedules."""
    repo = ScheduleRepository(db_session)
    await repo.create(None, "cluster", None, "0 0 * * *", True)
    await repo.create("ctx", "namespace", "default", "0 * * * *", False)
    items = await repo.list_all(limit=10)
    assert len(items) == 2
    assert items[0]["cron"] == "0 * * * *"
    assert items[0]["scope"] == "namespace"
    assert items[0]["enabled"] is False
    assert items[1]["cron"] == "0 0 * * *"
    assert items[1]["enabled"] is True


@pytest.mark.asyncio
async def test_list_enabled(db_session: AsyncSession):
    """Test listing only enabled schedules."""
    repo = ScheduleRepository(db_session)
    await repo.create(None, "cluster", None, "0 0 * * *", True)
    await repo.create("ctx", "namespace", "default", "0 * * * *", False)
    items = await repo.list_enabled()
    assert len(items) == 1
    assert items[0]["cron"] == "0 0 * * *"


@pytest.mark.asyncio
async def test_get(db_session: AsyncSession):
    """Test get by id."""
    repo = ScheduleRepository(db_session)
    sid = await repo.create(None, "cluster", None, "0 * * * *", True)
    row = await repo.get(sid)
    assert row is not None
    assert row["id"] == sid
    assert row["scope"] == "cluster"
    assert row["cron"] == "0 * * * *"
    assert (await repo.get("nonexistent")) is None


@pytest.mark.asyncio
async def test_update(db_session: AsyncSession):
    """Test update schedule."""
    repo = ScheduleRepository(db_session)
    sid = await repo.create(None, "cluster", None, "0 * * * *", True)
    ok = await repo.update(sid, cron="5 * * * *", enabled=False)
    assert ok is True
    row = await repo.get(sid)
    assert row["cron"] == "5 * * * *"
    assert row["enabled"] is False
    assert (await repo.update("nonexistent", enabled=False)) is False


@pytest.mark.asyncio
async def test_delete(db_session: AsyncSession):
    """Test delete schedule."""
    repo = ScheduleRepository(db_session)
    sid = await repo.create(None, "cluster", None, "0 * * * *", True)
    ok = await repo.delete(sid)
    assert ok is True
    assert (await repo.get(sid)) is None
    assert (await repo.delete("nonexistent")) is False

"""Tests for incident repository."""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.db.models import Base
from app.db.repository import IncidentRepository


@pytest_asyncio.fixture
async def db_session():
    """Create an in-memory SQLite database session for testing."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
    )
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
async def test_create_incident(db_session: AsyncSession):
    """Test creating an incident."""
    repo = IncidentRepository(db_session)
    incident_id = await repo.create_incident(
        title="Test incident",
        description="Description",
        severity="high",
        tags=["tag1", "tag2"],
    )
    assert incident_id is not None
    assert len(incident_id) == 36


@pytest.mark.asyncio
async def test_add_item(db_session: AsyncSession):
    """Test adding an analysis/scan item to an incident."""
    repo = IncidentRepository(db_session)
    incident_id = await repo.create_incident(title="Incident")
    item_id = await repo.add_item(incident_id, item_type="analysis", ref_id="some-analysis-id")
    assert item_id is not None
    assert len(item_id) == 36

    item_id_scan = await repo.add_item(incident_id, item_type="scan", ref_id="some-scan-id")
    assert item_id_scan is not None

    # Unknown incident returns None
    none_id = await repo.add_item("non-existent", item_type="analysis", ref_id="x")
    assert none_id is None


@pytest.mark.asyncio
async def test_list_incidents(db_session: AsyncSession):
    """Test listing incidents."""
    repo = IncidentRepository(db_session)
    await repo.create_incident(title="First")
    await repo.create_incident(title="Second")
    items = await repo.list_incidents(limit=10)
    assert len(items) == 2
    assert items[0]["title"] == "Second"  # Newest first
    assert items[1]["title"] == "First"


@pytest.mark.asyncio
async def test_get_incident(db_session: AsyncSession):
    """Test get incident by id."""
    repo = IncidentRepository(db_session)
    incident_id = await repo.create_incident(title="Get me", severity="critical")
    inc = await repo.get_incident(incident_id)
    assert inc is not None
    assert inc["title"] == "Get me"
    assert inc["severity"] == "critical"

    assert await repo.get_incident("non-existent") is None


@pytest.mark.asyncio
async def test_get_incident_with_timeline(db_session: AsyncSession):
    """Test get incident with timeline (items + notes)."""
    repo = IncidentRepository(db_session)
    incident_id = await repo.create_incident(title="Timeline test")
    await repo.add_item(incident_id, item_type="analysis", ref_id="a1")
    await repo.add_note(incident_id, content="First note")
    await repo.add_item(incident_id, item_type="scan", ref_id="s1")

    inc = await repo.get_incident_with_timeline(incident_id)
    assert inc is not None
    assert len(inc["items"]) == 2
    assert len(inc["notes"]) == 1
    assert inc["notes"][0]["content"] == "First note"
    timeline = inc["timeline"]
    assert len(timeline) == 1 + 2 + 1  # created + 2 items + 1 note
    # Timeline sorted by created_at
    types = [t["type"] for t in timeline]
    assert "incident_created" in types
    assert "item" in types
    assert "note" in types


@pytest.mark.asyncio
async def test_add_note(db_session: AsyncSession):
    """Test adding a note to an incident."""
    repo = IncidentRepository(db_session)
    incident_id = await repo.create_incident(title="Note test")
    note_id = await repo.add_note(incident_id, content="Important note")
    assert note_id is not None
    assert len(note_id) == 36

    assert await repo.add_note("non-existent", content="x") is None

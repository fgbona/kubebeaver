"""Tests for history repository."""
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.db.models import Base
from app.db.repository import HistoryRepository


@pytest.fixture
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
async def test_save_analysis(db_session: AsyncSession):
    """Test saving an analysis."""
    repo = HistoryRepository(db_session)
    analysis_id = await repo.save_analysis(
        context="test-context",
        namespace="default",
        kind="Pod",
        name="test-pod",
        analysis_json={"summary": "Test analysis"},
        analysis_markdown="# Test Analysis",
        evidence={"pod": {"status": "Running"}},
        error=None,
    )
    assert analysis_id is not None
    assert len(analysis_id) == 36  # UUID length


@pytest.mark.asyncio
async def test_list_analyses(db_session: AsyncSession):
    """Test listing analyses."""
    repo = HistoryRepository(db_session)

    # Save a few analyses
    for i in range(3):
        await repo.save_analysis(
            context="test-context",
            namespace="default",
            kind="Pod",
            name=f"test-pod-{i}",
            analysis_json={"summary": f"Analysis {i}"},
            analysis_markdown=f"# Analysis {i}",
            evidence={"pod": {"status": "Running"}},
            error=None,
        )
        await db_session.commit()

    # List analyses
    analyses = await repo.list_analyses(limit=10)
    assert len(analyses) == 3
    assert analyses[0]["kind"] == "Pod"
    assert analyses[0]["name"] == "test-pod-2"  # Most recent first


@pytest.mark.asyncio
async def test_get_analysis(db_session: AsyncSession):
    """Test getting a single analysis."""
    repo = HistoryRepository(db_session)
    analysis_id = await repo.save_analysis(
        context="test-context",
        namespace="default",
        kind="Pod",
        name="test-pod",
        analysis_json={"summary": "Test analysis"},
        analysis_markdown="# Test Analysis",
        evidence={"pod": {"status": "Running"}},
        error=None,
    )
    await db_session.commit()

    # Get analysis
    analysis = await repo.get_analysis(analysis_id)
    assert analysis is not None
    assert analysis["id"] == analysis_id
    assert analysis["kind"] == "Pod"
    assert analysis["name"] == "test-pod"
    assert analysis["analysis_json"]["summary"] == "Test analysis"
    assert analysis["analysis_markdown"] == "# Test Analysis"

    # Get non-existent analysis
    analysis = await repo.get_analysis("non-existent-id")
    assert analysis is None

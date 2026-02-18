"""Tests for scan repository."""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.db.models import Base
from app.db.repository import ScanRepository


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
async def test_save_scan_run(db_session: AsyncSession):
    """Test saving a scan run with findings."""
    repo = ScanRepository(db_session)
    findings = [
        {
            "severity": "high",
            "category": "crash",
            "title": "Pod CrashLoopBackOff",
            "description": "Container crashing",
            "affected_refs": [{"kind": "Pod", "namespace": "default", "name": "web-0"}],
            "evidence_refs": [],
            "suggested_commands": ["kubectl logs -n default web-0"],
            "evidence_snippet": None,
        },
    ]
    scan_id = await repo.save_scan_run(
        context="ctx",
        scope="namespace",
        namespace="default",
        summary_markdown="# Scan summary",
        error=None,
        findings=findings,
    )
    assert scan_id is not None
    assert len(scan_id) == 36


@pytest.mark.asyncio
async def test_list_scans(db_session: AsyncSession):
    """Test listing scan runs."""
    repo = ScanRepository(db_session)
    await repo.save_scan_run(
        context=None,
        scope="cluster",
        namespace=None,
        summary_markdown="# 1",
        error=None,
        findings=[],
    )
    await repo.save_scan_run(
        context=None,
        scope="namespace",
        namespace="default",
        summary_markdown="# 2",
        error=None,
        findings=[],
    )

    scans = await repo.list_scans(limit=10)
    assert len(scans) == 2
    assert scans[0]["scope"] == "namespace"
    assert scans[1]["scope"] == "cluster"


@pytest.mark.asyncio
async def test_get_scan_with_findings(db_session: AsyncSession):
    """Test getting a scan by ID with findings."""
    repo = ScanRepository(db_session)
    findings = [
        {
            "severity": "medium",
            "category": "config",
            "title": "Replica mismatch",
            "description": "desired=3, ready=2",
            "affected_refs": [{"kind": "Deployment", "namespace": "default", "name": "api"}],
            "evidence_refs": [],
            "suggested_commands": ["kubectl get deploy -n default api"],
            "evidence_snippet": None,
        },
    ]
    scan_id = await repo.save_scan_run(
        context=None,
        scope="namespace",
        namespace="default",
        summary_markdown="# Summary",
        error=None,
        findings=findings,
    )

    scan = await repo.get_scan(scan_id)
    assert scan is not None
    assert scan["id"] == scan_id
    assert scan["findings_count"] == 1
    assert len(scan["findings"]) == 1
    assert scan["findings"][0]["title"] == "Replica mismatch"
    assert scan["findings"][0]["severity"] == "medium"

    none_scan = await repo.get_scan("non-existent")
    assert none_scan is None

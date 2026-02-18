"""Database engine factory supporting SQLite (default) and DATABASE_URL (MySQL/Postgres)."""
from __future__ import annotations

import logging
import os
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)

_engine: AsyncEngine | None = None
_async_session_maker: sessionmaker[AsyncSession] | None = None


def get_db_engine() -> AsyncEngine:
    """Get or create the database engine."""
    global _engine
    if _engine is not None:
        return _engine

    database_url = settings.database_url

    if database_url:
        # Use DATABASE_URL (MySQL/Postgres)
        # Convert postgres:// to postgresql+asyncpg://
        # Convert mysql:// to mysql+aiomysql://
        if database_url.startswith("postgres://"):
            database_url = database_url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif database_url.startswith("postgresql://"):
            database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif database_url.startswith("mysql://"):
            database_url = database_url.replace("mysql://", "mysql+aiomysql://", 1)
        elif database_url.startswith("mysql+pymysql://"):
            database_url = database_url.replace("mysql+pymysql://", "mysql+aiomysql://", 1)

        logger.info("Using DATABASE_URL: %s", database_url.split("@")[-1] if "@" in database_url else database_url)
        _engine = create_async_engine(
            database_url,
            echo=False,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
        )
    else:
        # Use SQLite (default)
        db_path = settings.history_db_path
        if not os.path.isabs(db_path):
            db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), db_path)
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        sqlite_url = f"sqlite+aiosqlite:///{db_path}"
        logger.info("Using SQLite: %s", db_path)
        _engine = create_async_engine(
            sqlite_url,
            echo=False,
            connect_args={"check_same_thread": False},  # SQLite-specific
        )

    return _engine


def get_session_maker() -> sessionmaker[AsyncSession]:
    """Get or create the session maker."""
    global _async_session_maker
    if _async_session_maker is not None:
        return _async_session_maker

    engine = get_db_engine()
    _async_session_maker = sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )
    return _async_session_maker


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Get a database session (dependency for FastAPI)."""
    async_session_maker = get_session_maker()
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_database() -> None:
    """Initialize database (create tables if needed)."""
    from app.db.models import Base

    engine = get_db_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database initialized")


async def close_database() -> None:
    """Close database connections."""
    global _engine, _async_session_maker
    if _engine:
        await _engine.dispose()
        _engine = None
        _async_session_maker = None

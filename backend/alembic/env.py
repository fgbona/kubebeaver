"""Alembic environment configuration."""
import os
from logging.config import fileConfig
from pathlib import Path
import sys

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from app.config import settings
from app.db.models import Base

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def get_url() -> str:
    """Get database URL for Alembic. Prefer ALEMBIC_DATABASE_URL when running migrations from host (e.g. localhost instead of Docker host 'mysql')."""
    database_url = os.environ.get("ALEMBIC_DATABASE_URL") or settings.database_url

    if database_url:
        # Convert async drivers to sync for Alembic
        if database_url.startswith("postgresql+asyncpg://"):
            database_url = database_url.replace("postgresql+asyncpg://", "postgresql://", 1)
        elif database_url.startswith("mysql+aiomysql://"):
            database_url = database_url.replace("mysql+aiomysql://", "mysql+pymysql://", 1)
        return database_url
    else:
        # SQLite
        db_path = settings.history_db_path
        if not os.path.isabs(db_path):
            db_path = os.path.join(backend_dir, db_path)
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        return f"sqlite:///{db_path}"


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    from sqlalchemy import create_engine

    url = get_url()
    # Convert async URL to sync for Alembic
    # Note: Alembic uses sync drivers, so we convert async URLs
    if "postgresql+asyncpg://" in url:
        url = url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
    elif "mysql+aiomysql://" in url:
        url = url.replace("mysql+aiomysql://", "mysql+pymysql://", 1)

    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = url

    # Use sync engine for Alembic (Alembic doesn't support async directly)
    connectable = create_engine(url, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    import asyncio

    asyncio.run(run_migrations_online())

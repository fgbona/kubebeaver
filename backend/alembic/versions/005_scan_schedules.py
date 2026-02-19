"""Scan schedules table

Revision ID: 005
Revises: 004
Create Date: 2026-02-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "scan_schedules" in insp.get_table_names():
        return
    op.create_table(
        "scan_schedules",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.String(length=30), nullable=False),
        sa.Column("context", sa.String(length=255), nullable=True),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("namespace", sa.String(length=255), nullable=True),
        sa.Column("cron", sa.String(length=100), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scan_schedules_enabled", "scan_schedules", ["enabled"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_scan_schedules_enabled", table_name="scan_schedules")
    op.drop_table("scan_schedules")

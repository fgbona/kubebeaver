"""Scan runs and scan findings tables

Revision ID: 002
Revises: 001
Create Date: 2026-02-18 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "scan_runs" in insp.get_table_names():
        return
    op.create_table(
        "scan_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.String(length=30), nullable=False),
        sa.Column("context", sa.String(length=255), nullable=True),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("namespace", sa.String(length=255), nullable=True),
        sa.Column("summary_markdown", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("findings_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "scan_findings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("scan_run_id", sa.String(length=36), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("affected_refs", sa.Text(), nullable=True),
        sa.Column("evidence_refs", sa.Text(), nullable=True),
        sa.Column("suggested_commands", sa.Text(), nullable=True),
        sa.Column("evidence_snippet", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["scan_run_id"], ["scan_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scan_findings_scan_run_id", "scan_findings", ["scan_run_id"], unique=False)
    op.create_index("ix_scan_runs_created_at", "scan_runs", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_scan_runs_created_at", table_name="scan_runs")
    op.drop_index("ix_scan_findings_scan_run_id", table_name="scan_findings")
    op.drop_table("scan_findings")
    op.drop_table("scan_runs")

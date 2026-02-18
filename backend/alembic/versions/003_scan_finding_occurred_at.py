"""Add occurred_at to scan_findings

Revision ID: 003
Revises: 002
Create Date: 2026-02-18 22:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("scan_findings", sa.Column("occurred_at", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("scan_findings", "occurred_at")

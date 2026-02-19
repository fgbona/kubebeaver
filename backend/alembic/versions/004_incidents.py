"""Incidents, incident_items, incident_notes tables

Revision ID: 004
Revises: 003
Create Date: 2026-02-18 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "incidents" in insp.get_table_names():
        return
    op.create_table(
        "incidents",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("severity", sa.String(length=20), nullable=True),
        sa.Column("tags", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="open"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "incident_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("incident_id", sa.String(length=36), nullable=False),
        sa.Column("item_type", sa.String(length=20), nullable=False),
        sa.Column("ref_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.String(length=30), nullable=False),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "incident_notes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("incident_id", sa.String(length=36), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(length=30), nullable=False),
        sa.ForeignKeyConstraint(["incident_id"], ["incidents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_incident_items_incident_id", "incident_items", ["incident_id"], unique=False)
    op.create_index("ix_incident_notes_incident_id", "incident_notes", ["incident_id"], unique=False)
    op.create_index("ix_incidents_created_at", "incidents", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_incidents_created_at", table_name="incidents")
    op.drop_index("ix_incident_notes_incident_id", table_name="incident_notes")
    op.drop_index("ix_incident_items_incident_id", table_name="incident_items")
    op.drop_table("incident_notes")
    op.drop_table("incident_items")
    op.drop_table("incidents")

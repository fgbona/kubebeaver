"""Initial analyses table

Revision ID: 001
Revises:
Create Date: 2026-02-18 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if 'analyses' in insp.get_table_names():
        return  # Table already exists (e.g. created by app init_database())
    op.create_table(
        'analyses',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.String(length=30), nullable=False),
        sa.Column('context', sa.String(length=255), nullable=True),
        sa.Column('namespace', sa.String(length=255), nullable=True),
        sa.Column('kind', sa.String(length=50), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('analysis_json', sa.Text(), nullable=True),
        sa.Column('analysis_markdown', sa.Text(), nullable=True),
        sa.Column('evidence_summary', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('analyses')

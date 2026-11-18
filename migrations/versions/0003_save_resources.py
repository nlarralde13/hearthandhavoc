"""add persisted save resources

Revision ID: 0003_save_resources
Revises: 0002_combat_encounters
Create Date: 2026-11-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_save_resources"
down_revision: Union[str, None] = "0002_combat_encounters"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("saves", sa.Column("resources", sa.Text(), nullable=False, server_default='{"wood": 0}'))


def downgrade() -> None:
    op.drop_column("saves", "resources")

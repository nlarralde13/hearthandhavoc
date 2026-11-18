"""add combat encounter persistence

Revision ID: 0002_combat_encounters
Revises: 0001_initial
Create Date: 2026-11-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_combat_encounters"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "combat_encounters",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("save_id", sa.String(length=36), nullable=False),
        sa.Column("enemy_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("state_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("save_id", name="uq_combat_encounter_save"),
    )
    op.create_index("ix_combat_encounters_save_id", "combat_encounters", ["save_id"])


def downgrade() -> None:
    op.drop_index("ix_combat_encounters_save_id", table_name="combat_encounters")
    op.drop_table("combat_encounters")

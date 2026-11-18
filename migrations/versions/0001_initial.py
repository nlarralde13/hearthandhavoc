"""initial save and action receipt tables

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-18
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saves",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_id", sa.String(length=255), nullable=False),
        sa.Column("background_id", sa.String(length=64), nullable=False),
        sa.Column("state_version", sa.Integer(), nullable=False),
        sa.Column("root_seed", sa.String(length=64), nullable=False),
        sa.Column("content_version", sa.String(length=32), nullable=False),
        sa.Column("route_id", sa.String(length=64), nullable=False),
        sa.Column("route_offset", sa.Integer(), nullable=False),
        sa.Column("discovered_locations", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saves_owner_id", "saves", ["owner_id"])
    op.create_table(
        "action_receipts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("save_id", sa.String(length=36), nullable=False),
        sa.Column("action_id", sa.String(length=64), nullable=False),
        sa.Column("action_type", sa.String(length=64), nullable=False),
        sa.Column("state_version", sa.Integer(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("save_id", "action_id", name="uq_receipt_save_action"),
    )
    op.create_index("ix_action_receipts_save_id", "action_receipts", ["save_id"])


def downgrade() -> None:
    op.drop_index("ix_action_receipts_save_id", table_name="action_receipts")
    op.drop_table("action_receipts")
    op.drop_index("ix_saves_owner_id", table_name="saves")
    op.drop_table("saves")

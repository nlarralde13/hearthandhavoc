"""persist M2 prologue and quest activation state

Revision ID: 0005_prologue_state
Revises: 0004_character_homestead
Create Date: 2026-11-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_prologue_state"
down_revision: Union[str, None] = "0004_character_homestead"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_STATE = '{"adventure_started": false, "quest_status": "inactive", "stranger_met": false}'


def upgrade() -> None:
    op.add_column("saves", sa.Column("prologue_state", sa.Text(), nullable=True))
    op.execute(
        sa.text("UPDATE saves SET prologue_state = :default_state").bindparams(
            default_state=DEFAULT_STATE
        )
    )


def downgrade() -> None:
    op.drop_column("saves", "prologue_state")

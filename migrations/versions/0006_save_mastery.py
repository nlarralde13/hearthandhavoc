"""persist M3 profession mastery

Revision ID: 0006_save_mastery
Revises: 0005_prologue_state
Create Date: 2026-11-19
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_save_mastery"
down_revision: Union[str, None] = "0005_prologue_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("saves", sa.Column("mastery", sa.Text(), nullable=True))
    op.execute(sa.text("UPDATE saves SET mastery = :mastery").bindparams(mastery='{"logging": 0}'))


def downgrade() -> None:
    op.drop_column("saves", "mastery")

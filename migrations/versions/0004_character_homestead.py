"""persist MVP character and homestead state

Revision ID: 0004_character_homestead
Revises: 0003_save_resources
Create Date: 2026-11-19

Existing saves receive the original blacksmith defaults. New character creation
supplies the player's name while retaining one active save per browser client.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_character_homestead"
down_revision: Union[str, None] = "0003_save_resources"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ATTRIBUTES = '{"agility": 8, "endurance": 10, "intellect": 8, "might": 14}'
EQUIPMENT = "[\"Forge Hammer\", \"Nailed Scrap Board\", \"Blacksmith's Apron\"]"
HOMESTEAD = (
    '{"rooms": [{"id": "main_room", "type": "shack", "grid_x": 0, '
    '"grid_y": 0, "width": 1, "height": 1, "condition": "dilapidated", '
    '"upgrades": {"front_door": "broken"}}], "front_door": "broken"}'
)


def upgrade() -> None:
    op.add_column("saves", sa.Column("character_name", sa.String(length=80), nullable=True))
    op.add_column("saves", sa.Column("archetype_id", sa.String(length=64), nullable=True))
    op.add_column("saves", sa.Column("attributes", sa.Text(), nullable=True))
    op.add_column("saves", sa.Column("equipment", sa.Text(), nullable=True))
    op.add_column("saves", sa.Column("homestead", sa.Text(), nullable=True))
    op.execute(
        sa.text(
            "UPDATE saves SET character_name = 'Blacksmith', "
            "archetype_id = 'son_of_blacksmith', "
            "attributes = :attributes, equipment = :equipment, homestead = :homestead"
        ).bindparams(
            attributes=ATTRIBUTES, equipment=EQUIPMENT, homestead=HOMESTEAD
        )
    )


def downgrade() -> None:
    op.drop_column("saves", "homestead")
    op.drop_column("saves", "equipment")
    op.drop_column("saves", "attributes")
    op.drop_column("saves", "archetype_id")
    op.drop_column("saves", "character_name")

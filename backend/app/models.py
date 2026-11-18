from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Save(Base):
    __tablename__ = "saves"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str] = mapped_column(String(255), index=True)
    background_id: Mapped[str] = mapped_column(String(64), default="blacksmith")
    state_version: Mapped[int] = mapped_column(Integer, default=1)
    root_seed: Mapped[str] = mapped_column(String(64))
    content_version: Mapped[str] = mapped_column(String(32), default="0.1.0")
    route_id: Mapped[str] = mapped_column(String(64), default="western_road")
    route_offset: Mapped[int] = mapped_column(Integer, default=0)
    discovered_locations: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class ActionReceipt(Base):
    __tablename__ = "action_receipts"
    __table_args__ = (UniqueConstraint("save_id", "action_id", name="uq_receipt_save_action"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    save_id: Mapped[str] = mapped_column(String(36), index=True)
    action_id: Mapped[str] = mapped_column(String(64))
    action_type: Mapped[str] = mapped_column(String(64))
    state_version: Mapped[int] = mapped_column(Integer)
    result_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class CombatEncounter(Base):
    __tablename__ = "combat_encounters"
    __table_args__ = (UniqueConstraint("save_id", name="uq_combat_encounter_save"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    save_id: Mapped[str] = mapped_column(String(36), index=True)
    enemy_id: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="active")
    state_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

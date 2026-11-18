from typing import Any, Literal

from pydantic import BaseModel, Field


class CreateSaveRequest(BaseModel):
    background_id: Literal["blacksmith"] = "blacksmith"


class ActionRequest(BaseModel):
    action_id: str = Field(min_length=1, max_length=64)
    action: Literal["travel.advance"]
    expected_state_version: int = Field(ge=1)
    payload: dict[str, Any] = Field(default_factory=dict)


class SaveState(BaseModel):
    save_id: str
    background_id: str
    state_version: int
    content_version: str
    route_id: str
    route_offset: int
    discovered_locations: list[str]


class ActionResponse(BaseModel):
    action_id: str
    state_version: int
    replayed: bool = False
    events: list[dict[str, Any]]
    state: SaveState

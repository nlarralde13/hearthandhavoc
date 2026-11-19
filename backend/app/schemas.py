from typing import Any, Literal

from pydantic import BaseModel, Field


class CreateSaveRequest(BaseModel):
    background_id: Literal["blacksmith"] = "blacksmith"
    character_name: str | None = Field(default=None, min_length=1, max_length=80)
    archetype_id: Literal["son_of_blacksmith"] = "son_of_blacksmith"


class PrologueState(BaseModel):
    stranger_met: bool
    quest_status: Literal["inactive", "offered", "active", "completed"]
    adventure_started: bool
    briarbrook_contacted: bool = False
    father_lead_revealed: bool = False
    expedited_unlocked: bool = False
    expedited_journey: dict[str, Any] | None = None
    homestead_repaired: bool = False


class ActionRequest(BaseModel):
    action_id: str = Field(min_length=1, max_length=64)
    action: Literal[
        "homestead.explore",
        "quest.accept",
        "adventure.start",
        "npc.garrick.talk",
        "travel.advance",
        "travel.expedited",
        "gather.wood",
        "homestead.deposit",
        "craft.iron_nails",
        "homestead.repair_door",
    ]
    expected_state_version: int = Field(ge=1)
    payload: dict[str, Any] = Field(default_factory=dict)


class SaveState(BaseModel):
    save_id: str
    background_id: str
    character_name: str
    archetype_id: str
    attributes: dict[str, int]
    equipment: list[str]
    homestead: dict[str, Any]
    prologue: PrologueState
    state_version: int
    content_version: str
    route_id: str
    route_offset: int
    discovered_locations: list[str]
    resources: dict[str, int]
    mastery: dict[str, int]


class RouteWaypointView(BaseModel):
    offset: int
    location_id: str | None
    label: str
    known: bool


class RouteMapResponse(BaseModel):
    route_id: str
    display_name: str
    length: int
    current_offset: int
    waypoints: list[RouteWaypointView]


class ActionResponse(BaseModel):
    action_id: str
    state_version: int
    replayed: bool = False
    events: list[dict[str, Any]]
    state: SaveState


class StartCombatRequest(BaseModel):
    enemy_id: Literal["goblin"] = "goblin"


class CombatActionRequest(BaseModel):
    action_id: str = Field(min_length=1, max_length=64)
    action: Literal["attack", "defend"]
    expected_action_index: int = Field(ge=0)


class CombatStateResponse(BaseModel):
    encounter_id: str
    enemy_id: str
    turn: Literal["player", "enemy"]
    status: Literal["active", "victory", "defeat"]
    round: int
    action_index: int
    player_hp: int
    player_max_hp: int
    enemy_hp: int
    enemy_max_hp: int


class CombatActionResponse(BaseModel):
    action_id: str
    replayed: bool = False
    events: list[dict[str, Any]]
    state: CombatStateResponse
    save_state: SaveState | None = None

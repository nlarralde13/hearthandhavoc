import json
import os
import tempfile
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.settings import get_settings


class WorldNode(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_\-]+$")
    name: str = Field(min_length=1, max_length=120)
    type: str = Field(min_length=1, max_length=40)
    map_id: str = Field(min_length=1, max_length=80)
    parent_location_id: str | None = None
    position: dict[str, float]
    description: str = ""
    discovery: str = "on_visit"
    key_location: bool = False
    child_map_id: str | None = None
    content: dict[str, Any] = Field(default_factory=dict)

    @field_validator("position")
    @classmethod
    def validate_position(cls, value: dict[str, float]) -> dict[str, float]:
        if "x" not in value or "y" not in value:
            raise ValueError("position requires x and y")
        if value["x"] < 0 or value["y"] < 0:
            raise ValueError("position coordinates cannot be negative")
        return value


class ExpeditedTravel(BaseModel):
    eligible: bool = False
    ambush_chance: float = Field(default=0, ge=0, le=1)


class WorldWaypoint(BaseModel):
    location_id: str = Field(min_length=1, max_length=80)
    route_offset: int = Field(ge=0)


class WorldConnection(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_\-]+$")
    source: str = Field(min_length=1, max_length=80)
    destination: str = Field(min_length=1, max_length=80)
    bidirectional: bool = True
    travel_turns: int = Field(ge=0)
    discovery_requirements: list[str] = Field(default_factory=list)
    expedited_travel: ExpeditedTravel = Field(default_factory=ExpeditedTravel)
    narrative_id: str | None = None
    waypoints: list[WorldWaypoint] = Field(default_factory=list)


class WorldMap(BaseModel):
    schema_version: str = "1.0.0"
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_\-]+$")
    name: str = Field(min_length=1, max_length=120)
    parent_map_id: str | None = None
    parent_location_id: str | None = None
    nodes: list[WorldNode] = Field(default_factory=list)
    connections: list[WorldConnection] = Field(default_factory=list)


class WorldValidation(BaseModel):
    warnings: list[str] = Field(default_factory=list)


def _override_root_base() -> Path:
    configured = Path(get_settings().world_data_dir)
    return configured if configured.is_absolute() else Path.cwd() / configured


def _override_root() -> Path:
    return _override_root_base() / "overrides" / "maps"


def _fixture_root() -> Path:
    return Path(__file__).resolve().parents[2] / "game_data" / "world" / "maps"


def _map_path(map_id: str, root: Path) -> Path:
    if not map_id or "/" in map_id or "\\" in map_id or ".." in map_id:
        raise ValueError("invalid map ID")
    return root / f"{map_id}.json"


def validate_world_map(world_map: WorldMap, all_maps: list[WorldMap] | None = None) -> WorldValidation:
    node_ids = [node.id for node in world_map.nodes]
    connection_ids = [connection.id for connection in world_map.connections]
    if len(node_ids) != len(set(node_ids)):
        raise ValueError("node IDs must be unique within a map")
    if len(connection_ids) != len(set(connection_ids)):
        raise ValueError("connection IDs must be unique within a map")
    node_set = set(node_ids)
    for node in world_map.nodes:
        if node.map_id != world_map.id:
            raise ValueError(f"node {node.id} must belong to map {world_map.id}")
    for connection in world_map.connections:
        if connection.source not in node_set or connection.destination not in node_set:
            raise ValueError(f"connection {connection.id} has a dangling node reference")
        if connection.source == connection.destination:
            raise ValueError(f"connection {connection.id} cannot connect a node to itself")
        for waypoint in connection.waypoints:
            if waypoint.location_id not in node_set:
                raise ValueError(f"waypoint {waypoint.location_id} is not a node in this map")
            if waypoint.route_offset > connection.travel_turns:
                raise ValueError(f"waypoint {waypoint.location_id} exceeds connection travel cost")

    warnings: list[str] = []
    connected = {node.id for connection in world_map.connections for node in (
        next((item for item in world_map.nodes if item.id == connection.source), None),
        next((item for item in world_map.nodes if item.id == connection.destination), None),
    ) if node}
    for node in world_map.nodes:
        if node.id not in connected and len(world_map.nodes) > 1:
            warnings.append(f"location {node.id} is unreachable from the visible graph")

    if all_maps is not None:
        map_ids = {item.id for item in all_maps}
        if world_map.parent_map_id and world_map.parent_map_id not in map_ids:
            raise ValueError(f"parent map {world_map.parent_map_id} does not exist")
        child_ids = {node.child_map_id for item in all_maps for node in item.nodes if node.child_map_id}
        if len(child_ids) != len([node.child_map_id for item in all_maps for node in item.nodes if node.child_map_id]):
            raise ValueError("a child map may be referenced by only one location")
        by_id = {item.id: item for item in all_maps}
        for item in all_maps:
            seen: set[str] = set()
            current: WorldMap | None = item
            while current and current.parent_map_id:
                if current.id in seen:
                    raise ValueError("map hierarchy contains a cycle")
                seen.add(current.id)
                current = by_id.get(current.parent_map_id)
    return WorldValidation(warnings=warnings)


def _parse(path: Path) -> WorldMap:
    try:
        return WorldMap.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError as exc:
        raise ValueError(f"world map does not exist: {path.stem}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"world map is invalid JSON: {path.name}") from exc


def list_world_maps() -> list[WorldMap]:
    maps: dict[str, WorldMap] = {}
    for root in (_fixture_root(), _override_root()):
        if root.exists():
            for path in root.glob("*.json"):
                maps[path.stem] = _parse(path)
    result = list(maps.values())
    for item in result:
        validate_world_map(item, result)
    return sorted(result, key=lambda item: item.id)


def load_world_map(map_id: str) -> WorldMap:
    override = _map_path(map_id, _override_root())
    fixture = _map_path(map_id, _fixture_root())
    return _parse(override if override.exists() else fixture)


def save_world_map(world_map: WorldMap) -> WorldValidation:
    maps = [item for item in list_world_maps() if item.id != world_map.id] + [world_map]
    validation = validate_world_map(world_map, maps)
    root = _override_root()
    root.mkdir(parents=True, exist_ok=True)
    destination = _map_path(world_map.id, root)
    fd, temporary = tempfile.mkstemp(prefix=f".{world_map.id}.", suffix=".json", dir=root)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(world_map.model_dump(mode="json"), handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return validation

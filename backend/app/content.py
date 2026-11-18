import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.domain.travel import Route, Waypoint

CONTENT_ROOT = Path(__file__).resolve().parents[2] / "game_data"


class ContentError(ValueError):
    pass


@lru_cache
def load_route_record(route_id: str) -> dict[str, Any]:
    path = CONTENT_ROOT / "routes" / f"{route_id}.json"
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise ContentError(f"route content is unavailable: {route_id}") from exc

    if record.get("route_id") != route_id:
        raise ContentError(f"route content ID does not match filename: {route_id}")
    if not isinstance(record.get("length"), int) or record["length"] <= 0:
        raise ContentError(f"route length is invalid: {route_id}")
    waypoints = record.get("waypoints")
    if not isinstance(waypoints, list):
        raise ContentError(f"route waypoints are invalid: {route_id}")

    offsets: set[int] = set()
    location_ids: set[str] = set()
    for waypoint in waypoints:
        if not isinstance(waypoint, dict):
            raise ContentError(f"route waypoint is invalid: {route_id}")
        location_id = waypoint.get("location_id")
        offset = waypoint.get("offset")
        display_name = waypoint.get("display_name")
        if (
            not isinstance(location_id, str)
            or not location_id
            or not isinstance(offset, int)
            or offset <= 0
            or offset > record["length"]
            or not isinstance(display_name, str)
            or not display_name
            or offset in offsets
            or location_id in location_ids
        ):
            raise ContentError(f"route waypoint data is invalid: {route_id}")
        offsets.add(offset)
        location_ids.add(location_id)
    return record


@lru_cache
def load_route(route_id: str) -> Route:
    record = load_route_record(route_id)
    return Route(
        route_id=route_id,
        length=record["length"],
        waypoints=tuple(
            Waypoint(waypoint["location_id"], waypoint["offset"])
            for waypoint in record["waypoints"]
        ),
    )

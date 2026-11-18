from dataclasses import dataclass


@dataclass(frozen=True)
class Waypoint:
    location_id: str
    offset: int


@dataclass(frozen=True)
class Route:
    route_id: str
    length: int
    waypoints: tuple[Waypoint, ...]


@dataclass(frozen=True)
class TravelState:
    route_id: str
    offset: int
    discovered: frozenset[str]


@dataclass(frozen=True)
class TravelResult:
    state: TravelState
    events: tuple[dict, ...]


class TravelError(ValueError):
    pass


def advance(route: Route, state: TravelState) -> TravelResult:
    if state.route_id != route.route_id:
        raise TravelError("character is not on this route")
    if state.offset >= route.length:
        raise TravelError("route is already complete")

    next_offset = state.offset + 1
    discovered = set(state.discovered)
    events: list[dict] = [
        {"type": "travel.advanced", "route_id": route.route_id, "offset": next_offset}
    ]

    for waypoint in route.waypoints:
        if waypoint.offset == next_offset and waypoint.location_id not in discovered:
            discovered.add(waypoint.location_id)
            events.append({"type": "location.discovered", "location_id": waypoint.location_id})

    return TravelResult(
        state=TravelState(route.route_id, next_offset, frozenset(discovered)),
        events=tuple(events),
    )

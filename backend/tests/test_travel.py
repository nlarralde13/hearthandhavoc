import pytest
from app.content import load_route
from app.domain.travel import TravelError, TravelState, advance

WESTERN_ROAD = load_route("western_road")


def test_old_timberwood_is_discovered_at_offset_six() -> None:
    state = TravelState("western_road", 5, frozenset())

    result = advance(WESTERN_ROAD, state)

    assert result.state.offset == 6
    assert "old_timberwood" in result.state.discovered
    assert {event["type"] for event in result.events} == {"travel.advanced", "location.discovered"}


def test_discovery_is_not_repeated() -> None:
    state = TravelState("western_road", 6, frozenset({"old_timberwood"}))

    result = advance(WESTERN_ROAD, state)

    assert result.state.offset == 7
    assert all(event["type"] != "location.discovered" for event in result.events)


def test_completed_route_cannot_advance() -> None:
    with pytest.raises(TravelError, match="already complete"):
        advance(WESTERN_ROAD, TravelState("western_road", 20, frozenset({"briarbrook"})))

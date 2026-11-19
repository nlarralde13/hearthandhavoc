import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settings import get_settings
from app.world import WorldMap, list_world_maps, save_world_map, validate_world_map


def test_sample_world_preserves_western_road_waypoint() -> None:
    maps = {world_map.id: world_map for world_map in list_world_maps()}
    western = maps["western_region"]
    road = western.connections[0]
    assert road.id == "western_road"
    assert road.travel_turns == 20
    assert road.waypoints[0].location_id == "old_timberwood"
    assert road.waypoints[0].route_offset == 6
    assert maps["briarbrook_town"].parent_map_id == "western_region"


def test_world_validation_rejects_dangling_connections() -> None:
    world_map = WorldMap(
        id="test_map",
        name="Test Map",
        nodes=[],
        connections=[{"id": "bad", "source": "missing", "destination": "also_missing", "travel_turns": 1}],
    )
    with pytest.raises(ValueError, match="dangling"):
        validate_world_map(world_map)


def test_world_editor_can_save_and_reload_override(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "world_data_dir", str(tmp_path))
    world_map = WorldMap(id="editor_test", name="Editor Test", nodes=[], connections=[])
    save_world_map(world_map)
    assert any(item.id == "editor_test" for item in list_world_maps())


def test_world_editor_api_is_available_only_in_development() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/dev/world/maps")
        assert response.status_code == 200
        assert {item["id"] for item in response.json()} >= {"western_region", "briarbrook_town"}

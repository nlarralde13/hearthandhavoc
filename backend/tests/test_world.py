import pytest
from app.db import Base, engine
from app.main import app
from app.settings import get_settings
from app.world import WorldMap, list_world_maps, save_world_map, validate_world_map
from fastapi.testclient import TestClient


def setup_function() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def resolve_combat(client: TestClient, headers: dict[str, str], save_id: str) -> None:
    combat_url = f"/api/v1/saves/{save_id}/combat"
    state = client.get(combat_url, headers=headers).json()
    while state["status"] == "active":
        response = client.post(
            f"{combat_url}/actions",
            headers=headers,
            json={
                "action_id": f"map-test-combat-{state['action_index']}",
                "action": "attack",
                "expected_action_index": state["action_index"],
            },
        )
        assert response.status_code == 200
        state = response.json()["state"]


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
        connections=[
            {"id": "bad", "source": "missing", "destination": "also_missing", "travel_turns": 1}
        ],
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


def test_player_world_map_filters_discovery_and_tracks_route_progress() -> None:
    with TestClient(app) as client:
        headers = {"X-Dev-User-ID": "player-map-user"}
        save = client.post(
            "/api/v1/saves", headers=headers, json={"character_name": "Map Tester"}
        ).json()
        map_url = f"/api/v1/saves/{save['save_id']}/world-map"

        initial = client.get(map_url, headers=headers).json()
        assert [node["id"] for node in initial["nodes"]] == ["homestead"]
        assert initial["connections"] == []

        version = 1
        for index, action in enumerate(("homestead.explore", "quest.accept", "adventure.start"), 1):
            response = client.post(
                f"/api/v1/saves/{save['save_id']}/actions",
                headers=headers,
                json={
                    "action_id": f"map-setup-{index}",
                    "action": action,
                    "expected_state_version": version,
                    "payload": {},
                },
            )
            assert response.status_code == 200
            version = response.json()["state_version"]

        guided = client.get(map_url, headers=headers).json()
        assert {node["id"] for node in guided["nodes"]} == {"homestead", "briarbrook"}
        assert guided["connections"][0]["travel_turns"] == 20

        for turn in range(1, 7):
            response = client.post(
                f"/api/v1/saves/{save['save_id']}/actions",
                headers=headers,
                json={
                    "action_id": f"map-travel-{turn}",
                    "action": "travel.advance",
                    "expected_state_version": version,
                    "payload": {},
                },
            )
            assert response.status_code == 200
            version = response.json()["state_version"]
            if turn == 5:
                resolve_combat(client, headers, save["save_id"])

        timberwood = client.get(map_url, headers=headers).json()
        assert {node["id"] for node in timberwood["nodes"]} == {
            "homestead", "old_timberwood", "briarbrook"
        }
        assert timberwood["travel"] == {
            "in_transit": True,
            "source": "homestead",
            "destination": "briarbrook",
            "completed_turns": 6,
            "total_turns": 20,
        }

        for turn in range(7, 21):
            response = client.post(
                f"/api/v1/saves/{save['save_id']}/actions",
                headers=headers,
                json={
                    "action_id": f"map-travel-{turn}",
                    "action": "travel.advance",
                    "expected_state_version": version,
                    "payload": {},
                },
            )
            assert response.status_code == 200
            version = response.json()["state_version"]

        arrived = client.get(map_url, headers=headers).json()
        assert arrived["current_location_id"] == "briarbrook"
        child = client.get(f"{map_url}?map_id=briarbrook_town", headers=headers)
        assert child.status_code == 200
        assert len(child.json()["nodes"]) == 4

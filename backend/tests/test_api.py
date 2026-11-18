from app.db import Base, SessionLocal, engine
from app.main import app
from app.schemas import ActionRequest
from app.services import StateConflict, create_save, get_save, perform_action
from fastapi.testclient import TestClient


def setup_function() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_create_load_and_replay_travel() -> None:
    with TestClient(app) as client:
        headers = {"X-Dev-User-ID": "test-user"}
        response = client.post(
            "/api/v1/saves", headers=headers, json={"background_id": "blacksmith"}
        )
        assert response.status_code == 201
        created = response.json()
        assert "root_seed" not in created
        assert created["state_version"] == 1

        command = {
            "action_id": "travel-1",
            "action": "travel.advance",
            "expected_state_version": 1,
            "payload": {},
        }
        first = client.post(
            f"/api/v1/saves/{created['save_id']}/actions", headers=headers, json=command
        )
        assert first.status_code == 200
        assert first.json()["state_version"] == 2
        assert first.json()["state"]["route_offset"] == 1

        replay = client.post(
            f"/api/v1/saves/{created['save_id']}/actions", headers=headers, json=command
        )
        assert replay.status_code == 200
        assert replay.json()["replayed"] is True
        assert replay.json()["state_version"] == 2

        stale = client.post(
            f"/api/v1/saves/{created['save_id']}/actions",
            headers=headers,
            json={**command, "action_id": "travel-2"},
        )
        assert stale.status_code == 409


def test_saves_are_owned_by_the_authenticated_actor() -> None:
    with TestClient(app) as client:
        created = client.post(
            "/api/v1/saves",
            headers={"X-Dev-User-ID": "owner"},
            json={},
        ).json()
        response = client.get(
            f"/api/v1/saves/{created['save_id']}/state",
            headers={"X-Dev-User-ID": "different-user"},
        )
        assert response.status_code == 404


def test_map_hides_undiscovered_waypoint_identity() -> None:
    with TestClient(app) as client:
        headers = {"X-Dev-User-ID": "map-user"}
        created = client.post("/api/v1/saves", headers=headers, json={}).json()

        response = client.get(f"/api/v1/saves/{created['save_id']}/map", headers=headers)

        assert response.status_code == 200
        waypoints = response.json()["waypoints"]
        assert waypoints[0] == {
            "offset": 6,
            "location_id": None,
            "label": "Unexplored waypoint",
            "known": False,
        }

        for turn in range(1, 7):
            action = {
                "action_id": f"map-travel-{turn}",
                "action": "travel.advance",
                "expected_state_version": turn,
                "payload": {},
            }
            assert (
                client.post(
                    f"/api/v1/saves/{created['save_id']}/actions",
                    headers=headers,
                    json=action,
                ).status_code
                == 200
            )

        discovered = client.get(f"/api/v1/saves/{created['save_id']}/map", headers=headers).json()
        assert discovered["waypoints"][0] == {
            "offset": 6,
            "location_id": "old_timberwood",
            "label": "Old Timberwood",
            "known": True,
        }


def test_stale_loaded_session_cannot_overwrite_a_newer_action() -> None:
    first_session = SessionLocal()
    second_session = SessionLocal()
    try:
        created = create_save(first_session, "concurrency-user", "blacksmith")
        get_save(second_session, "concurrency-user", created.save_id)
        request = ActionRequest(
            action_id="concurrent-travel",
            action="travel.advance",
            expected_state_version=1,
        )

        perform_action(first_session, "concurrency-user", created.save_id, request)

        try:
            perform_action(
                second_session,
                "concurrency-user",
                created.save_id,
                request.model_copy(update={"action_id": "concurrent-travel-2"}),
            )
        except StateConflict:
            pass
        else:
            raise AssertionError("stale session unexpectedly changed the save")

        current = get_save(first_session, "concurrency-user", created.save_id)
        assert current.route_offset == 1
        assert current.state_version == 2
    finally:
        first_session.close()
        second_session.close()


def test_start_and_replay_goblin_combat() -> None:
    with TestClient(app) as client:
        headers = {"X-Dev-User-ID": "combat-user"}
        created = client.post("/api/v1/saves", headers=headers, json={}).json()
        combat_url = f"/api/v1/saves/{created['save_id']}/combat"

        started = client.post(combat_url, headers=headers, json={})
        assert started.status_code == 200
        combat = started.json()
        assert combat["enemy_id"] == "goblin"
        assert "seed" not in combat
        assert combat["turn"] == "player"

        action = {
            "action_id": "goblin-attack-1",
            "action": "attack",
            "expected_action_index": combat["action_index"],
        }
        first = client.post(f"{combat_url}/actions", headers=headers, json=action)
        assert first.status_code == 200
        assert first.json()["state"]["action_index"] == combat["action_index"] + 1

        replay = client.post(f"{combat_url}/actions", headers=headers, json=action)
        assert replay.status_code == 200
        assert replay.json()["replayed"] is True

        stale = client.post(
            f"{combat_url}/actions",
            headers=headers,
            json={**action, "action_id": "goblin-attack-2"},
        )
        assert stale.status_code == 409

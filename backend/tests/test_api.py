from app.db import Base, engine
from app.main import app
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

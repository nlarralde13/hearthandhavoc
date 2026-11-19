from app.db import Base, SessionLocal, engine
from app.main import app
from app.schemas import ActionRequest
from app.services import StateConflict, create_save, get_save, perform_action
from fastapi.testclient import TestClient


def start_adventure(client: TestClient, headers: dict[str, str], save_id: str) -> int:
    version = 1
    for index, action in enumerate(("homestead.explore", "quest.accept", "adventure.start"), 1):
        response = client.post(
            f"/api/v1/saves/{save_id}/actions",
            headers=headers,
            json={"action_id": f"m2-setup-{index}", "action": action, "expected_state_version": version, "payload": {}},
        )
        assert response.status_code == 200
        version = response.json()["state_version"]
    return version


def resolve_combat(client: TestClient, headers: dict[str, str], save_id: str) -> None:
    combat_url = f"/api/v1/saves/{save_id}/combat"
    state = client.get(combat_url, headers=headers).json()
    while state["status"] == "active":
        response = client.post(
            f"{combat_url}/actions",
            headers=headers,
            json={
                "action_id": f"m3-test-combat-{state['action_index']}",
                "action": "attack",
                "expected_action_index": state["action_index"],
            },
        )
        assert response.status_code == 200
        state = response.json()["state"]


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
        assert created["resources"] == {"wood": 0}
        assert created["character_name"] == "Blacksmith"
        assert created["archetype_id"] == "son_of_blacksmith"
        assert created["attributes"] == {"agility": 8, "endurance": 10, "intellect": 8, "might": 14}
        assert created["equipment"] == ["Forge Hammer", "Nailed Scrap Board", "Blacksmith's Apron"]
        assert created["homestead"]["front_door"] == "broken"
        start_adventure(client, headers, created["save_id"])

        command = {
            "action_id": "travel-1",
            "action": "travel.advance",
            "expected_state_version": 4,
            "payload": {},
        }
        first = client.post(
            f"/api/v1/saves/{created['save_id']}/actions", headers=headers, json=command
        )
        assert first.status_code == 200
        assert first.json()["state_version"] == 5
        assert first.json()["state"]["route_offset"] == 1

        replay = client.post(
            f"/api/v1/saves/{created['save_id']}/actions", headers=headers, json=command
        )
        assert replay.status_code == 200
        assert replay.json()["replayed"] is True
        assert replay.json()["state_version"] == 5

        stale = client.post(
            f"/api/v1/saves/{created['save_id']}/actions",
            headers=headers,
            json={**command, "action_id": "travel-2"},
        )
        assert stale.status_code == 409


def test_character_creation_persists_name_and_rejects_unplayable_archetype() -> None:
    with TestClient(app) as client:
        headers = {"X-Dev-User-ID": "character-user"}
        created = client.post(
            "/api/v1/saves",
            headers=headers,
            json={"character_name": "Mara", "archetype_id": "son_of_blacksmith"},
        )
        assert created.status_code == 201
        assert created.json()["character_name"] == "Mara"

        disabled = client.post(
            "/api/v1/saves",
            headers=headers,
            json={"character_name": "Mara", "archetype_id": "farmhand"},
        )
        assert disabled.status_code == 422


def test_m2_prologue_exploration_quest_and_adventure_are_idempotent() -> None:
    with TestClient(app) as client:
        headers = {"X-Dev-User-ID": "m2-user"}
        created = client.post(
            "/api/v1/saves", headers=headers, json={"character_name": "Mara"}
        ).json()
        url = f"/api/v1/saves/{created['save_id']}/actions"

        def command(action_id: str, action: str, version: int) -> dict:
            return {
                "action_id": action_id,
                "action": action,
                "expected_state_version": version,
                "payload": {},
            }

        explore = client.post(url, headers=headers, json=command("explore-1", "homestead.explore", 1))
        assert explore.status_code == 200
        assert explore.json()["state"]["prologue"] == {
            "stranger_met": True,
            "quest_status": "offered",
            "adventure_started": False,
            "briarbrook_contacted": False,
            "father_lead_revealed": False,
        }
        assert [event["type"] for event in explore.json()["events"]] == [
            "stranger.appears",
            "quest.offered",
        ]

        replay = client.post(url, headers=headers, json=command("explore-1", "homestead.explore", 1))
        assert replay.status_code == 200
        assert replay.json()["replayed"] is True

        accept = client.post(
            url, headers=headers, json=command("accept-1", "quest.accept", explore.json()["state_version"])
        )
        assert accept.status_code == 200
        started = client.post(
            url,
            headers=headers,
            json=command("start-1", "adventure.start", accept.json()["state_version"]),
        )
        assert started.status_code == 200
        assert started.json()["state"]["prologue"]["adventure_started"] is True
        assert started.json()["state"]["route_offset"] == 0


def test_m3_guided_route_starts_goblin_encounter_and_tracks_gathering_mastery() -> None:
    with TestClient(app) as client:
        headers = {"X-Dev-User-ID": "m3-user"}
        created = client.post("/api/v1/saves", headers=headers, json={}).json()
        version = start_adventure(client, headers, created["save_id"])
        url = f"/api/v1/saves/{created['save_id']}/actions"

        for turn in range(1, 6):
            response = client.post(
                url,
                headers=headers,
                json={
                    "action_id": f"m3-route-{turn}",
                    "action": "travel.advance",
                    "expected_state_version": version,
                    "payload": {},
                },
            )
            assert response.status_code == 200
            version = response.json()["state_version"]
            if turn == 3:
                assert {event["type"] for event in response.json()["events"]} >= {"tutorial.tracks"}
            if turn == 5:
                assert {event["type"] for event in response.json()["events"]} >= {"tutorial.goblin", "combat.started"}
                assert client.get(
                    f"/api/v1/saves/{created['save_id']}/combat", headers=headers
                ).json()["status"] == "active"

        resolve_combat(client, headers, created["save_id"])
        response = client.post(
            url,
            headers=headers,
            json={
                "action_id": "m3-route-6",
                "action": "travel.advance",
                "expected_state_version": version,
                "payload": {},
            },
        )
        assert response.status_code == 200
        version = response.json()["state_version"]
        assert "old_timberwood" in response.json()["state"]["discovered_locations"]

        gathered = client.post(
            url,
            headers=headers,
            json={
                "action_id": "m3-gather-1",
                "action": "gather.wood",
                "expected_state_version": version,
                "payload": {"location_id": "old_timberwood"},
            },
        )
        assert gathered.status_code == 200
        assert gathered.json()["state"]["resources"] == {"wood": 3}
        assert gathered.json()["state"]["mastery"] == {"logging": 3}
        assert {event["type"] for event in gathered.json()["events"]} == {
            "gathering.completed", "mastery.gained"
        }


def test_m4_briarbrook_conversation_reveals_father_lead_and_completes_quest() -> None:
    with TestClient(app) as client:
        headers = {"X-Dev-User-ID": "m4-user"}
        created = client.post("/api/v1/saves", headers=headers, json={}).json()
        version = start_adventure(client, headers, created["save_id"])
        url = f"/api/v1/saves/{created['save_id']}/actions"

        for turn in range(1, 21):
            response = client.post(
                url,
                headers=headers,
                json={
                    "action_id": f"m4-route-{turn}",
                    "action": "travel.advance",
                    "expected_state_version": version,
                    "payload": {},
                },
            )
            assert response.status_code == 200
            version = response.json()["state_version"]
            if turn == 5:
                resolve_combat(client, headers, created["save_id"])

        assert response.json()["state"]["route_offset"] == 20
        assert "briarbrook" in response.json()["state"]["discovered_locations"]

        talk = client.post(
            url,
            headers=headers,
            json={
                "action_id": "m4-garrick-talk",
                "action": "npc.garrick.talk",
                "expected_state_version": version,
                "payload": {},
            },
        )
        assert talk.status_code == 200
        assert talk.json()["state"]["prologue"] == {
            "stranger_met": True,
            "quest_status": "completed",
            "adventure_started": True,
            "briarbrook_contacted": True,
            "father_lead_revealed": True,
        }
        assert [event["type"] for event in talk.json()["events"]] == [
            "npc.dialogue",
            "story.revelation",
            "quest.completed",
        ]
        assert "unrelated to the war" in talk.json()["events"][1]["text"]

        replay = client.post(
            url,
            headers=headers,
            json={
                "action_id": "m4-garrick-talk",
                "action": "npc.garrick.talk",
                "expected_state_version": version,
                "payload": {},
            },
        )
        assert replay.status_code == 200
        assert replay.json()["replayed"] is True

        duplicate = client.post(
            url,
            headers=headers,
            json={
                "action_id": "m4-garrick-talk-again",
                "action": "npc.garrick.talk",
                "expected_state_version": talk.json()["state_version"],
                "payload": {},
            },
        )
        assert duplicate.status_code == 422


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
        start_adventure(client, headers, created["save_id"])

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
                "expected_state_version": turn + 3,
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
            if turn == 5:
                resolve_combat(client, headers, created["save_id"])

        discovered = client.get(f"/api/v1/saves/{created['save_id']}/map", headers=headers).json()
        assert discovered["waypoints"][0] == {
            "offset": 6,
            "location_id": "old_timberwood",
            "label": "Old Timberwood",
            "known": True,
        }


def test_gathering_requires_discovery_and_is_idempotent() -> None:
    with TestClient(app) as client:
        headers = {"X-Dev-User-ID": "gather-user"}
        created = client.post("/api/v1/saves", headers=headers, json={}).json()
        start_adventure(client, headers, created["save_id"])
        url = f"/api/v1/saves/{created['save_id']}/actions"

        blocked = client.post(
            url,
            headers=headers,
            json={
                "action_id": "gather-before-discovery",
                "action": "gather.wood",
                "expected_state_version": 4,
                "payload": {"location_id": "old_timberwood"},
            },
        )
        assert blocked.status_code == 422

        current = created
        for turn in range(1, 7):
            current = client.post(
                url,
                headers=headers,
                json={
                    "action_id": f"gather-travel-{turn}",
                    "action": "travel.advance",
                    "expected_state_version": turn + 3,
                    "payload": {},
                },
            ).json()["state"]
            if turn == 5:
                resolve_combat(client, headers, created["save_id"])

        command = {
            "action_id": "gather-wood-1",
            "action": "gather.wood",
            "expected_state_version": current["state_version"],
            "payload": {"location_id": "old_timberwood"},
        }
        first = client.post(url, headers=headers, json=command)
        assert first.status_code == 200
        assert first.json()["state"]["resources"] == {"wood": 3}

        replay = client.post(url, headers=headers, json=command)
        assert replay.status_code == 200
        assert replay.json()["replayed"] is True
        assert replay.json()["state"]["resources"] == {"wood": 3}


def test_stale_loaded_session_cannot_overwrite_a_newer_action() -> None:
    first_session = SessionLocal()
    second_session = SessionLocal()
    try:
        created = create_save(first_session, "concurrency-user", "blacksmith")
        get_save(second_session, "concurrency-user", created.save_id)
        for index, action in enumerate(("homestead.explore", "quest.accept", "adventure.start"), 1):
            perform_action(
                first_session,
                "concurrency-user",
                created.save_id,
                ActionRequest(
                    action_id=f"concurrency-setup-{index}",
                    action=action,
                    expected_state_version=index,
                ),
            )
        get_save(second_session, "concurrency-user", created.save_id)
        request = ActionRequest(
            action_id="concurrent-travel",
            action="travel.advance",
            expected_state_version=4,
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
        assert current.state_version == 5
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

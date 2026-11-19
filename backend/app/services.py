import hashlib
import json
import secrets
from dataclasses import asdict

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.content import load_npc_record, load_route, load_route_record
from app.domain.combat import (
    CombatError,
    CombatState,
    resolve_enemy_turn,
    resolve_player_action,
    start_encounter,
)
from app.domain.gathering import gather_wood
from app.domain.travel import TravelState, advance
from app.models import ActionReceipt, CombatEncounter, Save
from app.schemas import (
    ActionResponse,
    CombatActionResponse,
    CombatStateResponse,
    RouteMapResponse,
    RouteWaypointView,
    SaveState,
)
from app.world import load_world_map


class SaveNotFound(LookupError):
    pass


class StateConflict(ValueError):
    pass


class CombatNotFound(LookupError):
    pass


def roll_expedited_ambush(
    root_seed: str, source: str, destination: str, state_version: int
) -> float:
    material = f"{root_seed}:expedited:{source}:{destination}:{state_version}".encode()
    digest = hashlib.sha256(material).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def western_road_connection():
    world_map = load_world_map("western_region")
    connection = next((item for item in world_map.connections if item.id == "western_road"), None)
    if connection is None:
        raise ValueError("Western Road connection is unavailable")
    return connection


def serialize_state(save: Save) -> SaveState:
    return SaveState(
        save_id=save.id,
        background_id=save.background_id,
        character_name=save.character_name,
        archetype_id=save.archetype_id,
        attributes=json.loads(save.attributes),
        equipment=json.loads(save.equipment),
        homestead=json.loads(save.homestead),
        prologue=json.loads(save.prologue_state),
        state_version=save.state_version,
        content_version=save.content_version,
        route_id=save.route_id,
        route_offset=save.route_offset,
        discovered_locations=json.loads(save.discovered_locations),
        resources=json.loads(save.resources),
        mastery=json.loads(save.mastery),
    )


def create_save(
    db: Session,
    owner_id: str,
    background_id: str,
    character_name: str | None = None,
    archetype_id: str = "son_of_blacksmith",
) -> SaveState:
    if archetype_id != "son_of_blacksmith":
        raise ValueError("only Son of a Blacksmith is playable in MVP 1.0")
    save = Save(
        owner_id=owner_id,
        background_id=background_id,
        character_name=character_name or "Blacksmith",
        archetype_id=archetype_id,
        root_seed=secrets.token_hex(32),
    )
    db.add(save)
    db.commit()
    db.refresh(save)
    return serialize_state(save)


def get_save(db: Session, owner_id: str, save_id: str) -> Save:
    save = db.scalar(select(Save).where(Save.id == save_id, Save.owner_id == owner_id))
    if save is None:
        raise SaveNotFound(save_id)
    return save


def perform_action(db: Session, owner_id: str, save_id: str, request) -> ActionResponse:
    save = get_save(db, owner_id, save_id)
    receipt = db.scalar(
        select(ActionReceipt).where(
            ActionReceipt.save_id == save.id,
            ActionReceipt.action_id == request.action_id,
        )
    )
    if receipt is not None:
        result = json.loads(receipt.result_json)
        result["replayed"] = True
        return ActionResponse(**result)

    if save.state_version != request.expected_state_version:
        raise StateConflict(
            "expected state version "
            f"{request.expected_state_version}, current is {save.state_version}"
        )

    discovered = frozenset(json.loads(save.discovered_locations))
    mastery = json.loads(save.mastery)
    active_encounter = db.scalar(
        select(CombatEncounter).where(
            CombatEncounter.save_id == save.id,
            CombatEncounter.status == "active",
        )
    )
    if active_encounter is not None and request.action in {
        "travel.advance",
        "travel.expedited",
        "gather.wood",
    }:
        raise ValueError("resolve the active encounter before continuing")
    prologue = json.loads(save.prologue_state)
    if request.action == "homestead.explore":
        if prologue["stranger_met"]:
            raise ValueError("the grounds have already been explored")
        prologue.update(stranger_met=True, quest_status="offered")
        result_events = [
            {"type": "stranger.appears"},
            {"type": "quest.offered", "quest_id": "a_fathers_shadow"},
        ]
        next_offset = save.route_offset
        next_discovered = save.discovered_locations
        next_resources = save.resources
    elif request.action == "quest.accept":
        if not prologue["stranger_met"] or prologue["quest_status"] != "offered":
            raise ValueError("the stranger has no quest to offer")
        prologue["quest_status"] = "active"
        result_events = [{"type": "quest.accepted", "quest_id": "a_fathers_shadow"}]
        next_offset = save.route_offset
        next_discovered = save.discovered_locations
        next_resources = save.resources
    elif request.action == "adventure.start":
        if prologue["quest_status"] != "active":
            raise ValueError("accept A Father's Shadow before starting the adventure")
        if prologue["adventure_started"]:
            raise ValueError("the Western Road adventure is already underway")
        prologue["adventure_started"] = True
        result_events = [{"type": "adventure.started", "route_id": save.route_id}]
        next_offset = save.route_offset
        next_discovered = save.discovered_locations
        next_resources = save.resources
    elif request.action == "npc.garrick.talk":
        route = load_route(save.route_id)
        if save.route_offset < route.length:
            raise ValueError("reach Briarbrook before speaking with Master Garrick Cobb")
        if prologue["quest_status"] != "active":
            raise ValueError("there is no active father's-shadow investigation")
        if prologue.get("briarbrook_contacted", False):
            raise ValueError("Master Garrick has already shared his lead")
        npc = load_npc_record("master_garrick_cobb")
        prologue["briarbrook_contacted"] = True
        prologue["father_lead_revealed"] = True
        prologue["quest_status"] = "completed"
        result_events = [
            {
                "type": "npc.dialogue",
                "speaker": npc["display_name"],
                "text": npc["dialogue"]["introduction"],
            },
            {"type": "story.revelation", "text": npc["dialogue"]["father_lead"]},
            {"type": "quest.completed", "quest_id": "a_fathers_shadow"},
        ]
        next_offset = save.route_offset
        next_discovered = save.discovered_locations
        next_resources = save.resources
    elif request.action == "travel.expedited":
        connection = western_road_connection()
        if not prologue.get("expedited_unlocked", False) and "briarbrook" in discovered:
            prologue["expedited_unlocked"] = True
        if (
            not prologue.get("expedited_unlocked", False)
            or not connection.expedited_travel.eligible
        ):
            raise ValueError("expedited travel is not unlocked")
        journey = prologue.get("expedited_journey")
        if journey and journey.get("status") == "ambush":
            raise ValueError("resolve the interrupted expedited journey first")
        if save.route_offset == 0:
            source, destination = "homestead", "briarbrook"
        elif save.route_offset >= connection.travel_turns:
            source, destination = "briarbrook", "homestead"
        else:
            raise ValueError("expedited travel is only available from a key location")
        ambush_roll = roll_expedited_ambush(save.root_seed, source, destination, save.state_version)
        ambush = ambush_roll < connection.expedited_travel.ambush_chance
        waypoint_offset = max(1, connection.travel_turns // 2)
        journey = {
            "status": "ambush" if ambush else "completed",
            "source": source,
            "destination": destination,
            "ambush_roll": ambush_roll,
            "ambush_chance": connection.expedited_travel.ambush_chance,
            "waypoint_offset": waypoint_offset if ambush else connection.travel_turns,
        }
        prologue["expedited_journey"] = journey
        next_offset = (
            waypoint_offset
            if ambush
            else (connection.travel_turns if destination == "briarbrook" else 0)
        )
        next_discovered = save.discovered_locations
        next_resources = save.resources
        result_events = [
            {
                "type": "travel.expedited",
                "source": source,
                "destination": destination,
                "ambush": ambush,
            }
        ]
        if ambush:
            result_events.append({"type": "travel.ambush", "waypoint_offset": waypoint_offset})
            encounter_state = start_encounter(f"{save.root_seed}:expedited:{source}:{destination}")
            if encounter_state.turn == "enemy":
                encounter_state = resolve_enemy_turn(encounter_state).state
            existing_encounter = db.scalar(
                select(CombatEncounter).where(CombatEncounter.save_id == save.id)
            )
            if existing_encounter is None:
                db.add(
                    CombatEncounter(
                        save_id=save.id,
                        enemy_id="goblin",
                        status=encounter_state.status,
                        state_json=json.dumps(asdict(encounter_state)),
                    )
                )
            else:
                existing_encounter.enemy_id = "goblin"
                existing_encounter.status = encounter_state.status
                existing_encounter.state_json = json.dumps(asdict(encounter_state))
            result_events.append({"type": "combat.started", "enemy_id": "goblin"})
    elif request.action == "gather.wood":
        location_id = request.payload.get("location_id")
        result = gather_wood(discovered, json.loads(save.resources), location_id)
        next_offset = save.route_offset
        next_discovered = save.discovered_locations
        next_resources = json.dumps(result.resources, sort_keys=True)
        mastery["logging"] = mastery.get("logging", 0) + 3
        result_events = list(result.events)
        result_events.append({"type": "mastery.gained", "skill": "logging", "amount": 3})
    else:
        if not prologue["adventure_started"]:
            raise ValueError("begin A Father's Shadow before traveling")
        current = TravelState(save.route_id, save.route_offset, discovered)
        travel_result = advance(load_route(save.route_id), current)
        result = travel_result
        next_offset = result.state.offset
        next_discovered = json.dumps(sorted(result.state.discovered))
        next_resources = save.resources
        result_events = list(result.events)
        tutorial_events = {
            event["offset"]: event["type"]
            for event in load_route_record(save.route_id).get("tutorial_events", [])
        }
        tutorial_type = tutorial_events.get(result.state.offset)
        if tutorial_type == "unusual_tracks":
            result_events.append({"type": "tutorial.tracks"})
        if tutorial_type == "goblin_highwayman":
            result_events.append({"type": "tutorial.goblin"})
            existing_encounter = db.scalar(
                select(CombatEncounter).where(CombatEncounter.save_id == save.id)
            )
            if existing_encounter is None:
                encounter_state = start_encounter(f"{save.root_seed}:goblin:{save.state_version}")
                if encounter_state.turn == "enemy":
                    encounter_state = resolve_enemy_turn(encounter_state).state
                db.add(
                    CombatEncounter(
                        save_id=save.id,
                        enemy_id="goblin",
                        status=encounter_state.status,
                        state_json=json.dumps(asdict(encounter_state)),
                    )
                )
                result_events.append({"type": "combat.started", "enemy_id": "goblin"})
        if tutorial_type == "weathered_landmark":
            result_events.append({"type": "tutorial.landmark"})
        if tutorial_type == "traveling_merchant":
            result_events.append({"type": "tutorial.merchant"})
        if tutorial_type == "briarbrook_arrival":
            prologue["expedited_unlocked"] = True
            result_events.append({"type": "route.arrived", "location_id": "briarbrook"})

    next_version = save.state_version + 1
    updated = db.execute(
        update(Save)
        .where(
            Save.id == save.id,
            Save.owner_id == owner_id,
            Save.state_version == request.expected_state_version,
        )
        .values(
            route_offset=next_offset,
            discovered_locations=next_discovered,
            resources=next_resources,
            mastery=json.dumps(mastery, sort_keys=True),
            prologue_state=json.dumps(prologue, sort_keys=True),
            state_version=next_version,
        )
    )
    if updated.rowcount != 1:
        db.rollback()
        replay = db.scalar(
            select(ActionReceipt).where(
                ActionReceipt.save_id == save_id,
                ActionReceipt.action_id == request.action_id,
            )
        )
        if replay is not None:
            replayed_result = json.loads(replay.result_json)
            replayed_result["replayed"] = True
            return ActionResponse(**replayed_result)
        current_save = get_save(db, owner_id, save_id)
        raise StateConflict(
            "expected state version "
            f"{request.expected_state_version}, current is {current_save.state_version}"
        )

    save.route_offset = next_offset
    save.discovered_locations = next_discovered
    save.resources = next_resources
    save.mastery = json.dumps(mastery, sort_keys=True)
    save.prologue_state = json.dumps(prologue, sort_keys=True)
    save.state_version = next_version
    response = ActionResponse(
        action_id=request.action_id,
        state_version=save.state_version,
        events=result_events,
        state=serialize_state(save),
    )
    db.add(
        ActionReceipt(
            save_id=save.id,
            action_id=request.action_id,
            action_type=request.action,
            state_version=save.state_version,
            result_json=response.model_dump_json(),
        )
    )
    db.commit()
    return response


def route_map(db: Session, owner_id: str, save_id: str) -> RouteMapResponse:
    save = get_save(db, owner_id, save_id)
    record = load_route_record(save.route_id)
    discovered = set(json.loads(save.discovered_locations))
    waypoints = [
        RouteWaypointView(
            offset=waypoint["offset"],
            location_id=waypoint["location_id"] if waypoint["location_id"] in discovered else None,
            label=(
                waypoint["display_name"]
                if waypoint["location_id"] in discovered
                else "Unexplored waypoint"
            ),
            known=waypoint["location_id"] in discovered,
        )
        for waypoint in record["waypoints"]
    ]
    return RouteMapResponse(
        route_id=save.route_id,
        display_name=record["display_name"],
        length=record["length"],
        current_offset=save.route_offset,
        waypoints=waypoints,
    )


def _combat_response(encounter: CombatEncounter, state: CombatState) -> CombatStateResponse:
    return CombatStateResponse(
        encounter_id=encounter.id,
        enemy_id=state.enemy_id,
        turn=state.turn,
        status=state.status,
        round=state.round,
        action_index=state.action_index,
        player_hp=state.player_hp,
        player_max_hp=state.player_max_hp,
        enemy_hp=state.enemy_hp,
        enemy_max_hp=state.enemy_max_hp,
    )


def _combat_state(encounter: CombatEncounter) -> CombatState:
    return CombatState(**json.loads(encounter.state_json))


def start_combat(db: Session, owner_id: str, save_id: str, enemy_id: str) -> CombatStateResponse:
    save = get_save(db, owner_id, save_id)
    existing = db.scalar(select(CombatEncounter).where(CombatEncounter.save_id == save.id))
    if existing is not None:
        return _combat_response(existing, _combat_state(existing))
    if enemy_id != "goblin":
        raise CombatError(f"unsupported enemy: {enemy_id}")

    state = start_encounter(f"{save.root_seed}:goblin:{save.state_version}")
    if state.turn == "enemy":
        state = resolve_enemy_turn(state).state
    encounter = CombatEncounter(
        save_id=save.id,
        enemy_id=enemy_id,
        status=state.status,
        state_json=json.dumps(asdict(state)),
    )
    db.add(encounter)
    db.commit()
    db.refresh(encounter)
    return _combat_response(encounter, state)


def get_combat(db: Session, owner_id: str, save_id: str) -> CombatStateResponse:
    save = get_save(db, owner_id, save_id)
    encounter = db.scalar(select(CombatEncounter).where(CombatEncounter.save_id == save.id))
    if encounter is None:
        raise CombatNotFound(save_id)
    return _combat_response(encounter, _combat_state(encounter))


def combat_action(db: Session, owner_id: str, save_id: str, request) -> CombatActionResponse:
    save = get_save(db, owner_id, save_id)
    encounter = db.scalar(select(CombatEncounter).where(CombatEncounter.save_id == save.id))
    if encounter is None:
        raise CombatNotFound(save_id)
    receipt = db.scalar(
        select(ActionReceipt).where(
            ActionReceipt.save_id == save.id,
            ActionReceipt.action_id == request.action_id,
        )
    )
    if receipt is not None:
        result = json.loads(receipt.result_json)
        result["replayed"] = True
        return CombatActionResponse(**result)

    state = _combat_state(encounter)
    if state.action_index != request.expected_action_index:
        raise StateConflict(
            "expected combat action index "
            f"{request.expected_action_index}, current is {state.action_index}"
        )
    result = resolve_player_action(state, request.action)
    encounter.status = result.state.status
    encounter.state_json = json.dumps(asdict(result.state))
    save_state = None
    combat_events = list(result.events)
    prologue = json.loads(save.prologue_state)
    journey = prologue.get("expedited_journey")
    if (
        journey
        and journey.get("status") == "ambush"
        and result.state.status in {"victory", "defeat"}
    ):
        if result.state.status == "victory":
            save.route_offset = (
                load_route(save.route_id).length if journey["destination"] == "briarbrook" else 0
            )
            journey["status"] = "completed"
            combat_events.append(
                {"type": "travel.expedited.resumed", "destination": journey["destination"]}
            )
        else:
            save.route_offset = 0
            journey["status"] = "defeated"
            combat_events.append(
                {"type": "travel.expedited.defeated", "destination": journey["destination"]}
            )
        prologue["expedited_journey"] = journey
        save.prologue_state = json.dumps(prologue, sort_keys=True)
        save.state_version += 1
        save_state = serialize_state(save)
    response = CombatActionResponse(
        action_id=request.action_id,
        events=combat_events,
        state=_combat_response(encounter, result.state),
        save_state=save_state,
    )
    db.add(
        ActionReceipt(
            save_id=save.id,
            action_id=request.action_id,
            action_type=f"combat.{request.action}",
            state_version=save.state_version,
            result_json=response.model_dump_json(),
        )
    )
    db.commit()
    return response

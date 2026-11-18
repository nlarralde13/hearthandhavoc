import json
import secrets
from dataclasses import asdict

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.content import load_route, load_route_record
from app.domain.combat import (
    CombatError,
    CombatState,
    resolve_enemy_turn,
    resolve_player_action,
    start_encounter,
)
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


class SaveNotFound(LookupError):
    pass


class StateConflict(ValueError):
    pass


class CombatNotFound(LookupError):
    pass


def serialize_state(save: Save) -> SaveState:
    return SaveState(
        save_id=save.id,
        background_id=save.background_id,
        state_version=save.state_version,
        content_version=save.content_version,
        route_id=save.route_id,
        route_offset=save.route_offset,
        discovered_locations=json.loads(save.discovered_locations),
    )


def create_save(db: Session, owner_id: str, background_id: str) -> SaveState:
    save = Save(owner_id=owner_id, background_id=background_id, root_seed=secrets.token_hex(32))
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

    current = TravelState(
        save.route_id, save.route_offset, frozenset(json.loads(save.discovered_locations))
    )
    result = advance(load_route(save.route_id), current)

    next_discovered = json.dumps(sorted(result.state.discovered))
    next_version = save.state_version + 1
    updated = db.execute(
        update(Save)
        .where(
            Save.id == save.id,
            Save.owner_id == owner_id,
            Save.state_version == request.expected_state_version,
        )
        .values(
            route_offset=result.state.offset,
            discovered_locations=next_discovered,
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

    save.route_offset = result.state.offset
    save.discovered_locations = next_discovered
    save.state_version = next_version
    response = ActionResponse(
        action_id=request.action_id,
        state_version=save.state_version,
        events=list(result.events),
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
    response = CombatActionResponse(
        action_id=request.action_id,
        events=list(result.events),
        state=_combat_response(encounter, result.state),
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

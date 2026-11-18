import json
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.travel import WESTERN_ROAD, TravelState, advance
from app.models import ActionReceipt, Save
from app.schemas import ActionResponse, SaveState


class SaveNotFound(LookupError):
    pass


class StateConflict(ValueError):
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
    result = advance(WESTERN_ROAD, current)
    save.route_offset = result.state.offset
    save.discovered_locations = json.dumps(sorted(result.state.discovered))
    save.state_version += 1
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

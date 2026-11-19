from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.auth import actor_id
from app.content import validate_all_content
from app.db import get_db
from app.domain.combat import CombatError
from app.schemas import (
    ActionRequest,
    ActionResponse,
    CombatActionRequest,
    CombatActionResponse,
    CombatStateResponse,
    CreateSaveRequest,
    RouteMapResponse,
    SaveState,
    StartCombatRequest,
)
from app.services import (
    CombatNotFound,
    SaveNotFound,
    StateConflict,
    combat_action,
    create_save,
    get_combat,
    get_save,
    perform_action,
    route_map,
    serialize_state,
    start_combat,
)
from app.settings import get_settings
from app.world import WorldMap, WorldValidation, list_world_maps, load_world_map, save_world_map


@asynccontextmanager
async def lifespan(_app: FastAPI):
    validate_all_content()
    yield


app = FastAPI(title="Hearth & Havoc API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "X-Dev-User-ID"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "api"}


def require_development_editor() -> None:
    if get_settings().app_env != "development":
        raise HTTPException(status_code=404, detail="development world editor is unavailable")


@app.get("/api/v1/dev/world/maps", response_model=list[WorldMap])
def dev_world_maps() -> list[WorldMap]:
    require_development_editor()
    try:
        return list_world_maps()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@app.get("/api/v1/dev/world/maps/{map_id}", response_model=WorldMap)
def dev_world_map(map_id: str) -> WorldMap:
    require_development_editor()
    try:
        return load_world_map(map_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None


@app.put("/api/v1/dev/world/maps/{map_id}", response_model=WorldValidation)
def put_dev_world_map(map_id: str, world_map: WorldMap) -> WorldValidation:
    require_development_editor()
    if world_map.id != map_id:
        raise HTTPException(status_code=422, detail="map ID does not match URL")
    try:
        return save_world_map(world_map)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@app.post("/api/v1/saves", response_model=SaveState, status_code=status.HTTP_201_CREATED)
def post_save(
    request: CreateSaveRequest, db: Session = Depends(get_db), owner_id: str = Depends(actor_id)
) -> SaveState:
    try:
        return create_save(
            db,
            owner_id,
            request.background_id,
            request.character_name,
            request.archetype_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@app.get("/api/v1/saves/{save_id}/state", response_model=SaveState)
def save_state(
    save_id: str, db: Session = Depends(get_db), owner_id: str = Depends(actor_id)
) -> SaveState:
    try:
        return serialize_state(get_save(db, owner_id, save_id))
    except SaveNotFound:
        raise HTTPException(status_code=404, detail="save not found") from None


@app.get("/api/v1/saves/{save_id}/map", response_model=RouteMapResponse)
def save_map(
    save_id: str, db: Session = Depends(get_db), owner_id: str = Depends(actor_id)
) -> RouteMapResponse:
    try:
        return route_map(db, owner_id, save_id)
    except SaveNotFound:
        raise HTTPException(status_code=404, detail="save not found") from None


@app.post("/api/v1/saves/{save_id}/combat", response_model=CombatStateResponse)
def begin_combat(
    save_id: str,
    request: StartCombatRequest,
    db: Session = Depends(get_db),
    owner_id: str = Depends(actor_id),
) -> CombatStateResponse:
    try:
        return start_combat(db, owner_id, save_id, request.enemy_id)
    except SaveNotFound:
        raise HTTPException(status_code=404, detail="save not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@app.get("/api/v1/saves/{save_id}/combat", response_model=CombatStateResponse)
def current_combat(
    save_id: str,
    db: Session = Depends(get_db),
    owner_id: str = Depends(actor_id),
) -> CombatStateResponse:
    try:
        return get_combat(db, owner_id, save_id)
    except SaveNotFound:
        raise HTTPException(status_code=404, detail="save not found") from None
    except CombatNotFound:
        raise HTTPException(status_code=404, detail="combat encounter not found") from None


@app.post("/api/v1/saves/{save_id}/combat/actions", response_model=CombatActionResponse)
def do_combat_action(
    save_id: str,
    request: CombatActionRequest,
    db: Session = Depends(get_db),
    owner_id: str = Depends(actor_id),
) -> CombatActionResponse:
    try:
        return combat_action(db, owner_id, save_id, request)
    except SaveNotFound:
        raise HTTPException(status_code=404, detail="save not found") from None
    except CombatNotFound:
        raise HTTPException(status_code=404, detail="combat encounter not found") from None
    except StateConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except (CombatError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@app.post("/api/v1/saves/{save_id}/actions", response_model=ActionResponse)
def save_action(
    save_id: str,
    request: ActionRequest,
    db: Session = Depends(get_db),
    owner_id: str = Depends(actor_id),
) -> ActionResponse:
    try:
        return perform_action(db, owner_id, save_id, request)
    except SaveNotFound:
        raise HTTPException(status_code=404, detail="save not found") from None
    except StateConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

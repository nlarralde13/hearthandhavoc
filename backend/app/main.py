from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.auth import actor_id
from app.db import get_db
from app.schemas import (
    ActionRequest,
    ActionResponse,
    CreateSaveRequest,
    RouteMapResponse,
    SaveState,
)
from app.services import (
    SaveNotFound,
    StateConflict,
    create_save,
    get_save,
    perform_action,
    route_map,
    serialize_state,
)

app = FastAPI(title="Hearth & Havoc API", version="0.1.0")
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


@app.post("/api/v1/saves", response_model=SaveState, status_code=status.HTTP_201_CREATED)
def post_save(
    request: CreateSaveRequest, db: Session = Depends(get_db), owner_id: str = Depends(actor_id)
) -> SaveState:
    return create_save(db, owner_id, request.background_id)


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

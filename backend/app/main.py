from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.db import create_schema, get_db
from app.schemas import ActionRequest, ActionResponse, CreateSaveRequest, SaveState
from app.services import (
    SaveNotFound,
    StateConflict,
    create_save,
    get_save,
    perform_action,
    serialize_state,
)
from app.settings import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_schema()
    yield


app = FastAPI(title="Hearth & Havoc API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Dev-User-ID"],
)


def actor_id(x_dev_user_id: str | None = Header(default=None)) -> str:
    if settings.app_env != "development":
        raise HTTPException(status_code=501, detail="OIDC authentication is not configured yet")
    if not x_dev_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="X-Dev-User-ID is required locally"
        )
    return x_dev_user_id


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

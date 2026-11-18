from app.main import app
from app.settings import get_settings
from fastapi.testclient import TestClient


def test_non_development_requires_bearer_authentication() -> None:
    settings = get_settings()
    previous_environment = settings.app_env
    settings.app_env = "staging"
    try:
        with TestClient(app) as client:
            response = client.post("/api/v1/saves", json={})
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
    finally:
        settings.app_env = previous_environment

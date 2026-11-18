from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from jwt.exceptions import PyJWKClientError

from app.settings import get_settings

bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="valid authentication is required",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _oidc_actor(token: str) -> str:
    settings = get_settings()
    if not all((settings.oidc_issuer_url, settings.oidc_audience, settings.oidc_jwks_url)):
        raise HTTPException(status_code=503, detail="OIDC authentication is not configured")
    try:
        jwks_client = jwt.PyJWKClient(settings.oidc_jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.oidc_audience,
            issuer=settings.oidc_issuer_url,
            options={"require": ["sub", "iss", "aud", "exp"]},
        )
    except (InvalidTokenError, OSError, PyJWKClientError, ValueError):
        raise _unauthorized() from None

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise _unauthorized()
    return subject


def actor_id(
    x_dev_user_id: Annotated[str | None, Header()] = None,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
) -> str:
    settings = get_settings()
    if settings.app_env == "development":
        if not x_dev_user_id:
            raise _unauthorized()
        return x_dev_user_id
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized()
    return _oidc_actor(credentials.credentials)

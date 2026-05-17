import os
import time
from typing import Any

from jose import jwt, JWTError

_ALGORITHM = "HS256"


def _require_secret(env_var: str) -> str:
    secret = os.environ.get(env_var)
    if not secret:
        raise RuntimeError(f"{env_var} environment variable is required")
    return secret


def _encode(payload: dict[str, Any], secret: str) -> str:
    return jwt.encode(payload, secret, algorithm=_ALGORITHM)


def _decode(token: str, secret: str, expected_type: str) -> dict[str, Any]:
    payload = jwt.decode(token, secret, algorithms=[_ALGORITHM])
    if payload.get("type") != expected_type:
        raise JWTError(f"Expected token type {expected_type!r}, got {payload.get('type')!r}")
    return payload


def create_access_token(username: str, ttl_seconds: int) -> str:
    secret = _require_secret("JWT_SECRET")
    now = int(time.time())
    return _encode(
        {"sub": username, "type": "access", "iat": now, "exp": now + ttl_seconds},
        secret,
    )


def decode_access_token(token: str) -> dict[str, Any]:
    secret = _require_secret("JWT_SECRET")
    return _decode(token, secret, expected_type="access")


def create_refresh_token(username: str, ttl_seconds: int) -> str:
    secret = _require_secret("REFRESH_SECRET")
    now = int(time.time())
    return _encode(
        {"sub": username, "type": "refresh", "iat": now, "exp": now + ttl_seconds},
        secret,
    )


def decode_refresh_token(token: str) -> dict[str, Any]:
    secret = _require_secret("REFRESH_SECRET")
    return _decode(token, secret, expected_type="refresh")


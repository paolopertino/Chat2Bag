from fastapi import APIRouter, Cookie, HTTPException, Response, status
from jose import JWTError
from pydantic import BaseModel

from src.auth.db import get_user_by_username, get_user_with_password
from src.auth.hashing import verify_password
from src.auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_ACCESS_TTL_SECONDS = 30 * 60           # 30 minutes
_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60  # 30 days
_REFRESH_COOKIE_NAME = "refresh_token"


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=_REFRESH_COOKIE_NAME,
        value=token,
        max_age=_REFRESH_TTL_SECONDS,
        httponly=True,
        samesite="strict",
        secure=False,  # set True in production behind HTTPS
        path="/auth",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.set_cookie(
        key=_REFRESH_COOKIE_NAME,
        value="",
        max_age=0,
        httponly=True,
        samesite="strict",
        secure=False,
        path="/auth",
    )


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, response: Response) -> TokenResponse:
    result = await get_user_with_password(req.username)
    if result is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    user, hashed = result
    if not user.is_active or not verify_password(req.password, hashed):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    access = create_access_token(username=user.username, ttl_seconds=_ACCESS_TTL_SECONDS)
    refresh = create_refresh_token(username=user.username, ttl_seconds=_REFRESH_TTL_SECONDS)
    _set_refresh_cookie(response, refresh)
    return TokenResponse(access_token=access, username=user.username)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
) -> TokenResponse:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    try:
        payload = decode_refresh_token(refresh_token)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED) from exc

    username = payload.get("sub")
    if not isinstance(username, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    user = await get_user_by_username(username)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    access = create_access_token(username=user.username, ttl_seconds=_ACCESS_TTL_SECONDS)
    # Rotate refresh token on every refresh to keep TTL sliding.
    new_refresh = create_refresh_token(
        username=user.username, ttl_seconds=_REFRESH_TTL_SECONDS
    )
    _set_refresh_cookie(response, new_refresh)
    return TokenResponse(access_token=access, username=user.username)


@router.post("/logout")
async def logout(response: Response) -> dict[str, str]:
    _clear_refresh_cookie(response)
    return {"status": "logged_out"}

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from chat2bag.auth.db import create_user, ensure_db_initialized, set_user_active
from chat2bag.auth.hashing import hash_password
from chat2bag.auth.router import router as auth_router


@pytest.fixture
async def configured(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "users.db"))
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    await ensure_db_initialized()
    await create_user(username="alice", hashed_password=hash_password("pw"))


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(auth_router)
    return TestClient(app)


async def test_login_success_returns_token_and_sets_cookie(configured, client):
    response = client.post("/auth/login", json={"username": "alice", "password": "pw"})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["username"] == "alice"
    assert isinstance(body["access_token"], str) and body["access_token"]
    assert "refresh_token" in response.cookies


async def test_login_wrong_password_is_401(configured, client):
    response = client.post("/auth/login", json={"username": "alice", "password": "nope"})
    assert response.status_code == 401


async def test_login_unknown_user_is_401(configured, client):
    response = client.post("/auth/login", json={"username": "ghost", "password": "pw"})
    assert response.status_code == 401


async def test_login_inactive_user_is_401(configured, client):
    await set_user_active("alice", active=False)
    response = client.post("/auth/login", json={"username": "alice", "password": "pw"})
    assert response.status_code == 401


async def test_refresh_with_valid_cookie_returns_new_access_token(configured, client):
    login = client.post("/auth/login", json={"username": "alice", "password": "pw"})
    assert login.status_code == 200
    refresh_cookie = login.cookies["refresh_token"]
    response = client.post(
        "/auth/refresh", cookies={"refresh_token": refresh_cookie}
    )
    assert response.status_code == 200
    assert response.json()["username"] == "alice"
    assert response.json()["access_token"]


async def test_refresh_without_cookie_is_401(configured, client):
    response = client.post("/auth/refresh")
    assert response.status_code == 401


async def test_refresh_with_invalid_cookie_is_401(configured, client):
    response = client.post("/auth/refresh", cookies={"refresh_token": "garbage"})
    assert response.status_code == 401


async def test_refresh_with_deactivated_user_is_401(configured, client):
    login = client.post("/auth/login", json={"username": "alice", "password": "pw"})
    refresh_cookie = login.cookies["refresh_token"]
    await set_user_active("alice", active=False)
    response = client.post("/auth/refresh", cookies={"refresh_token": refresh_cookie})
    assert response.status_code == 401


async def test_logout_clears_cookie(configured, client):
    login = client.post("/auth/login", json={"username": "alice", "password": "pw"})
    assert login.cookies.get("refresh_token") is not None
    response = client.post(
        "/auth/logout",
        cookies={"refresh_token": login.cookies["refresh_token"]},
    )
    assert response.status_code == 200
    # max-age=0 causes the cookie to be deleted; httpx reflects that as no cookie
    set_cookie_header = response.headers.get("set-cookie", "")
    assert "refresh_token=" in set_cookie_header
    assert "Max-Age=0" in set_cookie_header or "max-age=0" in set_cookie_header.lower()

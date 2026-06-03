import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from src.auth.dependencies import require_current_user
from src.auth.db import create_user, ensure_db_initialized, set_user_active
from src.auth.hashing import hash_password
from src.auth.tokens import create_access_token


@pytest.fixture
async def configured(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "users.db"))
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    await ensure_db_initialized()
    await create_user(username="alice", hashed_password=hash_password("pw"))


@pytest.fixture
def app():
    app = FastAPI()

    @app.get("/protected")
    async def protected(user=Depends(require_current_user)):
        return {"username": user.username}

    return app


async def test_protected_requires_token(configured, app):
    client = TestClient(app)
    response = client.get("/protected")
    assert response.status_code == 401


async def test_protected_accepts_valid_token(configured, app):
    client = TestClient(app)
    token = create_access_token(username="alice", ttl_seconds=60)
    response = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {"username": "alice"}


async def test_protected_rejects_bad_token(configured, app):
    client = TestClient(app)
    response = client.get(
        "/protected", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert response.status_code == 401


async def test_protected_rejects_inactive_user(configured, app):
    client = TestClient(app)
    token = create_access_token(username="alice", ttl_seconds=60)
    await set_user_active("alice", active=False)
    response = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_protected_rejects_unknown_user(configured, app):
    client = TestClient(app)
    token = create_access_token(username="ghost", ttl_seconds=60)
    response = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


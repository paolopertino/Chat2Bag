# Phase 1: Auth + Routing Scaffold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship JWT-based authentication and a React Router scaffold so the existing bag-exploration UI lives inside a routed, multi-page app shell that future phases can extend.

**Architecture:** New `src/auth/` Python module for hashing, JWT, SQLite user storage, and a FastAPI router. Existing routers are protected via a router-level `Depends(require_current_user)`. Frontend gains React Router v6 with `AuthContext` (access token in memory), a silent-refresh flow, a login page, and a `MainLayout` layout route. The current `App.tsx` content is relocated verbatim into a temporary `WorkspacePage` that later phases will dismantle.

**Tech Stack:** Python 3.10+, FastAPI, `python-jose[cryptography]`, `passlib[bcrypt]`, `aiosqlite`, pytest + pytest-asyncio + httpx (existing). TypeScript, React 19, Vite 8, `react-router-dom` v6 (new), existing Radix/Tailwind component library.

**Spec reference:** `docs/superpowers/specs/2026-04-23-auth-routing-scaffold-design.md`

---

## File Structure

### Backend (new)
```
src/auth/
  __init__.py          # module exports
  hashing.py           # bcrypt wrappers
  tokens.py            # JWT encode/decode, secret loading
  db.py                # aiosqlite users table, CRUD
  models.py            # User pydantic/dataclass
  dependencies.py      # require_current_user
  router.py            # /auth/login, /auth/refresh, /auth/logout
scripts/
  manage_users.py      # CLI (argparse)
tests/
  conftest.py          # shared pytest fixtures (app + bypass)
  test_auth_hashing.py
  test_auth_tokens.py
  test_auth_db.py
  test_auth_dependencies.py
  test_auth_router.py
  test_manage_users.py
```

### Backend (modified)
```
app.py                          # lifespan: ensure_db_initialized, secret check; mount auth_router
src/api/__init__.py             # export auth_router
src/api/bags.py                 # router-level Depends(require_current_user)
src/api/chat_routes.py          # same
src/api/datasets.py             # same
src/api/image.py                # same
src/api/indexing.py             # same
src/api/search_routes.py        # same
pyproject.toml                  # new deps
tests/test_api_contracts.py     # use dependency_overrides bypass
```

### Frontend (new)
```
frontend/src/
  router.tsx                             # createBrowserRouter config
  context/
    auth-context.tsx                     # AuthContext + AuthProvider
  pages/
    login.tsx
    dashboard.tsx
    workspace.tsx                        # legacy UI holder (Phase 1 only)
  components/layout/
    protected-route.tsx
    top-bar.tsx
    sidebar-slot.tsx                     # context + hook for page-owned sidebar content
```

### Frontend (modified)
```
frontend/package.json                   # + react-router-dom
frontend/vite.config.ts                 # proxy /auth
frontend/src/main.tsx                   # no change (App wraps router)
frontend/src/App.tsx                    # thin shell: AuthProvider + RouterProvider
frontend/src/api/client.ts              # token injection + 401 refresh
frontend/src/components/layout/main-layout.tsx  # becomes layout route; top bar + sidebar slot
```

---

## Part A — Backend

### Task 1: Add Python dependencies

**Files:**
- Modify: `pyproject.toml` (via `uv add`)

- [ ] **Step 1: Install runtime deps via uv**

Run from project root:
```bash
uv add "python-jose[cryptography]>=3.3.0" "passlib[bcrypt]>=1.7.4" "aiosqlite>=0.20.0"
```
Expected: `uv add` prints resolution + writes to `pyproject.toml` and `uv.lock`.

- [ ] **Step 2: Verify imports work**

```bash
uv run python -c "from jose import jwt; from passlib.context import CryptContext; import aiosqlite; print('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "[Backend] add auth dependencies (python-jose, passlib[bcrypt], aiosqlite)"
```

---

### Task 2: `src/auth/hashing.py`

**Files:**
- Create: `src/auth/__init__.py`
- Create: `src/auth/hashing.py`
- Create: `tests/test_auth_hashing.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_auth_hashing.py`:
```python
from src.auth.hashing import hash_password, verify_password


def test_hash_password_returns_non_empty_string():
    hashed = hash_password("correct horse battery staple")
    assert isinstance(hashed, str)
    assert hashed != ""
    assert hashed != "correct horse battery staple"


def test_hash_password_is_salted_each_time():
    a = hash_password("same-password")
    b = hash_password("same-password")
    assert a != b


def test_verify_password_matches_original():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong-password", hashed) is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_auth_hashing.py -v
```
Expected: `ModuleNotFoundError: No module named 'src.auth.hashing'` (or similar import error).

- [ ] **Step 3: Implement**

Create `src/auth/__init__.py`:
```python
```

Create `src/auth/hashing.py`:
```python
from passlib.context import CryptContext

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    return _pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return _pwd_context.verify(plain_password, hashed_password)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/test_auth_hashing.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/__init__.py src/auth/hashing.py tests/test_auth_hashing.py
git commit -m "[Backend] add bcrypt password hashing helpers"
```

---

### Task 3: `src/auth/tokens.py`

**Files:**
- Create: `src/auth/tokens.py`
- Create: `tests/test_auth_tokens.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_auth_tokens.py`:
```python
import time

import pytest
from jose import JWTError

from src.auth.tokens import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
)


def test_access_token_roundtrip(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    token = create_access_token(username="alice", ttl_seconds=60)
    payload = decode_access_token(token)
    assert payload["sub"] == "alice"
    assert payload["type"] == "access"


def test_refresh_token_roundtrip(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    token = create_refresh_token(username="alice", ttl_seconds=60)
    payload = decode_refresh_token(token)
    assert payload["sub"] == "alice"
    assert payload["type"] == "refresh"


def test_access_token_rejects_refresh_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    refresh = create_refresh_token(username="alice", ttl_seconds=60)
    with pytest.raises(JWTError):
        decode_access_token(refresh)


def test_refresh_token_rejects_access_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    access = create_access_token(username="alice", ttl_seconds=60)
    with pytest.raises(JWTError):
        decode_refresh_token(access)


def test_expired_access_token_raises(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-access-secret")
    monkeypatch.setenv("REFRESH_SECRET", "test-refresh-secret")
    token = create_access_token(username="alice", ttl_seconds=1)
    time.sleep(2)
    with pytest.raises(JWTError):
        decode_access_token(token)


def test_missing_secret_raises_on_create(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        create_access_token(username="alice", ttl_seconds=60)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_auth_tokens.py -v
```
Expected: ImportError for `src.auth.tokens`.

- [ ] **Step 3: Implement**

Create `src/auth/tokens.py`:
```python
import os
import time
from typing import Any

from jose import jwt

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
        from jose import JWTError
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/test_auth_tokens.py -v
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/tokens.py tests/test_auth_tokens.py
git commit -m "[Backend] add JWT access/refresh token helpers with type enforcement"
```

---

### Task 4: `src/auth/models.py`

**Files:**
- Create: `src/auth/models.py`

No test file — this is a pure data class consumed by other modules that are themselves tested.

- [ ] **Step 1: Implement**

Create `src/auth/models.py`:
```python
from dataclasses import dataclass


@dataclass(frozen=True)
class User:
    id: int
    username: str
    is_active: bool
```

- [ ] **Step 2: Verify it imports**

```bash
uv run python -c "from src.auth.models import User; print(User(id=1, username='x', is_active=True))"
```
Expected: `User(id=1, username='x', is_active=True)`

- [ ] **Step 3: Commit**

```bash
git add src/auth/models.py
git commit -m "[Backend] add User dataclass"
```

---

### Task 5: `src/auth/db.py`

**Files:**
- Create: `src/auth/db.py`
- Create: `tests/test_auth_db.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_auth_db.py`:
```python
from pathlib import Path

import pytest

from src.auth.db import (
    create_user,
    ensure_db_initialized,
    get_user_by_username,
    list_users,
    set_user_active,
    update_password,
)


@pytest.fixture
async def db_path(tmp_path, monkeypatch) -> Path:
    path = tmp_path / "nested" / "users.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    await ensure_db_initialized()
    return path


async def test_ensure_db_initialized_creates_file_and_parent_dir(db_path):
    assert db_path.exists()
    assert db_path.parent.exists()


async def test_get_user_returns_none_when_missing(db_path):
    user = await get_user_by_username("ghost")
    assert user is None


async def test_create_and_get_user_roundtrip(db_path):
    await create_user(username="alice", hashed_password="hashed-value")
    user = await get_user_by_username("alice")
    assert user is not None
    assert user.username == "alice"
    assert user.is_active is True


async def test_create_duplicate_username_raises(db_path):
    await create_user(username="alice", hashed_password="h1")
    with pytest.raises(ValueError, match="already exists"):
        await create_user(username="alice", hashed_password="h2")


async def test_set_user_active_toggles(db_path):
    await create_user(username="alice", hashed_password="h")
    await set_user_active("alice", active=False)
    user = await get_user_by_username("alice")
    assert user is not None
    assert user.is_active is False


async def test_set_active_nonexistent_raises(db_path):
    with pytest.raises(LookupError):
        await set_user_active("ghost", active=False)


async def test_update_password_changes_hash(db_path):
    await create_user(username="alice", hashed_password="old")
    await update_password("alice", hashed_password="new")
    # Read the raw stored hash via a test helper
    from src.auth.db import _fetch_hashed_password
    assert await _fetch_hashed_password("alice") == "new"


async def test_list_users_returns_all(db_path):
    await create_user(username="alice", hashed_password="h")
    await create_user(username="bob", hashed_password="h")
    await set_user_active("bob", active=False)
    users = await list_users()
    usernames = {u.username: u.is_active for u in users}
    assert usernames == {"alice": True, "bob": False}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_auth_db.py -v
```
Expected: ImportError for `src.auth.db`.

- [ ] **Step 3: Implement**

Create `src/auth/db.py`:
```python
import os
from pathlib import Path

import aiosqlite

from src.auth.models import User

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def _resolve_db_path() -> Path:
    raw = os.environ.get("AUTH_DB_PATH", "data/users.db")
    return Path(raw).expanduser().resolve()


async def ensure_db_initialized() -> None:
    path = _resolve_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(path)) as db:
        await db.executescript(_SCHEMA)
        await db.commit()


async def get_user_by_username(username: str) -> User | None:
    path = _resolve_db_path()
    async with aiosqlite.connect(str(path)) as db:
        cursor = await db.execute(
            "SELECT id, username, is_active FROM users WHERE username = ?",
            (username,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return User(id=row[0], username=row[1], is_active=bool(row[2]))


async def _fetch_hashed_password(username: str) -> str | None:
    path = _resolve_db_path()
    async with aiosqlite.connect(str(path)) as db:
        cursor = await db.execute(
            "SELECT hashed_password FROM users WHERE username = ?",
            (username,),
        )
        row = await cursor.fetchone()
        return row[0] if row else None


async def create_user(username: str, hashed_password: str) -> None:
    path = _resolve_db_path()
    async with aiosqlite.connect(str(path)) as db:
        try:
            await db.execute(
                "INSERT INTO users (username, hashed_password) VALUES (?, ?)",
                (username, hashed_password),
            )
            await db.commit()
        except aiosqlite.IntegrityError as exc:
            raise ValueError(f"User {username!r} already exists") from exc


async def set_user_active(username: str, *, active: bool) -> None:
    path = _resolve_db_path()
    async with aiosqlite.connect(str(path)) as db:
        cursor = await db.execute(
            "UPDATE users SET is_active = ? WHERE username = ?",
            (1 if active else 0, username),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise LookupError(f"User {username!r} not found")


async def update_password(username: str, hashed_password: str) -> None:
    path = _resolve_db_path()
    async with aiosqlite.connect(str(path)) as db:
        cursor = await db.execute(
            "UPDATE users SET hashed_password = ? WHERE username = ?",
            (hashed_password, username),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise LookupError(f"User {username!r} not found")


async def list_users() -> list[User]:
    path = _resolve_db_path()
    async with aiosqlite.connect(str(path)) as db:
        cursor = await db.execute(
            "SELECT id, username, is_active FROM users ORDER BY username"
        )
        rows = await cursor.fetchall()
        return [
            User(id=row[0], username=row[1], is_active=bool(row[2])) for row in rows
        ]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/test_auth_db.py -v
```
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/db.py tests/test_auth_db.py
git commit -m "[Backend] add aiosqlite user storage with CRUD helpers"
```

---

### Task 6: `src/auth/dependencies.py`

**Files:**
- Create: `src/auth/dependencies.py`
- Create: `tests/test_auth_dependencies.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_auth_dependencies.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_auth_dependencies.py -v
```
Expected: ImportError for `src.auth.dependencies`.

- [ ] **Step 3: Implement**

Create `src/auth/dependencies.py`:
```python
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError

from src.auth.db import get_user_by_username
from src.auth.models import User
from src.auth.tokens import decode_access_token

_bearer_scheme = HTTPBearer(auto_error=False)


async def require_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_access_token(credentials.credentials)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    username = payload.get("sub")
    if not isinstance(username, str):
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = await get_user_by_username(username)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/test_auth_dependencies.py -v
```
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/dependencies.py tests/test_auth_dependencies.py
git commit -m "[Backend] add require_current_user FastAPI dependency"
```

---

### Task 7: `src/auth/router.py`

**Files:**
- Create: `src/auth/router.py`
- Create: `tests/test_auth_router.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_auth_router.py`:
```python
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.auth.db import create_user, ensure_db_initialized, set_user_active
from src.auth.hashing import hash_password
from src.auth.router import router as auth_router


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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_auth_router.py -v
```
Expected: ImportError for `src.auth.router`.

- [ ] **Step 3: Implement**

Create `src/auth/router.py`:
```python
from fastapi import APIRouter, Cookie, HTTPException, Response, status
from jose import JWTError
from pydantic import BaseModel

from src.auth.db import get_user_by_username, _fetch_hashed_password
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
    user = await get_user_by_username(req.username)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    hashed = await _fetch_hashed_password(req.username)
    if hashed is None or not verify_password(req.password, hashed):
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
async def logout(response: Response) -> dict:
    _clear_refresh_cookie(response)
    return {"status": "logged_out"}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/test_auth_router.py -v
```
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add src/auth/router.py tests/test_auth_router.py
git commit -m "[Backend] add /auth/login, /auth/refresh, /auth/logout endpoints"
```

---

### Task 8: Wire auth router + DB init into `app.py`

**Files:**
- Modify: `src/api/__init__.py` (export auth_router)
- Modify: `app.py`

- [ ] **Step 1: Export the auth router**

Edit `src/api/__init__.py` — add the import and export:
```python
from src.api.bags import router as bags_router
from src.api.chat_routes import router as chat_router
from src.api.datasets import router as datasets_router
from src.api.indexing import router as indexing_router
from src.api.image import router as image_router
from src.api.search_routes import router as search_router
from src.auth.router import router as auth_router

__all__ = [
    "auth_router",
    "bags_router",
    "chat_router",
    "datasets_router",
    "image_router",
    "indexing_router",
    "search_router",
]
```

- [ ] **Step 2: Add DB init + secret check to lifespan**

Edit `app.py`. In the `lifespan` function, add the following **immediately after `setup_logging(...)`** and **before `config = get_app_config()`**:
```python
    # Fail fast if auth secrets are missing.
    for required_env in ("JWT_SECRET", "REFRESH_SECRET"):
        if not os.environ.get(required_env):
            raise RuntimeError(f"{required_env} environment variable is required")

    # Ensure user DB exists (file + schema).
    from src.auth.db import ensure_db_initialized
    await ensure_db_initialized()
```

- [ ] **Step 3: Mount auth router**

In `app.py`, update the imports block that currently reads:
```python
from src.api import (
    bags_router,
    chat_router,
    datasets_router,
    image_router,
    indexing_router,
    search_router,
)
```
to:
```python
from src.api import (
    auth_router,
    bags_router,
    chat_router,
    datasets_router,
    image_router,
    indexing_router,
    search_router,
)
```

And add after the existing `app.include_router(datasets_router)` line:
```python
app.include_router(auth_router)
```

- [ ] **Step 4: Smoke-test that the app starts with secrets set**

```bash
JWT_SECRET=dev-access REFRESH_SECRET=dev-refresh uv run python -c "from app import app; print(sorted({r.path for r in app.routes}))"
```
Expected output contains `/auth/login`, `/auth/refresh`, `/auth/logout`, plus all existing `/api/*` routes.

- [ ] **Step 5: Smoke-test that missing secrets fail fast**

```bash
uv run python - <<'PY'
import os
os.environ.pop("JWT_SECRET", None)
os.environ.pop("REFRESH_SECRET", None)

from fastapi.testclient import TestClient
from app import app

try:
    with TestClient(app):
        print("UNEXPECTED: lifespan did not raise")
        raise SystemExit(1)
except RuntimeError as exc:
    msg = str(exc)
    if "JWT_SECRET" in msg or "REFRESH_SECRET" in msg:
        print("OK: got expected RuntimeError:", msg)
    else:
        print("UNEXPECTED RuntimeError:", msg)
        raise SystemExit(1)
PY
```
Expected: `OK: got expected RuntimeError: JWT_SECRET environment variable is required`.

- [ ] **Step 6: Commit**

```bash
git add app.py src/api/__init__.py
git commit -m "[Backend] wire auth router and startup DB init into app"
```

---

### Task 9: CLI `scripts/manage_users.py`

**Files:**
- Create: `scripts/manage_users.py`
- Create: `tests/test_manage_users.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_manage_users.py`:
```python
import asyncio
import subprocess
import sys
from pathlib import Path


def _run_cli(args: list[str], env: dict, stdin: str = "") -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "scripts/manage_users.py", *args],
        input=stdin,
        capture_output=True,
        text=True,
        env=env,
    )


def test_add_user_then_list(tmp_path, monkeypatch):
    import os
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db")}

    add = _run_cli(["add-user", "alice"], env=env, stdin="pw\npw\n")
    assert add.returncode == 0, add.stderr

    listed = _run_cli(["list-users"], env=env)
    assert listed.returncode == 0
    assert "alice" in listed.stdout
    assert "active" in listed.stdout.lower()


def test_add_user_duplicate_errors(tmp_path):
    import os
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db")}
    _run_cli(["add-user", "alice"], env=env, stdin="pw\npw\n")
    result = _run_cli(["add-user", "alice"], env=env, stdin="pw\npw\n")
    assert result.returncode != 0
    assert "already exists" in (result.stderr + result.stdout).lower()


def test_password_mismatch_errors(tmp_path):
    import os
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db")}
    result = _run_cli(["add-user", "alice"], env=env, stdin="one\ntwo\n")
    assert result.returncode != 0


def test_delete_user_deactivates(tmp_path):
    import os
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db")}
    _run_cli(["add-user", "alice"], env=env, stdin="pw\npw\n")
    result = _run_cli(["delete-user", "alice"], env=env)
    assert result.returncode == 0
    listed = _run_cli(["list-users"], env=env)
    assert "inactive" in listed.stdout.lower()


def test_reset_password_changes_hash(tmp_path):
    import os
    env = {**os.environ, "AUTH_DB_PATH": str(tmp_path / "users.db")}
    _run_cli(["add-user", "alice"], env=env, stdin="old\nold\n")
    result = _run_cli(["reset-password", "alice"], env=env, stdin="new\nnew\n")
    assert result.returncode == 0, result.stderr
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
uv run pytest tests/test_manage_users.py -v
```
Expected: Non-zero returncode because `scripts/manage_users.py` doesn't exist yet.

- [ ] **Step 3: Implement**

Create `scripts/manage_users.py`:
```python
"""CLI for managing Bag-GPT auth users.

Usage:
    python scripts/manage_users.py add-user <username>
    python scripts/manage_users.py delete-user <username>
    python scripts/manage_users.py list-users
    python scripts/manage_users.py reset-password <username>

Reads AUTH_DB_PATH to locate the SQLite user database (default: data/users.db).
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from pathlib import Path

# Ensure project root is on sys.path when invoked as a script.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from src.auth.db import (
    create_user,
    ensure_db_initialized,
    get_user_by_username,
    list_users,
    set_user_active,
    update_password,
)
from src.auth.hashing import hash_password


def _prompt_password(label: str = "Password") -> str:
    first = getpass.getpass(f"{label}: ")
    second = getpass.getpass(f"{label} (confirm): ")
    if first != second:
        raise SystemExit("error: passwords do not match")
    if not first:
        raise SystemExit("error: password must be non-empty")
    return first


async def cmd_add_user(username: str) -> None:
    await ensure_db_initialized()
    password = _prompt_password()
    try:
        await create_user(username=username, hashed_password=hash_password(password))
    except ValueError as exc:
        raise SystemExit(f"error: {exc}")
    print(f"Created user {username!r}.")


async def cmd_delete_user(username: str) -> None:
    await ensure_db_initialized()
    user = await get_user_by_username(username)
    if user is None:
        raise SystemExit(f"error: user {username!r} not found")
    if not user.is_active:
        raise SystemExit(f"error: user {username!r} is already inactive")
    await set_user_active(username, active=False)
    print(f"Deactivated user {username!r}.")


async def cmd_list_users() -> None:
    await ensure_db_initialized()
    users = await list_users()
    if not users:
        print("(no users)")
        return
    width = max(len(u.username) for u in users)
    for u in users:
        status = "active" if u.is_active else "inactive"
        print(f"{u.username:<{width}}  {status}")


async def cmd_reset_password(username: str) -> None:
    await ensure_db_initialized()
    user = await get_user_by_username(username)
    if user is None or not user.is_active:
        raise SystemExit(f"error: user {username!r} not found or inactive")
    password = _prompt_password("New password")
    await update_password(username, hashed_password=hash_password(password))
    print(f"Password reset for user {username!r}.")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Manage Bag-GPT auth users.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    add = sub.add_parser("add-user")
    add.add_argument("username")

    delete = sub.add_parser("delete-user")
    delete.add_argument("username")

    sub.add_parser("list-users")

    reset = sub.add_parser("reset-password")
    reset.add_argument("username")

    args = parser.parse_args(argv)

    if args.cmd == "add-user":
        asyncio.run(cmd_add_user(args.username))
    elif args.cmd == "delete-user":
        asyncio.run(cmd_delete_user(args.username))
    elif args.cmd == "list-users":
        asyncio.run(cmd_list_users())
    elif args.cmd == "reset-password":
        asyncio.run(cmd_reset_password(args.username))
    else:  # pragma: no cover
        parser.error(f"unknown command {args.cmd}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
uv run pytest tests/test_manage_users.py -v
```
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/manage_users.py tests/test_manage_users.py
git commit -m "[Backend] add manage_users.py CLI for admin user management"
```

---

### Task 10: Add shared pytest `conftest.py` with auth bypass

**Files:**
- Create: `tests/conftest.py`

This must land **before** Task 11 (which protects existing routers) so existing tests keep passing.

- [ ] **Step 1: Write the conftest**

Create `tests/conftest.py`:
```python
"""Shared pytest fixtures.

The `bypass_auth` fixture overrides `require_current_user` to return a fake
active user on any FastAPI app it's applied to. Use it on any test that
constructs a FastAPI() instance and includes the protected routers.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI

from src.auth.dependencies import require_current_user
from src.auth.models import User


_FAKE_USER = User(id=1, username="test-user", is_active=True)


@pytest.fixture
def bypass_auth():
    """Return a callable that installs the auth bypass on a given FastAPI app.

    Usage:
        def test_something(bypass_auth):
            app = FastAPI()
            app.include_router(some_protected_router)
            bypass_auth(app)
            client = TestClient(app)
            ...
    """

    installed: list[FastAPI] = []

    def _install(app: FastAPI) -> FastAPI:
        app.dependency_overrides[require_current_user] = lambda: _FAKE_USER
        installed.append(app)
        return app

    yield _install

    for app in installed:
        app.dependency_overrides.pop(require_current_user, None)
```

- [ ] **Step 2: Verify the fixture imports**

```bash
uv run pytest tests/conftest.py --collect-only
```
Expected: no errors (conftest just loads as a plugin; no tests to collect).

- [ ] **Step 3: Commit**

```bash
git add tests/conftest.py
git commit -m "[Backend] add pytest auth bypass fixture for protected routers"
```

---

### Task 11: Protect existing routers + migrate `test_api_contracts.py`

**Files:**
- Modify: `src/api/bags.py`
- Modify: `src/api/chat_routes.py`
- Modify: `src/api/datasets.py`
- Modify: `src/api/image.py`
- Modify: `src/api/indexing.py`
- Modify: `src/api/search_routes.py`
- Modify: `tests/test_api_contracts.py`

- [ ] **Step 1: Add auth dependency to every existing router**

For each of the six files above, edit the `router = APIRouter(...)` line to include the new dependency.

**In `src/api/bags.py`** (around line 14) — replace:
```python
from fastapi import APIRouter, HTTPException, Query
```
with:
```python
from fastapi import APIRouter, Depends, HTTPException, Query

from src.auth.dependencies import require_current_user
```
and replace:
```python
router = APIRouter(prefix="/api/bags", tags=["bags"])
```
with:
```python
router = APIRouter(
    prefix="/api/bags",
    tags=["bags"],
    dependencies=[Depends(require_current_user)],
)
```

**In `src/api/chat_routes.py`**, **`src/api/datasets.py`**, **`src/api/image.py`**, **`src/api/indexing.py`**, **`src/api/search_routes.py`**:

- If `Depends` is not already imported from `fastapi`, add it.
- Add `from src.auth.dependencies import require_current_user` to the imports.
- Change the `APIRouter(...)` constructor call to include `dependencies=[Depends(require_current_user)]` while preserving its existing `prefix` and `tags`.

Keep all other args (like `prefix`, `tags`) unchanged.

- [ ] **Step 2: Migrate `test_api_contracts.py` to use the bypass**

Edit `tests/test_api_contracts.py`. Change the `create_test_client` function from:
```python
def create_test_client(indexing_service, search_service, chat_service) -> TestClient:
    app = FastAPI()
    app.include_router(indexing_router)
    app.include_router(search_router)
    app.include_router(chat_router)
    app.dependency_overrides[get_indexing_service] = lambda: indexing_service
    app.dependency_overrides[get_search_service] = lambda: search_service
    app.dependency_overrides[get_chat_service] = lambda: chat_service
    return TestClient(app)
```
to:
```python
def create_test_client(indexing_service, search_service, chat_service) -> TestClient:
    from src.auth.dependencies import require_current_user
    from src.auth.models import User

    app = FastAPI()
    app.include_router(indexing_router)
    app.include_router(search_router)
    app.include_router(chat_router)
    app.dependency_overrides[get_indexing_service] = lambda: indexing_service
    app.dependency_overrides[get_search_service] = lambda: search_service
    app.dependency_overrides[get_chat_service] = lambda: chat_service
    app.dependency_overrides[require_current_user] = lambda: User(
        id=1, username="test-user", is_active=True
    )
    return TestClient(app)
```

- [ ] **Step 3: Run the full test suite**

```bash
uv run pytest tests/ -v
```
Expected: all existing and new tests pass. Every `test_api_contracts.py::*` still passes because the bypass is registered. All `tests/test_auth_*.py` and `tests/test_manage_users.py` also pass.

- [ ] **Step 4: Sanity-check a protected route 401s without a token**

```bash
JWT_SECRET=dev-access REFRESH_SECRET=dev-refresh uv run uvicorn app:app --port 18000 &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:18000/api/bags/scan?root_dir=/tmp"
kill %1
wait
```
Expected: `401`.

- [ ] **Step 5: Commit**

```bash
git add src/api/ tests/test_api_contracts.py
git commit -m "[Backend] protect existing routers with require_current_user"
```

---

## Part B — Frontend

### Task 12: Install `react-router-dom` + update Vite proxy

**Files:**
- Modify: `frontend/package.json` (via npm)
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Install**

```bash
cd frontend && npm install react-router-dom
```
Expected: `react-router-dom` added to `dependencies` in `package.json`.

- [ ] **Step 2: Proxy `/auth` in dev server**

Edit `frontend/vite.config.ts`. Change the `server.proxy` block from:
```ts
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
```
to:
```ts
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
    },
  },
```

- [ ] **Step 3: Verify typecheck still passes**

```bash
cd frontend && npm run build
```
Expected: build succeeds. (The build already writes to `../static/`; this also sanity-checks the existing app still compiles.)

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts
git commit -m "[UI] add react-router-dom and proxy /auth during dev"
```

---

### Task 13: Token injection shim in `client.ts`

**Files:**
- Modify: `frontend/src/api/client.ts`

Goal: add `setClientToken`, `setAuthFailureHandler`, `refreshAccessToken`, and update `http()` to (a) attach `Authorization: Bearer <token>` and (b) retry once on 401 using a shared refresh promise.

- [ ] **Step 1: Edit the client**

Replace the contents of `frontend/src/api/client.ts`. Full new file:
```ts
import type {
  ChatResponse,
  BagStatusResponse,
  ExtractionConfigSchema,
  ExtractionJob,
  ExtractionLogsResponse,
  ExtractionSubmitRequest,
  ExtractionSubmitResponse,
  FramesResponse,
  ScanBagsResponse,
  SearchResponse,
} from "./types";

interface SearchRequest {
  query: string;
  bag_paths: string[];
  top_k: number;
}

interface SimilarSearchRequest {
  file_path: string;
  bag_paths: string[];
  top_k: number;
}

interface IndexRequest {
  bag_path: string;
}

interface ChatRequest {
  bag_path: string;
  start_ns: number;
  duration: number;
  query: string;
}

// ---- Auth integration (token injection + 401 refresh) ----

let _accessToken: string | null = null;
let _authFailureHandler: (() => void) | null = null;
let _refreshPromise: Promise<string | null> | null = null;

export function setClientToken(token: string | null): void {
  _accessToken = token;
}

export function setAuthFailureHandler(handler: (() => void) | null): void {
  _authFailureHandler = handler;
}

interface RefreshResponse {
  access_token: string;
  username: string;
  token_type: string;
}

async function doRefresh(): Promise<string | null> {
  const response = await fetch("/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as RefreshResponse;
  _accessToken = body.access_token;
  return body.access_token;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!_refreshPromise) {
    _refreshPromise = doRefresh().finally(() => {
      _refreshPromise = null;
    });
  }
  return _refreshPromise;
}

export { refreshAccessToken };

// ---- http() wrapper ----

async function rawFetch<T>(url: string, init: RequestInit | undefined): Promise<Response> {
  const isFormData = init?.body instanceof FormData;
  const headers: HeadersInit = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(init?.headers ?? {}),
  };
  if (_accessToken) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${_accessToken}`;
  }
  return fetch(url, { ...init, headers, credentials: "include" });
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  let response = await rawFetch<T>(url, init);

  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await rawFetch<T>(url, init);
    }
    if (response.status === 401) {
      if (_authFailureHandler) _authFailureHandler();
      throw new Error("Unauthorized");
    }
  }

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      detail = response.statusText;
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

// ---- Auth endpoints ----

interface LoginResponse {
  access_token: string;
  username: string;
  token_type: string;
}

export async function loginRequest(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const response = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    let detail = "Login failed";
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      detail = response.statusText || "Login failed";
    }
    throw new Error(detail);
  }
  const body = (await response.json()) as LoginResponse;
  _accessToken = body.access_token;
  return body;
}

export async function logoutRequest(): Promise<void> {
  try {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
  } finally {
    _accessToken = null;
  }
}

// ---- Existing API (unchanged signatures) ----

export function getImageUrl(filePath: string): string {
  return `/api/image?path=${encodeURIComponent(filePath)}`;
}

export async function scanBags(rootDir: string): Promise<ScanBagsResponse> {
  return http<ScanBagsResponse>(`/api/bags/scan?root_dir=${encodeURIComponent(rootDir)}`);
}

export async function indexBag(bagPath: string): Promise<void> {
  await http<{ status: string; bag: string }>("/api/index", {
    method: "POST",
    body: JSON.stringify({ bag_path: bagPath } satisfies IndexRequest),
  });
}

export async function getBagStatus(bagPath: string): Promise<BagStatusResponse> {
  return http<BagStatusResponse>(`/api/bags/status?bag_path=${encodeURIComponent(bagPath)}`);
}

export async function getFrames(
  bagPath: string,
  startNs: number,
  durationSec: number,
): Promise<FramesResponse> {
  const params = new URLSearchParams({
    bag_path: bagPath,
    start_ns: String(startNs),
    duration_sec: String(durationSec),
  });
  return http<FramesResponse>(`/api/bags/frames?${params.toString()}`);
}

export async function search(payload: SearchRequest): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function searchByImage(
  file: File,
  bagPaths: string[],
  topK: number,
): Promise<SearchResponse> {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("top_k", String(topK));
  for (const bagPath of bagPaths) formData.append("bag_paths", bagPath);
  return http<SearchResponse>("/api/search/image", {
    method: "POST",
    body: formData,
  });
}

export async function searchSimilar(payload: SimilarSearchRequest): Promise<SearchResponse> {
  return http<SearchResponse>("/api/search/similar", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function chatWithClip(payload: ChatRequest): Promise<ChatResponse> {
  return http<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getExtractionSchema(): Promise<ExtractionConfigSchema> {
  return http<ExtractionConfigSchema>("/api/datasets/config/schema");
}

export async function submitExtraction(
  payload: ExtractionSubmitRequest,
): Promise<ExtractionSubmitResponse> {
  return http<ExtractionSubmitResponse>("/api/datasets/extract", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listExtractionJobs(): Promise<ExtractionJob[]> {
  return http<ExtractionJob[]>("/api/datasets/jobs");
}

export async function getExtractionJob(jobId: string): Promise<ExtractionJob> {
  return http<ExtractionJob>(`/api/datasets/jobs/${encodeURIComponent(jobId)}`);
}

export async function cancelExtractionJob(jobId: string): Promise<ExtractionJob> {
  return http<ExtractionJob>(`/api/datasets/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
}

export async function getExtractionLogs(jobId: string, tail = 500): Promise<string[]> {
  const resp = await http<ExtractionLogsResponse>(
    `/api/datasets/jobs/${encodeURIComponent(jobId)}/logs?tail=${tail}`,
  );
  return resp.lines;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "[UI] add token injection and 401 refresh to API client"
```

---

### Task 14: `AuthContext` + `AuthProvider`

**Files:**
- Create: `frontend/src/context/auth-context.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/context/auth-context.tsx`:
```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  loginRequest,
  logoutRequest,
  setAuthFailureHandler,
  setClientToken,
} from "../api/client";

interface AuthState {
  accessToken: string | null;
  username: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Keep the API client's module-level token in sync with React state.
  useEffect(() => {
    setClientToken(accessToken);
  }, [accessToken]);

  // On mount, try a silent refresh (one round-trip returns both token + username).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (!cancelled && response.ok) {
          const body = (await response.json()) as {
            access_token: string;
            username: string;
          };
          setAccessToken(body.access_token);
          setUsername(body.username);
        }
      } catch {
        // No refresh cookie or network error — fall through to logged-out state.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Register the auth-failure callback: clearing state makes ProtectedRoute redirect.
  useEffect(() => {
    setAuthFailureHandler(() => {
      setAccessToken(null);
      setUsername(null);
    });
    return () => setAuthFailureHandler(null);
  }, []);

  const login = useCallback(async (u: string, p: string) => {
    const body = await loginRequest(u, p);
    setAccessToken(body.access_token);
    setUsername(body.username);
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setAccessToken(null);
    setUsername(null);
  }, []);

  const value: AuthState = {
    accessToken,
    username,
    isLoading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npm run build
```
Expected: build succeeds (AuthProvider is unused so far — OK as long as it compiles).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/context/auth-context.tsx
git commit -m "[UI] add AuthContext with silent refresh and login/logout"
```

---

### Task 15: Login page

**Files:**
- Create: `frontend/src/pages/login.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/pages/login.tsx`:
```tsx
import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "../context/auth-context";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";

export function LoginPage() {
  const { login, accessToken, isLoading } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return null; // top-level spinner is shown by ProtectedRoute / App
  if (accessToken) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your Bag-GPT account credentials.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1">
              <label htmlFor="username" className="text-sm font-medium">
                Username
              </label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/login.tsx
git commit -m "[UI] add login page"
```

---

### Task 16: `ProtectedRoute`

**Files:**
- Create: `frontend/src/components/layout/protected-route.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/components/layout/protected-route.tsx`:
```tsx
import { LoaderCircle } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../context/auth-context";

export function ProtectedRoute() {
  const { accessToken, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-[var(--ink-soft)]" />
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/protected-route.tsx
git commit -m "[UI] add ProtectedRoute that redirects to /login when unauthenticated"
```

---

### Task 17: `TopBar` and `SidebarSlot`

**Files:**
- Create: `frontend/src/components/layout/top-bar.tsx`
- Create: `frontend/src/components/layout/sidebar-slot.tsx`

- [ ] **Step 1: Implement `SidebarSlot`**

Create `frontend/src/components/layout/sidebar-slot.tsx`:
```tsx
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface SidebarSlotContextValue {
  content: ReactNode | null;
  setContent: (node: ReactNode | null) => void;
}

const SidebarSlotContext = createContext<SidebarSlotContextValue | null>(null);

export function SidebarSlotProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  return (
    <SidebarSlotContext.Provider value={{ content, setContent }}>
      {children}
    </SidebarSlotContext.Provider>
  );
}

export function useSidebarSlotContent(): ReactNode | null {
  const ctx = useContext(SidebarSlotContext);
  if (!ctx) throw new Error("useSidebarSlotContent must be inside <SidebarSlotProvider>");
  return ctx.content;
}

export function useSidebar(content: ReactNode | null): void {
  const ctx = useContext(SidebarSlotContext);
  if (!ctx) throw new Error("useSidebar must be inside <SidebarSlotProvider>");
  useEffect(() => {
    ctx.setContent(content);
    return () => ctx.setContent(null);
    // content is intentionally re-applied on every render so pages can
    // update live as their state changes.
  });
}
```

- [ ] **Step 2: Implement `TopBar`**

Create `frontend/src/components/layout/top-bar.tsx`:
```tsx
import { LogOut } from "lucide-react";
import { Link } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import { Button } from "../ui/button";

export function TopBar() {
  const { username, logout } = useAuth();

  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
      <Link to="/" className="text-base font-semibold tracking-tight text-[var(--ink)]">
        Bag-GPT
      </Link>
      <div className="flex items-center gap-3">
        {username ? (
          <span className="text-sm text-[var(--ink-soft)]">{username}</span>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          Log out
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npm run build
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/top-bar.tsx frontend/src/components/layout/sidebar-slot.tsx
git commit -m "[UI] add TopBar and SidebarSlot layout primitives"
```

---

### Task 18: Refactor `MainLayout` into a layout route

**Files:**
- Modify: `frontend/src/components/layout/main-layout.tsx`

- [ ] **Step 1: Replace file contents**

Overwrite `frontend/src/components/layout/main-layout.tsx` with:
```tsx
import { Outlet } from "react-router-dom";

import { SidebarSlotProvider, useSidebarSlotContent } from "./sidebar-slot";
import { TopBar } from "./top-bar";

function LayoutBody() {
  const sidebar = useSidebarSlotContent();
  const hasSidebar = sidebar !== null;

  return (
    <div
      className={
        "grid min-h-[calc(100vh-theme(spacing.14))] w-full gap-6 px-6 py-6 " +
        (hasSidebar ? "lg:grid-cols-[320px_1fr]" : "lg:grid-cols-1")
      }
    >
      {hasSidebar ? (
        <aside className="self-start lg:sticky lg:top-6">{sidebar}</aside>
      ) : null}
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

export function MainLayout() {
  return (
    <SidebarSlotProvider>
      <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
        <TopBar />
        <LayoutBody />
      </div>
    </SidebarSlotProvider>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npm run build
```
Expected: build fails because `App.tsx` still imports the old prop-shaped `MainLayout`. This is expected — fixed in Task 21.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/main-layout.tsx
git commit -m "[UI] refactor MainLayout into layout route with TopBar and SidebarSlot"
```

---

### Task 19: `DashboardPage`

**Files:**
- Create: `frontend/src/pages/dashboard.tsx`

- [ ] **Step 1: Implement**

Create `frontend/src/pages/dashboard.tsx`:
```tsx
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";

interface SectionCard {
  title: string;
  description: string;
  href: string;
  status: "available" | "coming-soon";
}

const SECTIONS: SectionCard[] = [
  {
    title: "Bag Explorer",
    description: "Browse indexed bags, inspect frames, and trigger dataset extraction.",
    href: "/bags",
    status: "coming-soon",
  },
  {
    title: "Workspace (legacy)",
    description:
      "Current all-in-one UI: scan bags, run searches, chat with VLM, and launch extractions.",
    href: "/workspace",
    status: "available",
  },
  {
    title: "Datasets",
    description: "Inspect nuScenes-style datasets produced by extraction runs.",
    href: "/datasets",
    status: "coming-soon",
  },
];

export function DashboardPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {SECTIONS.map((section) => (
        <Card key={section.href}>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle>{section.title}</CardTitle>
              {section.status === "coming-soon" ? (
                <Badge variant="outline">Coming soon</Badge>
              ) : null}
            </div>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent />
          <CardFooter>
            {section.status === "available" ? (
              <Button asChild variant="default">
                <Link to={section.href}>
                  Open <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                Not available yet
              </Button>
            )}
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd frontend && npm run build
```
Expected: build fails (App.tsx still broken) — ignore, fixed in Task 21.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/dashboard.tsx
git commit -m "[UI] add DashboardPage with section cards"
```

---

### Task 20: `WorkspacePage` — relocate current `App.tsx` UI

**Files:**
- Create: `frontend/src/pages/workspace.tsx`

Goal: move the entire current `App.tsx` body (sidebar, search bar, results grid, sequence viewer, extract dialog, jobs panel) into a single `WorkspacePage` that renders the existing sidebar via `useSidebar`. No behavior change.

- [ ] **Step 1: Implement**

Create `frontend/src/pages/workspace.tsx` — copy the body of `App.tsx` and wire it through `useSidebar`:
```tsx
import { LoaderCircle } from "lucide-react";

import { BagList } from "../components/bags/bag-list";
import { BagScanner } from "../components/bags/bag-scanner";
import { ExtractDatasetDialog } from "../components/extraction/extract-dataset-dialog";
import { JobsPanel } from "../components/extraction/jobs-panel";
import { useSidebar } from "../components/layout/sidebar-slot";
import { Sidebar } from "../components/layout/sidebar";
import { ResultsGrid } from "../components/search/results-grid";
import { SequenceViewer } from "../components/search/sequence-viewer";
import { SearchBar } from "../components/search/search-bar";
import { useBags } from "../hooks/use-bags";
import { useExtractionJobs } from "../hooks/use-extraction-jobs";
import { useExtractionLauncher } from "../hooks/use-extraction-launcher";
import { useSearch } from "../hooks/use-search";
import { useSequenceViewer } from "../hooks/use-sequence-viewer";

export function WorkspacePage() {
  const {
    rootDir,
    setRootDir,
    bags,
    selectedBagPaths,
    isScanning,
    isPolling,
    onScan,
    onIndex,
    toggleBagSelection,
    toggleAllBags,
  } = useBags();

  const {
    query,
    setQuery,
    topK,
    setTopK,
    results,
    isSearching,
    runSearch,
    runImageSearch,
    runSimilarSearch,
  } = useSearch();

  const {
    activeFrame,
    canLoadMoreLeft,
    canLoadMoreRight,
    chatDuration,
    chatQuery,
    chatResponse,
    closeViewer,
    frames,
    isExtendingLeft,
    isExtendingRight,
    isChatting,
    isFrameInVlmWindow,
    isLoadingFrames,
    isOpen,
    loadMoreLeft,
    loadMoreRight,
    openViewer,
    runChat,
    selectNextFrame,
    selectPreviousFrame,
    selectedFrameIndex,
    selectedResult,
    selectedTimestampNs,
    setChatDuration,
    setChatQuery,
    setSelectedTimestampNs,
    vlmWindowEndNs,
    vlmWindowStartNs,
  } = useSequenceViewer();

  const {
    jobs,
    schema,
    extractionEnabled,
    isPolling: isExtractionPolling,
    refresh: refreshJobs,
    cancelJob,
    fetchLogs,
  } = useExtractionJobs();

  const {
    isOpen: isExtractOpen,
    isSubmitting,
    bagPath: extractBagPath,
    windowS,
    outputFolder,
    userConfig,
    open: openExtract,
    close: closeExtract,
    submit: submitExtract,
    setBagPath: setExtractBagPath,
    setWindowS,
    setOutputFolder,
    setFieldValue,
  } = useExtractionLauncher(schema, refreshJobs);

  const handleExtractDataset = () => {
    if (!selectedResult || selectedTimestampNs === null) return;
    openExtract({
      bagPath: selectedResult.bag_path,
      centerNs: selectedTimestampNs,
      defaultWindowS: chatDuration,
    });
  };

  useSidebar(
    <Sidebar
      extractionEnabled={extractionEnabled}
      scanner={
        <BagScanner
          rootDir={rootDir}
          onRootDirChange={setRootDir}
          onScan={onScan}
          isScanning={isScanning}
        />
      }
      bags={
        <BagList
          bags={bags}
          selectedBagPaths={selectedBagPaths}
          onToggleBag={toggleBagSelection}
          onToggleAllBags={toggleAllBags}
          onIndex={onIndex}
        />
      }
      footer={
        isPolling || isExtractionPolling ? (
          <p className="flex items-center gap-2 text-xs text-[var(--ink-soft)]">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            {isPolling ? "Polling indexing status..." : "Polling extraction jobs..."}
          </p>
        ) : null
      }
      jobs={
        <JobsPanel jobs={jobs} onCancel={cancelJob} onFetchLogs={fetchLogs} />
      }
    />,
  );

  return (
    <div className="space-y-6">
      <SearchBar
        query={query}
        onQueryChange={setQuery}
        topK={topK}
        onTopKChange={setTopK}
        onSearch={() => runSearch(selectedBagPaths)}
        onImageUpload={(file) => {
          void runImageSearch(file, selectedBagPaths);
        }}
        isSearching={isSearching}
        selectedBagCount={selectedBagPaths.length}
      />
      <ResultsGrid
        results={results}
        isSearching={isSearching}
        onResultClick={openViewer}
        onSimilarSearch={(result) => {
          void runSimilarSearch(result, selectedBagPaths);
        }}
      />
      <SequenceViewer
        activeFrame={activeFrame}
        canLoadMoreLeft={canLoadMoreLeft}
        canLoadMoreRight={canLoadMoreRight}
        chatDuration={chatDuration}
        chatQuery={chatQuery}
        chatResponse={chatResponse}
        extractionEnabled={extractionEnabled}
        frames={frames}
        isExtendingLeft={isExtendingLeft}
        isExtendingRight={isExtendingRight}
        isChatting={isChatting}
        isFrameInVlmWindow={isFrameInVlmWindow}
        isLoadingFrames={isLoadingFrames}
        isOpen={isOpen}
        onChat={runChat}
        onChatDurationChange={setChatDuration}
        onChatQueryChange={setChatQuery}
        onClose={closeViewer}
        onExtractDataset={handleExtractDataset}
        onLoadMoreLeft={loadMoreLeft}
        onLoadMoreRight={loadMoreRight}
        onSelectNextFrame={selectNextFrame}
        onSelectPreviousFrame={selectPreviousFrame}
        onSelectTimestamp={setSelectedTimestampNs}
        result={selectedResult}
        selectedFrameIndex={selectedFrameIndex}
        selectedTimestampNs={selectedTimestampNs}
        vlmWindowEndNs={vlmWindowEndNs}
        vlmWindowStartNs={vlmWindowStartNs}
      />
      {extractionEnabled ? (
        <ExtractDatasetDialog
          isOpen={isExtractOpen}
          isSubmitting={isSubmitting}
          schema={schema}
          bagName={selectedResult?.source_bag ?? ""}
          bagPath={extractBagPath}
          centerTimestampMs={
            selectedTimestampNs !== null
              ? Math.floor(selectedTimestampNs / 1_000_000)
              : 0
          }
          windowS={windowS}
          outputFolder={outputFolder}
          userConfig={userConfig}
          onClose={closeExtract}
          onSubmit={() => void submitExtract()}
          onBagPathChange={setExtractBagPath}
          onWindowChange={setWindowS}
          onOutputFolderChange={setOutputFolder}
          onFieldChange={setFieldValue}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit (do not typecheck yet — App.tsx still broken until Task 21)**

```bash
git add frontend/src/pages/workspace.tsx
git commit -m "[UI] relocate legacy all-in-one UI into WorkspacePage"
```

---

### Task 21: Router + thin `App.tsx`

**Files:**
- Create: `frontend/src/router.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create the router**

Create `frontend/src/router.tsx`:
```tsx
import { createBrowserRouter, Navigate } from "react-router-dom";

import { MainLayout } from "./components/layout/main-layout";
import { ProtectedRoute } from "./components/layout/protected-route";
import { DashboardPage } from "./pages/dashboard";
import { LoginPage } from "./pages/login";
import { WorkspacePage } from "./pages/workspace";

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        This section isn't available yet.
      </p>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "workspace", element: <WorkspacePage /> },
          { path: "search", element: <Navigate to="/workspace" replace /> },
          { path: "bags/*", element: <ComingSoon title="Bag Explorer" /> },
          { path: "datasets/*", element: <ComingSoon title="Datasets" /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
```

- [ ] **Step 2: Rewrite `App.tsx`**

Overwrite `frontend/src/App.tsx`:
```tsx
import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "./context/auth-context";
import { router } from "./router";

function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 3: Remove unused CSS import if `App.css` is no longer imported**

Check whether `App.tsx` used to import `App.css`. If it did (search original `App.tsx` history or the file before edit), delete `frontend/src/App.css`:
```bash
grep -l "App.css" frontend/src/ -r || echo "App.css no longer imported"
```
If no files import it, remove it:
```bash
git rm frontend/src/App.css
```
Otherwise leave it.

- [ ] **Step 4: Typecheck**

```bash
cd frontend && npm run build
```
Expected: build succeeds and writes to `../static/`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/router.tsx frontend/src/App.tsx
git commit -m "[UI] wire router: auth guard, layout, dashboard/workspace, coming-soon stubs"
```

---

### Task 22: Manual end-to-end verification

This task has no code. It validates the whole Phase 1 integration from a real browser.

- [ ] **Step 1: Set up a dev user**

In terminal 1, from project root:
```bash
JWT_SECRET=dev-access-secret REFRESH_SECRET=dev-refresh-secret AUTH_DB_PATH=./data/users.db \
  uv run python scripts/manage_users.py add-user admin
```
Enter a password (twice). Expected: `Created user 'admin'.`

- [ ] **Step 2: Start the backend**

In terminal 1:
```bash
JWT_SECRET=dev-access-secret REFRESH_SECRET=dev-refresh-secret AUTH_DB_PATH=./data/users.db \
  uv run uvicorn app:app --reload
```
Expected: server starts on port 8000 without errors.

- [ ] **Step 3: Start the frontend dev server**

In terminal 2:
```bash
cd frontend && npm run dev
```
Expected: Vite dev server on http://localhost:5173.

- [ ] **Step 4: Verify unauthenticated flow redirects to /login**

Open `http://localhost:5173/` in a browser (use an incognito window for a clean cookie state).
Expected: brief spinner, then redirected to `/login`.

- [ ] **Step 5: Verify login succeeds**

Sign in with `admin` + the password you set.
Expected: redirected to `/` (Dashboard) showing three cards (Bag Explorer, Workspace (legacy), Datasets). Top bar shows `admin` + Log out button.

- [ ] **Step 6: Verify Workspace section works**

Click "Open" on the Workspace card.
Expected: The legacy UI renders — sidebar with Bag scanner, Bags list, Jobs panel (if extraction is enabled); top bar persists; a search bar above a results grid.

Scan a directory you use for testing, then try a text search. Expected: results appear.

- [ ] **Step 7: Verify 401 recovery (silent refresh)**

With DevTools → Application → Storage open, confirm there is a `refresh_token` httpOnly cookie but **no access token** in localStorage.

Reload the page. Expected: brief spinner, then lands on the page you were on (refresh cookie drives silent re-auth).

- [ ] **Step 8: Verify logout**

Click Log out.
Expected: redirected to `/login`. The refresh cookie is cleared (DevTools shows it gone). Manually navigating to `/` immediately redirects back to `/login`.

- [ ] **Step 9: Verify deactivated user is rejected**

Stop the frontend (terminal 2). In terminal 1, stop the backend and run:
```bash
AUTH_DB_PATH=./data/users.db uv run python scripts/manage_users.py delete-user admin
```
Restart backend + frontend. Try to log in as `admin`.
Expected: login fails with 401.

Reactivate for future use:
```bash
AUTH_DB_PATH=./data/users.db uv run python -c "
import asyncio
from src.auth.db import set_user_active
asyncio.run(set_user_active('admin', active=True))
"
```

- [ ] **Step 10: Run the full test suite one final time**

```bash
uv run pytest tests/ -v
```
Expected: all tests pass.

- [ ] **Step 11: Final commit / status**

No code changes expected. If the manual QA surfaced any bug, fix it, commit separately, and re-run the test suite. Otherwise no commit needed.

---

## Done

Phase 1 is complete when:
- `uv run pytest tests/` passes (all auth, manage_users, and existing contract tests).
- `cd frontend && npm run build` succeeds.
- Manual QA (Task 22) walks through the end-to-end flow without errors.

Follow-up phases build on this scaffold: Phase 2 adds `/bags` (file-system browser + bag explorer), Phase 3 adds a dedicated `/search` page, Phase 4 adds `/datasets` (nuScenes inspector). Each replaces its "Coming soon" card and — eventually — retires `/workspace`.

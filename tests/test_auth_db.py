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

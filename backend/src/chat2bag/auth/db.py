import os
from pathlib import Path

import aiosqlite

from chat2bag.auth.models import User

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


async def get_user_with_password(username: str) -> tuple[User, str] | None:
    """Return (User, hashed_password) for login, or None if the user doesn't exist."""
    path = _resolve_db_path()
    async with aiosqlite.connect(str(path)) as db:
        cursor = await db.execute(
            "SELECT id, username, is_active, hashed_password FROM users WHERE username = ?",
            (username,),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return User(id=row[0], username=row[1], is_active=bool(row[2])), row[3]


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
        if cursor.rowcount == 0:
            raise LookupError(f"User {username!r} not found")
        await db.commit()


async def update_password(username: str, hashed_password: str) -> None:
    path = _resolve_db_path()
    async with aiosqlite.connect(str(path)) as db:
        cursor = await db.execute(
            "UPDATE users SET hashed_password = ? WHERE username = ?",
            (hashed_password, username),
        )
        if cursor.rowcount == 0:
            raise LookupError(f"User {username!r} not found")
        await db.commit()


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


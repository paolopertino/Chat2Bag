"""CLI for managing Bag-GPT auth users.

Usage:
    python backend/scripts/manage_users.py add-user <username>
    python backend/scripts/manage_users.py delete-user <username>
    python backend/scripts/manage_users.py list-users
    python backend/scripts/manage_users.py reset-password <username>

Reads AUTH_DB_PATH to locate the SQLite user database (default: data/users.db).
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import sys
from pathlib import Path

# Ensure the backend package is importable when invoked as a script.
_BACKEND_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(_BACKEND_SRC))

from chat2bag.auth.db import (
    create_user,
    ensure_db_initialized,
    get_user_by_username,
    list_users,
    set_user_active,
    update_password,
)
from chat2bag.auth.hashing import hash_password


def _read_password(label: str = "Password") -> str:
    if sys.stdin.isatty():
        return getpass.getpass(f"{label}: ")
    return sys.stdin.readline().rstrip("\n")


def _prompt_password(label: str = "Password") -> str:
    first = _read_password(label)
    second = _read_password(f"{label} (confirm)")
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

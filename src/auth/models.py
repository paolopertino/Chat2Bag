from dataclasses import dataclass


@dataclass(frozen=True)
class User:
    id: int
    username: str
    is_active: bool

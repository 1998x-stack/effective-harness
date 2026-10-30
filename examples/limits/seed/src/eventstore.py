from dataclasses import dataclass
from pathlib import Path


class VersionConflict(Exception):
    pass


class DuplicateEvent(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Event:
    sequence: int
    stream: str
    version: int
    event_id: str
    kind: str
    payload: dict[str, str]


class SQLiteEventStore:
    def __init__(self, path: Path) -> None:
        raise NotImplementedError

    def append(
        self, stream: str, expected_version: int, event_id: str, kind: str, payload: dict[str, str]
    ) -> Event:
        raise NotImplementedError

    def read(self, stream: str, after_version: int = 0) -> tuple[Event, ...]:
        raise NotImplementedError

    def read_all(self, after_sequence: int = 0) -> tuple[Event, ...]:
        raise NotImplementedError

    def save_snapshot(self, stream: str, version: int, state: dict[str, str]) -> None:
        raise NotImplementedError

    def load_snapshot(self, stream: str) -> tuple[int, dict[str, str]] | None:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError

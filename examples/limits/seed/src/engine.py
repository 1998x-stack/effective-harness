from dataclasses import dataclass
from pathlib import Path


class InvalidGraph(ValueError):
    pass


class StaleLease(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class TaskSpec:
    id: str
    needs: tuple[str, ...]
    units: int
    priority: int
    max_attempts: int


@dataclass(frozen=True, slots=True)
class TaskState:
    status: str
    attempts: int
    next_at: int
    lease_until: int | None
    token: str | None
    result: str | None


class DurableEngine:
    def __init__(self, path: Path, specs: tuple[TaskSpec, ...], capacity: int) -> None:
        raise NotImplementedError

    def ready(self, now: int) -> tuple[str, ...]:
        raise NotImplementedError

    def claim(self, task_id: str, now: int, lease_seconds: int = 30) -> str:
        raise NotImplementedError

    def complete(self, task_id: str, token: str, result: str, now: int) -> None:
        raise NotImplementedError

    def fail(self, task_id: str, token: str, now: int) -> None:
        raise NotImplementedError

    def state(self, task_id: str) -> TaskState:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError

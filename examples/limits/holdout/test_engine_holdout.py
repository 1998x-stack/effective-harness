from pathlib import Path

import pytest

from src.engine import DurableEngine, TaskSpec


def task(id: str, needs: tuple[str, ...] = (), max_attempts: int = 1) -> TaskSpec:
    return TaskSpec(id, needs, 1, 0, max_attempts)


def test_cancel_rejects_failed_task_without_rewriting_terminal_history(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (task("a"),), 1)
    token = db.claim("a", 0)
    db.fail("a", token, 1)
    before = db.history()
    with pytest.raises(ValueError):
        db.cancel("a", 2)
    assert db.state("a").status == "failed"
    assert db.history() == before
    db.close()


def test_cancel_rejects_blocked_task_without_rewriting_terminal_history(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (task("a"), task("b", ("a",))), 1)
    db.cancel("a", 0)
    before = db.history()
    with pytest.raises(ValueError):
        db.cancel("b", 1)
    assert db.state("b").status == "blocked"
    assert db.history() == before
    db.close()

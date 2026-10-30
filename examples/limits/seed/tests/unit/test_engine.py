from pathlib import Path

import pytest

from src.engine import DurableEngine, InvalidGraph, StaleLease, TaskSpec


def spec(id: str, needs: tuple[str, ...] = (), units: int = 1,
         priority: int = 0, max_attempts: int = 3) -> TaskSpec:
    return TaskSpec(id, needs, units, priority, max_attempts)


def engine(tmp_path: Path, specs: tuple[TaskSpec, ...], capacity: int = 2) -> DurableEngine:
    return DurableEngine(tmp_path / "engine.sqlite", specs, capacity)


@pytest.mark.parametrize("specs,capacity", [
    ((spec("a"), spec("a")), 2),
    ((spec("a", ("missing",)),), 2),
    ((spec("a", ("b",)), spec("b", ("a",))), 2),
    ((spec("a", units=0),), 2),
    ((spec("a", units=3),), 2),
    ((spec("a", max_attempts=0),), 2),
    ((spec("a"),), 0),
])
def test_invalid_graph_rejected(tmp_path: Path, specs: tuple[TaskSpec, ...], capacity: int) -> None:
    with pytest.raises(InvalidGraph):
        engine(tmp_path, specs, capacity)


def test_initial_ready_respects_priority_id_and_capacity(tmp_path: Path) -> None:
    jobs = (spec("b", units=2, priority=9), spec("a", units=2, priority=9), spec("c", units=1, priority=1))
    db = engine(tmp_path, jobs, 3)
    assert db.ready(0) == ("a", "c")
    db.close()


def test_claim_reserves_capacity_and_completion_unlocks_dependent(tmp_path: Path) -> None:
    jobs = (spec("build", ("fetch",), priority=9), spec("fetch"), spec("other"))
    db = engine(tmp_path, jobs)
    assert db.ready(0) == ("fetch", "other")
    fetch_token = db.claim("fetch", 0)
    other_token = db.claim("other", 0)
    assert db.ready(0) == ()
    assert db.state("fetch").status == "running"
    db.complete("fetch", fetch_token, "downloaded", 1)
    assert db.ready(1) == ("build",)
    db.complete("other", other_token, "done", 1)
    assert db.state("fetch").result == "downloaded"
    db.close()


def test_claim_nonready_task_or_bad_lease_rejected(tmp_path: Path) -> None:
    db = engine(tmp_path, (spec("a"), spec("b", ("a",))))
    with pytest.raises(ValueError):
        db.claim("b", 0)
    with pytest.raises(ValueError):
        db.claim("a", 0, lease_seconds=0)
    token = db.claim("a", 0)
    assert token
    with pytest.raises(ValueError):
        db.claim("a", 0)
    db.close()


def test_failure_backoff_then_retry_then_terminal_failure(tmp_path: Path) -> None:
    db = engine(tmp_path, (spec("a", max_attempts=2), spec("b", ("a",))))
    token = db.claim("a", 10)
    db.fail("a", token, 11)
    assert db.state("a").attempts == 1
    assert db.state("a").next_at == 12
    assert db.ready(11) == ()
    assert db.ready(12) == ("a",)
    token2 = db.claim("a", 12)
    assert token2 != token
    db.fail("a", token2, 13)
    assert db.state("a").status == "failed"
    assert db.state("b").status == "blocked"
    assert db.ready(100) == ()
    db.close()


def test_lease_expiry_requeues_and_rejects_stale_completion(tmp_path: Path) -> None:
    db = engine(tmp_path, (spec("a", max_attempts=3),))
    token = db.claim("a", 10, lease_seconds=5)
    assert db.ready(14) == ()
    assert db.ready(15) == ()
    assert db.state("a").next_at == 16
    with pytest.raises(StaleLease):
        db.complete("a", token, "late", 16)
    assert db.ready(16) == ("a",)
    token2 = db.claim("a", 16)
    db.complete("a", token2, "ok", 17)
    assert db.state("a").status == "succeeded"
    db.close()


def test_stale_token_and_completion_after_expiry_rejected(tmp_path: Path) -> None:
    db = engine(tmp_path, (spec("a"),))
    token = db.claim("a", 0, lease_seconds=3)
    with pytest.raises(StaleLease):
        db.fail("a", "wrong", 1)
    with pytest.raises(StaleLease):
        db.complete("a", token, "too late", 3)
    assert db.state("a").status != "succeeded"
    db.close()


def test_exhausted_lease_blocks_descendants_transitively(tmp_path: Path) -> None:
    jobs = (spec("a", max_attempts=1), spec("b", ("a",)), spec("c", ("b",)))
    db = engine(tmp_path, jobs)
    db.claim("a", 0, lease_seconds=2)
    assert db.ready(2) == ()
    assert [db.state(name).status for name in ("a", "b", "c")] == ["failed", "blocked", "blocked"]
    db.close()


def test_restart_preserves_running_lease_and_result(tmp_path: Path) -> None:
    path = tmp_path / "engine.sqlite"
    jobs = (spec("a"), spec("b", ("a",)))
    db = DurableEngine(path, jobs, 2)
    token = db.claim("a", 5, lease_seconds=10)
    db.close()
    reopened = DurableEngine(path, jobs, 2)
    assert reopened.state("a").status == "running"
    assert reopened.ready(6) == ()
    reopened.complete("a", token, "persisted", 7)
    reopened.close()
    final = DurableEngine(path, jobs, 2)
    assert final.state("a").result == "persisted"
    assert final.ready(7) == ("b",)
    final.close()


def test_reopen_with_changed_spec_or_capacity_rejected(tmp_path: Path) -> None:
    path = tmp_path / "engine.sqlite"
    db = DurableEngine(path, (spec("a"),), 2)
    db.close()
    with pytest.raises(InvalidGraph):
        DurableEngine(path, (spec("a", priority=4),), 2)
    with pytest.raises(InvalidGraph):
        DurableEngine(path, (spec("a"),), 3)


def test_two_connections_cannot_claim_same_task(tmp_path: Path) -> None:
    path = tmp_path / "engine.sqlite"
    jobs = (spec("a"),)
    first = DurableEngine(path, jobs, 2)
    second = DurableEngine(path, jobs, 2)
    first.claim("a", 0)
    with pytest.raises(ValueError):
        second.claim("a", 0)
    assert second.state("a").attempts == 1
    first.close()
    second.close()

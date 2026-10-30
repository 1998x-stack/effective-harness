from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
from threading import Barrier

import pytest

from src.engine import DurableEngine, StaleLease, TaskSpec


def spec(id: str, needs: tuple[str, ...] = (), units: int = 1,
         priority: int = 0, max_attempts: int = 3) -> TaskSpec:
    return TaskSpec(id, needs, units, priority, max_attempts)


def test_batch_claims_priority_wave_atomically(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (
        spec("b", units=2, priority=9), spec("a", units=2, priority=9),
        spec("c", units=1, priority=1)
    ), 3)
    claimed = db.claim_batch(10, lease_seconds=7)
    assert tuple(task_id for task_id, _ in claimed) == ("a", "c")
    assert all(token for _, token in claimed)
    assert db.state("a").attempts == 1
    assert db.state("a").lease_until == 17
    assert db.claim_batch(10) == ()
    db.close()


def test_batch_claim_can_return_empty_without_writing_history(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (spec("a", ("b",)), spec("b")), 1)
    token = db.claim("b", 0)
    before = db.history()
    assert db.claim_batch(0) == ()
    assert db.history() == before
    db.complete("b", token, "ok", 1)
    assert tuple(task_id for task_id, _ in db.claim_batch(1)) == ("a",)
    db.close()


def test_renew_extends_existing_lease_and_rejects_stale_token(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (spec("a"),), 1)
    token = db.claim("a", 10, lease_seconds=5)
    db.renew("a", token, 12, extend_seconds=7)
    assert db.state("a").lease_until == 22
    assert db.ready(15) == ()
    with pytest.raises(StaleLease):
        db.renew("a", "wrong", 13, extend_seconds=1)
    with pytest.raises(ValueError):
        db.renew("a", token, 13, extend_seconds=0)
    db.complete("a", token, "done", 20)
    with pytest.raises(StaleLease):
        db.renew("a", token, 21, extend_seconds=1)
    db.close()


def test_renew_at_expiry_is_stale(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (spec("a"),), 1)
    token = db.claim("a", 0, lease_seconds=3)
    with pytest.raises(StaleLease):
        db.renew("a", token, 3, extend_seconds=5)
    assert db.state("a").status != "running"
    db.close()


def test_cancel_pending_task_blocks_descendants_and_is_idempotent(tmp_path: Path) -> None:
    tasks = (spec("a"), spec("b", ("a",)), spec("c", ("b",)))
    db = DurableEngine(tmp_path / "engine.sqlite", tasks, 2)
    db.cancel("a", 2)
    assert [db.state(name).status for name in ("a", "b", "c")] == ["cancelled", "blocked", "blocked"]
    history = db.history()
    db.cancel("a", 3)
    assert db.history() == history
    assert db.ready(100) == ()
    db.close()


def test_cancel_running_task_invalidates_lease_and_releases_capacity(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (spec("a"), spec("b")), 1)
    token = db.claim("a", 0)
    assert db.ready(0) == ()
    db.cancel("a", 1)
    assert db.ready(1) == ("b",)
    with pytest.raises(StaleLease):
        db.complete("a", token, "late", 2)
    db.close()


def test_cannot_cancel_succeeded_task(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (spec("a"),), 1)
    token = db.claim("a", 0)
    db.complete("a", token, "ok", 1)
    with pytest.raises(ValueError):
        db.cancel("a", 2)
    db.close()


def test_history_records_transitions_in_order_and_filters(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (spec("a"),), 1)
    token = db.claim("a", 1)
    db.renew("a", token, 2, extend_seconds=5)
    db.fail("a", token, 3)
    events = db.history()
    assert [(event.sequence, event.task_id, event.action, event.at, event.attempt) for event in events] == [
        (1, "a", "claim", 1, 1), (2, "a", "renew", 2, 1), (3, "a", "fail", 3, 1)
    ]
    assert db.history(after_sequence=1) == events[1:]
    db.close()


def test_expired_lease_and_blocking_are_audited_once(tmp_path: Path) -> None:
    db = DurableEngine(tmp_path / "engine.sqlite", (spec("a", max_attempts=1), spec("b", ("a",))), 1)
    db.claim("a", 0, lease_seconds=2)
    db.ready(2)
    assert [(event.task_id, event.action) for event in db.history()] == [
        ("a", "claim"), ("a", "expire"), ("b", "block")
    ]
    db.ready(3)
    assert len(db.history()) == 3
    db.close()


def test_history_survives_restart_and_schema_migration(tmp_path: Path) -> None:
    path = tmp_path / "engine.sqlite"
    jobs = (spec("a"),)
    db = DurableEngine(path, jobs, 1)
    token = db.claim("a", 0)
    db.close()
    reopened = DurableEngine(path, jobs, 1)
    assert [(event.sequence, event.action) for event in reopened.history()] == [(1, "claim")]
    reopened.complete("a", token, "done", 1)
    assert [(event.sequence, event.action) for event in reopened.history()] == [(1, "claim"), (2, "complete")]
    reopened.close()


def test_migration_adds_history_to_existing_database_without_losing_state(tmp_path: Path) -> None:
    path = tmp_path / "engine.sqlite"
    jobs = (spec("a"), spec("b", ("a",)))
    old = DurableEngine(path, jobs, 1)
    token = old.claim("a", 0)
    old.close()
    with sqlite3.connect(path) as connection:
        connection.execute("DROP TABLE history")
    migrated = DurableEngine(path, jobs, 1)
    assert migrated.state("a").status == "running"
    assert migrated.state("a").token == token
    assert migrated.history() == ()
    migrated.complete("a", token, "done", 1)
    assert [(event.sequence, event.action) for event in migrated.history()] == [(1, "complete")]
    assert migrated.ready(1) == ("b",)
    migrated.close()


def test_cancel_and_terminal_failure_record_each_dependent_block_once(tmp_path: Path) -> None:
    jobs = (spec("a", max_attempts=1), spec("b", ("a",)), spec("c", ("b",)))
    cancelled = DurableEngine(tmp_path / "cancel.sqlite", jobs, 1)
    cancelled.cancel("a", 0)
    assert [(event.task_id, event.action) for event in cancelled.history()] == [
        ("a", "cancel"), ("b", "block"), ("c", "block")
    ]
    cancelled.ready(1)
    assert len(cancelled.history()) == 3
    cancelled.close()

    failed = DurableEngine(tmp_path / "failed.sqlite", jobs, 1)
    token = failed.claim("a", 0)
    failed.fail("a", token, 1)
    assert [(event.task_id, event.action) for event in failed.history()] == [
        ("a", "claim"), ("a", "fail"), ("b", "block"), ("c", "block")
    ]
    failed.ready(2)
    assert len(failed.history()) == 4
    failed.close()


def test_parallel_batch_claims_never_duplicate_assignment(tmp_path: Path) -> None:
    path = tmp_path / "engine.sqlite"
    jobs = (spec("a"), spec("b"), spec("c"))
    DurableEngine(path, jobs, 2).close()
    barrier = Barrier(2)

    def worker() -> tuple[tuple[str, str], ...]:
        db = DurableEngine(path, jobs, 2)
        barrier.wait()
        claimed = db.claim_batch(0)
        db.close()
        return claimed

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = [future.result() for future in [pool.submit(worker), pool.submit(worker)]]
    ids = [task_id for task_id, _ in first + second]
    assert sorted(ids) == ["a", "b"]
    assert len(ids) == len(set(ids))

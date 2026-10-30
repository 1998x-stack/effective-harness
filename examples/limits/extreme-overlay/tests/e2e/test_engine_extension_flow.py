from pathlib import Path

from src.engine import DurableEngine, TaskSpec


def test_long_pipeline_with_batch_renew_retry_cancel_and_restart(tmp_path: Path) -> None:
    tasks = (
        TaskSpec("fetch", (), 1, 9, 2),
        TaskSpec("parse", ("fetch",), 2, 8, 2),
        TaskSpec("index", ("parse",), 1, 5, 2),
        TaskSpec("archive", ("parse",), 1, 1, 2),
    )
    path = tmp_path / "engine.sqlite"
    db = DurableEngine(path, tasks, 2)
    ((task_id, token),) = db.claim_batch(0, lease_seconds=5)
    assert task_id == "fetch"
    db.renew("fetch", token, 3, extend_seconds=5)
    db.complete("fetch", token, "blob", 7)
    ((task_id, parse_token),) = db.claim_batch(7)
    assert task_id == "parse"
    db.fail("parse", parse_token, 8)
    db.close()

    db = DurableEngine(path, tasks, 2)
    assert db.claim_batch(8) == ()
    ((task_id, parse_token),) = db.claim_batch(9)
    assert task_id == "parse"
    db.complete("parse", parse_token, "rows", 10)
    assert tuple(task_id for task_id, _ in db.claim_batch(10)) == ("index", "archive")
    db.cancel("archive", 11)
    assert db.state("archive").status == "cancelled"
    assert db.state("index").status == "running"
    actions = [(event.task_id, event.action) for event in db.history()]
    assert actions.count(("fetch", "claim")) == 1
    assert actions.count(("parse", "claim")) == 2
    assert ("archive", "cancel") in actions
    assert [event.sequence for event in db.history()] == list(range(1, len(actions) + 1))
    db.close()

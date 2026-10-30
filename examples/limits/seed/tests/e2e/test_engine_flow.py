from pathlib import Path

from src.engine import DurableEngine, TaskSpec
from src.eventstore import SQLiteEventStore


def test_recover_pipeline_and_audit_results_across_restarts(tmp_path: Path) -> None:
    tasks = (
        TaskSpec("download", (), 1, 2, 2),
        TaskSpec("parse", ("download",), 2, 3, 2),
        TaskSpec("index", ("parse",), 1, 5, 2),
        TaskSpec("archive", ("parse",), 1, 1, 2),
    )
    engine_path = tmp_path / "engine.sqlite"
    events_path = tmp_path / "events.sqlite"
    jobs = DurableEngine(engine_path, tasks, 2)
    audit = SQLiteEventStore(events_path)
    assert jobs.ready(0) == ("download",)
    token = jobs.claim("download", 0)
    jobs.complete("download", token, "blob", 1)
    audit.append("pipeline", 0, "download-done", "complete", {"task": "download"})
    parse_token = jobs.claim("parse", 1)
    jobs.fail("parse", parse_token, 2)
    jobs.close()
    audit.close()

    jobs = DurableEngine(engine_path, tasks, 2)
    audit = SQLiteEventStore(events_path)
    assert jobs.ready(2) == ()
    assert jobs.ready(3) == ("parse",)
    parse_token = jobs.claim("parse", 3)
    jobs.complete("parse", parse_token, "rows", 4)
    audit.append("pipeline", 1, "parse-done", "complete", {"task": "parse"})
    assert jobs.ready(4) == ("index", "archive")
    index_token = jobs.claim("index", 4)
    archive_token = jobs.claim("archive", 4)
    jobs.complete("index", index_token, "index-id", 5)
    jobs.complete("archive", archive_token, "archive-id", 5)
    assert [jobs.state(name).status for name in ("download", "parse", "index", "archive")] == [
        "succeeded", "succeeded", "succeeded", "succeeded"
    ]
    assert [event.payload["task"] for event in audit.read("pipeline")] == ["download", "parse"]
    jobs.close()
    audit.close()

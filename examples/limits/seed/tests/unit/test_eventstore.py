from pathlib import Path

import pytest

from src.eventstore import DuplicateEvent, SQLiteEventStore, VersionConflict


def store(tmp_path: Path) -> SQLiteEventStore:
    return SQLiteEventStore(tmp_path / "events.sqlite")


def test_append_assigns_stream_versions_and_global_sequence(tmp_path: Path) -> None:
    db = store(tmp_path)
    first = db.append("alpha", 0, "e1", "set", {"value": "one"})
    second = db.append("beta", 0, "e2", "set", {"value": "two"})
    third = db.append("alpha", 1, "e3", "set", {"value": "three"})
    assert [(e.stream, e.version, e.sequence) for e in (first, second, third)] == [
        ("alpha", 1, 1), ("beta", 1, 2), ("alpha", 2, 3)
    ]
    db.close()


def test_read_filters_and_order(tmp_path: Path) -> None:
    db = store(tmp_path)
    db.append("a", 0, "e1", "set", {"x": "1"})
    db.append("b", 0, "e2", "set", {"x": "2"})
    db.append("a", 1, "e3", "set", {"x": "3"})
    assert [e.event_id for e in db.read("a")] == ["e1", "e3"]
    assert [e.event_id for e in db.read("a", after_version=1)] == ["e3"]
    assert [e.event_id for e in db.read_all(after_sequence=1)] == ["e2", "e3"]
    assert db.read("unknown") == ()
    db.close()


def test_stale_expected_version_is_rejected_without_adding_event(tmp_path: Path) -> None:
    db = store(tmp_path)
    db.append("a", 0, "e1", "set", {})
    with pytest.raises(VersionConflict):
        db.append("a", 0, "e2", "set", {})
    assert len(db.read("a")) == 1
    db.close()


def test_exact_replay_is_idempotent_even_when_expected_version_is_old(tmp_path: Path) -> None:
    db = store(tmp_path)
    first = db.append("a", 0, "e1", "set", {"a": "1", "b": "2"})
    db.append("a", 1, "e2", "set", {"a": "3"})
    replay = db.append("a", 0, "e1", "set", {"b": "2", "a": "1"})
    assert replay == first
    assert len(db.read_all()) == 2
    db.close()


def test_conflicting_id_reuse_is_rejected_across_streams(tmp_path: Path) -> None:
    db = store(tmp_path)
    db.append("a", 0, "same", "set", {"a": "1"})
    with pytest.raises(DuplicateEvent):
        db.append("a", 0, "same", "set", {"a": "2"})
    with pytest.raises(DuplicateEvent):
        db.append("b", 0, "same", "set", {"a": "1"})
    assert len(db.read_all()) == 1
    db.close()


def test_payload_is_persisted_independently_of_callers_mutable_dict(tmp_path: Path) -> None:
    db = store(tmp_path)
    payload = {"a": "original"}
    db.append("a", 0, "e1", "set", payload)
    payload["a"] = "mutated"
    assert db.read("a")[0].payload == {"a": "original"}
    db.close()


def test_reopen_keeps_events_and_sequence(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "events.sqlite"
    first = SQLiteEventStore(path)
    first.append("a", 0, "e1", "set", {"x": "1"})
    first.close()
    second = SQLiteEventStore(path)
    assert second.read("a")[0].payload == {"x": "1"}
    assert second.append("b", 0, "e2", "set", {}).sequence == 2
    second.close()


def test_snapshot_requires_existing_version_and_only_moves_forward(tmp_path: Path) -> None:
    db = store(tmp_path)
    assert db.load_snapshot("a") is None
    with pytest.raises(VersionConflict):
        db.save_snapshot("a", 1, {"total": "1"})
    db.append("a", 0, "e1", "set", {})
    db.append("a", 1, "e2", "set", {})
    db.save_snapshot("a", 1, {"total": "1"})
    db.save_snapshot("a", 2, {"total": "2"})
    with pytest.raises(VersionConflict):
        db.save_snapshot("a", 1, {"total": "stale"})
    assert db.load_snapshot("a") == (2, {"total": "2"})
    db.close()


def test_snapshot_survives_reopen_and_is_copied(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite"
    db = SQLiteEventStore(path)
    db.append("a", 0, "e1", "set", {})
    state = {"value": "one"}
    db.save_snapshot("a", 1, state)
    state["value"] = "two"
    db.close()
    reopened = SQLiteEventStore(path)
    assert reopened.load_snapshot("a") == (1, {"value": "one"})
    reopened.close()


def test_two_connections_race_on_same_version(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite"
    left = SQLiteEventStore(path)
    right = SQLiteEventStore(path)
    left.append("a", 0, "e1", "set", {})
    with pytest.raises(VersionConflict):
        right.append("a", 0, "e2", "set", {})
    assert len(right.read("a")) == 1
    left.close()
    right.close()


@pytest.mark.parametrize("stream,event_id,kind", [('', 'e', 'set'), ('a', '', 'set'), ('a', 'e', '')])
def test_blank_identifiers_are_rejected(tmp_path: Path, stream: str, event_id: str, kind: str) -> None:
    db = store(tmp_path)
    with pytest.raises(ValueError):
        db.append(stream, 0, event_id, kind, {})
    db.close()

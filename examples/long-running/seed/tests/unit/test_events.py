import pytest

from src.events import Event, project_events


def test_upsert_and_delete() -> None:
    events: list[Event] = [
        {"id": "a", "seq": 1, "action": "upsert", "value": "old"},
        {"id": "b", "seq": 1, "action": "upsert", "value": "other"},
        {"id": "a", "seq": 2, "action": "upsert", "value": "new"},
        {"id": "b", "seq": 2, "action": "delete", "value": ""},
    ]
    assert project_events(events) == {"a": "new"}


def test_replayed_identical_event_is_idempotent() -> None:
    event: Event = {"id": "a", "seq": 1, "action": "upsert", "value": "value"}
    assert project_events([event, event]) == {"a": "value"}


def test_conflicting_sequence_rejected() -> None:
    events: list[Event] = [
        {"id": "a", "seq": 2, "action": "upsert", "value": "late"},
        {"id": "a", "seq": 1, "action": "upsert", "value": "early"},
    ]
    with pytest.raises(ValueError, match="sequence"):
        project_events(events)
    with pytest.raises(ValueError, match="sequence"):
        project_events([
            {"id": "a", "seq": 1, "action": "upsert", "value": "first"},
            {"id": "a", "seq": 1, "action": "upsert", "value": "different"},
        ])


def test_delete_keeps_sequence_history() -> None:
    with pytest.raises(ValueError, match="sequence"):
        project_events([
            {"id": "a", "seq": 1, "action": "upsert", "value": "old"},
            {"id": "a", "seq": 2, "action": "delete", "value": ""},
            {"id": "a", "seq": 1, "action": "upsert", "value": "stale"},
        ])


def test_unknown_action_rejected() -> None:
    with pytest.raises(ValueError, match="action"):
        project_events([{"id": "a", "seq": 1, "action": "replace", "value": "x"}])

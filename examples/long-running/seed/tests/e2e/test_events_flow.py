from src.events import Event, project_events


def test_rebuild_projection_after_replay() -> None:
    history: list[Event] = [
        {"id": "one", "seq": 1, "action": "upsert", "value": "draft"},
        {"id": "one", "seq": 2, "action": "upsert", "value": "final"},
        {"id": "two", "seq": 1, "action": "upsert", "value": "temporary"},
        {"id": "two", "seq": 2, "action": "delete", "value": ""},
    ]
    assert project_events(history + history[-1:]) == {"one": "final"}

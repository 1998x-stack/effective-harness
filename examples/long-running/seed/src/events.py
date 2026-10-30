from typing import TypedDict


class Event(TypedDict):
    id: str
    seq: int
    action: str
    value: str


def project_events(events: list[Event]) -> dict[str, str]:
    raise NotImplementedError

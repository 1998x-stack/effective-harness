from typing import TypedDict


class Job(TypedDict):
    id: str
    needs: list[str]
    units: int
    priority: int


def schedule(jobs: list[Job], capacity: int) -> list[list[str]]:
    raise NotImplementedError

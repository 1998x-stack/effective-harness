import pytest

from src.scheduler import Job, schedule


def test_priority_and_capacity() -> None:
    jobs: list[Job] = [
        {"id": "low", "needs": [], "units": 1, "priority": 1},
        {"id": "high", "needs": [], "units": 2, "priority": 9},
        {"id": "mid", "needs": [], "units": 1, "priority": 5},
    ]
    assert schedule(jobs, 2) == [["high"], ["mid", "low"]]


def test_dependencies_wait_until_next_wave() -> None:
    jobs: list[Job] = [
        {"id": "build", "needs": ["fetch"], "units": 1, "priority": 9},
        {"id": "fetch", "needs": [], "units": 1, "priority": 1},
        {"id": "publish", "needs": ["build"], "units": 1, "priority": 10},
    ]
    assert schedule(jobs, 3) == [["fetch"], ["build"], ["publish"]]


def test_invalid_graph_rejected() -> None:
    with pytest.raises(ValueError, match="cycle"):
        schedule([
            {"id": "a", "needs": ["b"], "units": 1, "priority": 1},
            {"id": "b", "needs": ["a"], "units": 1, "priority": 1},
        ], 2)
    with pytest.raises(ValueError, match="dependency"):
        schedule([{"id": "a", "needs": ["missing"], "units": 1, "priority": 1}], 2)


def test_invalid_resources_and_ids_rejected() -> None:
    job: Job = {"id": "a", "needs": [], "units": 3, "priority": 1}
    with pytest.raises(ValueError, match="capacity"):
        schedule([job], 2)
    with pytest.raises(ValueError, match="duplicate"):
        schedule([job, job], 3)
    with pytest.raises(ValueError, match="capacity"):
        schedule([job], 0)


def test_equal_priority_uses_id_and_skips_nonfitting_job() -> None:
    jobs: list[Job] = [
        {"id": "b", "needs": [], "units": 2, "priority": 5},
        {"id": "a", "needs": [], "units": 2, "priority": 5},
        {"id": "c", "needs": [], "units": 1, "priority": 4},
    ]
    assert schedule(jobs, 3) == [["a", "c"], ["b"]]

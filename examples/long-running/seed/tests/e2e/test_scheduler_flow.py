from src.scheduler import Job, schedule


def test_pipeline_execution_order() -> None:
    jobs: list[Job] = [
        {"id": "index", "needs": ["parse"], "units": 2, "priority": 8},
        {"id": "archive", "needs": ["parse"], "units": 1, "priority": 2},
        {"id": "parse", "needs": ["download"], "units": 1, "priority": 5},
        {"id": "download", "needs": [], "units": 1, "priority": 1},
    ]
    assert schedule(jobs, 2) == [["download"], ["parse"], ["index"], ["archive"]]

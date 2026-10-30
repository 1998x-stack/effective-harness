from pathlib import Path

from src.eventstore import SQLiteEventStore


def test_rebuild_projection_from_snapshot_after_restart(tmp_path: Path) -> None:
    path = tmp_path / "events.sqlite"
    store = SQLiteEventStore(path)
    store.append("account", 0, "e1", "credit", {"amount": "10"})
    store.append("account", 1, "e2", "credit", {"amount": "5"})
    store.save_snapshot("account", 2, {"balance": "15"})
    store.close()
    store = SQLiteEventStore(path)
    store.append("account", 2, "e3", "debit", {"amount": "3"})
    version, snapshot = store.load_snapshot("account") or (0, {"balance": "0"})
    balance = int(snapshot["balance"])
    for event in store.read("account", after_version=version):
        balance += int(event.payload["amount"]) * (1 if event.kind == "credit" else -1)
    assert balance == 12
    assert [event.sequence for event in store.read_all()] == [1, 2, 3]
    store.close()

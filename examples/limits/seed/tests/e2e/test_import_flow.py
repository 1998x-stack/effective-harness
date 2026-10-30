from pathlib import Path

from src.importer import Record, import_to_file, load_records


def test_repeated_import_replaces_snapshot_with_deduplicated_latest_rows(tmp_path: Path) -> None:
    output = tmp_path / "out" / "snapshot.json"
    first = "id,owner,amount,date\na,Old,1.00,2026-01-01\nb,Bob,2.00,2026-01-02\n"
    second = "id,owner,amount,date\na,Old,1.00,2026-01-01\nb,Bob,2.00,2026-01-02\na,New,3.00,2026-01-03\n"
    assert import_to_file(first, output).errors == ()
    assert import_to_file(second, output).errors == ()
    assert load_records(output) == (
        Record("a", "New", 300, "2026-01-03"),
        Record("b", "Bob", 200, "2026-01-02"),
    )

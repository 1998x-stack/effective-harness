import json
import os
from pathlib import Path

import pytest

from src.importer import Record, import_to_file, load_records, parse_csv


def test_header_order_extra_column_and_quoted_field() -> None:
    result = parse_csv('owner,unused,date,id,amount\n"Ada, Jr.",x,2026-10-30, ABC ,12.30\n')
    assert result.errors == ()
    assert result.records == (Record("abc", "Ada, Jr.", 1230, "2026-10-30"),)


def test_bom_unicode_id_and_whitespace_owner() -> None:
    result = parse_csv("\ufeffid,owner,amount,date\nＦＯＯ,  Ada\u00a0  Lovelace  ,0.01,2026-01-02\n")
    assert result.records == (Record("foo", "Ada Lovelace", 1, "2026-01-02"),)


@pytest.mark.parametrize("amount", ["1.234", "-1.00", "0", "1e3", "NaN", "", " 1.00 "])
def test_invalid_amounts_are_reported(amount: str) -> None:
    result = parse_csv(f"id,owner,amount,date\na,Ada,{amount},2026-01-02\n")
    assert result.records == ()
    assert result.errors and result.errors[0].startswith("line 2:")


@pytest.mark.parametrize("date", ["2026-02-30", "2026-1-2", "2026-13-01", "tomorrow"])
def test_invalid_dates_are_reported(date: str) -> None:
    result = parse_csv(f"id,owner,amount,date\na,Ada,1.00,{date}\n")
    assert result.records == ()
    assert result.errors and result.errors[0].startswith("line 2:")


def test_collect_errors_and_keep_valid_rows_in_input_order() -> None:
    result = parse_csv("id,owner,amount,date\na,Ada,1.00,2026-01-01\n,Blank,2.00,2026-01-02\nb,Bob,3.00,2026-01-03\n")
    assert [record.id for record in result.records] == ["a", "b"]
    assert len(result.errors) == 1
    assert result.errors[0].startswith("line 3:")


def test_duplicate_id_chooses_newest_date_and_keeps_first_position() -> None:
    text = "id,owner,amount,date\na,Old,1.00,2026-01-01\nb,Bob,2.00,2026-01-02\nA,New,3.00,2026-01-03\n"
    result = parse_csv(text)
    assert result.records == (
        Record("a", "New", 300, "2026-01-03"),
        Record("b", "Bob", 200, "2026-01-02"),
    )


def test_duplicate_same_date_chooses_later_row() -> None:
    result = parse_csv("id,owner,amount,date\na,First,1.00,2026-01-01\na,Second,2.00,2026-01-01\n")
    assert result.records == (Record("a", "Second", 200, "2026-01-01"),)


def test_missing_required_header_is_error() -> None:
    result = parse_csv("id,owner,date\na,Ada,2026-01-01\n")
    assert result.records == ()
    assert result.errors


def test_blank_owner_and_malformed_csv_row_are_errors() -> None:
    result = parse_csv("id,owner,amount,date\na,   ,1.00,2026-01-01\nb,Bob,2.00\n")
    assert result.records == ()
    assert len(result.errors) == 2


def test_import_to_file_does_not_replace_valid_output_on_errors(tmp_path: Path) -> None:
    output = tmp_path / "records.json"
    output.write_text("original", encoding="utf8")
    result = import_to_file("id,owner,amount,date\na,Ada,bad,2026-01-01\n", output)
    assert result.errors
    assert output.read_text(encoding="utf8") == "original"


def test_import_to_file_creates_parent_and_roundtrips(tmp_path: Path) -> None:
    output = tmp_path / "nested" / "records.json"
    text = "id,owner,amount,date\na,Ada,1.00,2026-01-01\nb,Bob,2.50,2026-01-02\n"
    result = import_to_file(text, output)
    assert result.errors == ()
    assert load_records(output) == result.records
    assert json.loads(output.read_text(encoding="utf8")) == [
        {"id": "a", "owner": "Ada", "amount_cents": 100, "date": "2026-01-01"},
        {"id": "b", "owner": "Bob", "amount_cents": 250, "date": "2026-01-02"},
    ]
    assert sorted(p.name for p in output.parent.iterdir()) == ["records.json"]


def test_failed_atomic_replace_preserves_previous_snapshot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    output = tmp_path / "records.json"
    output.write_text("previous", encoding="utf8")

    def interrupted_replace(source: str | Path, destination: str | Path) -> None:
        raise OSError("simulated replace failure")

    monkeypatch.setattr(os, "replace", interrupted_replace)
    with pytest.raises(OSError, match="simulated replace failure"):
        import_to_file("id,owner,amount,date\na,Ada,1.00,2026-01-01\n", output)
    assert output.read_text(encoding="utf8") == "previous"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["records.json"]


def test_load_records_missing_file(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_records(tmp_path / "missing.json")

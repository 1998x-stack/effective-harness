from src.records import normalize_record


def test_deduplicate_import_rows() -> None:
    rows = [" Alice  SMITH ", "alice smith", " BOB "]
    assert sorted({normalize_record(row) for row in rows}) == ["alice smith", "bob"]

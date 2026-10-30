import pytest

from src.records import normalize_record


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  Alice   SMITH  ", "alice smith"),
        ("\tMiXeD\nCase\t", "mixed case"),
        (" Café\u00a0AU LAIT ", "café au lait"),
    ],
)
def test_normalize_record(raw: str, expected: str) -> None:
    assert normalize_record(raw) == expected


def test_empty_record_rejected() -> None:
    with pytest.raises(ValueError, match="empty"):
        normalize_record(" \t\n ")

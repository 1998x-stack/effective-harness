from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Record:
    id: str
    owner: str
    amount_cents: int
    date: str


@dataclass(frozen=True, slots=True)
class ImportResult:
    records: tuple[Record, ...]
    errors: tuple[str, ...]


def parse_csv(text: str) -> ImportResult:
    raise NotImplementedError


def import_to_file(text: str, output_path: Path) -> ImportResult:
    raise NotImplementedError


def load_records(path: Path) -> tuple[Record, ...]:
    raise NotImplementedError

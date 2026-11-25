"""Amounts typed with a decimal comma are read whole everywhere (P0-1):
a spreadsheet cell like "1 234,56" or "1.234,56" is never cut down to a
smaller number or dropped as empty."""
import pytest

from services.import_service import _parse_float


@pytest.mark.parametrize("cell, expected", [
    ("12,50", 12.5),
    ("12.50", 12.5),
    ("1 234,56", 1234.56),
    ("1 234,56", 1234.56),
    ("1.234,56", 1234.56),
    ("1,234.56", 1234.56),
    ("12,50 лв.", 12.5),
    ("150,00 €", 150.0),
    (99, 99.0),
    (12.5, 12.5),
])
def test_cells_read_whole(cell, expected):
    assert _parse_float(cell) == pytest.approx(expected)


@pytest.mark.parametrize("cell", ["", "   ", None, "няма", "—"])
def test_unreadable_cells_are_empty(cell):
    assert _parse_float(cell) is None

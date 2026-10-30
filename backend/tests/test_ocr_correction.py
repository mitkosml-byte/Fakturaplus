"""Phase 5d: regression coverage for the OCR correction/normalization
pipeline (server.py's parse_amount/normalize_invoice_number/normalize_date/
correct_ocr_data), which previously had none.

This is NOT a full OCR accuracy eval against real scanned invoices - no
labeled sample images exist in this repo to build one honestly. What *is*
testable without the Anthropic API or any image is the deterministic
post-processing layer every AI extraction result passes through before it
reaches the invoice-creation form: VAT/total reconciliation, amount/date
parsing, and OCR letter-confusion fixes. These are exactly the kind of bugs
that silently corrupt a correct-looking scan (wrong VAT math, a European
"1.234,56" misread as 1.234, a date format the parser doesn't recognize),
so they're worth a real regression net even without the AI layer itself.

Module 1 audit finding #3 ("build the minimal OCR eval already flagged in
the cost-optimization work") - this is the deterministic half of that; the
AI-extraction-accuracy half needs real labeled invoice images to mean
anything and should be built once some exist (see TODO at the bottom).
"""
import asyncio

from server import correct_ocr_data, normalize_date, normalize_invoice_number, parse_amount


def test_parse_amount():
    assert parse_amount(None) == 0.0
    assert parse_amount(42) == 42.0
    assert parse_amount(42.5) == 42.5
    assert parse_amount("123.45") == 123.45
    # Bulgarian/European format: "." is the thousands separator, "," the
    # decimal one.
    assert parse_amount("1.234,56") == 1234.56
    # Plain decimal comma, no thousands separator.
    assert parse_amount("123,45") == 123.45
    assert parse_amount("not a number") == 0.0
    assert parse_amount("") == 0.0


def test_normalize_invoice_number():
    # Letter/digit OCR confusions (O/o -> 0, l/I -> 1) are fixed only
    # inside a segment that's ENTIRELY digits/confusable-letters - "O" in
    # "INV-O" is part of a mixed-letter run, so it's just upper-cased, not
    # corrected to "0"; the trailing standalone "l" is such an all-digit-
    # like segment, so that one does become "1".
    assert normalize_invoice_number("INV-O1l") == "INV-O11"
    assert normalize_invoice_number("inv-123") == "INV-123"
    assert normalize_invoice_number("") == ""
    assert normalize_invoice_number(None) is None


def test_normalize_date():
    assert normalize_date("2026-09-10") == "2026-09-10"
    assert normalize_date("10.09.2026") == "2026-09-10"
    assert normalize_date("10/09/2026") == "2026-09-10"
    assert normalize_date("10-09-2026") == "2026-09-10"
    assert normalize_date("not a date") is None
    assert normalize_date("") is None


def test_correct_ocr_data_computes_missing_vat():
    data = {
        "supplier": "Тест ЕООД",
        "invoice_number": "INV-1",
        "amount_without_vat": 100.0,
        "vat_amount": 0.0,
        "total_amount": 120.0,
    }
    result = asyncio.run(correct_ocr_data(data, company_id=None))
    assert result.corrected["vat_amount"] == 20.0
    assert any("ДДС изчислено" in c for c in result.corrections_made)


def test_correct_ocr_data_fixes_inconsistent_total():
    data = {
        "supplier": "Тест ЕООД",
        "invoice_number": "INV-2",
        "amount_without_vat": 100.0,
        "vat_amount": 20.0,
        "total_amount": 999.0,  # clearly wrong - should become 120.0
    }
    result = asyncio.run(correct_ocr_data(data, company_id=None))
    assert result.corrected["total_amount"] == 120.0
    assert any("Обща сума коригирана" in c for c in result.corrections_made)


def test_correct_ocr_data_leaves_zero_vat_invoice_alone():
    """A deliberately NOT-"corrected" case (see the comment above this
    check in correct_ocr_data): vat_amount == 0 and total_amount ==
    amount_without_vat is exactly the correct reading for a 0%-rate,
    VAT-exempt, or reverse-charge invoice - adding a fake 20% VAT here
    would corrupt a legitimately VAT-exempt purchase."""
    data = {
        "supplier": "Тест ЕООД",
        "invoice_number": "INV-3",
        "amount_without_vat": 100.0,
        "vat_amount": 0.0,
        "total_amount": 100.0,
    }
    result = asyncio.run(correct_ocr_data(data, company_id=None))
    assert result.corrected["vat_amount"] == 0.0
    assert result.corrected["total_amount"] == 100.0
    assert not any("ДДС" in c for c in result.corrections_made)


def test_correct_ocr_data_parses_string_amounts_and_date():
    data = {
        "supplier": "Тест ЕООД",
        "invoice_number": "INV-4",
        "invoice_date": "10.09.2026",
        "amount_without_vat": "1.234,56",
        "vat_amount": "246,91",
        "total_amount": "1.481,47",
    }
    result = asyncio.run(correct_ocr_data(data, company_id=None))
    assert result.corrected["amount_without_vat"] == 1234.56
    assert result.corrected["invoice_date"] == "2026-09-10"


def test_correct_ocr_data_normalizes_items():
    data = {
        "supplier": "Тест ЕООД",
        "invoice_number": "INV-5",
        "amount_without_vat": 10.0,
        "vat_amount": 2.0,
        "total_amount": 12.0,
        "items": [
            {"name": "  хляб  ", "quantity": "2", "unit_price": "5.00", "total_price": None, "unit": ""},
        ],
    }
    result = asyncio.run(correct_ocr_data(data, company_id=None))
    item = result.corrected["items"][0]
    assert item["quantity"] == 2.0
    assert item["unit_price"] == 5.0
    # total_price wasn't given, so it's computed from quantity * unit_price.
    assert item["total_price"] == 10.0
    # A blank unit defaults to "бр." (the common case: piece-counted goods).
    assert item["unit"] == "бр."


# TODO(Phase 5d follow-up): once real (anonymized) scanned invoices exist as
# fixtures, add an eval here that runs them through the real /ocr/scan
# extraction (anthropic_client.messages.parse) and scores field-level
# accuracy against hand-labeled expected output - the AI-extraction-accuracy
# half this file's docstring calls out as not yet buildable honestly.

"""Scan review check (P2 of the intelligence analysis): before an invoice
is saved, do its amounts add up, and which line most likely is wrong if
not. Generic invoices - three lines summing to a 116.00 EUR base."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import server
from services.invoice_check import check_invoice_draft

LINES = [
    {"name": "Брашно", "quantity": 50, "unit_price": 1.10, "printed_total": 55.00},
    {"name": "Олио", "quantity": 10, "unit_price": 3.20, "printed_total": 32.00},
    {"name": "Захар", "quantity": 20, "unit_price": 1.45, "printed_total": 29.00},
]


def _check(items, base=116.00, vat=23.20, total=139.20):
    return check_invoice_draft(base, vat, total, items)


def test_amounts_that_add_up_pass_quietly():
    result = _check(LINES)
    assert result["header"] is None and result["line_flags"] == []
    assert result["lines"]["ok"] is True and result["lines"]["sum"] == 116.0


def test_skipped_line_is_a_missing_amount():
    result = _check(LINES, base=141.80, vat=28.36, total=170.16)
    assert result["lines"]["cause"] == "missing_line"
    assert result["lines"]["difference"] == -25.8


def test_line_read_twice_is_found_and_removable():
    result = _check(LINES + [dict(LINES[1])])
    assert result["lines"]["cause"] == "duplicate_line"
    assert result["lines"]["remove_index"] == 3


def test_misplaced_decimal_point_is_found_with_its_fix():
    # 14.50 instead of 1.45, the line value read the same way (or not printed).
    misread = [LINES[0], LINES[1], {"name": "Захар", "quantity": 20, "unit_price": 14.50, "printed_total": 290.00}]
    result = _check(misread)
    assert result["lines"]["cause"] == "decimal_slip"
    assert result["lines"]["fixes"] == [{"index": 2, "unit_price": 1.45}]


def test_per_line_discount_uses_the_price_after_discount():
    # Prices printed before a 10% discount, line values after it.
    discounted = [
        {"name": "Брашно", "quantity": 50, "unit_price": 1.10, "printed_total": 49.50},
        {"name": "Олио", "quantity": 10, "unit_price": 3.20, "printed_total": 28.80},
        {"name": "Захар", "quantity": 20, "unit_price": 1.45, "printed_total": 26.10},
    ]
    result = _check(discounted, base=104.40, vat=20.88, total=125.28)
    assert result["lines"]["cause"] == "line_values"
    assert result["lines"]["fixes"] == [
        {"index": 0, "unit_price": 0.99}, {"index": 1, "unit_price": 2.88}, {"index": 2, "unit_price": 1.305},
    ]
    assert [flag["index"] for flag in result["line_flags"]] == [0, 1, 2]


def test_prices_read_with_vat_are_recognized():
    with_vat = [
        {"name": "Брашно", "quantity": 50, "unit_price": 1.32, "printed_total": 66.00},
        {"name": "Олио", "quantity": 10, "unit_price": 3.84, "printed_total": 38.40},
        {"name": "Захар", "quantity": 20, "unit_price": 1.74, "printed_total": 34.80},
    ]
    result = _check(with_vat)
    assert result["lines"]["cause"] == "vat_included" and result["lines"]["factor"] == 1.2
    assert [fix["unit_price"] for fix in result["lines"]["fixes"]] == [1.1, 3.2, 1.45]


def test_base_plus_vat_against_the_total():
    result = _check(LINES, total=193.20)
    assert result["header"] == {"expected_total": 139.2, "total_amount": 193.2, "difference": 54.0}


def test_line_whose_value_disagrees_offers_both_readings():
    result = check_invoice_draft(80.00, 16.00, 96.00, [{"name": "Питка", "quantity": 1, "unit_price": 0.20, "printed_total": 80.00}])
    flag = result["line_flags"][0]
    assert flag["kind"] == "line_value_mismatch" and flag["computed"] == 0.2 and flag["printed"] == 80.0
    assert flag["unit_price"] == 80.0 and flag["quantity"] == 400
    assert result["lines"]["cause"] == "line_values"


def test_draft_check_endpoint_needs_invoice_rights(client):
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    tokens = {}

    async def _users():
        for role, permissions in (("owner", ["manage_invoices"]), ("staff", ["add_revenue"])):
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            tokens[role] = uuid.uuid4().hex
            await server.db.users.insert_one({
                "user_id": user_id, "email": f"{user_id}@test.com", "name": role, "role": role,
                "company_id": company_id, "permissions": permissions, "auth_provider": "email",
                "has_password": True, "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION,
                "created_at": datetime.now(timezone.utc),
            })
            await server.db.user_sessions.insert_one({
                "user_id": user_id, "session_token": tokens[role],
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1), "created_at": datetime.now(timezone.utc),
            })

    asyncio.run(_users())
    payload = {"amount_without_vat": 116.0, "vat_amount": 23.2, "total_amount": 139.2, "items": LINES}
    r = client.post("/api/invoices/draft-check", json=payload, headers={"Authorization": f"Bearer {tokens['owner']}"})
    assert r.status_code == 200, r.text
    assert r.json()["lines"]["ok"] is True
    r = client.post("/api/invoices/draft-check", json=payload, headers={"Authorization": f"Bearer {tokens['staff']}"})
    assert r.status_code == 403


@pytest.mark.parametrize("items", [[], [{"name": "x", "quantity": 1, "unit_price": 5}]])
def test_nothing_to_compare_without_lines_or_base(items):
    result = check_invoice_draft(0, 0, 0, items)
    assert result["lines"] is None and result["header"] is None

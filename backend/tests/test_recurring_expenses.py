"""Recurring expenses (Д2): each month's payment is found, recorded or asked
about - and one cost is never counted twice, whether its invoice comes or
not."""
import asyncio
from datetime import date

import pytest

import server
from services import recurring_service as rs
from tests.test_whole_program_fixes import _company, _user

TODAY = date(2026, 11, 16)


@pytest.fixture
def today(monkeypatch):
    monkeypatch.setattr(rs, "current_day", lambda: TODAY)
    return TODAY


def _create(client, owner, **fields):
    body = {"description": "Наем", "amount": 800, "day_of_month": 5, **fields}
    r = client.post("/api/recurring-expenses", headers=owner, json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _starts(item_id, month="2026-11"):
    """As if saved (and set to record by itself) in an earlier month: this
    month's day already counts."""
    asyncio.run(server.db.recurring_expenses.update_one(
        {"id": item_id}, {"$set": {"start_month": month, "auto_record_since": f"{month}-01"}},
    ))


def _listing(client, owner):
    r = client.get("/api/recurring-expenses", headers=owner)
    assert r.status_code == 200, r.text
    body = r.json()
    return {item["id"]: item for item in body["recurring_expenses"]}, body


def _linked_expenses(company_id, item_id):
    return asyncio.run(server.db.expenses.find(
        {"company_id": company_id, "recurring_id": item_id}, {"_id": 0},
    ).to_list(None))


def _invoice(client, owner, number, total=960.0, supplier="Имоти ЕООД", eik="BG131071587", day="2026-11-10", line=None):
    body = {
        "supplier": supplier, "supplier_eik": eik, "invoice_number": number, "date": day,
        "amount_without_vat": round(total / 1.2, 2), "vat_amount": round(total - total / 1.2, 2), "total_amount": total,
        "payment_method": "bank_transfer",
    }
    if line:
        body["items"] = [{"name": line, "quantity": 1, "unit_price": round(total / 1.2, 2)}]
    r = client.post("/api/invoices", headers=owner, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _signals(client, headers, key):
    r = client.get("/api/proactive/signals", headers=headers)
    assert r.status_code == 200, r.text
    return [s for s in r.json()["signals"] if s["key"] == key]


def test_d2_an_invoice_for_a_month_recorded_without_one_replaces_the_record(client, today):
    """The owner's case: rent recorded by itself on its day, then the
    landlord's invoice arrives for the same month - it replaces the record
    (restorable), the month counts once, and rent is expected with an
    invoice from then on."""
    company_id, _, owner = _company()
    item_id = _create(client, owner, kind="no_invoice", auto_record=True,
                      supplier_name="Имоти ЕООД", supplier_eik="131071587")
    _starts(item_id)

    items, _ = _listing(client, owner)
    recorded = _linked_expenses(company_id, item_id)
    assert [(e["date"], e["amount"], e["recurring_month"]) for e in recorded] == [("2026-11-05", 800, "2026-11")]
    assert items[item_id]["current"]["state"] == rs.PAID_BY_EXPENSE
    # Upkeep runs again and again - still one record.
    _listing(client, owner)
    assert len(_linked_expenses(company_id, item_id)) == 1

    _invoice(client, owner, "0000000101")
    assert _linked_expenses(company_id, item_id) == []
    items, _ = _listing(client, owner)
    occurrence = items[item_id]["current"]
    assert occurrence["state"] == rs.PAID_BY_INVOICE and occurrence["paid_amount"] == 960
    assert items[item_id]["kind"] == rs.INVOICE and items[item_id]["auto_record"] is False
    # Counted once: the month's off-book expenses no longer hold the rent.
    summary = client.get("/api/statistics/summary?start_date=2026-11-01&end_date=2026-11-30", headers=owner).json()
    assert summary["total_non_invoice_expenses"] == 0

    notice = _signals(client, owner, "recurring_replaced")
    assert len(notice) == 1 and "0000000101" in notice[0]["detail"]

    # The record was kept whole: restored, it is a cost of its own.
    log = asyncio.run(server.db.audit_logs.find_one(
        {"company_id": company_id, "entity_type": "expense", "action": "delete"}, {"_id": 0},
    ))
    assert log["details"]["replaced_by_invoice"]["number"] == "0000000101"
    restored = client.post(f"/api/audit-logs/{log['id']}/restore", headers=owner)
    assert restored.status_code == 200, restored.text
    back = asyncio.run(server.db.expenses.find_one({"id": log["entity_id"]}, {"_id": 0}))
    assert back["recurring_id"] is None
    _listing(client, owner)
    assert asyncio.run(server.db.expenses.find_one({"id": log["entity_id"]}, {"_id": 0})) is not None


def test_d2_without_a_supplier_a_look_alike_invoice_is_a_question_not_a_second_cost(client, today):
    company_id, _, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    item_id = _create(client, owner, kind="no_invoice")
    _starts(item_id)

    # Asked on its day - never recorded by itself unless chosen.
    due = _signals(client, owner, "recurring_due")
    assert len(due) == 1 and due[0]["recurring_month"] == "2026-11"
    assert due[0]["actions"] == ["recurring_record", "recurring_skip"]
    assert _linked_expenses(company_id, item_id) == []
    assert _signals(client, cashier, "recurring_due") == []   # only for who keeps the budget

    r = client.post(f"/api/recurring-expenses/{item_id}/months/2026-11/record", headers=owner, json={})
    assert r.status_code == 200, r.text
    assert r.json()["expense"]["date"] == "2026-11-05"
    assert client.post(f"/api/recurring-expenses/{item_id}/months/2026-11/record", headers=owner, json={}).status_code == 409

    # The invoice names the rent and carries VAT on top of it.
    invoice = _invoice(client, owner, "0000000202", supplier="Друг Наемодател ООД", eik=None, line="Наем за ноември")
    assert len(_linked_expenses(company_id, item_id)) == 1   # not removed on a guess
    question = _signals(client, owner, "recurring_duplicate")
    assert len(question) == 1 and question[0]["match_id"] == invoice["id"]

    answer = client.post(f"/api/recurring-expenses/{item_id}/months/2026-11/match", headers=owner,
                         json={"source": "invoice", "id": invoice["id"], "same": True})
    assert answer.status_code == 200, answer.text
    assert answer.json()["occurrence"]["state"] == rs.PAID_BY_INVOICE
    assert _linked_expenses(company_id, item_id) == []
    items, _ = _listing(client, owner)
    assert items[item_id]["kind"] == rs.INVOICE and items[item_id]["supplier_name"] == "Друг Наемодател ООД"
    assert _signals(client, owner, "recurring_duplicate") == []


def test_d2_a_same_amount_entry_typed_by_hand_is_asked_about_not_recorded_again(client, today):
    company_id, _, owner = _company()
    item_id = _create(client, owner, kind="no_invoice", auto_record=True, description="Абонамент софтуер", amount=49.9)
    _starts(item_id)
    typed = client.post("/api/expenses", headers=owner, json={"description": "абонамент за софтуера", "amount": 49.9, "date": "2026-11-03"})
    assert typed.status_code == 200

    items, _ = _listing(client, owner)
    occurrence = items[item_id]["current"]
    assert occurrence["state"] == rs.PROBABLE and occurrence["match"]["id"] == typed.json()["id"]
    assert _linked_expenses(company_id, item_id) == []   # the guess blocks recording it by itself

    no = client.post(f"/api/recurring-expenses/{item_id}/months/2026-11/match", headers=owner,
                     json={"source": "expense", "id": typed.json()["id"], "same": False})
    assert no.status_code == 200
    # A different cost: now the month is recorded as usual, once.
    items, _ = _listing(client, owner)
    assert items[item_id]["current"]["state"] == rs.PAID_BY_EXPENSE
    assert len(_linked_expenses(company_id, item_id)) == 1


def test_d2_an_invoice_expense_is_never_recorded_and_is_awaited(client, today):
    company_id, _, owner = _company()
    bad = client.post("/api/recurring-expenses", headers=owner, json={
        "description": "Интернет", "amount": 30, "day_of_month": 2, "kind": "invoice",
    })
    assert bad.status_code == 400   # its supplier is how its invoice is recognised
    item_id = _create(client, owner, description="Интернет", amount=30, day_of_month=2, kind="invoice",
                      supplier_name="Телеком АД", auto_record=True)
    _starts(item_id)
    items, body = _listing(client, owner)
    assert items[item_id]["auto_record"] is False and _linked_expenses(company_id, item_id) == []
    assert items[item_id]["current"]["state"] == rs.INVOICE_MISSING   # 2nd + 5 days < 16th
    assert body["outlook"] == {"paid_so_far": 0.0, "month_total": 30.0, "still_expected": 30.0}
    assert len(_signals(client, owner, "recurring_invoice_missing")) == 1

    _invoice(client, owner, "T-1", total=31.2, supplier="ТЕЛЕКОМ АД", eik=None, day="2026-11-04")
    items, body = _listing(client, owner)
    assert items[item_id]["current"]["state"] == rs.PAID_BY_INVOICE
    assert body["outlook"]["month_total"] == 31.2 and body["outlook"]["still_expected"] == 0
    assert _signals(client, owner, "recurring_invoice_missing") == []


def test_d2_skip_and_deleting_a_record_mean_not_paid_that_month(client, today):
    company_id, _, owner = _company()
    item_id = _create(client, owner, kind="no_invoice", auto_record=True)
    _starts(item_id)
    _listing(client, owner)
    [record] = _linked_expenses(company_id, item_id)
    assert client.delete(f"/api/expenses/{record['id']}", headers=owner).status_code == 200
    items, _ = _listing(client, owner)
    assert items[item_id]["current"]["state"] == rs.SKIPPED and _linked_expenses(company_id, item_id) == []

    other = _create(client, owner, description="Охрана", amount=120, day_of_month=1, kind="no_invoice")
    _starts(other)
    assert client.post(f"/api/recurring-expenses/{other}/months/2026-11/skip", headers=owner).json()["occurrence"]["state"] == rs.SKIPPED
    assert _signals(client, owner, "recurring_due") == []
    back = client.post(f"/api/recurring-expenses/{other}/months/2026-11/unskip", headers=owner)
    assert back.json()["occurrence"]["state"] == rs.DUE
    assert client.post(f"/api/recurring-expenses/{other}/months/2026-13/skip", headers=owner).status_code == 400
    assert client.post(f"/api/recurring-expenses/{other}/months/2026-10/skip", headers=owner).status_code == 400


def test_d2_record_by_itself_starts_when_turned_on_never_backdates(client, today):
    company_id, _, owner = _company()
    item_id = _create(client, owner, kind="no_invoice")
    asyncio.run(server.db.recurring_expenses.update_one({"id": item_id}, {"$set": {"start_month": "2026-11"}}))
    r = client.put(f"/api/recurring-expenses/{item_id}", headers=owner, json={"auto_record": True})
    assert r.status_code == 200 and r.json()["recurring_expense"]["auto_record"] is True
    items, _ = _listing(client, owner)
    # The 5th went by before it was turned on: still a question, not a record.
    assert items[item_id]["current"]["state"] == rs.DUE and _linked_expenses(company_id, item_id) == []
    assert len(_signals(client, owner, "recurring_due")) == 1
    # With an invoice it never records anything, whatever was set before.
    r = client.put(f"/api/recurring-expenses/{item_id}", headers=owner, json={"kind": "invoice", "supplier_name": "Имоти ЕООД"})
    assert r.status_code == 200 and r.json()["recurring_expense"]["auto_record"] is False


def test_d2_a_new_recurring_expense_starts_with_its_next_day():
    assert rs.start_month_for(5, date(2026, 11, 16)) == "2026-12"
    assert rs.start_month_for(16, date(2026, 11, 16)) == "2026-11"
    assert rs.start_month_for(28, date(2026, 12, 29)) == "2027-01"


def test_d2_projection_takes_recurring_expenses_as_they_are_not_as_a_pace():
    """Rent paid on the 5th is no daily rate: a month's projection takes
    what was paid and what is still to come, the rest at its pace."""
    items = [
        {"id": "rent", "description": "Наем", "amount": 800, "day_of_month": 5, "kind": "no_invoice", "start_month": "2026-11"},
        {"id": "net", "description": "Интернет", "amount": 30, "day_of_month": 20, "kind": "invoice",
         "supplier_name": "Телеком АД", "start_month": "2026-11"},
        {"id": "guard", "description": "Охрана", "amount": 120, "day_of_month": 1, "kind": "no_invoice",
         "start_month": "2026-11", "skipped_months": ["2026-11"]},
    ]
    records = {"invoices": [], "expenses": [
        {"id": "e1", "description": "Наем", "amount": 800, "date": "2026-11-05", "recurring_id": "rent", "recurring_month": "2026-11"},
    ]}
    occurrences = rs.resolve_month(items, 2026, 11, records, today=TODAY)
    assert {k: v["state"] for k, v in occurrences.items()} == {"rent": rs.PAID_BY_EXPENSE, "net": rs.UPCOMING, "guard": rs.SKIPPED}
    assert rs.outlook(items, occurrences, TODAY, include_off_book=True) == {"paid_so_far": 800.0, "month_total": 830.0}
    # Who does not see off-book expenses sees only what comes with an invoice.
    assert rs.outlook(items, occurrences, TODAY, include_off_book=False) == {"paid_so_far": 0.0, "month_total": 30.0}
    assert rs.known_monthly_total(items, include_off_book=False) == 30.0


def test_d2_one_supplier_two_expenses_each_invoice_to_the_closest():
    items = [
        {"id": "rent", "description": "Наем", "amount": 800, "day_of_month": 5, "kind": "invoice",
         "supplier_eik": "131071587", "start_month": "2026-11"},
        {"id": "parking", "description": "Паркомясто", "amount": 50, "day_of_month": 5, "kind": "invoice",
         "supplier_eik": "131071587", "start_month": "2026-11"},
    ]
    records = {"expenses": [], "invoices": [
        {"id": "i1", "supplier": "Имоти ЕООД", "supplier_eik": "BG131071587", "total_amount": 960, "date": None},
        {"id": "i2", "supplier": "Имоти ЕООД", "supplier_eik": "131071587", "total_amount": 60, "date": None},
    ]}
    occurrences = rs.resolve_month(items, 2026, 11, records, today=TODAY)
    assert [i["id"] for i in occurrences["rent"]["invoices"]] == ["i1"]
    assert [i["id"] for i in occurrences["parking"]["invoices"]] == ["i2"]

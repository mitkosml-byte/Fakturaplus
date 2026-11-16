"""Payments to a supplier on an invoice by bank (Д8): each with its own
date, amount and method, kept as a history like what customers pay - a
payment of last week entered today is last week's; one entered by mistake
can be taken out again."""
from services.business_calendar import business_day, today_local
from tests.test_whole_program_fixes import _company

BASE = {"supplier": "Строй Депо ООД", "date": "2026-11-01", "amount_without_vat": 1000, "vat_amount": 200,
        "total_amount": 1200, "payment_method": "bank_transfer", "payment_due_date": "2026-11-30"}


def _invoice(client, owner, number="SD-1", **fields):
    r = client.post("/api/invoices", headers=owner, json={**BASE, "invoice_number": number, **fields})
    assert r.status_code == 200, r.text
    return r.json()


def test_d8_payments_keep_their_own_day_amount_and_method(client):
    _, _, owner = _company()
    invoice = _invoice(client, owner)
    first = client.post(f"/api/invoices/{invoice['id']}/payments", headers=owner,
                        json={"amount": 300, "date": "2026-11-03", "method": "bank_transfer"})
    assert first.status_code == 200, first.text
    body = first.json()
    assert (body["paid_amount"], body["is_paid"], body["paid_at"]) == (300, False, None)
    assert [(p["amount"], p["date"], p["method"]) for p in body["payments"]] == [(300, "2026-11-03", "bank_transfer")]

    assert client.post(f"/api/invoices/{invoice['id']}/payments", headers=owner, json={"amount": 901}).status_code == 400
    future = client.post(f"/api/invoices/{invoice['id']}/payments", headers=owner, json={"amount": 10, "date": "2099-01-01"})
    assert future.status_code == 400

    rest = client.post(f"/api/invoices/{invoice['id']}/payments", headers=owner,
                       json={"amount": 900, "date": "2026-11-10", "method": "card"}).json()
    assert rest["is_paid"] is True and len(rest["payments"]) == 2
    assert business_day(rest["paid_at"]).isoformat() == "2026-11-10"   # paid in full on the day it was

    # One entered by mistake goes again - and the invoice is owed again.
    mistake = rest["payments"][1]["id"]
    undone = client.delete(f"/api/invoices/{invoice['id']}/payments/{mistake}", headers=owner).json()
    assert (undone["paid_amount"], undone["is_paid"], undone["paid_at"]) == (300, False, None)
    assert client.delete(f"/api/invoices/{invoice['id']}/payments/{mistake}", headers=owner).status_code == 404

    # Paid on the spot: nothing to enter.
    cash = _invoice(client, owner, number="SD-2", payment_method="cash")
    assert client.post(f"/api/invoices/{cash['id']}/payments", headers=owner, json={"amount": 10}).status_code == 400


def test_d8_paid_in_one_go_still_leaves_a_history(client):
    _, _, owner = _company()
    today = today_local().isoformat()
    ticked = _invoice(client, owner)
    client.post(f"/api/invoices/{ticked['id']}/payments", headers=owner, json={"amount": 200, "date": "2026-11-02"})
    paid = client.put(f"/api/invoices/{ticked['id']}", headers=owner, json={"is_paid": True}).json()
    assert [(p["amount"], p["date"]) for p in paid["payments"]] == [(200, "2026-11-02"), (1000, today)]
    unticked = client.put(f"/api/invoices/{ticked['id']}", headers=owner, json={"is_paid": False}).json()
    assert (unticked["paid_amount"], unticked["payments"]) == (0, [])

    typed = _invoice(client, owner, number="SD-3")
    client.put(f"/api/invoices/{typed['id']}", headers=owner, json={"paid_amount": 300})
    more = client.put(f"/api/invoices/{typed['id']}", headers=owner, json={"paid_amount": 500}).json()
    assert [p["amount"] for p in more["payments"]] == [300, 200]

    bulk = _invoice(client, owner, number="SD-4")
    assert client.post("/api/invoices/mark-paid", headers=owner, json={"invoice_ids": [bulk["id"]]}).json()["updated"] == 1
    marked = client.get(f"/api/invoices/{bulk['id']}", headers=owner).json()
    assert marked["is_paid"] is True and [(p["amount"], p["date"]) for p in marked["payments"]] == [(1200, today)]


def test_d8_a_customer_payment_entered_by_mistake_goes_too(client):
    _, _, owner = _company()
    debt = client.post("/api/receivables", headers=owner, json={"customer_name": "Иван", "amount": 100}).json()
    paid = client.post(f"/api/receivables/{debt['id']}/payments", headers=owner,
                       json={"amount": 100, "date": "2026-11-05", "method": "cash"}).json()
    assert paid["is_paid"] is True
    undone = client.delete(f"/api/receivables/{debt['id']}/payments/{paid['payments'][0]['id']}", headers=owner).json()
    assert (undone["is_paid"], undone["paid_amount"], undone["left_amount"]) == (False, 0, 100)

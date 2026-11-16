"""A credit note names the invoice it corrects ("към фактура №", Д1): what
it takes off is no longer owed on that invoice; on an invoice already paid
it is the supplier's to refund or offset."""
import asyncio

import server
from tests.test_whole_program_fixes import _company


def _doc(number, total, *, supplier="Метро Кеш енд Кери ЕООД", eik="BG131071587", kind="invoice",
         method="bank_transfer", credited=None, day="2026-11-03"):
    body = {
        "supplier": supplier, "supplier_eik": eik, "invoice_number": number, "document_type": kind,
        "date": day, "amount_without_vat": round(total / 1.2, 2), "vat_amount": round(total - total / 1.2, 2),
        "total_amount": total, "payment_method": method,
    }
    if credited is not None:
        body["credited_invoice_number"] = credited
    return body


def _post(client, owner, body):
    r = client.post("/api/invoices", headers=owner, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _get(client, owner, invoice_id):
    return client.get(f"/api/invoices/{invoice_id}", headers=owner).json()


def _unpaid(client, owner):
    return client.get("/api/statistics/summary?start_date=2026-11-01&end_date=2026-11-30", headers=owner).json()["total_unpaid_amount"]


def test_d1_a_credit_note_takes_its_amount_off_what_is_owed_on_its_invoice(client):
    company_id, _, owner = _company()
    invoice = _post(client, owner, _doc("0000001200", 1200))
    assert _unpaid(client, owner) == 1200

    note = _post(client, owner, _doc("0000000077", 60, kind="credit_note", credited="1200", day="2026-11-05"))
    assert note["credited_invoice_id"] == invoice["id"] and note["credited_invoice_number"] == "1200"
    after = _get(client, owner, invoice["id"])
    assert after["credited_amount"] == 60 and after["is_paid"] is False
    assert _unpaid(client, owner) == 1140

    # Paying "in full" pays what is left; more than that is refused.
    too_much = client.put(f"/api/invoices/{invoice['id']}", headers=owner, json={"paid_amount": 1200})
    assert too_much.status_code == 400
    paid = client.put(f"/api/invoices/{invoice['id']}", headers=owner, json={"is_paid": True}).json()
    assert paid["paid_amount"] == 1140 and paid["is_paid"] is True
    assert _unpaid(client, owner) == 0

    # The credit note deleted: owed again what it took off.
    client.put(f"/api/invoices/{invoice['id']}", headers=owner, json={"is_paid": False})
    assert client.delete(f"/api/invoices/{note['id']}", headers=owner).status_code == 200
    assert _get(client, owner, invoice["id"])["credited_amount"] == 0
    assert _unpaid(client, owner) == 1200

    # Put back from the action log: it takes its amount off again.
    log = asyncio.run(server.db.audit_logs.find_one(
        {"company_id": company_id, "entity_type": "invoice", "action": "delete", "entity_id": note["id"]}, {"_id": 0},
    ))
    assert client.post(f"/api/audit-logs/{log['id']}/restore", headers=owner).status_code == 200
    assert _get(client, owner, invoice["id"])["credited_amount"] == 60
    assert _unpaid(client, owner) == 1140


def test_d1_a_credit_note_for_the_whole_balance_settles_the_invoice(client):
    company_id, _, owner = _company()
    invoice = _post(client, owner, _doc("555", 300))
    client.put(f"/api/invoices/{invoice['id']}", headers=owner, json={"paid_amount": 200})
    _post(client, owner, _doc("CN-1", 100, kind="credit_note", credited="555"))
    settled = _get(client, owner, invoice["id"])
    assert settled["is_paid"] is True and settled["paid_amount"] == 200 and settled["credited_amount"] == 100
    assert server.invoice_left(settled) == 0 and server.invoice_refund_due(settled) == 0


def test_d1_on_a_paid_invoice_the_credit_is_owed_back(client):
    company_id, _, owner = _company()
    invoice = _post(client, owner, _doc("888", 500, method="cash"))
    _post(client, owner, _doc("CN-9", 50, kind="credit_note", credited="888"))
    after = _get(client, owner, invoice["id"])
    assert after["is_paid"] is True and after["credited_amount"] == 50
    assert server.invoice_refund_due(after) == 50


def test_d1_a_credit_note_entered_first_is_tied_when_its_invoice_comes(client):
    company_id, _, owner = _company()
    note = _post(client, owner, _doc("CN-2", 40, kind="credit_note", credited="0000000999"))
    assert note["credited_invoice_id"] is None
    # Same number from another supplier: not its invoice.
    other = _post(client, owner, _doc("999", 400, supplier="Друг Доставчик ООД", eik="BG200000001"))
    assert _get(client, owner, other["id"])["credited_amount"] == 0
    invoice = _post(client, owner, _doc("999", 400))
    assert _get(client, owner, invoice["id"])["credited_amount"] == 40
    stored = asyncio.run(server.db.invoices.find_one({"id": note["id"]}, {"_id": 0}))
    assert stored["credited_invoice_id"] == invoice["id"]

    # The number corrected on the credit note moves the credit with it.
    moved = client.put(f"/api/invoices/{note['id']}", headers=owner, json={"credited_invoice_number": "nope"})
    assert moved.status_code == 200 and moved.json()["credited_invoice_id"] is None
    assert _get(client, owner, invoice["id"])["credited_amount"] == 0

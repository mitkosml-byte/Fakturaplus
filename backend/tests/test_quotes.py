"""Quotes (Д9): valid until a date, open / accepted / declined, and made into
a bill or an invoice with one step - the quote is then accepted and knows
the document made of it; one quote, one document."""
from datetime import date, timedelta

from tests.test_whole_program_fixes import _company

ITEMS = [{"name": "Ремонт на покрив", "quantity": 1, "unit_price": 1500}]


def _quote(client, owner, **fields):
    r = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "quote", "customer_name": "Петър Петров", "issue_date": "2026-11-02", "items": ITEMS, **fields,
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_d9_a_quote_has_a_term_and_an_answer(client):
    _, _, owner = _company()
    quote = _quote(client, owner)
    assert quote["quote_status"] == "open"
    assert quote["valid_until"] == (date(2026, 11, 2) + timedelta(days=30)).isoformat()
    assert _quote(client, owner, valid_until="2026-11-20")["valid_until"] == "2026-11-20"
    bad = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "quote", "customer_name": "Х", "issue_date": "2026-11-02", "items": ITEMS, "valid_until": "2026-10-01",
    })
    assert bad.status_code == 400

    declined = client.put(f"/api/billing-documents/{quote['id']}/quote-status", headers=owner, json={"status": "declined"})
    assert declined.status_code == 200 and declined.json()["quote_status"] == "declined"
    assert client.put(f"/api/billing-documents/{quote['id']}/quote-status", headers=owner,
                      json={"status": "maybe"}).status_code == 422


def test_d9_a_quote_made_into_a_bill_or_an_invoice(client):
    _, _, owner = _company()
    quote = _quote(client, owner)
    bill = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "bill", "customer_name": quote["customer_name"], "items": ITEMS, "from_quote_id": quote["id"],
    })
    assert bill.status_code == 200, bill.text
    assert bill.json()["source_quote_id"] == quote["id"] and bill.json()["receivable_id"]
    listed = next(d for d in client.get("/api/billing-documents", headers=owner).json() if d["id"] == quote["id"])
    assert listed["quote_status"] == "accepted" and listed["converted_document_id"] == bill.json()["id"]

    # One quote, one document - and a quote made into one stays accepted.
    again = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "bill", "customer_name": quote["customer_name"], "items": ITEMS, "from_quote_id": quote["id"],
    })
    assert again.status_code == 409
    assert client.put(f"/api/billing-documents/{quote['id']}/quote-status", headers=owner,
                      json={"status": "declined"}).status_code == 409

    # The bill deleted (nothing paid), the quote can become an invoice instead.
    client.delete(f"/api/billing-documents/{bill.json()['id']}", headers=owner)
    invoice = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": quote["customer_name"], "customer_eik": "131071587",
        "items": [{**ITEMS[0], "unit_price": 1250, "vat_rate": 20}], "payment_method": "bank_transfer",
        "from_quote_id": quote["id"],
    })
    assert invoice.status_code == 200, invoice.text
    assert invoice.json()["source_quote_id"] == quote["id"] and invoice.json()["total_amount"] == 1500
    listed = next(d for d in client.get("/api/billing-documents", headers=owner).json() if d["id"] == quote["id"])
    assert listed["converted_document_id"] == invoice.json()["id"]

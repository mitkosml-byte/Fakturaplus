"""Customers (Д5): what an invoice names (EIK, VAT number, address) is kept
with the customer, remembered from the documents themselves, one customer
per EIK, and one card with what they were invoiced and owe."""
import asyncio

import server
from tests.test_whole_program_fixes import _company


def _issue(client, owner, **fields):
    body = {
        "doc_type": "invoice", "customer_name": "Гама Трейд ООД", "customer_eik": "131071587",
        "customer_address": "гр. Варна, ул. Морска 1", "issue_date": "2026-10-10", "payment_method": "bank_transfer",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 100, "vat_rate": 20}], **fields,
    }
    r = client.post("/api/billing-documents", headers=owner, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_d5_a_customer_is_remembered_from_the_invoice_and_picked_next_time(client):
    _, _, owner = _company()
    first = _issue(client, owner)
    [customer] = client.get("/api/customers", headers=owner).json()
    assert first["customer_id"] == customer["id"]
    assert (customer["name"], customer["eik"], customer["address"]) == ("Гама Трейд ООД", "131071587", "гр. Варна, ул. Морска 1")

    # The same EIK under another spelling is the same customer; a bill by name too.
    again = _issue(client, owner, customer_name="ГАМА ТРЕЙД", customer_address=None)
    assert again["customer_id"] == customer["id"]
    bill = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "bill", "customer_name": "гама трейд ООД", "items": [{"name": "Обяд", "quantity": 1, "unit_price": 20}],
    }).json()
    assert bill["customer_id"] == customer["id"]
    # Same name, another EIK: another business.
    other = _issue(client, owner, customer_eik="200000001")
    assert other["customer_id"] != customer["id"]
    assert len(client.get("/api/customers", headers=owner).json()) == 2

    # Picked from the list: tied to it, and what it lacked is filled in.
    plain = client.post("/api/customers", headers=owner, json={"name": "Делта ЕТ"}).json()
    picked = _issue(client, owner, customer_id=plain["id"], customer_name="Делта ЕТ", customer_eik="121212121")
    assert picked["customer_id"] == plain["id"]
    refreshed = next(c for c in client.get("/api/customers", headers=owner).json() if c["id"] == plain["id"])
    assert refreshed["eik"] == "121212121"


def test_d5_one_customer_per_eik(client):
    _, _, owner = _company()
    first = client.post("/api/customers", headers=owner, json={"name": "Омега АД", "eik": "BG131071587", "email": "a@b.bg"})
    assert first.status_code == 200 and first.json()["eik"] == "BG131071587"
    dup = client.post("/api/customers", headers=owner, json={"name": "Омега", "eik": "131071587"})
    assert dup.status_code == 409 and "Омега АД" in dup.json()["detail"]
    second = client.post("/api/customers", headers=owner, json={"name": "Сигма ООД"}).json()
    assert client.put(f"/api/customers/{second['id']}", headers=owner, json={"eik": "131071587"}).status_code == 409
    cleared = client.put(f"/api/customers/{first.json()['id']}", headers=owner, json={"email": "  "}).json()
    assert cleared["email"] is None and cleared["name"] == "Омега АД"


def test_d5_the_customer_card_shows_invoiced_owed_and_overdue(client):
    _, _, owner = _company()
    paid_at_issue = _issue(client, owner, payment_method="card", in_till=False, issue_date="2026-09-01")
    owed = _issue(client, owner, issue_date="2026-10-01", due_date="2026-10-15")
    cancelled = _issue(client, owner, issue_date="2026-10-02")
    _issue(client, owner, issue_date="2026-10-03")   # the last: deleting the one before cancels it
    assert client.delete(f"/api/billing-documents/{cancelled['id']}", headers=owner).json()["cancelled"] is True
    debt = client.post("/api/receivables", headers=owner, json={"customer_name": "гама трейд оод", "amount": 50, "due_date": "2099-01-01"}).json()
    customer_id = paid_at_issue["customer_id"]
    assert debt["customer_id"] == customer_id

    card = client.get(f"/api/customers/{customer_id}/card", headers=owner).json()
    totals = card["totals"]
    assert totals["invoice_count"] == 3 and totals["invoiced"] == 360
    assert totals["last_invoice_date"] == "2026-10-03"
    # Two invoices by bank (both past their due dates) and the debt (not yet due).
    assert totals["owed"] == 290 and totals["overdue"] == 240
    assert [d["issue_date"] for d in card["documents"]][:2] == ["2026-10-03", "2026-10-02"]
    assert any(r["overdue"] for r in card["open_receivables"]) and len(card["open_receivables"]) == 3
    assert owed["receivable_id"] in {r["id"] for r in card["open_receivables"]}

    # Deleted, the customer's documents stay under the name issued to.
    assert client.delete(f"/api/customers/{customer_id}", headers=owner).status_code == 200
    kept = asyncio.run(server.db.billing_documents.find_one({"id": owed["id"]}, {"_id": 0}))
    assert kept["customer_id"] is None and kept["customer_name"] == "Гама Трейд ООД"


def test_e1_issuing_invoices_is_its_own_right_and_only_the_owner_or_manager_cancels(client):
    from tests.test_whole_program_fixes import _user
    company_id, _, owner = _company()
    cashier_id, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    clerk_id, clerk = _user(company_id, "staff", ["issue_invoices"], "Фактуриста")
    invoice = {
        "doc_type": "invoice", "customer_name": "Клиент ООД", "payment_method": "bank_transfer",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 100}],
    }
    # Entering revenue no longer issues invoices; bills still go with it.
    assert client.post("/api/billing-documents", headers=cashier, json=invoice).status_code == 403
    bill = {"doc_type": "bill", "customer_name": "Клиент ООД", "items": [{"name": "Обяд", "quantity": 1, "unit_price": 20}]}
    assert client.post("/api/billing-documents", headers=cashier, json=bill).status_code == 200

    issued = client.post("/api/billing-documents", headers=clerk, json=invoice)
    assert issued.status_code == 200, issued.text
    assert client.get("/api/billing-documents", headers=clerk).status_code == 200
    assert client.get("/api/customers", headers=clerk).status_code == 200
    # Cancelling (or deleting) an issued invoice: owner or manager only.
    refused = client.delete(f"/api/billing-documents/{issued.json()['id']}", headers=clerk)
    assert refused.status_code == 403
    external = client.post("/api/billing-documents", headers=clerk, json={**invoice, "external": True, "invoice_number": "900"}).json()
    assert client.delete(f"/api/billing-documents/{external['id']}", headers=clerk).status_code == 200
    assert client.delete(f"/api/billing-documents/{issued.json()['id']}", headers=owner).status_code == 200

    # Someone who issued invoices before the right existed keeps it.
    asyncio.run(server.db.users.update_one({"user_id": cashier_id}, {"$set": {"permissions_schema_version": 6}}))
    assert client.post("/api/billing-documents", headers=cashier, json=invoice).status_code == 200

"""A credit note to a customer (Д7): on an invoice issued to them, numbered
in the invoice sequence, its amounts below zero - revenue and VAT less on
its own date (the invoice's month stays as it was) - and what it credits off
what is owed on the invoice; on a paid invoice, that much is to give back.
Cancelled, it takes nothing off any more."""
import asyncio
import io

import openpyxl  # type: ignore[import-untyped]

import server
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company

OCTOBER = "start_date=2026-10-01&end_date=2026-10-31"
NOVEMBER = "start_date=2026-11-01&end_date=2026-11-30"


def _credit(client, owner, invoice, amount=50, **fields):
    body = {
        "doc_type": "credit_note", "credited_document_id": invoice["id"], "customer_name": invoice["customer_name"],
        "issue_date": "2026-11-05", "notes": "Отстъпка за забавена доставка",
        "items": [{"name": "Отстъпка", "quantity": 1, "unit_price": amount, "vat_rate": 20}], **fields,
    }
    return client.post("/api/billing-documents", headers=owner, json=body)


def _doc(client, owner, doc_id):
    return next(d for d in client.get("/api/billing-documents", headers=owner).json() if d["id"] == doc_id)


def test_d7_a_credit_note_takes_revenue_vat_and_what_is_owed_off(client):
    _, _, owner = _company()
    invoice = _issue(client, owner, issue_date="2026-10-10", due_date="2099-12-31")
    october_before = client.get(f"/api/statistics/summary?{OCTOBER}", headers=owner).json()

    made = _credit(client, owner, invoice)
    assert made.status_code == 200, made.text
    note = made.json()
    assert note["invoice_number"] == str(int(invoice["invoice_number"]) + 1).zfill(10)   # the same sequence
    assert (note["total_amount"], note["vat_amount"], note["amount_without_vat"]) == (-60, -10, -50)
    assert note["customer_eik"] == invoice["customer_eik"] and note["credited_invoice_number"] == invoice["invoice_number"]

    # Its own date: November has 60 € (and 10 € VAT) less; October is as it was.
    november = client.get(f"/api/statistics/summary?{NOVEMBER}", headers=owner).json()
    assert november["total_issued_invoices"] == -60 and november["issued_invoice_vat"] == -10
    assert november["issued_invoice_count"] == 0
    october = client.get(f"/api/statistics/summary?{OCTOBER}", headers=owner).json()
    assert october["total_issued_invoices"] == october_before["total_issued_invoices"] == 120

    # What is owed on the invoice: 60 € less.
    listed = _doc(client, owner, invoice["id"])
    assert listed["credited_amount"] == 60 and listed["amount_left"] == 60 and listed["payment_status"] == "owed"
    assert client.get("/api/receivables/summary", headers=owner).json()["total_owed"] == 60
    card = client.get(f"/api/customers/{invoice['customer_id']}/card", headers=owner).json()
    assert card["totals"]["invoiced"] == 60 and card["totals"]["invoice_count"] == 1

    # No more than is left; never before the invoice; always with its reason.
    too_much = _credit(client, owner, invoice, amount=60)
    assert too_much.status_code == 400 and "60,00" in too_much.json()["detail"]
    assert _credit(client, owner, invoice, issue_date="2026-10-01").status_code == 400
    assert _credit(client, owner, invoice, notes="  ").status_code == 400
    # The invoice cannot be cancelled while a credit note to it stands.
    assert client.delete(f"/api/billing-documents/{invoice['id']}", headers=owner).status_code == 409

    # The sales ledger lists it as code 03, below zero; its PDF says what it is.
    issued = asyncio.run(server.db.billing_documents.find(
        {"id": {"$in": [invoice["id"], note["id"]]}}, {"_id": 0},
    ).to_list(None))
    data = server.ExportService.generate_vat_ledger_excel(purchases=[], sales=[], issued_invoices=issued)
    sheet = openpyxl.load_workbook(io.BytesIO(data))["Дневник продажби"]
    rows = [[c.value for c in r] for r in sheet.iter_rows() if isinstance(r[0].value, int)]
    credit_row = next(r for r in rows if r[2] == "Кредитно известие (03)")
    assert credit_row[6:8] == [-50, -10] and credit_row[-1] == -60
    pdf = client.get(f"/api/billing-documents/{note['id']}/pdf", headers=owner)
    assert pdf.status_code == 200 and "kreditno_izvestie" in pdf.headers["content-disposition"]

    # Taken back (the last number: deleted), the invoice is owed in full again.
    assert client.delete(f"/api/billing-documents/{note['id']}", headers=owner).status_code == 200
    listed = _doc(client, owner, invoice["id"])
    assert listed["credited_amount"] == 0 and listed["amount_left"] == 120
    assert client.get(f"/api/statistics/summary?{NOVEMBER}", headers=owner).json()["total_issued_invoices"] == 0


def test_d7_credited_after_payment_is_to_give_back_and_a_cancelled_one_restores(client):
    _, _, owner = _company()
    invoice = _issue(client, owner, issue_date="2026-10-10", due_date="2099-12-31")
    client.post(f"/api/receivables/{invoice['receivable_id']}/payments", headers=owner,
                json={"amount": 120, "date": "2026-10-20", "method": "bank_transfer"})
    note = _credit(client, owner, invoice).json()
    receivable = next(r for r in client.get("/api/receivables", headers=owner).json() if r["id"] == invoice["receivable_id"])
    assert (receivable["left_amount"], receivable["refund_due"], receivable["is_paid"]) == (0, 60, True)
    assert _doc(client, owner, invoice["id"])["refund_due"] == 60

    # Not the last number any more: cancelled, not deleted - and it takes nothing off.
    _issue(client, owner, issue_date="2026-11-06", due_date="2099-12-31")
    gone = client.delete(f"/api/billing-documents/{note['id']}", headers=owner).json()
    assert gone["cancelled"] is True
    receivable = next(r for r in client.get("/api/receivables", headers=owner).json() if r["id"] == invoice["receivable_id"])
    assert (receivable["left_amount"], receivable["refund_due"], receivable["credited_amount"]) == (0, 0, 0)
    assert client.get(f"/api/statistics/summary?{NOVEMBER}", headers=owner).json()["total_issued_invoices"] == 120

    # A settled-by-credit invoice: owed nothing, paid nothing.
    other = _issue(client, owner, issue_date="2026-11-07", due_date="2099-12-31")
    _credit(client, owner, other, amount=100, issue_date="2026-11-08")
    assert _doc(client, owner, other["id"])["payment_status"] == "credited"

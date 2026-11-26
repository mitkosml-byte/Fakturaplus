"""Issued invoices and the till (Д4): an invoice paid in cash or by card
went through the till, so its money is in the day's till revenue already -
never counted twice; an invoice issued in another program is entered as an
issued invoice with its own number, never as till revenue."""
import asyncio
import io
from datetime import timedelta

import openpyxl  # type: ignore[import-untyped]

import server
from services.business_calendar import Period, today_local
from tests.test_whole_program_fixes import _company

OCTOBER = "start_date=2026-10-01&end_date=2026-10-31"
# A recent day (the till counts as kept when entered in the last 90 days).
RECENT = today_local() - timedelta(days=3)
RECENT_MONTH = Period.month_of(RECENT)


def _issue(client, owner, **fields):
    body = {
        "doc_type": "invoice", "customer_name": "Клиент ООД", "issue_date": "2026-10-10", "payment_method": "cash",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 200, "vat_rate": 20}], **fields,
    }
    r = client.post("/api/billing-documents", headers=owner, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _summary(client, owner):
    return client.get(f"/api/statistics/summary?{OCTOBER}", headers=owner).json()


def test_d4_an_invoice_paid_at_the_till_is_not_counted_twice(client):
    _, _, owner = _company()
    day = RECENT.isoformat()
    period = f"start_date={RECENT_MONTH.start_text}&end_date={RECENT_MONTH.end_text}"
    client.post("/api/daily-revenue", headers=owner, json={"date": day, "fiscal_revenue": 1000, "vat_rate_percent": 20})
    assert client.get("/api/billing-documents/invoice-defaults", headers=owner).json()["logs_till"] is True

    at_till = _issue(client, owner, issue_date=day)
    assert at_till["in_till"] is True
    summary = client.get(f"/api/statistics/summary?{period}", headers=owner).json()
    # Once - the till's 1000 €, without its VAT (P1-1).
    assert summary["total_income"] == round(1000 / 1.2, 2) and summary["total_issued_invoices"] == 0
    assert summary["fiscal_vat"] + summary["issued_invoice_vat"] == round(1000 * 20 / 120, 2)

    # Said otherwise (not rung up at the till), and by bank: income of their own.
    _issue(client, owner, in_till=False, issue_date=day)
    _issue(client, owner, payment_method="bank_transfer", issue_date=day)
    summary = client.get(f"/api/statistics/summary?{period}", headers=owner).json()
    assert summary["total_issued_invoices"] == 480 and summary["total_income"] == round(1000 / 1.2 + 400, 2)

    # The sales ledger lists every invoice and the till's day without them.
    issued = asyncio.run(server.db.billing_documents.find({"id": at_till["id"]}, {"_id": 0}).to_list(None))
    data = server.ExportService.generate_vat_ledger_excel(
        purchases=[], sales=[{"date": day, "fiscal_revenue": 1000, "vat_rate_percent": 20}], issued_invoices=issued,
    )
    sheet = openpyxl.load_workbook(io.BytesIO(data))["Дневник продажби"]
    rows = [[c.value for c in row] for row in sheet.iter_rows() if isinstance(row[0].value, int)]
    till, invoice = rows
    assert till[2] == "Отчет за извършени продажби (81) - без фактурираното" and till[-1] == 760
    assert invoice[6:8] == [200, 40] and invoice[-1] == 240
    assert round(till[7] + invoice[7], 2) == round(1000 - 1000 / 1.2, 2)   # the day's VAT, once


def test_d4_without_a_till_a_cash_invoice_is_the_income(client):
    _, _, owner = _company()
    assert client.get("/api/billing-documents/invoice-defaults", headers=owner).json()["logs_till"] is False
    assert _issue(client, owner)["in_till"] is False
    assert _summary(client, owner)["total_issued_invoices"] == 240


def test_d4_an_invoice_from_another_program_keeps_its_number(client):
    _, _, owner = _company()
    external = _issue(client, owner, external=True, invoice_number="0000000123", payment_method="bank_transfer",
                      customer_eik="131071587")
    assert external["external"] is True and external["invoice_number"] == "0000000123"
    assert _summary(client, owner)["total_issued_invoices"] == 240
    again = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Клиент ООД", "external": True, "invoice_number": "123",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 200}],
    })
    assert again.status_code == 409 and "въведена" in again.json()["detail"]
    no_number = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Клиент ООД", "external": True,
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 200}],
    })
    assert no_number.status_code == 400
    assert client.get(f"/api/billing-documents/{external['id']}/pdf", headers=owner).status_code == 400

    # The numbering continues after it; the record of it can simply go.
    ours = _issue(client, owner, payment_method="bank_transfer")
    assert ours["invoice_number"] == "0000000124"
    gone = client.delete(f"/api/billing-documents/{external['id']}", headers=owner).json()
    assert gone["cancelled"] is False


def test_d4_till_paid_invoices_from_before_are_marked_once(client):
    company_id, _, owner = _company()
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-10-10", "fiscal_revenue": 500})
    invoice = _issue(client, owner, in_till=False)
    asyncio.run(server.db.billing_documents.update_one({"id": invoice["id"]}, {"$unset": {"in_till": ""}}))
    asyncio.run(server.db.data_migrations.delete_one({"_id": "issued_invoices_in_till_v1"}))
    result = asyncio.run(server.mark_till_paid_invoices())
    assert result["marked"] >= 1
    stored = asyncio.run(server.db.billing_documents.find_one({"id": invoice["id"]}, {"_id": 0}))
    assert stored["in_till"] is True
    assert asyncio.run(server.mark_till_paid_invoices()) == {"skipped": True}

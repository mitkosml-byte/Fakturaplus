"""The VAT a business owes, on Home: the period's VAT to pay - the same
number as the statistics, the cash flow and the assistant, with the VAT of
the invoices issued to customers - the day a month's VAT is paid by, where
a running month is heading, and last month's VAT until its 14th.

Invented business, customers and numbers."""
import asyncio
from datetime import date

import server
from services import vat as vs
from services.business_calendar import Period
from tests.test_whole_program_fixes import _company, _user

NOVEMBER = {"start_date": "2026-11-01", "end_date": "2026-11-30"}


def test_the_vat_worked_out():
    assert vs.calendar_month(Period(date(2026, 11, 1), date(2026, 11, 30))) == (2026, 11)
    assert vs.calendar_month(Period(date(2026, 11, 1), date(2026, 11, 21))) is None
    assert vs.calendar_month(Period(date(2026, 1, 1), date(2026, 12, 31))) is None
    assert vs.pay_by(2026, 11) == date(2026, 12, 14) and vs.pay_by(2026, 12) == date(2027, 1, 14)
    # 10 days of takings with 200 € VAT each, for 30 open days; 600 € of
    # purchase VAT in 21 days; 100 € on invoices issued and a fixed asset's 200 € - as they are.
    assert vs.expected_due(2000, 100, 600, 200, revenue_days=10, open_days=30, open_days_so_far=21) == round(
        6000 + 100 - 600 / 21 * 30 - 200, 2)
    # Too early in the month to tell.
    assert vs.expected_due(2000, 0, 600, 0, revenue_days=4, open_days=30, open_days_so_far=4) is None
    assert vs.expected_due(400, 0, 0, 0, revenue_days=2, open_days=30, open_days_so_far=9) is None


def _today(monkeypatch, day):
    monkeypatch.setattr(server, "today_local", lambda: day)


def _seed(client, owner, company_id, owner_id):
    """October: 5 days of 600 € at the till (100 € VAT each) and 150 € of
    purchase VAT. November: 10 days of 1 200 € (200 € VAT each), goods with
    600 € VAT, a fridge (a fixed asset) with 200 €, and an invoice of 500 €
    + 100 € VAT issued to a customer on the 12th."""
    for day in range(1, 6):
        client.post("/api/daily-revenue", headers=owner, json={"date": f"2026-10-{day:02d}", "fiscal_revenue": 600, "vat_rate_percent": 20})
    client.post("/api/invoices", headers=owner, json={
        "supplier": "Склад Проба", "invoice_number": "G-10", "date": "2026-10-15",
        "amount_without_vat": 750, "vat_amount": 150, "total_amount": 900, "payment_method": "cash"})
    for day in range(1, 11):
        client.post("/api/daily-revenue", headers=owner, json={"date": f"2026-11-{day:02d}", "fiscal_revenue": 1200, "vat_rate_percent": 20})
    client.post("/api/invoices", headers=owner, json={
        "supplier": "Склад Проба", "invoice_number": "G-11", "date": "2026-11-10",
        "amount_without_vat": 3000, "vat_amount": 600, "total_amount": 3600, "payment_method": "cash"})
    asyncio.run(server.db.invoices.insert_one({
        "id": f"fridge-{company_id}", "company_id": company_id, "user_id": owner_id, "supplier": "Хладилна Техника Проба",
        "invoice_number": "F-1", "date": server.day_start_utc(date(2026, 11, 3)), "amount_without_vat": 1000.0,
        "vat_amount": 200.0, "total_amount": 1200.0, "payment_method": "bank_transfer", "is_paid": True, "asset_id": "asset-1",
    }))
    issued = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Клиент Проба ООД", "customer_eik": "000000017", "customer_address": "гр. Проба",
        "payment_method": "bank_transfer", "issue_date": "2026-11-12", "due_date": "2026-12-12",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 500, "vat_rate": 20}]})
    assert issued.status_code == 200, issued.text


def test_the_vat_on_home(client, monkeypatch):
    company_id, owner_id, owner = _company()
    _seed(client, owner, company_id, owner_id)

    # The 21st: November so far - and paid by 14 December.
    _today(monkeypatch, date(2026, 11, 21))
    vat = client.get("/api/statistics/vat", headers=owner, params=NOVEMBER).json()
    assert vat["registered"] is True and vat["month"] == "2026-11" and vat["running"] is True
    assert (vat["sales_vat"], vat["purchase_vat"], vat["due"]) == (2100, 800, 1300)
    assert vat["pay_by"] == "2026-12-14"
    # Where it is heading: the till's VAT for all 30 days, the goods' by the
    # 21 days gone by; the invoice issued and the fridge as they are.
    assert vat["expected_due"] == round(2000 / 10 * 30 + 100 - 600 / 21 * 30 - 200, 2)
    # October's VAT was due by 14 November - past.
    assert vat["previous"] is None
    # One number: the statistics' VAT to pay, and Home's own part.
    summary = client.get("/api/statistics/summary", headers=owner, params=NOVEMBER).json()
    assert summary["vat_to_pay"] == vat["due"]
    assert client.get("/api/home", headers=owner, params=NOVEMBER).json()["vat"] == vat

    # The 10th: October's VAT is still to be paid, by the 14th.
    _today(monkeypatch, date(2026, 11, 10))
    early = client.get("/api/statistics/vat", headers=owner, params=NOVEMBER).json()
    assert early["previous"] == {"month": "2026-10", "due": 350.0, "pay_by": "2026-11-14"}
    assert early["due"] == 2000 - 800
    # The cash flow pays the same October VAT on the 14th.
    client.post("/api/cash-flow/position", headers=owner, json={"cash": 1000, "bank": 0})
    [payment] = [e for e in client.get("/api/cash-flow?days=30", headers=owner).json()["events"] if e["kind"] == "vat"]
    assert (payment["date"], payment["amount"]) == ("2026-11-14", -350)

    # A past month: its VAT and its day; nothing to foresee.
    october = client.get("/api/statistics/vat", headers=owner,
                         params={"start_date": "2026-10-01", "end_date": "2026-10-31"}).json()
    assert (october["due"], october["pay_by"], october["running"], october["expected_due"]) == (350, "2026-11-14", False, None)
    # A week is no VAT month: no day to pay by.
    week = client.get("/api/statistics/vat", headers=owner, params={"start_date": "2026-11-02", "end_date": "2026-11-08"}).json()
    assert week["month"] is None and week["pay_by"] is None and week["due"] == 7 * 200 - 200


def test_only_a_business_registered_for_vat_and_whoever_sees_the_totals(client, monkeypatch):
    _today(monkeypatch, date(2026, 11, 21))
    company_id, _, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер Пробов")
    assert client.get("/api/statistics/vat", headers=cashier, params=NOVEMBER).status_code == 403
    assert client.get("/api/home", headers=cashier, params=NOVEMBER).json()["vat"] is None
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"vat_registered": False}}))
    assert client.get("/api/statistics/vat", headers=owner, params=NOVEMBER).json() == {"registered": False}

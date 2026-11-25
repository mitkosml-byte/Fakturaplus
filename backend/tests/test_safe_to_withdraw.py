"""Safe to withdraw (the personal notebook): the month's profit so far less
what it still owes before any of it is the owner's - the month's VAT to pay
and the salaries not entered yet, by the days gone - less what was already
taken and what falls due soon (P0-3).

Invented business, people and numbers."""
import asyncio
from datetime import date, datetime

import server
from routers import roi_wallet
from services.business_calendar import BUSINESS_TZ
from tests.test_whole_program_fixes import _company

MID_NOVEMBER = date(2026, 11, 15)


def _on(monkeypatch, day: date):
    monkeypatch.setattr(server, "today_local", lambda: day)
    monkeypatch.setattr(roi_wallet, "now_local", lambda: datetime(day.year, day.month, day.day, 12, tzinfo=BUSINESS_TZ))


def _seed(client, owner):
    """Ten days of 1 200 € at the till (200 € VAT each), goods of 3 600 €
    with 600 € VAT, one employee on 1 500 € with no payroll entered yet, and
    1 000 € taken out on the 12th."""
    for day in range(1, 11):
        client.post("/api/daily-revenue", headers=owner, json={"date": f"2026-11-{day:02d}", "fiscal_revenue": 1200, "vat_rate_percent": 20})
    client.post("/api/invoices", headers=owner, json={
        "supplier": "Склад Проба", "invoice_number": "S-1", "date": "2026-11-05",
        "amount_without_vat": 3000, "vat_amount": 600, "total_amount": 3600, "payment_method": "cash"})
    assert client.post("/api/employees", headers=owner, json={
        "name": "Служител Проба", "base_salary": 1500, "hire_date": "2025-01-01"}).status_code == 200
    assert client.post("/api/personal-wallet/entries", headers=owner, json={
        "category": "one_off", "description": "Лично", "amount": 1000, "date": "2026-11-12"}).status_code == 200


def test_safe_to_withdraw_keeps_back_the_vat_and_the_salaries(client, monkeypatch):
    company_id, _, owner = _company()
    _on(monkeypatch, MID_NOVEMBER)
    _seed(client, owner)
    summary = client.get("/api/personal-wallet/summary", headers=owner).json()
    assert summary["profit_this_month"] == 12000 - 3600
    salaries = asyncio.run(server.month_payroll(company_id, {"company_id": company_id}, 2026, 11))["expected"] * 15 / 30
    assert salaries > 0
    assert summary["set_aside"] == {"vat": 2000 - 600, "salaries": round(salaries, 2), "upcoming": 0}
    assert summary["safe_to_spend"] == round(12000 - 3600 - 1400 - salaries - 1000, 2)


def test_without_vat_registration_no_vat_is_kept_back(client, monkeypatch):
    company_id, _, owner = _company()
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"vat_registered": False}}))
    _on(monkeypatch, MID_NOVEMBER)
    _seed(client, owner)
    summary = client.get("/api/personal-wallet/summary", headers=owner).json()
    assert summary["set_aside"]["vat"] == 0
    assert summary["safe_to_spend"] == round(12000 - 3600 - summary["set_aside"]["salaries"] - 1000, 2)


def test_a_payroll_entered_is_not_expected_again(client, monkeypatch):
    company_id, _, owner = _company()
    _on(monkeypatch, MID_NOVEMBER)
    _seed(client, owner)
    [employee] = client.get("/api/employees", headers=owner).json()
    client.post("/api/payroll", headers=owner, json={"employee_id": employee["id"], "period_month": 11, "period_year": 2026, "gross_amount": 1500})
    summary = client.get("/api/personal-wallet/summary", headers=owner).json()
    assert summary["set_aside"]["salaries"] == 0

"""One profit everywhere (P1-1): the same month gives the same profit on
Home, in the margins, in the assistant, in the personal notebook, in the
locations, in the ROI card and in the budget - before, three screens gave
three profits for one month.

The one profit: without VAT for a business registered for VAT (the VAT is
the state's money), as they are for one that is not; the payroll by the
days of its month with the salaries not entered yet; the recurring costs
(rent...) by the days of their month, not on the day they were paid.

Invented business, people and numbers."""
import asyncio

import server
from routers.roi_wallet import _month_totals, _roi_month_data
from services.business_calendar import Period
from tests.test_whole_program_fixes import _company


def _seed(client, owner, company_id, owner_id):
    """Today: 1200 € at the till (VAT 20%) and a supplier's invoice of 600 €
    (500 € without VAT); the rent, 300 € a month without invoice, paid today;
    one employee on 1500 € with no payroll entered for the month."""
    today = server.today_local()
    assert client.post("/api/daily-revenue", headers=owner, json={
        "date": today.isoformat(), "fiscal_revenue": 1200, "vat_rate_percent": 20}).status_code == 200
    assert client.post("/api/invoices", headers=owner, json={
        "supplier": "Доставчик Проба", "invoice_number": f"P-{company_id[-6:]}", "date": today.isoformat(),
        "amount_without_vat": 500, "vat_amount": 100, "total_amount": 600, "payment_method": "cash",
    }).status_code == 200
    rent_id = f"rent-{company_id}"
    asyncio.run(server.db.recurring_expenses.insert_one({
        "id": rent_id, "company_id": company_id, "description": "Наем", "amount": 300, "day_of_month": today.day,
        "kind": "no_invoice", "start_month": today.strftime("%Y-%m"), "is_active": True,
    }))
    asyncio.run(server.db.expenses.insert_one({
        "id": f"rent-paid-{company_id}", "company_id": company_id, "user_id": owner_id, "description": "Наем",
        "amount": 300, "date": today.isoformat(), "recurring_id": rent_id, "recurring_month": today.strftime("%Y-%m"),
    }))
    assert client.post("/api/employees", headers=owner, json={
        "name": "Служител Проба", "base_salary": 1500, "hire_date": "2025-01-01"}).status_code == 200


def _everywhere(client, owner, company_id, owner_id) -> dict:
    today = server.today_local()
    month = Period.month_of(today)
    period = f"start_date={month.start_text}&end_date={month.end_text}"
    scope = asyncio.run(server.company_data_scope(company_id))
    every = {"statistics": True, "pocket_money": True, "off_book_expenses": True, "profit": True,
             "personal_investments": True, "payroll": True, "personal_wallet": True}
    summary = client.get(f"/api/statistics/summary?{period}", headers=owner).json()
    margins = client.get(f"/api/statistics/margins?{period}", headers=owner).json()
    chat = asyncio.run(server._business_digest_period(company_id, scope, owner_id, month.start_text, month.end_text, every))
    wallet = client.get("/api/personal-wallet/summary", headers=owner).json()
    locations = client.get(f"/api/locations/compare?{period}", headers=owner).json()
    roi_raw = asyncio.run(_roi_month_data(company_id, scope, owner_id, every, [(today.year, today.month)]))
    roi = _month_totals(roi_raw[f"{today:%Y-%m}"], every)
    asyncio.run(server.db.budgets.update_one(
        {"company_id": company_id, "month": f"{today:%Y-%m}"},
        {"$set": {"company_id": company_id, "month": f"{today:%Y-%m}", "expense_limit": 100000, "alert_threshold": 80}},
        upsert=True,
    ))
    budget = asyncio.run(server.compute_budget_status(company_id, f"{today:%Y-%m}"))
    return {
        "summary": summary, "margins": margins, "chat": chat, "wallet": wallet,
        "locations": locations, "roi": roi, "budget": budget,
    }


def test_one_profit_everywhere_for_a_business_registered_for_vat(client):
    company_id, owner_id, owner = _company()
    _seed(client, owner, company_id, owner_id)
    seen = _everywhere(client, owner, company_id, owner_id)
    summary = seen["summary"]
    today = server.today_local()
    month = Period.month_of(today)
    share = today.day / month.days

    # The parts, by the rule.
    assert summary["vat_excluded"] is True
    assert summary["total_income"] == 1000.0                 # the till without its 200 € VAT
    expected_salary = summary["payroll_expected"]
    assert expected_salary > 0 and summary["total_payroll_cost"] == round(expected_salary, 2)
    rent_by_days = round(300 * share, 2)
    assert summary["total_expense"] == round(500 + rent_by_days + expected_salary, 2)
    profit = summary["profit"]
    assert profit == round(1000 - 500 - rent_by_days - expected_salary, 2)

    # The same profit on every screen.
    assert seen["margins"]["operating"]["profit"] == profit
    assert seen["chat"]["profit"] == profit and seen["chat"]["vat_excluded"] is True
    assert seen["wallet"]["profit_this_month"] == profit
    assert seen["locations"]["total"]["profit"] == profit
    assert round(seen["roi"]["profit"], 2) == profit
    assert seen["budget"]["total_spent"] == summary["total_expense"]

    # The chart's days add up to the same.
    chart = client.get(f"/api/statistics/chart-data?start_date={month.start_text}&end_date={month.end_text}",
                       headers=owner).json()
    assert round(sum(p["income"] for p in chart), 2) == summary["total_income"]
    assert round(sum(p["expense"] for p in chart), 2) == summary["total_expense"]

    # The VAT is shown on its own, never in the profit.
    assert summary["vat_to_pay"] == 100.0
    # The takings as rung up stay what they were.
    assert summary["total_fiscal_revenue"] == 1200.0
    assert summary["total_cash_revenue"] + summary["total_card_revenue"] + summary["total_bank_revenue"] == 1200.0


def test_one_profit_for_a_business_outside_vat(client):
    company_id, owner_id, owner = _company()
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"vat_registered": False}}))
    _seed(client, owner, company_id, owner_id)
    seen = _everywhere(client, owner, company_id, owner_id)
    summary = seen["summary"]
    # Outside VAT there is no VAT to take off: the till and the invoice as they are.
    assert summary["vat_excluded"] is False
    assert summary["total_income"] == 1200.0
    profit = summary["profit"]
    assert profit == round(1200 - summary["total_expense"], 2)
    assert summary["total_expense"] > 600            # the invoice's 600 with its VAT, a cost
    assert seen["margins"]["operating"]["profit"] == profit
    assert seen["chat"]["profit"] == profit
    assert seen["wallet"]["profit_this_month"] == profit
    assert seen["locations"]["total"]["profit"] == profit
    assert round(seen["roi"]["profit"], 2) == profit
    assert seen["budget"]["total_spent"] == summary["total_expense"]

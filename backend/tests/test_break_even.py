"""Break-even and the day's target (Н5): the month's fixed costs - payroll,
recurring expenses, depreciation - over the usual margin of the last full
months say what the month has to sell to end at zero, and what each working
day left has to bring. A recurring cost already paid is a fixed cost, never
also a cost of the goods; the same income as the profit on Home."""
import asyncio
from datetime import date

import server
from routers.chat_tools import ChatDataTools, build_chat_tools
from services import break_even as be
from tests.test_whole_program_fixes import _company, _user

TODAY = date(2026, 11, 12)   # a Thursday


def test_n5_the_numbers_worked_out():
    assert be.usual_margin([{"income": 10000, "variable": 6000}, {"income": 10000, "variable": 6000}]) == 0.4
    assert be.usual_margin([{"income": 0, "variable": 50}]) is None
    assert be.usual_margin([{"income": 100, "variable": 0}]) == 1.0

    day = be.work_out(fixed_costs=2400, margin=0.4, income_before_today=4000, income_today=250,
                      open_days_from_today=16, today_is_open=True)
    assert (day["break_even_income"], day["income_so_far"], day["missing"], day["reached"]) == (6000, 4250, 1750, False)
    assert day["daily_target"] == 125 and day["income_today"] == 250       # 2000 still missing this morning, over 16 days
    done = be.work_out(2400, 0.4, 6500, 0, 5, True)
    assert done["reached"] is True and done["above"] == 500 and done["daily_target"] == 0 and done["progress"] == 1.0


def _fake_today(monkeypatch):
    monkeypatch.setattr(server, "today_local", lambda: TODAY)
    monkeypatch.setattr(server.recurring_service, "current_day", lambda: TODAY)


def _three_months(client, owner, company_id):
    """August to October: 10 000 € sold and 6 000 € of goods a month."""
    for month in (8, 9, 10):
        for day in range(1, 21):
            client.post("/api/daily-revenue", headers=owner, json={"date": f"2026-{month:02d}-{day:02d}", "fiscal_revenue": 500})
        client.post("/api/invoices", headers=owner, json={
            "supplier": "Склад Изток", "invoice_number": f"G-{month}", "date": f"2026-{month:02d}-10",
            "amount_without_vat": 5000, "vat_amount": 1000, "total_amount": 6000, "payment_method": "cash",
        })


def test_n5_this_months_break_even_and_todays_target(client, monkeypatch):
    company_id, owner_id, owner = _company()
    _fake_today(monkeypatch)
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"closed_weekdays": [6]}}))
    _three_months(client, owner, company_id)
    # The rent: a recurring expense, paid in October - a fixed cost, not goods.
    asyncio.run(server.db.recurring_expenses.insert_one({
        "id": f"rent-{company_id}", "company_id": company_id, "description": "Наем", "amount": 1200, "day_of_month": 5,
        "kind": "no_invoice", "start_month": "2026-10", "is_active": True,
    }))
    asyncio.run(server.db.expenses.insert_one({
        "id": f"rent-paid-{company_id}", "company_id": company_id, "user_id": owner_id, "description": "Наем", "amount": 1200,
        "date": "2026-10-05", "recurring_id": f"rent-{company_id}", "recurring_month": "2026-10",
    }))
    client.post("/api/employees", headers=owner, json={"name": "Мария", "base_salary": 1000, "hire_date": "2024-02-01"})
    for day in range(2, 12):
        client.post("/api/daily-revenue", headers=owner, json={"date": f"2026-11-{day:02d}", "fiscal_revenue": 400})
    client.post("/api/daily-revenue", headers=owner, json={"date": TODAY.isoformat(), "fiscal_revenue": 250})

    payroll = server.calculate_payroll(1000, "gross", asyncio.run(server.get_payroll_rates_dict(company_id, 2026, 11)))["total_employer_cost"]
    fixed = round(1200 + payroll, 2)
    result = client.get("/api/statistics/break-even", headers=owner).json()
    assert result["available"] is True and result["month"] == "2026-11"
    assert result["fixed_costs"] == {"payroll": round(payroll, 2), "recurring": 1200, "depreciation": 0, "total": fixed}
    # 5 000 of goods (without their VAT) on 10 000 sold, each month - the
    # October rent left out of the goods - and the sixth of the takings that
    # is VAT for the state (P1-1): no profit, so it follows the sales.
    margin = 1 - (5000 + 10000 * 20 / 120) / 10000
    assert result["margin_percent"] == 33.3 and result["margin_basis"] == {"kind": "last_months", "months": ["2026-10", "2026-09", "2026-08"]}
    assert abs(result["break_even_income"] - fixed / margin) < 0.011
    assert (result["income_so_far"], result["income_today"], result["reached"]) == (4250, 250, False)
    # From today to the 30th without the three Sundays: 16 working days.
    assert result["open_days_left"] == 16 and result["today_is_open"] is True
    assert abs(result["daily_target"] - (fixed / margin - 4000) / 16) < 0.011
    assert abs(result["missing"] - (fixed / margin - 4250)) < 0.011

    # The month's payroll recorded: the same cost, once (not recorded + expected).
    [employee] = client.get("/api/employees", headers=owner).json()
    client.post("/api/payroll", headers=owner, json={"employee_id": employee["id"], "period_month": 11, "period_year": 2026, "gross_amount": 1000})
    assert client.get("/api/statistics/break-even", headers=owner).json()["fixed_costs"]["payroll"] == round(payroll, 2)

    # Past the point: above it, nothing more asked of the days.
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-11-01", "fiscal_revenue": 5000})
    above = client.get("/api/statistics/break-even", headers=owner).json()
    assert above["reached"] is True and abs(above["above"] - (9250 - fixed / margin)) < 0.011 and above["daily_target"] == 0

    # The assistant can ask; someone who may not see the profit cannot.
    user = server.User(**server.sanitize_user(asyncio.run(server.db.users.find_one({"user_id": owner_id}, {"_id": 0}))))
    tools = build_chat_tools(ChatDataTools(user, company_id, {"company_id": company_id}, server.get_financial_visibility(user)))
    assert "break_even" in [t.name for t in tools]
    _, cashier = _user(company_id, "staff", ["add_revenue", "view_statistics"], "Касиер")
    assert client.get("/api/statistics/break-even", headers=cashier).status_code == 403


def test_n5_says_when_it_cannot_tell(client, monkeypatch):
    company_id, _, owner = _company()
    _fake_today(monkeypatch)
    nothing = client.get("/api/statistics/break-even", headers=owner).json()
    assert (nothing["available"], nothing["reason"]) == (False, "not_enough_data")

    _three_months(client, owner, company_id)
    no_fixed = client.get("/api/statistics/break-even", headers=owner).json()
    assert (no_fixed["available"], no_fixed["reason"]) == (False, "no_fixed_costs")

    # Goods that cost as much as was sold: no margin to cover anything.
    client.post("/api/employees", headers=owner, json={"name": "Иво", "base_salary": 900, "hire_date": "2024-02-01"})
    for month in (8, 9, 10):
        client.post("/api/invoices", headers=owner, json={
            "supplier": "Склад Запад", "invoice_number": f"L-{month}", "date": f"2026-{month:02d}-15",
            "amount_without_vat": 4000, "vat_amount": 800, "total_amount": 4800, "payment_method": "cash",
        })
    no_margin = client.get("/api/statistics/break-even", headers=owner).json()
    assert (no_margin["available"], no_margin["reason"]) == (False, "no_margin")

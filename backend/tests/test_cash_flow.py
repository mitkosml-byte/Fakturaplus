"""Cash flow for the weeks ahead (Н1/П1): from the money the business has
now, what customers owe by its due date and the usual till revenue come in;
supplier invoices by their due date (an overdue one today), recurring
expenses, payroll on its pay day and VAT by the 14th go out - each counted
once. The lowest point and the first day below zero, a signal weeks before
it, and the assistant can ask."""
import asyncio
from datetime import date, timedelta

import server
from routers.chat_tools import ChatDataTools, build_chat_tools
from services import cash_flow as cf
from tests.test_whole_program_fixes import _company, _user


def _owner(owner_id):
    return server.User(**server.sanitize_user(asyncio.run(server.db.users.find_one({"user_id": owner_id}, {"_id": 0}))))


def test_n1_the_days_ahead_lowest_point_and_first_day_below_zero():
    today = date(2026, 11, 16)   # a Monday
    events = [
        cf.CashEvent(today - timedelta(days=4), -300, cf.INVOICE, "Стара фактура", overdue=True),  # counts today
        cf.CashEvent(today + timedelta(days=3), -1500, cf.INVOICE, "Доставчик"),
        cf.CashEvent(today + timedelta(days=5), 600, cf.RECEIVABLE, "Клиент"),
        cf.CashEvent(today + timedelta(days=40), -9999, cf.INVOICE, "След прозореца"),            # not in 30 days
    ]
    flow = cf.project(1000, today, 30, events, {d: 100.0 for d in range(7)}, lambda d: d.weekday() == 6, today + timedelta(days=1))
    assert [row["balance"] for row in flow["series"][:6]] == [700, 800, 900, -500, -400, 300]
    assert flow["first_negative"] == "2026-11-19" and flow["lowest"] == {"date": "2026-11-19", "balance": -500}
    # Usual revenue from tomorrow, not on Sundays: 29 days, 4 of them Sundays.
    assert flow["usual_revenue_total"] == 2500
    assert flow["events"][0] == {"date": "2026-11-16", "amount": -300, "kind": "invoice", "label": "Стара фактура", "overdue": True}
    assert all(e["label"] != "След прозореца" for e in flow["events"])

    assert cf.weekday_averages([{"date": "2026-11-09", "fiscal_revenue": 100}] * 6) == {}   # too few days
    assert cf.usual_pay_day([25, 24, 26, 25]) == 25 and cf.usual_pay_day([]) is None


def test_n1_from_the_business_data(client):
    company_id, owner_id, owner = _company()
    today = server.today_local()
    day = lambda n: (today + timedelta(days=n)).isoformat()   # noqa: E731

    assert client.post("/api/cash-flow/position", headers=owner, json={"cash": 500, "bank": 1500, "date": day(1)}).status_code == 400
    assert client.post("/api/cash-flow/position", headers=owner, json={"cash": 500, "bank": 1500}).status_code == 200
    base = {"supplier": "Строй Депо", "date": day(-10), "amount_without_vat": 1000, "vat_amount": 200, "payment_method": "bank_transfer"}
    client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "CF-1", "total_amount": 1200, "payment_due_date": day(5)})
    client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "CF-2", "total_amount": 300,
                                                       "amount_without_vat": 250, "vat_amount": 50, "payment_due_date": day(-3)})
    client.post("/api/receivables", headers=owner, json={"customer_name": "Ресторант Лале", "amount": 800, "due_date": day(10)})
    client.post("/api/receivables", headers=owner, json={"customer_name": "Хотел Морско", "amount": 250, "due_date": day(-5)})
    asyncio.run(server.db.recurring_expenses.insert_one({
        "id": f"rent-{company_id}", "company_id": company_id, "description": "Наем", "amount": 900,
        "day_of_month": today.day, "kind": "no_invoice", "start_month": today.strftime("%Y-%m"), "is_active": True,
    }))
    client.post("/api/employees", headers=owner, json={"name": "Георги", "base_salary": 1000, "hire_date": "2024-01-15"})
    pay = today + timedelta(days=3)
    assert client.put("/api/cash-flow/settings", headers=owner, json={"pay_day": pay.day}).json() == {"pay_day": pay.day}

    flow = client.get("/api/cash-flow?days=30", headers=owner).json()
    payroll = server.calculate_payroll(1000, "gross", asyncio.run(server.get_payroll_rates_dict(company_id, pay.year, pay.month)))["total_employer_cost"]
    got = {(e["date"], e["kind"], e["label"], e["amount"], e["overdue"]) for e in flow["events"]}
    assert got == {
        (day(0), "invoice", "Строй Депо", -300, True),        # overdue: to pay now
        (day(0), "recurring", "Наем", -900, False),
        (day(3), "payroll", "Заплати и осигуровки", -round(payroll, 2), False),
        (day(5), "invoice", "Строй Депо", -1200, False),
        (day(10), "receivable", "Ресторант Лале", 800, False),
    }
    assert flow["overdue_receivables"] == 250 and flow["start_balance"] == 2000
    assert flow["series"][0]["balance"] == 800
    assert flow["series"][5]["balance"] == round(800 - payroll - 1200, 2)
    assert flow["first_negative"] == (day(3) if payroll > 800 else day(5))

    # The signal, weeks before - and the assistant can ask.
    user = _owner(owner_id)
    signal = asyncio.run(server._signal_cash_flow(company_id, {"company_id": company_id}, user, server.get_financial_visibility(user)))
    assert signal["key"] == "cash_flow" and signal["route"] == "/cash-flow"
    assert date.fromisoformat(flow["first_negative"]).strftime("%d.%m") in signal["detail"]
    tools = build_chat_tools(ChatDataTools(user, company_id, {"company_id": company_id}, server.get_financial_visibility(user)))
    assert "cash_flow" in [t.name for t in tools]

    # A month's payroll already recorded is not expected again; a business
    # without payroll expects none.
    client.put("/api/company/modules", headers=owner, json={"modules": {"payroll": False}})
    assert all(e["kind"] != "payroll" for e in client.get("/api/cash-flow", headers=owner).json()["events"])


def test_n1_usual_revenue_and_vat(client):
    company_id, _, owner = _company()
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"vat_registered": True, "closed_weekdays": [6]}}))
    today = server.today_local()
    for n in range(1, 57):   # 8 weeks of 120 € a day (VAT 20 € in each)
        client.post("/api/daily-revenue", headers=owner, json={"date": (today - timedelta(days=n)).isoformat(), "fiscal_revenue": 120})
    client.post("/api/cash-flow/position", headers=owner, json={"cash": 1000, "bank": 0})

    flow = client.get("/api/cash-flow?days=30", headers=owner).json()
    open_days = sum(1 for n in range(1, 30) if (today + timedelta(days=n)).weekday() != 6)   # from tomorrow
    assert flow["usual_revenue_total"] == 120 * open_days
    [vat] = [e for e in flow["events"] if e["kind"] == "vat"]
    vat_day = date(today.year, today.month, 14) if today.day <= 14 else (
        date(today.year + (today.month == 12), today.month % 12 + 1, 14))
    assert vat["date"] == vat_day.isoformat()
    prev = vat_day.replace(day=1) - timedelta(days=1)
    entered = sum(1 for n in range(1, 57) if (today - timedelta(days=n)).strftime("%Y-%m") == prev.strftime("%Y-%m"))
    assert vat["amount"] == -20 * entered


def test_n1_only_for_whoever_sees_the_profit(client):
    company_id, _, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue", "view_statistics"], "Касиер")
    assert client.get("/api/cash-flow", headers=cashier).status_code == 403
    assert client.post("/api/cash-flow/position", headers=cashier, json={"cash": 1, "bank": 1}).status_code == 403
    assert client.get("/api/cash-flow", headers=owner).json()["position"] is None

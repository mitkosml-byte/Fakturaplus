"""Signals and the assistant on customers and the week's payments (П2–П4):
debts counted as debts and as customers, with who owes the most; what is to
be paid this week - invoices falling due and recurring expenses whose day
comes; and a look-up the assistant can ask about customers."""
import asyncio
from datetime import date

import server
from routers.chat_tools import ChatDataTools, build_chat_tools
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company

FULL = {"statistics": True, "pocket_money": True, "off_book_expenses": True, "profit": True, "personal_investments": True}


def _owner(owner_id):
    doc = asyncio.run(server.db.users.find_one({"user_id": owner_id}, {"_id": 0}))
    return server.User(**doc)


def _signal(builder, company_id, user):
    async def run():
        _, scope = await server.get_company_scope(user)
        return await builder(company_id, scope, user, server.get_financial_visibility(user))
    return asyncio.run(run())


def test_p2_debts_are_counted_by_customer_with_who_owes_most(client):
    company_id, owner_id, owner = _company()
    for amount in (100, 50):
        client.post("/api/receivables", headers=owner, json={"customer_name": "Ресторант Лале", "amount": amount, "due_date": "2026-01-10"})
    signal = _signal(server._signal_receivables, company_id, _owner(owner_id))
    assert signal["detail"] == "2 просрочени вземания от 1 клиент - общо 150,00\u00a0€. Дължи Ресторант Лале."

    client.post("/api/receivables", headers=owner, json={"customer_name": "Хотел Морско", "amount": 400, "due_date": "2026-01-12"})
    signal = _signal(server._signal_receivables, company_id, _owner(owner_id))
    assert signal["detail"] == "3 просрочени вземания от 2 клиента - общо 550,00\u00a0€. Най-много дължи Хотел Морско - 400,00\u00a0€."


def test_p4_the_weeks_payments(client, monkeypatch):
    company_id, owner_id, owner = _company()
    base = {"supplier": "Строй Депо", "date": "2026-11-02", "amount_without_vat": 100, "vat_amount": 20,
            "total_amount": 120, "payment_method": "bank_transfer"}
    client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "W-1", "payment_due_date": "2026-11-20"})
    client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "W-2", "payment_due_date": "2026-11-26"})
    asyncio.run(server.db.recurring_expenses.insert_one({
        "id": "rent-1", "company_id": company_id, "description": "Наем", "amount": 800, "day_of_month": 21,
        "kind": "no_invoice", "start_month": "2026-11", "is_active": True,
    }))
    user = _owner(owner_id)

    monkeypatch.setattr(server, "today_local", lambda: date(2026, 11, 18))   # a Wednesday
    signal = _signal(server._signal_payments_this_week, company_id, user)
    assert signal["title"] == "Плащания тази седмица"
    assert signal["detail"] == "Тази седмица (до 22.11) плащаш 1 фактура за 120,00\u00a0€ и Наем 800,00\u00a0€."

    monkeypatch.setattr(server, "today_local", lambda: date(2026, 11, 21))   # Saturday: the week ahead
    signal = _signal(server._signal_payments_this_week, company_id, user)
    assert signal["title"] == "Плащания следващата седмица" and "до 29.11" in signal["detail"]
    assert "1 фактура за 120,00\u00a0€" in signal["detail"] and "Наем" in signal["detail"]


def test_p3_the_assistant_can_ask_about_customers(client):
    company_id, owner_id, owner = _company()
    first = _issue(client, owner, issue_date="2026-03-02", due_date="2026-03-16")
    client.post(f"/api/receivables/{first['receivable_id']}/payments", headers=owner,
                json={"amount": 120, "date": "2026-03-20", "method": "bank_transfer"})   # 4 days late
    _issue(client, owner, issue_date="2026-04-01", due_date="2026-04-15")              # still owed, overdue
    _issue(client, owner, customer_name="Омега АД", customer_eik="200000001", issue_date="2026-04-05",
           due_date="2099-12-31", items=[{"name": "Услуга", "quantity": 1, "unit_price": 500, "vat_rate": 20}])
    user = _owner(owner_id)

    async def ask(**kwargs):
        _, scope = await server.get_company_scope(user)
        return await ChatDataTools(user, company_id, scope, FULL).customer_sales(**kwargs)

    one = asyncio.run(ask(customer="гама трейд", start_date="2026-01-01", end_date="2026-12-31"))
    [gamma] = one["matches"][:1]
    assert gamma["customer"] == "Гама Трейд ООД" and gamma["invoiced"] == 240 and gamma["invoices"] == 2
    assert (gamma["paid_in_range"], gamma["owed_now"], gamma["overdue_now"]) == (120, 120, 120)
    assert gamma["average_days_late"] == 4 and gamma["last_invoice"] == "2026-04-01"

    everyone = asyncio.run(ask())
    assert [c["customer"] for c in everyone["owing_most_now"]] == ["Омега АД", "Гама Трейд ООД"]
    assert everyone["owed_now_total"] == 720

    # Only for whoever may see customers.
    analyst = server.User(user_id="u-analyst", email="a@t.bg", name="А", role="staff", company_id=company_id,
                          permissions=["view_statistics"])
    names = [t.name for t in build_chat_tools(ChatDataTools(analyst, company_id, {"company_id": company_id}, FULL))]
    assert "customer_sales" not in names
    assert "customer_sales" in [t.name for t in build_chat_tools(ChatDataTools(user, company_id, {}, FULL))]

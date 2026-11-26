"""Who sees what (the visibility model): every sensitive part counts in the
numbers of whoever may see it, and is out of everyone else's - never a
total with a line merely blanked. The parts and their rights:

- pocket money (view_pocket_money) - income;
- expenses without invoice (view_off_book_expenses) - expense;
- the payroll (manage_payroll) - expense;
- the personal notebook, company money spent personally
  (view_personal_wallet) - never a business expense: a line of its own
  beside the profit, "personal use" and what is left after it.

One made-up month of one business, read by four people with different
rights, on every screen that adds money up."""
import asyncio
from datetime import date, datetime, timedelta, timezone

import server
from routers.statistics import get_chart_data
from services.business_calendar import Period
from tests.test_whole_program_fixes import _company, _user

OWNER = "owner"
ACCOUNTANT = "accountant"   # the role's defaults: profit and payroll, no pocket money or off-book
MANAGER = "manager"         # the role's defaults: pocket money, off-book and profit, no payroll
NOTEBOOK = "notebook"       # statistics, profit and the personal notebook only

# What each sees of the month: income, expense, and the notebook's line -
# the one profit (P1-1): the business is registered for VAT, so the till's
# 1000 counts without its VAT (833.33) and the invoice without its own (250).
EXPECTED = {
    OWNER: {"income": 1033.33, "expense": 850.0, "payroll": 500.0, "personal": 150.0},
    ACCOUNTANT: {"income": 833.33, "expense": 750.0, "payroll": 500.0, "personal": None},
    MANAGER: {"income": 1033.33, "expense": 350.0, "payroll": None, "personal": None},
    NOTEBOOK: {"income": 833.33, "expense": 250.0, "payroll": None, "personal": 150.0},
}


def _last_month() -> Period:
    today = server.today_local()
    return Period.month_of(today.replace(day=1) - timedelta(days=1))


def _business(client):
    company_id, owner_id, owner = _company()
    month = _last_month()
    day = month.start.replace(day=10).isoformat()
    # Till 1000 + pocket money 200; a supplier's invoice 300; an expense
    # without invoice 100; the month's payroll 500; 150 spent personally.
    assert client.post("/api/daily-revenue", headers=owner,
                       json={"date": day, "fiscal_revenue": 1000, "pocket_money": 200}).status_code == 200
    assert client.post("/api/invoices", headers=owner, json={
        "supplier": "Доставчик Проба ЕООД", "invoice_number": "0000000001", "date": day,
        "amount_without_vat": 250, "vat_amount": 50, "total_amount": 300, "payment_method": "cash",
    }).status_code == 200
    assert client.post("/api/expenses", headers=owner,
                       json={"description": "Почистване", "amount": 100, "date": day}).status_code == 200
    asyncio.run(server.db.payroll_entries.insert_one({
        "id": f"pay-{company_id}", "company_id": company_id, "user_id": owner_id, "employee_id": "e1",
        "period_month": month.start.month, "period_year": month.start.year, "total_employer_cost": 500.0,
        "created_at": datetime.now(timezone.utc),
    }))
    asyncio.run(server.db.personal_wallet_entries.insert_one({
        "id": f"pw-{company_id}", "company_id": company_id, "user_id": owner_id, "category": "daily",
        "description": "Лични покупки", "amount": 150.0, "date": day, "is_recurring": False,
    }))
    viewers = {OWNER: owner}
    viewers[ACCOUNTANT] = _user(company_id, "accountant", sorted(server.ROLE_PERMISSIONS["accountant"]), "Счетоводител")[1]
    viewers[MANAGER] = _user(company_id, "manager", sorted(server.ROLE_PERMISSIONS["manager"]), "Управител")[1]
    viewers[NOTEBOOK] = _user(company_id, "staff", ["view_statistics", "view_profit", "view_personal_wallet"], "Довереник")[1]
    return company_id, owner_id, viewers, month


def _user_of(headers) -> server.User:
    token = headers["Authorization"].split()[1]

    async def _find():
        session = await server.db.user_sessions.find_one({"session_token": token})
        doc = await server.db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
        return server.User(**server.sanitize_user(doc))
    return asyncio.run(_find())


def test_every_total_holds_what_its_viewer_may_see(client):
    company_id, _, viewers, month = _business(client)
    period = f"start_date={month.start_text}&end_date={month.end_text}"
    scope = asyncio.run(server.company_data_scope(company_id))

    for who, headers in viewers.items():
        want = EXPECTED[who]
        profit = round(want["income"] - want["expense"], 2)

        # Home and Statistics.
        summary = client.get(f"/api/statistics/summary?{period}", headers=headers).json()
        assert (summary["total_income"], summary["total_expense"], summary["profit"]) == (want["income"], want["expense"], profit), who
        assert summary["total_payroll_cost"] == want["payroll"], who
        assert summary["personal_withdrawals"] == want["personal"], who
        assert summary["left_after_personal"] == (round(profit - want["personal"], 2) if want["personal"] is not None else None), who

        # The chart's days add up to the same totals.
        user = _user_of(headers)
        points = asyncio.run(get_chart_data(start_date=month.start_text, end_date=month.end_text, current_user=user))
        assert round(sum(p["income"] for p in points), 2) == want["income"], who
        assert round(sum(p["expense"] for p in points), 2) == want["expense"], who

        # The assistant reads the same month.
        visibility = server.get_financial_visibility(user)
        digest = asyncio.run(server._business_digest_period(
            company_id, scope, user.user_id, month.start_text, month.end_text, visibility))
        assert (digest["revenue"], digest["expenses"], digest["profit"]) == (want["income"], want["expense"], profit), who
        assert digest["personal_withdrawals"] == want["personal"], who

        # The budget's spending of the month, and the notebook's profit
        # (the business's own, before personal use).
        asyncio.run(server.db.budgets.update_one(
            {"company_id": company_id, "month": month.start.strftime("%Y-%m")},
            {"$set": {"company_id": company_id, "month": month.start.strftime("%Y-%m"), "expense_limit": 2000}},
            upsert=True,
        ))
        budget = asyncio.run(server.compute_budget_status(company_id, month.start.strftime("%Y-%m"), visibility))
        assert budget["total_spent"] == want["expense"], who
        assert budget["total_payroll_cost"] == want["payroll"], who
        notebook_profit = asyncio.run(server._compute_month_profit(
            company_id, scope, user.user_id, month.start_text, month.end_text, visibility))
        assert round(notebook_profit, 2) == profit, who

    # Whoever cannot see the salaries is told the totals are without them.
    manager_view = client.get(f"/api/statistics/summary?{period}", headers=viewers[MANAGER]).json()["financial_visibility"]
    assert "заплатите" in server.restricted_data_note(manager_view)
    accountant_view = client.get(f"/api/statistics/summary?{period}", headers=viewers[ACCOUNTANT]).json()["financial_visibility"]
    assert server.restricted_data_note(accountant_view) == (
        "Сумите и печалбата са без бакшиша и разходите без фактура (скрити за вашия достъп) - "
        "това не е действителната печалба на фирмата."
    )


def test_the_expense_forecast_leaves_out_what_its_viewer_may_not_see(client):
    company_id, _, _, month = _business(client)
    scope = asyncio.run(server.forecast_service._company_scope(company_id))
    start = datetime(month.start.year, month.start.month, 1)
    end = datetime(*server._ym_add(month.start.year, month.start.month, 1), 1)
    key = month.start.strftime("%Y-%m")

    def total(include_off_book, include_payroll):
        totals, _ = asyncio.run(server.forecast_service._expense_monthly_totals(
            company_id, scope, start, end, include_off_book, include_payroll))
        return round(totals.get(key, 0.0), 2)

    assert total(True, True) == 900.0      # the owner
    assert total(False, True) == 800.0     # the accountant
    assert total(True, False) == 400.0     # the manager
    assert total(False, False) == 300.0


def test_the_cash_flow_shows_personal_payments_and_salaries_only_to_their_viewers(client):
    company_id, owner_id, viewers, _ = _business(client)
    today = server.today_local()
    soon = (today + timedelta(days=3)).isoformat()
    asyncio.run(server.db.personal_wallet_entries.insert_one({
        "id": f"lease-{company_id}", "company_id": company_id, "user_id": owner_id, "category": "leasing",
        "description": "Лизинг на кола", "amount": 320.0, "date": today.isoformat(), "is_recurring": True,
        "next_due_date": soon, "recurring_until": None,
    }))
    owner_flow = client.get("/api/cash-flow?days=30", headers=viewers[OWNER]).json()
    assert ("personal", "Лизинг на кола", -320.0, soon) in {(e["kind"], e["label"], e["amount"], e["date"]) for e in owner_flow["events"]}
    manager_flow = client.get("/api/cash-flow?days=30", headers=viewers[MANAGER]).json()
    assert all(e["kind"] not in ("personal", "payroll") for e in manager_flow["events"])
    assert "Без заплатите - скрити са за вашия достъп." in manager_flow["notes"]
    # The notebook's own payment never reaches whoever cannot see the notebook.
    assert "Лизинг" not in str(manager_flow)


def test_a_budget_alert_carries_only_its_readers_own_figures(client, monkeypatch):
    company_id, _, viewers, _ = _business(client)
    today = server.today_local()
    this_month = today.strftime("%Y-%m")
    day = today.replace(day=1).isoformat()
    owner = viewers[OWNER]
    client.post("/api/expenses", headers=owner, json={"description": "Ремонт", "amount": 750, "date": day})
    client.post("/api/invoices", headers=owner, json={
        "supplier": "Доставчик Проба ЕООД", "invoice_number": "0000000002", "date": day,
        "amount_without_vat": 250, "vat_amount": 50, "total_amount": 300, "payment_method": "cash",
    })
    # Limit 1000: the owner's 1000 (the invoice's 250 without VAT + 750) is
    # over it; the accountant, who does not see the expenses without
    # invoice, is at 250 - 25%.
    asyncio.run(server.db.budgets.insert_one({
        "id": f"b-{company_id}", "company_id": company_id, "month": this_month, "expense_limit": 1000,
        "alert_threshold": 80, "alert_sent": False, "exceeded_sent": False,
    }))
    sent = []

    async def fake_send(_db, user_ids, title, body, data=None):
        sent.append((sorted(user_ids), title, body))
    monkeypatch.setattr(server.push_service, "send_to_users", fake_send)
    asyncio.run(server._budget_alert_tick())

    accountant_id = _user_of(viewers[ACCOUNTANT]).user_id
    owner_id = _user_of(owner).user_id
    assert any(owner_id in ids and title == "Бюджетът е надхвърлен" for ids, title, _ in sent)
    assert not any(accountant_id in ids for ids, _, _ in sent)
    assert all("750" not in body for ids, _, body in sent if accountant_id in ids)
    # Not sent twice.
    sent.clear()
    asyncio.run(server._budget_alert_tick())
    assert sent == []


def test_the_notebook_keeps_its_profit_figures_for_whoever_sees_the_profit(client):
    from routers.roi_wallet import get_personal_wallet_summary
    company_id, _, viewers, _ = _business(client)
    _, entries_only = _user(company_id, "staff", ["view_statistics", "view_personal_wallet"], "Само тефтерче")
    summary = asyncio.run(get_personal_wallet_summary(current_user=_user_of(entries_only)))
    assert summary["profit_this_month"] is None and summary["safe_to_spend"] is None
    assert summary["spent_percent_of_profit"] is None and summary["status"] == "ok"
    owner_summary = asyncio.run(get_personal_wallet_summary(current_user=_user_of(viewers[OWNER])))
    assert owner_summary["profit_this_month"] is not None and owner_summary["safe_to_spend"] is not None

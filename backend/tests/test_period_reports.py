"""The reports that used to mislead (follow-up to P0 of the logical-sync
analysis): a running period counted so far, with its average per entered
day and expected end; the chart on calendar periods adding up to the
summary; the forecast reading the month in progress; supplier reports for
any period, by day, week, month or year."""
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

import server
from services.business_calendar import Period, day_start_utc, days_in_month, today_local


def _owner():
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    token = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": user_id, "email": f"{user_id}@test.com", "name": "Owner", "role": "owner",
        "company_id": company_id, "permissions": list(server.ROLE_PERMISSIONS["owner"]), "auth_provider": "email",
        "has_password": True, "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION, "created_at": now,
    }

    async def _seed():
        await server.db.companies.insert_one({"id": company_id, "name": "Отчети ООД", "owner_id": user_id, "closed_weekdays": []})
        await server.db.users.insert_one(dict(doc))
        await server.db.user_sessions.insert_one({
            "user_id": user_id, "session_token": token, "expires_at": now + timedelta(days=1), "created_at": now,
        })

    asyncio.run(_seed())
    return company_id, server.User(**doc), {"Authorization": f"Bearer {token}"}


def _revenue(company_id, user, days, amount):
    async def _insert():
        await server.db.daily_revenue.insert_many([
            {"id": uuid.uuid4().hex, "user_id": user.user_id, "company_id": company_id, "date": d.isoformat(),
             "fiscal_revenue": amount, "pocket_money": 0.0, "card_revenue": 0.0, "vat_rate_percent": 20.0}
            for d in days
        ])
    if days:
        asyncio.run(_insert())


def _invoice(company_id, user, supplier, day, total):
    asyncio.run(server.db.invoices.insert_one({
        "id": uuid.uuid4().hex, "user_id": user.user_id, "company_id": company_id, "supplier": supplier,
        "invoice_number": uuid.uuid4().hex[:8], "total_amount": total, "vat_amount": 0.0, "amount_without_vat": total,
        "date": day_start_utc(day), "payment_method": "cash", "is_paid": True,
    }))


def test_a_running_month_is_counted_so_far_with_its_pace(client):
    company_id, user, headers = _owner()
    today = today_local()
    month = Period.month_of(today)
    entered = [month.start + timedelta(days=i) for i in range(today.day - 1)]   # every day before today
    _revenue(company_id, user, entered, 1000.0)
    asyncio.run(server.db.payroll_entries.insert_one({
        "id": uuid.uuid4().hex, "company_id": company_id, "user_id": user.user_id, "employee_id": "e1",
        "period_month": today.month, "period_year": today.year, "total_employer_cost": 3000.0,
    }))

    r = client.get(f"/api/statistics/summary?start_date={month.start_text}&end_date={month.end_text}", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["period"]["through_date"] == today.isoformat()
    # Without the VAT of the till (P1-1) - the pace below is in takings, as rung up.
    assert body["total_income"] == pytest.approx(1000.0 / 1.2 * len(entered), abs=0.01)
    # The month's payroll for the days gone by - not all of it on the 15th.
    assert body["total_payroll_cost"] == pytest.approx(3000.0 * today.day / month.days, abs=0.01)
    pace = body["pace"]
    assert pace["is_current"] is True and pace["revenue_days"] == len(entered)
    assert pace["open_days"] == month.days
    if entered:
        assert pace["avg_per_revenue_day"] == 1000.0
        assert pace["expected_income"] == 1000.0 * month.days

    # A finished month: the average, no expected end.
    previous = Period.month_of(month.start - timedelta(days=1))
    done = client.get(f"/api/statistics/summary?start_date={previous.start_text}&end_date={previous.end_text}", headers=headers).json()
    assert done["pace"]["is_current"] is False and done["pace"]["expected_income"] is None


def test_the_chart_adds_up_to_the_summary_by_day_and_by_month(client):
    company_id, user, headers = _owner()
    october = Period.month(2026, 10)
    _revenue(company_id, user, [d for d in october.iter_days() if d.day % 3], 500.0)   # some days not entered
    _invoice(company_id, user, "Доставчик", date(2026, 10, 31), 700.0)
    asyncio.run(server.db.payroll_entries.insert_one({
        "id": uuid.uuid4().hex, "company_id": company_id, "user_id": user.user_id, "employee_id": "e1",
        "period_month": 10, "period_year": 2026, "total_employer_cost": 3100.0,
    }))
    # Wages paid through Work Schedule for a shift worked on 5 October (made up).
    asyncio.run(server.db.expenses.insert_one({
        "id": uuid.uuid4().hex, "company_id": company_id, "user_id": user.user_id,
        "kind": "schedule_wages", "date": "2026-10-05", "amount": 96.0, "description": "Надници",
    }))

    for start, end, bucket in (("2026-10-01", "2026-10-31", "day"), ("2026-01-01", "2026-10-31", "month")):
        chart = client.get(f"/api/statistics/chart-data?start_date={start}&end_date={end}", headers=headers).json()
        summary = client.get(f"/api/statistics/summary?start_date={start}&end_date={end}", headers=headers).json()
        assert {p["bucket"] for p in chart} == {bucket}
        assert sum(p["income"] for p in chart) == pytest.approx(summary["total_income"])
        assert sum(p["expense"] for p in chart) == pytest.approx(summary["total_expense"])
    by_day = client.get("/api/statistics/chart-data?start_date=2026-10-01&end_date=2026-10-31", headers=headers).json()
    assert len(by_day) == 31 and by_day[-1]["label"] == "31.10"
    assert by_day[0]["has_revenue"] is True and by_day[2]["has_revenue"] is False   # 3 October not entered
    assert by_day[0]["fixed_costs"] == pytest.approx(100.0)                          # 3100 / 31
    # The salary is a cost of the month, apart from the day's own spending;
    # the wages of a shift stay on the day it was worked.
    assert by_day[0]["monthly_costs"] == pytest.approx(100.0)
    assert sum(p["monthly_costs"] for p in by_day) == pytest.approx(3100.0)
    assert (by_day[4]["fixed_costs"], by_day[4]["monthly_costs"]) == (pytest.approx(196.0), pytest.approx(100.0))

    # The current calendar month, only up to today.
    current = client.get("/api/statistics/chart-data?period=month", headers=headers).json()
    today = today_local()
    assert current[0]["date"] == today.replace(day=1).isoformat() and current[-1]["date"] == today.isoformat()


def test_the_revenue_forecast_reads_the_month_in_progress(client):
    company_id, user, headers = _owner()
    today = today_local()
    month = Period.month_of(today)
    history = []
    first, last = None, month.start - timedelta(days=1)
    for back in range(4, 0, -1):
        y, m = server._ym_add(today.year, today.month, -back)
        whole = Period.month(y, m)
        first = first or whole.start
        history.append(whole)
    # Three full months at 1000 a day; one with a quarter of its days missing.
    for whole in history:
        days = list(whole.iter_days())
        if whole is history[1]:
            days = [d for d in days if d.day % 4]
        _revenue(company_id, user, days, 1000.0)
    # The month in progress at 2000 a day, every day before today.
    running = [month.start + timedelta(days=i) for i in range(today.day - 1)]
    _revenue(company_id, user, running, 2000.0)

    fc = client.get("/api/forecast/revenue?months_ahead=1&lookback_days=180", headers=headers).json()
    by_month = {h["month"]: h for h in fc["historical"]}
    # A month with days missing counts at its own daily average - without
    # the till's VAT, as Home's income (P1-1).
    partial_month = history[1]
    assert by_month[f"{partial_month.start.year}-{partial_month.start.month:02d}"]["amount"] == pytest.approx(1000.0 / 1.2 * partial_month.days, abs=0.02)
    current = fc["current_month"]
    assert current["so_far"] == pytest.approx(2000.0 / 1.2 * len(running), abs=0.01)
    if len(running) >= 3:
        assert current["expected"] == pytest.approx(2000.0 / 1.2 * month.days, abs=0.02)
        if today.day >= 7:
            assert fc["historical"][-1] == {"month": current["month"], "amount": current["expected"], "estimated": True}


def test_supplier_reports_follow_the_chosen_period(client):
    company_id, user, headers = _owner()
    _invoice(company_id, user, "Доставчик А", date(2026, 10, 2), 100.0)
    _invoice(company_id, user, "Доставчик А", date(2026, 10, 20), 300.0)
    _invoice(company_id, user, "Доставчик Б", date(2026, 9, 10), 50.0)

    overview = client.get("/api/statistics/suppliers?start_date=2026-10-01&end_date=2026-10-31", headers=headers).json()
    assert overview["activity_basis"] == "period"
    assert [s["supplier"] for s in overview["all_suppliers"]] == ["Доставчик А"]
    assert overview["totals"]["total_amount"] == 400.0
    inactive = {s["supplier"]: s for s in overview["inactive_suppliers"]}
    assert inactive["Доставчик Б"]["days_inactive"] == (date(2026, 10, 31) - date(2026, 9, 10)).days
    assert overview["executive_summary"]["inactive_suppliers"] == 1

    detail = client.get(
        "/api/statistics/supplier/Доставчик А/detailed?start_date=2026-10-01&end_date=2026-10-31&group_by=week",
        headers=headers,
    ).json()
    assert detail["group_by"] == "week" and detail["overview"]["total_amount"] == 400.0
    weeks = detail["series"]
    assert [w["key"] for w in weeks] == ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]
    assert [w["amount"] for w in weeks] == [100.0, 0.0, 0.0, 300.0, 0.0]          # empty weeks are zero, not missing
    assert weeks[0]["is_partial"] and weeks[-1]["is_partial"]                    # cut by the period's ends
    assert weeks[0]["growth_percent"] is None and weeks[1]["growth_percent"] is None

    by_day = client.get(
        "/api/statistics/supplier/Доставчик А/detailed?start_date=2026-10-01&end_date=2026-10-31&group_by=day",
        headers=headers,
    ).json()
    assert len(by_day["series"]) == 31 and sum(p["amount"] for p in by_day["series"]) == 400.0


def test_a_bucket_still_running_is_never_compared_as_whole(client):
    company_id, user, headers = _owner()
    today = today_local()
    yesterday = today - timedelta(days=1)
    _invoice(company_id, user, "Доставчик В", yesterday, 200.0)
    week_ago = Period(yesterday - timedelta(days=6), today)

    detail = client.get(
        f"/api/statistics/supplier/Доставчик В/detailed?start_date={week_ago.start_text}&end_date={week_ago.end_text}&group_by=day",
        headers=headers,
    ).json()
    days = {point["key"]: point for point in detail["series"]}
    # Today isn't over: partial, so no "-100% vs yesterday" for a day still running.
    assert days[today.isoformat()]["is_partial"] is True
    assert days[today.isoformat()]["growth_percent"] is None
    assert days[yesterday.isoformat()]["is_partial"] is False
    assert days[yesterday.isoformat()]["amount"] == 200.0

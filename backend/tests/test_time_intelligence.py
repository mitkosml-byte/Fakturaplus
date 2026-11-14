"""Regression tests for how the app reads time (P0 of the intelligence
analysis): a day with no revenue entered is unknown, not a zero-revenue
day, and a month still in progress never counts as a whole month in a
forecast. Each test builds its own company, so it does not depend on
test order."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import server
from routers.statistics import _missing_revenue_days, _weak_day_suggestion


def _new_company(permissions):
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = server.User(
        user_id=user_id, email=f"{user_id}@test.com", name="Time Test Owner", role="owner",
        company_id=company_id, permissions=permissions,
    )
    return company_id, user


async def _register(user):
    await server.db.users.insert_one({
        "user_id": user.user_id, "email": user.email, "name": user.name, "role": "owner",
        "company_id": user.company_id, "permissions": user.permissions,
        "auth_provider": "email", "has_password": True,
        "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc),
    })


def test_forgotten_days_are_not_a_weak_weekday_and_are_asked_for():
    """Every open day earns 150; three Mondays were simply never entered.
    Counting them as 0 used to report "Monday is far below average" -
    now Monday averages its five logged days (150) and the missing recent
    Monday is asked for instead, with the entry form opened on that day."""
    company_id, user = _new_company(["view_statistics", "add_revenue"])
    today = datetime.now(timezone.utc).date()
    mondays = [today - timedelta(days=i) for i in range(1, 57) if (today - timedelta(days=i)).weekday() == 0]
    forgotten = {mondays[0], mondays[2], mondays[4]}

    async def _run():
        await _register(user)
        await server.db.daily_revenue.insert_many([
            {"user_id": user.user_id, "date": d.isoformat(), "fiscal_revenue": 150, "pocket_money": 0, "card_revenue": 0}
            for d in (today - timedelta(days=i) for i in range(1, 57)) if d not in forgotten
        ])
        suggestion = await _weak_day_suggestion(company_id)
        missing = await _missing_revenue_days(company_id)
        signal = await server._signal_missing_revenue(company_id, {}, user, {})
        return suggestion, missing, signal

    suggestion, missing, signal = asyncio.run(_run())
    assert suggestion is None
    assert missing == [mondays[0].isoformat()]
    assert signal["key"] == "missing_revenue"
    assert signal["route"].endswith(f"revenueDate={mondays[0].isoformat()}")


def test_missing_revenue_stays_quiet_for_a_company_that_does_not_log_daily():
    company_id, user = _new_company(["view_statistics", "add_revenue"])
    today = datetime.now(timezone.utc).date()

    async def _run():
        await _register(user)
        # One entry a week - this company doesn't log day by day.
        await server.db.daily_revenue.insert_many([
            {"user_id": user.user_id, "date": (today - timedelta(days=d)).isoformat(),
             "fiscal_revenue": 900, "pocket_money": 0, "card_revenue": 0}
            for d in (2, 9, 16, 23)
        ])
        return await _missing_revenue_days(company_id)

    assert asyncio.run(_run()) == []


def test_forecast_counts_only_complete_months():
    """Five complete months rising by 100 each, plus a few days of the
    month in progress. The month in progress must not enter the history
    (it read as a collapse at the start of every month), and next month's
    forecast steps over it: 1400 + 2 x 100."""
    company_id, user = _new_company(["view_statistics"])
    now = datetime.now(timezone.utc)

    def month_back(k):
        y, m = server._ym_add(now.year, now.month, -k)
        return f"{y}-{m:02d}"

    async def _run():
        await _register(user)
        docs = [
            {"user_id": user.user_id, "date": f"{month_back(k)}-02", "fiscal_revenue": 1000 + 100 * (5 - k),
             "pocket_money": 0, "card_revenue": 0}
            for k in range(1, 6)
        ]
        docs.append({"user_id": user.user_id, "date": now.strftime("%Y-%m-01"), "fiscal_revenue": 50,
                     "pocket_money": 0, "card_revenue": 0})
        await server.db.daily_revenue.insert_many(docs)
        return await server.forecast_service.get_revenue_forecast(company_id, months_ahead=2)

    result = asyncio.run(_run())
    assert [h["month"] for h in result["historical"]] == [month_back(k) for k in range(5, 0, -1)]
    assert result["trend"] == "increasing"
    next_y, next_m = server._ym_add(now.year, now.month, 1)
    assert result["forecast"][0]["month"] == f"{next_y}-{next_m:02d}"
    assert result["forecast"][0]["predicted_amount"] == 1600
    assert result["forecast"][1]["predicted_amount"] == 1700


def test_forecast_lookback_presets_are_whole_months():
    from services.forecast_service import _resolve_window

    now = datetime.now(timezone.utc)
    start, end = _resolve_window(90, None, None)
    assert end == datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    assert start.day == 1 and (end.year * 12 + end.month) - (start.year * 12 + start.month) == 3

    # A custom range counts a month only when it covers it to its last day.
    start, end = _resolve_window(None, "2025-03-15", "2025-06-30")
    assert (start.month, end.month) == (4, 7)

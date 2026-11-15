"""The year-back reading (P1 of the intelligence analysis): some businesses
run on a yearly rhythm, which a straight trend line reads as growth or a
fall. The app reads next month from last year's same month only when the
company's OWN history shows that works better than the trend line - no
trade or season is assumed. All data here is synthetic: a yearly shape
(a cosine with any peak month), steady growth, or flat noise."""
import asyncio
import calendar
import math
import uuid
from datetime import datetime, timezone

import pytest

import server
from services import forecast_service as fs


def _months_back(count):
    """The last `count` whole months, oldest first, as (year, month)."""
    now = datetime.now(timezone.utc)
    return [fs._ym_add(now.year, now.month, -back) for back in range(count, 0, -1)]


def _next_month():
    now = datetime.now(timezone.utc)
    return fs._ym_add(now.year, now.month, 1)


def _yearly_shape(peak_month, amplitude=0.5):
    """A month's multiplier on a yearly cosine peaking in `peak_month`."""
    return lambda year, month: 1 + amplitude * math.cos(2 * math.pi * ((month - peak_month) % 12) / 12)


def _series(monthly_value, months=30):
    return {fs._month_key(y, m): monthly_value(y, m, i) for i, (y, m) in enumerate(_months_back(months))}


def test_year_back_reading_is_confirmed_only_for_a_yearly_rhythm():
    now = datetime.now(timezone.utc)
    shape = _yearly_shape(peak_month=_next_month()[1])
    rhythm = _series(lambda y, m, i: 10000 * shape(y, m) * (1.004 ** i))
    analysis = fs._year_back_analysis(rhythm, now)
    assert analysis["confirmed"] is True
    assert analysis["error"] < 0.05 < analysis["trend_error"]
    assert 1.03 < analysis["level_ratio"] < 1.07  # ~5% a year of growth

    growing = _series(lambda y, m, i: 8000 + 150 * i + (300 if i % 2 else -300))
    assert fs._year_back_analysis(growing, now)["confirmed"] is False

    # Under ~16 months nothing can be scored, so nothing is claimed.
    assert fs._year_back_analysis(_series(lambda y, m, i: 10000 * shape(y, m), months=14), now) is None


def test_forecast_reads_next_month_from_last_year_when_confirmed():
    """Revenue that peaks every year in the current month: the trend line
    through the rising last six months overshoots next month, the
    year-back reading has it right."""
    now = datetime.now(timezone.utc)
    shape = _yearly_shape(peak_month=now.month)
    series = _series(lambda y, m, i: 10000 * shape(y, m))
    year_back = fs._year_back_analysis(series, now)
    historical = [{"month": k, "amount": v} for k, v in sorted(series.items())][-6:]
    expected = 10000 * shape(*_next_month())

    result = fs._build_forecast(historical, 2, year_back)
    assert result["method"] == "year_back"
    next_month = result["forecast"][0]
    assert next_month["basis"] == "year_back"
    assert next_month["predicted_amount"] == pytest.approx(expected, rel=0.03)
    assert next_month["same_month_last_year"] == pytest.approx(expected, rel=0.01)
    assert result["vs_last_year_percent"] == pytest.approx(0, abs=1)
    assert "series" not in result["year_back"]

    plain = fs._build_forecast(historical, 2, None)
    assert plain["method"] == "trend" and plain["forecast"][0]["predicted_amount"] > expected * 1.1


def _company():
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = server.User(
        user_id=user_id, email=f"{user_id}@test.com", name="Year Back Owner", role="owner",
        company_id=company_id, permissions=["view_statistics", "view_pocket_money", "view_off_book_expenses"],
    )
    return company_id, user


async def _seed_revenue(user, monthly_value, months=30, skip_days_in=None):
    await server.db.users.insert_one({
        "user_id": user.user_id, "email": user.email, "name": user.name, "role": "owner",
        "company_id": user.company_id, "permissions": user.permissions,
        "auth_provider": "email", "has_password": True,
        "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc),
    })
    docs = []
    for i, (y, m) in enumerate(_months_back(months)):
        days = calendar.monthrange(y, m)[1]
        logged_days = range(1, days + 1)
        if skip_days_in and (y, m) == skip_days_in:
            logged_days = range(1, 6)  # entered on 5 days only
        for day in logged_days:
            docs.append({
                "user_id": user.user_id, "date": f"{y}-{m:02d}-{day:02d}",
                "fiscal_revenue": round(monthly_value(y, m, i) / days, 2), "pocket_money": 0, "card_revenue": 0,
            })
    await server.db.daily_revenue.insert_many(docs)


def test_heads_up_before_a_month_far_from_the_usual_one(monkeypatch):
    """Revenue that peaks every year in the month after next... and in the
    month just before the current one, so the last six months fell toward
    a trough: the year-back reading says next month is weak and warns
    ahead of it, and the fall a yearly rhythm explains is not reported as
    a downward trend."""
    monkeypatch.setattr(server, "YEAR_BACK_NOTICE_FROM_DAY", 1)
    next_year, next_month = _next_month()
    company_id, user = _company()
    peak = (next_month - 7 - 1) % 12 + 1  # six months before the current one
    shape = _yearly_shape(peak_month=peak)

    async def _run():
        await _seed_revenue(user, lambda y, m, i: 10000 * shape(y, m) * (1.004 ** i))
        visibility = server.get_financial_visibility(user)
        return await server._signal_forecast(company_id, {}, user, visibility)

    signals = asyncio.run(_run())
    by_key = {s["key"]: s for s in signals}
    assert "forecast_revenue" not in by_key  # the old trend line would say "falling"
    notice = by_key["year_back_revenue"]
    assert notice["title"] == "Предстои по-слаб месец"
    assert server._MONTHS_BG_GENITIVE[next_month - 1] in notice["detail"]
    assert notice["fingerprint"] == f"{next_year}-{next_month:02d}"


def test_a_month_logged_on_a_few_days_is_unknown_not_a_weak_month():
    company_id, user = _company()
    months = _months_back(30)
    half_logged = months[-8]

    async def _run():
        await _seed_revenue(user, lambda y, m, i: 10000.0, skip_days_in=half_logged)
        now = datetime.now(timezone.utc)
        end = fs._month_start(now.year, now.month)
        start = fs._month_start(*months[0])
        scope = await server.forecast_service._company_scope(company_id)
        _, entered = await server.forecast_service._revenue_monthly_totals(scope, start, end, True)
        return await server.forecast_service._known_revenue_months(company_id, entered, fs._month_key(*months[0]), end)

    known = asyncio.run(_run())
    assert fs._month_key(*half_logged) not in known
    assert fs._month_key(*months[-1]) in known and len(known) == 29

"""One number everywhere (P0 of the logical-sync analysis): the same period
gives the same totals in every module that reports it - Home/Statistics,
the budget, supplier statistics, the invoice list, the forecast history,
the ROI card and the chat's look-ups - whatever device or time of day an
invoice date was picked at."""
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

import server
from routers.chat_tools import ChatDataTools
from services.business_calendar import Period, business_day, day_start_utc, is_stored_day, stored_day

OCT = ("2026-10-01", "2026-10-31")


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
        await server.db.companies.insert_one({"id": company_id, "name": "Период ООД", "owner_id": user_id, "closed_weekdays": []})
        await server.db.users.insert_one(dict(doc))
        await server.db.user_sessions.insert_one({
            "user_id": user_id, "session_token": token, "expires_at": now + timedelta(days=1), "created_at": now,
        })

    asyncio.run(_seed())
    return company_id, server.User(**doc), {"Authorization": f"Bearer {token}"}


def _seed_october(client, company_id, user, headers):
    """Revenue 100 EUR every day of October, two off-book expenses of 40,
    payroll of 3100 for October, and four invoices dated the way devices
    send them: a plain day, a phone pick (the day plus the time it was
    picked at, in UTC), and two web picks (local midnight, in UTC - the
    evening before)."""
    async def _rows():
        day = date(2026, 10, 1)
        while day.month == 10:
            await server.db.daily_revenue.insert_one({
                "id": uuid.uuid4().hex, "user_id": user.user_id, "company_id": company_id, "date": day.isoformat(),
                "fiscal_revenue": 100.0, "pocket_money": 0.0, "card_revenue": 0.0, "vat_rate_percent": 20.0,
            })
            day += timedelta(days=1)
        for when in ("2026-10-05", "2026-10-20"):
            await server.db.expenses.insert_one({
                "id": uuid.uuid4().hex, "user_id": user.user_id, "company_id": company_id, "date": when,
                "amount": 40.0, "description": "Разход",
            })
        await server.db.payroll_entries.insert_one({
            "id": uuid.uuid4().hex, "company_id": company_id, "user_id": user.user_id, "employee_id": "e1",
            "period_month": 10, "period_year": 2026, "total_employer_cost": 3100.0,
        })
        await server.db.budgets.insert_one({
            "id": uuid.uuid4().hex, "company_id": company_id, "user_id": user.user_id, "month": "2026-10",
            "expense_limit": 10000.0, "alert_threshold": 80,
        })

    asyncio.run(_rows())
    invoices = [
        ("A-1", "2026-10-01", 120.0),                  # a plain day
        ("B-2", "2026-10-31T13:00:00.000Z", 240.0),    # 31 Oct picked on a phone at 15:00
        ("C-3", "2026-10-31T22:00:00.000Z", 360.0),    # 1 Nov picked on the web (EET midnight)
        ("D-4", "2026-09-30T21:00:00.000Z", 480.0),    # 1 Oct picked on the web (EEST midnight)
    ]
    for number, when, total in invoices:
        r = client.post("/api/invoices", headers=headers, json={
            "supplier": "Доставчик Период", "invoice_number": f"{company_id}-{number}",
            "amount_without_vat": round(total / 1.2, 2), "vat_amount": round(total - total / 1.2, 2),
            "total_amount": total, "date": when, "payment_method": "cash",
        })
        assert r.status_code == 200, r.text


def _summary(client, headers, start, end):
    r = client.get(f"/api/statistics/summary?start_date={start}&end_date={end}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_every_module_gives_the_same_month(client):
    company_id, user, headers = _owner()
    _seed_october(client, company_id, user, headers)

    oct_ = _summary(client, headers, *OCT)
    assert oct_["invoice_count"] == 3 and oct_["total_invoice_amount"] == 840.0
    assert oct_["total_income"] == 3100.0
    assert oct_["total_payroll_cost"] == 3100.0
    assert oct_["total_expense"] == 4020.0          # 840 invoices + 80 off-book + 3100 payroll
    assert oct_["profit"] == -920.0
    assert oct_["period"] == {"start_date": "2026-10-01", "end_date": "2026-10-31", "days": 31, "through_date": "2026-10-31"}

    # The web pick of 1 November is November's, not October's (or nobody's).
    nov = _summary(client, headers, "2026-11-01", "2026-11-30")
    assert nov["invoice_count"] == 1 and nov["total_invoice_amount"] == 360.0

    # Budget.
    budget = asyncio.run(server.compute_budget_status(company_id, "2026-10"))
    assert budget["total_spent"] == oct_["total_expense"]

    # Supplier statistics for the same days.
    sup = client.get(f"/api/statistics/suppliers?start_date={OCT[0]}&end_date={OCT[1]}", headers=headers).json()
    assert sup["totals"]["invoice_count"] == 3 and sup["totals"]["total_amount"] == 840.0

    # The invoice list - with plain days, and with a device's local
    # midnights sent as UTC moments.
    for start, end in (OCT, ("2026-09-30T21:00:00.000Z", "2026-10-31T21:59:59.000Z")):
        r = client.get(f"/api/invoices?start_date={start}&end_date={end}", headers=headers)
        assert r.status_code == 200, r.text
        assert r.headers["X-Total-Count"] == "3" and r.headers["X-Total-Amount"] == "840.00"

    # Forecast history.
    fc = client.get("/api/forecast/expenses?months_ahead=1&lookback_days=180", headers=headers).json()
    assert {h["month"]: h["amount"] for h in fc["historical"]}["2026-10"] == pytest.approx(oct_["total_expense"])

    # ROI card.
    roi = client.get("/api/roi/analysis?year=2026&month=10", headers=headers)
    assert roi.status_code == 200, roi.text
    assert roi.json()["total_business_expense"] == oct_["total_expense"]
    assert roi.json()["total_revenue"] == oct_["total_income"]

    # The chat's look-up.
    async def _chat():
        _, scope = await server.get_company_scope(user)
        tools = ChatDataTools(user, company_id, scope, server.get_financial_visibility(user))
        return await tools.period_totals(*OCT)

    chat = asyncio.run(_chat())
    assert chat["expenses"] == oct_["total_expense"] and chat["revenue"] == oct_["total_income"]
    assert chat["invoice_count"] == 3


def test_monthly_costs_are_shared_by_days_and_the_halves_add_up(client):
    company_id, user, headers = _owner()
    _seed_october(client, company_id, user, headers)
    first = _summary(client, headers, "2026-10-01", "2026-10-15")
    second = _summary(client, headers, "2026-10-16", "2026-10-31")
    whole = _summary(client, headers, *OCT)
    # 15/31 and 16/31 of October's payroll - not all of it in one half.
    assert first["total_payroll_cost"] == 1500.0 and second["total_payroll_cost"] == 1600.0
    for field in ("total_expense", "total_income", "invoice_count", "total_invoice_amount"):
        assert first[field] + second[field] == pytest.approx(whole[field])
    # A single day carries its invoice and its share of the month.
    last_day = _summary(client, headers, "2026-10-31", "2026-10-31")
    assert last_day["invoice_count"] == 1 and last_day["total_invoice_amount"] == 240.0
    assert last_day["total_payroll_cost"] == 100.0


def test_saved_invoice_dates_are_their_business_days(client):
    company_id, user, headers = _owner()
    _seed_october(client, company_id, user, headers)

    async def _dates():
        docs = await server.db.invoices.find({"company_id": company_id}, {"_id": 0, "invoice_number": 1, "date": 1}).to_list(None)
        return {d["invoice_number"][len(company_id) + 1:]: d["date"] for d in docs}

    dates = asyncio.run(_dates())
    assert all(is_stored_day(value) for value in dates.values())
    assert {k: business_day(v).isoformat() for k, v in dates.items()} == {
        "A-1": "2026-10-01", "B-2": "2026-10-31", "C-3": "2026-11-01", "D-4": "2026-10-01",
    }


def test_more_than_a_thousand_invoices_are_all_counted(client):
    company_id, user, headers = _owner()

    async def _many():
        await server.db.invoices.insert_many([
            {"id": uuid.uuid4().hex, "user_id": user.user_id, "company_id": company_id, "supplier": "Много",
             "invoice_number": f"M-{i}", "total_amount": 10.0, "vat_amount": 0.0, "amount_without_vat": 10.0,
             "date": day_start_utc(date(2026, 10, 1 + i % 31)), "payment_method": "cash", "is_paid": True}
            for i in range(1205)
        ])

    asyncio.run(_many())
    oct_ = _summary(client, headers, *OCT)
    assert oct_["invoice_count"] == 1205 and oct_["total_invoice_amount"] == 12050.0
    r = client.get(f"/api/invoices?start_date={OCT[0]}&end_date={OCT[1]}&limit=50", headers=headers)
    assert r.headers["X-Total-Count"] == "1205" and r.headers["X-Total-Amount"] == "12050.00"


def test_old_invoice_dates_are_moved_onto_their_business_days_once():
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    legacy = {
        "web-1-nov": datetime(2026, 10, 31, 22, 0, tzinfo=timezone.utc),     # becomes 1 Nov
        "phone-31-oct": datetime(2026, 10, 31, 13, 0, tzinfo=timezone.utc),  # stays 31 Oct
        "ocr-15-oct": datetime(2026, 10, 15, tzinfo=timezone.utc),           # already a day
    }

    async def _run():
        for key, when in legacy.items():
            await server.db.invoices.insert_one({
                "id": key + company_id, "company_id": company_id, "supplier": "Стар", "invoice_number": key,
                "total_amount": 1.0, "date": when, "payment_due_date": when + timedelta(days=14),
            })
        await server.db.data_migrations.delete_one({"_id": "invoice_business_days_v1"})
        first = await server.migrate_invoice_dates_to_business_days()
        second = await server.migrate_invoice_dates_to_business_days()
        docs = await server.db.invoices.find({"company_id": company_id}, {"_id": 0, "invoice_number": 1, "date": 1, "payment_due_date": 1}).to_list(None)
        backups = await server.db.data_migration_backups.count_documents({"migration": "invoice_business_days_v1", "original.date": {"$in": list(legacy.values())}})
        return first, second, {d["invoice_number"]: d for d in docs}, backups

    first, second, docs, backups = asyncio.run(_run())
    assert first["invoices"] >= 2 and second == {"skipped": True}
    assert business_day(docs["web-1-nov"]["date"]) == date(2026, 11, 1)
    assert business_day(docs["phone-31-oct"]["date"]) == date(2026, 10, 31)
    assert business_day(docs["ocr-15-oct"]["date"]) == date(2026, 10, 15)
    assert all(is_stored_day(d["date"]) and is_stored_day(d["payment_due_date"]) for d in docs.values())
    assert backups == 2


@pytest.mark.parametrize("value, expected", [
    ("2026-11-01", date(2026, 11, 1)),
    ("2026-10-31T22:00:00.000Z", date(2026, 11, 1)),      # web: local midnight, in UTC
    ("2026-10-31T13:00:00+00:00", date(2026, 10, 31)),    # phone: the time it was picked at
    (datetime(2026, 7, 31, 21, 30), date(2026, 8, 1)),     # stored naive UTC, summer time
    (None, None),
])
def test_business_day_reads_every_form_a_date_arrives_in(value, expected):
    assert business_day(value) == expected


def test_period_shares_and_filters():
    october = Period.month(2026, 10)
    assert october.days == 31 and Period.parse(*OCT) == october
    assert Period(date(2026, 10, 1), date(2026, 10, 15)).month_share(2026, 10) == pytest.approx(15 / 31)
    assert Period.week_of(date(2026, 11, 15)) == Period(date(2026, 11, 9), date(2026, 11, 15))
    assert october.datetime_filter() == {
        "$gte": datetime(2026, 10, 1, tzinfo=timezone.utc), "$lt": datetime(2026, 11, 1, tzinfo=timezone.utc),
    }
    assert stored_day("2026-10-31T22:00:00.000Z") == datetime(2026, 11, 1, tzinfo=timezone.utc)

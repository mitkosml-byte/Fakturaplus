"""The daily review in the app's language. An app in English got its Home
signals in Bulgarian ("Архив на данните", "Защити входа"...): every
signal is written in English when the app says so, in Bulgarian when it
says so or says nothing - and the morning push follows the language the
app last said.

The business, its suppliers, customers, items and units have Latin names
here (they are the user's own words, shown as written), so any Cyrillic
left in an English signal is a text that was not translated.
Invented data."""
import asyncio
import re
from datetime import datetime, timedelta, timezone

import server
from services.business_calendar import day_start_utc, today_local
from tests.test_reorder_plan import _bought
from tests.test_whole_program_fixes import _company

CYRILLIC = re.compile(r"[Ѐ-ӿ]")


def _seed(company_id: str, owner_id: str) -> None:
    today = today_local()
    now = datetime.now(timezone.utc)

    def invoice(number, supplier, days_ago, total, due_in=None, paid=False):
        return {
            "id": f"inv-{number}", "company_id": company_id, "user_id": owner_id, "supplier": supplier,
            "invoice_number": number, "date": day_start_utc(today - timedelta(days=days_ago)),
            "amount_without_vat": round(total / 1.2, 2), "vat_amount": round(total - total / 1.2, 2), "total_amount": total,
            "payment_method": "bank_transfer" if due_in is not None else "cash", "is_paid": paid, "paid_amount": total if paid else 0.0,
            "payment_due_date": day_start_utc(today + timedelta(days=due_in)) if due_in is not None else None,
            "created_at": now,
        }

    asyncio.run(server.db.invoices.insert_many([
        # Overdue; overdue but bought from again after it (most likely paid); due this week.
        invoice("1001", "Northwind Ltd", 40, 600.0, due_in=-10),
        invoice("1002", "Contoso Ltd", 45, 240.0, due_in=-20),
        invoice("1003", "Contoso Ltd", 5, 120.0, paid=True),
        invoice("1004", "Adatum Ltd", 3, 180.0, due_in=1),
    ] + [invoice(f"20{n:02d}", "Litware Ltd", n, 50.0, paid=True) for n in range(6, 20)]))
    # The till's days, two of the last week left out.
    asyncio.run(server.db.daily_revenue.insert_many([
        {"company_id": company_id, "user_id": owner_id, "date": (today - timedelta(days=n)).isoformat(),
         "fiscal_revenue": 400.0, "pocket_money": 0.0, "card_revenue": 0.0}
        for n in range(1, 27) if n not in (3, 5)
    ]))
    asyncio.run(server.db.receivables.insert_one({
        "id": "rec-1", "company_id": company_id, "user_id": owner_id, "customer_name": "Fabrikam Inc",
        "amount": 360.0, "paid_amount": 0.0, "is_paid": False, "due_date": (today - timedelta(days=5)).isoformat(),
        "created_at": now,
    }))
    asyncio.run(server.db.price_alerts.insert_one({
        "id": "alert-1", "company_id": company_id, "status": "unread", "item_name": "flour", "supplier": "Northwind Ltd",
        "kind": "increase", "monthly_impact": 120.0, "change_percent": 15.0, "old_price": 1.0, "new_price": 1.15,
        "created_at": now,
    }))
    asyncio.run(server.db.item_price_history.insert_many(
        # Every week, last bought two weeks ago: time to reorder.
        _bought(company_id, "Northwind Ltd", "olive oil", [35, 28, 21, 14], quantity=6, unit="pcs")
        # Every 3 days, last a month ago: still bought at all?
        + _bought(company_id, "Litware Ltd", "paper cups", [43, 40, 37, 34, 31], quantity=50, unit_price=0.1, unit="pcs")
    ))
    asyncio.run(server.db.employee_leave.insert_one({
        "id": "leave-1", "company_id": company_id, "employee_name": "Anna Smith", "leave_type": "sick",
        "start_date": today.isoformat(), "end_date": today.isoformat(),
    }))
    asyncio.run(server.db.deadlines.insert_one({
        "id": "deadline-1", "company_id": company_id, "title": "Insurance renewal", "category": "other",
        "due_date": (today + timedelta(days=2)).isoformat(), "is_active": True, "remind_days_before": 7, "repeat": None,
    }))
    # Ten euro in hand: the overdue invoice alone takes it below zero.
    asyncio.run(server.db.cash_positions.insert_one({
        "id": "cash-1", "company_id": company_id, "date": today.isoformat(), "cash": 10.0, "bank": 0.0,
        "created_at": now,
    }))


EXPECTED = {
    "unpaid_invoices", "invoices_likely_paid", "receivables", "backup", "two_factor", "payments_this_week",
    "price_alerts", "reorder", "reorder_stale", "vat_registration", "deadlines", "cash_flow", "missing_revenue",
}


def test_the_review_in_the_apps_language(client):
    company_id, owner_id, owner = _company()
    _seed(company_id, owner_id)

    english = client.get("/api/proactive/signals?lang=en", headers=owner).json()["signals"]
    assert EXPECTED <= {s["key"] for s in english}
    for signal in english:
        text = f"{signal['title']} {signal['detail']}"
        assert not CYRILLIC.search(text), (signal["key"], text)
    by_key = {s["key"]: s for s in english}
    assert by_key["backup"]["title"] == "Data backup" and by_key["two_factor"]["title"] == "Protect your sign-in"
    # Three unpaid by bank: one overdue, one most likely paid, one due tomorrow.
    assert by_key["unpaid_invoices"]["detail"] == "1 of 3 unpaid invoices is overdue - 600.00\u00a0€ in all."

    # Bulgarian when the app says so - and when it says nothing.
    for query in ("?lang=bg", ""):
        bulgarian = {s["key"]: s for s in client.get(f"/api/proactive/signals{query}", headers=owner).json()["signals"]}
        assert EXPECTED <= set(bulgarian)
        assert bulgarian["backup"]["title"] == "Архив на данните" and bulgarian["two_factor"]["title"] == "Защити входа"
        assert all(CYRILLIC.search(bulgarian[key]["title"]) for key in EXPECTED - {"reorder_stale"})
    # The same signals either way: one "done" holds for both languages.
    assert {s["key"]: s["fingerprint"] for s in english} == {
        s["key"]: s["fingerprint"] for s in client.get("/api/proactive/signals?lang=bg", headers=owner).json()["signals"]}


def test_home_and_the_morning_push_follow_the_app(client):
    company_id, owner_id, owner = _company()
    _seed(company_id, owner_id)
    today = today_local()
    period = {"start_date": today.replace(day=1).isoformat(), "end_date": today.isoformat()}

    home = client.get("/api/home", headers=owner, params={**period, "language": "en"}).json()
    assert home["signals"] and not any(CYRILLIC.search(f"{s['title']} {s['detail']}") for s in home["signals"])
    # The app said English: what the program writes on its own is English too.
    assert asyncio.run(server.db.users.find_one({"user_id": owner_id}))["language"] == "en"
    body = asyncio.run(server.periodic_reminder_body(owner_id))
    assert body.startswith("Waiting for you: ") and not CYRILLIC.search(body.replace("Northwind", ""))

    client.get("/api/home", headers=owner, params={**period, "language": "bg"})
    assert asyncio.run(server.periodic_reminder_body(owner_id)).startswith("Чака те: ")


def test_pure_texts_in_english():
    language = server._SIGNALS_ENGLISH.set(True)
    try:
        trend = server._forecast_trend_signal(
            {"trend": "decreasing", "confidence": 0.8, "trend_percent": -20}, {"trend": "stable", "confidence": 0.8, "trend_percent": 0})
        assert trend["title"] == "Revenue is trending down"
        notice = server._year_back_notice("revenue", {
            "forecast": [{"basis": "year_back", "month": "2026-12", "same_month_last_year": 15000, "predicted_amount": 14800}],
            "year_back": {"last_12_months_average": 10000},
        })
        assert notice["title"] == "A stronger month is coming" and "December" in notice["detail"]
        assert server._bg_day_list(["2026-11-02", "2026-11-05", "2026-11-09"]) == "2, 5 and 9 November"
        assert not any(CYRILLIC.search(text) for text in (trend["detail"], notice["detail"]))
    finally:
        server._SIGNALS_ENGLISH.reset(language)
    # Outside an English review: Bulgarian, as before.
    assert server._bg_day_list(["2026-11-02", "2026-11-05"]) == "2 и 5 ноември"

"""The whole-program logical analysis, fixed: each test pins one finding
(the code in the analysis doc is in the test name) so it cannot come back."""
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

import server
from services.business_calendar import Period, today_local


def _user(company_id, role, permissions, name):
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    token = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": user_id, "email": f"{user_id}@test.com", "name": name, "role": role,
        "company_id": company_id, "permissions": permissions, "auth_provider": "email",
        "has_password": True, "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION, "created_at": now,
    }

    async def _seed():
        await server.db.users.insert_one(dict(doc))
        await server.db.user_sessions.insert_one({
            "user_id": user_id, "session_token": token, "expires_at": now + timedelta(days=1), "created_at": now,
        })
    asyncio.run(_seed())
    return user_id, {"Authorization": f"Bearer {token}"}


def _company():
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    asyncio.run(server.db.companies.insert_one({"id": company_id, "name": "Проба ООД", "owner_id": "x", "closed_weekdays": []}))
    owner_id, owner = _user(company_id, "owner", list(server.ROLE_PERMISSIONS["owner"]), "Собственик")
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"owner_id": owner_id}}))
    return company_id, owner_id, owner


def test_p1_pocket_money_is_never_wiped_by_someone_who_cannot_see_it(client):
    company_id, _, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    day = "2026-11-10"
    client.post("/api/daily-revenue", json={"date": day, "fiscal_revenue": 1000, "pocket_money": 300}, headers=owner)

    seen = client.get(f"/api/daily-revenue/by-date/{day}", headers=cashier).json()
    assert seen["pocket_money"] == 0
    # The cashier corrects the till total; the form would also send pocket 0.
    saved = client.post("/api/daily-revenue", json={"date": day, "fiscal_revenue": 1100, "pocket_money": 0,
                                                    "card_revenue": 0, "vat_rate_percent": 20}, headers=cashier)
    assert saved.status_code == 200 and saved.json()["pocket_money"] == 0   # not shown in the reply either
    after = client.get(f"/api/daily-revenue/by-date/{day}", headers=owner).json()
    assert after["fiscal_revenue"] == 1100 and after["pocket_money"] == 300

    # A field left out keeps what the day holds.
    client.post("/api/daily-revenue", json={"date": day, "card_revenue": 400}, headers=owner)
    again = client.get(f"/api/daily-revenue/by-date/{day}", headers=owner).json()
    assert (again["fiscal_revenue"], again["pocket_money"], again["card_revenue"]) == (1100, 300, 400)

    # A paid bill added to pocket money is added, never replacing it.
    added = client.post("/api/daily-revenue/add-pocket", json={"date": day, "amount": 50}, headers=cashier)
    assert added.status_code == 200
    assert client.get(f"/api/daily-revenue/by-date/{day}", headers=owner).json()["pocket_money"] == 350
    # On a day with nothing entered yet it starts the day.
    client.post("/api/daily-revenue/add-pocket", json={"date": "2026-11-11", "amount": 20}, headers=owner)
    assert client.get("/api/daily-revenue/by-date/2026-11-11", headers=owner).json()["pocket_money"] == 20
    rows = asyncio.run(server.db.daily_revenue.count_documents({"company_id": company_id}))
    assert rows == 2


def test_i3_an_empty_import_cell_keeps_what_the_day_holds(client):
    from services import import_service
    company_id, _, owner = _company()
    client.post("/api/daily-revenue", json={"date": "2026-11-03", "fiscal_revenue": 500, "pocket_money": 80}, headers=owner)
    table = import_service.ParsedTable(
        headers=["Дата", "Фискализиран оборот", "Джобче", "От тях - платено с карта", "ДДС ставка %"],
        rows=[["03.11.2026", "650", "", "", ""]],
    ) if hasattr(import_service, "ParsedTable") else None
    if table is None:
        pytest.skip("import table type not available")
    data, errors, _ = import_service._parse_daily_revenue_row(table.rows[0], table, {})
    assert not errors and "pocket_money" not in data
    commit = client.post("/api/import/daily_revenue/commit", json={"rows": [data]}, headers=owner)
    assert commit.status_code == 200, commit.text
    day = client.get("/api/daily-revenue/by-date/2026-11-03", headers=owner).json()
    assert day["fiscal_revenue"] == 650 and day["pocket_money"] == 80


def _local(day: date, hour: int, minute: int = 5) -> datetime:
    from services.business_calendar import BUSINESS_TZ
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)


def _capture_pushes(monkeypatch):
    sent = []

    async def fake_send(db, user_id, title, body, data=None):
        sent.append({"user_id": user_id, "title": title, "body": body, "data": data or {}})
    monkeypatch.setattr(server.push_service, "send_to_user", fake_send)
    return sent


def _with_device(*user_ids):
    async def _seed():
        for uid in user_ids:
            await server.db.push_subscriptions.insert_one({
                "user_id": uid, "endpoint": f"https://push.example/{uid}", "keys": {"p256dh": "x", "auth": "y"},
            })
    asyncio.run(_seed())


def _overdue_invoice(company_id, user_id):
    long_ago = datetime.now(timezone.utc) - timedelta(days=60)
    asyncio.run(server.db.invoices.insert_one({
        "id": f"inv-{uuid.uuid4().hex[:8]}", "company_id": company_id, "user_id": user_id,
        "supplier": f"Доставчик {uuid.uuid4().hex[:4]}", "invoice_number": "77", "date": long_ago,
        "total_amount": 480.0, "amount_without_vat": 400.0, "vat_amount": 80.0,
        "payment_method": "bank_transfer", "is_paid": False, "paid_amount": 0.0,
        "payment_due_date": long_ago + timedelta(days=7),
    }))


def test_c1_c2_each_person_gets_their_own_morning_review(monkeypatch):
    sent = _capture_pushes(monkeypatch)
    company_id, owner_id, _ = _company()
    manager_id, _ = _user(company_id, "manager", sorted(server.ROLE_PERMISSIONS["manager"]), "Управител")
    staff_id, _ = _user(company_id, "staff", [], "Служител")
    _overdue_invoice(company_id, owner_id)
    _with_device(owner_id, manager_id, staff_id)

    async def wallet_signal(company_id, scope, current_user, visibility):
        # Stands in for the owner-only personal-wallet warning.
        if "view_personal_wallet" not in set(current_user.permissions or []):
            return None
        return {"key": "personal_wallet", "severity": "critical", "priority": 95,
                "title": "Личният портфейл е на минус", "detail": "Само за собственика."}
    monkeypatch.setattr(server, "_PROACTIVE_SIGNAL_BUILDERS", [*server._PROACTIVE_SIGNAL_BUILDERS, wallet_signal])

    asyncio.run(server._morning_push_tick(now=_local(date(2026, 11, 16), 8)))
    mine = {p["user_id"]: p for p in sent if p["user_id"] in (owner_id, manager_id, staff_id)}

    assert mine[owner_id]["title"] == "Днешен преглед: Личният портфейл е на минус"
    # The manager gets their own review - the overdue invoice - never the owner's wallet.
    assert "портфейл" not in mine[manager_id]["title"] + mine[manager_id]["body"]
    assert "Просрочени" in mine[manager_id]["title"]
    assert mine[manager_id]["data"]["route"]
    # Someone who may not see invoices or figures gets no amounts at all.
    assert staff_id not in mine


def test_c3_the_morning_push_comes_at_the_chosen_hour_once_a_day_never_at_night(monkeypatch):
    sent = _capture_pushes(monkeypatch)
    company_id, owner_id, owner = _company()
    early_id, _ = _user(company_id, "manager", sorted(server.ROLE_PERMISSIONS["manager"]), "Ранобудна")
    late_id, late = _user(company_id, "manager", sorted(server.ROLE_PERMISSIONS["manager"]), "Късно ставащ")
    _overdue_invoice(company_id, owner_id)
    _with_device(owner_id, early_id, late_id)
    asyncio.run(server.db.notification_settings.insert_one(
        server.NotificationSettings(user_id=late_id, daily_push_hour=10).model_dump()))
    ours = lambda: [p["user_id"] for p in sent if p["user_id"] in (owner_id, early_id, late_id)]  # noqa: E731

    day = date(2026, 11, 17)
    asyncio.run(server._morning_push_tick(now=_local(day, 6)))
    assert ours() == []                                    # before anyone's hour
    asyncio.run(server._morning_push_tick(now=_local(day, 8)))
    assert sorted(ours()) == sorted([owner_id, early_id])  # 08:00 is the default
    asyncio.run(server._morning_push_tick(now=_local(day, 8, 40)))
    assert len(ours()) == 2                                # once a day, not every tick
    asyncio.run(server._morning_push_tick(now=_local(day, 10)))
    assert ours().count(late_id) == 1                      # the one who chose 10:00

    sent.clear()
    next_day = day + timedelta(days=1)
    asyncio.run(server._morning_push_tick(now=_local(next_day, 22)))
    asyncio.run(server._morning_push_tick(now=_local(next_day + timedelta(days=1), 0, 30)))
    assert ours() == []                                    # a missed morning never arrives at night


def test_c3_a_periodic_reminder_comes_in_the_morning_and_on_a_short_months_last_day(monkeypatch, client):
    sent = _capture_pushes(monkeypatch)
    company_id, owner_id, owner = _company()
    _with_device(owner_id)
    saved = client.put("/api/notifications/settings", headers=owner,
                       json={"periodic_enabled": True, "periodic_dates": [31, 15, 15], "daily_push_hour": 7})
    assert saved.status_code == 200 and saved.json()["periodic_dates"] == [15, 31]
    assert client.put("/api/notifications/settings", headers=owner, json={"daily_push_hour": 23}).status_code == 422
    assert client.put("/api/notifications/settings", headers=owner, json={"periodic_dates": [32]}).status_code == 422
    ours = lambda: [p for p in sent if p["user_id"] == owner_id]  # noqa: E731

    last_of_november = date(2026, 11, 30)
    asyncio.run(server._morning_push_tick(now=_local(last_of_november, 0, 10)))
    assert ours() == []                                    # not at midnight any more
    asyncio.run(server._morning_push_tick(now=_local(last_of_november, 7)))
    reminders = [p for p in ours() if p["data"].get("type") == "periodic_reminder"]
    assert len(reminders) == 1 and len(ours()) == 1        # the 31st falls on the 30th; one push, not two
    asyncio.run(server._morning_push_tick(now=_local(last_of_november, 9)))
    assert len(ours()) == 1


def test_c5_the_vat_threshold_notice_is_gone(client):
    _, _, owner = _company()
    settings = client.get("/api/notifications/settings", headers=owner).json()
    assert not any(key.startswith("vat_threshold") for key in settings)
    assert settings["daily_push_enabled"] is True and settings["daily_push_hour"] == server.DAILY_PUSH_DEFAULT_HOUR

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


@pytest.fixture
def no_rate_limit():
    """The restore endpoint allows 5 calls a minute per address - these
    tests restore more often than that from the one test client."""
    server.limiter.reset()
    server.limiter.enabled = False
    yield
    server.limiter.enabled = True


def test_i1_i2_a_full_backup_restores_everything_once_and_moves_between_companies(client, no_rate_limit):
    company_id, owner_id, owner = _company()
    worker_id, _ = _user(company_id, "staff", [], "Работник")

    customer = client.post("/api/customers", headers=owner, json={"name": "Клиент Едно"}).json()
    employee = client.post("/api/employees", headers=owner, json={"name": "Мария", "base_salary": 1200}).json()
    assert client.post("/api/payroll", headers=owner, json={
        "employee_id": employee["id"], "period_month": 10, "period_year": 2026,
    }).status_code == 200
    assert client.post("/api/receivables", headers=owner, json={
        "customer_id": customer["id"], "customer_name": "Клиент Едно", "description": "Кетъринг",
        "amount": 250, "due_date": "2026-11-30",
    }).status_code == 200
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-10-05", "fiscal_revenue": 900, "pocket_money": 120})
    client.post("/api/schedule/shifts", headers=owner, json={
        "user_id": worker_id, "date": "2026-10-06", "start_time": "09:00", "end_time": "15:00", "hourly_rate": 10,
    })

    backup = client.post("/api/backup/create", headers=owner).json()
    assert backup["version"] == 2
    held = {name: len(docs) for name, docs in backup["collections"].items() if docs}
    for section in ("customers", "employees", "payroll_entries", "receivables", "daily_revenue", "work_shifts"):
        assert held.get(section), section
    assert backup["statistics"]["total_records"] >= sum(held.values())

    # Into the same company: everything is already here, nothing doubles.
    again = client.post("/api/backup/restore", headers=owner, json=backup).json()
    assert again["restored"]["total"] == 0 and again["already_present"] == sum(held.values())

    # Re-entered by hand under new ids: still recognised by what it is.
    asyncio.run(server.db.daily_revenue.delete_many({"company_id": company_id}))
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-10-05", "fiscal_revenue": 900, "pocket_money": 120})
    again = client.post("/api/backup/restore", headers=owner, json=backup).json()
    assert again["restored"]["revenues"] == 0
    days = asyncio.run(server.db.daily_revenue.count_documents({"company_id": company_id, "date": "2026-10-05"}))
    assert days == 1

    # Into another company: the records come along with their links kept,
    # under new ids; the shift of a person who isn't there is left out.
    other_id, _, other_owner = _company()
    moved = client.post("/api/backup/restore", headers=other_owner, json=backup).json()
    assert moved["restored"]["total"] > 0 and moved["not_in_team"] >= 1
    new_employee = asyncio.run(server.db.employees.find_one({"company_id": other_id, "name": "Мария"}, {"_id": 0}))
    new_payroll = asyncio.run(server.db.payroll_entries.find_one({"company_id": other_id}, {"_id": 0}))
    new_customer = asyncio.run(server.db.customers.find_one({"company_id": other_id}, {"_id": 0}))
    new_receivable = asyncio.run(server.db.receivables.find_one({"company_id": other_id}, {"_id": 0}))
    assert new_employee["id"] != employee["id"] and new_payroll["employee_id"] == new_employee["id"]
    assert new_receivable["customer_id"] == new_customer["id"] != customer["id"]
    assert asyncio.run(server.db.work_shifts.count_documents({"company_id": other_id})) == 0
    # The records' authors in the other company are its owner, not strangers.
    assert new_employee["user_id"] != owner_id

    # A file can never smuggle a query operator in.
    hostile = {"format": "fakturaplus-backup", "version": 2, "collections": {
        "expenses": [{"id": "x1", "description": {"$gt": ""}, "amount": 5, "date": "2026-10-01"}],
    }}
    result = client.post("/api/backup/restore", headers=other_owner, json=hostile).json()
    assert result["restored"]["total"] == 0 and result["skipped"]["total"] == 1


def test_i2_an_old_three_list_backup_still_restores(client, no_rate_limit):
    _, _, owner = _company()
    old = {
        "invoices": [{
            "id": f"inv-{uuid.uuid4().hex[:8]}", "supplier": "Метро", "invoice_number": "0001", "amount_without_vat": 100,
            "vat_amount": 20, "total_amount": 120, "date": "2026-09-30T21:00:00+00:00", "created_at": "2026-10-01T08:00:00+00:00",
        }],
        "daily_revenues": [{"id": f"rev-{uuid.uuid4().hex[:8]}", "date": "2026-10-01", "fiscal_revenue": 300}],
        "expenses": [],
    }
    result = client.post("/api/backup/restore", headers=owner, json=old).json()
    assert result["restored"]["invoices"] == 1 and result["restored"]["revenues"] == 1
    invoices = client.get("/api/invoices", headers=owner).json()
    # Midnight in Sofia sent as UTC is still the 1st, the day it showed.
    assert invoices[0]["date"].startswith("2026-10-01")
    assert client.post("/api/backup/restore", headers=owner, json=old).json()["restored"]["total"] == 0


def test_c1_duplicate_revenue_days_and_payroll_merge_into_one(monkeypatch):
    # Its own database, as it was before the unique indexes existed (the
    # in-memory test database cannot build a partial index over the other
    # tests' rows the way MongoDB does).
    from mongomock_motor import AsyncMongoMockClient
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()[f"dedupe_{uuid.uuid4().hex[:6]}"])
    company_id, owner_id = "company_dedupe", "user_dedupe"
    asyncio.run(server.db.users.insert_one({"user_id": owner_id, "company_id": company_id, "role": "owner"}))
    early = datetime(2026, 1, 1, tzinfo=timezone.utc)
    late = datetime(2026, 1, 2, tzinfo=timezone.utc)

    async def seed():
        rows = [
            # A copy (restore) and a complementary pocket-money row on the 3rd...
            {"id": "a", "company_id": company_id, "user_id": owner_id, "date": "2026-01-03", "fiscal_revenue": 500, "pocket_money": 0, "created_at": early},
            {"id": "b", "company_id": company_id, "user_id": owner_id, "date": "2026-01-03", "fiscal_revenue": 500, "pocket_money": 80, "created_at": late},
            # ...and two different till totals on the 4th: the later one is right.
            {"id": "c", "company_id": company_id, "user_id": owner_id, "date": "2026-01-04", "fiscal_revenue": 400, "created_at": early},
            {"id": "d", "company_id": company_id, "user_id": owner_id, "date": "2026-01-04", "fiscal_revenue": 450, "created_at": late},
        ]
        await server.db.daily_revenue.insert_many(rows)
        await server.db.payroll_entries.insert_many([
            {"id": "p1", "company_id": company_id, "employee_id": "emp-x", "period_year": 2026, "period_month": 1, "created_at": early},
            {"id": "p2", "company_id": company_id, "employee_id": "emp-x", "period_year": 2026, "period_month": 1, "created_at": late},
        ])
        result = await server.dedupe_revenue_days_and_payroll()
        await server.ensure_unique_records()
        return result

    result = asyncio.run(seed())
    assert (result["revenue_rows_removed"], result["payroll_removed"]) == (2, 1)
    third = asyncio.run(server.db.daily_revenue.find({"company_id": company_id, "date": "2026-01-03"}, {"_id": 0}).to_list(None))
    fourth = asyncio.run(server.db.daily_revenue.find({"company_id": company_id, "date": "2026-01-04"}, {"_id": 0}).to_list(None))
    assert len(third) == 1 and (third[0]["fiscal_revenue"], third[0]["pocket_money"]) == (500, 80)
    assert len(fourth) == 1 and fourth[0]["fiscal_revenue"] == 450
    payroll = asyncio.run(server.db.payroll_entries.find({"employee_id": "emp-x"}, {"_id": 0}).to_list(None))
    assert [p["id"] for p in payroll] == ["p2"]
    kept_aside = asyncio.run(server.db.data_migration_backups.count_documents({"migration": "dedupe_revenue_payroll_v1"}))
    assert kept_aside == 3

    # From now on a second record of the same day cannot be stored at all.
    from pymongo.errors import DuplicateKeyError
    with pytest.raises(DuplicateKeyError):
        asyncio.run(server.db.daily_revenue.insert_one(
            {"id": "e", "company_id": company_id, "user_id": owner_id, "date": "2026-01-03", "fiscal_revenue": 1}))


def test_z4_schedule_pay_leaves_out_days_of_leave(client):
    company_id, owner_id, owner = _company()
    worker_id, _ = _user(company_id, "staff", [], "Работник")
    employee = client.post("/api/employees", headers=owner, json={
        "name": "Работник", "base_salary": 1000, "linked_user_id": worker_id,
    }).json()
    # Mon-Fri 8h at 10 €/h, the Wednesday on leave.
    for day in ("2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11"):
        assert client.post("/api/schedule/shifts", headers=owner, json={
            "user_id": worker_id, "date": day, "start_time": "09:00", "end_time": "17:00", "hourly_rate": 10,
        }).status_code == 200
    assert client.post("/api/employees/leave", headers=owner, json={
        "employee_id": employee["id"], "leave_type": "paid", "start_date": "2026-12-09", "end_date": "2026-12-09",
    }).status_code == 200

    summary = client.get(f"/api/schedule/summary?start=2026-12-01&end=2026-12-31&user_id={worker_id}", headers=owner).json()
    assert (summary["total_hours"], summary["estimated_pay"], summary["leave_days_excluded"]) == (32, 320, 1)
    occ = client.get(f"/api/schedule/shifts?start=2026-12-01&end=2026-12-31&user_id={worker_id}", headers=owner)
    flags = {o["date"]: o["payable"] for o in occ.json()["occurrences"]}
    assert flags["2026-12-09"] is False and flags["2026-12-08"] is True

    paid = client.post("/api/schedule/payments", headers=owner, json={
        "user_id": worker_id, "period_start": "2026-12-01", "period_end": "2026-12-31",
    }).json()
    assert (paid["total_hours"], paid["amount"]) == (32, 320)


def test_c6_a_calendar_reminder_follows_the_business_clock(monkeypatch):
    sent = _capture_pushes(monkeypatch)
    company_id, owner_id, _ = _company()
    event_id = f"ev-{uuid.uuid4().hex[:8]}"
    asyncio.run(server.db.calendar_events.insert_one({
        "id": event_id, "company_id": company_id, "creator_id": owner_id, "creator_name": "Собственик",
        "title": "Доставка", "event_date": "2026-11-20", "event_time": "10:00", "visibility": "private",
        "reminder_minutes_before": 30, "reminder_sent": False,
    }))
    mine = lambda: [p for p in sent if p["data"].get("event_id") == event_id]  # noqa: E731
    # 09:20 in Sofia: not yet (it is 07:20 UTC - the old reading of 10:00
    # as UTC would wait until 09:30 UTC, two hours late).
    asyncio.run(server._calendar_reminder_tick(now=_local(date(2026, 11, 20), 9, 20)))
    assert mine() == []
    asyncio.run(server._calendar_reminder_tick(now=_local(date(2026, 11, 20), 9, 31)))
    assert len(mine()) == 1


def test_f1_a1_duplicates_by_company_and_eik(client):
    company_id, owner_id, owner = _company()

    def invoice(number, supplier, eik=None, day="2026-11-02"):
        return {"supplier": supplier, "supplier_eik": eik, "invoice_number": number, "date": day,
                "amount_without_vat": 100, "vat_amount": 20, "total_amount": 120, "payment_method": "cash"}

    first = client.post("/api/invoices", headers=owner, json=invoice("0000001234", "Зора Трейд ЕООД", "BG111111111"))
    assert first.status_code == 200, first.text
    # The same invoice typed again without the leading zeros.
    again = client.post("/api/invoices", headers=owner, json=invoice("1234", "Зора Трейд ЕООД", "111111111"))
    assert again.status_code == 409
    # Under another spelling of the name - the same EIK is the same supplier.
    renamed = client.post("/api/invoices", headers=owner, json=invoice("1234", "ЗОРА ТРЕЙД", "111111111"))
    assert renamed.status_code == 409
    other_number = client.post("/api/invoices", headers=owner, json=invoice("1235", "Zora trade", "111111111"))
    assert other_number.status_code == 200 and other_number.json()["supplier"] == "Зора Трейд ЕООД"

    # The same name and number from ANOTHER business (another EIK) is not a
    # duplicate, and stays a supplier of its own.
    namesake = client.post("/api/invoices", headers=owner, json=invoice("1234", "Зора Трейд ЕООД", "222222222"))
    assert namesake.status_code == 200, namesake.text
    assert namesake.json()["supplier"] != "Зора Трейд ЕООД" and "222222222" in namesake.json()["supplier"]

    # Someone who has since left the company entered it: still a duplicate.
    leaver_id, leaver = _user(company_id, "manager", sorted(server.ROLE_PERMISSIONS["manager"]), "Напуснал")
    assert client.post("/api/invoices", headers=leaver, json=invoice("77", "Бета ООД")).status_code == 200
    asyncio.run(server.db.users.update_one({"user_id": leaver_id}, {"$set": {"company_id": None}}))
    assert client.post("/api/invoices", headers=owner, json=invoice("077", "Бета ООД")).status_code == 409

    # An edit cannot turn one invoice into a copy of another.
    second = client.post("/api/invoices", headers=owner, json=invoice("5000", "Бета ООД")).json()
    clash = client.put(f"/api/invoices/{second['id']}", headers=owner, json={"invoice_number": "77"})
    assert clash.status_code == 409
    fine = client.put(f"/api/invoices/{second['id']}", headers=owner, json={"invoice_number": "5001"})
    assert fine.status_code == 200


def test_p2_c4_the_running_month_is_counted_through_today_everywhere(client):
    from routers.roi_wallet import _roi_month_data, _month_totals
    company_id, owner_id, owner = _company()
    today = today_local()
    month = Period.month(today.year, today.month)
    share = (today - month.start).days + 1
    share /= month.days

    employee = client.post("/api/employees", headers=owner, json={"name": "Мария", "base_salary": 1500}).json()
    assert client.post("/api/payroll", headers=owner, json={
        "employee_id": employee["id"], "period_month": today.month, "period_year": today.year,
    }).status_code == 200
    payroll_month = asyncio.run(server.db.payroll_entries.find_one({"employee_id": employee["id"]}, {"_id": 0}))["total_employer_cost"]
    client.post("/api/daily-revenue", headers=owner, json={"date": today.isoformat(), "fiscal_revenue": 1000})
    client.post("/api/budget", headers=owner, json={"month": f"{today:%Y-%m}", "expense_limit": 100000, "alert_threshold": 80})

    home = client.get(f"/api/statistics/summary?start_date={month.start_text}&end_date={month.end_text}", headers=owner).json()
    home_profit = home["total_income"] - home["total_expense"]

    scope = asyncio.run(server.company_data_scope(company_id))
    wallet_profit = asyncio.run(server._compute_month_profit(company_id, scope, owner_id, month.start_text, month.end_text))
    visibility = {"statistics": True, "pocket_money": True, "off_book_expenses": True, "profit": True, "personal_investments": True}
    chat = asyncio.run(server._business_digest_period(company_id, scope, owner_id, month.start_text, month.end_text, visibility))
    roi_raw = asyncio.run(_roi_month_data(company_id, scope, owner_id, visibility, [(today.year, today.month)]))
    roi = _month_totals(roi_raw[f"{today:%Y-%m}"], visibility)
    budget = asyncio.run(server.compute_budget_status(company_id, f"{today:%Y-%m}"))

    assert round(wallet_profit, 2) == round(home_profit, 2)
    assert chat["profit"] == round(home_profit, 2)
    assert round(roi["profit"], 2) == round(home_profit, 2)
    assert round(budget["total_payroll_cost"], 2) == round(payroll_month * share, 2)
    if share < 1:
        # Where the month is heading carries the WHOLE month's salary.
        assert budget["is_running"] and budget["expected_month_end"] >= round(payroll_month, 2)


def test_p3_an_asset_bought_on_an_invoice_is_expensed_once(client):
    _, _, owner = _company()
    day = "2026-09-10"
    bought = client.post("/api/invoices", headers=owner, json={
        "supplier": "Техно Мак ООД", "invoice_number": "8801", "date": day, "payment_method": "cash",
        "amount_without_vat": 5000, "vat_amount": 1000, "total_amount": 6000,
        "items": [{"name": "Пещ конвекторна", "quantity": 1, "unit": "бр.", "unit_price": 5000, "total_price": 5000}],
    }).json()
    month = "start_date=2026-09-01&end_date=2026-09-30"
    before = client.get(f"/api/statistics/summary?{month}", headers=owner).json()

    candidates = client.get("/api/assets/linkable-invoices?search=8801", headers=owner).json()
    assert candidates and candidates[0]["id"] == bought["id"] and candidates[0]["first_item"] == "Пещ конвекторна"
    asset = client.post("/api/assets", headers=owner, json={
        "name": "Пещ конвекторна", "category": "cat_iv", "acquisition_date": day, "in_service_date": day,
        "acquisition_value": 6000, "invoice_id": bought["id"],
    })
    assert asset.status_code == 200, asset.text
    asset = asset.json()
    assert asset["invoice_id"] == bought["id"] and "8801" in asset["invoice_label"]

    after = client.get(f"/api/statistics/summary?{month}", headers=owner).json()
    # The 6000 € is no longer an expense of 10 September - the asset's
    # depreciation is - while its VAT stays a credit.
    depreciation = after["total_depreciation_expense"] - before["total_depreciation_expense"]
    assert round(after["total_expense"], 2) == round(before["total_expense"] - 6000 + depreciation, 2)
    assert depreciation < 6000
    assert after["vat_to_pay"] == before["vat_to_pay"]
    chart = client.get(f"/api/statistics/chart-data?{month}", headers=owner).json()
    assert isinstance(chart, list) and len(chart) == 30
    assert all(point["expense"] < 6000 for point in chart)

    # Another asset cannot take the same invoice; deleting the asset gives
    # the expense back to its day.
    other = client.post("/api/assets", headers=owner, json={
        "name": "Втора пещ", "category": "cat_iv", "acquisition_date": day, "in_service_date": day,
        "acquisition_value": 6000, "invoice_id": bought["id"],
    })
    assert other.status_code == 409
    assert client.delete(f"/api/assets/{asset['id']}", headers=owner).status_code == 200
    again = client.get(f"/api/statistics/summary?{month}", headers=owner).json()
    assert round(again["total_expense"], 2) == round(before["total_expense"], 2)


def test_z1_z2_p5_schedule_wages_are_payroll_on_the_days_worked_and_double_pay_asks(client):
    company_id, owner_id, owner = _company()
    worker_id, _ = _user(company_id, "staff", [], "Работник")
    # A manager who may not see off-book expenses still sees wages - they are payroll.
    _, manager = _user(company_id, "manager", sorted(set(server.ROLE_PERMISSIONS["manager"]) - {"view_off_book_expenses"}), "Управител")
    for day in ("2026-12-01", "2026-12-08", "2026-12-15"):
        client.post("/api/schedule/shifts", headers=owner, json={
            "user_id": worker_id, "date": day, "start_time": "09:00", "end_time": "17:00", "hourly_rate": 12,
        })
    december = "start_date=2026-12-01&end_date=2026-12-31"
    before = client.get(f"/api/statistics/summary?{december}", headers=owner).json()

    paid = client.post("/api/schedule/payments", headers=owner, json={
        "user_id": worker_id, "period_start": "2026-12-01", "period_end": "2026-12-31",
    })
    assert paid.status_code == 200, paid.text
    payment = paid.json()
    wages = asyncio.run(server.db.expenses.find({"schedule_payment_id": payment["id"]}, {"_id": 0}).to_list(None))
    assert sorted((w["date"], w["amount"], w["kind"]) for w in wages) == [
        ("2026-12-01", 96, "schedule_wages"), ("2026-12-08", 96, "schedule_wages"), ("2026-12-15", 96, "schedule_wages")]

    after = client.get(f"/api/statistics/summary?{december}", headers=owner).json()
    assert round(after["total_payroll_cost"] - before["total_payroll_cost"], 2) == 288
    assert after["total_non_invoice_expenses"] == before["total_non_invoice_expenses"]
    seen_by_manager = client.get(f"/api/statistics/summary?{december}", headers=manager).json()
    assert round(seen_by_manager["total_expense"], 2) == round(after["total_expense"] - after["total_non_invoice_expenses"], 2)
    # The chart's days carry them on the days worked (December is still
    # ahead, so read the chart's day costs directly).
    by_day = asyncio.run(server.monthly_costs_by_day(company_id, owner_id, Period.parse("2026-12-01", "2026-12-31")))
    assert round(by_day["2026-12-08"] - by_day["2026-12-09"], 2) == 96
    assert round(sum(by_day.values()), 2) == round(after["total_payroll_cost"] + after["total_depreciation_expense"], 2)

    # Not an off-book expense to list, edit or delete on its own.
    listed = client.get("/api/expenses?start_date=2026-12-01&end_date=2026-12-31", headers=owner).json()
    assert not any(e.get("kind") == "schedule_wages" for e in listed)
    assert client.delete(f"/api/expenses/{wages[0]['id']}", headers=owner).status_code == 409
    # Undoing the payment removes every day of it.
    assert client.delete(f"/api/schedule/payments/{payment['id']}", headers=owner).status_code == 200
    assert asyncio.run(server.db.expenses.count_documents({"schedule_payment_id": payment["id"]})) == 0

    # The same person on formal payroll for December: paying the schedule
    # too needs a yes, and so does a payroll month already paid by schedule.
    employee = client.post("/api/employees", headers=owner, json={
        "name": "Работник", "base_salary": 1100, "linked_user_id": worker_id,
    }).json()
    assert client.post("/api/payroll", headers=owner, json={
        "employee_id": employee["id"], "period_month": 12, "period_year": 2026,
    }).status_code == 200
    asked = client.post("/api/schedule/payments", headers=owner, json={
        "user_id": worker_id, "period_start": "2026-12-01", "period_end": "2026-12-31",
    })
    assert asked.status_code == 428 and "12.2026" in asked.json()["detail"]
    confirmed = client.post("/api/schedule/payments", headers=owner, json={
        "user_id": worker_id, "period_start": "2026-12-01", "period_end": "2026-12-31", "confirm_double_pay": True,
    })
    assert confirmed.status_code == 200
    january_paid = client.post("/api/schedule/shifts", headers=owner, json={
        "user_id": worker_id, "date": "2027-01-05", "start_time": "09:00", "end_time": "13:00", "hourly_rate": 12,
    })
    assert january_paid.status_code == 200
    client.post("/api/schedule/payments", headers=owner, json={
        "user_id": worker_id, "period_start": "2027-01-01", "period_end": "2027-01-31",
    })
    payroll_asked = client.post("/api/payroll", headers=owner, json={
        "employee_id": employee["id"], "period_month": 1, "period_year": 2027,
    })
    assert payroll_asked.status_code == 428
    assert client.post("/api/payroll", headers=owner, json={
        "employee_id": employee["id"], "period_month": 1, "period_year": 2027, "confirm_double_pay": True,
    }).status_code == 200


def test_p5_an_older_schedule_payment_expense_becomes_wages(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()[f"wages_{uuid.uuid4().hex[:6]}"])

    async def run():
        await server.db.expenses.insert_one({"id": "e-old", "company_id": "c1", "user_id": "u1",
                                             "description": "Възнаграждение по график - Х", "amount": 300, "date": "2026-10-31"})
        await server.db.schedule_payments.insert_one({"id": "p-old", "company_id": "c1", "expense_id": "e-old"})
        result = await server.mark_schedule_wages()
        return result, await server.db.expenses.find_one({"id": "e-old"}, {"_id": 0})

    result, expense = asyncio.run(run())
    assert result["marked"] == 1 and expense["kind"] == "schedule_wages" and expense["schedule_payment_id"] == "p-old"


def test_f2_card_is_paid_on_the_spot_and_the_method_is_one_of_three(client):
    _, _, owner = _company()
    base = {"supplier": "Кафе Зрънце", "date": "2026-11-03", "amount_without_vat": 10, "vat_amount": 2, "total_amount": 12}
    card = client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "C-1", "payment_method": "card"})
    assert card.status_code == 200, card.text
    assert card.json()["is_paid"] is True and card.json()["paid_amount"] == 12
    owed = client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "C-2", "payment_method": "bank_transfer"})
    assert owed.json()["is_paid"] is False and owed.json()["payment_due_date"]
    assert client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "C-3", "payment_method": "crypto"}).status_code == 422
    # The scanner's answer carries the printed method through to the form.
    assert "payment_method" in server.OCRResult.model_fields
    assert "payment_method" in server.ClaudeInvoiceExtraction.model_fields


def test_r1_r3_revenue_by_day_and_purchase_prices_need_a_right(client):
    company_id, _, owner = _company()
    _, nobody = _user(company_id, "staff", [], "Без права")
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-11-02", "fiscal_revenue": 1234})

    assert client.get("/api/daily-revenue", headers=nobody).status_code == 403
    assert client.get("/api/daily-revenue/by-date/2026-11-02", headers=nobody).status_code == 403
    # Whoever enters revenue sees the day they correct - not the whole history.
    assert client.get("/api/daily-revenue/by-date/2026-11-02", headers=cashier).json()["fiscal_revenue"] == 1234
    assert client.get("/api/daily-revenue", headers=cashier).status_code == 403
    assert client.get("/api/daily-revenue", headers=owner).status_code == 200
    assert client.get("/api/items/price-alerts", headers=nobody).json() == {"alerts": [], "total": 0, "unread_count": 0}


def test_z3_c2_a_deleted_expense_or_payroll_entry_leaves_a_trace_and_comes_back(client):
    company_id, _, owner = _company()
    expense = client.post("/api/expenses", headers=owner, json={"description": "Наем склад", "amount": 400, "date": "2026-11-01"}).json()
    employee = client.post("/api/employees", headers=owner, json={"name": "Петя", "base_salary": 1000}).json()
    entry = client.post("/api/payroll", headers=owner, json={"employee_id": employee["id"], "period_month": 10, "period_year": 2026}).json()

    assert client.delete(f"/api/expenses/{expense['id']}", headers=owner).status_code == 200
    assert client.delete(f"/api/payroll/{entry['id']}", headers=owner).status_code == 200
    logs = asyncio.run(server.db.audit_logs.find(
        {"company_id": company_id, "action": "delete", "entity_type": {"$in": ["expense", "payroll"]}}, {"_id": 0},
    ).to_list(None))
    assert {log["entity_type"] for log in logs} == {"expense", "payroll"}
    for log in logs:
        restored = client.post(f"/api/audit-logs/{log['id']}/restore", headers=owner)
        assert restored.status_code == 200, restored.text
        assert client.post(f"/api/audit-logs/{log['id']}/restore", headers=owner).status_code == 400  # once
    assert asyncio.run(server.db.expenses.count_documents({"id": expense["id"]})) == 1
    assert asyncio.run(server.db.payroll_entries.count_documents({"id": entry["id"]})) == 1


def test_i4_importing_the_same_expenses_twice_does_not_double_them(client):
    company_id, _, owner = _company()
    rows = [
        {"description": "Ток", "amount": 120.5, "date": "2026-10-05"},
        {"description": "Кафе", "amount": 3, "date": "2026-10-06"},
        {"description": "Кафе", "amount": 3, "date": "2026-10-06"},
    ]
    first = client.post("/api/import/expenses/commit", headers=owner, json={"rows": rows}).json()
    assert first["imported"] == 3
    second = client.post("/api/import/expenses/commit", headers=owner, json={"rows": rows + [{"description": "Кафе", "amount": 3, "date": "2026-10-06"}]}).json()
    # The three already there are skipped; a third coffee that day is new.
    assert second["already_present"] == 3 and second["imported"] == 1
    assert asyncio.run(server.db.expenses.count_documents({"company_id": company_id})) == 4


def test_f3_f4_payment_follows_a_corrected_total_and_a_changed_method(client):
    _, _, owner = _company()
    base = {"supplier": "Доставки ЕООД", "date": "2026-11-04", "amount_without_vat": 100, "vat_amount": 20, "total_amount": 120}
    cash = client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "P-1", "payment_method": "cash"}).json()
    fixed = client.put(f"/api/invoices/{cash['id']}", headers=owner, json={"amount_without_vat": 1000, "vat_amount": 200, "total_amount": 1200}).json()
    assert (fixed["is_paid"], fixed["paid_amount"]) == (True, 1200)   # paid at the till: follows the total

    bank = client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "P-2", "payment_method": "bank_transfer"}).json()
    paid = client.put(f"/api/invoices/{bank['id']}", headers=owner, json={"is_paid": True}).json()
    assert paid["paid_amount"] == 120
    corrected = client.put(f"/api/invoices/{bank['id']}", headers=owner, json={"amount_without_vat": 1000, "vat_amount": 200, "total_amount": 1200}).json()
    assert (corrected["is_paid"], corrected["paid_amount"]) == (False, 120)   # by bank: 120 paid of 1 200

    # From cash to a bank transfer: owed, unless the edit says it was paid.
    switched = client.put(f"/api/invoices/{cash['id']}", headers=owner, json={"payment_method": "bank_transfer"}).json()
    assert (switched["is_paid"], switched["paid_amount"]) == (False, 0) and switched["payment_due_date"]
    other = client.post("/api/invoices", headers=owner, json={**base, "invoice_number": "P-3", "payment_method": "card"}).json()
    kept = client.put(f"/api/invoices/{other['id']}", headers=owner, json={"payment_method": "bank_transfer", "is_paid": True}).json()
    assert kept["is_paid"] is True and kept["paid_amount"] == 120
    # A part payment typed in still works as before.
    part = client.put(f"/api/invoices/{bank['id']}", headers=owner, json={"paid_amount": 1200}).json()
    assert part["is_paid"] is True


def test_v1_v2_v4_bills_are_due_paid_in_parts_and_deleted_with_their_receivable(client):
    _, _, owner = _company()
    bill = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "bill", "customer_name": "Сватба Иванови", "issue_date": "2026-11-02",
        "items": [{"name": "Кетъринг", "quantity": 1, "unit_price": 250}],
    }).json()
    assert bill["due_date"] == "2026-11-09"
    receivable = asyncio.run(server.db.receivables.find_one({"id": bill["receivable_id"]}, {"_id": 0}))
    assert receivable["due_date"] == "2026-11-09"

    part = client.post(f"/api/receivables/{receivable['id']}/payments", headers=owner,
                       json={"amount": 100, "date": "2026-11-05", "method": "bank_transfer"}).json()
    assert (part["is_paid"], part["paid_amount"], part["payments"][0]["method"]) == (False, 100, "bank_transfer")
    summary = client.get("/api/receivables/summary", headers=owner).json()
    assert summary["total_owed"] == 150
    assert client.post(f"/api/receivables/{receivable['id']}/payments", headers=owner, json={"amount": 200}).status_code == 400
    # Something was paid: deleting the bill keeps the receivable.
    assert client.delete(f"/api/billing-documents/{bill['id']}", headers=owner).json()["receivable"] == "kept"
    rest = client.post(f"/api/receivables/{receivable['id']}/payments", headers=owner,
                       json={"amount": 150, "date": "2026-11-08", "method": "cash"}).json()
    assert rest["is_paid"] is True and len(rest["payments"]) == 2

    # A bill with nothing paid takes its receivable with it.
    other = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "bill", "customer_name": "Фирма Х", "items": [{"name": "Услуга", "quantity": 2, "unit_price": 40}],
    }).json()
    assert client.delete(f"/api/billing-documents/{other['id']}", headers=owner).json()["receivable"] == "deleted"
    assert asyncio.run(server.db.receivables.count_documents({"id": other["receivable_id"]})) == 0


def test_r2_payroll_is_its_own_right(client):
    company_id, _, owner = _company()
    client.post("/api/employees", headers=owner, json={"name": "Иво", "base_salary": 1500})
    _, manager = _user(company_id, "manager", sorted(server.ROLE_PERMISSIONS["manager"]), "Управител")
    assert "manage_payroll" not in server.ROLE_PERMISSIONS["manager"]
    assert "manage_payroll" in server.ROLE_PERMISSIONS["accountant"]

    assert client.get("/api/payroll", headers=manager).status_code == 403
    team = client.get("/api/employees", headers=manager)
    assert team.status_code == 200 and team.json()[0]["base_salary"] == 0   # the team, not the salaries
    assert client.get("/api/employees", headers=owner).json()[0]["base_salary"] == 1500

    # A manager from before the split, who had "Бюджет", keeps payroll.
    legacy_id = f"user_{uuid.uuid4().hex[:12]}"
    token = uuid.uuid4().hex
    now = datetime.now(timezone.utc)

    async def seed():
        await server.db.users.insert_one({
            "user_id": legacy_id, "email": f"{legacy_id}@test.com", "name": "Стар управител", "role": "manager",
            "company_id": company_id, "permissions": ["manage_budget", "view_statistics"], "auth_provider": "email",
            "permissions_schema_version": 5, "created_at": now,
        })
        await server.db.user_sessions.insert_one({"user_id": legacy_id, "session_token": token,
                                                  "expires_at": now + timedelta(days=1), "created_at": now})
    asyncio.run(seed())
    legacy = {"Authorization": f"Bearer {token}"}
    assert "manage_payroll" in client.get("/api/auth/me", headers=legacy).json()["permissions"]
    assert client.get("/api/payroll", headers=legacy).status_code == 200


def test_i5_the_statistics_pdf_is_for_one_printed_period(client, monkeypatch):
    _, _, owner = _company()
    seen = {}

    def fake_pdf(**kwargs):
        seen.update(kwargs)
        return b"%PDF-1.4"
    monkeypatch.setattr(server.ExportService, "generate_statistics_pdf", staticmethod(fake_pdf))
    r = client.get("/api/export/statistics/pdf?start_date=2026-09-01&end_date=2026-09-30", headers=owner)
    assert r.status_code == 200
    assert seen["period_label"] == "Период: 01.09.2026 – 30.09.2026"
    r = client.get("/api/export/statistics/pdf", headers=owner)
    assert r.status_code == 200 and seen["period_label"].startswith("Период: 01.")


def test_a3_item_statistics_say_how_much_of_the_purchases_they_cover(client):
    _, _, owner = _company()
    with_lines = {
        "supplier": "Метро", "invoice_number": "A3-1", "date": "2026-10-05",
        "amount_without_vat": 300, "vat_amount": 60, "total_amount": 360,
        "items": [{"name": "Брашно", "quantity": 10, "unit": "кг", "unit_price": 30, "total_price": 300}],
    }
    without_lines = {
        "supplier": "Енерго", "invoice_number": "A3-2", "date": "2026-10-06",
        "amount_without_vat": 100, "vat_amount": 20, "total_amount": 120,
    }
    for body in (with_lines, without_lines):
        assert client.post("/api/invoices", json=body, headers=owner).status_code == 200
    stats = client.get("/api/statistics/items?start_date=2026-10-01&end_date=2026-10-31", headers=owner).json()
    assert stats["coverage"] == {
        "purchases_without_vat": 400, "with_lines_without_vat": 300, "share": 0.75, "invoices_without_lines": 1,
    }
    # A period with purchases but no read lines still says so.
    empty = client.get("/api/statistics/items?start_date=2026-10-06&end_date=2026-10-06", headers=owner).json()
    assert empty["coverage"]["share"] == 0 and empty["coverage"]["invoices_without_lines"] == 1


def test_p4_a_credit_note_takes_purchases_and_vat_credit_down(client):
    company_id, _, owner = _company()
    october = "start_date=2026-10-01&end_date=2026-10-31"
    invoice = client.post("/api/invoices", headers=owner, json={
        "supplier": "Метро", "invoice_number": "1001", "date": "2026-10-05", "payment_method": "bank_transfer",
        "amount_without_vat": 100, "vat_amount": 20, "total_amount": 120,
        "items": [{"name": "Брашно", "quantity": 10, "unit": "кг", "unit_price": 10}],
    }).json()
    # Typed as printed, without a minus.
    note = client.post("/api/invoices", headers=owner, json={
        "supplier": "Метро", "invoice_number": "1001", "date": "2026-10-08", "document_type": "credit_note",
        "payment_method": "bank_transfer", "amount_without_vat": 50, "vat_amount": 10, "total_amount": 60,
        "items": [{"name": "Брашно", "quantity": 5, "unit": "кг", "unit_price": 10}],
    })
    assert note.status_code == 200, note.text   # the same number as an invoice is another document
    note = note.json()
    assert (note["amount_without_vat"], note["vat_amount"], note["total_amount"]) == (-50, -10, -60)
    assert note["is_paid"] is True and note["payment_due_date"] is None

    summary = client.get(f"/api/statistics/summary?{october}", headers=owner).json()
    assert summary["total_invoice_amount"] == 60 and summary["total_invoice_vat"] == 10
    assert summary["invoice_count"] == 1
    assert summary["unpaid_invoice_count"] == 1 and summary["total_unpaid_amount"] == 120

    suppliers = client.get(f"/api/statistics/suppliers?{october}", headers=owner).json()
    metro = next(s for s in suppliers["all_suppliers"] if s["supplier"] == "Метро")
    assert metro["total_amount"] == 60 and metro["invoice_count"] == 1

    # What went back is not a purchase price.
    rows = asyncio.run(server.db.item_price_history.find({"company_id": company_id}).to_list(None))
    assert [r["invoice_id"] for r in rows] == [invoice["id"]]

    again = client.post("/api/invoices", headers=owner, json={
        "supplier": "Метро", "invoice_number": "1001", "date": "2026-10-09", "document_type": "credit_note",
        "amount_without_vat": 50, "vat_amount": 10, "total_amount": 60,
    })
    assert again.status_code == 409 and "Кредитно известие" in again.json()["detail"]
    minus_invoice = client.post("/api/invoices", headers=owner, json={
        "supplier": "Метро", "invoice_number": "1002", "date": "2026-10-09",
        "amount_without_vat": -50, "vat_amount": -10, "total_amount": -60,
    })
    assert minus_invoice.status_code == 422 and "кредитно известие" in minus_invoice.text

    # Turned into an invoice: above zero, owed; back to a credit note: below zero, settled, no price rows.
    # (As an invoice it would copy invoice 1001 - refused - so it takes its own number.)
    refused = client.put(f"/api/invoices/{note['id']}", headers=owner, json={"document_type": "invoice"})
    assert refused.status_code == 409
    as_invoice = client.put(f"/api/invoices/{note['id']}", headers=owner,
                            json={"document_type": "invoice", "invoice_number": "1003"})
    assert as_invoice.status_code == 200, as_invoice.text
    as_invoice = as_invoice.json()
    assert as_invoice["total_amount"] == 60 and as_invoice["is_paid"] is False and as_invoice["paid_amount"] == 0
    assert asyncio.run(server.db.item_price_history.count_documents({"invoice_id": note["id"]})) == 1
    back = client.put(f"/api/invoices/{note['id']}", headers=owner,
                      json={"document_type": "credit_note", "total_amount": -60}).json()
    assert back["total_amount"] == -60 and back["is_paid"] is True and back["paid_amount"] == -60
    assert asyncio.run(server.db.item_price_history.count_documents({"invoice_id": note["id"]})) == 0

    # Never an asset's purchase invoice.
    linkable = client.get("/api/assets/linkable-invoices", params={"search": "Метро"}, headers=owner).json()
    assert [i["id"] for i in linkable] == [invoice["id"]]

    # An imported row below zero is a credit note.
    imported = client.post("/api/import/invoices/commit", headers=owner, json={"rows": [{
        "supplier": "Енерго", "invoice_number": "КИ-7", "date": "2026-10-10",
        "amount_without_vat": -10, "vat_amount": -2, "total_amount": -12,
    }]}).json()
    assert imported["imported"] == 1, imported
    stored = asyncio.run(server.db.invoices.find_one({"company_id": company_id, "invoice_number": "КИ-7"}))
    assert stored["document_type"] == "credit_note" and stored["total_amount"] == -12


def test_v3_an_issued_invoice_is_revenue_and_vat_on_its_day_and_owed_until_paid(client):
    company_id, _, owner = _company()
    october = "start_date=2026-10-01&end_date=2026-10-31"
    client.post("/api/daily-revenue", json={"date": "2026-10-02", "fiscal_revenue": 1200, "vat_rate_percent": 20}, headers=owner)
    before = client.get(f"/api/statistics/summary?{october}", headers=owner).json()

    issued = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Фирма & Син ООД", "customer_eik": "131071587",
        "issue_date": "2026-10-10", "payment_method": "bank_transfer",
        "items": [{"name": "Кетъринг", "quantity": 2, "unit_price": 100, "vat_rate": 20},
                  {"name": "Книги", "quantity": 1, "unit_price": 50, "vat_rate": 9}],
    })
    assert issued.status_code == 200, issued.text
    issued = issued.json()
    assert issued["invoice_number"] == "0000000001"
    assert (issued["amount_without_vat"], issued["vat_amount"], issued["total_amount"]) == (250, 44.5, 294.5)
    assert issued["due_date"] == "2026-10-24" and issued["receivable_id"]

    after = client.get(f"/api/statistics/summary?{october}", headers=owner).json()
    assert round(after["total_income"] - before["total_income"], 2) == 294.5
    assert round(after["fiscal_vat"] - before["fiscal_vat"], 2) == 44.5
    assert round(after["vat_to_pay"] - before["vat_to_pay"], 2) == 44.5
    assert after["total_issued_invoices"] == 294.5 and after["issued_invoice_count"] == 1
    assert after["total_fiscal_revenue"] == before["total_fiscal_revenue"]   # the till is the till

    chart = client.get("/api/statistics/chart-data?start_date=2026-10-10&end_date=2026-10-10", headers=owner)
    assert chart.status_code == 200, chart.text
    points = chart.json()
    assert len(points) == 1 and abs(points[0]["income"] - 294.5) < 0.01, points

    # Owed until paid, and a payment on it is not new revenue.
    receivable = asyncio.run(server.db.receivables.find_one({"id": issued["receivable_id"]}))
    assert receivable["revenue_counted"] is True and receivable["amount"] == 294.5
    assert receivable["billing_document_id"] == issued["id"]

    # Paid at issue: no receivable. Numbers follow on; a number of one's own to continue from.
    cash = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Клиент", "issue_date": "2026-10-11", "payment_method": "cash",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 10}],
    }).json()
    assert cash["invoice_number"] == "0000000002" and cash["receivable_id"] is None and cash["due_date"] is None
    # This business enters its till: paid in cash, the sale went through it
    # (a fiscal receipt) and its money is in that day's till revenue (Д4).
    assert cash["in_till"] is True
    own = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Клиент", "issue_date": "2026-10-12", "payment_method": "card",
        "invoice_number": "155", "items": [{"name": "Услуга", "quantity": 1, "unit_price": 10}],
    }).json()
    assert own["invoice_number"] == "0000000155"
    taken = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Клиент", "invoice_number": "155",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 10}],
    })
    assert taken.status_code == 409

    pdf = client.get(f"/api/billing-documents/{issued['id']}/pdf", headers=owner)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")

    # An earlier invoice is cancelled (its number kept, counting for nothing); the last one can go.
    gone = client.delete(f"/api/billing-documents/{issued['id']}", headers=owner).json()
    assert gone["cancelled"] is True and gone["receivable"] == "deleted"
    kept = asyncio.run(server.db.billing_documents.find_one({"id": issued["id"]}))
    assert kept["cancelled"] is True and kept["invoice_number"] == "0000000001"
    last = client.delete(f"/api/billing-documents/{own['id']}", headers=owner).json()
    assert last["cancelled"] is False
    assert asyncio.run(server.db.billing_documents.find_one({"id": own["id"]})) is None
    final = client.get(f"/api/statistics/summary?{october}", headers=owner).json()
    # Left: the cash invoice, already in its day's till - nothing counted twice.
    assert final["total_issued_invoices"] == 0 and round(final["total_income"] - before["total_income"], 2) == 0


def test_v3_issued_invoices_join_the_revenue_forecast_as_known_amounts(client):
    _, _, owner = _company()
    today = today_local()
    for months_back in (3, 2, 1):
        first = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        for _ in range(months_back - 1):
            first = (first - timedelta(days=1)).replace(day=1)
        client.post("/api/billing-documents", headers=owner, json={
            "doc_type": "invoice", "customer_name": "Клиент", "issue_date": first.replace(day=5).isoformat(),
            "payment_method": "bank_transfer", "items": [{"name": "Проект", "quantity": 1, "unit_price": 1000, "vat_rate": 20}],
        })
    client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Клиент", "issue_date": today.isoformat(), "payment_method": "card",
        "items": [{"name": "Проект", "quantity": 1, "unit_price": 500, "vat_rate": 20}],
    })
    forecast = client.get("/api/forecast/revenue", headers=owner).json()
    assert forecast["current_month"]["so_far"] == 600
    history = {row["month"]: row["amount"] for row in forecast.get("historical", [])}
    assert sorted(history.values())[-3:] == [1200, 1200, 1200], forecast


def test_x10_c1_the_sales_ledger_holds_the_invoices_issued(client, monkeypatch):
    _, _, owner = _company()
    client.post("/api/daily-revenue", json={"date": "2026-10-02", "fiscal_revenue": 1200, "vat_rate_percent": 20}, headers=owner)
    for day, rate in (("2026-10-05", 20), ("2026-10-06", 9)):
        client.post("/api/billing-documents", headers=owner, json={
            "doc_type": "invoice", "customer_name": "Клиент ООД", "customer_eik": "131071587", "issue_date": day,
            "payment_method": "bank_transfer", "items": [{"name": "Услуга", "quantity": 1, "unit_price": 100, "vat_rate": rate}],
        })
    client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Друг", "issue_date": "2026-10-07", "payment_method": "cash",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 50}],
    })
    docs = client.get("/api/billing-documents", headers=owner).json()
    first = next(d for d in docs if d["issue_date"] == "2026-10-05")
    assert client.delete(f"/api/billing-documents/{first['id']}", headers=owner).json()["cancelled"] is True
    seen = {}

    def fake(**kwargs):
        seen.update(kwargs)
        return b"x"
    monkeypatch.setattr(server.ExportService, "generate_vat_ledger_excel", staticmethod(fake))
    assert client.get("/api/export/vat-ledger/excel?start_date=2026-10-01&end_date=2026-10-31", headers=owner).status_code == 200
    issued = seen["issued_invoices"]
    assert [d["invoice_number"] for d in issued] == ["0000000001", "0000000002", "0000000003"]
    assert issued[0]["cancelled"] is True

    # The real sheet: till row, the cancelled invoice at zero, the others by rate.
    monkeypatch.undo()
    import io
    import openpyxl  # type: ignore[import-untyped]
    data = server.ExportService.generate_vat_ledger_excel(
        purchases=[], sales=[{"date": "2026-10-02", "fiscal_revenue": 1200, "vat_rate_percent": 20}],
        issued_invoices=issued,
    )
    sheet = openpyxl.load_workbook(io.BytesIO(data))["Дневник продажби"]
    rows = [[c.value for c in row] for row in sheet.iter_rows() if isinstance(row[0].value, int)]
    assert [r[2] for r in rows] == ["Отчет за извършени продажби (81)", "Фактура (01) - анулирана", "Фактура (01)", "Фактура (01)"]
    assert rows[1][3] == "0000000001" and rows[1][-1] == 0
    assert rows[2][8:10] == [100, 9] and rows[2][-1] == 109   # the 9% invoice: base 100, VAT 9
    assert rows[3][6:8] == [50, 10] and rows[3][-1] == 60


def test_x10_c2_the_statistics_pdf_says_what_is_hidden_instead_of_failing(client, monkeypatch):
    company_id, _, owner = _company()
    client.post("/api/daily-revenue", json={"date": "2026-10-02", "fiscal_revenue": 100}, headers=owner)
    _, viewer = _user(company_id, "manager", ["export_data", "view_statistics"], "Счетоводител")
    r = client.get("/api/export/statistics/pdf?start_date=2026-10-01&end_date=2026-10-31", headers=viewer)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    seen = {}

    def fake(**kwargs):
        seen.update(kwargs)
        return b"%PDF-1.4"
    monkeypatch.setattr(server.ExportService, "generate_statistics_pdf", staticmethod(fake))
    client.get("/api/export/statistics/pdf?start_date=2026-10-01&end_date=2026-10-31", headers=viewer)
    assert seen["stats"]["profit"] is None and "Печалбата е скрита" in seen["visibility_note"]
    _, export_only = _user(company_id, "manager", ["export_data"], "Само експорт")
    assert client.get("/api/export/statistics/pdf", headers=export_only).status_code == 403


def test_x10_d3_vat_registration_is_asked_once_and_followed(client, monkeypatch):
    company_id, owner_id, owner = _company()
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"eik": "131071587"}}))
    october = "start_date=2026-10-01&end_date=2026-10-31"
    keys = lambda: [s["key"] for s in client.get("/api/proactive/signals", headers=owner).json().get("signals", [])]
    # Not answered, no VAT number: as before (registered), and asked once.
    assert client.get(f"/api/statistics/summary?{october}", headers=owner).json()["vat_registered"] is True
    assert "vat_registration" in keys()

    assert client.put("/api/company", headers=owner, json={"vat_registered": False}).status_code == 200
    assert client.get(f"/api/statistics/summary?{october}", headers=owner).json()["vat_registered"] is False
    assert "vat_registration" not in keys()
    issued = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Клиент", "issue_date": "2026-10-10", "payment_method": "cash",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 100, "vat_rate": 20}],
    }).json()
    assert (issued["vat_amount"], issued["total_amount"]) == (0, 100)
    assert issued["vat_exempt_basis"] == "чл. 113, ал. 9 от ЗДДС"
    assert client.get(f"/api/billing-documents/{issued['id']}/pdf", headers=owner).status_code == 200

    # No "VAT to pay" for the assistant or in the report either.
    from routers.ai_insights import build_business_chat_digest
    owner_user = server.User(user_id=owner_id, email=f"{owner_id}@test.com", name="Собственик", role="owner",
                             company_id=company_id, permissions=list(server.ROLE_PERMISSIONS["owner"]))
    digest = asyncio.run(build_business_chat_digest(owner_user))
    assert digest["vat_registered"] is False and digest["vat_due_this_month"] is None
    import services.export_service as export_service
    tables = []
    real_table = export_service.Table

    def recording_table(rows, *args, **kwargs):
        tables.append(rows)
        return real_table(rows, *args, **kwargs)
    monkeypatch.setattr(export_service, "Table", recording_table)
    assert client.get(f"/api/export/statistics/pdf?{october}", headers=owner).status_code == 200
    labels = [row[0] for rows in tables for row in rows]
    assert "Печалба" in labels and "ДДС за плащане" not in labels

    assert client.put("/api/company", headers=owner, json={"vat_registered": True}).status_code == 200
    with_vat = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Клиент", "issue_date": "2026-10-11", "payment_method": "cash",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 100, "vat_rate": 20}],
    }).json()
    assert with_vat["total_amount"] == 120 and with_vat["vat_exempt_basis"] is None
    assert asyncio.run(build_business_chat_digest(owner_user))["vat_due_this_month"] is not None
    tables.clear()
    client.get(f"/api/export/statistics/pdf?{october}", headers=owner)
    assert "ДДС за плащане" in [row[0] for rows in tables for row in rows]

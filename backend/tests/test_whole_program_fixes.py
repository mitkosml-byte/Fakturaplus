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

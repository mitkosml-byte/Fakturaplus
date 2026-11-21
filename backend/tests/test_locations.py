"""The business's locations (Н11): each one's revenue, costs and team side
by side. A day's revenue is kept in parts - each location's and what no
location holds - that always add up to the day; the locations and the
shared part add up to the business's own numbers, the same as in
Statistics. Nothing is counted twice, nothing is lost."""
import asyncio
from datetime import date

import pytest

import server
from tests.test_whole_program_fixes import _company, _user, no_rate_limit  # noqa: F401 - a fixture

TODAY = date(2026, 11, 17)
NOVEMBER = "start_date=2026-11-01&end_date=2026-11-30"


@pytest.fixture
def on_today(monkeypatch):
    monkeypatch.setattr(server, "today_local", lambda: TODAY)


def _location(client, headers, name, **fields):
    r = client.post("/api/locations", headers=headers, json={"name": name, **fields})
    assert r.status_code == 200, r.text
    return r.json()


def _revenue(client, headers, day, location=None, **fields):
    body = {"date": day, **({"location_id": location["id"]} if location else {}), **fields}
    if "vat_groups" not in body:
        body.update(vat_rate_percent=body.get("vat_rate_percent", 20), vat_groups=[])
    r = client.post("/api/daily-revenue", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _part(client, headers, day, location=None):
    query = f"?location_id={location['id']}" if location else ""
    return client.get(f"/api/daily-revenue/by-date/{day}{query}", headers=headers).json()


def _stored_day(company_id, day):
    return asyncio.run(server.db.daily_revenue.find_one({"company_id": company_id, "date": day}, {"_id": 0}))


def _rates(groups):
    return sorted((g["rate_percent"], g["amount"]) for g in groups)


def test_n11_a_days_revenue_by_location_adds_up_to_the_day(client, on_today):
    company_id, _, owner = _company()
    # Entered before the business had locations: the whole day.
    _revenue(client, owner, "2026-11-03", fiscal_revenue=100)
    centre = _location(client, owner, "Център", address="ул. Витоша 1")
    mladost = _location(client, owner, "Младост")
    assert client.post("/api/locations", headers=owner, json={"name": " център "}).status_code == 409
    assert [l["name"] for l in client.get("/api/locations", headers=owner).json()] == ["Център", "Младост"]

    # The centre's till that day joins the day; what was there stays, held by no location.
    day = _revenue(client, owner, "2026-11-03", centre, fiscal_revenue=50, vat_rate_percent=9, card_revenue=10, pocket_money=5)
    assert (day["fiscal_revenue"], day["card_revenue"], day["pocket_money"]) == (150, 10, 5)
    assert _rates(day["vat_groups"]) == [(9, 50), (20, 100)]
    assert "by_location" not in day
    centre_part = _part(client, owner, "2026-11-03", centre)
    assert (centre_part["fiscal_revenue"], centre_part["vat_rate_percent"], centre_part["vat_groups"]) == (50, 9, [])
    shared = _part(client, owner, "2026-11-03")
    assert (shared["fiscal_revenue"], shared["vat_rate_percent"], shared["card_revenue"], shared["pocket_money"]) == (100, 20, 0, 0)
    assert _part(client, owner, "2026-11-03", mladost)["fiscal_revenue"] == 0

    # A correction replaces the centre's part - never added to it.
    _revenue(client, owner, "2026-11-03", centre, fiscal_revenue=60, vat_rate_percent=9)
    # Младост by VAT rate, as its till's report gives it.
    _revenue(client, owner, "2026-11-03", mladost, card_revenue=15,
             vat_groups=[{"rate_percent": 20, "amount": 30}, {"rate_percent": 9, "amount": 20}])
    # And what no location holds, corrected.
    _revenue(client, owner, "2026-11-03", fiscal_revenue=80)
    whole = _stored_day(company_id, "2026-11-03")
    assert (whole["fiscal_revenue"], whole["card_revenue"], whole["pocket_money"]) == (190, 25, 5)   # 80 + 60 + 50
    assert _rates(whole["vat_groups"]) == [(9, 80), (20, 110)]
    assert _rates(_part(client, owner, "2026-11-03", mladost)["vat_groups"]) == [(9, 20), (20, 30)]
    # Still one record for the day, whoever entered which part.
    assert asyncio.run(server.db.daily_revenue.count_documents({"company_id": company_id, "date": "2026-11-03"})) == 1

    # A paid bill logged as revenue goes to its location's pocket money.
    added = client.post("/api/daily-revenue/add-pocket", headers=owner,
                        json={"date": "2026-11-03", "amount": 12.5, "location_id": mladost["id"]})
    assert added.status_code == 200 and added.json()["pocket_money"] == 17.5
    assert _part(client, owner, "2026-11-03", mladost)["pocket_money"] == 12.5
    # A day split by rate takes a new total only by rate (or at one rate).
    refused = client.post("/api/daily-revenue", headers=owner,
                          json={"date": "2026-11-03", "location_id": mladost["id"], "fiscal_revenue": 70})
    assert refused.status_code == 400

    # Another business's location is not one of these.
    _, _, stranger = _company()
    theirs = _location(client, stranger, "Чужд обект")
    assert client.post("/api/daily-revenue", headers=owner, json={
        "date": "2026-11-04", "location_id": theirs["id"], "fiscal_revenue": 10}).status_code == 400
    assert client.get(f"/api/daily-revenue/by-date/2026-11-04?location_id={theirs['id']}", headers=owner).status_code == 400


def test_n11_locations_side_by_side_add_up_to_the_business(client, on_today):
    company_id, _, owner = _company()
    centre = _location(client, owner, "Център")
    mladost = _location(client, owner, "Младост")
    _revenue(client, owner, "2026-11-02", centre, fiscal_revenue=1000, pocket_money=100)
    _revenue(client, owner, "2026-11-03", centre, fiscal_revenue=800)
    _revenue(client, owner, "2026-11-03", mladost, fiscal_revenue=500)
    _revenue(client, owner, "2026-11-05", fiscal_revenue=300)                 # no location: shared
    _revenue(client, owner, "2026-11-20", centre, fiscal_revenue=999)         # after today: not counted yet

    for number, total, location in (("P-1", 240.0, centre), ("P-2", 120.0, None)):
        r = client.post("/api/invoices", headers=owner, json={
            "supplier": "Доставчик", "invoice_number": number, "amount_without_vat": round(total / 1.2, 2),
            "vat_amount": round(total - total / 1.2, 2), "total_amount": total, "date": "2026-11-04",
            "payment_method": "cash", **({"location_id": location["id"]} if location else {}),
        })
        assert r.status_code == 200, r.text
    assert client.post("/api/expenses", headers=owner, json={
        "description": "Ремонт", "amount": 60, "date": "2026-11-06", "location_id": mladost["id"]}).status_code == 200
    ivan = client.post("/api/employees", headers=owner, json={"name": "Иван", "base_salary": 1000, "location_id": mladost["id"]}).json()
    assert ivan["location_id"] == mladost["id"]
    assert client.post("/api/payroll", headers=owner, json={
        "employee_id": ivan["id"], "period_month": 11, "period_year": 2026}).status_code == 200
    # Issued by the centre, and part of it credited back: the centre keeps 120 - 60.
    issued = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "invoice", "customer_name": "Гама ООД", "issue_date": "2026-11-10", "payment_method": "bank_transfer",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 100, "vat_rate": 20}], "location_id": centre["id"],
    }).json()
    assert issued["location_id"] == centre["id"]
    credit = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "credit_note", "credited_document_id": issued["id"], "customer_name": "Гама ООД",
        "issue_date": "2026-11-12", "notes": "Отстъпка за забавяне",
        "items": [{"name": "Отстъпка", "quantity": 1, "unit_price": 50, "vat_rate": 20}],
    })
    assert credit.status_code == 200, credit.text
    assert credit.json()["location_id"] == centre["id"]

    compared = client.get(f"/api/locations/compare?{NOVEMBER}", headers=owner)
    assert compared.status_code == 200, compared.text
    result = compared.json()
    assert result["period"] == {"start": "2026-11-01", "end": "2026-11-17"}
    rows = {row["name"]: row for row in result["locations"]}
    centre_row, mladost_row = rows["Център"], rows["Младост"]
    assert centre_row["parts"] == {"till": 1800, "issued_invoices": 60, "purchases": 240, "off_book": 0, "payroll": 0}
    assert (centre_row["income"], centre_row["expense"], centre_row["profit"]) == (1960, 240, 1720)   # 1800 + pocket 100 + 60
    assert (centre_row["revenue_days"], centre_row["revenue_per_day"], centre_row["team"]) == (2, 900, 0)
    assert (mladost_row["parts"]["till"], mladost_row["parts"]["off_book"], mladost_row["team"]) == (500, 60, 1)

    # The same numbers as Statistics: the locations and the shared part add up to them.
    summary = client.get(f"/api/statistics/summary?{NOVEMBER}", headers=owner).json()
    assert (result["total"]["income"], result["total"]["expense"]) == (summary["total_income"], summary["total_expense"])
    assert mladost_row["parts"]["payroll"] == summary["total_payroll_cost"] > 0
    assert mladost_row["expense"] == round(60 + summary["total_payroll_cost"], 2)
    assert round(sum(r["income"] for r in rows.values()) + result["shared"]["income"], 2) == result["total"]["income"]
    assert round(sum(r["expense"] for r in rows.values()) + result["shared"]["expense"], 2) == result["total"]["expense"]
    assert (result["shared"]["income"], result["shared"]["expense"]) == (300, 120)

    # A bill of Младост: owed under Младост, so its cash logged as revenue goes there.
    bill = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "bill", "customer_name": "Иван Петров", "issue_date": "2026-11-11", "location_id": mladost["id"],
        "items": [{"name": "Кетъринг", "quantity": 1, "unit": "бр.", "unit_price": 80}],
    }).json()
    owed = next(r for r in client.get("/api/receivables", headers=owner).json() if r["id"] == bill["receivable_id"])
    assert owed["location_id"] == mladost["id"]

    # A repeating invoice made of the centre's invoice issues for the centre too.
    template = client.post("/api/recurring-invoices", headers=owner, json={"from_document_id": issued["id"]})
    assert template.status_code == 200, template.text
    stored = asyncio.run(server.db.recurring_invoices.find_one({"company_id": company_id}, {"_id": 0, "location_id": 1}))
    assert stored["location_id"] == centre["id"]


def test_n11_kept_by_who_runs_the_business(client, on_today):
    company_id, _, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    assert client.post("/api/locations", headers=cashier, json={"name": "Склад"}).status_code == 403
    shop = _location(client, owner, "Магазин")
    # Everyone in the business sees the list (the forms pick from it); the
    # comparison only who sees the profit.
    assert [l["name"] for l in client.get("/api/locations", headers=cashier).json()] == ["Магазин"]
    assert client.get("/api/locations/compare", headers=cashier).status_code == 403

    # The cashier enters the shop's till; its pocket money, which they may not see, stays.
    _revenue(client, owner, "2026-11-10", shop, fiscal_revenue=400, pocket_money=50)
    seen = _part(client, cashier, "2026-11-10", shop)
    assert (seen["fiscal_revenue"], seen["pocket_money"]) == (400, 0)
    saved = _revenue(client, cashier, "2026-11-10", shop, fiscal_revenue=420, pocket_money=0, card_revenue=0)
    assert saved["pocket_money"] == 0                              # not in the reply either
    after = _part(client, owner, "2026-11-10", shop)
    assert (after["fiscal_revenue"], after["pocket_money"]) == (420, 50)
    assert _stored_day(company_id, "2026-11-10")["pocket_money"] == 50

    # Used: closed, not deleted - and what was entered stays its.
    assert client.delete(f"/api/locations/{shop['id']}", headers=owner).status_code == 409
    closed = client.put(f"/api/locations/{shop['id']}", headers=owner, json={"is_active": False})
    assert closed.status_code == 200 and closed.json()["is_active"] is False
    rows = client.get(f"/api/locations/compare?{NOVEMBER}", headers=owner).json()["locations"]
    assert [(r["name"], r["is_active"], r["parts"]["till"]) for r in rows] == [("Магазин", False, 420)]
    unused = _location(client, owner, "Нов обект")
    assert client.put(f"/api/locations/{unused['id']}", headers=owner, json={"name": "магазин"}).status_code == 409
    assert client.delete(f"/api/locations/{unused['id']}", headers=owner).status_code == 200

    # Another business's location is not theirs to change.
    _, _, stranger = _company()
    assert client.put(f"/api/locations/{shop['id']}", headers=stranger, json={"name": "Друго"}).status_code == 404
    assert client.delete(f"/api/locations/{shop['id']}", headers=stranger).status_code == 404
    # Nor can anyone file a record under it.
    assert client.post("/api/expenses", headers=stranger, json={
        "description": "Наем", "amount": 10, "date": "2026-11-10", "location_id": shop["id"]}).status_code == 400


def test_n11_records_move_between_locations(client, on_today):
    company_id, _, owner = _company()
    shop = _location(client, owner, "Магазин")
    expense = client.post("/api/expenses", headers=owner, json={
        "description": "Наем", "amount": 300, "date": "2026-11-05", "location_id": shop["id"]}).json()
    moved = client.put(f"/api/expenses/{expense['id']}", headers=owner, json={"location_id": ""})
    assert moved.status_code == 200 and moved.json()["location_id"] is None
    ivan = client.post("/api/employees", headers=owner, json={"name": "Иван", "base_salary": 900}).json()
    placed = client.put(f"/api/employees/{ivan['id']}", headers=owner, json={"location_id": shop["id"]}).json()
    assert placed["location_id"] == shop["id"]
    assert client.put(f"/api/employees/{ivan['id']}", headers=owner, json={"location_id": ""}).json()["location_id"] is None
    invoice = client.post("/api/invoices", headers=owner, json={
        "supplier": "Доставчик", "invoice_number": "M-1", "amount_without_vat": 100, "vat_amount": 20,
        "total_amount": 120, "date": "2026-11-04", "payment_method": "cash"}).json()
    assert client.put(f"/api/invoices/{invoice['id']}", headers=owner, json={"location_id": shop["id"]}).json()["location_id"] == shop["id"]
    rows = client.get(f"/api/locations/compare?{NOVEMBER}", headers=owner).json()
    assert rows["locations"][0]["parts"]["purchases"] == 120 and rows["locations"][0]["parts"]["off_book"] == 0
    assert rows["shared"]["expense"] == 300


def test_n11_locations_come_along_in_a_backup(client, on_today, no_rate_limit):  # noqa: F811 - the fixture
    company_id, _, owner = _company()
    shop = _location(client, owner, "Магазин")
    _revenue(client, owner, "2026-11-10", shop, fiscal_revenue=400)
    client.post("/api/expenses", headers=owner, json={
        "description": "Наем", "amount": 300, "date": "2026-11-05", "location_id": shop["id"]})
    backup = client.post("/api/backup/create", headers=owner).json()
    assert [l["name"] for l in backup["collections"]["locations"]] == ["Магазин"]

    other_id, _, other = _company()
    assert client.post("/api/backup/restore", headers=other, json=backup).status_code == 200
    [moved] = client.get("/api/locations", headers=other).json()
    assert moved["name"] == "Магазин" and moved["id"] != shop["id"]
    [row] = client.get(f"/api/locations/compare?{NOVEMBER}", headers=other).json()["locations"]
    assert (row["parts"]["till"], row["parts"]["off_book"]) == (400, 300)
    # Into the same business again: nothing doubles.
    again = client.post("/api/backup/restore", headers=owner, json=backup).json()
    assert again["restored"]["total"] == 0
    assert len(client.get("/api/locations", headers=owner).json()) == 1

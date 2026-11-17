"""The business's own selling prices and their margin (Н8): one price list,
the cost of each price from the latest purchases of what it is made of,
and when purchases get dearer: "маржът падна от 38% на 31% - за същия
марж: ..." The price changes only when the person says so."""
import asyncio

import pytest

import server
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company, _user


@pytest.fixture
def free_client(client):
    server.limiter.reset()
    server.limiter.enabled = False
    yield client
    server.limiter.enabled = True


def _buy(client, owner, number, day, lines, vat_share=0.2):
    base = round(sum(q * p for _, q, _, p in lines), 2)
    vat = round(base * vat_share, 2)
    response = client.post("/api/invoices", headers=owner, json={
        "supplier": "Склад Напитки ООД", "invoice_number": number, "date": day, "payment_method": "cash",
        "amount_without_vat": base, "vat_amount": vat, "total_amount": round(base + vat, 2),
        "items": [{"name": name, "quantity": q, "unit": unit, "unit_price": p} for name, q, unit, p in lines],
    })
    assert response.status_code == 200, response.text


def _purchase_item(client, owner, words):
    [item] = [i for i in client.get(f"/api/price-list/purchase-items?q={words}", headers=owner).json()]
    return item


def _entry(client, owner, entry_id):
    [entry] = [e for e in client.get("/api/price-list", headers=owner).json()["entries"] if e["id"] == entry_id]
    return entry


def test_n8_the_margin_a_price_leaves_and_when_purchases_eat_it(free_client):
    client = free_client
    company_id, _, owner = _company()
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"vat_registered": True}}))
    _buy(client, owner, "N-1", "2026-10-05", [("Бира 0,5 л", 24, "бр.", 1.24)])
    beer = _purchase_item(client, owner, "бира")
    assert (beer["unit_price"], beer["unit"]) == (1.24, "бр.")

    created = client.post("/api/price-list", headers=owner, json={
        "name": "Бира 0,5 л", "unit": "бр.", "price": 2.00, "vat_rate": 20,
        "costs": [{"item_name": beer["item_name"], "quantity": 1, "unit": "бр."}],
    })
    assert created.status_code == 200, created.text
    entry = created.json()
    # The same price everywhere: 2.00 without VAT on an invoice, 2.40 on a bill.
    assert (entry["price"], entry["price_gross"], entry["cost"], entry["margin_percent"]) == (2.0, 2.4, 1.24, 38.0)
    assert entry["margin_dropped"] is False

    # The supplier raises the price: the margin falls, and the price that keeps it is said.
    _buy(client, owner, "N-2", "2026-11-10", [("Бира 0,5 л", 24, "бр.", 1.38)])
    dearer = _entry(client, owner, entry["id"])
    assert (dearer["cost"], dearer["margin_then_percent"], dearer["margin_percent"], dearer["margin_dropped"]) == (1.38, 38.0, 31.0, True)
    assert (dearer["suggested_price"], dearer["suggested_gross"]) == (2.23, 2.68)
    signals = {s["key"]: s for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}
    assert signals["margins"]["detail"] == "Маржът на „Бира 0,5 л“ падна от 38% на 31% - за същия марж: 2.68 € с ДДС."
    assert signals["margins"]["route"] == "/price-list"
    # Nothing changed by itself.
    assert dearer["price"] == 2.0

    # Kept as it is: the margin now is the new measure - said again only on the next rise.
    kept = client.post(f"/api/price-list/{entry['id']}/keep", headers=owner).json()
    assert (kept["margin_dropped"], kept["margin_then_percent"]) == (False, 31.0)
    assert "margins" not in {s["key"] for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}
    _buy(client, owner, "N-3", "2026-11-15", [("Бира 0,5 л", 24, "бр.", 1.45)])
    again = _entry(client, owner, entry["id"])
    assert (again["margin_dropped"], again["margin_then_percent"], again["margin_percent"], again["suggested_price"]) == (True, 31.0, 27.5, 2.1)
    # A new price: what it leaves now is the measure.
    repriced = client.put(f"/api/price-list/{entry['id']}", headers=owner, json={"price": 2.23}).json()
    assert (repriced["price"], repriced["cost_at_price"], repriced["margin_percent"], repriced["margin_dropped"]) == (2.23, 1.45, 35.0, False)
    stored = asyncio.run(server.db.price_list.find_one({"id": entry["id"]}, {"_id": 0}))
    assert [h["price"] for h in stored["history"]] == [2.0, 2.23]


def test_n8_a_price_made_of_several_purchases_with_the_vat_paid(free_client):
    client = free_client
    company_id, _, owner = _company()
    # Not registered for VAT: the VAT paid is a cost, and none is charged.
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"vat_registered": False}}))
    _buy(client, owner, "K-1", "2026-10-01", [("Кафе на зърна", 2, "кг", 20.00), ("Мляко прясно", 10, "л", 1.50)])
    coffee, milk = _purchase_item(client, owner, "кафе"), _purchase_item(client, owner, "мляко")
    entry = client.post("/api/price-list", headers=owner, json={
        "name": "Капучино", "price": 3.00, "costs": [
            {"item_name": coffee["item_name"], "quantity": 0.009, "unit": "кг"},
            {"item_name": milk["item_name"], "quantity": 0.15, "unit": "л"},
        ],
    }).json()
    # 9 g of coffee at 24.00 €/kg and 150 ml of milk at 1.80 €/l, VAT included.
    assert (entry["cost"], entry["margin_percent"], entry["vat_rate"], entry["price_gross"]) == (0.49, 83.8, 0, 3.0)
    assert [round(line["line_cost"], 3) for line in entry["costs"]] == [0.216, 0.27]

    # Milk bought once in bottles: the part kept in litres still counts the litre price.
    _buy(client, owner, "K-2", "2026-11-02", [("Мляко прясно", 6, "бр.", 1.80)])
    assert _entry(client, owner, entry["id"])["cost"] == 0.49
    # A part never bought: no cost, no margin - never a made-up one.
    unknown = client.post("/api/price-list", headers=owner, json={
        "name": "Чай", "price": 2.0, "costs": [{"item_name": "чай мента", "quantity": 1}]}).json()
    assert (unknown["cost"], unknown["margin_percent"], unknown["margin_dropped"]) == (None, None, False)


def test_n8_the_list_for_documents_and_who_sees_what(free_client):
    client = free_client
    company_id, _, owner = _company()
    _issue(client, owner, items=[{"name": "Консултация", "quantity": 1, "unit": "час", "unit_price": 150, "vat_rate": 20}])
    sold = client.get("/api/price-list/sold-items", headers=owner).json()
    assert {"name": "Консултация", "unit": "час", "price": 150, "vat_rate": 20} == {k: sold[0][k] for k in ("name", "unit", "price", "vat_rate")}
    entry = client.post("/api/price-list", headers=owner, json={"name": "Консултация", "unit": "час", "price": 150}).json()
    assert client.get("/api/price-list/sold-items", headers=owner).json() == []
    assert client.post("/api/price-list", headers=owner, json={"name": "консултация", "price": 1}).status_code == 409

    # Whoever sells reads the prices - not what they cost; only the owner or a manager sets them.
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    listed = client.get("/api/price-list", headers=cashier).json()
    assert (listed["can_edit"], listed["sees_costs"]) == (False, False)
    assert set(listed["entries"][0]) == {"id", "name", "unit", "price", "vat_rate", "price_gross", "price_set_at"}
    assert client.post("/api/price-list", headers=cashier, json={"name": "Х", "price": 1}).status_code == 403
    assert client.put(f"/api/price-list/{entry['id']}", headers=cashier, json={"price": 1}).status_code == 403
    assert client.get("/api/price-list/purchase-items", headers=cashier).status_code == 403
    _, nobody = _user(company_id, "staff", ["view_calendar"], "Друг")
    assert client.get("/api/price-list", headers=nobody).status_code == 403
    _, _, stranger = _company()
    assert client.get("/api/price-list", headers=stranger).json()["entries"] == []
    assert client.put(f"/api/price-list/{entry['id']}", headers=stranger, json={"price": 1}).status_code == 404

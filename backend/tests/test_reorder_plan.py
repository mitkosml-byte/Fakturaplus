"""The ordering plan: every item with a rhythm, grouped by the supplier it
was last bought from - to order now, soon or not yet - the suppliers with
something to order first; the items far past their rhythm apart, to be
asked about, and hidden once the owner says they are no longer used
(back when bought again).

Invented suppliers, items and numbers."""
import asyncio
from datetime import datetime, timedelta, timezone

import server
from tests.test_whole_program_fixes import _company, _user

ALPHA = "Доставчик Алфа ЕООД"
BETA = "Доставчик Бета ООД"
GAMMA = "Доставчик Гама ЕТ"


def _bought(company_id, supplier, item, days_ago, quantity=2, unit_price=10.0, unit="бр"):
    now = datetime.now(timezone.utc)
    return [{
        "company_id": company_id, "supplier": supplier, "item_name": item, "unit": unit,
        "unit_price": unit_price, "quantity": quantity,
        "invoice_id": f"inv-{item}-{d}", "invoice_number": f"{d:010d}", "invoice_date": now - timedelta(days=d),
    } for d in days_ago]


def test_the_plan_by_supplier(client):
    company_id, _, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Ивана Касиерова")
    history = (
        # Alpha: one past its rhythm, one due tomorrow, one not yet.
        _bought(company_id, ALPHA, "ръкавици L", [58, 44, 30, 16], quantity=3)
        + _bought(company_id, ALPHA, "дървени вилички", [55, 41, 27, 13], quantity=6)
        + _bought(company_id, ALPHA, "салфетки", [32, 22, 12, 2])
        # Beta: nothing due; the cheese moved to Beta from Alpha.
        + _bought(company_id, BETA, "картофи", [22, 15, 8, 1], quantity=4)
        + _bought(company_id, ALPHA, "кашкавал", [29, 22])
        + _bought(company_id, BETA, "кашкавал", [15, 8, 1])
        # Gamma: every 3 days, last a month ago - most likely dropped.
        + _bought(company_id, GAMMA, "айрян", [43, 40, 37, 34, 31], quantity=39, unit_price=0.8)
    )
    asyncio.run(server.db.item_price_history.insert_many(history))

    plan = client.get("/api/items/reorder-plan", headers=owner).json()
    alpha, beta = plan["suppliers"]
    assert alpha["supplier"] == ALPHA and alpha["status"] == "order"
    assert [(n["item_name"], n["status"]) for n in alpha["items"]] == [
        ("ръкавици L", "order"), ("дървени вилички", "soon"), ("салфетки", "ok")]
    assert (alpha["to_order"], alpha["soon"]) == (1, 1)
    assert alpha["order_value"] == round(alpha["items"][0]["avg_order_value"] + alpha["items"][1]["avg_order_value"], 2)
    assert alpha["items"][0]["days_until_due"] == -2 and alpha["items"][0]["recommended_quantity"] >= 0

    # The cheese goes where it was last bought, and says it had another.
    assert beta["supplier"] == BETA and beta["status"] == "ok" and beta["to_order"] == 0
    [cheese] = [n for n in beta["items"] if n["item_name"] == "кашкавал"]
    assert cheese["last_supplier"] == BETA and cheese["suppliers_count"] == 2

    # The yogurt drink: not a supplier's order - a question.
    [ayran] = plan["stale"]
    assert ayran["item_name"] == "айрян" and "status" not in ayran
    assert all(n["item_name"] != "айрян" for g in plan["suppliers"] for n in g["items"])

    # "No longer used": hidden - and back once it is bought again.
    assert client.post("/api/items/reorder-plan/hide", headers=owner, json={"item_key": ayran["item_key"]}).status_code == 200
    assert client.get("/api/items/reorder-plan", headers=owner).json()["stale"] == []
    asyncio.run(server.db.item_price_history.insert_many(
        _bought(company_id, GAMMA, "айрян", [0], quantity=39, unit_price=0.8)))
    back = client.get("/api/items/reorder-plan", headers=owner).json()
    assert any(n["item_name"] == "айрян" for g in back["suppliers"] for n in g["items"])

    # Whoever has no statistics sees no plan and hides nothing.
    assert client.get("/api/items/reorder-plan", headers=cashier).status_code == 403
    assert client.post("/api/items/reorder-plan/hide", headers=cashier, json={"item_key": "салфетки"}).status_code == 403

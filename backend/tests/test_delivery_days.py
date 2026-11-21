"""Fixed delivery days in the ordering plan. A supplier's days are read from
the dates of its invoices (the day the goods came); an item's order goes
with the delivery it cannot wait past and is due the day before it - never
on the day of the delivery. "Поръчано" waits for that delivery; a delivery
that came without something ordered is told, so is yesterday's expected
delivery with no invoice, and a public holiday on the next one.

Invented suppliers, items and numbers. The days are laid out around
today's weekday, so the tests hold whichever day they run on."""
import asyncio
from datetime import datetime, timedelta, timezone

import server
from routers import price_tracking
from services.business_calendar import day_start_utc, today_local
from tests.test_day_card import weather  # noqa: F401 - the day card's stand-in weather
from tests.test_reorder_plan import _bought
from tests.test_whole_program_fixes import _company, _user

DELTA = "Доставчик Делта ЕООД"
EPSILON = "Доставчик Епсилон ООД"


def _days_ago(weekdays, weeks=6, skip=()):
    """How many days ago each day of those weekdays was, over the last weeks."""
    today = today_local()
    return [n for n in range(1, 7 * weeks + 1) if (today - timedelta(days=n)).weekday() in weekdays and n not in skip]


def _weekday(days_ago):
    return (today_local() - timedelta(days=days_ago)).weekday()


def _invoices(company_id, supplier, days_ago):
    today = today_local()
    asyncio.run(server.db.invoices.insert_many([{
        "id": f"inv-{supplier}-{n}", "company_id": company_id, "user_id": "x", "supplier": supplier,
        "invoice_number": f"{n:08d}", "date": day_start_utc(today - timedelta(days=n)), "total_amount": 100.0,
        "created_at": datetime.now(timezone.utc),
    } for n in days_ago]))


def _delta(company_id):
    """Delta delivers on tomorrow's weekday and two and four days after it
    (like Monday, Wednesday and Friday): bread and milk with every delivery
    - more bread on the delivery after the long gap - and cheese once a week."""
    t = today_local().weekday()
    weekdays = {(t + 1) % 7, (t + 3) % 7, (t + 5) % 7}
    days = _days_ago(weekdays)
    _invoices(company_id, DELTA, days)
    rows = []
    for n in days:
        rows += _bought(company_id, DELTA, "хляб", [n], quantity=35 if _weekday(n) == (t + 1) % 7 else 20, unit_price=1.0)
        rows += _bought(company_id, DELTA, "мляко", [n], quantity=10, unit_price=1.5)
    rows += _bought(company_id, DELTA, "сирене", [n for n in days if _weekday(n) == (t + 3) % 7], quantity=5, unit_price=9.0)
    asyncio.run(server.db.item_price_history.insert_many(rows))
    return sorted(weekdays)


def _plan(client, headers, supplier):
    return next(g for g in client.get("/api/items/reorder-plan", headers=headers).json()["suppliers"]
                if g["supplier"] == supplier)


def _focus(client, headers):
    return {item["key"]: item["text"] for item in client.get("/api/day-card", headers=headers).json()["focus"]}


def _quiet_day_card(client, company_id, owner):
    """The day card shows two lines: yesterday's revenue entered and no VAT
    to file, so these tests see the order lines whatever day they run on."""
    yesterday = (today_local() - timedelta(days=1)).isoformat()
    client.post("/api/daily-revenue", headers=owner, json={"date": yesterday, "fiscal_revenue": 500})
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"vat_registered": False}}))


def test_the_order_goes_with_a_delivery_day_and_is_due_the_day_before(client, weather):  # noqa: F811
    company_id, _, owner = _company()
    _quiet_day_card(client, company_id, owner)
    weekdays = _delta(company_id)
    today = today_local()
    tomorrow = (today + timedelta(days=1)).isoformat()

    delta = _plan(client, owner, DELTA)
    assert delta["schedule"] == weekdays and not delta["schedule_changed"]
    assert delta["next_delivery"] == tomorrow and delta["order_by"] == today.isoformat()
    items = {n["item_name"]: n for n in delta["items"]}
    # Bread and milk come with every delivery: in tomorrow's order, due today.
    for name in ("хляб", "мляко"):
        assert (items[name]["status"], items[name]["delivery"], items[name]["in_next_order"]) == ("order", tomorrow, True)
    # How much: what is usually taken on that weekday.
    assert items["хляб"]["recommended_quantity"] == 35 and items["хляб"]["usual_for_weekday"]
    # The cheese waits for its own day - due the day before it, not now.
    cheese = items["сирене"]
    assert cheese["delivery"] == (today + timedelta(days=3)).isoformat()
    assert cheese["order_by"] == (today + timedelta(days=2)).isoformat()
    assert cheese["status"] == "soon" and not cheese["in_next_order"]
    assert (delta["to_order"], delta["soon"]) == (2, 1)
    assert delta["order_value"] == round(items["хляб"]["avg_order_value"] + items["мляко"]["avg_order_value"], 2)

    assert _focus(client, owner)["to_order"] == "За поръчка днес (доставка утре): Доставчик Делта"


def test_ordered_waits_for_its_delivery_and_tells_what_did_not_come(client, weather):  # noqa: F811
    company_id, _, owner = _company()
    _, accountant = _user(company_id, "accountant", sorted(server.ROLE_PERMISSIONS["accountant"]), "Анна Счетоводителева")
    _quiet_day_card(client, company_id, owner)
    _delta(company_id)
    today = today_local()

    marked = client.post("/api/items/reorder-plan/ordered", headers=owner, json={"item_keys": ["хляб", "мляко"]}).json()
    assert marked["ordered"] == 2 and len(marked["order_ids"]) == 1
    mark = asyncio.run(server.db.reorder_marks.find_one({"company_id": company_id, "item_key": "хляб"}, {"_id": 0}))
    assert mark["delivery"] == (today + timedelta(days=1)).isoformat() and mark["supplier_key"] == DELTA.lower()
    delta = _plan(client, owner, DELTA)
    assert {n["item_name"]: n["status"] for n in delta["items"]}["хляб"] == "ordered" and delta["to_order"] == 0
    assert "to_order" not in _focus(client, owner)

    # Ordered yesterday; today the delivery came - with the milk, without the bread.
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    asyncio.run(server.db.reorder_marks.update_many({"company_id": company_id}, {"$set": {"ordered_at": yesterday}}))
    asyncio.run(server.db.reorder_orders.update_many({"company_id": company_id}, {"$set": {"ordered_at": yesterday}}))
    asyncio.run(server.db.item_price_history.insert_many(_bought(company_id, DELTA, "мляко", [0], quantity=10, unit_price=1.5)))
    price_tracking.forget_due(company_id)

    delta = _plan(client, owner, DELTA)
    bread = next(n for n in delta["items"] if n["item_name"] == "хляб")
    assert bread["status"] == "order" and bread["missing_on"] == today.isoformat()
    assert delta["missing"] == {"date": today.isoformat(), "items": ["хляб"]}
    assert _focus(client, owner)["missing_delivery"] == "Доставчик Делта достави без: хляб"
    # The accountant keeps the books, not the orders.
    assert "missing_delivery" not in _focus(client, accountant)

    # Undone: the marks and the order are gone.
    client.post("/api/items/reorder-plan/ordered/undo", headers=owner,
                json={"item_keys": ["хляб", "мляко"], "order_ids": marked["order_ids"]})
    assert asyncio.run(server.db.reorder_orders.count_documents({"company_id": company_id})) == 0
    assert _plan(client, owner, DELTA)["missing"] is None


def test_ordered_lapses_a_day_after_its_delivery(client):
    company_id, _, owner = _company()
    _delta(company_id)
    today = today_local()
    client.post("/api/items/reorder-plan/ordered", headers=owner, json={"item_keys": ["хляб"]})
    # Ordered for a delivery two days ago, and nothing of it came since.
    asyncio.run(server.db.reorder_marks.update_one(
        {"company_id": company_id, "item_key": "хляб"},
        {"$set": {"ordered_at": datetime.now(timezone.utc) - timedelta(days=3),
                  "delivery": (today - timedelta(days=2)).isoformat()}}))
    asyncio.run(server.db.item_price_history.delete_many(
        {"company_id": company_id, "item_name": "хляб", "invoice_date": {"$gte": day_start_utc(today - timedelta(days=3))}}))
    bread = next(n for n in _plan(client, owner, DELTA)["items"] if n["item_name"] == "хляб")
    assert bread["status"] == "order" and "ordered" not in bread


def test_yesterdays_delivery_without_an_invoice(client, weather, monkeypatch):  # noqa: F811
    # Whatever day the test runs on, yesterday is no public holiday here.
    monkeypatch.setattr(price_tracking, "get_bulgarian_public_holidays", lambda year: [])
    company_id, _, owner = _company()
    _, accountant = _user(company_id, "accountant", sorted(server.ROLE_PERMISSIONS["accountant"]), "Анна Счетоводителева")
    _, receiver = _user(company_id, "staff", ["manage_invoices", "add_expenses"], "Иван Приемчиков")
    _quiet_day_card(client, company_id, owner)
    t = today_local().weekday()
    # Epsilon comes on yesterday's weekday every week - but not yesterday.
    weekdays = {(t + 6) % 7, (t + 2) % 7, (t + 4) % 7}
    days = _days_ago(weekdays, skip={1})
    _invoices(company_id, EPSILON, days)
    asyncio.run(server.db.item_price_history.insert_many(_bought(company_id, EPSILON, "домати", days, quantity=8)))
    yesterday = (today_local() - timedelta(days=1)).isoformat()

    assert _plan(client, owner, EPSILON)["no_invoice"] == yesterday
    line = "Няма фактура за вчерашната доставка от Доставчик Епсилон"
    assert _focus(client, owner)["no_invoice"] == line
    # Whoever takes in the deliveries and scans them; not the accountant.
    assert _focus(client, receiver)["no_invoice"] == line
    assert "no_invoice" not in _focus(client, accountant)

    # Its invoice scanned: gone.
    _invoices(company_id, EPSILON, [1])
    price_tracking.forget_due(company_id)
    assert _plan(client, owner, EPSILON)["no_invoice"] is None
    assert "no_invoice" not in _focus(client, owner)


def test_a_public_holiday_on_the_next_delivery(client, weather, monkeypatch):  # noqa: F811
    company_id, _, owner = _company()
    _quiet_day_card(client, company_id, owner)
    _delta(company_id)
    tomorrow = today_local() + timedelta(days=1)
    monkeypatch.setattr(price_tracking, "get_bulgarian_public_holidays",
                        lambda year: [{"date": tomorrow.isoformat(), "name": "Празник за проба"}])

    assert _plan(client, owner, DELTA)["holiday"] == {"date": tomorrow.isoformat(), "name": "Празник за проба"}
    text = _focus(client, owner)["delivery_holiday"]
    assert "е празник – Доставчик Делта може да не достави. Поръчай за повече дни." in text

"""Gross, operating and net margin on Home: how much of every euro of sales
is left after the goods, after running the business (payroll, the recurring
costs by the days of their month, depreciation) and after the profit tax -
without VAT for a business that deducts it, with the change since the period
before, and only of what the viewer sees.

Invented business, suppliers and numbers."""
import asyncio
from datetime import date

import server
from services import margins as mg
from services.business_calendar import Period
from tests.test_whole_program_fixes import _company, _user

TODAY = date(2026, 11, 21)
NOVEMBER = {"start_date": "2026-11-01", "end_date": "2026-11-30"}


def test_the_margins_worked_out():
    figures = mg.Figures(sales=10000, goods=5000, payroll=2100, recurring=1400, depreciation=0)
    margins = mg.margins_of(figures, 10)
    assert (margins["gross"]["percent"], margins["operating"]["percent"], margins["net"]["percent"]) == (50.0, 15.0, 13.5)
    assert margins["costs"]["profit_tax"] == 150 and margins["net"]["profit"] == 1350
    # No profit tax on a loss; no margins without sales.
    loss = mg.margins_of(mg.Figures(sales=1000, goods=800, payroll=400, recurring=0, depreciation=0), 10)
    assert loss["operating"]["percent"] == loss["net"]["percent"] == -20.0 and loss["costs"]["profit_tax"] == 0
    assert mg.margins_of(mg.Figures(0, 300, 0, 0, 0), 10) is None
    # The change since the period before, in percentage points.
    before = mg.margins_of(mg.Figures(sales=10000, goods=6000, payroll=2100, recurring=1400, depreciation=0), 10)
    changed = mg.with_change(margins, before)
    assert (changed["gross"]["change"], changed["operating"]["change"], changed["net"]["change"]) == (10.0, 10.0, 9.0)


def test_the_period_compared_with():
    november = Period(date(2026, 11, 1), date(2026, 11, 30))
    # A month so far: the month before through the same day; a whole month: the whole month before.
    assert mg.previous_period(november, Period(date(2026, 11, 1), TODAY)) == Period(date(2026, 10, 1), date(2026, 10, 21))
    october = Period(date(2026, 10, 1), date(2026, 10, 31))
    assert mg.previous_period(october, october) == Period(date(2026, 9, 1), date(2026, 9, 30))
    march = Period(date(2027, 3, 1), date(2027, 3, 31))
    assert mg.previous_period(march, Period(date(2027, 3, 1), date(2027, 3, 30))) == Period(date(2027, 2, 1), date(2027, 2, 28))
    assert mg.previous_period(march, march) == Period(date(2027, 2, 1), date(2027, 2, 28))
    # A year so far: last year through the same day.
    year = Period(date(2026, 1, 1), date(2026, 12, 31))
    assert mg.previous_period(year, Period(date(2026, 1, 1), TODAY)) == Period(date(2025, 1, 1), date(2025, 11, 21))
    # A week so far: the same days of the week before; a day: the day before.
    week = Period(date(2026, 11, 16), date(2026, 11, 22))
    assert mg.previous_period(week, Period(date(2026, 11, 16), TODAY)) == Period(date(2026, 11, 9), date(2026, 11, 14))
    assert mg.previous_period(Period.day(TODAY), Period.day(TODAY)) == Period.day(date(2026, 11, 20))
    # Everything since the start: nothing to compare with.
    assert mg.previous_period(Period(date(2000, 1, 1), TODAY), Period(date(2000, 1, 1), TODAY)) is None


def test_the_profit_tax_rate():
    assert mg.profit_tax_percent({"name": "Пекарна Проба ЕООД"}) == 10
    assert mg.profit_tax_percent({"name": 'ЕТ "Иван Пробов"'}) == 15
    assert mg.profit_tax_percent({"name": "Пробов - ЕТ"}) == 15
    # "ет" inside a word is no legal form.
    assert mg.profit_tax_percent({"name": "Детелина ЕТЕРНА ООД"}) == 10
    # The business's own rate - a patent tax, say - comes first.
    assert mg.profit_tax_percent({"name": 'ЕТ "Иван Пробов"', "profit_tax_percent": 0}) == 0
    assert mg.profit_tax_percent({"name": "Проба ООД", "profit_tax_percent": True}) == 10
    assert mg.profit_tax_percent(None) == 10


def _fake_today(monkeypatch):
    monkeypatch.setattr(server, "today_local", lambda: TODAY)
    monkeypatch.setattr(server.recurring_service, "current_day", lambda: TODAY)


def _month(client, owner, company_id, owner_id, month, goods_net, utility_paid=True):
    """A month through the 21st: 10 800 € at the till (VAT 1 800 in it) and
    1 000 € of pocket money; goods by invoice and 1 000 € at the market
    without one; the rent (1 750 €, no invoice) and the electricity (300 €
    with VAT 50 €) - both recurring; 3 000 € of payroll for the month."""
    for day in range(1, 11):
        client.post("/api/daily-revenue", headers=owner, json={
            "date": f"2026-{month:02d}-{day:02d}", "fiscal_revenue": 1080, "pocket_money": 100, "vat_rate_percent": 20})
    client.post("/api/invoices", headers=owner, json={
        "supplier": "Склад Проба", "invoice_number": f"G-{month}", "date": f"2026-{month:02d}-10",
        "amount_without_vat": goods_net, "vat_amount": goods_net * 0.2, "total_amount": goods_net * 1.2, "payment_method": "cash",
    })
    key = f"2026-{month:02d}"
    rows = [{
        "id": f"market-{company_id}-{month}", "company_id": company_id, "user_id": owner_id, "description": "Пазар",
        "amount": 1000, "date": f"{key}-08",
    }, {
        "id": f"rent-{company_id}-{month}", "company_id": company_id, "user_id": owner_id, "description": "Наем",
        "amount": 1750, "date": f"{key}-03", "recurring_id": f"rent-{company_id}", "recurring_month": key,
    }]
    asyncio.run(server.db.expenses.insert_many(rows))
    if utility_paid:
        asyncio.run(server.db.invoices.insert_one({
            "id": f"power-{company_id}-{month}", "company_id": company_id, "user_id": owner_id, "supplier": "Енерго Проба",
            "invoice_number": f"E-{month}", "date": server.day_start_utc(date(2026, month, 5)),
            "amount_without_vat": 250.0, "vat_amount": 50.0, "total_amount": 300.0, "payment_method": "bank_transfer",
            "is_paid": True, "recurring_id": f"power-{company_id}", "recurring_month": key,
        }))
    asyncio.run(server.db.payroll_entries.insert_one({
        "id": f"pay-{company_id}-{month}", "company_id": company_id, "user_id": owner_id,
        "period_month": month, "period_year": 2026, "total_employer_cost": 3000.0,
    }))


def _business(client, monkeypatch, utility_paid=True):
    _fake_today(monkeypatch)
    company_id, owner_id, owner = _company()
    asyncio.run(server.db.recurring_expenses.insert_many([{
        "id": f"rent-{company_id}", "company_id": company_id, "description": "Наем", "amount": 1750, "day_of_month": 3,
        "kind": "no_invoice", "start_month": "2026-10", "is_active": True,
    }, {
        "id": f"power-{company_id}", "company_id": company_id, "description": "Ток", "supplier": "Енерго Проба",
        "amount": 300, "day_of_month": 5, "kind": "invoice", "start_month": "2026-10", "is_active": True,
    }]))
    _month(client, owner, company_id, owner_id, 10, goods_net=5000)
    _month(client, owner, company_id, owner_id, 11, goods_net=4000, utility_paid=utility_paid)
    return company_id, owner_id, owner


def test_the_margins_of_the_month_so_far(client, monkeypatch):
    company_id, owner_id, owner = _business(client, monkeypatch)
    margins = client.get("/api/statistics/margins", headers=owner, params=NOVEMBER).json()
    assert margins["available"] is True and margins["vat_excluded"] is True
    assert margins["period"] == {"start_date": "2026-11-01", "end_date": "2026-11-21"}
    assert margins["previous_period"] == {"start_date": "2026-10-01", "end_date": "2026-10-21"}
    # Sales without VAT: 9 000 € from the till and 1 000 € of pocket money.
    assert margins["sales"] == 10000
    # Goods: 4 000 € by invoice and 1 000 € at the market - the rent and the
    # electricity are recurring costs, not goods (and the electricity's VAT is deducted).
    assert margins["costs"]["goods"] == 5000 and margins["gross"]["percent"] == 50.0
    # Running the business: 21 of November's 30 days of the payroll and of the
    # month's recurring costs (1 750 + 250 without VAT).
    assert (margins["costs"]["payroll"], margins["costs"]["recurring"]) == (2100, 1400)
    assert (margins["operating"]["profit"], margins["operating"]["percent"]) == (1500, 15.0)
    # A company: 10% profit tax.
    assert margins["profit_tax_percent"] == 10 and margins["net"]["percent"] == 13.5
    # October through the 21st: 6 000 € of goods on the same sales, 21 of its 31 days.
    october_operating = 10000 - 6000 - 21 / 31 * 3000 - 21 / 31 * 2000
    assert margins["gross"]["change"] == 10.0
    assert margins["operating"]["change"] == round(15.0 - round(october_operating / 100, 1), 1)
    assert margins["net"]["change"] == round(13.5 - round(october_operating * 0.9 / 100, 1), 1)
    assert not margins["no_recurring_costs"] and not margins["payroll_left_out"]

    # Home brings the same.
    home = client.get("/api/home", headers=owner, params=NOVEMBER).json()
    assert home["margins"] == margins

    # The business's own rate: a patent tax, no profit tax.
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"eik": "000000017"}}))
    assert client.put("/api/company", headers=owner, json={"profit_tax_percent": 60}).status_code == 422
    assert client.put("/api/company", headers=owner, json={"profit_tax_percent": 0}).json()["profit_tax_percent"] == 0
    untaxed = client.get("/api/statistics/margins", headers=owner, params=NOVEMBER).json()
    assert untaxed["net"]["percent"] == untaxed["operating"]["percent"] == 15.0
    # Emptied in the form: back to the law's - a sole trader's 15% by the name.
    saved = client.post("/api/company", headers=owner, json={
        "name": 'ЕТ "Пробов"', "eik": "000000017", "profit_tax_percent": None}).json()
    assert saved["profit_tax_percent"] is None
    sole_trader = client.get("/api/statistics/margins", headers=owner, params=NOVEMBER).json()
    assert sole_trader["profit_tax_percent"] == 15 and sole_trader["net"]["percent"] == 12.8


def test_an_invoice_still_to_come_and_a_business_without_vat(client, monkeypatch):
    company_id, _, owner = _business(client, monkeypatch, utility_paid=False)
    # November's electricity invoice is not in yet: its usual 300 € counts,
    # without VAT at the standard rate (250 €) - the margins stay the same.
    margins = client.get("/api/statistics/margins", headers=owner, params=NOVEMBER).json()
    # The goods: 4 000 + 1 000 - the electricity never among them.
    assert margins["costs"]["goods"] == 5000
    assert margins["costs"]["recurring"] == 1400 and margins["operating"]["percent"] == 15.0

    # Not registered for VAT: the VAT is in the sales and is a cost of the purchases.
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"vat_registered": False}}))
    gross = client.get("/api/statistics/margins", headers=owner, params=NOVEMBER).json()
    assert gross["vat_excluded"] is False and gross["sales"] == 11800
    assert gross["costs"]["goods"] == 4800 + 1000 and gross["costs"]["recurring"] == round((1750 + 300) * 0.7, 2)


def test_only_what_the_viewer_sees(client, monkeypatch):
    company_id, _, owner = _business(client, monkeypatch)
    # Sees the statistics and the profit - not the pocket money, the expenses
    # without invoice or the payroll: the margins of what they see, like their profit.
    _, manager = _user(company_id, "manager", ["view_statistics", "view_profit"], "Мария Пробова")
    seen = client.get("/api/statistics/margins", headers=manager, params=NOVEMBER).json()
    assert seen["sales"] == 9000 and seen["costs"]["payroll"] == 0 and seen["payroll_left_out"] is True
    # The goods: the invoices only (4 000 €); the recurring costs: the electricity's share only.
    assert seen["costs"]["goods"] == 4000 and seen["costs"]["recurring"] == round(250 * 0.7, 2)

    # Whoever may not see the profit gets no margins - on Home, nothing.
    _, cashier = _user(company_id, "staff", ["view_statistics", "add_revenue"], "Касиер Пробов")
    assert client.get("/api/statistics/margins", headers=cashier, params=NOVEMBER).status_code == 403
    assert client.get("/api/home", headers=cashier, params=NOVEMBER).json()["margins"] is None


def test_no_sales_and_no_recurring_costs(client, monkeypatch):
    _fake_today(monkeypatch)
    _, _, owner = _company()
    empty = client.get("/api/statistics/margins", headers=owner, params=NOVEMBER).json()
    assert empty["available"] is False and empty["no_recurring_costs"] is True
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-11-02", "fiscal_revenue": 1200, "vat_rate_percent": 20})
    first = client.get("/api/statistics/margins", headers=owner, params=NOVEMBER).json()
    assert first["available"] is True and first["gross"]["percent"] == 100.0
    # No October to compare with.
    assert first["gross"]["change"] is None

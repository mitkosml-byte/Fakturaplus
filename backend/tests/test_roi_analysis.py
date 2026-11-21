"""ROI card ("Лични вложения"): does the business pay back what the owner
put in, what moved profit, and what can be done - from the company's own
numbers, with the same profit as the dashboard (payroll included). The AI
advice on top is asked for on demand and kept until the numbers change.
Generic data; each test builds its own company."""
import asyncio
import calendar
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import server
from routers import roi_wallet
from routers.roi_wallet import RoiAdvice, build_roi_analysis, get_roi_advice
from services import forecast_service as fs

PERMS = [
    "view_personal_investments", "view_profit", "view_statistics", "view_pocket_money", "view_off_book_expenses",
    # The owner keeps the payroll: the salaries are in the profit.
    "manage_payroll",
]


def _company():
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = server.User(user_id=user_id, email=f"{user_id}@test.com", name="ROI Owner", role="owner",
                       company_id=company_id, permissions=PERMS)
    return company_id, user


def _last_months(count):
    """The last `count` whole months, oldest first."""
    now = datetime.now(timezone.utc)
    return [fs._ym_add(now.year, now.month, -back) for back in range(count, 0, -1)]


async def _seed(company_id, user, months, revenue_per_day=200.0, metro=2000.0, payroll=2500.0, personal=1000.0,
                metro_last=None):
    await server.db.users.insert_one({
        "user_id": user.user_id, "email": user.email, "name": user.name, "role": "owner", "company_id": company_id,
        "permissions": user.permissions, "auth_provider": "email", "has_password": True,
        "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION, "created_at": datetime.now(timezone.utc),
    })
    for i, (y, m) in enumerate(months):
        days = calendar.monthrange(y, m)[1]
        await server.db.daily_revenue.insert_many([
            {"user_id": user.user_id, "date": f"{y}-{m:02d}-{d:02d}", "fiscal_revenue": revenue_per_day,
             "pocket_money": 0, "card_revenue": 0}
            for d in range(1, days + 1)
        ])
        amount = metro_last if (metro_last is not None and i == len(months) - 1) else metro
        await server.db.invoices.insert_one({
            "id": f"inv-{uuid.uuid4().hex[:8]}", "company_id": company_id, "user_id": user.user_id,
            "supplier": "Метро", "invoice_number": f"{y}{m}", "date": datetime(y, m, 10, tzinfo=timezone.utc),
            "total_amount": amount, "amount_without_vat": amount / 1.2, "vat_amount": amount - amount / 1.2,
            "payment_method": "cash", "is_paid": True, "paid_amount": amount,
        })
        await server.db.payroll_entries.insert_one({
            "id": f"pay-{uuid.uuid4().hex[:8]}", "company_id": company_id, "user_id": user.user_id,
            "period_month": m, "period_year": y, "total_employer_cost": payroll,
        })
        await server.db.personal_expenses.insert_one({
            "id": f"pe-{uuid.uuid4().hex[:8]}", "company_id": company_id, "user_id": user.user_id,
            "amount": personal, "description": "Вложение", "expense_type": "investment", "category": "other",
            "period_month": m, "period_year": y,
        })


def test_payback_uses_dashboard_profit_and_names_what_moved():
    """Profit counts payroll like the dashboard does - without it a business
    paying salaries looked several times more profitable than it is - and
    the month's change against the usual is named with its euros."""
    company_id, user = _company()
    months = _last_months(3)
    target = months[-1]

    async def _run():
        await _seed(company_id, user, months, metro_last=2600.0)
        return await build_roi_analysis(user, target[0], target[1])

    built = asyncio.run(_run())
    days = calendar.monthrange(*target)[1]
    revenue = 200.0 * days
    assert built["target"]["profit"] == revenue - 2600.0 - 2500.0  # payroll counted
    # Whoever does not keep the payroll sees the profit without it, as on
    # their Home - the salaries are not theirs to see.
    no_payroll = server.User(**{**user.model_dump(), "permissions": [p for p in PERMS if p != "manage_payroll"]})
    without = asyncio.run(build_roi_analysis(no_payroll, target[0], target[1]))
    assert without["target"]["profit"] == revenue - 2600.0
    payback = built["analysis"]["payback"]
    assert payback["invested"] == 3000.0
    assert "лично" in payback["text"] and "печалба" in payback["text"]
    metro = next(m for m in built["analysis"]["movers"] if m["kind"] == "supplier")
    assert metro["label"] == "Метро" and metro["delta"] == 600.0 and metro["profit_effect"] == -600.0
    assert "+600,00\u00a0€" in metro["text"]


def test_a_running_month_is_compared_on_the_same_days():
    """Mid-month the month is held against days 1..today of the earlier
    months - not their whole totals, which made every month look like a
    fall in revenue until its last days."""
    company_id, user = _company()
    now = datetime.now(timezone.utc)
    months = _last_months(3) + [(now.year, now.month)]

    async def _run():
        await _seed(company_id, user, months[:-1], metro=0.0)
        await server.db.daily_revenue.insert_many([
            {"user_id": user.user_id, "date": f"{now.year}-{now.month:02d}-{d:02d}", "fiscal_revenue": 200.0,
             "pocket_money": 0, "card_revenue": 0}
            for d in range(1, now.day + 1)
        ])
        return await build_roi_analysis(user, now.year, now.month)

    built = asyncio.run(_run())
    assert all(m["kind"] != "revenue" for m in built["analysis"]["movers"])
    assert built["analysis"]["month"]["partial"] is True
    assert any("още тече" in note for note in built["analysis"]["notes"])


def test_actions_carry_their_euros_a_month():
    company_id, user = _company()
    months = _last_months(3)
    now = datetime.now(timezone.utc)

    async def _run():
        await _seed(company_id, user, months)
        await server.db.price_alerts.insert_one({
            "id": "alert-1", "company_id": company_id, "item_name": "питка", "supplier": "Пекарна",
            "kind": "price_change", "direction": "increase", "change_percent": 18.0, "monthly_impact": 291.0,
            "status": "unread", "created_at": now - timedelta(days=10),
        })
        rows = []
        for day in range(1, 90, 3):
            rows.append({"company_id": company_id, "item_name": "доматен сос 5кг", "supplier": "Метро",
                         "unit_price": 10.50, "quantity": 4, "unit": "бр.", "invoice_id": f"m{day}",
                         "invoice_number": f"m{day}", "invoice_date": now - timedelta(days=day)})
        rows.append({"company_id": company_id, "item_name": "доматен сос 5кг", "supplier": "Кауфланд",
                     "unit_price": 9.00, "quantity": 2, "unit": "бр.", "invoice_id": "k1",
                     "invoice_number": "k1", "invoice_date": now - timedelta(days=5)})
        await server.db.item_price_history.insert_many(rows)
        return await build_roi_analysis(user, months[-1][0], months[-1][1])

    actions = {a["kind"]: a for a in asyncio.run(_run())["analysis"]["actions"]}
    assert actions["price_increases"]["monthly_eur"] == 291.0 and "291" in actions["price_increases"]["text"]
    cheaper = actions["cheaper_supplier"]
    # 30 purchases of 4 tins in 90 days at 2.10 €/kg instead of 1.80 €/kg.
    assert cheaper["monthly_eur"] == round((2.10 - 1.80) * 30 * 4 * 5 * 30 / 90, 2)
    assert "Кауфланд" in cheaper["text"] and cheaper["route"].endswith("tab=items")


class _FakeMessages:
    def __init__(self):
        self.calls = 0

    async def parse(self, **kwargs):
        self.calls += 1
        return SimpleNamespace(
            stop_reason="end_turn", model="claude-opus-5-5",
            usage=SimpleNamespace(input_tokens=1, output_tokens=1, cache_creation_input_tokens=0, cache_read_input_tokens=0),
            parsed_output=RoiAdvice(headline="Заплатите изяждат печалбата.", points=["Провери графика.", "Договори цените."]),
        )


def test_ai_advice_is_asked_for_once_until_the_numbers_change(monkeypatch):
    company_id, user = _company()
    months = _last_months(3)
    fake = SimpleNamespace(messages=_FakeMessages())
    monkeypatch.setattr(server, "AI_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "anthropic_client", fake)
    request = SimpleNamespace()

    async def _advice(generate):
        return await roi_wallet.get_roi_advice.__wrapped__(
            request, month=months[-1][1], year=months[-1][0], language="bg", generate=generate, current_user=user,
        )

    async def _run():
        await _seed(company_id, user, months)
        before = await _advice(False)
        made = await _advice(True)
        kept = await _advice(False)
        await server.db.personal_expenses.insert_one({
            "id": "pe-extra", "company_id": company_id, "user_id": user.user_id, "amount": 500.0,
            "description": "Още", "expense_type": "investment", "category": "other",
            "period_month": months[-1][1], "period_year": months[-1][0],
        })
        changed = await _advice(False)
        return before, made, kept, changed

    before, made, kept, changed = asyncio.run(_run())
    assert before == {"available": True, "advice": None}
    assert made["advice"]["headline"] == "Заплатите изяждат печалбата." and made["cached"] is False
    assert kept["cached"] is True and kept["advice"] == made["advice"]
    assert changed["advice"] is None  # new numbers: asked for again, not reused
    assert fake.messages.calls == 1

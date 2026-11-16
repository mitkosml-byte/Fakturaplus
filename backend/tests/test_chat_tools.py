"""P1: "Попитай числата си" looks things up itself. The data tools must
find an item by a loosely typed name ("питки" -> "питка за дюнер"), keep
units apart, cover any period, treat unentered days as unknown and apply
the viewer's visibility rules; the endpoint must hand them to the model.
Each test builds its own company, so it does not depend on test order."""
import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import server
from services.business_calendar import today_local
from routers.chat_tools import ChatDataTools, build_chat_tools, name_match_score

FULL = {"statistics": True, "pocket_money": True, "off_book_expenses": True, "profit": True, "personal_investments": True}
NO_EXTRAS = {"statistics": True, "pocket_money": False, "off_book_expenses": False, "profit": False, "personal_investments": False}


def _company(permissions=("view_statistics",)):
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = server.User(user_id=user_id, email=f"{user_id}@test.com", name="Owner", role="owner",
                       company_id=company_id, permissions=list(permissions))
    return company_id, user


async def _register(user):
    await server.db.users.insert_one({
        "user_id": user.user_id, "email": user.email, "name": user.name, "role": "owner",
        "company_id": user.company_id, "permissions": user.permissions, "auth_provider": "email",
        "has_password": True, "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc),
    })


def _history_row(company_id, name, supplier, when, qty, price, unit="бр."):
    return {"company_id": company_id, "item_name": name, "supplier": supplier, "unit": unit, "quantity": qty,
            "unit_price": price, "invoice_id": f"inv-{uuid.uuid4().hex[:6]}", "invoice_number": "N",
            "invoice_date": when}


def test_name_matching_tolerates_word_endings_but_not_other_words():
    assert name_match_score("питки", "питка за дюнер") >= 0.4
    assert name_match_score("Метро", "Метро Кеш енд Кери") >= 0.9
    assert name_match_score("домати", "домат розов") >= 0.4
    assert name_match_score("сирене", "сироп кленов") < 0.4


def test_item_purchases_finds_the_item_for_a_period_and_keeps_units_apart():
    company_id, user = _company()
    may, june = datetime(2026, 5, 10, tzinfo=timezone.utc), datetime(2026, 6, 12, tzinfo=timezone.utc)

    async def _run():
        await _register(user)
        await server.db.item_price_history.insert_many([
            _history_row(company_id, "питка за дюнер", "Хлебозавод", may, 400, 0.38),
            _history_row(company_id, "питка за дюнер", "Хлебозавод", june, 500, 0.45),
            _history_row(company_id, "питка за дюнер", "Пекарна 2", june, 100, 0.40),
            _history_row(company_id, "кашкавал", "Метро", june, 10, 9.2, unit="кг"),
            _history_row(company_id, "кашкавал", "Метро", june, 4, 3.5, unit="бр."),
        ])
        _, scope = await server.get_company_scope(user)
        tools = ChatDataTools(user, company_id, scope, FULL)
        june_pitas = await tools.item_purchases("питки", "2026-06-01", "2026-06-30", "month_and_supplier")
        cheese = await tools.item_purchases("кашкавал", None, None, "none")
        return june_pitas, cheese

    june_pitas, cheese = asyncio.run(_run())
    pita = june_pitas["matches"][0]
    assert pita["item"] == "питка за дюнер"
    assert pita["quantity"] == 600 and pita["purchases"] == 2
    assert pita["by_month"] == {"2026-06": {"quantity": 600, "spent": 265.0}}
    assert pita["by_supplier_quantity"] == {"Хлебозавод": 500, "Пекарна 2": 100}
    assert sorted((m["unit"], m["quantity"]) for m in cheese["matches"]) == [("бр.", 4), ("кг", 10)]


def test_revenue_breakdown_counts_only_entered_days_and_hides_pocket_money():
    company_id, user = _company()

    async def _run():
        await _register(user)
        # Mondays 2026-06-01 and 06-08 entered, 06-15 forgotten; one Tuesday.
        await server.db.daily_revenue.insert_many([
            {"user_id": user.user_id, "date": d, "fiscal_revenue": 100, "pocket_money": 50, "card_revenue": 0}
            for d in ("2026-06-01", "2026-06-08", "2026-06-02")
        ])
        _, scope = await server.get_company_scope(user)
        restricted = ChatDataTools(user, company_id, scope, NO_EXTRAS)
        by_weekday = await restricted.revenue_breakdown("2026-06-01", "2026-06-16", "weekday")
        totals = await restricted.period_totals("2026-06-01", "2026-06-16")
        return by_weekday, totals

    by_weekday, totals = asyncio.run(_run())
    monday = next(r for r in by_weekday["rows"] if r["group"] == "понеделник")
    assert monday == {"group": "понеделник", "revenue": 200, "days_entered": 2, "average_per_entered_day": 100}
    assert by_weekday["includes_pocket_money"] is False
    assert totals["profit"] is None and totals["revenue_days_entered"] == 3


def test_supplier_purchases_matches_a_short_name():
    company_id, user = _company()
    june = datetime(2026, 6, 12, tzinfo=timezone.utc)

    async def _run():
        await _register(user)
        await server.db.invoices.insert_many([
            {"id": f"i{n}", "company_id": company_id, "user_id": user.user_id, "supplier": "Метро Кеш енд Кери",
             "invoice_number": f"N{n}", "date": june + timedelta(days=n), "total_amount": 100.0,
             "payment_method": "bank_transfer", "is_paid": n == 0, "paid_amount": 100.0 if n == 0 else 0.0}
            for n in range(3)
        ])
        await server.db.item_price_history.insert_one(
            _history_row(company_id, "кашкавал", "Метро Кеш енд Кери", june, 10, 9.2, unit="кг"))
        _, scope = await server.get_company_scope(user)
        tools = ChatDataTools(user, company_id, scope, FULL)
        return await tools.supplier_purchases("метро", "2026-06-01", "2026-06-30")

    result = asyncio.run(_run())
    metro = result["matches"][0]
    assert metro["supplier"] == "Метро Кеш енд Кери"
    assert (metro["invoices"], metro["total"], metro["unpaid_bank_transfer"]) == (3, 300.0, 200.0)
    assert metro["top_items_by_spend"][0]["item"] == "кашкавал"


def test_ask_my_numbers_hands_the_model_its_data_tools(client, monkeypatch):
    """End to end without a real model: the fake model calls item_purchases
    the way Claude would and answers with the number it got back."""
    company_id, user = _company(("view_statistics",))
    token = uuid.uuid4().hex
    last_month = (datetime.now(timezone.utc).replace(day=1) - timedelta(days=1)).replace(day=10, hour=9)
    seen = {}

    class FakeRunner:
        def __init__(self, tools):
            self.tools = {t.name: t for t in tools}

        async def __aiter__(self):
            usage = SimpleNamespace(input_tokens=10, output_tokens=5, cache_creation_input_tokens=0, cache_read_input_tokens=0)
            yield SimpleNamespace(model="claude-opus-5-5", usage=usage, stop_reason="tool_use", content=[])
            month_end = datetime.now(timezone.utc).replace(day=1) - timedelta(days=1)
            result = json.loads(await self.tools["item_purchases"].call({
                "item": "питки", "group_by": "none",
                "start_date": last_month.replace(day=1).date().isoformat(),
                "end_date": month_end.date().isoformat(),
            }))
            quantity = result["matches"][0]["quantity"]
            yield SimpleNamespace(model="claude-opus-5-5", usage=usage, stop_reason="end_turn",
                                  content=[SimpleNamespace(type="text", text=f"Миналия месец: {quantity:g} бр.")])

    def fake_tool_runner(**kwargs):
        seen.update(kwargs)
        return FakeRunner(kwargs["tools"])

    monkeypatch.setattr(server, "AI_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "anthropic_client", SimpleNamespace(
        beta=SimpleNamespace(messages=SimpleNamespace(tool_runner=fake_tool_runner))))

    async def _setup():
        await _register(user)
        await server.db.user_sessions.insert_one({
            "user_id": user.user_id, "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1), "created_at": datetime.now(timezone.utc),
        })
        await server.db.item_price_history.insert_many([
            _history_row(company_id, "питка за дюнер", "Хлебозавод", last_month, 750, 0.4),
            _history_row(company_id, "питка за дюнер", "Хлебозавод", last_month - timedelta(days=40), 999, 0.4),
        ])

    asyncio.run(_setup())
    r = client.post("/api/ai/ask-my-numbers", headers={"Authorization": f"Bearer {token}"},
                    json={"question": "Колко питки поръчах миналия месец?", "history": [], "language": "bg"})
    assert r.status_code == 200, r.text
    assert r.json()["answer"] == "Миналия месец: 750 бр."
    # An owner sees customers too: the customers look-up comes with the rest.
    assert sorted(t.name for t in seen["tools"]) == [
        "cash_flow", "customer_sales", "item_purchases", "period_totals", "revenue_breakdown", "supplier_purchases", "top_expenses"]
    assert seen["fallbacks"] == "default" and seen["max_iterations"] == 6
    assert today_local().isoformat() in seen["system"]
    logged = asyncio.run(server.db.ai_usage_log.count_documents({"company_id": company_id, "endpoint": "ask_my_numbers"}))
    assert logged == 2

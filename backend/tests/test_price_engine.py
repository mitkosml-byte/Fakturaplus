"""Regression tests for the price-history / alert engine and the reorder
cadence it feeds (routers/price_tracking.py).

Each scenario reproduces a failure found in the "intelligence" analysis
simulation: a misread 6-pack raised a +500% alert that survived fixing the
line, a deleted invoice left its price rows behind (so the item vanished
from reorder suggestions), the 2 EUR-per-unit gate hid a 280 EUR/month
price rise, and auto-merge folded "1кг" into "5кг". Every test builds its
own company, so it does not depend on test order.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import BackgroundTasks

import server
from routers.invoices import create_invoice, delete_invoice, update_invoice
from routers.price_tracking import (
    cleanup_orphan_price_data,
    get_merged_item_statistics,
    get_reorder_recommendations,
)


def _owner():
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = server.User(
        user_id=user_id, email=f"{user_id}@test.com", name="Price Engine Owner", role="owner",
        company_id=company_id, permissions=["manage_invoices", "view_statistics"],
    )
    return company_id, user


async def _register(user):
    await server.db.users.insert_one({
        "user_id": user.user_id, "email": user.email, "name": user.name, "role": "owner",
        "company_id": user.company_id, "permissions": user.permissions,
        "auth_provider": "email", "has_password": True,
        "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION,
        "created_at": datetime.now(timezone.utc),
    })


async def _invoice(user, number, days_ago, items, supplier="Метро"):
    """Creates an invoice through the real endpoint; returns (invoice, the
    background-task functions it queued)."""
    tasks = BackgroundTasks()
    total = round(sum(i["quantity"] * i["unit_price"] for i in items), 2)
    invoice = await create_invoice(
        server.InvoiceCreate(
            supplier=supplier, invoice_number=number, amount_without_vat=total,
            vat_amount=round(total * 0.2, 2), total_amount=round(total * 1.2, 2),
            date=(datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat(),
            items=[server.InvoiceItemCreate(**i) for i in items],
        ),
        tasks, current_user=user,
    )
    return invoice, [t.func for t in tasks.tasks]


async def _alerts(company_id, **filters):
    return await server.db.price_alerts.find({"company_id": company_id, **filters}, {"_id": 0}).to_list(100)


def test_pack_misread_asks_instead_of_alerting_and_fix_retracts_it():
    company_id, user = _owner()

    async def _run():
        await _register(user)
        for n, days in enumerate((40, 30, 20)):
            await _invoice(user, f"A{n}", days, [{"name": "Айран 250мл", "quantity": 60, "unit_price": 0.70}])

        # A 6-pack read as one unit: 4.20 is exactly 6 x 0.70.
        invoice, queued = await _invoice(user, "A3", 10, [{"name": "Айран 250мл", "quantity": 10, "unit_price": 4.20}])
        alerts = await _alerts(company_id, invoice_id=invoice.id)
        assert len(alerts) == 1
        assert alerts[0]["kind"] == "pack_suspect" and alerts[0]["pack_multiple"] == 6
        assert server.send_price_alert_pushes not in queued  # a question, not phone-worthy news

        # Correcting the line removes the question and the wrong price row.
        line_id = invoice.items[0]["id"]
        await update_invoice(
            invoice.id,
            server.InvoiceUpdate(items=[server.InvoiceItemUpdate(id=line_id, quantity=60, unit_price=0.70)]),
            current_user=user,
        )
        assert await _alerts(company_id, invoice_id=invoice.id) == []
        rows = await server.db.item_price_history.find({"company_id": company_id, "invoice_id": invoice.id}).to_list(10)
        assert [(r["unit_price"], r["quantity"], r["line_item_id"]) for r in rows] == [(0.70, 60, line_id)]

        # Deleting the invoice takes its price data with it.
        await delete_invoice(invoice.id, current_user=user)
        assert await server.db.item_price_history.count_documents({"company_id": company_id, "invoice_id": invoice.id}) == 0
        assert await server.db.item_price_history.count_documents({"company_id": company_id}) == 3

    asyncio.run(_run())


def test_alert_threshold_is_money_per_month_not_per_unit():
    company_id, user = _owner()

    async def _run():
        await _register(user)
        # Pitas: cheap per piece, bought by the thousand every week.
        for n, days in enumerate((28, 21, 14)):
            await _invoice(user, f"P{n}", days, [{"name": "Питка", "quantity": 2000, "unit_price": 0.20}], supplier="Пекарна")
        pita_invoice, queued = await _invoice(user, "P3", 7, [{"name": "Питка", "quantity": 2000, "unit_price": 0.236}], supplier="Пекарна")
        pita = await _alerts(company_id, invoice_id=pita_invoice.id)
        assert len(pita) == 1 and pita[0]["kind"] == "price_change"
        assert pita[0]["monthly_impact"] > 200  # ~0.036 EUR x ~8000 a month
        assert server.send_price_alert_pushes in queued

        # The same new price on the next invoice is the same event, not a new alert.
        repeat_invoice, _ = await _invoice(user, "P4", 0, [{"name": "Питка", "quantity": 2000, "unit_price": 0.236}], supplier="Пекарна")
        assert await _alerts(company_id, invoice_id=repeat_invoice.id) == []

        # Detergent: +12%, but one can a month - about 2 EUR a month.
        for n, days in enumerate((120, 90, 60)):
            await _invoice(user, f"D{n}", days, [{"name": "Препарат 5л", "quantity": 1, "unit_price": 17.50}], supplier="Хигиена")
        detergent_invoice, _ = await _invoice(user, "D3", 30, [{"name": "Препарат 5л", "quantity": 1, "unit_price": 19.60}], supplier="Хигиена")
        assert await _alerts(company_id, invoice_id=detergent_invoice.id) == []

    asyncio.run(_run())


def test_different_sizes_and_units_are_never_compared():
    company_id, user = _owner()

    async def _run():
        await _register(user)
        for n, days in enumerate((40, 30, 20)):
            await _invoice(user, f"S{n}", days, [{"name": "Доматен сос 1кг", "quantity": 10, "unit_price": 2.40}])
        big, _ = await _invoice(user, "S3", 10, [{"name": "Доматен сос 5кг", "quantity": 4, "unit_price": 10.50}])
        assert await _alerts(company_id, invoice_id=big.id) == []
        names = await server.db.item_price_history.distinct("item_name", {"company_id": company_id})
        assert sorted(names) == ["доматен сос 1кг", "доматен сос 5кг"]

        # Same name, different unit: a kilo price is not a piece price.
        for n, days in enumerate((40, 30, 20)):
            await _invoice(user, f"K{n}", days, [{"name": "Кашкавал", "quantity": 5, "unit_price": 12.0, "unit": "кг"}])
        piece, _ = await _invoice(user, "K3", 10, [{"name": "Кашкавал", "quantity": 2, "unit_price": 30.0, "unit": "бр."}])
        assert await _alerts(company_id, invoice_id=piece.id) == []

    asyncio.run(_run())


def test_size_signature():
    sig = server.item_size_signature
    assert sig("Кола 0.5л") == sig("кола 0,50 л")
    assert sig("Кола 0.5л") != sig("Кола 0.5л x 6")
    assert sig("Доматен сос 1кг") != sig("Доматен сос 5кг")
    assert sig("Сирене 0.50кг") == sig("сирене 0,5 кг") == ("0.5",)
    assert server.normalize_unit("Кг.") == server.normalize_unit("kg") == "кг"
    assert server.normalize_unit("бр.") == server.normalize_unit("pcs") == "бр"


def test_stored_mapping_across_sizes_is_ignored():
    """A merge mapping written before merges checked sizes must not fold
    the 5 kg pack into the 1 kg one in statistics or reorder cadence."""
    company_id, user = _owner()

    async def _run():
        await _register(user)
        await server.db.item_merge_mappings.insert_one({
            "company_id": company_id, "canonical_name": "доматен сос 1кг", "display_name": "Доматен сос 1кг",
            "variants": ["доматен сос 1кг", "доматен сос 5кг", "доматен сос 1 кг"],
        })
        await _invoice(user, "M1", 20, [{"name": "Доматен сос 1кг", "quantity": 10, "unit_price": 2.40}])
        await _invoice(user, "M2", 10, [{"name": "Доматен сос 5кг", "quantity": 4, "unit_price": 10.50}])
        return await get_merged_item_statistics(start_date=None, end_date=None, top_n=10, current_user=user)

    stats = asyncio.run(_run())
    by_name = {i["name"]: i for i in stats["top_by_value"]}
    assert by_name["Доматен сос 1кг"]["total_quantity"] == 10
    assert by_name["доматен сос 5кг"]["total_quantity"] == 4


def test_ai_merge_drops_size_mismatched_variants(monkeypatch):
    company_id, user = _owner()

    async def fake_parse(**_kwargs):
        return SimpleNamespace(parsed_output=server.ItemMergeResult(groups=[
            server.ItemMergeGroup(canonical_name="Доматен сос 1кг", variants=["доматен сос 1 кг", "доматен сос 5кг"]),
            server.ItemMergeGroup(canonical_name="Кола 0.5л", variants=["кола 0.5л x 6"]),
        ]))

    async def no_usage_log(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "AI_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "anthropic_client", SimpleNamespace(messages=SimpleNamespace(parse=fake_parse)))
    monkeypatch.setattr(server, "log_ai_usage", no_usage_log)

    async def _run():
        await _register(user)
        await server.db.item_price_history.insert_many([
            {"company_id": company_id, "item_name": name, "supplier": "Метро", "unit_price": 1, "quantity": 1,
             "unit": "бр.", "invoice_id": "x", "invoice_number": "X", "invoice_date": datetime.now(timezone.utc)}
            for name in ("доматен сос 1кг", "доматен сос 1 кг", "доматен сос 5кг", "кола 0.5л", "кола 0.5л x 6")
        ])
        result = await server.run_ai_item_merge(company_id)
        mappings = await server.db.item_merge_mappings.find({"company_id": company_id}, {"_id": 0}).to_list(10)
        return result, mappings

    result, mappings = asyncio.run(_run())
    assert result["merged_groups"] == [{"canonical_name": "Доматен сос 1кг", "variants": ["доматен сос 1 кг"]}]
    assert len(mappings) == 1 and "доматен сос 5кг" not in mappings[0]["variants"]


def test_same_day_purchases_keep_item_in_reorder_suggestions():
    """Filet bought every 5 days, with two invoices on one of those days
    (a top-up order): previously the 0-day gap dropped the item entirely."""
    company_id, user = _owner()

    async def _run():
        await _register(user)
        days = [30, 25, 20, 15, 15, 10, 5]
        for n, d in enumerate(days):
            await _invoice(user, f"F{n}", d, [{"name": "Филе капка", "quantity": 8, "unit_price": 11.0, "unit": "кг"}], supplier="Месо")
        return await get_reorder_recommendations(current_user=user)

    items = {i["item_name"]: i for i in asyncio.run(_run())["items"]}
    assert "филе капка" in items
    assert items["филе капка"]["median_days_between"] == 5


def test_orphan_cleanup_runs_once():
    company_id, user = _owner()

    async def _run():
        await _register(user)
        live, _ = await _invoice(user, "L1", 5, [{"name": "Сирене", "quantity": 3, "unit_price": 9.0, "unit": "кг"}])
        now = datetime.now(timezone.utc)
        await server.db.item_price_history.insert_one({
            "company_id": company_id, "item_name": "сирене", "supplier": "Метро", "unit_price": 9.0, "quantity": 3,
            "unit": "кг", "invoice_id": "deleted-long-ago", "invoice_number": "OLD", "invoice_date": now,
        })
        await server.db.price_alerts.insert_one({
            "id": "orphan-alert", "company_id": company_id, "item_name": "сирене", "supplier": "Метро",
            "old_price": 8.0, "new_price": 9.0, "change_percent": 12.5, "invoice_id": "deleted-long-ago",
            "invoice_number": "OLD", "status": "unread", "created_at": now,
        })
        # An unread alert whose line was corrected before edits re-derived alerts.
        await server.db.price_alerts.insert_one({
            "id": "stale-alert", "company_id": company_id, "item_name": "сирене", "supplier": "Метро",
            "old_price": 1.5, "new_price": 54.0, "change_percent": 3500, "invoice_id": live.id,
            "invoice_number": "L1", "status": "unread", "created_at": now,
        })
        await server.db.data_migrations.delete_many({"_id": "price_data_cleanup_v1"})
        first = await cleanup_orphan_price_data()
        second = await cleanup_orphan_price_data()
        remaining = await server.db.item_price_history.count_documents({"company_id": company_id})
        alert_ids = {a["id"] for a in await _alerts(company_id)}
        return first, second, remaining, alert_ids

    first, second, remaining, alert_ids = asyncio.run(_run())
    assert first["removed_rows"] >= 1 and first["removed_alerts"] >= 2
    assert second == {"skipped": True}
    assert remaining == 1
    assert not alert_ids & {"orphan-alert", "stale-alert"}


def test_scan_time_price_check_flags_pack_before_saving(client):
    """The scan review screen asks before saving: a line at exactly 6x the
    usual price is a "pack?" hint with the multiple, a real rise carries
    its EUR-per-month size, and nothing is written."""
    company_id, user = _owner()
    token = uuid.uuid4().hex

    async def _setup():
        await _register(user)
        await server.db.user_sessions.insert_one({
            "user_id": user.user_id, "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1), "created_at": datetime.now(timezone.utc),
        })
        for n, days in enumerate((40, 30, 20)):
            await _invoice(user, f"C{n}", days, [
                {"name": "Айран 250мл", "quantity": 60, "unit_price": 0.70},
                {"name": "Питка", "quantity": 2000, "unit_price": 0.20},
            ])

    asyncio.run(_setup())
    rows_before = asyncio.run(server.db.item_price_history.count_documents({"company_id": company_id}))
    r = client.post("/api/items/price-check", headers={"Authorization": f"Bearer {token}"}, json={
        "supplier": "метро", "items": [
            {"name": "айран 250 мл", "quantity": 10, "unit": "бр.", "unit_price": 4.20},
            {"name": "Сол", "quantity": 1, "unit": "бр.", "unit_price": 1.0},
            {"name": "Питка", "quantity": 2000, "unit": "бр.", "unit_price": 0.236},
        ],
    })
    assert r.status_code == 200, r.text
    hints = {h["index"]: h for h in r.json()["hints"]}
    assert hints[0]["kind"] == "pack_suspect" and hints[0]["pack_multiple"] == 6 and hints[0]["old_price"] == 0.7
    assert 1 not in hints  # never bought before: nothing to compare with
    assert hints[2]["kind"] == "price_change" and hints[2]["monthly_impact"] > 100
    assert asyncio.run(server.db.item_price_history.count_documents({"company_id": company_id})) == rows_before


def test_switching_pack_size_is_not_an_overdue_reorder():
    """1 kg tins every 15 days, then the owner switched to 5 kg tins three
    weeks ago. Kept apart (as they must be for prices), the 1 kg size must
    not then look "overdue" for ever - it was replaced, not forgotten."""
    company_id, user = _owner()
    now = datetime.now(timezone.utc)

    def _rows(name, days_ago):
        return [
            {"company_id": company_id, "supplier": "Метро", "item_name": name, "unit_price": 2.4,
             "quantity": 4, "unit": "бр.", "invoice_id": f"inv-{name}-{d}", "invoice_number": f"N{d}",
             "invoice_date": now - timedelta(days=d)}
            for d in days_ago
        ]

    async def _run():
        await _register(user)
        await server.db.item_price_history.insert_many(_rows("доматен сос 1кг", range(30, 120, 15)))
        await server.db.item_price_history.insert_many(_rows("доматен сос 5кг", [21, 6]))
        return await get_reorder_recommendations(current_user=user)

    names = {i["item_name"] for i in asyncio.run(_run())["items"]}
    assert "доматен сос 1кг" not in names

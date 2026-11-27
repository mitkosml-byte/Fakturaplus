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
    assert sig("Сирене 0.50кг") == sig("сирене 0,5 кг") == sig("Сирене 500 г") == ("0.5кг",)
    assert sig("Кола 500мл") == sig("Кола 0.5л")
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


def test_seasonal_pause_does_not_hide_a_regular_item():
    """Filet every 5 days in season, a 5-month summer break, then every 5
    days again: the break used to make the item "irregular" for good, so a
    seasonal business lost its reorder suggestions every season. The
    break is a pause, not part of the rhythm - nor months of consumption."""
    company_id, user = _owner()
    now = datetime.now(timezone.utc)

    async def _run():
        await _register(user)
        days = list(range(210, 330, 5)) + list(range(5, 65, 5))
        await server.db.item_price_history.insert_many([
            {"company_id": company_id, "supplier": "Месо", "item_name": "филе капка", "unit_price": 7.8,
             "quantity": 20, "unit": "кг", "invoice_id": f"inv-{d}", "invoice_number": f"N{d}",
             "invoice_date": now - timedelta(days=d)}
            for d in days
        ])
        return await get_reorder_recommendations(current_user=user)

    items = {i["item_name"]: i for i in asyncio.run(_run())["items"]}
    assert items["филе капка"]["median_days_between"] == 5
    # 36 purchases x 20 kg over 35 cycles of 5 days (the pause counted as one
    # cycle) = 20.6 -> 21 kg; averaged over the 150-day pause it was ~11.
    assert items["филе капка"]["recommended_quantity"] == 21


def test_pack_size_is_learned_from_a_correction_and_applied_at_the_next_scan(client):
    """"Айран от Метро = стек от 6": fixing a saved line from 2 x 4.20 to
    12 x 0.70 is remembered; the next scan priced as a pack gets the same
    correction offered for automatic use, a per-piece price does not, and
    an undone correction in scan review is forgotten."""
    company_id, user = _owner()
    token = uuid.uuid4().hex

    async def _setup():
        await _register(user)
        await server.db.user_sessions.insert_one({
            "user_id": user.user_id, "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1), "created_at": datetime.now(timezone.utc),
        })
        for n, days in enumerate((40, 30, 20)):
            await _invoice(user, f"L{n}", days, [{"name": "Айран 250мл", "quantity": 60, "unit_price": 0.70}])
        pack, _ = await _invoice(user, "L3", 10, [{"name": "Айран 250мл", "quantity": 2, "unit_price": 4.20}])
        await update_invoice(
            pack.id,
            server.InvoiceUpdate(items=[server.InvoiceItemUpdate(id=pack.items[0]["id"], quantity=12, unit_price=0.70)]),
            current_user=user,
        )
        return await server.db.item_pack_rules.find_one({"company_id": company_id}, {"_id": 0})

    rule = asyncio.run(_setup())
    assert rule["multiple"] == 6 and rule["source"] == "invoice_edit" and rule["supplier_key"] == "метро"

    headers = {"Authorization": f"Bearer {token}"}
    r = client.post("/api/items/price-check", headers=headers, json={"supplier": "Метро", "items": [
        {"name": "Айран 250мл", "quantity": 3, "unit": "бр.", "unit_price": 4.50},
        {"name": "Айран 250мл", "quantity": 18, "unit": "бр.", "unit_price": 0.72},
    ]})
    assert r.status_code == 200, r.text
    hints = {h["index"]: h for h in r.json()["hints"]}
    assert hints[0]["kind"] == "pack_rule" and hints[0]["pack_multiple"] == 6 and hints[0]["auto_apply"] is True
    assert 1 not in hints or hints[1]["kind"] != "pack_rule"

    async def _scan_saves():
        # Kept in review: learned (again) from the scan itself...
        saved, _ = await _invoice(user, "L4", 2, [
            {"name": "Айран 250мл", "quantity": 18, "unit_price": 0.70, "pack_multiple_applied": 6}])
        kept = await server.db.item_pack_rules.count_documents({"company_id": company_id})
        stored = await server.db.invoices.find_one({"id": saved.id}, {"_id": 0, "items": 1})
        # ...undone in review: forgotten.
        await _invoice(user, "L5", 1, [
            {"name": "Айран 250мл", "quantity": 3, "unit_price": 4.20, "pack_rule_rejected": True}])
        left = await server.db.item_pack_rules.count_documents({"company_id": company_id})
        return kept, stored, left

    kept, stored, left = asyncio.run(_scan_saves())
    assert kept == 1 and left == 0
    assert "pack_multiple_applied" not in stored["items"][0] and "pack_rule_rejected" not in stored["items"][0]


def test_detect_pack_multiple():
    from routers.price_tracking import detect_pack_multiple
    assert detect_pack_multiple(2, 4.20, 12, 0.70) == 6
    assert detect_pack_multiple(1, 10.0, 24, 0.4167) == 24
    assert detect_pack_multiple(2, 4.20, 12, 0.80) is None  # total changed: not the same line re-read
    assert detect_pack_multiple(10, 1.0, 10, 1.0) is None


def test_item_content_and_price_per_base_unit():
    """Pack size read from the name: "5кг" is 5 kg, "250мл" is 0.25 l, a
    multipack multiplies, "30 бр" is 30 pieces; a line sold by weight or
    volume already is its base unit. Price per kg / l / piece follows."""
    assert server.item_content("Доматен сос 5кг") == (5.0, "кг")
    assert server.item_content("Айран 250мл") == (0.25, "л")
    assert server.item_content("Кола 0,5л x 6") == (3.0, "л")
    assert server.item_content("Яйца 30 бр") == (30.0, "бр")
    assert server.item_content("Питка") is None
    assert server.base_unit_price(4.20, "Доматен сос 5кг", "бр") == (0.84, "кг")
    assert server.base_unit_price(0.70, "Айран 250мл", "бр") == (2.8, "л")
    assert server.base_unit_price(12.0, "Сирене", "кг") == (12.0, "кг")
    assert server.base_unit_price(0.20, "Питка", "бр") == (0.20, "бр")  # a piece is its own base
    assert server.base_unit_price(4.20, "Питка", "оп") is None  # a pack of unknown size


def test_statistics_rank_quantities_per_unit_and_compare_suppliers_per_kg(client):
    """Kilograms and pieces are never added together, and two suppliers
    selling different pack sizes are compared per kilogram."""
    company_id, user = _owner()
    token = uuid.uuid4().hex

    async def _setup():
        await _register(user)
        await server.db.user_sessions.insert_one({
            "user_id": user.user_id, "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1), "created_at": datetime.now(timezone.utc),
        })
        await _invoice(user, "Q1", 30, [
            {"name": "Брашно", "quantity": 50, "unit": "кг", "unit_price": 1.10},
            {"name": "Питка", "quantity": 400, "unit": "бр", "unit_price": 0.20},
        ])
        await _invoice(user, "Q2", 20, [{"name": "Доматен сос 5кг", "quantity": 4, "unit": "бр", "unit_price": 20.0}])
        await _invoice(user, "Q3", 10, [{"name": "Доматен сос 5кг", "quantity": 4, "unit": "бр", "unit_price": 18.0}],
                       supplier="Кауфланд")
        await _invoice(user, "Q4", 5, [{"name": "Доматен сос 1кг", "quantity": 10, "unit": "бр", "unit_price": 3.0}])

    asyncio.run(_setup())
    headers = {"Authorization": f"Bearer {token}"}
    stats = client.get("/api/statistics/items", headers=headers).json()
    by_unit = stats["top_by_quantity_by_unit"]
    assert by_unit["кг"][0]["item_name"] == "брашно" and by_unit["бр."][0]["item_name"] == "питка"
    assert all(i["unit"] == "бр." for i in by_unit["бр."])

    detail = client.get("/api/statistics/items/доматен сос 5кг/by-supplier", headers=headers).json()
    per_supplier = {s["supplier"]: s for s in detail["suppliers"]}
    assert per_supplier["Кауфланд"]["avg_base_price"] == 3.6 and per_supplier["Кауфланд"]["base_unit"] == "кг"
    assert detail["recommendation"]["best_supplier"] == "Кауфланд"
    assert [s["item_name"] for s in detail["sizes"]] == ["доматен сос 1кг"]
    assert detail["sizes"][0]["avg_base_price"] == 3.0


def test_catalog_same_and_different(client):
    """The owner's word wins: "different" splits a wrong automatic join and
    keeps the names apart at the next invoice, "same" joins a look-alike,
    and two pack sizes are never "the same"."""
    company_id, user = _owner()
    token = uuid.uuid4().hex

    async def _setup():
        await _register(user)
        await server.db.user_sessions.insert_one({
            "user_id": user.user_id, "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1), "created_at": datetime.now(timezone.utc),
        })
        await _invoice(user, "D1", 30, [{"name": "Сирене краве", "quantity": 10, "unit": "кг", "unit_price": 9.0}])
        # A close spelling is filed under the existing name automatically.
        await _invoice(user, "D2", 20, [{"name": "Сирене кравее", "quantity": 5, "unit": "кг", "unit_price": 9.5}])
        names = await server.db.item_price_history.distinct("item_name", {"company_id": company_id})
        return names

    assert asyncio.run(_setup()) == ["сирене краве"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post("/api/items/catalog/different", headers=headers,
                    json={"item_name": "сирене краве", "other_name": "Сирене кравее"})
    assert r.status_code == 200, r.text
    assert r.json()["rows_moved"] == 1

    async def _after_split():
        await _invoice(user, "D3", 10, [{"name": "Сирене кравее", "quantity": 5, "unit": "кг", "unit_price": 9.5}])
        return sorted(await server.db.item_price_history.distinct("item_name", {"company_id": company_id}))

    assert asyncio.run(_after_split()) == ["сирене краве", "сирене кравее"]
    related = client.get("/api/items/catalog/related", headers=headers, params={"item_name": "сирене краве"}).json()
    assert related["different_from"] == ["сирене кравее"]
    assert all(s["item_name"] != "сирене кравее" for s in related["similar"])

    r = client.post("/api/items/catalog/same", headers=headers,
                    json={"item_name": "Сирене краве", "other_name": "сирене кравее"})
    assert r.status_code == 200, r.text
    assert r.json()["rows_moved"] == 2  # both purchases printed as "кравее" join the history
    related = client.get("/api/items/catalog/related", headers=headers, params={"item_name": "сирене краве"}).json()
    assert related["merged_with"] == ["сирене кравее"] and related["different_from"] == []
    names = asyncio.run(server.db.item_price_history.distinct("item_name", {"company_id": company_id}))
    assert names == ["сирене краве"]

    r = client.post("/api/items/catalog/same", headers=headers,
                    json={"item_name": "Доматен сос 1кг", "other_name": "Доматен сос 5кг"})
    assert r.status_code == 400

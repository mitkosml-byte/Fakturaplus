"""Regression tests for signal memory (P0-8 of the intelligence analysis):
Home signals remember "snooze" and "done", money-at-risk signals can only
be snoozed, and an item not bought for more than 4 of its own cycles turns
from an endless "time to reorder" into "do you still buy it?". Each test
builds its own company, so it does not depend on test order."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import server
from routers.ai_insights import SignalStateUpdate, update_signal_state
from routers.price_tracking import get_reorder_recommendations


def _new_company(permissions):
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = server.User(
        user_id=user_id, email=f"{user_id}@test.com", name="Signal Memory Owner", role="owner",
        company_id=company_id, permissions=permissions,
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


def _by_key(signals):
    return {s["key"]: s for s in signals}


def test_done_hides_a_signal_until_its_situation_changes_and_snooze_hides_it_for_days():
    _, user = _new_company(["view_statistics", "add_revenue"])
    today = datetime.now(timezone.utc).date()
    forgotten = today - timedelta(days=3)

    async def _run():
        await _register(user)
        await server.db.daily_revenue.insert_many([
            {"user_id": user.user_id, "date": (today - timedelta(days=i)).isoformat(),
             "fiscal_revenue": 200, "pocket_money": 0, "card_revenue": 0}
            for i in range(1, 29) if today - timedelta(days=i) != forgotten
        ])
        first = _by_key(await server.get_proactive_signals(user))["missing_revenue"]
        assert first["actions"] == ["snooze", "dismiss"]

        await update_signal_state(
            SignalStateUpdate(key="missing_revenue", fingerprint=first["fingerprint"], action="dismiss"),
            current_user=user,
        )
        after_done = _by_key(await server.get_proactive_signals(user))

        # Another day goes missing: a new situation, so the signal is back.
        await server.db.daily_revenue.delete_many(
            {"user_id": user.user_id, "date": (today - timedelta(days=1)).isoformat()}
        )
        changed = _by_key(await server.get_proactive_signals(user))["missing_revenue"]

        await update_signal_state(
            SignalStateUpdate(key="missing_revenue", fingerprint=changed["fingerprint"], action="snooze"),
            current_user=user,
        )
        after_snooze = _by_key(await server.get_proactive_signals(user))
        state = await server.db.signal_states.find_one(
            {"user_id": user.user_id, "fingerprint": changed["fingerprint"]}, {"_id": 0}
        )
        return after_done, changed, after_snooze, state

    after_done, changed, after_snooze, state = asyncio.run(_run())
    assert "missing_revenue" not in after_done
    assert changed["fingerprint"] != ""
    assert "missing_revenue" not in after_snooze
    until = state["until"] if state["until"].tzinfo else state["until"].replace(tzinfo=timezone.utc)
    assert timedelta(days=2) < until - datetime.now(timezone.utc) <= timedelta(days=3)


def test_money_at_risk_signals_can_only_be_snoozed():
    _, user = _new_company(["manage_invoices", "view_statistics"])

    async def _run():
        await _register(user)
        await update_signal_state(
            SignalStateUpdate(key="unpaid_invoices", fingerprint="x", action="dismiss"), current_user=user,
        )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(_run())
    assert exc.value.status_code == 400


def test_dropped_item_becomes_a_question_and_discontinue_stops_reminders():
    """Gyros spice bought weekly until two months ago (dropped from the
    menu) used to be the only "time to reorder" nudge, for ever. Now it is
    asked about; "no longer bought" stops it until it is bought again,
    while a live item (filet, every 5 days) keeps its normal nudge."""
    company_id, user = _new_company(["view_statistics"])
    now = datetime.now(timezone.utc)

    def _rows(name, days_ago, price, qty):
        return [
            {"company_id": company_id, "supplier": "Метро", "item_name": name, "unit_price": price,
             "quantity": qty, "unit": "кг", "invoice_id": f"inv-{name}-{d}", "invoice_number": f"N{d}",
             "invoice_date": now - timedelta(days=d)}
            for d in days_ago
        ]

    async def _run():
        await _register(user)
        await server.db.item_price_history.insert_many(_rows("гирос подправка", range(64, 120, 7), 12.0, 2))
        await server.db.item_price_history.insert_many(_rows("филе капка", range(12, 60, 5), 11.0, 8))
        before = _by_key(await server.get_proactive_signals(user))
        question = before["reorder_stale"]
        await update_signal_state(
            SignalStateUpdate(key="reorder_stale", fingerprint=question["fingerprint"], action="discontinue",
                              item_key=question["item_key"]),
            current_user=user,
        )
        after = _by_key(await server.get_proactive_signals(user))
        listed_after = {i["item_name"] for i in (await get_reorder_recommendations(current_user=user))["items"]}
        return before, after, listed_after

    before, after, listed_after = asyncio.run(_run())
    assert before["reorder_stale"]["actions"] == ["still_buying", "discontinue"]
    assert "гирос подправка" in before["reorder_stale"]["title"]
    assert "филе капка" in before["reorder"]["detail"]
    assert "reorder_stale" not in after and "reorder" in after
    assert "гирос подправка" not in listed_after and "филе капка" in listed_after


def test_no_longer_bought_lasts_only_until_the_item_is_bought_again():
    company_id, user = _new_company(["view_statistics"])
    now = datetime.now(timezone.utc)

    def _rows(days_ago):
        return [
            {"company_id": company_id, "supplier": "Месо", "item_name": "филе капка", "unit_price": 11.0,
             "quantity": 8, "unit": "кг", "invoice_id": f"inv-{d}", "invoice_number": f"N{d}",
             "invoice_date": now - timedelta(days=d)}
            for d in days_ago
        ]

    async def _listed():
        return {i["item_name"] for i in (await get_reorder_recommendations(current_user=user))["items"]}

    async def _run():
        await _register(user)
        await server.db.item_price_history.insert_many(_rows(range(10, 50, 5)))
        await update_signal_state(
            SignalStateUpdate(key="reorder_stale", fingerprint="f", action="discontinue", item_key="Филе капка"),
            current_user=user,
        )
        stopped = await _listed()
        # A purchase dated after the answer brings it back (an older
        # invoice scanned late would not).
        await server.db.item_price_history.insert_one({
            **_rows([0])[0], "invoice_id": "inv-rebought", "invoice_date": datetime.now(timezone.utc),
        })
        return stopped, await _listed()

    stopped, rebought = asyncio.run(_run())
    assert "филе капка" not in stopped
    assert "филе капка" in rebought

"""Scan-credit balance and purchase-ledger service.

Fakturaplus's only real per-request cost is the AI OCR call behind invoice
scanning (see /ocr/scan in server.py) - everything else in the app runs at
negligible marginal cost. This service is therefore the app's entire
monetization surface: every company gets a small free monthly quota (reset
lazily, see get_or_create_balance), and scans beyond that are paid for
individually - deliberately never sold as a flat "unlimited" tier, since a
fixed price with no ceiling on the one metered cost can turn a plan from
profitable into a loss on a single heavy month.

Balance changes come in two kinds, kept strictly separate for security:
  - DEBITS (spend_scan): triggered directly by an authenticated app
    request: safe to run inline, synchronously, from the request handler.
  - CREDITS (credit_purchase): must NEVER be triggered by a plain API call
    from the client claiming "I paid" - they only ever run from inside a
    cryptographically verified Stripe webhook handler (see
    /webhooks/stripe in server.py), so a tampered or replayed client
    request can never mint itself free credits.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import uuid
from pymongo.errors import DuplicateKeyError

# Fixed catalogue - bonus scans instead of a percentage discount (reads as
# "pay for 44, get 50", no %-off arithmetic needed), with the largest pack
# carrying the best per-scan rate. Prices are in EUR.
SCAN_PACKAGES = {
    "small": {"id": "small", "name": "Малък", "paid_scans": 10, "bonus_scans": 0, "price_eur": 2.50},
    "medium": {"id": "medium", "name": "Среден", "paid_scans": 44, "bonus_scans": 6, "price_eur": 11.00},
    "large": {"id": "large", "name": "Голям", "paid_scans": 120, "bonus_scans": 30, "price_eur": 30.00},
    "business": {"id": "business", "name": "Бизнес", "paid_scans": 288, "bonus_scans": 112, "price_eur": 72.00},
}
# Display/selection order, cheapest first - SCAN_PACKAGES above is keyed by
# id for O(1) lookup, this is for anything that needs to list them in order.
SCAN_PACKAGE_ORDER = ["small", "medium", "large", "business"]

FREE_SCANS_PER_MONTH = 10
CUSTOM_MIN_SCANS = 1
CUSTOM_MAX_SCANS = 1000


def package_total_scans(package_id: str) -> int:
    pkg = SCAN_PACKAGES[package_id]
    return pkg["paid_scans"] + pkg["bonus_scans"]


def custom_price_eur(quantity: int) -> float:
    """Stepped pricing matching the package brackets - the whole purchase
    is priced at the per-scan rate of whichever bracket its quantity falls
    into (a flat lookup, not a marginal/progressive calculation), so it
    reads the same way as "this is basically the next package up"."""
    if quantity <= SCAN_PACKAGES["small"]["paid_scans"]:
        rate = SCAN_PACKAGES["small"]["price_eur"] / SCAN_PACKAGES["small"]["paid_scans"]
    elif quantity <= package_total_scans("medium"):
        rate = SCAN_PACKAGES["medium"]["price_eur"] / package_total_scans("medium")
    elif quantity <= package_total_scans("large"):
        rate = SCAN_PACKAGES["large"]["price_eur"] / package_total_scans("large")
    else:
        rate = SCAN_PACKAGES["business"]["price_eur"] / package_total_scans("business")
    return round(quantity * rate, 2)


def _next_month(dt: datetime) -> datetime:
    if dt.month == 12:
        return dt.replace(year=dt.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return dt.replace(month=dt.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)


class ScanCreditService:
    def __init__(self, db):
        self.db = db

    def scope_id(self, company_id: Optional[str], user_id: str) -> str:
        """One shared credit pool per company (every teammate scans out of
        the same balance) - falls back to a personal pool for a solo
        account with no company yet, same shape as simple_scope_query."""
        return company_id if company_id else f"user:{user_id}"

    async def get_or_create_balance(self, company_id: Optional[str], user_id: str) -> dict:
        """Reads the balance doc, lazily rolling the free monthly quota
        over if its reset date has passed (checked on every read/spend -
        no cron job needed) and creating the doc on a company's very first
        touch. Both the creation and the reset are atomic
        find_one_and_update upserts, so two concurrent requests from the
        same company can never create two documents or double-reset."""
        scope = self.scope_id(company_id, user_id)
        now = datetime.now(timezone.utc)

        doc = await self.db.scan_balances.find_one_and_update(
            {"_id": scope},
            {
                "$setOnInsert": {
                    "_id": scope,
                    "company_id": company_id,
                    "free_remaining": FREE_SCANS_PER_MONTH,
                    "free_reset_at": _next_month(now),
                    "purchased_balance": 0,
                    "auto_reload_enabled": False,
                    "auto_reload_package_id": None,
                    "auto_reload_subscription_id": None,
                    "depletion_alert_sent_at": None,
                    "created_at": now,
                }
            },
            upsert=True,
            return_document=True,
        )

        free_reset_at = doc["free_reset_at"]
        if free_reset_at.tzinfo is None:
            free_reset_at = free_reset_at.replace(tzinfo=timezone.utc)

        if free_reset_at <= now:
            # A fresh month's quota means any "about to run out" alert
            # from last month no longer applies - let it fire again if
            # the new month's usage pattern earns it.
            updated = await self.db.scan_balances.find_one_and_update(
                {"_id": scope, "free_reset_at": {"$lte": now}},
                {"$set": {
                    "free_remaining": FREE_SCANS_PER_MONTH, "free_reset_at": _next_month(now),
                    "depletion_alert_sent_at": None,
                }},
                return_document=True,
            )
            # Lost the race to another concurrent request that just reset
            # the same doc - re-read rather than fall back to our own
            # pre-reset snapshot, which would otherwise undercount it.
            doc = updated if updated is not None else await self.db.scan_balances.find_one({"_id": scope})

        return doc

    async def get_balance_summary(self, company_id: Optional[str], user_id: str) -> dict:
        doc = await self.get_or_create_balance(company_id, user_id)
        free_reset_at = doc["free_reset_at"]
        if free_reset_at.tzinfo is None:
            free_reset_at = free_reset_at.replace(tzinfo=timezone.utc)
        return {
            "free_remaining": doc["free_remaining"],
            "free_quota": FREE_SCANS_PER_MONTH,
            "free_reset_at": free_reset_at,
            "purchased_balance": doc["purchased_balance"],
            "total_remaining": doc["free_remaining"] + doc["purchased_balance"],
            "auto_reload_enabled": doc.get("auto_reload_enabled", False),
            "auto_reload_package_id": doc.get("auto_reload_package_id"),
        }

    async def has_scans_remaining(self, company_id: Optional[str], user_id: str) -> bool:
        doc = await self.get_or_create_balance(company_id, user_id)
        return (doc["free_remaining"] + doc["purchased_balance"]) > 0

    async def spend_scan(
        self, company_id: Optional[str], user_id: str, user_name: str,
        invoice_label: Optional[str] = None,
    ) -> bool:
        """Atomically consumes exactly one scan: free quota first (it
        resets monthly and would otherwise go to waste), then purchased
        credits (which never expire, so can wait). Each branch is its own
        atomic find_one_and_update guarded by a ">0" condition, so two
        concurrent requests can never both succeed off the same last unit -
        whichever loses the race simply finds the condition no longer true
        and falls through to the next source, or to returning False.
        Returns False (and spends nothing) if the balance was already at
        zero in both buckets."""
        await self.get_or_create_balance(company_id, user_id)
        scope = self.scope_id(company_id, user_id)

        result = await self.db.scan_balances.find_one_and_update(
            {"_id": scope, "free_remaining": {"$gt": 0}},
            {"$inc": {"free_remaining": -1}},
        )
        source = "free" if result is not None else None

        if source is None:
            result = await self.db.scan_balances.find_one_and_update(
                {"_id": scope, "purchased_balance": {"$gt": 0}},
                {"$inc": {"purchased_balance": -1}},
            )
            source = "purchased" if result is not None else None

        if source is None:
            return False

        await self._log_transaction(
            scope=scope, company_id=company_id, user_id=user_id, user_name=user_name,
            type_="scan_used", delta=-1,
            description=f"Сканиране на фактура{f' ({invoice_label})' if invoice_label else ''}",
        )
        return True

    async def credit_purchase(
        self, company_id: Optional[str], user_id: str, user_name: str,
        scans: int, description: str,
        price_eur: Optional[float] = None, payment_reference: Optional[str] = None,
    ) -> None:
        """Adds purchased credits. ONLY ever called from a verified Stripe
        webhook handler - never from a plain client-authenticated endpoint,
        so a tampered request can't mint credits for itself. Purchased
        credits never expire."""
        await self.get_or_create_balance(company_id, user_id)
        scope = self.scope_id(company_id, user_id)
        # A purchase changes the picture the depletion alert was sent
        # about - let it fire again if the new balance still earns it.
        await self.db.scan_balances.update_one(
            {"_id": scope}, {"$inc": {"purchased_balance": scans}, "$set": {"depletion_alert_sent_at": None}}
        )
        await self._log_transaction(
            scope=scope, company_id=company_id, user_id=user_id, user_name=user_name,
            type_="purchase", delta=scans, description=description,
            price_eur=price_eur, payment_reference=payment_reference,
        )

    async def set_auto_reload(
        self, company_id: Optional[str], user_id: str, enabled: bool,
        package_id: Optional[str] = None, subscription_id: Optional[str] = None,
    ) -> None:
        scope = self.scope_id(company_id, user_id)
        await self.get_or_create_balance(company_id, user_id)
        await self.db.scan_balances.update_one(
            {"_id": scope},
            {"$set": {
                "auto_reload_enabled": enabled,
                "auto_reload_package_id": package_id if enabled else None,
                "auto_reload_subscription_id": subscription_id if enabled else None,
            }},
        )

    async def get_auto_reload_subscription_id(self, company_id: Optional[str], user_id: str) -> Optional[str]:
        doc = await self.get_or_create_balance(company_id, user_id)
        return doc.get("auto_reload_subscription_id")

    async def get_depletion_forecast(
        self, company_id: Optional[str], user_id: str, lookback_days: int = 30,
    ) -> dict:
        """"At your pace, that's about N days" - the Module 5 audit
        finding that the scan-credit ledger already has everything needed
        to predict a depletion date, nobody had asked it yet.

        Adapted from (not a literal reuse of) the monthly-bucket
        Theil-Sen trend in ForecastService: scan usage is a day-to-day
        burn rate, not a monthly-cadence series, so the right average
        here is "total scans used over the window / days in the window",
        gated the same way in spirit - too little usage data to trust a
        rate, and this says so explicitly instead of extrapolating from
        one or two scans."""
        scope = self.scope_id(company_id, user_id)
        window_start = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

        usage = await self.db.scan_transactions.find(
            {"scope_id": scope, "type": "scan_used", "created_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=lookback_days)}},
            {"_id": 0, "delta": 1},
        ).to_list(10000)
        scans_used = -sum(t.get("delta", 0) for t in usage)  # delta is negative per spend

        balance = await self.get_or_create_balance(company_id, user_id)
        total_remaining = balance["free_remaining"] + balance["purchased_balance"]

        # Fewer than 3 scans in the window isn't enough to trust a rate -
        # same "don't manufacture confidence out of noise" principle as
        # ForecastService's MIN_MONTHS_FOR_TREND gate.
        if scans_used < 3:
            return {
                "insufficient_data": True,
                "scans_used_in_window": scans_used,
                "lookback_days": lookback_days,
                "total_remaining": total_remaining,
                "daily_rate": None,
                "days_remaining": None,
                "estimated_depletion_date": None,
            }

        daily_rate = scans_used / lookback_days
        days_remaining = round(total_remaining / daily_rate) if daily_rate > 0 else None
        depletion_date = (
            (datetime.now(timezone.utc) + timedelta(days=days_remaining)).strftime("%Y-%m-%d")
            if days_remaining is not None else None
        )

        return {
            "insufficient_data": False,
            "scans_used_in_window": scans_used,
            "lookback_days": lookback_days,
            "total_remaining": total_remaining,
            "daily_rate": round(daily_rate, 2),
            "days_remaining": days_remaining,
            "estimated_depletion_date": depletion_date,
        }

    async def list_balances_needing_depletion_check(self) -> List[dict]:
        """Every balance that hasn't already been alerted this cycle
        (depletion_alert_sent_at is None - see get_or_create_balance's
        monthly reset and credit_purchase, both of which clear it again).
        Used only by the background tick in server.py, never a per-request
        path, so no scope filtering is needed here."""
        return await self.db.scan_balances.find(
            {"depletion_alert_sent_at": None}, {"_id": 1, "company_id": 1}
        ).to_list(10000)

    async def mark_depletion_alert_sent(self, scope: str) -> None:
        await self.db.scan_balances.update_one(
            {"_id": scope}, {"$set": {"depletion_alert_sent_at": datetime.now(timezone.utc)}}
        )

    async def get_history(self, company_id: Optional[str], user_id: str, limit: int = 200) -> List[dict]:
        scope = self.scope_id(company_id, user_id)
        # created_at alone ties when two transactions land in the same
        # clock tick (plausible for two calls made back to back, and the
        # actual cause of an intermittent test failure here) - _id is
        # excluded from the result but still sortable, and is itself
        # monotonically increasing by insertion order, so it's a reliable
        # tiebreaker for "which of these actually happened first".
        return await self.db.scan_transactions.find(
            {"scope_id": scope}, {"_id": 0}
        ).sort([("created_at", -1), ("_id", -1)]).limit(limit).to_list(limit)

    async def _log_transaction(
        self, scope: str, company_id: Optional[str], user_id: str, user_name: str,
        type_: str, delta: int, description: str,
        price_eur: Optional[float] = None, payment_reference: Optional[str] = None,
    ) -> None:
        await self.db.scan_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "scope_id": scope,
            "company_id": company_id,
            "user_id": user_id,
            "user_name": user_name,
            "type": type_,
            "delta": delta,
            "description": description,
            "price_eur": price_eur,
            "payment_reference": payment_reference,
            "created_at": datetime.now(timezone.utc),
        })

    async def mark_webhook_event_processed(self, event_id: str) -> bool:
        """Returns True the first time this Stripe event id is seen, False
        on every retry/replay of the same event. insert_one on an
        _id-keyed collection is atomic, so this stays race-safe even if
        Stripe redelivers the same event to two overlapping requests -
        exactly the idempotency guard a webhook handler needs to avoid
        double-crediting a purchase."""
        try:
            await self.db.webhook_events.insert_one({
                "_id": event_id,
                "processed_at": datetime.now(timezone.utc),
            })
            return True
        except DuplicateKeyError:
            return False

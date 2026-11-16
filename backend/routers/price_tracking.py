"""Module 1 audit finding - extracted from the former monolithic server.py.
Shares server.py's db/models/helpers/services via `from server import *`;
`db` and `AI_FEATURES_ENABLED` are the two globals tests/startup reassign
after module load, so this file always accesses them as `server.db` /
`server.AI_FEATURES_ENABLED` (qualified), never via the star-import, to
stay correct when server.py's test fixture monkeypatches them. Also
explicitly imports every underscore-prefixed helper in server.py, since
`import *` never pulls those in regardless."""
from fastapi import APIRouter
from server import *
from server import (
_eik_check_digit,
    _compare_key,
    _similarity,
    _scan_packages_catalogue,
    _require_billing_enabled,
    _month_bounds,
    _compute_month_profit,
    _business_digest_period,
    _business_digest_top_expenses,
    _signal_unpaid_invoices,
    _signal_receivables,
    _signal_scan_credits,
    _signal_budget,
    _signal_price_alerts,
    _signal_reorder,
    _signal_forecast,
    _orthodox_easter,
    _holiday_name_for_date,
    _get_employee_for_company,
    _ym_add,
    _ym_diff,
    _team_channel_id,
)
import math
import server

router = APIRouter(prefix="/api")

# ===================== PRICE HISTORY & ALERT ENGINE =====================
# The one place an invoice line becomes a price-history row and is judged
# for an alert. Create, edit, delete and restore all go through it, so the
# derived price data can never drift from the invoices it came from (it
# used to: a deleted invoice left its rows behind, a corrected line kept
# its alert).

PRICE_BASELINE_PURCHASES = 3
IMPACT_WINDOW_DAYS = 120
# Common retail pack counts. A new unit price that is (almost exactly) one
# of these multiples of the usual one is far more often a pack read as a
# single unit - or the reverse - than a real price change.
PACK_MULTIPLES = (2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 18, 20, 24, 30, 36, 40, 48, 50, 60, 100)
PACK_RATIO_TOLERANCE = 0.03
# The same price change on a later invoice of the same item is one event,
# not a fresh alert each time the median baseline catches up.
ALERT_DEDUPE_DAYS = 60
DEFAULT_PRICE_ALERT_SETTINGS = {
    "threshold_percent": 10.0, "min_monthly_impact": 10.0, "alert_on_decrease": False, "enabled": True,
}


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _pack_multiple(ratio: float) -> Optional[int]:
    if ratio <= 0:
        return None
    for value in (ratio, 1 / ratio):
        for k in PACK_MULTIPLES:
            if abs(value - k) <= k * PACK_RATIO_TOLERANCE:
                return k
    return None


async def get_price_alert_settings_dict(company_id: Optional[str]) -> dict:
    settings = dict(DEFAULT_PRICE_ALERT_SETTINGS)
    if company_id:
        stored = await server.db.price_alert_settings.find_one({"company_id": company_id}, {"_id": 0})
        if stored:
            settings.update({k: stored[k] for k in DEFAULT_PRICE_ALERT_SETTINGS if k in stored})
    return settings


async def price_history_row(
    company_id: str, supplier: str, invoice_id: str, invoice_number: str, invoice_date: datetime, item: dict,
) -> Optional[dict]:
    """The price-history row for one invoice line, or None for a line with
    no price of its own (a negative discount/rebate row, or a malformed one)."""
    unit_price = item.get("unit_price")
    if not item.get("name") or unit_price is None or unit_price < 0:
        return None
    normalized_name, _ = await normalize_item_name(item["name"], company_id)
    return ItemPriceHistory(
        company_id=company_id, supplier=supplier, item_name=normalized_name, raw_name=item["name"],
        unit_price=unit_price, quantity=item.get("quantity") or 1, unit=item.get("unit") or "бр.",
        invoice_id=invoice_id, line_item_id=item.get("id"), invoice_number=invoice_number,
        invoice_date=_aware(invoice_date),
    ).model_dump()


def _typical_monthly_quantity(same_unit_records: List[dict], row: dict) -> float:
    """This item's usual quantity per month over the last IMPACT_WINDOW_DAYS
    of purchases (same supplier and unit) plus the new one. With no earlier
    purchase in that window, the new purchase alone stands in for a month -
    the cautious reading for something bought rarely."""
    row_date = _aware(row["invoice_date"])
    window_start = row_date - timedelta(days=IMPACT_WINDOW_DAYS)
    in_window = [
        r for r in same_unit_records
        if isinstance(r.get("invoice_date"), datetime) and window_start <= _aware(r["invoice_date"]) <= row_date
    ]
    if not in_window:
        return float(row.get("quantity") or 0)
    first = min(_aware(r["invoice_date"]) for r in in_window)
    span_days = max((row_date - first).days, 30)
    total = sum(r.get("quantity", 0) for r in in_window) + (row.get("quantity") or 0)
    return total * 30 / span_days


async def _same_unit_history(company_id: str, row: dict) -> List[dict]:
    """Earlier purchases of this item from this supplier in the same unit,
    newest first, excluding the row's own invoice."""
    supplier_filter = {"$regex": f"^{re.escape(row['supplier'])}$", "$options": "i"}
    unit_key = normalize_unit(row["unit"])
    earlier = await server.db.item_price_history.find(
        {"company_id": company_id, "supplier": supplier_filter, "item_name": row["item_name"],
         "invoice_id": {"$ne": row["invoice_id"]}},
        {"_id": 0, "unit_price": 1, "quantity": 1, "unit": 1, "invoice_date": 1},
        sort=[("invoice_date", -1)],
    ).to_list(500)
    return [r for r in earlier if normalize_unit(r.get("unit")) == unit_key and r.get("unit_price", 0) > 0]


async def evaluate_price_change(company_id: str, row: dict, settings: dict, dedupe: bool = True) -> Optional[dict]:
    """The alert one new price-history row deserves, if any, judged against
    this company's own earlier purchases of the same item from the same
    supplier in the same unit (a "стек" price is never compared with a "бр."
    one). Returns PriceAlert fields:

    - "pack_suspect" when the new unit price is a pack multiple of the usual
      one: almost always a misread pack, so it asks rather than claiming
      +500%;
    - "price_change" when the move crosses threshold_percent AND costs at
      least min_monthly_impact EUR a month at the usual quantity - the size
      of the move in money, not per unit, decides whether it matters."""
    if not settings["enabled"]:
        return None
    supplier_filter = {"$regex": f"^{re.escape(row['supplier'])}$", "$options": "i"}
    if await server.db.price_alert_mutes.find_one(
        {"company_id": company_id, "item_name": row["item_name"], "supplier": supplier_filter}
    ):
        return None

    same_unit = await _same_unit_history(company_id, row)
    if not same_unit:
        return None

    recent = same_unit[:PRICE_BASELINE_PURCHASES]
    old_price = statistics.median(r["unit_price"] for r in recent)
    new_price = row["unit_price"]
    if old_price <= 0 or new_price <= 0:
        return None
    change_percent = (new_price - old_price) / old_price * 100
    alert = {
        "item_name": row["item_name"], "supplier": row["supplier"], "unit": row["unit"],
        "old_price": round(old_price, 4), "new_price": new_price, "change_percent": round(change_percent, 2),
        "direction": "increase" if change_percent >= 0 else "decrease",
        "baseline_purchase_count": len(recent), "invoice_id": row["invoice_id"],
        "line_item_id": row.get("line_item_id"), "invoice_number": row["invoice_number"],
    }

    multiple = _pack_multiple(new_price / old_price)
    if multiple:
        return {**alert, "kind": "pack_suspect", "pack_multiple": multiple}

    threshold = settings["threshold_percent"]
    if not (change_percent >= threshold or (settings["alert_on_decrease"] and change_percent <= -threshold)):
        return None
    monthly_impact = round((new_price - old_price) * _typical_monthly_quantity(same_unit, row), 2)
    if abs(monthly_impact) < settings["min_monthly_impact"]:
        return None

    if not dedupe:
        return {**alert, "kind": "price_change", "monthly_impact": monthly_impact}
    already_alerted = await server.db.price_alerts.find_one({
        "company_id": company_id, "item_name": row["item_name"], "supplier": supplier_filter,
        "kind": {"$ne": "pack_suspect"}, "new_price": {"$gte": new_price * 0.995, "$lte": new_price * 1.005},
        "created_at": {"$gte": datetime.now(timezone.utc) - timedelta(days=ALERT_DEDUPE_DAYS)},
    }, {"_id": 1})
    if already_alerted:
        return None
    return {**alert, "kind": "price_change", "monthly_impact": monthly_impact}


# ===================== LEARNED PACK SIZES =====================
# "Айран от Метро = стек от 6": when the owner corrects a line from N packs
# to N x k pieces - in scan review or by editing a saved invoice - the app
# remembers k for that item from that supplier, and the next scan that
# prices it as a pack gets the same correction applied, visibly and with
# undo. An undone correction is forgotten. Generic: any item, any supplier.

PACK_RULE_MAX = 100


def _supplier_key(supplier: str) -> str:
    return (supplier or "").strip().lower()


def detect_pack_multiple(old_qty: Any, old_price: Any, new_qty: Any, new_price: Any) -> Optional[int]:
    """k when (new_qty, new_price) == (old_qty x k, old_price / k) for a whole
    k >= 2: the same line re-read as k times as many pieces at 1/k the price."""
    values = (old_qty, old_price, new_qty, new_price)
    if not all(isinstance(v, (int, float)) and v > 0 for v in values):
        return None
    k = round(new_qty / old_qty)
    if k < 2 or k > PACK_RULE_MAX:
        return None
    if abs(new_qty - old_qty * k) > 0.01 * new_qty or abs(new_price * k - old_price) > 0.02 * old_price:
        return None
    return k


async def learn_pack_rule(company_id: str, supplier: str, item_name: str, multiple: int, source: str) -> None:
    item_key, _ = await normalize_item_name(item_name, company_id)
    now = datetime.now(timezone.utc)
    await server.db.item_pack_rules.update_one(
        {"company_id": company_id, "item_key": item_key, "supplier_key": _supplier_key(supplier)},
        {"$set": {"company_id": company_id, "item_key": item_key, "supplier_key": _supplier_key(supplier),
                  "supplier": supplier, "multiple": multiple, "source": source, "updated_at": now},
         "$setOnInsert": {"created_at": now}},
        upsert=True,
    )


async def forget_pack_rule(company_id: str, supplier: str, item_name: str) -> None:
    item_key, _ = await normalize_item_name(item_name, company_id)
    await server.db.item_pack_rules.delete_one(
        {"company_id": company_id, "item_key": item_key, "supplier_key": _supplier_key(supplier)}
    )


async def get_pack_rule(company_id: str, supplier: str, item_key: str) -> Optional[int]:
    rule = await server.db.item_pack_rules.find_one(
        {"company_id": company_id, "item_key": item_key, "supplier_key": _supplier_key(supplier)},
        {"_id": 0, "multiple": 1},
    )
    return rule.get("multiple") if rule else None


async def purge_invoice_price_data(company_id: str, invoice_id: str) -> None:
    """A deleted invoice takes its price history and alerts with it - left
    behind, they double-counted quantities and, as same-day duplicates,
    knocked items out of reorder suggestions entirely."""
    await server.db.item_price_history.delete_many({"company_id": company_id, "invoice_id": invoice_id})
    await server.db.price_alerts.delete_many({"company_id": company_id, "invoice_id": invoice_id})


async def rebuild_invoice_price_history(company_id: str, invoice_doc: dict) -> None:
    """Re-derives the price history of a restored invoice (no alerts - a
    restore is not a new purchase)."""
    invoice_date = invoice_doc.get("date")
    if isinstance(invoice_date, str):
        invoice_date = datetime.fromisoformat(invoice_date.replace("Z", "+00:00"))
    if not isinstance(invoice_date, datetime):
        return
    rows = []
    for item in invoice_doc.get("items") or []:
        row = await price_history_row(
            company_id, invoice_doc.get("supplier", ""), invoice_doc["id"],
            invoice_doc.get("invoice_number", ""), invoice_date, item,
        )
        if row:
            rows.append(row)
    await server.db.item_price_history.delete_many({"company_id": company_id, "invoice_id": invoice_doc["id"]})
    if rows:
        await server.db.item_price_history.insert_many(rows)


async def resync_invoice_header(company_id: str, invoice_id: str, changes: dict) -> None:
    """Carries an edited supplier, number or date over to the invoice's
    price history and alerts."""
    shared = {k: changes[k] for k in ("supplier", "invoice_number") if k in changes}
    history_fields = dict(shared)
    if "date" in changes:
        history_fields["invoice_date"] = _aware(changes["date"])
    if history_fields:
        await server.db.item_price_history.update_many(
            {"company_id": company_id, "invoice_id": invoice_id}, {"$set": history_fields}
        )
    if shared:
        await server.db.price_alerts.update_many(
            {"company_id": company_id, "invoice_id": invoice_id}, {"$set": shared}
        )


async def resync_invoice_line(
    company_id: str, invoice_id: str, supplier: str, invoice_number: str, invoice_date: datetime,
    old_item: dict, new_item: dict,
) -> None:
    """Re-derives the price-history row AND the alert of one corrected
    invoice line - fixing a 6-pack misread as one unit removes the bogus
    +500% alert it raised, instead of leaving it to be dismissed by hand.
    An alert that survives the correction unchanged keeps its read status."""
    # Rows and alerts written before line_item_id existed carry the line's
    # normalized name (or, for some, its raw text) instead.
    old_raw_name = old_item.get("name") or ""
    old_normalized, _ = await normalize_item_name(old_raw_name, company_id)
    legacy_names: List[Dict[str, Any]] = [
        {"item_name": old_normalized},
        {"item_name": {"$regex": f"^{re.escape(old_raw_name)}$", "$options": "i"}},
    ]

    line_filter: Dict[str, Any] = {"company_id": company_id, "invoice_id": invoice_id}
    if old_item.get("id") and await server.db.item_price_history.find_one(
        {**line_filter, "line_item_id": old_item["id"]}, {"_id": 1}
    ):
        line_filter["line_item_id"] = old_item["id"]
    else:
        # Legacy row: its name, old quantity and old unit price identify
        # the line within its own invoice.
        line_filter.update({
            "quantity": old_item.get("quantity"), "unit_price": old_item.get("unit_price"), "$or": legacy_names,
        })
    await server.db.item_price_history.delete_many(line_filter)

    alert_matches: List[dict] = [{"line_item_id": None, **name} for name in legacy_names]
    if old_item.get("id"):
        alert_matches.append({"line_item_id": old_item["id"]})
    alert_filter = {"company_id": company_id, "invoice_id": invoice_id, "$or": alert_matches}
    previous = await server.db.price_alerts.find_one(alert_filter, {"_id": 0})
    await server.db.price_alerts.delete_many(alert_filter)

    row = await price_history_row(company_id, supplier, invoice_id, invoice_number, invoice_date, new_item)
    if not row:
        return
    alert = await evaluate_price_change(company_id, row, await get_price_alert_settings_dict(company_id))
    await server.db.item_price_history.insert_one(row)
    if alert:
        unchanged = (
            previous is not None
            and previous.get("kind", "price_change") == alert["kind"]
            and abs(previous.get("new_price", 0) - alert["new_price"]) < 1e-9
        )
        status = previous["status"] if unchanged and previous else "unread"
        await server.db.price_alerts.insert_one(PriceAlert(company_id=company_id, status=status, **alert).model_dump())


async def cleanup_orphan_price_data() -> dict:
    """One-time repair of data written before deletes and edits kept price
    data in sync: history rows and alerts of invoices that no longer exist,
    and unread alerts whose invoice line has since been corrected to a
    different price. Recorded in data_migrations so it runs once."""
    marker = "price_data_cleanup_v1"
    if await server.db.data_migrations.find_one({"_id": marker}):
        return {"skipped": True}

    removed = {"item_price_history": 0, "price_alerts": 0}
    for name in removed:
        collection = server.db[name]
        invoice_ids = [i for i in await collection.distinct("invoice_id") if i]
        existing: set = set()
        for start in range(0, len(invoice_ids), 500):
            chunk = invoice_ids[start:start + 500]
            existing.update(d["id"] for d in await server.db.invoices.find({"id": {"$in": chunk}}, {"id": 1}).to_list(len(chunk)))
        orphans = [i for i in invoice_ids if i not in existing]
        for start in range(0, len(orphans), 500):
            result = await collection.delete_many({"invoice_id": {"$in": orphans[start:start + 500]}})
            removed[name] += result.deleted_count
    removed_rows, removed_alerts = removed["item_price_history"], removed["price_alerts"]

    unread = await server.db.price_alerts.find({"status": "unread"}, {"_id": 0}).to_list(10000)
    for alert in unread:
        if not alert.get("invoice_id"):
            continue
        invoice = await server.db.invoices.find_one({"id": alert["invoice_id"]}, {"_id": 0, "items": 1})
        invoice_items: List[dict] = (invoice.get("items") if invoice else None) or []
        lines = [
            it for it in invoice_items
            if (alert.get("line_item_id") and it.get("id") == alert["line_item_id"])
            or (not alert.get("line_item_id") and (it.get("name") or "").lower() == (alert.get("item_name") or "").lower())
        ]
        if lines and all(abs(it.get("unit_price", 0) - alert["new_price"]) > 1e-9 for it in lines):
            await server.db.price_alerts.delete_one({"id": alert["id"]})
            removed_alerts += 1

    await server.db.data_migrations.insert_one({"_id": marker, "ran_at": datetime.now(timezone.utc)})
    return {"removed_rows": removed_rows, "removed_alerts": removed_alerts}


class PriceCheckLine(BaseModel):
    name: str
    quantity: float = 1
    unit: str = "бр."
    unit_price: float


class PriceCheckRequest(BaseModel):
    supplier: str
    items: List[PriceCheckLine] = Field(default_factory=list, max_length=200)


@router.post("/items/price-check")
@limiter.limit("30/minute")
async def check_item_prices(request: Request, body: PriceCheckRequest, current_user: User = Depends(get_current_user)):
    """Scan-review preview of what each recognized line would raise once
    saved, judged by the same engine as the saved invoice: a "стек ли е?"
    question when the price is a pack multiple of the usual one, or the
    size of a real price change in EUR a month - so a misread can be fixed
    before it ever reaches the price history. Writes nothing."""
    require_permission(current_user, "manage_invoices")
    company_id, _ = await get_company_scope(current_user)
    if not company_id or not body.supplier.strip() or not body.items:
        return {"hints": []}
    supplier, _ = await normalize_supplier_name(body.supplier, company_id)
    settings = await get_price_alert_settings_dict(company_id)
    now = datetime.now(timezone.utc)
    hints = []
    for index, line in enumerate(body.items):
        row = await price_history_row(company_id, supplier, "__preview__", "", now, line.model_dump())
        if not row:
            continue
        # A pack size learned from an earlier correction is applied when the
        # price looks like that pack (closer to k x the usual price than to
        # the usual price), or when there is no usual price to compare with.
        learned = await get_pack_rule(company_id, supplier, row["item_name"])
        if learned and row["unit_price"] > 0:
            same_unit = await _same_unit_history(company_id, row)
            baseline = statistics.median(r["unit_price"] for r in same_unit[:PRICE_BASELINE_PURCHASES]) if same_unit else None
            ratio = row["unit_price"] / baseline if baseline else None
            if ratio is None or abs(math.log(ratio / learned)) < abs(math.log(ratio)):
                hints.append({
                    "index": index, "kind": "pack_rule", "pack_multiple": learned, "auto_apply": True,
                    "old_price": round(baseline, 4) if baseline else None, "new_price": row["unit_price"],
                    "change_percent": None, "direction": "increase", "monthly_impact": None, "unit": row["unit"],
                })
                continue
        result = await evaluate_price_change(company_id, row, settings, dedupe=False)
        if result:
            hints.append({
                "index": index,
                **{k: result.get(k) for k in (
                    "kind", "old_price", "new_price", "change_percent", "direction",
                    "pack_multiple", "monthly_impact", "unit",
                )},
            })
    return {"hints": hints}


@router.get("/items/price-alerts")
async def get_price_alerts(
    status: Optional[str] = None,  # unread, read, dismissed
    invoice_id: Optional[str] = None,  # за показване на конкретна фактура кои артикули са с повишена цена
    current_user: User = Depends(get_current_user)
):
    """Връща ценови аларми за фирмата"""
    # Purchase prices by supplier: for whoever may see invoices (the badges
    # on an invoice's lines) or the company's figures - before, any member
    # could read them. Without either, simply nothing to show.
    company_id, scope = await get_company_scope(current_user)

    if not company_id or not {"manage_invoices", "view_statistics"} & set(current_user.permissions or []):
        return {"alerts": [], "total": 0, "unread_count": 0}

    query = dict(scope)
    if status:
        query["status"] = status
    if invoice_id:
        query["invoice_id"] = invoice_id

    alerts = await server.db.price_alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    # Unread first, and among them the costliest per month first - the
    # newest-first order stays for everything else (the sort is stable).
    alerts.sort(key=lambda a: (
        a.get("status") != "unread",
        -abs(a.get("monthly_impact") or 0) if a.get("status") == "unread" else 0,
    ))

    # Count unread
    unread_count = await server.db.price_alerts.count_documents({**scope, "status": "unread"})
    
    return {
        "alerts": alerts,
        "total": len(alerts),
        "unread_count": unread_count
    }

@router.put("/items/price-alerts/{alert_id}")
async def update_price_alert(
    alert_id: str,
    request: Request,
    current_user: User = Depends(get_current_user)
):
    """Обновява статус на аларма (read, dismissed)"""
    body = await request.json()
    status = body.get("status")
    
    if status not in ["read", "dismissed"]:
        raise HTTPException(status_code=400, detail="Невалиден статус")
    
    _, scope = await get_company_scope(current_user)

    result = await server.db.price_alerts.update_one(
        {"id": alert_id, **scope},
        {"$set": {"status": status}}
    )

    # matched_count (not modified_count) correctly means "not found" -
    # modified_count is also 0 when the alert already had this exact
    # status (e.g. marking an already-read alert read again), which isn't
    # an error.
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Алармата не е намерена")
    
    return {"message": "Статусът е обновен"}

@router.get("/items/price-alert-settings")
async def get_price_alert_settings(current_user: User = Depends(get_current_user)):
    """Връща настройки за ценови аларми"""
    company_id, _ = await get_company_scope(current_user)
    return await get_price_alert_settings_dict(company_id)

@router.put("/items/price-alert-settings")
async def update_price_alert_settings(
    request: Request,
    current_user: User = Depends(get_current_user)
):
    """Обновява настройки за ценови аларми"""
    # Company-wide config for the price-tracking feature, same domain as
    # the rest of /items/* and /statistics/items/* - gated on view_statistics
    # like them, instead of any authenticated member being able to change
    # it for everyone.
    require_permission(current_user, "view_statistics")
    body = await request.json()

    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    
    update_data: Dict[str, Any] = {}
    if "threshold_percent" in body:
        update_data["threshold_percent"] = float(body["threshold_percent"])
    if "min_monthly_impact" in body:
        update_data["min_monthly_impact"] = max(0.0, float(body["min_monthly_impact"]))
    if "alert_on_decrease" in body:
        update_data["alert_on_decrease"] = bool(body["alert_on_decrease"])
    if "enabled" in body:
        update_data["enabled"] = bool(body["enabled"])

    existing = await server.db.price_alert_settings.find_one({"company_id": company_id})

    if existing:
        await server.db.price_alert_settings.update_one(
            {"company_id": company_id},
            {"$set": update_data}
        )
    else:
        settings = PriceAlertSettings(company_id=company_id, **update_data)
        await server.db.price_alert_settings.insert_one(settings.model_dump())

    return {"message": "Настройките са запазени"}

@router.get("/items/price-alert-mutes")
async def get_price_alert_mutes(current_user: User = Depends(get_current_user)):
    """Връща списъка с артикули/доставчици, за които алармите са спрени"""
    require_permission(current_user, "view_statistics")
    _, scope = await get_company_scope(current_user)
    mutes = await server.db.price_alert_mutes.find(scope, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"mutes": mutes}

@router.post("/items/price-alert-mutes")
async def create_price_alert_mute(payload: PriceAlertMuteCreate, current_user: User = Depends(get_current_user)):
    """Спира бъдещи аларми за конкретен артикул от конкретен доставчик"""
    require_permission(current_user, "view_statistics")
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")

    normalized_name, _ = await normalize_item_name(payload.item_name, company_id)
    existing = await server.db.price_alert_mutes.find_one({
        **scope,
        "item_name": normalized_name,
        "supplier": {"$regex": f"^{re.escape(payload.supplier)}$", "$options": "i"},
    })
    if existing:
        return {"mute": existing}

    mute = PriceAlertMute(company_id=company_id, item_name=normalized_name, supplier=payload.supplier)
    await server.db.price_alert_mutes.insert_one(mute.model_dump())
    return {"mute": mute.model_dump()}

@router.delete("/items/price-alert-mutes/{mute_id}")
async def delete_price_alert_mute(mute_id: str, current_user: User = Depends(get_current_user)):
    """Възобновява алармите за артикул/доставчик, който е бил спрян"""
    require_permission(current_user, "view_statistics")
    _, scope = await get_company_scope(current_user)
    result = await server.db.price_alert_mutes.delete_one({"id": mute_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    return {"message": "Алармите за този артикул са възобновени"}

@router.get("/items/price-history/{item_name}")
async def get_item_price_history(
    item_name: str,
    supplier: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Връща история на цените за артикул"""
    require_permission(current_user, "view_statistics")
    from urllib.parse import unquote

    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        return {"history": [], "statistics": {}}
    
    item_name = unquote(item_name).strip().lower()
    
    query = {
        "company_id": company_id,
        "item_name": item_name
    }
    if supplier:
        query["supplier"] = {"$regex": f"^{re.escape(unquote(supplier))}$", "$options": "i"}
    
    history = await server.db.item_price_history.find(query, {"_id": 0}).sort("invoice_date", 1).to_list(ALL_ROWS)
    
    if not history:
        return {"history": [], "statistics": {}}
    
    # Calculate statistics
    prices = [h["unit_price"] for h in history]
    avg_price = sum(prices) / len(prices) if prices else 0
    min_price = min(prices) if prices else 0
    max_price = max(prices) if prices else 0
    
    # Calculate variance
    if len(prices) > 1:
        variance = sum((p - avg_price) ** 2 for p in prices) / len(prices)
        std_dev = variance ** 0.5
    else:
        std_dev = 0
    
    # Trend (last 3 vs first 3)
    if len(prices) >= 6:
        first_avg = sum(prices[:3]) / 3
        last_avg = sum(prices[-3:]) / 3
        trend_percent = ((last_avg - first_avg) / first_avg * 100) if first_avg > 0 else 0
    else:
        trend_percent = 0
    
    # Format history for response
    formatted_history = []
    for h in history:
        date_val = h.get("invoice_date")
        date_str = date_val.strftime("%Y-%m-%d") if isinstance(date_val, datetime) else str(date_val)[:10]
        base_price = base_unit_price(h.get("unit_price") or 0, item_name, h.get("unit"))
        formatted_history.append({
            "date": date_str,
            "supplier": h.get("supplier"),
            "unit_price": h.get("unit_price"),
            "quantity": h.get("quantity"),
            "unit": h.get("unit"),
            "invoice_number": h.get("invoice_number"),
            "base_price": round(base_price[0], 4) if base_price else None,
            "base_unit": unit_label(base_price[1]) if base_price else None,
        })

    # Price per kg / l / piece, when every purchase converts to the same one
    base_units = {row["base_unit"] for row in formatted_history}
    base_prices = [row["base_price"] for row in formatted_history if row["base_price"] is not None]
    same_base = len(base_units) == 1 and None not in base_units
    
    return {
        "item_name": item_name,
        "history": formatted_history,
        "statistics": {
            "base_unit": next(iter(base_units)) if same_base else None,
            "avg_base_price": round(sum(base_prices) / len(base_prices), 4) if same_base and base_prices else None,
            "avg_price": round(avg_price, 2),
            "min_price": round(min_price, 2),
            "max_price": round(max_price, 2),
            "std_dev": round(std_dev, 2),
            "trend_percent": round(trend_percent, 1),
            "total_records": len(history)
        }
    }

async def _item_coverage(current_user: User, start_date: Optional[str], end_date: Optional[str]) -> Dict[str, Any]:
    """How much of the period's purchases (without VAT) the items stand for.

    Invoices whose lines were never read have no items, so the items add up
    to less than the suppliers do - said with a number instead of being left
    for the owner to wonder about.
    """
    _, scope = await get_company_scope(current_user)
    query: Dict[str, Any] = dict(scope)
    if start_date or end_date:
        query["date"] = Period.parse(start_date, end_date).datetime_filter()
    net_only = {"_id": 0, "amount_without_vat": 1}
    purchases = await server.db.invoices.find(query, net_only).to_list(ALL_ROWS)
    with_lines = await server.db.invoices.find({**query, "items.0": {"$exists": True}}, net_only).to_list(ALL_ROWS)
    purchases_net = sum(float(p.get("amount_without_vat") or 0) for p in purchases)
    with_lines_net = sum(float(p.get("amount_without_vat") or 0) for p in with_lines)
    return {
        "purchases_without_vat": round(purchases_net, 2),
        "with_lines_without_vat": round(with_lines_net, 2),
        "share": round(with_lines_net / purchases_net, 3) if purchases_net > 0 else None,
        "invoices_without_lines": len(purchases) - len(with_lines),
    }


@router.get("/statistics/items")
async def get_item_statistics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    top_n: int = 10,
    current_user: User = Depends(get_current_user)
):
    """Връща статистика за артикули - топ N по брой и стойност"""
    require_permission(current_user, "view_statistics")
    from collections import defaultdict

    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        return {
            "totals": {"total_items": 0, "total_value": 0, "unique_items": 0},
            "top_by_quantity": [],
            "top_by_value": [],
            "top_by_frequency": [],
            "price_trends": []
        }
    
    # Build date query
    query = {"company_id": company_id}
    if start_date or end_date:
        # The same business days as every other module (services/business_calendar).
        try:
            query["invoice_date"] = Period.parse(start_date, end_date).datetime_filter()
        except ValueError:
            raise HTTPException(status_code=400, detail="Невалиден период")
    
    # Get all price history records
    history = await server.db.item_price_history.find(query, {"_id": 0}).to_list(ALL_ROWS)
    
    if not history:
        return {
            "totals": {"total_items": 0, "total_value": 0, "unique_items": 0},
            "coverage": await _item_coverage(current_user, start_date, end_date),
            "top_by_quantity": [],
            "top_by_value": [],
            "top_by_frequency": [],
            "price_trends": []
        }
    
    # Aggregate by item - quantities kept per unit, and in kg / l / pieces
    # where the unit or the name says what a unit holds, so pieces and
    # kilograms are never added together.
    item_stats: Dict[str, Any] = defaultdict(lambda: {
        "quantity": 0,
        "total_value": 0,
        "frequency": 0,
        "prices": [],
        "suppliers": set(),
        "by_unit": defaultdict(float),
        "by_base": defaultdict(float),
        "spend_by_base": defaultdict(float),
    })
    
    for record in history:
        name = record["item_name"]
        price = record["unit_price"]
        qty = record["quantity"]
        
        item_stats[name]["quantity"] += qty
        item_stats[name]["total_value"] += price * qty
        item_stats[name]["frequency"] += 1
        item_stats[name]["prices"].append(price)
        item_stats[name]["suppliers"].add(record["supplier"])
        item_stats[name]["by_unit"][normalize_unit(record.get("unit"))] += qty
        base = base_quantity(qty, name, record.get("unit"))
        if base:
            item_stats[name]["by_base"][base[1]] += base[0]
            item_stats[name]["spend_by_base"][base[1]] += price * qty
    
    # Calculate statistics for each item
    items_list = []
    for name, stats in item_stats.items():
        prices = stats["prices"]
        avg_price = sum(prices) / len(prices) if prices else 0
        
        # Price variance
        if len(prices) > 1:
            variance = sum((p - avg_price) ** 2 for p in prices) / len(prices)
            price_variance = (variance ** 0.5) / avg_price * 100 if avg_price > 0 else 0
        else:
            price_variance = 0
        
        # Trend
        if len(prices) >= 4:
            first_half = sum(prices[:len(prices)//2]) / (len(prices)//2)
            second_half = sum(prices[len(prices)//2:]) / (len(prices) - len(prices)//2)
            trend = ((second_half - first_half) / first_half * 100) if first_half > 0 else 0
        else:
            trend = 0
        
        # One unit to count this item in: its own unit when it is always
        # bought in one, else kg / l / pieces when every line converts.
        if len(stats["by_unit"]) == 1:
            unit_key, quantity = next(iter(stats["by_unit"].items()))
        elif len(stats["by_base"]) == 1 and sum(stats["spend_by_base"].values()) >= stats["total_value"] - 0.01:
            unit_key, quantity = next(iter(stats["by_base"].items()))
        else:
            unit_key, quantity = None, None
        base_unit = next(iter(stats["by_base"])) if len(stats["by_base"]) == 1 else None
        items_list.append({
            "item_name": name,
            "quantity": round(quantity, 2) if quantity is not None else round(stats["quantity"], 2),
            "unit": unit_label(unit_key) if unit_key else None,
            "base_unit": unit_label(base_unit) if base_unit else None,
            "avg_base_price": round(stats["spend_by_base"][base_unit] / stats["by_base"][base_unit], 4)
            if base_unit and stats["by_base"][base_unit] else None,
            "total_value": round(stats["total_value"], 2),
            "frequency": stats["frequency"],
            "avg_price": round(avg_price, 2),
            "min_price": round(min(prices), 2) if prices else 0,
            "max_price": round(max(prices), 2) if prices else 0,
            "price_variance": round(price_variance, 1),
            "trend_percent": round(trend, 1),
            "supplier_count": len(stats["suppliers"])
        })
    
    # Sort by different criteria. Quantity is ranked within one unit at a
    # time - 40 kg and 400 pieces are not "more" than each other.
    by_unit_lists: Dict[str, List[dict]] = defaultdict(list)
    for entry in items_list:
        if entry["unit"]:
            by_unit_lists[entry["unit"]].append(entry)
    top_by_quantity_by_unit = {
        unit: sorted(entries, key=lambda x: x["quantity"], reverse=True)[:top_n]
        for unit, entries in sorted(by_unit_lists.items(), key=lambda kv: len(kv[1]), reverse=True)
    }
    top_by_quantity = next(iter(top_by_quantity_by_unit.values()), [])
    top_by_value = sorted(items_list, key=lambda x: x["total_value"], reverse=True)[:top_n]
    top_by_frequency = sorted(items_list, key=lambda x: x["frequency"], reverse=True)[:top_n]
    
    # Items with significant price changes
    price_trends = sorted(
        [i for i in items_list if abs(i["trend_percent"]) > 5],
        key=lambda x: abs(x["trend_percent"]),
        reverse=True
    )[:top_n]
    
    # Totals
    total_quantity = sum(i["quantity"] for i in items_list)
    total_value = sum(i["total_value"] for i in items_list)

    return {
        "totals": {
            "total_items": round(total_quantity, 2),
            "total_value": round(total_value, 2),
            "unique_items": len(items_list)
        },
        "coverage": await _item_coverage(current_user, start_date, end_date),
        "top_by_quantity": top_by_quantity,
        "top_by_quantity_by_unit": top_by_quantity_by_unit,
        "top_by_value": top_by_value,
        "top_by_frequency": top_by_frequency,
        "price_trends": price_trends
    }

@router.get("/items/price-inflation")
async def get_price_inflation(
    start_date: str,
    end_date: str,
    current_user: User = Depends(get_current_user)
):
    """Обща 'инфлация' на покупните цени за избран период - за всеки
    артикул, купен поне два пъти в периода, сравнява цената при първата и
    последната покупка, после осреднява промяната претеглено спрямо
    реално похарчената сума за артикула (не проста средна аритметична) -
    така артикул, купуван често за големи суми, тежи повече в общия
    процент от такъв, купен веднъж за дребна сума."""
    require_permission(current_user, "view_statistics")
    from collections import defaultdict

    company_id, _ = await get_company_scope(current_user)

    empty_response = {
        "period": {"start_date": start_date, "end_date": end_date},
        "overall_change_percent": 0,
        "items_compared": 0,
        "total_weighted_spend": 0,
        "items": [],
    }
    if not company_id:
        return empty_response

    query = {
        "company_id": company_id,
        "invoice_date": Period.parse(start_date, end_date).datetime_filter(),
    }
    history = await server.db.item_price_history.find(query, {"_id": 0}).sort("invoice_date", 1).to_list(ALL_ROWS)
    if not history:
        return empty_response

    # Per item AND unit: a first purchase per piece and a last one per pack
    # are not a price change.
    by_item = defaultdict(list)
    for record in history:
        by_item[(record["item_name"], normalize_unit(record.get("unit")))].append(record)

    items_result = []
    for (item_name, _unit), records in by_item.items():
        if len(records) < 2:
            continue  # Only one purchase in the period - no comparison point
        first, last = records[0], records[-1]
        start_price = first["unit_price"]
        end_price = last["unit_price"]
        if start_price <= 0:
            continue
        change_percent = ((end_price - start_price) / start_price) * 100
        spend_in_period = sum(r["unit_price"] * r["quantity"] for r in records)

        items_result.append({
            "item_name": item_name,
            "supplier": last["supplier"],
            "start_price": round(start_price, 2),
            "end_price": round(end_price, 2),
            "change_percent": round(change_percent, 1),
            "spend_in_period": round(spend_in_period, 2),
            "purchase_count": len(records),
            "first_date": first["invoice_date"].date().isoformat(),
            "last_date": last["invoice_date"].date().isoformat(),
        })

    items_result.sort(key=lambda x: x["change_percent"], reverse=True)

    total_weight = sum(i["spend_in_period"] for i in items_result)
    if total_weight > 0:
        overall_change = sum(i["change_percent"] * i["spend_in_period"] for i in items_result) / total_weight
    else:
        overall_change = 0

    return {
        "period": {"start_date": start_date, "end_date": end_date},
        "overall_change_percent": round(overall_change, 1),
        "items_compared": len(items_result),
        "total_weighted_spend": round(total_weight, 2),
        "items": items_result,
    }

@router.get("/statistics/items/{item_name}/by-supplier")
async def get_item_by_supplier(
    item_name: str,
    current_user: User = Depends(get_current_user)
):
    """Сравнява цените на артикул между различни доставчици"""
    require_permission(current_user, "view_statistics")
    from collections import defaultdict
    from urllib.parse import unquote

    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        return {"item_name": item_name, "suppliers": []}
    
    normalized_name = unquote(item_name).strip().lower()
    
    history = await server.db.item_price_history.find(
        {"company_id": company_id, "item_name": normalized_name},
        {"_id": 0}
    ).to_list(10000)
    
    if not history:
        return {"item_name": item_name, "suppliers": [], "recommendation": None}
    
    # Group by supplier
    supplier_data: Dict[str, Any] = defaultdict(lambda: {"prices": [], "quantities": [], "dates": [], "base": [], "units": set()})
    
    for record in history:
        supplier = record["supplier"]
        supplier_data[supplier]["prices"].append(record["unit_price"])
        supplier_data[supplier]["quantities"].append(record["quantity"])
        supplier_data[supplier]["base"].append(base_unit_price(record["unit_price"], normalized_name, record.get("unit")))
        supplier_data[supplier]["units"].add(normalize_unit(record.get("unit")))
        date_val = record.get("invoice_date")
        if isinstance(date_val, datetime):
            supplier_data[supplier]["dates"].append(date_val)
    
    # Calculate stats per supplier
    suppliers = []
    for supplier, data in supplier_data.items():
        prices = data["prices"]
        avg = sum(prices) / len(prices) if prices else 0
        last_date = max(data["dates"]) if data["dates"] else None
        bases = data["base"]
        base_units = {b[1] for b in bases if b}
        comparable = bool(bases) and all(bases) and len(base_units) == 1
        
        suppliers.append({
            "supplier": supplier,
            "avg_price": round(avg, 2),
            "min_price": round(min(prices), 2) if prices else 0,
            "max_price": round(max(prices), 2) if prices else 0,
            "last_price": round(prices[-1], 2) if prices else 0,
            "purchase_count": len(prices),
            "total_quantity": round(sum(data["quantities"]), 2),
            "last_purchase": last_date.strftime("%Y-%m-%d") if last_date else None,
            "unit": unit_label(next(iter(data["units"]))) if len(data["units"]) == 1 else None,
            # Price per kg / l / piece - what makes suppliers selling in
            # different units or pack sizes comparable at all.
            "avg_base_price": round(sum(b[0] for b in bases) / len(bases), 4) if comparable else None,
            "base_unit": unit_label(next(iter(base_units))) if comparable else None,
        })
    
    # Compare per kg / l / piece when every supplier converts to the same
    # base unit, else per line unit only when all sell in the same unit -
    # otherwise the prices are not comparable and nothing is recommended.
    base_units_all = {s_["base_unit"] for s_ in suppliers}
    line_units_all = {s_["unit"] for s_ in suppliers}
    if None not in base_units_all and len(base_units_all) == 1:
        metric = "avg_base_price"
    elif None not in line_units_all and len(line_units_all) == 1:
        metric = "avg_price"
    else:
        metric = None
    suppliers.sort(key=lambda x: (x[metric] if metric else x["avg_price"]))
    
    recommendation = None
    if metric and len(suppliers) >= 2:
        cheapest = suppliers[0]
        most_expensive = suppliers[-1]
        if cheapest[metric] > 0:
            savings_percent = ((most_expensive[metric] - cheapest[metric]) / most_expensive[metric] * 100)
            if savings_percent > 5:
                recommendation = {
                    "best_supplier": cheapest["supplier"],
                    "avg_price": cheapest["avg_price"],
                    "avg_base_price": cheapest["avg_base_price"],
                    "base_unit": cheapest["base_unit"],
                    "compared_per": "base_unit" if metric == "avg_base_price" else "unit",
                    "potential_savings_percent": round(savings_percent, 1)
                }
    
    return {
        "item_name": item_name,
        "suppliers": suppliers,
        "recommendation": recommendation,
        "sizes": await _other_sizes(company_id, normalized_name, history),
    }


async def _other_sizes(company_id: str, item_name: str, history: List[dict]) -> List[dict]:
    """The same product in other pack sizes ("Доматен сос 5кг" for "Доматен
    сос 1кг"), each with its price per kg / l / piece and how it compares -
    a bigger pack is often cheaper per kg, which comparing tin prices hides."""
    own = [base_unit_price(r["unit_price"], item_name, r.get("unit")) for r in history]
    own_units = {b[1] for b in own if b}
    if not own or not all(own) or len(own_units) != 1:
        return []
    own_unit = next(iter(own_units))
    own_avg = sum(b[0] for b in own if b) / len(own)
    product = _size_free_key(item_name)
    signature = item_size_signature(item_name)
    names = await server.db.item_price_history.distinct("item_name", {"company_id": company_id})
    result = []
    for name in names:
        if name == item_name or _size_free_key(name) != product or item_size_signature(name) == signature:
            continue
        rows = await server.db.item_price_history.find(
            {"company_id": company_id, "item_name": name}, {"_id": 0, "unit_price": 1, "unit": 1}
        ).to_list(500)
        prices = [base_unit_price(r["unit_price"], name, r.get("unit")) for r in rows]
        if not prices or not all(prices) or {b[1] for b in prices if b} != {own_unit}:
            continue
        avg = sum(b[0] for b in prices if b) / len(prices)
        result.append({
            "item_name": name, "avg_base_price": round(avg, 4), "base_unit": unit_label(own_unit),
            "purchase_count": len(rows),
            "difference_percent": round((avg - own_avg) / own_avg * 100, 1) if own_avg else None,
        })
    result.sort(key=lambda x: x["avg_base_price"])
    return result[:10]

# Needs at least 4 purchases to call anything a "usual" cadence - same
# minimum-sample-size reasoning as ForecastService's trend gate.
MIN_PURCHASES_FOR_CADENCE = 4
# A number with an optional unit right after it ("1кг", "0,5 л", "6 бр.") -
# what tells two pack sizes of one product apart.
_SIZE_TOKEN = re.compile(r'\d+(?:[.,]\d+)?\s*(?:кг|гр|г|мл|л|бр|kg|g|ml|l)?(?![^\W\d_])\.?', re.IGNORECASE)


def _size_free_key(name: str) -> str:
    """"Доматен сос 1кг" and "Доматен сос 5кг" -> one key: the same
    product in two pack sizes."""
    return _compare_key(_SIZE_TOKEN.sub(' ', name or ""))


# Past this many of its own cycles without a purchase, an item has far more
# likely been dropped than forgotten: it stops being "time to reorder" and
# becomes the question "do you still buy it?" (see reorder_overview).
STALE_CADENCE_CYCLES = 4
# A gap this many times the item's usual one is a pause (an off-season, a
# closure), not part of its rhythm.
PAUSE_GAP_FACTOR = 4


async def _revenue_trend_ratio(company_id: str, window_days: int) -> float:
    """Recent-half vs. earlier-half average daily revenue (fiscal_revenue +
    pocket_money), over a window sized to match an item's own observed
    purchase history - the same "business has gotten busier/quieter
    lately" read a human restocking by feel already does before deciding
    how much to reorder (notice the trend, then scale the usual quantity
    proportionally), just computed from data already captured instead of
    eyeballed. Entirely generic - one company-wide number, not derived
    from any single item, so this works the same whatever the item or
    business is.

    Each half is averaged over the days that have revenue LOGGED - a day
    nobody entered is unknown, not a zero-revenue day, so a few forgotten
    entries in one half no longer read as the business slowing down.
    Today is left out (it isn't over).

    Clamped to [0.4, 2.5]: a near-zero-revenue half (a closure, a data
    gap) could otherwise send a recommendation to zero or multiply it
    absurdly, and falls back to a neutral 1.0 (no adjustment) whenever
    either half has no revenue data at all to compare."""
    today = today_local()
    half = max(window_days // 2, 3)
    recent_start = (today - timedelta(days=half)).isoformat()
    earlier_start = (today - timedelta(days=half * 2)).isoformat()

    # The whole company's revenue - the same records /statistics/summary
    # counts (company_data_scope), on the business's own calendar.
    revenues = await server.db.daily_revenue.find(
        {**await company_data_scope(company_id), "date": {"$gte": earlier_start, "$lt": today.isoformat()}},
        {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1},
    ).to_list(ALL_ROWS)

    recent_total = 0.0
    earlier_total = 0.0
    recent_days: set = set()
    earlier_days: set = set()
    for r in revenues:
        date_str = r.get("date")
        if not isinstance(date_str, str):
            continue
        amount = r.get("fiscal_revenue", 0) + r.get("pocket_money", 0)
        if date_str >= recent_start:
            recent_total += amount
            recent_days.add(date_str)
        else:
            earlier_total += amount
            earlier_days.add(date_str)

    if earlier_total <= 0 or recent_total <= 0:
        return 1.0
    ratio = (recent_total / len(recent_days)) / (earlier_total / len(earlier_days))
    return max(0.4, min(2.5, ratio))


async def _compute_recurring_item_cadences(company_id: str) -> List[dict]:
    """Shared by get_reorder_nudges (overdue-only, ranked) and
    get_reorder_recommendations (every recurring item, a standing
    reference) - everything about an item's purchase pattern that doesn't
    depend on which of those two views is asking: its canonical name/
    merged suppliers, usual cadence, and a trend-adjusted suggested
    reorder quantity. One formula, no per-item or per-business special
    casing, since this ships to thousands of companies with completely
    different products.

    Module 5 audit finding (the cadence half): scanned purchase history
    already encodes a recurring item's typical reorder cadence - the gap
    between consecutive invoice_dates for the same item, entirely
    derivable from data already captured by scanning invoices. Deliberately
    NOT stock/inventory tracking (no on-hand quantities, no "run out at X
    units" math) - it only notices a pattern in purchase timing and
    timing-scaled quantity, the same way a human assistant would."""
    from collections import defaultdict

    # Same canonical-name merge mappings get_merged_item_statistics already
    # applies - without this, two invoices for the exact same physical
    # product that scanned to slightly different item_name text (an OCR
    # variant close enough for a human but that normalize_item_name's
    # write-time fuzzy match (88% similarity) didn't catch, later merged
    # by hand via AI-merge for the Statistics view) land in separate groups
    # below: the old group's last purchase date never advances again, so
    # it reports as "overdue" indefinitely even while the same item keeps
    # getting bought and scanned, just under its newer/merged name. Also
    # drops supplier from the grouping key (same as get_merged_item_
    # statistics) rather than requiring an exact match on that too - a
    # supplier's own name varying slightly invoice to invoice (or a
    # genuine backup supplier for the same product) used to split an
    # otherwise-consistent cadence the same way.
    mappings = await server.db.item_merge_mappings.find(
        {"company_id": company_id}, {"_id": 0}
    ).to_list(1000)
    # Size-safe: a stored mapping that folded "1кг" into "5кг" (written
    # before merges checked sizes) is ignored for that variant.
    variant_to_canonical, canonical_display = build_variant_to_canonical(mappings)
    # Items the owner said they no longer buy - left out until bought again.
    discontinued = {
        p["item_key"]: _aware(p["discontinued_at"])
        for p in await server.db.item_preferences.find(
            {"company_id": company_id, "discontinued_at": {"$ne": None}},
            {"_id": 0, "item_key": 1, "discontinued_at": 1},
        ).to_list(1000)
        if isinstance(p.get("discontinued_at"), datetime)
    }

    records = await server.db.item_price_history.find(
        {"company_id": company_id},
        {"_id": 0, "item_name": 1, "supplier": 1, "invoice_date": 1, "unit_price": 1, "quantity": 1, "unit": 1},
    ).to_list(10000)

    groups = defaultdict(list)
    suppliers_by_item: Dict[str, set] = defaultdict(set)
    # The exact original item_name casing/text to show for a canonical key
    # that ISN'T an AI-merge target (canonical_display only covers merged
    # ones) - mirrors get_merged_item_statistics's own "display =
    # original_name" fallback, rather than title-casing the lowercase
    # canonical key itself, which would alter unmerged names cosmetically
    # for no reason.
    original_name_by_canonical: Dict[str, str] = {}
    unit_by_canonical: Dict[str, str] = {}
    first_seen: Dict[str, datetime] = {}
    for r in records:
        date = r.get("invoice_date")
        if not isinstance(date, datetime):
            continue
        name_lower = r["item_name"].lower()
        canonical = variant_to_canonical.get(name_lower, name_lower)
        aware_date = _aware(date)
        if canonical not in first_seen or aware_date < first_seen[canonical]:
            first_seen[canonical] = aware_date
        groups[canonical].append((date, r.get("unit_price", 0) * r.get("quantity", 0), r.get("quantity", 0)))
        suppliers_by_item[canonical].add(r["supplier"])
        original_name_by_canonical[canonical] = r["item_name"]
        if r.get("unit"):
            unit_by_canonical[canonical] = r["unit"]

    # Pack sizes of one product, so a switch from one size to another reads
    # as a switch - not as the old size being "overdue" for ever.
    sizes_of_product: Dict[str, List[str]] = defaultdict(list)
    for canonical in first_seen:
        if item_size_signature(canonical):
            sizes_of_product[_size_free_key(canonical)].append(canonical)

    now = datetime.now(timezone.utc)
    items = []
    for canonical, entries in groups.items():
        # Several invoices for the same item on one day (a top-up order, a
        # second supplier, a re-scanned invoice) are ONE purchase event for
        # cadence purposes: summed per calendar day. Previously the 0-day
        # gap they produced dropped the item from reorder suggestions
        # altogether - the most-bought items were the likeliest to vanish.
        by_day: Dict[Any, list] = {}
        for d, amount, qty in entries:
            d = d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d
            day_entry = by_day.get(d.date())
            if day_entry is None:
                by_day[d.date()] = [d, amount, qty]
            else:
                day_entry[1] += amount
                day_entry[2] += qty
        if len(by_day) < MIN_PURCHASES_FOR_CADENCE:
            continue
        entries_sorted = sorted((tuple(v) for v in by_day.values()), key=lambda e: e[0])
        dates_sorted = [e[0] for e in entries_sorted]
        all_gaps = [(dates_sorted[i + 1].date() - dates_sorted[i].date()).days for i in range(len(dates_sorted) - 1)]
        # Pauses (an off-season, a closure) are left out of the rhythm:
        # one summer break used to make a weekly item "irregular" for good,
        # so a seasonal business lost its reorder suggestions every season.
        typical_gap = statistics.median(all_gaps)
        gaps = [g for g in all_gaps if g <= PAUSE_GAP_FACTOR * typical_gap]
        pauses = len(all_gaps) - len(gaps)
        if len(gaps) < MIN_PURCHASES_FOR_CADENCE - 1:
            continue
        median_gap = statistics.median(gaps)
        mean_gap = statistics.mean(gaps)
        if median_gap <= 0 or mean_gap <= 0:
            continue
        # Coefficient of variation - too irregular a pattern (a one-off
        # bulk order mixed with ad-hoc purchases) isn't a "usual" cadence
        # worth nudging about, even with enough purchase COUNT.
        stdev_gap = statistics.stdev(gaps) if len(gaps) > 1 else 0
        if (stdev_gap / mean_gap) > 0.6:
            continue

        last_date = dates_sorted[-1]
        stopped_at = discontinued.get(canonical)
        if stopped_at and last_date <= stopped_at:
            continue
        # Replaced by another size of the same product, first bought after
        # this size's last purchase (1 kg tins -> 5 kg tins).
        if item_size_signature(canonical) and any(
            other != canonical and first_seen[other] > last_date
            for other in sizes_of_product.get(_size_free_key(canonical), [])
        ):
            continue
        days_since_last = (now - last_date).days
        avg_order_value = statistics.mean(amount for _, amount, _ in entries_sorted)
        overdue_ratio = days_since_last / median_gap

        # Recommended quantity: this item's own trailing per-day purchase
        # rate (total quantity over the whole observed window, so it's
        # blended across whatever conditions actually occurred - not just
        # the last order), scaled by the company-wide revenue trend over a
        # matching window, then projected across one full cadence cycle.
        # A pause counts as one ordinary cycle (the purchase before it
        # lasted about that long), not as months of consumption.
        window_days = max(sum(gaps) + pauses * round(median_gap), round(median_gap))
        total_quantity = sum(qty for _, _, qty in entries_sorted)
        baseline_daily_quantity = total_quantity / window_days if window_days > 0 else 0
        trend_ratio = await _revenue_trend_ratio(company_id, window_days)
        recommended_quantity = round(max(baseline_daily_quantity * trend_ratio * median_gap, 0))

        suppliers = suppliers_by_item[canonical]
        supplier_display = (
            next(iter(suppliers)) if len(suppliers) == 1
            else f"{len(suppliers)} доставчика"
        )
        items.append({
            "item_name": canonical_display.get(canonical, original_name_by_canonical[canonical]),
            "supplier": supplier_display,
            "unit": unit_by_canonical.get(canonical, "бр"),
            "median_days_between": round(median_gap),
            "days_since_last": days_since_last,
            "last_purchase_date": last_date.strftime("%Y-%m-%d"),
            "avg_order_value": round(avg_order_value, 2),
            "recommended_quantity": recommended_quantity,
            "trend_ratio": round(trend_ratio, 2),
            "is_overdue": days_since_last > median_gap * 1.5,
            "is_stale": overdue_ratio > STALE_CADENCE_CYCLES,
            # Stable identity of the (merged) item, for "no longer bought"
            "item_key": canonical,
            # Not returned from either endpoint - ranking helpers only.
            "_overdue_ratio": overdue_ratio,
            # Capped: past 4 cycles "more overdue" stops meaning "more
            # urgent" - it usually means the item was dropped - so a long
            # gone item can't outrank a live one forever.
            "_impact_score": min(overdue_ratio, 4.0) * (avg_order_value if avg_order_value > 0 else 1.0),
        })
    return items


@router.get("/items/reorder-nudges")
async def get_reorder_nudges(current_user: User = Depends(get_current_user)):
    """The alert half: only items that are actually overdue right now,
    ranked most business-significant first - see
    _compute_recurring_item_cadences for the shared cadence/recommendation
    maths, and get_reorder_recommendations for the standing (not just
    overdue) view of the same data."""
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"nudges": []}

    nudges, _stale = await reorder_overview(company_id)
    return {"nudges": nudges[:10]}


async def reorder_overview(company_id: str) -> tuple:
    """(nudges, stale) from one cadence computation. nudges: overdue items
    still within STALE_CADENCE_CYCLES of their cycle, most business-
    significant first - how overdue relative to its own cadence, weighted
    by what reordering it is usually worth, so a rarely-bought bulk
    ingredient genuinely worth flagging outranks an equally-overdue but
    economically trivial one. stale: items past that, costliest first -
    most likely dropped, so they are asked about instead of nagged about
    for ever (a dropped item used to stay "time to reorder" indefinitely)."""
    items = await _compute_recurring_item_cadences(company_id)
    nudges = [n for n in items if n["is_overdue"] and not n["is_stale"]]
    nudges.sort(key=lambda n: n["_impact_score"], reverse=True)
    stale = [n for n in items if n["is_stale"]]
    stale.sort(key=lambda n: n["avg_order_value"], reverse=True)
    for n in nudges + stale:
        for private in ("_impact_score", "_overdue_ratio", "is_overdue", "is_stale"):
            n.pop(private, None)
    return nudges, stale


@router.get("/items/reorder-recommendations")
async def get_reorder_recommendations(current_user: User = Depends(get_current_user)):
    """A standing ordering assistant, not an alert - every recurring item
    with an established cadence (whether or not it's currently overdue),
    each with a recommended order quantity for its next cycle: this item's
    own trailing per-day purchase rate, scaled by how the company's
    overall revenue trend compares between a recent window and the one
    before it (the same reasoning anyone restocking manually already
    applies - "business is down/up ~X% lately, so order proportionally
    less/more" - just computed from data already captured by scanning,
    instead of guessed by feel). Entirely generic: no item or business is
    special-cased, so the exact same formula produces a sensible answer
    for a döner shop's pita bags, a hair salon's color tubes, or a
    hardware store's screws.

    Deliberately NOT stock/inventory tracking (same caveat as
    get_reorder_nudges) - no on-hand quantity is known, so this is a
    starting point for a standing order size, not a precise reorder-point
    calculation. Sorted soonest-due first (closest to its own cadence
    threshold, even if not past it yet), so the list itself prioritizes
    without the caller needing to."""
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"items": []}

    items = await _compute_recurring_item_cadences(company_id)
    items.sort(key=lambda n: n["_overdue_ratio"], reverse=True)
    for n in items:
        del n["_impact_score"]
        del n["_overdue_ratio"]
    return {"items": items}

@router.post("/items/ai-merge")
@limiter.limit("10/minute")
async def ai_merge_similar_items(
    request: Request,
    current_user: User = Depends(get_current_user)
):
    # Gated on view_statistics, same as the rest of the statistics suite -
    # this is a paid AI call that overwrites company-wide merge mappings
    # everyone's item stats rely on, not something any authenticated member
    # should be able to trigger regardless of their actual permissions.
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)

    if not company_id:
        return {"merged_groups": [], "total_merged": 0}

    try:
        return await run_ai_item_merge(company_id)
    except Exception as e:
        raise ai_exception_to_http(e, "AI item merge error")

# ===================== CATALOG: SAME / DIFFERENT =====================
# The owner's own word on what is one product: "same" joins two names (a
# misspelling the automatic matching missed), "different" splits a wrong
# join and keeps the two apart for good - in write-time matching, saved
# merges and the AI grouping alike. Different pack sizes are never "same":
# they are compared per kg / l / piece instead (see _other_sizes).

class CatalogPair(BaseModel):
    item_name: str = Field(min_length=1, max_length=300)
    other_name: str = Field(min_length=1, max_length=300)


def _clean_item(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


async def _mapping_containing(company_id: str, name: str) -> Optional[dict]:
    return await server.db.item_merge_mappings.find_one(
        {"company_id": company_id, "$or": [{"canonical_name": name}, {"variants": name}]}, {"_id": 0}
    )


@router.get("/items/catalog/related")
async def get_related_items(item_name: str, current_user: User = Depends(get_current_user)):
    """Names joined with this item, and unjoined look-alikes of the same
    size the owner may want to call the same product."""
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)
    name = _clean_item(item_name)
    if not company_id or not name:
        return {"item_name": name, "merged_with": [], "similar": []}
    mapping = await _mapping_containing(company_id, name)
    group = (set(mapping.get("variants") or []) | {mapping["canonical_name"]}) if mapping else {name}
    distinct = await item_distinct_names(company_id, name)
    signature = item_size_signature(name)
    key = _compare_key(name)
    similar = []
    for other in await server.db.item_price_history.distinct("item_name", {"company_id": company_id}):
        if other in group or other in distinct or item_size_signature(other) != signature:
            continue
        score = _similarity(_compare_key(other), key)
        if score >= 0.72:
            similar.append({"item_name": other, "similarity": round(score, 2)})
    similar.sort(key=lambda x: x["similarity"], reverse=True)
    return {
        "item_name": name,
        "merged_with": sorted(group - {name}),
        "similar": similar[:8],
        "different_from": sorted(distinct),
    }


@router.post("/items/catalog/same")
async def mark_items_same(body: CatalogPair, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    a, b = _clean_item(body.item_name), _clean_item(body.other_name)
    if a == b:
        raise HTTPException(status_code=400, detail="Това е едно и също име")
    if item_size_signature(a) != item_size_signature(b):
        raise HTTPException(
            status_code=400,
            detail="Различни разфасовки не се обединяват - сравни ги по цена за кг, л или брой.",
        )
    mapping_a = await _mapping_containing(company_id, a)
    mapping_b = await _mapping_containing(company_id, b)
    base = mapping_a or mapping_b
    canonical = base["canonical_name"] if base else a
    variants = {a, b, canonical}
    for m in (mapping_a, mapping_b):
        if m:
            variants |= set(m.get("variants") or []) | {m["canonical_name"]}
    if mapping_a and mapping_b and mapping_a["canonical_name"] != mapping_b["canonical_name"]:
        await server.db.item_merge_mappings.delete_one(
            {"company_id": company_id, "canonical_name": mapping_b["canonical_name"]}
        )
    await server.db.item_merge_mappings.update_one(
        {"company_id": company_id, "canonical_name": canonical},
        {"$set": {
            "company_id": company_id, "canonical_name": canonical,
            "display_name": (base or {}).get("display_name") or body.item_name.strip(),
            "variants": sorted(variants), "source": "owner", "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    await server.db.item_distinctions.delete_many({"company_id": company_id, "a": min(a, b), "b": max(a, b)})
    # Earlier purchases of the two names become one history too (stats,
    # price baseline, reorder rhythm). Each row keeps its printed name, so
    # a later "different" can put it back.
    moved = 0
    rows = await server.db.item_price_history.find(
        {"company_id": company_id, "item_name": {"$in": sorted({a, b} - {canonical})}},
        {"_id": 1, "item_name": 1, "raw_name": 1},
    ).to_list(20000)
    for row in rows:
        update = {"item_name": canonical}
        if not row.get("raw_name"):
            update["raw_name"] = row["item_name"]
        await server.db.item_price_history.update_one({"_id": row["_id"]}, {"$set": update})
        moved += 1
    return {"canonical_name": canonical, "variants": sorted(variants), "rows_moved": moved}


@router.post("/items/catalog/different")
async def mark_items_different(body: CatalogPair, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    a, b = _clean_item(body.item_name), _clean_item(body.other_name)
    if a == b:
        raise HTTPException(status_code=400, detail="Това е едно и също име")
    mapping = await _mapping_containing(company_id, a)
    if mapping and b in set(mapping.get("variants") or []) | {mapping["canonical_name"]}:
        dropped = b if mapping["canonical_name"] != b else a
        remaining = [v for v in mapping.get("variants") or [] if v != dropped]
        if set(remaining) - {mapping["canonical_name"]}:
            await server.db.item_merge_mappings.update_one(
                {"company_id": company_id, "canonical_name": mapping["canonical_name"]},
                {"$set": {"variants": remaining, "updated_at": datetime.now(timezone.utc)}},
            )
        else:
            await server.db.item_merge_mappings.delete_one(
                {"company_id": company_id, "canonical_name": mapping["canonical_name"]}
            )
    await server.db.item_distinctions.update_one(
        {"company_id": company_id, "a": min(a, b), "b": max(a, b)},
        {"$set": {"company_id": company_id, "a": min(a, b), "b": max(a, b),
                  "created_by": current_user.user_id, "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    # Lines the write-time matching filed under the other name go back
    # under their own (only rows that kept their name as printed).
    moved = 0
    rows = await server.db.item_price_history.find(
        {"company_id": company_id, "item_name": {"$in": [a, b]}, "raw_name": {"$ne": None}},
        {"_id": 1, "item_name": 1, "raw_name": 1},
    ).to_list(20000)
    for row in rows:
        own = _clean_item(row.get("raw_name") or "")
        if own in (a, b) and own != row["item_name"]:
            await server.db.item_price_history.update_one({"_id": row["_id"]}, {"$set": {"item_name": own}})
            moved += 1
    return {"separated": True, "rows_moved": moved}


@router.get("/items/merge-mappings")
async def get_merge_mappings(current_user: User = Depends(get_current_user)):
    """Връща текущите сливания на продукти"""
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        return {"mappings": []}
    
    mappings = await server.db.item_merge_mappings.find(
        {"company_id": company_id},
        {"_id": 0}
    ).to_list(1000)
    
    return {"mappings": mappings}

@router.delete("/items/merge-mappings/{canonical_name}")
async def delete_merge_mapping(
    canonical_name: str,
    current_user: User = Depends(get_current_user)
):
    """Изтрива сливане на продукти"""
    require_permission(current_user, "view_statistics")
    from urllib.parse import unquote

    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        raise HTTPException(status_code=404, detail="Фирмата не е намерена")
    
    result = await server.db.item_merge_mappings.delete_one({
        "company_id": company_id,
        "canonical_name": unquote(canonical_name).lower()
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Сливането не е намерено")
    
    return {"message": "Сливането е изтрито"}

@router.get("/statistics/items/merged")
async def get_merged_item_statistics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    top_n: int = 10,
    current_user: User = Depends(get_current_user)
):
    """
    Връща статистика за артикули с приложени AI сливания.
    Сходните продукти са обединени в една позиция.
    """
    require_permission(current_user, "view_statistics")
    from collections import defaultdict

    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        return {
            "totals": {"total_items": 0, "total_value": 0, "unique_items": 0, "merged_items": 0},
            "top_by_quantity": [],
            "top_by_value": [],
            "merge_applied": False
        }
    
    # Get merge mappings
    mappings = await server.db.item_merge_mappings.find(
        {"company_id": company_id},
        {"_id": 0}
    ).to_list(1000)
    
    # Variant -> canonical, skipping any stored variant of a different size
    variant_to_canonical, canonical_display = build_variant_to_canonical(mappings)

    # Build date query
    query = {"company_id": company_id}
    if start_date or end_date:
        # The same business days as every other module (services/business_calendar).
        try:
            query["invoice_date"] = Period.parse(start_date, end_date).datetime_filter()
        except ValueError:
            raise HTTPException(status_code=400, detail="Невалиден период")

    # Get all price history records
    history = await server.db.item_price_history.find(
        query,
        {"_id": 0, "item_name": 1, "supplier": 1, "invoice_date": 1, "unit_price": 1, "quantity": 1, "unit": 1},
    ).to_list(10000)

    if not history:
        return {
            "totals": {"total_items": 0, "total_value": 0, "unique_items": 0, "merged_items": 0},
            "top_by_quantity": [],
            "top_by_value": [],
            "merge_applied": bool(mappings)
        }
    
    # Aggregate with merging
    item_stats: Dict[str, Any] = defaultdict(lambda: {
        "display_name": "",
        "unit": "бр.",
        "quantity": 0,
        "total_value": 0,
        "frequency": 0,
        "prices": [],
        "suppliers": set(),
        "original_names": set()
    })
    
    merged_count = 0
    for record in history:
        original_name = record["item_name"]
        name_lower = original_name.lower()
        
        # Apply merge mapping
        if name_lower in variant_to_canonical:
            canonical = variant_to_canonical[name_lower]
            display = canonical_display.get(canonical, canonical.title())
            merged_count += 1
        else:
            canonical = name_lower
            display = original_name
        
        price = record["unit_price"]
        qty = record["quantity"]
        
        item_stats[canonical]["display_name"] = display
        if record.get("unit"):
            item_stats[canonical]["unit"] = record["unit"]
        item_stats[canonical]["quantity"] += qty
        item_stats[canonical]["total_value"] += price * qty
        item_stats[canonical]["frequency"] += 1
        item_stats[canonical]["prices"].append(price)
        item_stats[canonical]["suppliers"].add(record["supplier"])
        item_stats[canonical]["original_names"].add(original_name)
    
    # Calculate totals
    total_items = sum(s["frequency"] for s in item_stats.values())
    total_value = sum(s["total_value"] for s in item_stats.values())
    unique_items = len(item_stats)
    
    # Build top lists
    items_list = []
    for canonical, stats in item_stats.items():
        prices = stats["prices"]
        avg_price = sum(prices) / len(prices) if prices else 0
        
        items_list.append({
            "name": stats["display_name"],
            "canonical_name": canonical,
            "unit": stats["unit"],
            "total_quantity": round(stats["quantity"], 2),
            "total_value": round(stats["total_value"], 2),
            "frequency": stats["frequency"],
            "avg_price": round(avg_price, 2),
            "supplier_count": len(stats["suppliers"]),
            "original_names": list(stats["original_names"])[:5]  # Show max 5 variants
        })
    
    # Sort for top lists
    top_by_quantity = sorted(items_list, key=lambda x: x["total_quantity"], reverse=True)[:top_n]
    top_by_value = sorted(items_list, key=lambda x: x["total_value"], reverse=True)[:top_n]
    
    return {
        "totals": {
            "total_items": total_items,
            "total_value": round(total_value, 2),
            "unique_items": unique_items,
            "merged_items": merged_count
        },
        "top_by_quantity": top_by_quantity,
        "top_by_value": top_by_value,
        "merge_applied": bool(mappings),
        "merge_groups_count": len(mappings)
    }

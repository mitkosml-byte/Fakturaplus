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
import server

router = APIRouter(prefix="/api")

@router.get("/items/price-alerts")
async def get_price_alerts(
    status: Optional[str] = None,  # unread, read, dismissed
    invoice_id: Optional[str] = None,  # за показване на конкретна фактура кои артикули са с повишена цена
    current_user: User = Depends(get_current_user)
):
    """Връща ценови аларми за фирмата"""
    # Deliberately NOT gated on view_statistics - invoices.tsx calls this
    # per-invoice (with invoice_id set) to show "+X% vs last purchase"
    # badges on line items for ANY user who can view that invoice, not
    # just users with the advanced-statistics permission.
    company_id, scope = await get_company_scope(current_user)

    if not company_id:
        return {"alerts": [], "total": 0, "unread_count": 0}

    query = dict(scope)
    if status:
        query["status"] = status
    if invoice_id:
        query["invoice_id"] = invoice_id

    alerts = await server.db.price_alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)

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
    
    defaults = {"threshold_percent": 10.0, "min_absolute_change": 2.0, "alert_on_decrease": False, "enabled": True}
    if not company_id:
        return defaults

    settings = await server.db.price_alert_settings.find_one({"company_id": company_id}, {"_id": 0})

    if not settings:
        return defaults

    return {
        "threshold_percent": settings.get("threshold_percent", 10.0),
        "min_absolute_change": settings.get("min_absolute_change", 2.0),
        "alert_on_decrease": settings.get("alert_on_decrease", False),
        "enabled": settings.get("enabled", True)
    }

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
    if "min_absolute_change" in body:
        update_data["min_absolute_change"] = float(body["min_absolute_change"])
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
    
    history = await server.db.item_price_history.find(query, {"_id": 0}).sort("invoice_date", 1).to_list(1000)
    
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
        formatted_history.append({
            "date": date_str,
            "supplier": h.get("supplier"),
            "unit_price": h.get("unit_price"),
            "quantity": h.get("quantity"),
            "unit": h.get("unit"),
            "invoice_number": h.get("invoice_number")
        })
    
    return {
        "item_name": item_name,
        "history": formatted_history,
        "statistics": {
            "avg_price": round(avg_price, 2),
            "min_price": round(min_price, 2),
            "max_price": round(max_price, 2),
            "std_dev": round(std_dev, 2),
            "trend_percent": round(trend_percent, 1),
            "total_records": len(history)
        }
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
        query["invoice_date"] = {}
        if start_date:
            query["invoice_date"]["$gte"] = datetime.fromisoformat(start_date + "T00:00:00+00:00")
        if end_date:
            query["invoice_date"]["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    # Get all price history records
    history = await server.db.item_price_history.find(query, {"_id": 0}).to_list(10000)
    
    if not history:
        return {
            "totals": {"total_items": 0, "total_value": 0, "unique_items": 0},
            "top_by_quantity": [],
            "top_by_value": [],
            "top_by_frequency": [],
            "price_trends": []
        }
    
    # Aggregate by item
    item_stats: Dict[str, Any] = defaultdict(lambda: {
        "quantity": 0,
        "total_value": 0,
        "frequency": 0,
        "prices": [],
        "suppliers": set()
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
        
        items_list.append({
            "item_name": name,
            "quantity": round(stats["quantity"], 2),
            "total_value": round(stats["total_value"], 2),
            "frequency": stats["frequency"],
            "avg_price": round(avg_price, 2),
            "min_price": round(min(prices), 2) if prices else 0,
            "max_price": round(max(prices), 2) if prices else 0,
            "price_variance": round(price_variance, 1),
            "trend_percent": round(trend, 1),
            "supplier_count": len(stats["suppliers"])
        })
    
    # Sort by different criteria
    top_by_quantity = sorted(items_list, key=lambda x: x["quantity"], reverse=True)[:top_n]
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
        "top_by_quantity": top_by_quantity,
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
        "invoice_date": {
            "$gte": datetime.fromisoformat(start_date + "T00:00:00+00:00"),
            "$lte": datetime.fromisoformat(end_date + "T23:59:59+00:00"),
        },
    }
    history = await server.db.item_price_history.find(query, {"_id": 0}).sort("invoice_date", 1).to_list(10000)
    if not history:
        return empty_response

    by_item = defaultdict(list)
    for record in history:
        by_item[record["item_name"]].append(record)

    items_result = []
    for item_name, records in by_item.items():
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
    supplier_data: Dict[str, Any] = defaultdict(lambda: {"prices": [], "quantities": [], "dates": []})
    
    for record in history:
        supplier = record["supplier"]
        supplier_data[supplier]["prices"].append(record["unit_price"])
        supplier_data[supplier]["quantities"].append(record["quantity"])
        date_val = record.get("invoice_date")
        if isinstance(date_val, datetime):
            supplier_data[supplier]["dates"].append(date_val)
    
    # Calculate stats per supplier
    suppliers = []
    for supplier, data in supplier_data.items():
        prices = data["prices"]
        avg = sum(prices) / len(prices) if prices else 0
        last_date = max(data["dates"]) if data["dates"] else None
        
        suppliers.append({
            "supplier": supplier,
            "avg_price": round(avg, 2),
            "min_price": round(min(prices), 2) if prices else 0,
            "max_price": round(max(prices), 2) if prices else 0,
            "last_price": round(prices[-1], 2) if prices else 0,
            "purchase_count": len(prices),
            "total_quantity": round(sum(data["quantities"]), 2),
            "last_purchase": last_date.strftime("%Y-%m-%d") if last_date else None
        })
    
    # Sort by average price (cheapest first)
    suppliers.sort(key=lambda x: x["avg_price"])
    
    # Recommendation
    recommendation = None
    if len(suppliers) >= 2:
        cheapest = suppliers[0]
        most_expensive = suppliers[-1]
        if cheapest["avg_price"] > 0:
            savings_percent = ((most_expensive["avg_price"] - cheapest["avg_price"]) / most_expensive["avg_price"] * 100)
            if savings_percent > 5:
                recommendation = {
                    "best_supplier": cheapest["supplier"],
                    "avg_price": cheapest["avg_price"],
                    "potential_savings_percent": round(savings_percent, 1)
                }
    
    return {
        "item_name": item_name,
        "suppliers": suppliers,
        "recommendation": recommendation
    }

@router.get("/items/reorder-nudges")
async def get_reorder_nudges(current_user: User = Depends(get_current_user)):
    """Module 5 audit finding: scanned purchase history already encodes a
    recurring item's typical reorder cadence - the gap between consecutive
    invoice_dates for the same item/supplier, entirely derivable from data
    already captured by scanning invoices. Deliberately NOT stock/
    inventory tracking (no on-hand quantities, no "run out at X units"
    math) - it only notices a pattern in purchase timing and asks the
    question a human assistant would: "it's been longer than usual since
    you last bought X - still good on it?" """
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"nudges": []}

    from collections import defaultdict

    records = await server.db.item_price_history.find(
        {"company_id": company_id},
        {"_id": 0, "item_name": 1, "supplier": 1, "invoice_date": 1, "unit_price": 1, "quantity": 1},
    ).to_list(10000)

    groups = defaultdict(list)
    for r in records:
        date = r.get("invoice_date")
        if isinstance(date, datetime):
            groups[(r["item_name"], r["supplier"])].append(
                (date, r.get("unit_price", 0) * r.get("quantity", 0))
            )

    now = datetime.now(timezone.utc)
    nudges = []
    # Needs at least 4 purchases to call anything a "usual" cadence -
    # same minimum-sample-size reasoning as ForecastService's trend gate.
    MIN_PURCHASES_FOR_CADENCE = 4
    for (item_name, supplier), entries in groups.items():
        if len(entries) < MIN_PURCHASES_FOR_CADENCE:
            continue
        entries_sorted = sorted(
            ((d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d, amount) for d, amount in entries),
            key=lambda e: e[0],
        )
        dates_sorted = [e[0] for e in entries_sorted]
        gaps = [(dates_sorted[i + 1] - dates_sorted[i]).days for i in range(len(dates_sorted) - 1)]
        if any(g <= 0 for g in gaps):
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
        days_since_last = (now - last_date).days
        if days_since_last > median_gap * 1.5:
            avg_order_value = statistics.mean(amount for _, amount in entries_sorted)
            overdue_ratio = days_since_last / median_gap
            nudges.append({
                "item_name": item_name,
                "supplier": supplier,
                "median_days_between": round(median_gap),
                "days_since_last": days_since_last,
                "last_purchase_date": last_date.strftime("%Y-%m-%d"),
                "avg_order_value": round(avg_order_value, 2),
                # Not returned - only used to rank below. How overdue
                # (as a multiple of its own usual cadence, not raw days -
                # a weekly item twice as late matters more than a
                # quarterly item a few days late) combined with how much
                # this item usually costs to reorder, so a rarely-bought
                # bulk ingredient genuinely worth flagging outranks an
                # equally-overdue but economically trivial one instead of
                # whichever happens to have the larger raw day gap.
                "_impact_score": overdue_ratio * (avg_order_value if avg_order_value > 0 else 1.0),
            })

    # Most business-significant first: how overdue relative to its own
    # cadence, weighted by what reordering it is usually worth - see
    # _impact_score above.
    nudges.sort(key=lambda n: n["_impact_score"], reverse=True)
    for n in nudges:
        del n["_impact_score"]
    return {"nudges": nudges[:10]}

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
    
    # Create variant to canonical mapping
    variant_to_canonical = {}
    canonical_display = {}
    for m in mappings:
        canonical = m["canonical_name"]
        canonical_display[canonical] = m.get("display_name", canonical)
        for variant in m.get("variants", []):
            variant_to_canonical[variant.lower()] = canonical
    
    # Build date query
    query = {"company_id": company_id}
    if start_date or end_date:
        query["invoice_date"] = {}
        if start_date:
            query["invoice_date"]["$gte"] = datetime.fromisoformat(start_date + "T00:00:00+00:00")
        if end_date:
            query["invoice_date"]["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    # Get all price history records
    history = await server.db.item_price_history.find(query, {"_id": 0}).to_list(10000)
    
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

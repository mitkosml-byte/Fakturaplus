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
    _profit_formula,
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

@router.get("/statistics/summary")
async def get_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_month_only: bool = True,  # Default to current month
    current_user: User = Depends(get_current_user)
):
    # If no dates provided and current_month_only is True, use current month
    if not start_date and not end_date and current_month_only:
        now = datetime.now(timezone.utc)
        start_date = now.replace(day=1).strftime("%Y-%m-%d")
        # Last day of the current month - NOT the first day of the next one.
        # Every query built from date_query/end_date below treats end_date as
        # an INCLUSIVE boundary ($lte, or the payroll/depreciation helper's
        # "not later than end_date"), so passing the 1st of next month here
        # would let a record dated exactly on the 1st (revenue, expense,
        # invoice, or a payroll/depreciation entry someone entered early)
        # leak into THIS month's summary as well as its own month's.
        if now.month == 12:
            last_day = now.replace(year=now.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            last_day = now.replace(month=now.month + 1, day=1) - timedelta(days=1)
        end_date = last_day.strftime("%Y-%m-%d")
    
    date_query = {}
    
    if start_date:
        date_query["$gte"] = start_date
    if end_date:
        date_query["$lte"] = end_date
    
    company_id, scope = await get_company_scope(current_user)

    # Get invoices
    inv_query = dict(scope)
    if start_date or end_date:
        inv_query["date"] = {}
        if start_date:
            inv_query["date"]["$gte"] = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        if end_date:
            inv_query["date"]["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))

    invoices = await server.db.invoices.find(inv_query, {"_id": 0, "total_amount": 1, "vat_amount": 1}).to_list(1000)

    # Outstanding payables (what's currently owed to suppliers) - always
    # company-wide, never scoped to the period filter above: an invoice from
    # two months ago that's still unpaid is still owed today, so it would be
    # misleading to only surface it while browsing that particular month.
    unpaid_query = {**scope, "payment_method": "bank_transfer", "is_paid": False}
    unpaid_invoices = await server.db.invoices.find(unpaid_query, {"_id": 0, "total_amount": 1, "paid_amount": 1, "payment_due_date": 1}).to_list(1000)
    now_ts = datetime.now(timezone.utc)
    # Mongo drivers hand back naive UTC datetimes by default (no tz_aware
    # flag set on the client), which can't be compared directly to an
    # aware datetime.now(timezone.utc) - same fix as the session-expiry
    # check above.
    def _is_overdue(inv):
        due = inv.get("payment_due_date")
        if not due:
            return False
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        return due < now_ts
    overdue_invoices = [inv for inv in unpaid_invoices if _is_overdue(inv)]

    # Get daily revenues
    rev_query = dict(scope)
    if date_query:
        rev_query["date"] = date_query
    revenues = await server.db.daily_revenue.find(rev_query, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1, "card_revenue": 1, "vat_rate_percent": 1}).to_list(1000)

    # Get expenses
    exp_query = dict(scope)
    if date_query:
        exp_query["date"] = date_query
    expenses = await server.db.expenses.find(exp_query, {"_id": 0, "amount": 1}).to_list(1000)

    # Get payroll cost (real employer cost: gross + employer contributions +
    # benefits), for the same period
    total_payroll_cost = await get_payroll_cost_for_period(company_id, current_user.user_id, start_date, end_date)

    # Get depreciation expense (ДМА) for the same period
    total_depreciation_expense = await get_depreciation_cost_for_period(company_id, current_user.user_id, start_date, end_date)

    # Calculate totals
    visibility = get_financial_visibility(current_user)
    total_invoice_amount = sum(inv.get("total_amount", 0) for inv in invoices)
    total_invoice_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_fiscal_revenue = sum(r.get("fiscal_revenue", 0) for r in revenues)
    total_pocket_money = sum(r.get("pocket_money", 0) for r in revenues)
    total_expenses = sum(e.get("amount", 0) for e in expenses)

    # Every aggregate below folds in the RAW pocket-money/off-book-expense
    # totals only when this viewer may see them - otherwise the "effective"
    # value used in every downstream sum is zero, so income/expense/profit/
    # the cash-card split all come out as a fully coherent analytical
    # picture for exactly the data this viewer's access includes, not the
    # real numbers with one line item merely blanked in the UI.
    effective_pocket_money = total_pocket_money if visibility["pocket_money"] else 0
    effective_off_book_expenses = total_expenses if visibility["off_book_expenses"] else 0

    # Card portion of the fiscalized revenue; everything else (the rest of
    # fiscal_revenue plus all of pocket_money, which is cash by definition)
    # counts as cash.
    total_card_revenue = sum(r.get("card_revenue", 0) for r in revenues)
    total_cash_revenue = total_fiscal_revenue - total_card_revenue + effective_pocket_money

    # The outstanding balance, not the invoice's full amount - a partially
    # paid invoice (paid_amount > 0 but < total_amount, still is_paid=False)
    # should only count what's actually still owed.
    total_unpaid_amount = sum(inv.get("total_amount", 0) - inv.get("paid_amount", 0) for inv in unpaid_invoices)
    total_overdue_amount = sum(inv.get("total_amount", 0) - inv.get("paid_amount", 0) for inv in overdue_invoices)

    # ДДС от фискализиран оборот - изчислено по действителната ставка на
    # всеки запис (20% стандартна, 9% намалена, 0% и т.н.), а не с фиксирано
    # предположение за 20% - важно за хотели/ресторанти/хлебарници и др.
    # Нито джобчето, нито разходите "в канала" влизат в ДДС, така че тази
    # сметка е еднаква за всеки зрител независимо от финансовата видимост.
    fiscal_vat = sum(
        r.get("fiscal_revenue", 0) * r.get("vat_rate_percent", 20.0) / (100 + r.get("vat_rate_percent", 20.0))
        for r in revenues
        if r.get("vat_rate_percent", 20.0) > 0
    )

    # Общ ДДС за плащане = ДДС от продажби - ДДС от покупки (фактури)
    vat_to_pay = fiscal_vat - total_invoice_vat

    # Общ приход/разход - единствената формула, споделена с
    # _compute_month_profit (server.py), за да не се разминат двете при
    # бъдеща промяна в едната.
    total_income, total_expense = _profit_formula(
        fiscal_revenue=total_fiscal_revenue, pocket_money=effective_pocket_money,
        invoice_total=total_invoice_amount, off_book_expenses=effective_off_book_expenses,
        payroll_cost=total_payroll_cost, depreciation_cost=total_depreciation_expense,
    )

    # Печалбата е независимо скриваема от съставните ѝ части - тя влиза или
    # излиза от отговора само по view_profit, макар вече да е изчислена
    # спрямо ефективните (не суровите) приход/разход по-горе.
    profit = round(total_income - total_expense, 2) if visibility["profit"] else None

    return {
        "total_invoice_amount": round(total_invoice_amount, 2),
        "total_invoice_vat": round(total_invoice_vat, 2),
        "total_fiscal_revenue": round(total_fiscal_revenue, 2),
        # None (not 0) when hidden, so the frontend can tell "genuinely
        # zero" apart from "you don't have access to this field".
        "total_pocket_money": round(total_pocket_money, 2) if visibility["pocket_money"] else None,
        "fiscal_vat": round(fiscal_vat, 2),
        "vat_to_pay": round(vat_to_pay, 2),
        "total_non_invoice_expenses": round(total_expenses, 2) if visibility["off_book_expenses"] else None,
        "total_payroll_cost": round(total_payroll_cost, 2),
        "total_depreciation_expense": round(total_depreciation_expense, 2),
        "total_income": round(total_income, 2),
        "total_expense": round(total_expense, 2),
        "profit": profit,
        "invoice_count": len(invoices),
        "total_cash_revenue": round(total_cash_revenue, 2),
        "total_card_revenue": round(total_card_revenue, 2),
        "total_unpaid_amount": round(total_unpaid_amount, 2),
        "unpaid_invoice_count": len(unpaid_invoices),
        "total_overdue_amount": round(total_overdue_amount, 2),
        "overdue_invoice_count": len(overdue_invoices),
        "financial_visibility": visibility,
    }

@router.get("/statistics/chart-data")
async def get_chart_data(
    period: str = "week",  # week, month, year
    current_user: User = Depends(get_current_user)
):
    now = datetime.now(timezone.utc)
    
    if period == "week":
        start = now - timedelta(days=7)
    elif period == "month":
        start = now - timedelta(days=30)
    else:
        start = now - timedelta(days=365)
    
    start_str = start.strftime("%Y-%m-%d")

    company_id, scope = await get_company_scope(current_user)
    closed_weekdays, exceptions_map = await get_closed_days_lookup(company_id)

    # Get data
    inv_query = {**scope, "date": {"$gte": start}}
    invoices = await server.db.invoices.find(inv_query, {"_id": 0, "date": 1, "total_amount": 1, "vat_amount": 1}).to_list(1000)

    rev_query = {**scope, "date": {"$gte": start_str}}
    revenues = await server.db.daily_revenue.find(rev_query, {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1, "vat_rate_percent": 1}).to_list(1000)

    exp_query = {**scope, "date": {"$gte": start_str}}
    expenses = await server.db.expenses.find(exp_query, {"_id": 0, "date": 1, "amount": 1}).to_list(1000)

    # Same cascade as get_summary: a hidden field's contribution is zeroed
    # out of the daily bars, not just omitted from a separate total, so the
    # chart itself stays a coherent picture for this viewer.
    visibility = get_financial_visibility(current_user)

    # Group by date
    from collections import defaultdict

    daily_data: Dict[str, Any] = defaultdict(lambda: {"income": 0, "expense": 0, "vat": 0})

    for inv in invoices:
        date_str = inv["date"].strftime("%Y-%m-%d") if isinstance(inv["date"], datetime) else inv["date"][:10]
        daily_data[date_str]["expense"] += inv.get("total_amount", 0)
        daily_data[date_str]["vat"] -= inv.get("vat_amount", 0)  # ДДС кредит

    for rev in revenues:
        date_str = rev["date"][:10] if isinstance(rev["date"], str) else rev["date"].strftime("%Y-%m-%d")
        pocket_money = rev.get("pocket_money", 0) if visibility["pocket_money"] else 0
        daily_data[date_str]["income"] += rev.get("fiscal_revenue", 0) + pocket_money
        rate = rev.get("vat_rate_percent", 20.0)
        if rate > 0:
            daily_data[date_str]["vat"] += rev.get("fiscal_revenue", 0) * rate / (100 + rate)  # ДДС от продажби

    if visibility["off_book_expenses"]:
        for exp in expenses:
            date_str = exp["date"][:10] if isinstance(exp["date"], str) else exp["date"].strftime("%Y-%m-%d")
            daily_data[date_str]["expense"] += exp.get("amount", 0)

    # Zero-fill every calendar day in the window - a day with no invoice/
    # revenue/expense record at all (a genuine closed day, but also just a
    # slow day with nothing entered) previously wouldn't appear in the chart
    # at all, silently shortening it. Touching daily_data[date_str] here
    # materializes it as a real 0/0/0 entry via the defaultdict.
    d = start.date()
    end_date = now.date()
    while d <= end_date:
        daily_data[d.strftime("%Y-%m-%d")]
        d += timedelta(days=1)

    # Convert to list sorted by date
    chart_data = []
    for date_str in sorted(daily_data.keys()):
        chart_data.append({
            "date": date_str,
            "label": date_str[5:],  # MM-DD
            "income": round(daily_data[date_str]["income"], 2),
            "expense": round(daily_data[date_str]["expense"], 2),
            "vat": round(daily_data[date_str]["vat"], 2),
            "is_closed": is_date_closed(date_str, closed_weekdays, exceptions_map),
        })

    return chart_data

@router.get("/statistics/suppliers")
async def get_supplier_statistics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get comprehensive supplier statistics with trends, alerts, and rankings"""
    require_permission(current_user, "view_statistics")
    from collections import defaultdict
    from datetime import timedelta

    # Unlike get_summary, this endpoint has no period selector in the UI -
    # the frontend always calls it with no dates, expecting an all-time
    # supplier-relationship overview (total/active/inactive suppliers, top-3
    # concentration). Defaulting to the current month here used to hide
    # every supplier with no invoices yet this month, making the whole tab
    # read as empty for any account between scans.
    now = datetime.now(timezone.utc)

    # Build query for current period
    _, query = await get_company_scope(current_user)
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = datetime.fromisoformat(start_date + "T00:00:00+00:00")
        if end_date:
            query["date"]["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")

    # Get all invoices for the period
    invoices = await server.db.invoices.find(query, {
        "_id": 0,
        "supplier": 1,
        "total_amount": 1,
        "vat_amount": 1,
        "amount_without_vat": 1,
        "date": 1
    }).to_list(10000)
    
    # Group by supplier with detailed data
    supplier_data: Dict[str, Any] = defaultdict(lambda: {
        "total_amount": 0,
        "total_vat": 0,
        "total_net": 0,
        "invoice_count": 0,
        "dates": [],
        "amounts": []
    })
    
    for inv in invoices:
        supplier = inv.get("supplier", "Неизвестен")
        amount = inv.get("total_amount", 0)
        supplier_data[supplier]["total_amount"] += amount
        supplier_data[supplier]["total_vat"] += inv.get("vat_amount", 0)
        supplier_data[supplier]["total_net"] += inv.get("amount_without_vat", 0)
        supplier_data[supplier]["invoice_count"] += 1
        
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            supplier_data[supplier]["dates"].append(date_val)
            supplier_data[supplier]["amounts"].append(amount)
    
    # Calculate inactivity threshold (30 days)
    inactivity_days = 30
    inactive_threshold = now - timedelta(days=inactivity_days)
    
    # Build comprehensive supplier list
    suppliers_list = []
    total_all = 0
    
    for supplier, data in supplier_data.items():
        total_all += data["total_amount"]
        
        # Calculate first/last delivery
        sorted_dates = sorted(data["dates"]) if data["dates"] else []
        first_delivery = sorted_dates[0] if sorted_dates else None
        last_delivery = sorted_dates[-1] if sorted_dates else None
        
        # Make dates timezone-aware if they aren't
        if last_delivery and last_delivery.tzinfo is None:
            last_delivery = last_delivery.replace(tzinfo=timezone.utc)
        if first_delivery and first_delivery.tzinfo is None:
            first_delivery = first_delivery.replace(tzinfo=timezone.utc)
        
        # Determine status
        is_active = last_delivery and last_delivery > inactive_threshold if last_delivery else False
        days_inactive = (now - last_delivery).days if last_delivery else 999
        
        # Calculate average
        avg = data["total_amount"] / data["invoice_count"] if data["invoice_count"] > 0 else 0
        
        # Calculate standard deviation for anomaly detection
        amounts = data["amounts"]
        if len(amounts) >= 2:
            mean_amount = sum(amounts) / len(amounts)
            variance = sum((x - mean_amount) ** 2 for x in amounts) / len(amounts)
            std_dev = variance ** 0.5
        else:
            mean_amount = avg
            std_dev = 0
        
        suppliers_list.append({
            "supplier": supplier,
            "total_amount": round(data["total_amount"], 2),
            "total_vat": round(data["total_vat"], 2),
            "total_net": round(data["total_net"], 2),
            "invoice_count": data["invoice_count"],
            "avg_invoice": round(avg, 2),
            "first_delivery": first_delivery.strftime("%Y-%m-%d") if first_delivery else None,
            "last_delivery": last_delivery.strftime("%Y-%m-%d") if last_delivery else None,
            "is_active": is_active,
            "days_inactive": days_inactive if not is_active else 0,
            "std_dev": round(std_dev, 2)
        })
    
    # Add dependency percentage
    for s in suppliers_list:
        s["dependency_percent"] = round((s["total_amount"] / total_all * 100), 1) if total_all > 0 else 0
    
    # Sort by total amount for TOP by amount
    top_by_amount = sorted(suppliers_list, key=lambda x: x["total_amount"], reverse=True)[:10]
    
    # TOP by frequency
    top_by_frequency = sorted(suppliers_list, key=lambda x: x["invoice_count"], reverse=True)[:10]
    
    # TOP by average invoice
    top_by_avg = sorted(suppliers_list, key=lambda x: x["avg_invoice"], reverse=True)[:10]
    
    # Inactive suppliers
    inactive_suppliers = [s for s in suppliers_list if not s["is_active"]]
    inactive_suppliers.sort(key=lambda x: x["days_inactive"], reverse=True)
    
    # High dependency alert (>30%)
    high_dependency = [s for s in suppliers_list if s["dependency_percent"] > 30]
    
    # Calculate totals
    total_vat = sum(s["total_vat"] for s in suppliers_list)
    total_net = sum(s["total_net"] for s in suppliers_list)
    total_invoices = sum(s["invoice_count"] for s in suppliers_list)
    
    # Executive summary
    top_3_concentration = sum(s["dependency_percent"] for s in top_by_amount[:3]) if len(top_by_amount) >= 3 else 0
    top_5_concentration = sum(s["dependency_percent"] for s in top_by_amount[:5]) if len(top_by_amount) >= 5 else 0
    
    return {
        "period": {
            "start_date": start_date,
            "end_date": end_date
        },
        "executive_summary": {
            "top_3_concentration": round(top_3_concentration, 1),
            "top_5_concentration": round(top_5_concentration, 1),
            "total_suppliers": len(suppliers_list),
            "active_suppliers": len([s for s in suppliers_list if s["is_active"]]),
            "inactive_suppliers": len(inactive_suppliers),
            "high_dependency_count": len(high_dependency),
            "largest_supplier": top_by_amount[0]["supplier"] if top_by_amount else None,
            "largest_amount": top_by_amount[0]["total_amount"] if top_by_amount else 0
        },
        "totals": {
            "total_amount": round(total_all, 2),
            "total_vat": round(total_vat, 2),
            "total_net": round(total_net, 2),
            "supplier_count": len(suppliers_list),
            "invoice_count": total_invoices
        },
        "top_by_amount": top_by_amount,
        "top_by_frequency": top_by_frequency,
        "top_by_avg": top_by_avg,
        "inactive_suppliers": inactive_suppliers[:10],
        "high_dependency_alerts": high_dependency,
        "all_suppliers": suppliers_list
    }

@router.get("/statistics/supplier/{supplier_name}/detailed")
async def get_detailed_supplier_stats(
    supplier_name: str,
    current_user: User = Depends(get_current_user)
):
    """Get detailed statistics for a specific supplier with trends"""
    require_permission(current_user, "view_statistics")
    from collections import defaultdict
    from urllib.parse import unquote

    supplier_name = unquote(supplier_name)

    # Get all invoices for this supplier (no date filter for full history)
    _, query = await get_company_scope(current_user)
    query["supplier"] = {"$regex": f"^{re.escape(supplier_name)}$", "$options": "i"}

    invoices = await server.db.invoices.find(query, {"_id": 0, "image_base64": 0, "image_base64s": 0}).sort("date", 1).to_list(10000)
    
    if not invoices:
        return {
            "supplier": supplier_name,
            "found": False,
            "invoice_count": 0
        }
    
    now = datetime.now(timezone.utc)
    
    # Basic stats
    total_amount = sum(inv.get("total_amount", 0) for inv in invoices)
    total_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_net = sum(inv.get("amount_without_vat", 0) for inv in invoices)
    avg_invoice = total_amount / len(invoices) if invoices else 0
    
    # Extract dates
    dates = []
    amounts = []
    for inv in invoices:
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            dates.append(date_val)
            amounts.append(inv.get("total_amount", 0))
    
    first_delivery = min(dates) if dates else None
    last_delivery = max(dates) if dates else None
    
    # Ensure timezone consistency for date calculations
    if last_delivery:
        if last_delivery.tzinfo is None:
            last_delivery = last_delivery.replace(tzinfo=timezone.utc)
        days_inactive = (now - last_delivery).days
    else:
        days_inactive = 999
    
    is_active = days_inactive <= 30
    
    # Monthly breakdown
    monthly_data: Dict[str, Any] = defaultdict(lambda: {"amount": 0, "count": 0})
    for inv in invoices:
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            month_key = date_val.strftime("%Y-%m")
            monthly_data[month_key]["amount"] += inv.get("total_amount", 0)
            monthly_data[month_key]["count"] += 1
    
    # Sort monthly data
    sorted_months = sorted(monthly_data.keys())
    monthly_trend = []
    prev_amount = 0
    for month in sorted_months[-12:]:  # Last 12 months
        data = monthly_data[month]
        growth = ((data["amount"] - prev_amount) / prev_amount * 100) if prev_amount > 0 else 0
        monthly_trend.append({
            "month": month,
            "amount": round(data["amount"], 2),
            "count": data["count"],
            "growth_percent": round(growth, 1)
        })
        prev_amount = data["amount"]
    
    # Calculate anomalies
    if len(amounts) >= 3:
        mean_amount = sum(amounts) / len(amounts)
        variance = sum((x - mean_amount) ** 2 for x in amounts) / len(amounts)
        std_dev = variance ** 0.5
        threshold = mean_amount + (2 * std_dev)
        
        anomalies = []
        for inv in invoices:
            if inv.get("total_amount", 0) > threshold:
                date_val = inv.get("date")
                date_str = date_val.strftime("%Y-%m-%d") if isinstance(date_val, datetime) else str(date_val)[:10]
                anomalies.append({
                    "date": date_str,
                    "amount": inv.get("total_amount", 0),
                    "invoice_number": inv.get("invoice_number"),
                    "deviation_percent": round((inv.get("total_amount", 0) - mean_amount) / mean_amount * 100, 1)
                })
    else:
        anomalies = []
    
    # Recent invoices
    recent_invoices = []
    for inv in invoices[-10:][::-1]:
        date_val = inv.get("date")
        date_str = date_val.strftime("%Y-%m-%d") if isinstance(date_val, datetime) else str(date_val)[:10]
        recent_invoices.append({
            "id": inv.get("id"),
            "invoice_number": inv.get("invoice_number"),
            "date": date_str,
            "total_amount": inv.get("total_amount", 0),
            "vat_amount": inv.get("vat_amount", 0)
        })
    
    return {
        "supplier": supplier_name,
        "found": True,
        "overview": {
            "total_amount": round(total_amount, 2),
            "total_vat": round(total_vat, 2),
            "total_net": round(total_net, 2),
            "invoice_count": len(invoices),
            "avg_invoice": round(avg_invoice, 2),
            "first_delivery": first_delivery.strftime("%Y-%m-%d") if first_delivery else None,
            "last_delivery": last_delivery.strftime("%Y-%m-%d") if last_delivery else None,
            "is_active": is_active,
            "days_inactive": days_inactive if not is_active else 0
        },
        "monthly_trend": monthly_trend,
        "anomalies": anomalies,
        "recent_invoices": recent_invoices
    }

@router.get("/statistics/suppliers/compare")
async def compare_suppliers(
    suppliers: str,  # comma-separated supplier names
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Compare multiple suppliers"""
    require_permission(current_user, "view_statistics")
    from urllib.parse import unquote

    supplier_names = [unquote(s.strip()) for s in suppliers.split(",") if s.strip()]
    
    if len(supplier_names) < 2 or len(supplier_names) > 5:
        raise HTTPException(status_code=400, detail="Изберете между 2 и 5 доставчика за сравнение")
    
    # Build date query
    date_query = {}
    if start_date:
        date_query["$gte"] = datetime.fromisoformat(start_date + "T00:00:00+00:00")
    if end_date:
        date_query["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    comparison = []
    _, base_scope = await get_company_scope(current_user)

    for supplier_name in supplier_names:
        query = {**base_scope, "supplier": {"$regex": f"^{re.escape(supplier_name)}$", "$options": "i"}}
        if date_query:
            query["date"] = date_query
        
        invoices = await server.db.invoices.find(query, {"_id": 0, "total_amount": 1, "date": 1}).to_list(10000)
        
        total = sum(inv.get("total_amount", 0) for inv in invoices)
        count = len(invoices)
        avg = total / count if count > 0 else 0
        
        comparison.append({
            "supplier": supplier_name,
            "total_amount": round(total, 2),
            "invoice_count": count,
            "avg_invoice": round(avg, 2)
        })
    
    # Calculate max for percentage calculation
    max_amount = max(c["total_amount"] for c in comparison) if comparison else 1
    max_count = max(c["invoice_count"] for c in comparison) if comparison else 1
    
    for c in comparison:
        c["amount_percent"] = round(c["total_amount"] / max_amount * 100, 1) if max_amount > 0 else 0
        c["count_percent"] = round(c["invoice_count"] / max_count * 100, 1) if max_count > 0 else 0
    
    return {
        "suppliers": comparison,
        "period": {"start_date": start_date, "end_date": end_date}
    }

@router.get("/statistics/supplier/{supplier_name}")
async def get_single_supplier_stats(
    supplier_name: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get detailed statistics for a specific supplier"""
    require_permission(current_user, "view_statistics")
    _, query = await get_company_scope(current_user)
    query["supplier"] = {"$regex": f"^{re.escape(supplier_name)}$", "$options": "i"}

    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = datetime.fromisoformat(start_date + "T00:00:00+00:00")
        if end_date:
            query["date"]["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    invoices = await server.db.invoices.find(query, {"_id": 0, "image_base64": 0, "image_base64s": 0}).sort("date", -1).to_list(1000)
    
    if not invoices:
        return {
            "supplier": supplier_name,
            "invoice_count": 0,
            "total_amount": 0,
            "invoices": []
        }
    
    total_amount = sum(inv.get("total_amount", 0) for inv in invoices)
    total_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_net = sum(inv.get("amount_without_vat", 0) for inv in invoices)
    
    # Format invoices
    formatted_invoices = []
    for inv in invoices:
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            date_str = date_val.strftime("%Y-%m-%d")
        else:
            date_str = str(date_val)[:10]
        
        formatted_invoices.append({
            "id": inv.get("id"),
            "invoice_number": inv.get("invoice_number"),
            "date": date_str,
            "total_amount": inv.get("total_amount", 0),
            "vat_amount": inv.get("vat_amount", 0),
            "amount_without_vat": inv.get("amount_without_vat", 0)
        })
    
    return {
        "supplier": supplier_name,
        "invoice_count": len(invoices),
        "total_amount": round(total_amount, 2),
        "total_vat": round(total_vat, 2),
        "total_net": round(total_net, 2),
        "avg_invoice": round(total_amount / len(invoices), 2) if invoices else 0,
        "invoices": formatted_invoices
    }

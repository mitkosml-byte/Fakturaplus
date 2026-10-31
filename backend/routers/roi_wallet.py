"""Module 1 audit finding - extracted from the former monolithic server.py.
Shares server.py's db/models/helpers/services via `from server import *`;
`db` and `AI_FEATURES_ENABLED` are the two globals tests/startup reassign
after module load, so this file always accesses them as `server.db` /
`server.AI_FEATURES_ENABLED` (qualified), never via the star-import, to
stay correct when server.py's test fixture monkeypatches them."""
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

@router.get("/roi/analysis")
@limiter.limit("20/minute")
async def get_roi_analysis(
    request: Request,
    month: Optional[int] = None,
    year: Optional[int] = None,
    language: str = "bg",
    current_user: User = Depends(get_current_user)
):
    """
    ROI анализ - изчислява възвръщаемост на личната инвестиция.
    Изисква view_personal_investments.
    """
    require_permission(current_user, "view_personal_investments")

    # Default to current month/year
    now = datetime.now(timezone.utc)
    target_month = month or now.month
    target_year = year or now.year

    # Build period dates
    period_start = f"{target_year}-{target_month:02d}-01"
    if target_month == 12:
        period_end = f"{target_year + 1}-01-01"
    else:
        period_end = f"{target_year}-{target_month + 1:02d}-01"

    # Personal expenses are scoped to the whole company (not
    # current_user.user_id) so a delegated viewer with the permission above
    # sees the OWNER's personal ledger, not an always-empty query for
    # themselves - personal expenses are always entered by the owner.
    company_id, scope = await get_company_scope(current_user)
    personal_expenses = await server.db.personal_expenses.find({
        "company_id": company_id,
        "period_month": target_month,
        "period_year": target_year
    }, {"_id": 0, "amount": 1, "expense_type": 1}).to_list(1000) if company_id else []

    total_personal = sum(e.get("amount", 0) for e in personal_expenses)
    total_investment = sum(e.get("amount", 0) for e in personal_expenses if e.get("expense_type") == "investment")

    # Get business revenue for period
    revenues = await server.db.daily_revenue.find({
        **scope,
        "date": {"$gte": period_start, "$lt": period_end}
    }, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1}).to_list(1000)

    # Same redaction convention as get_summary: a viewer without
    # view_personal_investments never reaches this endpoint at all, but the
    # two sensitive-field permissions are orthogonal to it - someone can have
    # view_personal_investments without view_pocket_money/view_off_book_expenses,
    # so the raw totals are zeroed out of every aggregate below unless this
    # viewer is also allowed to see that specific field.
    visibility = get_financial_visibility(current_user)
    total_fiscal_revenue = sum(r.get("fiscal_revenue", 0) for r in revenues)
    total_pocket_money = sum(r.get("pocket_money", 0) for r in revenues)
    effective_pocket_money = total_pocket_money if visibility["pocket_money"] else 0
    total_revenue = total_fiscal_revenue + effective_pocket_money

    # Get business expenses (invoices + non-invoice expenses)
    invoices = await server.db.invoices.find({
        **scope,
        "date": {
            "$gte": datetime.fromisoformat(period_start + "T00:00:00+00:00"),
            "$lt": datetime.fromisoformat(period_end + "T00:00:00+00:00")
        }
    }, {"_id": 0, "total_amount": 1}).to_list(1000)

    business_expenses = await server.db.expenses.find({
        **scope,
        "date": {"$gte": period_start, "$lt": period_end}
    }, {"_id": 0, "amount": 1}).to_list(1000)

    total_invoice_expense = sum(i.get("total_amount", 0) for i in invoices)
    total_off_book_expense = sum(e.get("amount", 0) for e in business_expenses)
    effective_off_book_expense = total_off_book_expense if visibility["off_book_expenses"] else 0
    total_business_expense = total_invoice_expense + effective_off_book_expense

    # Calculate profit and ROI from the already-effective (not raw) totals
    total_profit = total_revenue - total_business_expense

    # ROI = (Печалба / Лична инвестиция) * 100
    if total_personal > 0:
        roi_percent = (total_profit / total_personal) * 100
    else:
        roi_percent = 0 if total_profit <= 0 else 100

    is_profitable = total_profit > 0
    investment_covered = total_profit >= total_personal

    # Печалбата (и всичко изчислено пряко от нея - ROI, is_profitable,
    # investment_covered, AI препоръките) е независимо скриваема по
    # view_profit, както при get_summary - иначе зрител без това право би я
    # видял изписана в текст през ai_insights, дори полетата по-долу да са null.
    if visibility["profit"]:
        # Generate AI insights. The "need ~45-60 days" warning below is about
        # whether the BUSINESS overall has enough logged history for the
        # noise in ROI/profit to have settled - not whether this one
        # calendar month does, which no month (max 31 days) could ever
        # satisfy on its own. So this is a total count across all time,
        # scoped to the company, not len(revenues) for just this period.
        total_days_with_data = await server.db.daily_revenue.count_documents(scope)
        ai_insights = await generate_roi_insights(
            total_personal=total_personal,
            total_investment=total_investment,
            total_revenue=total_revenue,
            total_profit=total_profit,
            roi_percent=roi_percent,
            is_profitable=is_profitable,
            investment_covered=investment_covered,
            days_with_data=total_days_with_data,
            language=language,
        )
    else:
        ai_insights = ["🔒 You don't have permission to see the profit for the selected period"] if language == "en" else ["🔒 Нямаш право да виждаш печалбата за избрания период"]

    return {
        "period": {"month": target_month, "year": target_year},
        "period_start": period_start,
        "period_end": period_end,
        "total_personal_investment": round(total_personal, 2),
        "total_investment_only": round(total_investment, 2),
        "total_revenue": round(total_revenue, 2),
        "total_business_expense": round(total_business_expense, 2),
        "total_profit": round(total_profit, 2) if visibility["profit"] else None,
        "roi_percent": round(roi_percent, 1) if visibility["profit"] else None,
        "is_profitable": is_profitable if visibility["profit"] else None,
        "investment_covered": investment_covered if visibility["profit"] else None,
        "ai_insights": ai_insights
    }

@router.get("/roi/trend")
async def get_roi_trend(
    months: int = 6,
    current_user: User = Depends(get_current_user)
):
    """Връща ROI тренд за последните N месеца (изисква view_personal_investments)"""
    require_permission(current_user, "view_personal_investments")

    company_id, scope = await get_company_scope(current_user)
    visibility = get_financial_visibility(current_user)
    now = datetime.now(timezone.utc)
    trend_data = []

    for i in range(months - 1, -1, -1):
        # Calculate target month
        target_month = now.month - i
        target_year = now.year
        
        while target_month <= 0:
            target_month += 12
            target_year -= 1
        
        # Get ROI for this month
        period_start = f"{target_year}-{target_month:02d}-01"
        if target_month == 12:
            period_end = f"{target_year + 1}-01-01"
        else:
            period_end = f"{target_year}-{target_month + 1:02d}-01"
        
        # Personal expenses - company-scoped, see get_roi_analysis for why.
        personal = await server.db.personal_expenses.find({
            "company_id": company_id,
            "period_month": target_month,
            "period_year": target_year
        }, {"_id": 0, "amount": 1}).to_list(1000) if company_id else []
        total_personal = sum(p.get("amount", 0) for p in personal)
        
        # Revenue - effective pocket_money, same redaction as get_roi_analysis
        revenues = await server.db.daily_revenue.find({
            **scope,
            "date": {"$gte": period_start, "$lt": period_end}
        }, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1}).to_list(1000)
        effective_pocket_money = sum(r.get("pocket_money", 0) for r in revenues) if visibility["pocket_money"] else 0
        total_revenue = sum(r.get("fiscal_revenue", 0) for r in revenues) + effective_pocket_money

        # Business expenses - effective off-book expenses
        invoices = await server.db.invoices.find({
            **scope,
            "date": {
                "$gte": datetime.fromisoformat(period_start + "T00:00:00+00:00"),
                "$lt": datetime.fromisoformat(period_end + "T00:00:00+00:00")
            }
        }, {"_id": 0, "total_amount": 1}).to_list(1000)

        expenses = await server.db.expenses.find({
            **scope,
            "date": {"$gte": period_start, "$lt": period_end}
        }, {"_id": 0, "amount": 1}).to_list(1000)

        effective_off_book_expense = sum(e.get("amount", 0) for e in expenses) if visibility["off_book_expenses"] else 0
        total_expense = sum(i.get("total_amount", 0) for i in invoices) + effective_off_book_expense
        total_profit = total_revenue - total_expense

        roi = (total_profit / total_personal * 100) if total_personal > 0 else (0 if total_profit <= 0 else 100)

        # profit/roi_percent са независимо скриваеми по view_profit, както в
        # get_roi_analysis - личната инвестиция (personal_investment) остава
        # видима, защото целият /roi/trend endpoint вече изисква
        # view_personal_investments за достъп.
        trend_data.append({
            "month": target_month,
            "year": target_year,
            "label": f"{target_month:02d}/{target_year}",
            "personal_investment": round(total_personal, 2),
            "revenue": round(total_revenue, 2),
            "profit": round(total_profit, 2) if visibility["profit"] else None,
            "roi_percent": round(roi, 1) if visibility["profit"] else None
        })

    return {"trend": trend_data, "months": months}

@router.post("/personal-wallet/entries")
async def create_personal_wallet_entry(
    entry: PersonalWalletEntryCreate,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "add_personal_wallet_entries")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Няма свързана фирма")

    entry_obj = PersonalWalletEntry(
        user_id=current_user.user_id,
        company_id=company_id,
        category=entry.category,
        description=entry.description,
        amount=entry.amount,
        date=entry.date,
        is_recurring=entry.is_recurring,
        next_due_date=entry.next_due_date,
        recurring_until=entry.recurring_until,
        notes=entry.notes,
    )
    await server.db.personal_wallet_entries.insert_one(entry_obj.model_dump())

    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name,
        action="create", entity_type="personal_wallet", entity_id=entry_obj.id,
        company_id=company_id,
        details={"category": entry.category.value, "amount": entry.amount, "description": entry.description},
    )
    return {"message": "Разходът е записан", "id": entry_obj.id}

@router.get("/personal-wallet/entries")
async def get_personal_wallet_entries(
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "view_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"entries": []}

    query: dict = {"company_id": company_id}
    if category:
        query["category"] = category
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = start_date
        if end_date:
            query["date"]["$lte"] = end_date

    entries = await server.db.personal_wallet_entries.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return {"entries": entries}

@router.put("/personal-wallet/entries/{entry_id}")
async def update_personal_wallet_entry(
    entry_id: str,
    update: PersonalWalletEntryUpdate,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "manage_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    existing = await server.db.personal_wallet_entries.find_one({"id": entry_id, "company_id": company_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Записът не е намерен")

    update_data = {k: (v.value if hasattr(v, "value") else v) for k, v in update.model_dump(exclude_unset=True).items()}
    update_data["updated_at"] = datetime.now(timezone.utc)
    await server.db.personal_wallet_entries.update_one({"id": entry_id, "company_id": company_id}, {"$set": update_data})

    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name,
        action="update", entity_type="personal_wallet", entity_id=entry_id,
        company_id=company_id, details={k: v for k, v in update_data.items() if k != "updated_at"},
    )
    entry = await server.db.personal_wallet_entries.find_one({"id": entry_id}, {"_id": 0})
    return PersonalWalletEntry(**entry)

@router.delete("/personal-wallet/entries/{entry_id}")
async def delete_personal_wallet_entry(entry_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    existing = await server.db.personal_wallet_entries.find_one({"id": entry_id, "company_id": company_id})
    result = await server.db.personal_wallet_entries.delete_one({"id": entry_id, "company_id": company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")

    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name,
        action="delete", entity_type="personal_wallet", entity_id=entry_id,
        company_id=company_id,
        details={"category": existing.get("category"), "amount": existing.get("amount"), "description": existing.get("description")} if existing else None,
    )
    return {"message": "Записът е изтрит"}

@router.get("/personal-wallet/settings")
async def get_personal_wallet_settings(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "view_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"alert_threshold_percent": 80.0}
    settings = await server.db.personal_wallet_settings.find_one({"company_id": company_id}, {"_id": 0})
    return {"alert_threshold_percent": settings.get("alert_threshold_percent", 80.0) if settings else 80.0}

@router.put("/personal-wallet/settings")
async def update_personal_wallet_settings(
    update: PersonalWalletSettingsUpdate,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "manage_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Няма свързана фирма")

    await server.db.personal_wallet_settings.update_one(
        {"company_id": company_id},
        {"$set": {"company_id": company_id, "alert_threshold_percent": update.alert_threshold_percent}},
        upsert=True,
    )
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name,
        action="update", entity_type="personal_wallet_settings", company_id=company_id,
        details={"alert_threshold_percent": update.alert_threshold_percent},
    )
    return {"alert_threshold_percent": update.alert_threshold_percent}

@router.get("/personal-wallet/summary")
async def get_personal_wallet_summary(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "view_personal_wallet")
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Няма свързана фирма")

    now = datetime.now(timezone.utc)
    start_date, end_date = _month_bounds(now)
    if now.month == 1:
        prev_month_dt = now.replace(year=now.year - 1, month=12, day=1)
    else:
        prev_month_dt = now.replace(month=now.month - 1, day=1)
    prev_start, prev_end = _month_bounds(prev_month_dt)

    entries = await server.db.personal_wallet_entries.find(
        {"company_id": company_id, "date": {"$gte": start_date, "$lte": end_date}}, {"_id": 0}
    ).to_list(2000)
    prev_entries = await server.db.personal_wallet_entries.find(
        {"company_id": company_id, "date": {"$gte": prev_start, "$lte": prev_end}}, {"_id": 0, "category": 1, "amount": 1}
    ).to_list(2000)

    total_spent = sum(e.get("amount", 0) for e in entries)
    category_totals: dict = {}
    for e in entries:
        category_totals[e["category"]] = category_totals.get(e["category"], 0) + e.get("amount", 0)
    prev_category_totals: dict = {}
    for e in prev_entries:
        prev_category_totals[e["category"]] = prev_category_totals.get(e["category"], 0) + e.get("amount", 0)
    prev_total_spent = sum(prev_category_totals.values())

    needs_total = sum(v for k, v in category_totals.items() if k in {c.value for c in WALLET_NEEDS_CATEGORIES})
    wants_total = sum(v for k, v in category_totals.items() if k in {c.value for c in WALLET_WANTS_CATEGORIES})

    profit_this_month = await _compute_month_profit(company_id, scope, current_user.user_id, start_date, end_date)

    today_str = now.strftime("%Y-%m-%d")
    two_weeks_str = (now + timedelta(days=14)).strftime("%Y-%m-%d")
    upcoming_docs = await server.db.personal_wallet_entries.find(
        {
            "company_id": company_id, "is_recurring": True,
            "next_due_date": {"$gte": today_str, "$lte": two_weeks_str},
            # Once a lease/contract/subscription's own end date has passed,
            # stop flagging it as an upcoming obligation - $or with None
            # matches entries predating this field too.
            "$or": [{"recurring_until": None}, {"recurring_until": {"$gte": today_str}}],
        },
        {"_id": 0, "description": 1, "amount": 1, "next_due_date": 1, "category": 1, "recurring_until": 1},
    ).sort("next_due_date", 1).to_list(50)
    upcoming_due_total = sum(
        u.get("amount", 0) for u in upcoming_docs if u.get("next_due_date", "") <= (now + timedelta(days=7)).strftime("%Y-%m-%d")
    )

    settings = await server.db.personal_wallet_settings.find_one({"company_id": company_id}, {"_id": 0})
    threshold_percent = settings.get("alert_threshold_percent", 80.0) if settings else 80.0

    safe_to_spend = round(profit_this_month - total_spent - upcoming_due_total, 2)
    spent_percent_of_profit = round(total_spent / profit_this_month * 100, 1) if profit_this_month > 0 else None

    status = "ok"
    if spent_percent_of_profit is not None:
        if spent_percent_of_profit >= threshold_percent:
            status = "danger"
        elif spent_percent_of_profit >= threshold_percent * 0.6:
            status = "warning"
    elif profit_this_month <= 0 and total_spent > 0:
        status = "danger"

    advice = generate_wallet_advice(
        total_spent=total_spent, needs_total=needs_total, wants_total=wants_total,
        category_totals=category_totals, last_month_category_totals=prev_category_totals,
        profit_this_month=profit_this_month, safe_to_spend=safe_to_spend,
        threshold_percent=threshold_percent, spent_percent_of_profit=spent_percent_of_profit,
        upcoming=upcoming_docs,
    )

    return {
        "period": {"start": start_date, "end": end_date},
        "total_spent": round(total_spent, 2),
        "prev_month_total_spent": round(prev_total_spent, 2),
        "category_totals": {k: round(v, 2) for k, v in category_totals.items()},
        "needs_total": round(needs_total, 2),
        "wants_total": round(wants_total, 2),
        "profit_this_month": round(profit_this_month, 2),
        "safe_to_spend": safe_to_spend,
        "threshold_percent": threshold_percent,
        "spent_percent_of_profit": spent_percent_of_profit,
        "status": status,
        "upcoming": upcoming_docs,
        "advice": advice,
    }

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

@router.post("/daily-revenue", response_model=DailyRevenue)
async def create_daily_revenue(revenue: DailyRevenueCreate, current_user: User = Depends(get_current_user)):
    """Записва оборота за деня - ЗАМЕСТВА предишната стойност, не я
    добавя към нея (фронтендът зарежда текущите стойности в полетата
    при отваряне, точно за да могат да се коригират директно)."""
    require_permission(current_user, "add_revenue")
    company_id, scope = await get_company_scope(current_user)

    # Check if ANY teammate already logged revenue for this date - the
    # fiscal till total for a given day belongs to the whole company, not
    # to whoever happened to type it in.
    existing = await server.db.daily_revenue.find_one({**scope, "date": revenue.date}, {"_id": 0})

    if existing:
        await server.db.daily_revenue.update_one(
            {"id": existing["id"]},
            {"$set": {
                "fiscal_revenue": revenue.fiscal_revenue,
                "pocket_money": revenue.pocket_money,
                "card_revenue": revenue.card_revenue,
                "vat_rate_percent": revenue.vat_rate_percent,
            }}
        )
        existing["fiscal_revenue"] = revenue.fiscal_revenue
        existing["pocket_money"] = revenue.pocket_money
        existing["card_revenue"] = revenue.card_revenue
        existing["vat_rate_percent"] = revenue.vat_rate_percent
        existing.setdefault("company_id", company_id)
        return DailyRevenue(**existing)

    revenue_obj = DailyRevenue(
        user_id=current_user.user_id,
        company_id=company_id,
        date=revenue.date,
        fiscal_revenue=revenue.fiscal_revenue,
        pocket_money=revenue.pocket_money,
        card_revenue=revenue.card_revenue,
        vat_rate_percent=revenue.vat_rate_percent
    )
    await server.db.daily_revenue.insert_one(revenue_obj.dict())
    return revenue_obj

@router.get("/daily-revenue/today")
async def get_today_revenue(current_user: User = Depends(get_current_user)):
    """Get today's revenue totals for the whole company"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    _, scope = await get_company_scope(current_user)
    existing = await server.db.daily_revenue.find_one({**scope, "date": today}, {"_id": 0})
    # Same visibility rule as /statistics/summary and /statistics/chart-data -
    # pocket_money is a distinct sensitive field, not the whole record, so a
    # viewer without view_pocket_money still gets fiscal/card revenue (they
    # may hold add_revenue and legitimately need to edit those) with only
    # pocket_money zeroed out, rather than the whole endpoint being blocked.
    can_see_pocket_money = get_financial_visibility(current_user)["pocket_money"]

    if existing:
        return {
            "date": today,
            "fiscal_revenue": existing.get("fiscal_revenue", 0),
            "pocket_money": existing.get("pocket_money", 0) if can_see_pocket_money else 0
        }
    return {
        "date": today,
        "fiscal_revenue": 0,
        "pocket_money": 0
    }

@router.get("/daily-revenue/by-date/{date}")
async def get_revenue_by_date(date: str, current_user: User = Depends(get_current_user)):
    """Get revenue for a specific date, for the whole company"""
    _, scope = await get_company_scope(current_user)
    existing = await server.db.daily_revenue.find_one({**scope, "date": date}, {"_id": 0})
    can_see_pocket_money = get_financial_visibility(current_user)["pocket_money"]

    if existing:
        return {
            "date": date,
            "fiscal_revenue": existing.get("fiscal_revenue", 0),
            "pocket_money": existing.get("pocket_money", 0) if can_see_pocket_money else 0,
            "card_revenue": existing.get("card_revenue", 0),
            "vat_rate_percent": existing.get("vat_rate_percent", 20.0)
        }
    return {
        "date": date,
        "fiscal_revenue": 0,
        "pocket_money": 0,
        "card_revenue": 0,
        "vat_rate_percent": 20.0
    }

@router.get("/daily-revenue", response_model=List[DailyRevenue])
async def get_daily_revenues(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    _, query = await get_company_scope(current_user)

    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}

    can_see_pocket_money = get_financial_visibility(current_user)["pocket_money"]
    revenues = await server.db.daily_revenue.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    if not can_see_pocket_money:
        for r in revenues:
            r["pocket_money"] = 0
    return [DailyRevenue(**r) for r in revenues]

@router.post("/expenses", response_model=NonInvoiceExpense)
async def create_expense(expense: NonInvoiceExpenseCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_expenses")
    company_id, _ = await get_company_scope(current_user)
    expense_obj = NonInvoiceExpense(
        user_id=current_user.user_id,
        company_id=company_id,
        **expense.dict()
    )
    await server.db.expenses.insert_one(expense_obj.dict())
    return expense_obj

@router.get("/expenses", response_model=List[NonInvoiceExpense])
async def get_expenses(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "view_off_book_expenses")
    _, query = await get_company_scope(current_user)

    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}

    expenses = await server.db.expenses.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return [NonInvoiceExpense(**e) for e in expenses]

@router.put("/expenses/{expense_id}", response_model=NonInvoiceExpense)
async def update_expense(expense_id: str, update: NonInvoiceExpenseUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_expenses")
    _, scope = await get_company_scope(current_user)
    update_data = {k: v for k, v in update.dict(exclude_unset=True).items()}
    if update_data:
        result = await server.db.expenses.update_one({"id": expense_id, **scope}, {"$set": update_data})
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Разходът не е намерен")
    existing = await server.db.expenses.find_one({"id": expense_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Разходът не е намерен")
    return NonInvoiceExpense(**existing)

@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_expenses")
    _, scope = await get_company_scope(current_user)
    result = await server.db.expenses.delete_one({"id": expense_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Разходът не е намерен")
    return {"message": "Разходът е изтрит"}

@router.post("/personal-expenses")
async def create_personal_expense(
    expense: PersonalExpenseCreate,
    current_user: User = Depends(get_current_user)
):
    """Създава личен разход/инвестиция (само за собственик)"""
    # Check if user is owner
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярът може да управлява лични разходи")
    
    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        raise HTTPException(status_code=400, detail="Няма свързана фирма")
    
    expense_obj = PersonalExpense(
        user_id=current_user.user_id,
        company_id=company_id,
        amount=expense.amount,
        description=expense.description,
        expense_type=PersonalExpenseType(expense.expense_type),
        category=PersonalExpenseCategory(expense.category),
        period_month=expense.period_month,
        period_year=expense.period_year,
        supplier_id=expense.supplier_id,
        project_name=expense.project_name,
        notes=expense.notes
    )
    
    await server.db.personal_expenses.insert_one(expense_obj.dict())
    return {"message": "Личният разход е записан", "id": expense_obj.id}

@router.get("/personal-expenses")
async def get_personal_expenses(
    month: Optional[int] = None,
    year: Optional[int] = None,
    expense_type: Optional[str] = None,
    category: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Връща личните разходи на собственика (изисква view_personal_investments)"""
    require_permission(current_user, "view_personal_investments")

    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"personal_expenses": []}
    query = {"company_id": company_id}

    if month:
        query["period_month"] = month
    if year:
        query["period_year"] = year
    if expense_type:
        query["expense_type"] = expense_type
    if category:
        query["category"] = category
    
    expenses = await server.db.personal_expenses.find(query, {"_id": 0}).sort([("period_year", -1), ("period_month", -1)]).to_list(1000)
    return {"personal_expenses": expenses}

@router.delete("/personal-expenses/{expense_id}")
async def delete_personal_expense(
    expense_id: str,
    current_user: User = Depends(get_current_user)
):
    """Изтрива личен разход (само за собственик)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярът може да управлява лични разходи")

    # Scoped by company, not just this owner's own user_id - a company can
    # have more than one owner, and GET /personal-expenses already shows
    # every owner's entries together, so any owner should be able to
    # delete any of them, not only the ones they personally entered.
    company_id, _ = await get_company_scope(current_user)
    result = await server.db.personal_expenses.delete_one({
        "id": expense_id,
        "company_id": company_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Разходът не е намерен")
    
    return {"message": "Личният разход е изтрит"}

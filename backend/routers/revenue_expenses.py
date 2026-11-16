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
from pymongo.errors import DuplicateKeyError

router = APIRouter(prefix="/api")

def _revenue_day(value: str) -> str:
    """A submitted revenue date as "YYYY-MM-DD" - 400 when it is no date."""
    try:
        day = business_day(value)
    except (TypeError, ValueError):
        day = None
    if day is None:
        raise HTTPException(status_code=400, detail="Невалидна дата")
    return day.isoformat()


def _revenue_for_viewer(doc: dict, current_user: User) -> DailyRevenue:
    """A day's record as this person may see it - pocket money stays hidden
    from whoever may not see it, in a reply to their own save too."""
    doc = dict(doc)
    if not get_financial_visibility(current_user)["pocket_money"]:
        doc["pocket_money"] = 0
    return DailyRevenue(**doc)


async def _save_revenue_day(company_id: Optional[str], scope: dict, current_user: User, day: str,
                            changes: Dict[str, Any], increments: Optional[Dict[str, float]] = None) -> dict:
    """Sets (and adds to) one day's revenue - one record per company and
    day, whoever typed it: the day already there is updated, otherwise it
    is created, with the database's own one-day-one-record rule catching
    two saves of the same new day at the same moment."""
    existing = await server.db.daily_revenue.find_one({**scope, "date": day}, {"_id": 0})
    if existing is None:
        doc = DailyRevenue(
            user_id=current_user.user_id, company_id=company_id, date=day,
            fiscal_revenue=0, pocket_money=0, card_revenue=0, vat_rate_percent=20.0,
        ).model_dump()
        doc.update(changes)
        for field, amount in (increments or {}).items():
            doc[field] = round(doc.get(field, 0) + amount, 2)
        try:
            await server.db.daily_revenue.insert_one(dict(doc))
            return doc
        except DuplicateKeyError:
            # Someone saved the same day a moment earlier - update theirs.
            existing = await server.db.daily_revenue.find_one({**scope, "date": day}, {"_id": 0})
            if existing is None:
                raise
    update: Dict[str, Any] = {}
    if changes:
        update["$set"] = changes
    if increments:
        update["$inc"] = increments
    if update:
        await server.db.daily_revenue.update_one({"id": existing["id"]}, update)
    saved = await server.db.daily_revenue.find_one({"id": existing["id"]}, {"_id": 0})
    saved.setdefault("company_id", company_id)
    return saved


@router.post("/daily-revenue", response_model=DailyRevenue)
async def create_daily_revenue(revenue: DailyRevenueCreate, current_user: User = Depends(get_current_user)):
    """Записва оборота за деня - заменя въведените стойности, не ги
    добавя към записаните (фронтендът зарежда текущите стойности в
    полетата при отваряне, точно за да могат да се коригират директно).
    Поле, което не е подадено, остава както е; джобчето не се пипа от
    човек, който няма право да го вижда - той вижда 0 и иначе би го
    изтрил с всяко запазване."""
    require_permission(current_user, "add_revenue")
    company_id, scope = await get_company_scope(current_user)
    changes = {k: v for k, v in revenue.model_dump(exclude={"date"}).items() if v is not None}
    if not get_financial_visibility(current_user)["pocket_money"]:
        changes.pop("pocket_money", None)
    saved = await _save_revenue_day(company_id, scope, current_user, _revenue_day(revenue.date), changes)
    return _revenue_for_viewer(saved, current_user)


@router.post("/daily-revenue/add-pocket", response_model=DailyRevenue)
async def add_pocket_money(payload: PocketMoneyAdd, current_user: User = Depends(get_current_user)):
    """Adds an amount to a day's pocket money (a paid bill logged as
    revenue) - added to what the day holds, never replacing it, so it is
    safe for someone who may not see pocket money too."""
    require_permission(current_user, "add_revenue")
    company_id, scope = await get_company_scope(current_user)
    saved = await _save_revenue_day(
        company_id, scope, current_user, _revenue_day(payload.date), {}, {"pocket_money": round(payload.amount, 2)},
    )
    return _revenue_for_viewer(saved, current_user)

def _require_revenue_day_access(current_user: User) -> None:
    """One day's revenue: for whoever enters it (to correct that day) or may
    see the company's figures."""
    if not {"add_revenue", "view_statistics"} & set(current_user.permissions or []):
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")


@router.get("/daily-revenue/today")
async def get_today_revenue(current_user: User = Depends(get_current_user)):
    """Get today's revenue totals for the whole company"""
    _require_revenue_day_access(current_user)
    today = today_local().isoformat()
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
    _require_revenue_day_access(current_user)
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
    # The company's revenue day by day, for any length of time: for who may
    # see its figures - or, for the pocket money history, its pocket money
    # alone. Before, anyone in the company could list the till day by day.
    visibility = get_financial_visibility(current_user)
    if not (visibility["statistics"] or visibility["pocket_money"]):
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")
    _, query = await get_company_scope(current_user)

    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}

    revenues = await server.db.daily_revenue.find(query, {"_id": 0}).sort("date", -1).to_list(ALL_ROWS)
    for r in revenues:
        if not visibility["pocket_money"]:
            r["pocket_money"] = 0
        if not visibility["statistics"]:
            r["fiscal_revenue"] = 0
            r["card_revenue"] = 0
    return [DailyRevenue(**r) for r in revenues]

async def _refuse_wages(expense_id: str, scope: dict) -> None:
    """A wages record lives and dies with its schedule payment."""
    doc = await server.db.expenses.find_one({"id": expense_id, **scope}, {"_id": 0, "kind": 1})
    if doc and doc.get("kind") == SCHEDULE_WAGES:
        raise HTTPException(status_code=409, detail="Това е заплата по график - промени или отмени плащането от Графика")


@router.post("/expenses", response_model=NonInvoiceExpense)
async def create_expense(expense: NonInvoiceExpenseCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_expenses")
    company_id, _ = await get_company_scope(current_user)
    expense_obj = NonInvoiceExpense(
        user_id=current_user.user_id,
        company_id=company_id,
        **expense.model_dump()
    )
    await server.db.expenses.insert_one(expense_obj.model_dump())
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

    # Wages paid through Work Schedule are payroll, managed from the
    # schedule - not off-book expenses.
    query.update(NOT_WAGES)
    expenses = await server.db.expenses.find(query, {"_id": 0}).sort("date", -1).to_list(ALL_ROWS)
    return [NonInvoiceExpense(**e) for e in expenses]

@router.put("/expenses/{expense_id}", response_model=NonInvoiceExpense)
async def update_expense(expense_id: str, update: NonInvoiceExpenseUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_expenses")
    _, scope = await get_company_scope(current_user)
    await _refuse_wages(expense_id, scope)
    update_data = {k: v for k, v in update.model_dump(exclude_unset=True).items()}
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
    company_id, scope = await get_company_scope(current_user)
    await _refuse_wages(expense_id, scope)
    expense: Dict[str, Any] = dict(await server.db.expenses.find_one({"id": expense_id, **scope}, {"_id": 0}) or {})
    result = await server.db.expenses.delete_one({"id": expense_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Разходът не е намерен")
    if expense.get("recurring_id") and expense.get("recurring_month"):
        # A recurring expense's month deleted on purpose is not paid that
        # month - never recorded again by itself.
        await server.db.recurring_expenses.update_one(
            {"id": expense["recurring_id"], "company_id": company_id},
            {"$addToSet": {"skipped_months": expense["recurring_month"]}},
        )
    # A trace in the action log, with the whole record so it can be put
    # back (restore_audit_entry) - before, a deleted expense vanished.
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="delete",
        entity_type="expense", entity_id=expense_id, company_id=company_id,
        details={
            "description": expense.get("description"), "amount": expense.get("amount"),
            "date": expense.get("date"), "snapshot": expense, "restored": False,
        },
    )
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
    
    await server.db.personal_expenses.insert_one(expense_obj.model_dump())
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
    
    expenses = await server.db.personal_expenses.find(query, {"_id": 0}).sort([("period_year", -1), ("period_month", -1)]).to_list(ALL_ROWS)
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

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

@router.get("/budget")
async def get_budgets(current_user: User = Depends(get_current_user)):
    """Get all budgets for company"""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        return {"budgets": []}
    
    budgets = await server.db.budgets.find({"company_id": company_id}, {"_id": 0}).sort("month", -1).to_list(24)
    return {"budgets": budgets}

@router.post("/budget")
async def create_budget(budget: BudgetCreate, current_user: User = Depends(get_current_user)):
    """Create or update budget for a month"""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        raise HTTPException(status_code=400, detail="No company associated")
    
    # Check if budget exists for this month
    existing = await server.db.budgets.find_one({"company_id": company_id, "month": budget.month})
    
    if existing:
        await server.db.budgets.update_one(
            {"company_id": company_id, "month": budget.month},
            {
                "$set": {"expense_limit": budget.expense_limit, "alert_threshold": budget.alert_threshold},
                # A changed limit/threshold invalidates any push already
                # sent against the OLD numbers - e.g. lowering the limit
                # should let the threshold alert fire again even if it
                # already fired once this month under the previous, higher
                # limit, instead of staying silent for the rest of the month.
                "$unset": {"alert_sent": "", "exceeded_sent": ""},
            }
        )
    else:
        budget_doc = {
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "month": budget.month,
            "expense_limit": budget.expense_limit,
            "alert_threshold": budget.alert_threshold,
            "alert_sent": False,
            "exceeded_sent": False,
            "created_at": datetime.now(timezone.utc)
        }
        await server.db.budgets.insert_one(budget_doc)
    
    return {"message": "Budget saved"}

@router.get("/budget/status")
async def get_budget_status(current_user: User = Depends(get_current_user)):
    """Get current month budget status"""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)

    if not company_id:
        return {"has_budget": False}

    current_month = datetime.now().strftime("%Y-%m")
    status = await compute_budget_status(company_id, current_month)
    return status if status else {"has_budget": False}

@router.get("/recurring-expenses")
async def get_recurring_expenses(current_user: User = Depends(get_current_user)):
    """Get recurring expenses"""
    # Same gate as the /budget endpoints this feature lives alongside in
    # budget.tsx (which already hides the whole screen without
    # manage_budget) - without it, a member lacking that permission could
    # still call the API directly.
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        return {"recurring_expenses": []}
    
    expenses = await server.db.recurring_expenses.find(
        {"company_id": company_id},
        {"_id": 0}
    ).to_list(100)
    
    return {"recurring_expenses": expenses}

@router.post("/recurring-expenses")
async def create_recurring_expense(
    expense: RecurringExpenseCreate,
    current_user: User = Depends(get_current_user)
):
    """Create recurring expense"""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    
    if not company_id:
        raise HTTPException(status_code=400, detail="No company associated")
    
    if expense.day_of_month < 1 or expense.day_of_month > 28:
        raise HTTPException(status_code=400, detail="Day must be between 1 and 28")
    
    expense_doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "user_id": current_user.user_id,
        "description": expense.description,
        "amount": expense.amount,
        "day_of_month": expense.day_of_month,
        "category": expense.category,
        "is_active": True,
        "last_generated": None,
        "created_at": datetime.now(timezone.utc)
    }
    
    await server.db.recurring_expenses.insert_one(expense_doc)
    return {"message": "Recurring expense created", "id": expense_doc["id"]}

@router.delete("/recurring-expenses/{expense_id}")
async def delete_recurring_expense(expense_id: str, current_user: User = Depends(get_current_user)):
    """Delete recurring expense"""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    
    result = await server.db.recurring_expenses.delete_one({"id": expense_id, "company_id": company_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    return {"message": "Deleted"}

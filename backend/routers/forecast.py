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

@router.get("/forecast/expenses")
async def get_expense_forecast(
    months_ahead: int = 3,
    lookback_days: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get expense forecast. Gated on view_statistics, matching the
    frontend's own gate for the forecast card on the stats screen.

    lookback_days (a preset - 30/90/180/365 for roughly 1/3/6/12 months)
    or an explicit start_date/end_date (a custom period) controls how far
    back the forecast's own history window reaches; omitting both keeps
    the original 6-month default."""
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)

    if not company_id:
        return {"error": "No company"}

    visibility = get_financial_visibility(current_user)
    return await forecast_service.get_expense_forecast(
        company_id, months_ahead,
        include_off_book_expenses=visibility["off_book_expenses"],
        lookback_days=lookback_days, start_date=start_date, end_date=end_date,
    )

@router.get("/forecast/revenue")
async def get_revenue_forecast(
    months_ahead: int = 3,
    lookback_days: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get revenue forecast. Gated on view_statistics, matching the
    frontend's own gate for the forecast card on the stats screen. See
    get_expense_forecast above for lookback_days/start_date/end_date."""
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)

    if not company_id:
        return {"error": "No company"}

    return await forecast_service.get_revenue_forecast(
        company_id, months_ahead,
        lookback_days=lookback_days, start_date=start_date, end_date=end_date,
    )

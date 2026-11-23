"""Profit margins of a period, on Home: gross, operating and net - how much
of every euro of sales is left after the goods, after running the business
and after the profit tax (services/margins).

Read from the same records as Home's numbers, for the same period (so far,
while it runs), and with the same visibility: a viewer who does not see the
pocket money, the expenses without invoice or the payroll gets the margins
of what they see, like their profit - and nothing for whoever may not see
the profit at all.

What counts as what, the same for every business:
- sales: the till, the pocket money and the invoices issued to customers;
- goods and materials: the purchase invoices (not a fixed asset's) and the
  expenses without invoice that are not a recurring cost;
- running the business: the payroll (and the wages paid by the schedule)
  - for this month and the month before, the salaries in Екип of whoever
  has no payroll entered for it yet, as the break-even counts them - the
  recurring costs - rent, utilities, subscriptions... by the days of their
  month, like the payroll - and the depreciation;
- the profit tax: the business's rate (services/margins.profit_tax_percent)
  on a profit, nothing on a loss.

Without VAT for a business registered for VAT - the VAT is the state's money,
neither sales nor cost - and with it for one that is not, which pays the VAT
of its purchases as a cost and charges none."""
import asyncio

from fastapi import APIRouter
from server import *
import server
from services import margins as margins_service
from services import recurring_service
from services.business_calendar import add_months

router = APIRouter(prefix="/api")

COMPANY_FIELDS = {"_id": 0, "name": 1, "vat_registered": 1, "vat_number": 1, "modules": 1, "profit_tax_percent": 1}


def sees_margins(current_user: User) -> bool:
    """The margins tell how profitable the business is: for whoever sees
    the statistics and the profit."""
    visibility = get_financial_visibility(current_user)
    return bool(visibility.get("statistics") and visibility.get("profit"))


async def _expected_payroll(company_id: Optional[str], scope: dict, period: Period, today: date) -> float:
    """The payroll not entered yet, by the salaries in Екип: for this month
    and the month before - whose payroll is made after it ends - each
    employee without an entry for it (month_payroll), by the period's share
    of the month. An older month is as it was entered."""
    pending = {(today.year, today.month), add_months(today.year, today.month, -1)}
    expected = 0.0
    for year, month in period.months():
        share = period.month_share(year, month)
        if (year, month) in pending and share:
            expected += (await month_payroll(company_id, scope, year, month, expect=True))["expected"] * share
    return expected


async def _figures(
    company_id: Optional[str], scope: dict, user_id: str, period: Period, visibility: dict, vat_registered: bool,
    expect_payroll: bool, today: date,
) -> Tuple[margins_service.Figures, int]:
    """A period's figures for this viewer, and how many recurring costs the
    business follows."""
    off_book_visible = bool(visibility["off_book_expenses"])
    totals, recurring, expected_payroll = await asyncio.gather(
        period_totals(company_id, scope, user_id, period),
        recurring_service.period_costs(server.db, company_id, scope, period, off_book_visible, vat_registered),
        _expected_payroll(company_id, scope, period, today) if expect_payroll else _zero(),
    )
    pocket = totals["pocket_money"] if visibility["pocket_money"] else 0.0
    if vat_registered:
        sales = totals["fiscal_revenue"] - totals["fiscal_vat"] + totals["issued_invoice_net"] + pocket
        purchases = totals["invoice_net"]
    else:
        sales = totals["fiscal_revenue"] + totals["issued_invoice_total"] + pocket
        purchases = totals["invoice_total"]
    goods = purchases + (totals["off_book_expenses"] if off_book_visible else 0.0) - recurring["paid"]
    sees_payroll = bool(visibility.get("payroll", True))
    figures = margins_service.Figures(
        sales=sales,
        goods=max(goods, 0.0),
        payroll=(totals["payroll_cost"] + expected_payroll) if sees_payroll else 0.0,
        recurring=recurring["accrued"],
        depreciation=totals["depreciation_cost"],
        payroll_expected=expected_payroll if sees_payroll else 0.0,
    )
    return figures, int(recurring["items"])


async def _zero() -> float:
    return 0.0


async def period_margins(
    current_user: User, start_date: Optional[str] = None, end_date: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """The margins of Home's period and their change since the period
    before - None for a viewer who may not see them."""
    if not sees_margins(current_user):
        return None
    try:
        period = Period.parse(start_date, end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Невалиден период")
    counted = counted_period(period)
    company_id, scope = await get_company_scope(current_user)
    company = await server.db.companies.find_one({"id": company_id}, COMPANY_FIELDS) if company_id else None
    visibility = get_financial_visibility(current_user)
    vat_registered = company_vat_registered(company)
    tax_percent = margins_service.profit_tax_percent(company)
    # Salaries not entered yet are expected - for whoever sees the payroll
    # of a business that keeps it.
    expect_payroll = bool(visibility.get("payroll", True)) and company_modules(company)["payroll"]
    today = server.today_local()
    before = margins_service.previous_period(period, counted)
    (figures, recurring_items), previous = await asyncio.gather(
        _figures(company_id, scope, current_user.user_id, counted, visibility, vat_registered, expect_payroll, today),
        _figures(company_id, scope, current_user.user_id, before, visibility, vat_registered, expect_payroll, today)
        if before else _nothing(),
    )
    answer: Dict[str, Any] = {
        "period": {"start_date": counted.start_text, "end_date": counted.end_text},
        "previous_period": {"start_date": before.start_text, "end_date": before.end_text} if before else None,
        "vat_excluded": vat_registered,
        "profit_tax_percent": tax_percent,
        # The salaries are hidden from this viewer: the margins are without them.
        "payroll_left_out": not visibility.get("payroll", True) and company_modules(company)["payroll"],
        # No recurring cost followed: rent, utilities and subscriptions are
        # among the goods until the owner adds them.
        "no_recurring_costs": recurring_items == 0,
    }
    current = margins_service.margins_of(figures, tax_percent)
    if current is None:
        return {**answer, "available": False}
    before_margins = margins_service.margins_of(previous[0], tax_percent) if previous else None
    return {**answer, "available": True, **margins_service.with_change(current, before_margins)}


async def _nothing() -> None:
    return None


@router.get("/statistics/margins")
async def get_margins(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    """Gross, operating and net margin of the period (the current month when
    no dates are given)."""
    margins = await period_margins(current_user, start_date, end_date)
    if margins is None:
        raise HTTPException(status_code=403, detail="Нямате права да виждате печалбата")
    return margins

"""The VAT a business owes, on Home: the period's VAT to pay (the same
number as the statistics), the day it is paid by when the period is a
month, where a running month is heading, and last month's VAT while its
day - the 14th - has not passed yet (services/vat).

Only for a business registered for VAT, and for whoever sees the
statistics: VAT is neither pocket money nor an expense without invoice, so
it is the same for every viewer who sees the totals."""
from fastapi import APIRouter
from server import *
import server
from services import vat as vat_service
from services.business_calendar import add_months

router = APIRouter(prefix="/api")


def _month_text(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


async def period_vat(
    current_user: User, start_date: Optional[str] = None, end_date: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """The VAT of Home's period - None for a viewer who does not see the
    statistics; {"registered": False} for a business not registered for VAT."""
    if not get_financial_visibility(current_user)["statistics"]:
        return None
    try:
        period = Period.parse(start_date, end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Невалиден период")
    company_id, scope = await get_company_scope(current_user)
    company = await server.db.companies.find_one(
        {"id": company_id}, {"_id": 0, "vat_registered": 1, "vat_number": 1},
    ) if company_id else None
    if not company_vat_registered(company):
        return {"registered": False}

    today = server.today_local()
    counted = counted_period(period)
    totals = await period_totals(company_id, scope, current_user.user_id, counted)
    sales_vat = float(totals["fiscal_vat"]) + float(totals["issued_invoice_vat"])
    month = vat_service.calendar_month(period)
    running = period.contains(today)
    answer: Dict[str, Any] = {
        "registered": True,
        "period": {"start_date": counted.start_text, "end_date": counted.end_text},
        "sales_vat": round(sales_vat, 2),
        "purchase_vat": round(float(totals["invoice_vat"]), 2),
        "due": round(vat_due_of(totals), 2),
        "month": _month_text(*month) if month else None,
        "running": running,
        "pay_by": vat_service.pay_by(*month).isoformat() if month else None,
        "expected_due": None,
        "previous": None,
    }
    if not (month and running):
        return answer

    # Where the month is heading, at its pace so far.
    closed_weekdays, exceptions_map = await get_closed_days_lookup(company_id)
    open_days = [day for day in period.iter_days() if not is_date_closed(day.isoformat(), closed_weekdays, exceptions_map)]
    # The VAT of the purchases day by day; a fixed asset's is one-off.
    regular_purchase_vat = float(totals["invoice_total"]) - float(totals["invoice_net"])
    answer["expected_due"] = vat_service.expected_due(
        till_vat=float(totals["fiscal_vat"]),
        issued_vat=float(totals["issued_invoice_vat"]),
        purchase_vat=regular_purchase_vat,
        one_off_purchase_vat=float(totals["invoice_vat"]) - regular_purchase_vat,
        revenue_days=len(totals["revenue_days"]),
        open_days=len(open_days),
        open_days_so_far=sum(1 for day in open_days if day <= today),
    )

    # Last month's VAT, while it is still to be paid (by the 14th of this one).
    last_year, last_month = add_months(month[0], month[1], -1)
    last_pay_by = vat_service.pay_by(last_year, last_month)
    if today <= last_pay_by:
        last_totals = await period_totals(company_id, scope, current_user.user_id, Period.month(last_year, last_month))
        answer["previous"] = {
            "month": _month_text(last_year, last_month),
            "due": round(vat_due_of(last_totals), 2),
            "pay_by": last_pay_by.isoformat(),
        }
    return answer


@router.get("/statistics/vat")
async def get_vat(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    """The VAT to pay for the period (the current month when no dates are
    given), when it is paid by, and where a running month is heading."""
    answer = await period_vat(current_user, start_date, end_date)
    if answer is None:
        raise HTTPException(status_code=403, detail="Нямате права да виждате статистиката")
    return answer

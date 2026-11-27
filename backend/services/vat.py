"""The VAT a business owes, and when (Home): the month a period's VAT
belongs to, the day that month's VAT is paid by and - while the month
still runs - where it is heading. Only the arithmetic: routers/vat.py reads
the numbers (server.vat_due_of is the one formula for the VAT due)."""
from datetime import date
from typing import Optional, Tuple

from services.business_calendar import Period, add_months, days_in_month

# A month's VAT is declared and paid by the 14th of the month after (ЗДДС).
PAY_DAY = 14
# The open days a month has to have run before its end is foreseen, and
# the days of takings the till's pace is read from.
MIN_FORECAST_DAYS = 5
MIN_REVENUE_DAYS = 3


def calendar_month(period: Period) -> Optional[Tuple[int, int]]:
    """(year, month) when the period is one whole calendar month."""
    start, end = period.start, period.end
    if start.day != 1 or (start.year, start.month) != (end.year, end.month):
        return None
    if end.day != days_in_month(end.year, end.month):
        return None
    return start.year, start.month


def pay_by(year: int, month: int) -> date:
    """The day a month's VAT is paid by: the 14th of the month after."""
    next_year, next_month = add_months(year, month, 1)
    return date(next_year, next_month, PAY_DAY)


def expected_due(
    till_vat: float, issued_vat: float, purchase_vat: float, one_off_purchase_vat: float,
    revenue_days: int, open_days: int, open_days_so_far: int,
) -> Optional[float]:
    """Where a running month's VAT is heading, at its pace so far: the
    till's VAT by its average over the days entered, for every open day of
    the month; the purchases' by the open days gone by. The invoices issued
    so far, and a one-off purchase (a fixed asset), as they are. None too
    early in the month to tell."""
    if open_days <= 0 or open_days_so_far < MIN_FORECAST_DAYS:
        return None
    if till_vat and revenue_days < MIN_REVENUE_DAYS:
        return None
    till = till_vat / revenue_days * open_days if revenue_days else 0.0
    purchases = purchase_vat / open_days_so_far * open_days
    return round(till + issued_vat - purchases - one_off_purchase_vat, 2)

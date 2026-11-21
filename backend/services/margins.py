"""Profit margins of a period - how much of every euro of sales is left:

- gross margin: after the goods and materials bought to sell;
- operating margin: after running the business as well - payroll, the
  recurring costs (rent, utilities, subscriptions...) and depreciation;
- net margin: after the profit tax too.

Worked out for any business from what it enters (routers/margins.py); this
module is only the arithmetic: the margins of a period's figures, the period
they are compared with, and the profit tax rate."""
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, Optional

from services.business_calendar import OPEN_END, OPEN_START, Period, add_months, days_in_month

# The profit tax in Bulgaria: 10% of a company's profit (ЗКПО), 15% of a
# sole trader's (ЕТ, ЗДДФЛ) - unless the business sets its own rate (a
# patent tax, a loss carried over...).
COMPANY_PROFIT_TAX_PERCENT = 10.0
SOLE_TRADER_PROFIT_TAX_PERCENT = 15.0
MAX_PROFIT_TAX_PERCENT = 50.0
# "ЕТ" (or the Latin "ET") as a word of the business's name.
_SOLE_TRADER = re.compile(r"(?<!\w)(ЕТ|ET)(?!\w)")


@dataclass(frozen=True)
class Figures:
    """A period's figures, in euro - without VAT for a business that
    deducts it."""
    sales: float
    goods: float
    payroll: float
    recurring: float
    depreciation: float


def profit_tax_percent(company: Optional[dict]) -> float:
    """The business's own rate when it set one, else the law's for its
    legal form: a sole trader's when its name says ЕТ, a company's otherwise."""
    chosen = (company or {}).get("profit_tax_percent")
    if isinstance(chosen, (int, float)) and not isinstance(chosen, bool) and 0 <= chosen <= MAX_PROFIT_TAX_PERCENT:
        return float(chosen)
    if _SOLE_TRADER.search(str((company or {}).get("name") or "")):
        return SOLE_TRADER_PROFIT_TAX_PERCENT
    return COMPANY_PROFIT_TAX_PERCENT


def margins_of(figures: Figures, tax_percent: float) -> Optional[Dict[str, Any]]:
    """The three margins of a period's figures, and the profit each leaves -
    None without sales to measure them by. No tax on a loss."""
    if figures.sales <= 0:
        return None
    gross = figures.sales - figures.goods
    operating = gross - figures.payroll - figures.recurring - figures.depreciation
    tax = max(operating, 0.0) * tax_percent / 100
    net = operating - tax

    def margin(profit: float) -> Dict[str, Any]:
        return {"percent": round(profit / figures.sales * 100, 1), "profit": round(profit, 2), "change": None}

    return {
        "sales": round(figures.sales, 2),
        "costs": {
            "goods": round(figures.goods, 2),
            "payroll": round(figures.payroll, 2),
            "recurring": round(figures.recurring, 2),
            "depreciation": round(figures.depreciation, 2),
            "profit_tax": round(tax, 2),
        },
        "gross": margin(gross),
        "operating": margin(operating),
        "net": margin(net),
    }


def with_change(current: Dict[str, Any], previous: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Each margin's change since the period before, in percentage points -
    None when that period had no sales."""
    if previous:
        for key in ("gross", "operating", "net"):
            current[key]["change"] = round(current[key]["percent"] - previous[key]["percent"], 1)
    return current


def _whole_months(period: Period) -> int:
    """How many whole calendar months the period is - 0 when it is not."""
    if period.start.day != 1 or period.end.day != days_in_month(period.end.year, period.end.month):
        return 0
    return (period.end.year - period.start.year) * 12 + period.end.month - period.start.month + 1


def _months_back(day: date, months: int) -> date:
    """The same day so many months before - a month's last day stays its
    month's last day."""
    year, month = add_months(day.year, day.month, -months)
    last = days_in_month(year, month)
    if day.day == days_in_month(day.year, day.month):
        return date(year, month, last)
    return date(year, month, min(day.day, last))


def previous_period(period: Period, counted: Period) -> Optional[Period]:
    """What a period's margins are compared with: the period before it, as
    far into it as this one has gone - a month so far with the month before
    through the same day, a year with the year before, a week or a few days
    with the same days just before them. None for an open period."""
    if period.start <= OPEN_START or period.end >= OPEN_END:
        return None
    months = _whole_months(period)
    if months:
        return Period(_months_back(counted.start, months), _months_back(counted.end, months))
    shift = timedelta(days=period.days)
    return Period(counted.start - shift, counted.end - shift)

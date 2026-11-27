"""Cash flow for the weeks ahead (Н1/П1): will the money last?

From the money the business has now (cash and bank, as the owner entered
it) day by day forward: plus what customers owe by its due date and the
usual till revenue of that weekday; minus the supplier invoices by their
due date (an overdue one today), the recurring expenses on their day, the
payroll on its pay day and the VAT by the 14th. The lowest point and its
date, and the first day below zero, weeks before they come.

Every amount is counted once: an invoice that already came for a
recurring expense is the invoice, a month's payroll already recorded is
not expected again, a receivable overdue is not counted as coming (it is
shown apart - money that may come). This module only works the days out;
server.cash_flow_projection gathers what goes in."""
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable, Dict, List, Optional

# The kinds of what comes and goes, for the screen and the assistant.
RECEIVABLE = "receivable"
REVENUE = "revenue"
INVOICE = "invoice"
RECURRING = "recurring"
PAYROLL = "payroll"
VAT = "vat"
# An invoice that repeats (routers/recurring_invoices), not issued yet for its month.
SUBSCRIPTION = "subscription"
# Company money spent personally, coming due (the personal notebook) - for its viewers only.
PERSONAL = "personal"


@dataclass
class CashEvent:
    day: date
    amount: float  # money in above zero, money out below
    kind: str
    label: str
    overdue: bool = False


def project(
    start_balance: float,
    today: date,
    days: int,
    events: List[CashEvent],
    weekday_revenue: Dict[int, float],
    is_closed: Callable[[date], bool],
    revenue_from: date,
) -> dict:
    """The days from today on: what comes in and goes out each day and the
    money at its end, with the lowest point and the first day below zero.
    An event before today (overdue) counts today; one after the last day
    does not count."""
    end = today + timedelta(days=days - 1)
    by_day: Dict[date, List[CashEvent]] = defaultdict(list)
    counted: List[CashEvent] = []
    for event in events:
        day = max(event.day, today)
        if day > end:
            continue
        by_day[day].append(event)
        counted.append(CashEvent(day, event.amount, event.kind, event.label, event.overdue))

    balance = start_balance
    series = []
    lowest_day, lowest = today, start_balance
    first_negative: Optional[date] = None
    total_in = total_out = total_revenue = 0.0
    for offset in range(days):
        day = today + timedelta(days=offset)
        revenue = 0.0 if day < revenue_from or is_closed(day) else float(weekday_revenue.get(day.weekday(), 0.0))
        money_in = revenue + sum(e.amount for e in by_day[day] if e.amount > 0)
        money_out = -sum(e.amount for e in by_day[day] if e.amount < 0)
        balance += money_in - money_out
        total_in += money_in
        total_out += money_out
        total_revenue += revenue
        series.append({
            "date": day.isoformat(), "in": round(money_in, 2), "out": round(money_out, 2),
            "revenue": round(revenue, 2), "balance": round(balance, 2),
        })
        if balance < lowest:
            lowest_day, lowest = day, balance
        if first_negative is None and balance < 0:
            first_negative = day

    counted.sort(key=lambda e: (e.day, e.amount))
    return {
        "from": today.isoformat(), "to": end.isoformat(), "days": days,
        "start_balance": round(start_balance, 2), "end_balance": round(balance, 2),
        "lowest": {"date": lowest_day.isoformat(), "balance": round(lowest, 2)},
        "first_negative": first_negative.isoformat() if first_negative else None,
        "total_in": round(total_in, 2), "total_out": round(total_out, 2),
        "usual_revenue_total": round(total_revenue, 2),
        "series": series,
        "events": [
            {"date": e.day.isoformat(), "amount": round(e.amount, 2), "kind": e.kind, "label": e.label, "overdue": e.overdue}
            for e in counted
        ],
    }


def weekday_averages(rows: List[dict], minimum_days: int = 7) -> Dict[int, float]:
    """The usual till revenue of each weekday: the average of the days it
    was entered. Too few days entered say nothing (an empty answer)."""
    by_weekday: Dict[int, List[float]] = defaultdict(list)
    for row in rows:
        try:
            day = date.fromisoformat(str(row.get("date"))[:10])
        except ValueError:
            continue
        by_weekday[day.weekday()].append(float(row.get("fiscal_revenue") or 0))
    if sum(len(values) for values in by_weekday.values()) < minimum_days:
        return {}
    return {weekday: sum(values) / len(values) for weekday, values in by_weekday.items() if values}


def usual_pay_day(days_of_month: List[int]) -> Optional[int]:
    """The day of the month a business usually pays salaries, from the days
    it recorded them: the middle one."""
    if not days_of_month:
        return None
    ordered = sorted(days_of_month)
    return ordered[len(ordered) // 2]

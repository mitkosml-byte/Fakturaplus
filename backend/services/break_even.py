"""Break-even and the day's target (Н5): the month's fixed costs divided by
the usual margin - what has to be sold for the month to end at zero - and
what that asks of each day still ahead.

- Fixed costs: what the month costs whatever is sold - payroll, the
  recurring expenses (rent, subscriptions, insurance...), depreciation.
- Margin: of each euro sold, what is left after the costs that follow the
  sales (goods, materials - every other invoice and expense), measured over
  the last full months so one big delivery does not swing it.
- Break-even: fixed costs / margin. The day's target: what is still missing
  to it, spread over the working days left.

The same income and expenses as the profit on Home (server.period_totals)
- this only works the numbers out; server.break_even_for gathers them."""
from typing import List, Optional

# Fewer months (or days of revenue) than this say too little about the margin.
MIN_REVENUE_DAYS = 14


def usual_margin(months: List[dict]) -> Optional[float]:
    """The share of income left after variable costs, over the months that
    had income; None when there was none. Each month is {"income",
    "variable"}."""
    income = sum(float(m.get("income") or 0) for m in months)
    if income <= 0:
        return None
    variable = sum(max(float(m.get("variable") or 0), 0.0) for m in months)
    return min(1.0, 1.0 - variable / income)


def work_out(
    fixed_costs: float, margin: float, income_before_today: float, income_today: float,
    open_days_from_today: int, today_is_open: bool,
) -> dict:
    """The month's break-even income, how far the month is, and the target
    for today (or for each day left, when today the business is closed)."""
    break_even = fixed_costs / margin
    income_so_far = income_before_today + income_today
    missing_before_today = max(break_even - income_before_today, 0.0)
    missing_now = max(break_even - income_so_far, 0.0)
    daily_target = missing_before_today / open_days_from_today if open_days_from_today > 0 else 0.0
    return {
        "break_even_income": round(break_even, 2),
        "income_so_far": round(income_so_far, 2),
        "missing": round(missing_now, 2),
        "above": round(max(income_so_far - break_even, 0.0), 2),
        "reached": income_so_far >= break_even,
        "open_days_left": open_days_from_today,
        "today_is_open": today_is_open,
        # What each working day from today on has to bring; today's own
        # sales so far are set against it.
        "daily_target": round(daily_target, 2),
        "income_today": round(income_today, 2),
        "progress": round(min(income_so_far / break_even, 1.0), 4) if break_even > 0 else 1.0,
    }

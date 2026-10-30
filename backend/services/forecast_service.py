"""AI Forecasting service for expense/revenue predictions"""
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Optional
from collections import defaultdict
import statistics

# Below this many months of history, a trend computed any way at all is
# mostly noise dressed up as a number - with 2-3 points, a single unusual
# month (a partial founding month, a one-off purchase) can swing a
# half/half comparison by hundreds of percent. Below the gate, forecasts
# are still returned (a flat average is a defensible number even from one
# month), just without a trend claim riding on top of it.
MIN_MONTHS_FOR_TREND = 4

# Lookback presets a caller (the API layer) can map UI buttons to -
# "1/3/6/12 months" - expressed as days so the service only needs one
# knob (lookback_days) regardless of which preset or custom range it came
# from.
LOOKBACK_DAYS_DEFAULT = 180  # unchanged default (6 months) when nothing is specified


def _ym_add(year: int, month: int, delta: int) -> tuple:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1

def _ym_diff(y1: int, m1: int, y2: int, m2: int) -> int:
    return (y2 * 12 + m2) - (y1 * 12 + m1)

def _asset_depreciation_for_month(asset: dict, year: int, month: int) -> float:
    """Same linear-depreciation logic as server.py's
    get_asset_depreciation_for_month, duplicated here since this service
    is self-contained and doesn't import from server.py."""
    d = datetime.fromisoformat(asset["in_service_date"][:10])
    start_y, start_m = _ym_add(d.year, d.month, 1)
    if (year, month) < (start_y, start_m):
        return 0.0
    if asset.get("status") == "disposed" and asset.get("disposal_date"):
        dd = datetime.fromisoformat(asset["disposal_date"][:10])
        if (year, month) > (dd.year, dd.month):
            return 0.0
    monthly = asset["acquisition_value"] * (asset["annual_depreciation_rate_percent"] / 100) / 12
    if monthly <= 0:
        return 0.0
    elapsed = _ym_diff(start_y, start_m, year, month) + 1
    accumulated_before = monthly * (elapsed - 1)
    if accumulated_before >= asset["acquisition_value"]:
        return 0.0
    remaining = asset["acquisition_value"] - accumulated_before
    return round(min(monthly, remaining), 2)


def _resolve_window(
    lookback_days: Optional[int], start_date: Optional[str], end_date: Optional[str]
) -> tuple:
    """Turns whatever the caller passed (a lookback-days preset, an
    explicit custom start/end, or nothing) into a concrete (start, end)
    datetime pair. An explicit start_date/end_date (the "custom period"
    case) always wins over lookback_days; lookback_days alone (the preset
    buttons) counts back from now; nothing at all keeps the original
    6-month default so an un-migrated caller behaves exactly as before."""
    now = datetime.now(timezone.utc)
    end = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) if end_date else now
    if start_date:
        start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
    else:
        days = lookback_days if lookback_days and lookback_days > 0 else LOOKBACK_DAYS_DEFAULT
        start = end - timedelta(days=days)
    return start, end


def _robust_trend(amounts: List[float]) -> tuple:
    """Theil-Sen slope (the median of every pairwise slope between two
    points) over the whole window, one point per month, instead of a
    first-half/second-half mean comparison. A plain least-squares line
    does better than two bucket means but is still pulled hard by a
    single outlier AT THE EDGE of a short window (the endpoint carries
    the most leverage in OLS); the median-of-slopes is the standard fix -
    one bad month shifts only the handful of pairwise slopes that touch
    it, and the median shrugs those off as long as it's not most of the
    data, instead of the whole fit bending toward it.

    Returns (slope, fitted_value_at_last_point, trend_percent,
    trend_label). trend_percent is the implied total change across the
    window, as a percent of the average level - same reading as before
    ("+18% over the period"), just computed far more resistantly."""
    n = len(amounts)
    avg = statistics.mean(amounts)
    pairwise_slopes = [
        (amounts[j] - amounts[i]) / (j - i)
        for i in range(n) for j in range(i + 1, n)
    ]
    slope = statistics.median(pairwise_slopes)
    intercept = statistics.median(amounts[i] - slope * i for i in range(n))
    fitted_last = intercept + slope * (n - 1)

    trend_percent = (slope * (n - 1) / avg * 100) if avg > 0 else 0.0
    if trend_percent > 10:
        trend_label = "increasing"
    elif trend_percent < -10:
        trend_label = "decreasing"
    else:
        trend_label = "stable"
    return slope, fitted_last, round(trend_percent, 1), trend_label


def _build_forecast(
    historical: List[Dict], months_ahead: int
) -> Dict:
    """Shared forecast/confidence logic for both expense and revenue
    forecasts - the only thing that differs between them is how
    `historical` gets built (invoices+expenses+payroll+depreciation vs.
    daily_revenue), not how it's projected forward."""
    if not historical:
        return {
            "historical": [],
            "forecast": [],
            "avg_monthly": 0,
            "trend": "stable",
            "confidence": 0,
        }

    amounts = [h["amount"] for h in historical]
    avg_monthly = statistics.mean(amounts)
    std_dev = statistics.stdev(amounts) if len(amounts) > 1 else 0
    confidence = min(0.9, len(amounts) / 6)  # unchanged - more months = higher confidence

    current_date = datetime.now(timezone.utc)
    forecast = []

    if len(amounts) < MIN_MONTHS_FOR_TREND:
        # Not enough history to say anything about direction - report the
        # honest state instead of the old code's silent "stable" (which
        # read as "checked, and it's flat" when really no trend was ever
        # computed at all), and project forward flat rather than
        # compounding a trend_percent that would only be noise here.
        trend = "insufficient_data"
        trend_percent = 0.0
        for i in range(1, months_ahead + 1):
            future_date = current_date + timedelta(days=30 * i)
            forecast.append({
                "month": future_date.strftime("%Y-%m"),
                "predicted_amount": round(avg_monthly, 2),
                "lower_bound": round(max(0, avg_monthly - std_dev), 2),
                "upper_bound": round(avg_monthly + std_dev, 2),
            })
    else:
        slope, fitted_last, trend_percent, trend = _robust_trend(amounts)
        for i in range(1, months_ahead + 1):
            future_date = current_date + timedelta(days=30 * i)
            predicted = max(0, fitted_last + slope * i)
            forecast.append({
                "month": future_date.strftime("%Y-%m"),
                "predicted_amount": round(predicted, 2),
                "lower_bound": round(max(0, predicted - std_dev), 2),
                "upper_bound": round(predicted + std_dev, 2),
            })

    return {
        "historical": historical,
        "forecast": forecast,
        "avg_monthly": round(avg_monthly, 2),
        "trend": trend,
        "trend_percent": trend_percent,
        "confidence": round(confidence, 2),
        "months_of_history": len(amounts),
        "min_months_for_trend": MIN_MONTHS_FOR_TREND,
    }


class ForecastService:
    def __init__(self, db):
        self.db = db

    async def get_expense_forecast(
        self,
        company_id: str,
        months_ahead: int = 3,
        include_off_book_expenses: bool = True,
        lookback_days: Optional[int] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict:
        """Predict future expenses based on historical data.

        include_off_book_expenses=False excludes db.expenses ("в канала")
        from the monthly totals, for a caller whose viewer lacks
        view_off_book_expenses - otherwise the forecast's avg_monthly/trend
        would leak that data through an aggregate even though no raw record
        is ever returned.

        lookback_days (a preset like 30/90/180/365) or an explicit
        start_date/end_date (a custom range) controls how far back the
        history window reaches - previously hardcoded to 180 days with no
        way to change it, which made the forecast's own trend maths
        actively misleading for a company under 6 months old (see the
        Module 4 audit finding this replaced)."""
        window_start, window_end = _resolve_window(lookback_days, start_date, end_date)
        window_start_str = window_start.strftime("%Y-%m-%d")

        # expenses/daily_revenue are keyed by user_id, not company_id, so
        # resolve the company's member user_ids to include everyone's entries
        company_users = await self.db.users.find(
            {"company_id": company_id}, {"_id": 0, "user_id": 1}
        ).to_list(1000)
        user_ids = [u["user_id"] for u in company_users]

        # Get invoice expenses
        invoices = await self.db.invoices.find(
            {"company_id": company_id, "date": {"$gte": window_start, "$lte": window_end}},
            {"_id": 0, "date": 1, "total_amount": 1}
        ).to_list(10000)

        # Get non-invoice expenses (date is stored as a "YYYY-MM-DD" string)
        expenses = await self.db.expenses.find(
            {"user_id": {"$in": user_ids}, "date": {"$gte": window_start_str}},
            {"_id": 0, "date": 1, "amount": 1}
        ).to_list(10000) if include_off_book_expenses else []

        # Payroll cost (gross + employer contributions + benefits) - usually
        # the most stable, predictable expense a business has
        payroll_entries = await self.db.payroll_entries.find(
            {"company_id": company_id},
            {"_id": 0, "period_month": 1, "period_year": 1, "total_employer_cost": 1}
        ).to_list(10000)

        # Aggregate by month
        monthly_totals: Dict[str, float] = defaultdict(float)

        for inv in invoices:
            date = inv.get("date")
            if isinstance(date, datetime):
                month_key = date.strftime("%Y-%m")
                monthly_totals[month_key] += float(inv.get("total_amount", 0))

        for exp in expenses:
            date_str = exp.get("date")
            if isinstance(date_str, str) and len(date_str) >= 7:
                month_key = date_str[:7]
                monthly_totals[month_key] += float(exp.get("amount", 0))

        for p in payroll_entries:
            month_key = f"{p['period_year']}-{p['period_month']:02d}"
            if month_key >= window_start_str[:7]:
                monthly_totals[month_key] += float(p.get("total_employer_cost", 0))

        # Depreciation expense (ДМА) - deterministic per-asset schedule,
        # folded into the same history window the average/trend is based on
        assets = await self.db.assets.find(
            {"company_id": company_id}, {"_id": 0}
        ).to_list(1000)

        y, m = window_start.year, window_start.month
        while (y, m) <= (window_end.year, window_end.month):
            month_key = f"{y}-{m:02d}"
            month_total = sum(_asset_depreciation_for_month(a, y, m) for a in assets)
            if month_total:
                monthly_totals[month_key] += month_total
            y, m = _ym_add(y, m, 1)

        sorted_months = sorted(monthly_totals.keys())
        historical = [{"month": mk, "amount": monthly_totals[mk]} for mk in sorted_months]
        return _build_forecast(historical, months_ahead)

    async def get_revenue_forecast(
        self,
        company_id: str,
        months_ahead: int = 3,
        lookback_days: Optional[int] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict:
        """Predict future revenue based on historical data. See
        get_expense_forecast's docstring for lookback_days/start_date/
        end_date - same adjustable-window fix, same reasoning."""
        window_start, _window_end = _resolve_window(lookback_days, start_date, end_date)
        window_start_str = window_start.strftime("%Y-%m-%d")

        # daily_revenue is keyed by user_id, not company_id
        company_users = await self.db.users.find(
            {"company_id": company_id}, {"_id": 0, "user_id": 1}
        ).to_list(1000)
        user_ids = [u["user_id"] for u in company_users]

        revenues = await self.db.daily_revenue.find(
            {"user_id": {"$in": user_ids}, "date": {"$gte": window_start_str}},
            {"_id": 0, "date": 1, "fiscal_revenue": 1}
        ).to_list(10000)

        # Aggregate by month (date is stored as a "YYYY-MM-DD" string)
        monthly_totals: Dict[str, float] = defaultdict(float)

        for rev in revenues:
            date_str = rev.get("date")
            if isinstance(date_str, str) and len(date_str) >= 7:
                month_key = date_str[:7]
                monthly_totals[month_key] += float(rev.get("fiscal_revenue", 0))

        sorted_months = sorted(monthly_totals.keys())
        historical = [{"month": mk, "amount": monthly_totals[mk]} for mk in sorted_months]
        return _build_forecast(historical, months_ahead)

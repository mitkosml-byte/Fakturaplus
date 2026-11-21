"""AI Forecasting service for expense/revenue predictions"""
from datetime import datetime, timedelta, timezone
from typing import Any, List, Dict, Optional
from collections import defaultdict
import calendar
import statistics

from services.business_calendar import Period, business_day, day_start_utc, days_in_month, now_local, today_local
from services import recurring_service

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

# Year-back reading. Some businesses run on a yearly rhythm - a strong
# summer, a quiet January, an insurance bill every March - and a straight
# trend line through the last months reads such a turn as growth or a
# fall. The year-back reading predicts a month from the same month last
# year, scaled by how this year has been running against last year. It is
# used only when the company's OWN history shows it works: scored on its
# most recent months, it must have been clearly more accurate than the
# trend line. Nothing about any trade or season is assumed.
SEASONAL_HISTORY_MONTHS = 36
SEASONAL_MAX_SCORED_MONTHS = 12  # a whole yearly cycle, turns included
SEASONAL_MIN_SCORED_MONTHS = 3
SEASONAL_WIN_RATIO = 0.75  # its error at most 3/4 of the trend line's...
SEASONAL_MIN_ERROR_GAIN = 0.05  # ...and at least 5 points lower
SEASONAL_LEVEL_MONTHS = 3  # recent months that set this year's level against last year's
SEASONAL_TREND_WINDOW = 6  # months the trend line is fitted on when scored (the default window)
SEASONAL_MIN_MARGIN = 0.05
# A month counts as known revenue when revenue was entered on at least this
# share of its open days (days not marked closed) - a month logged for a
# week says nothing about how the month went.
REVENUE_MONTH_MIN_COVERAGE = 0.6
# The month in progress joins the history as its expected end once this
# many of its days have passed - earlier, a pace says too little.
CURRENT_MONTH_MIN_DAYS = 7
# ...and its revenue pace needs at least this many days entered.
CURRENT_MONTH_MIN_ENTERED_DAYS = 3
# Months are read from their entered days only for a company that enters
# revenue day by day - entered on at least this share of its open days over
# the last DAILY_LOGGING_LOOKBACK_DAYS. One that enters a week's or a
# month's takings at once has no "missing days": its months count as entered.
DAILY_LOGGING_MIN_COVERAGE = 0.5
DAILY_LOGGING_LOOKBACK_DAYS = 90


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


def _month_start(year: int, month: int) -> datetime:
    return datetime(year, month, 1, tzinfo=timezone.utc)


def _resolve_window(
    lookback_days: Optional[int], start_date: Optional[str], end_date: Optional[str]
) -> tuple:
    """Turns whatever the caller passed (a lookback-days preset, an
    explicit custom start/end, or nothing) into a concrete
    (start, end_exclusive) pair of month starts. An explicit
    start_date/end_date (the "custom period" case) always wins over
    lookback_days; lookback_days alone (the preset buttons) counts back
    whole months (30 -> 1, 90 -> 3, 180 -> 6, 365 -> 12) from the last
    complete one; nothing at all keeps the 6-month default.

    Only whole calendar months, and never the month in progress: a
    half-finished month counted as a whole one made every forecast read
    as a sharp fall in the first days of each month, and a window that
    started mid-month did the same to its first month."""
    today = today_local()
    current_month = _month_start(today.year, today.month)
    end_exclusive = current_month
    if end_date:
        # A month counts only if the range runs through its last day.
        after_end = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc) + timedelta(days=1)
        end_exclusive = min(current_month, _month_start(after_end.year, after_end.month))
    if start_date:
        start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
        y, m = _ym_add(start.year, start.month, 0 if start.day == 1 else 1)
    else:
        days = lookback_days if lookback_days and lookback_days > 0 else LOOKBACK_DAYS_DEFAULT
        months = max(1, round(days / 30.44))
        y, m = _ym_add(end_exclusive.year, end_exclusive.month, -months)
    return _month_start(y, m), end_exclusive


def _drop_partial_first_month(monthly_totals: Dict[str, float], first_activity: Optional[datetime]) -> None:
    """The month a company started recording (if it started after the 3rd)
    holds only part of a month's business - a weak first month followed by
    what looks like 30% "growth". Left out once other months exist to
    forecast from; kept when it is the only month there is."""
    if not first_activity or first_activity.day <= 3:
        return
    key = first_activity.strftime("%Y-%m")
    if key in monthly_totals and len(monthly_totals) > 1:
        del monthly_totals[key]


def _ym_parts(key: str) -> tuple:
    return int(key[:4]), int(key[5:7])


def _month_key(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def _theil_sen_at(points: List[tuple], x: float) -> float:
    """Median-of-slopes line through (x, y) points, read at x."""
    slopes = [
        (y2 - y1) / (x2 - x1)
        for i, (x1, y1) in enumerate(points) for (x2, y2) in points[i + 1:] if x2 != x1
    ]
    slope = statistics.median(slopes) if slopes else 0.0
    intercept = statistics.median(py - slope * px for px, py in points)
    return intercept + slope * x


def _level_ratio(series: Dict[str, float], year: int, month: int) -> Optional[float]:
    """How this year runs against last year just before (year, month): the
    known months among the SEASONAL_LEVEL_MONTHS before it, over the same
    months a year earlier."""
    now_sum = before_sum = 0.0
    for back in range(1, SEASONAL_LEVEL_MONTHS + 1):
        current = series.get(_month_key(*_ym_add(year, month, -back)))
        year_before = series.get(_month_key(*_ym_add(year, month, -back - 12)))
        if current is None or year_before is None:
            continue
        now_sum += current
        before_sum += year_before
    if before_sum <= 0:
        return None
    return now_sum / before_sum


def _year_back_prediction(series: Dict[str, float], year: int, month: int, level: Optional[float]) -> Optional[float]:
    same_month_last_year = series.get(_month_key(*_ym_add(year, month, -12)))
    if same_month_last_year is None or level is None:
        return None
    return max(0.0, same_month_last_year * level)


def _trend_prediction(series: Dict[str, float], year: int, month: int) -> Optional[float]:
    """What the trend line through the SEASONAL_TREND_WINDOW months before
    (year, month) said about it - the reading the year-back one is scored
    against (a flat average below MIN_MONTHS_FOR_TREND, like _build_forecast)."""
    points = [
        (float(-back), series[key])
        for back in range(SEASONAL_TREND_WINDOW, 0, -1)
        if (key := _month_key(*_ym_add(year, month, -back))) in series
    ]
    if len(points) < 2:
        return None
    if len(points) < MIN_MONTHS_FOR_TREND:
        return statistics.mean(p[1] for p in points)
    return max(0.0, _theil_sen_at(points, 0.0))


def _year_back_analysis(series: Dict[str, float], now: datetime) -> Optional[Dict[str, Any]]:
    """Scores the year-back reading against the trend line on the company's
    last SEASONAL_MAX_SCORED_MONTHS known months (each predicted only from
    the months before it). None when too few months can be scored - under
    about 16 months of history - so nothing is claimed either way."""
    scored = []
    for back in range(1, SEASONAL_MAX_SCORED_MONTHS + 1):
        year, month = _ym_add(now.year, now.month, -back)
        actual = series.get(_month_key(year, month))
        if actual is None:
            continue
        year_back = _year_back_prediction(series, year, month, _level_ratio(series, year, month))
        trend = _trend_prediction(series, year, month)
        if year_back is None or trend is None:
            continue
        scored.append((actual, year_back, trend))
    if len(scored) < SEASONAL_MIN_SCORED_MONTHS:
        return None
    total = sum(actual for actual, _, _ in scored)
    if total <= 0:
        return None
    year_back_error = sum(abs(predicted - actual) for actual, predicted, _ in scored) / total
    trend_error = sum(abs(predicted - actual) for actual, _, predicted in scored) / total
    level = _level_ratio(series, now.year, now.month)
    last_12 = [
        series[key] for back in range(1, 13)
        if (key := _month_key(*_ym_add(now.year, now.month, -back))) in series
    ]
    return {
        "confirmed": (
            level is not None
            and year_back_error <= trend_error * SEASONAL_WIN_RATIO
            and trend_error - year_back_error >= SEASONAL_MIN_ERROR_GAIN
        ),
        "error": round(year_back_error, 3),
        "trend_error": round(trend_error, 3),
        "months_scored": len(scored),
        "level_ratio": round(level, 3) if level is not None else None,
        "last_12_months_average": round(statistics.mean(last_12), 2) if last_12 else None,
        "series": series,
    }


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


def _expense_counted(expense: dict, include_off_book_expenses: bool, include_payroll: bool) -> bool:
    """A record of db.expenses in a viewer's expense forecast: wages paid
    through Work Schedule are payroll (for who keeps the payroll), every
    other one an expense without invoice (for who may see those)."""
    if expense.get("kind") == "schedule_wages":
        return include_payroll
    return include_off_book_expenses


def _build_forecast(
    historical: List[Dict], months_ahead: int, year_back: Optional[Dict[str, Any]] = None
) -> Dict:
    """Shared forecast/confidence logic for both expense and revenue
    forecasts - the only thing that differs between them is how
    `historical` gets built (invoices+expenses+payroll+depreciation vs.
    daily_revenue), not how it's projected forward.

    History ends with the last COMPLETE month, so forecast[0] is still
    next calendar month: the projection steps over the month in progress
    (fitted_last + slope x months from the last historical month)."""
    if not historical:
        return {
            "historical": [],
            "forecast": [],
            "avg_monthly": 0,
            "trend": "stable",
            "confidence": 0,
            "method": "average",
            "vs_last_year_percent": None,
            "year_back": None,
        }

    amounts = [h["amount"] for h in historical]
    avg_monthly = statistics.mean(amounts)
    std_dev = statistics.stdev(amounts) if len(amounts) > 1 else 0
    confidence = min(0.9, len(amounts) / 6)  # unchanged - more months = higher confidence

    current_date = today_local()
    last_y, last_m = (int(part) for part in historical[-1]["month"].split("-"))
    targets = [_ym_add(current_date.year, current_date.month, i) for i in range(1, months_ahead + 1)]
    forecast = []

    if len(amounts) < MIN_MONTHS_FOR_TREND:
        # Not enough history to say anything about direction - report the
        # honest state instead of the old code's silent "stable" (which
        # read as "checked, and it's flat" when really no trend was ever
        # computed at all), and project forward flat rather than
        # compounding a trend_percent that would only be noise here.
        trend = "insufficient_data"
        trend_percent = 0.0
        for ty, tm in targets:
            forecast.append({
                "month": f"{ty}-{tm:02d}",
                "predicted_amount": round(avg_monthly, 2),
                "lower_bound": round(max(0, avg_monthly - std_dev), 2),
                "upper_bound": round(avg_monthly + std_dev, 2),
            })
    else:
        slope, fitted_last, trend_percent, trend = _robust_trend(amounts)
        for ty, tm in targets:
            predicted = max(0, fitted_last + slope * _ym_diff(last_y, last_m, ty, tm))
            forecast.append({
                "month": f"{ty}-{tm:02d}",
                "predicted_amount": round(predicted, 2),
                "lower_bound": round(max(0, predicted - std_dev), 2),
                "upper_bound": round(predicted + std_dev, 2),
            })

    method = "average" if len(amounts) < MIN_MONTHS_FOR_TREND else "trend"
    year_back_info = None
    if year_back:
        year_back_info = {k: v for k, v in year_back.items() if k != "series"}
        if year_back["confirmed"]:
            # This company's months follow last year's: each target month is
            # last year's same month at this year's level, within the error
            # the reading actually had on recent months.
            margin = max(year_back["error"], SEASONAL_MIN_MARGIN)
            for entry, (ty, tm) in zip(forecast, targets):
                predicted_year_back = _year_back_prediction(year_back["series"], ty, tm, year_back["level_ratio"])
                if predicted_year_back is None:
                    continue
                entry.update({
                    "predicted_amount": round(predicted_year_back, 2),
                    "lower_bound": round(predicted_year_back * (1 - margin), 2),
                    "upper_bound": round(predicted_year_back * (1 + margin), 2),
                    "basis": "year_back",
                    "same_month_last_year": round(year_back["series"][_month_key(*_ym_add(ty, tm, -12))], 2),
                })
                method = "year_back"

    return {
        "historical": historical,
        "forecast": forecast,
        "avg_monthly": round(avg_monthly, 2),
        "trend": trend,
        "trend_percent": trend_percent,
        "confidence": round(confidence, 2),
        "months_of_history": len(amounts),
        "min_months_for_trend": MIN_MONTHS_FOR_TREND,
        # "year_back" when at least the next month is read from last year's
        # same month (see _year_back_analysis), "trend" or "average" otherwise.
        "method": method,
        "vs_last_year_percent": (
            round((year_back["level_ratio"] - 1) * 100, 1)
            if method == "year_back" and year_back and year_back["level_ratio"] is not None else None
        ),
        "year_back": year_back_info,
    }


class ForecastService:
    def __init__(self, db):
        self.db = db

    async def _first_record_date(self, collection, query: dict) -> Optional[datetime]:
        docs = await collection.find(query, {"_id": 0, "date": 1}).sort("date", 1).limit(1).to_list(1)
        value = docs[0].get("date") if docs else None
        if isinstance(value, datetime):
            return value
        if isinstance(value, str) and len(value) >= 10:
            try:
                return datetime.fromisoformat(value[:10])
            except ValueError:
                return None
        return None

    async def _company_scope(self, company_id: str) -> dict:
        """The company's records - the same filter as server.company_data_scope
        (repeated here: server imports this module): everything carrying the
        company_id, plus older records without one from its current members.
        So the forecast counts exactly what /statistics/summary counts - a
        departed employee's entries included, which a filter by the current
        members' user_ids used to drop."""
        members = await self.db.users.find({"company_id": company_id}, {"_id": 0, "user_id": 1}).to_list(None)
        member_ids = [m["user_id"] for m in members]
        return {"$or": [{"company_id": company_id}, {"user_id": {"$in": member_ids}, "company_id": None}]}

    async def _closed_lookup(self, company_id: str) -> tuple:
        """(closed weekdays, {date: closed}) - the company's calendar, as
        server.get_closed_days_lookup reads it."""
        company = await self.db.companies.find_one({"id": company_id}, {"_id": 0, "closed_weekdays": 1})
        closed_weekdays = set((company or {}).get("closed_weekdays") or [])
        exceptions = {
            e["date"]: e["closed"] for e in await self.db.closed_date_exceptions.find(
                {"company_id": company_id}, {"_id": 0, "date": 1, "closed": 1}
            ).to_list(None)
        }
        return closed_weekdays, exceptions

    @staticmethod
    def _is_open(date_str: str, lookup: tuple) -> bool:
        closed_weekdays, exceptions = lookup
        if date_str in exceptions:
            return not exceptions[date_str]
        return datetime.strptime(date_str, "%Y-%m-%d").weekday() not in closed_weekdays

    async def _revenue_by_day(self, scope: dict, period: Period, include_pocket_money: bool) -> Dict[str, float]:
        """Revenue of each day entered in the period ("YYYY-MM-DD" -> EUR)."""
        rows = await self.db.daily_revenue.find(
            {**scope, "date": period.text_filter()}, {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1},
        ).to_list(None)
        by_day: Dict[str, float] = defaultdict(float)
        for row in rows:
            if isinstance(row.get("date"), str):
                by_day[row["date"][:10]] += float(row.get("fiscal_revenue", 0)) + (
                    float(row.get("pocket_money", 0)) if include_pocket_money else 0.0
                )
        return dict(by_day)

    async def _issued_by_month(self, scope: dict, period: Period) -> Dict[str, float]:
        """Invoices issued to customers in the period, by month ("YYYY-MM" ->
        EUR with VAT) - revenue of their issue date, the same documents as
        server.ISSUED_INVOICE_REVENUE (a cancelled one counts for nothing, one
        rung up at the till is in the till's revenue already, a credit note
        takes off). Known
        amounts: added to a month as they are, never spread over its days."""
        rows = await self.db.billing_documents.find(
            {**scope, "doc_type": {"$in": ["invoice", "credit_note"]}, "cancelled": {"$ne": True}, "in_till": {"$ne": True},
             "issue_date": period.text_filter()},
            {"_id": 0, "issue_date": 1, "total_amount": 1},
        ).to_list(None)
        totals: Dict[str, float] = defaultdict(float)
        for row in rows:
            day = str(row.get("issue_date") or "")
            if len(day) >= 7:
                totals[day[:7]] += float(row.get("total_amount") or 0)
        return dict(totals)

    def _estimate_from_entered_days(self, period: Period, by_day: Dict[str, float], lookup: tuple, upto=None) -> Dict[str, Any]:
        """A period's revenue read from the days that were entered: average of
        the entered open days x all open days, plus what was entered on
        closed days. A day nobody entered is unknown, never a zero day.
        `upto` limits "entered" to days up to it (a month in progress)."""
        open_days = [d.isoformat() for d in period.iter_days() if self._is_open(d.isoformat(), lookup)]
        seen = {d: v for d, v in by_day.items() if period.contains(business_day(d)) and (upto is None or d <= upto)}
        entered_open = [d for d in open_days if d in seen]
        open_total = sum(seen[d] for d in entered_open)
        closed_total = sum(v for d, v in seen.items() if d not in set(open_days))
        estimate = None
        if entered_open:
            estimate = open_total / len(entered_open) * len(open_days) + closed_total
        elif not open_days:
            estimate = closed_total
        return {
            "so_far": round(sum(seen.values()), 2), "estimate": estimate,
            "entered_days": len(seen), "open_days": len(open_days),
            "coverage": (len(entered_open) / len(open_days)) if open_days else 1.0,
        }

    async def _logs_revenue_daily(self, company_id: str, scope: dict) -> bool:
        """Whether the company enters revenue day by day: entered on at least
        DAILY_LOGGING_MIN_COVERAGE of its open days in the last
        DAILY_LOGGING_LOOKBACK_DAYS (counted from its first entry in them)."""
        today = today_local()
        window = Period(today - timedelta(days=DAILY_LOGGING_LOOKBACK_DAYS), today - timedelta(days=1))
        by_day = await self._revenue_by_day(scope, window, True)
        if not by_day:
            return False
        lookup = await self._closed_lookup(company_id)
        first = business_day(min(by_day))
        open_days = [d.isoformat() for d in Period(first, window.end).iter_days() if self._is_open(d.isoformat(), lookup)] if first else []
        return bool(open_days) and sum(1 for d in open_days if d in by_day) / len(open_days) >= DAILY_LOGGING_MIN_COVERAGE

    async def _revenue_month_estimates(
        self, company_id: str, scope: dict, window_start: datetime, window_end: datetime, include_pocket_money: bool,
        daily: bool,
    ) -> Dict[str, float]:
        """Every whole month in [window_start, window_end) with revenue.

        For a company that enters revenue day by day (`daily`), a month is
        read from its entered days (_estimate_from_entered_days) and is
        known only when entered on at least REVENUE_MONTH_MIN_COVERAGE of
        its open days - one with too few is left out as unknown rather than
        counted as a weak month. For one that enters takings in lumps, a
        month is what was entered in it."""
        if window_end <= window_start:
            return {}
        window = Period(window_start.date(), (window_end - timedelta(days=1)).date())
        by_day = await self._revenue_by_day(scope, window, include_pocket_money)
        # Invoices issued to customers: known amounts, added to their month.
        issued = await self._issued_by_month(scope, window)
        if not by_day:
            return dict(issued)
        if not daily:
            totals: Dict[str, float] = defaultdict(float)
            for day_str, amount in by_day.items():
                totals[day_str[:7]] += amount
            for month_key, amount in issued.items():
                totals[month_key] += amount
            return dict(totals)
        lookup = await self._closed_lookup(company_id)
        estimates: Dict[str, float] = {}
        for year, month in window.months():
            reading = self._estimate_from_entered_days(Period.month(year, month), by_day, lookup)
            if reading["entered_days"] and reading["estimate"] is not None and reading["coverage"] >= REVENUE_MONTH_MIN_COVERAGE:
                key = _month_key(year, month)
                estimates[key] = reading["estimate"] + issued.get(key, 0.0)
        return estimates

    async def _current_month_revenue(
        self, company_id: str, scope: dict, include_pocket_money: bool, daily: bool,
    ) -> Dict[str, Any]:
        """The month in progress: revenue so far (the same records and days as
        /statistics/summary for it) and - for a company that enters revenue
        day by day, once enough days are entered - its expected end, average
        per entered open day x all open days."""
        today = today_local()
        month = Period.month_of(today)
        so_far_period = Period(month.start, today)
        by_day = await self._revenue_by_day(scope, so_far_period, include_pocket_money)
        reading = self._estimate_from_entered_days(month, by_day, await self._closed_lookup(company_id), upto=today.isoformat())
        # Invoices issued so far are in the month as they are - not projected.
        issued_so_far = sum((await self._issued_by_month(scope, so_far_period)).values())
        expected = (
            reading["estimate"] + issued_so_far
            if daily and reading["estimate"] is not None and reading["entered_days"] >= CURRENT_MONTH_MIN_ENTERED_DAYS
            else None
        )
        return {
            "month": _month_key(today.year, today.month), "so_far": round(reading["so_far"] + issued_so_far, 2),
            "expected": round(expected, 2) if expected is not None else None,
            "days_entered": reading["entered_days"], "open_days": reading["open_days"],
            "days_elapsed": today.day, "days_in_month": month.days,
        }

    async def _current_month_expenses(
        self, company_id: str, scope: dict, include_off_book_expenses: bool, include_payroll: bool = True,
    ) -> Dict[str, Any]:
        """The month in progress: expenses so far - the same as
        /statistics/summary counts for it (invoices and off-book expenses to
        date, plus the elapsed days' share of the month's payroll and
        depreciation) - and the expected end: the invoices' and off-book
        pace over the whole month plus the month's payroll and depreciation.
        Payroll not entered yet for the month is taken from last month's."""
        today = today_local()
        month = Period.month_of(today)
        elapsed, dim = today.day, month.days
        invoices = await self.db.invoices.find(
            {**scope, "date": Period(month.start, today).datetime_filter(), "asset_id": None}, {"_id": 0, "total_amount": 1},
        ).to_list(None)
        variable = sum(float(i.get("total_amount", 0)) for i in invoices)
        # Off-book expenses only for who may see them; wages paid through
        # Work Schedule are payroll - for who keeps the payroll.
        expenses = await self.db.expenses.find(
            {**scope, "date": Period(month.start, today).text_filter()}, {"_id": 0, "amount": 1, "kind": 1},
        ).to_list(None)
        variable += sum(
            float(e.get("amount", 0)) for e in expenses
            if _expense_counted(e, include_off_book_expenses, include_payroll)
        )

        async def _payroll(year: int, mon: int) -> Optional[float]:
            entries = await self.db.payroll_entries.find(
                {"company_id": company_id, "period_year": year, "period_month": mon},
                {"_id": 0, "total_employer_cost": 1, "counted_in_expenses": 1},
            ).to_list(None)
            counted = [float(e.get("total_employer_cost", 0)) for e in entries if e.get("counted_in_expenses") is not False]
            return sum(counted) if counted else None

        payroll = await _payroll(today.year, today.month) if include_payroll else 0.0
        payroll_estimated = payroll is None
        if payroll is None:
            previous = Period.month_of(month.start - timedelta(days=1)).start
            payroll = await _payroll(previous.year, previous.month)
        assets = await self.db.assets.find({"company_id": company_id}, {"_id": 0}).to_list(None)
        depreciation = sum(_asset_depreciation_for_month(a, today.year, today.month) for a in assets)
        entered_fixed = (0.0 if payroll_estimated else (payroll or 0.0)) + depreciation
        # Recurring expenses (rent, subscriptions) as they are - paid or
        # still to come this month - never spread as a daily pace.
        recurring = await recurring_service.month_projection(
            self.db, company_id, scope, today.year, today.month, today, include_off_book_expenses,
        )
        paced = max(0.0, variable - recurring["paid_so_far"])
        return {
            "month": _month_key(today.year, today.month),
            "so_far": round(variable + entered_fixed * elapsed / dim, 2),
            "expected": round(paced * dim / elapsed + recurring["month_total"] + (payroll or 0.0) + depreciation, 2),
            "days_elapsed": elapsed, "days_in_month": dim,
            "payroll_from_last_month": payroll_estimated and payroll is not None,
        }

    async def _expense_monthly_totals(
        self, company_id: str, scope: dict, window_start: datetime, window_end: datetime,
        include_off_book_expenses: bool, include_payroll: bool = True,
    ) -> tuple:
        """(monthly expense totals in [window_start, window_end), the date of
        the company's first recorded expense)."""
        window_start_str = window_start.strftime("%Y-%m-%d")
        window_end_str = window_end.strftime("%Y-%m-%d")

        # Get invoice expenses
        # A fixed asset's invoice is expensed through its depreciation, not on its day.
        invoices = await self.db.invoices.find(
            {**scope, "date": {"$gte": window_start, "$lt": window_end}, "asset_id": None},
            {"_id": 0, "date": 1, "total_amount": 1}
        ).to_list(None)

        # Non-invoice expenses (date is stored as a "YYYY-MM-DD" string):
        # off-book ones only for who may see them; wages paid through Work
        # Schedule are payroll - for who keeps the payroll.
        expenses = await self.db.expenses.find(
            {**scope, "date": {"$gte": window_start_str, "$lt": window_end_str}},
            {"_id": 0, "date": 1, "amount": 1, "kind": 1}
        ).to_list(None)
        expenses = [e for e in expenses if _expense_counted(e, include_off_book_expenses, include_payroll)]

        # Payroll cost (gross + employer contributions + benefits) - usually
        # the most stable, predictable expense a business has; for who
        # keeps the payroll.
        payroll_entries = await self.db.payroll_entries.find(
            {"company_id": company_id},
            {"_id": 0, "period_month": 1, "period_year": 1, "total_employer_cost": 1, "counted_in_expenses": 1}
        ).to_list(None) if include_payroll else []

        # Aggregate by month
        monthly_totals: Dict[str, float] = defaultdict(float)

        for inv in invoices:
            day = business_day(inv.get("date")) if isinstance(inv.get("date"), datetime) else None
            if day:
                monthly_totals[day.strftime("%Y-%m")] += float(inv.get("total_amount", 0))

        for exp in expenses:
            date_str = exp.get("date")
            if isinstance(date_str, str) and len(date_str) >= 7:
                month_key = date_str[:7]
                monthly_totals[month_key] += float(exp.get("amount", 0))

        for p in payroll_entries:
            # An entry the owner excluded from expenses stays out here too,
            # as in /statistics/summary.
            if p.get("counted_in_expenses") is False:
                continue
            month_key = f"{p['period_year']}-{p['period_month']:02d}"
            if window_start_str[:7] <= month_key < window_end_str[:7]:
                monthly_totals[month_key] += float(p.get("total_employer_cost", 0))

        # Depreciation expense (ДМА) - deterministic per-asset schedule,
        # folded into the same history window the average/trend is based on
        assets = await self.db.assets.find(
            {"company_id": company_id}, {"_id": 0}
        ).to_list(None)

        y, m = window_start.year, window_start.month
        while (y, m) < (window_end.year, window_end.month):
            month_key = f"{y}-{m:02d}"
            month_total = sum(_asset_depreciation_for_month(a, y, m) for a in assets)
            if month_total:
                monthly_totals[month_key] += month_total
            y, m = _ym_add(y, m, 1)

        # Expenses start with the first invoice or expense ever recorded.
        firsts = [
            d for d in (
                await self._first_record_date(self.db.invoices, scope),
                await self._first_record_date(self.db.expenses, scope),
            ) if d
        ]
        return dict(monthly_totals), min((d.replace(tzinfo=None) for d in firsts), default=None)

    async def _revenue_monthly_totals(
        self, scope: dict, window_start: datetime, window_end: datetime, include_pocket_money: bool,
    ) -> tuple:
        """(monthly revenue totals in [window_start, window_end), {month: the
        dates revenue was entered on})."""
        revenues = await self.db.daily_revenue.find(
            {
                **scope,
                "date": {"$gte": window_start.strftime("%Y-%m-%d"), "$lt": window_end.strftime("%Y-%m-%d")},
            },
            {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1}
        ).to_list(None)

        # Aggregate by month (date is stored as a "YYYY-MM-DD" string)
        monthly_totals: Dict[str, float] = defaultdict(float)
        entered_days: Dict[str, set] = defaultdict(set)

        for rev in revenues:
            date_str = rev.get("date")
            if isinstance(date_str, str) and len(date_str) >= 7:
                month_key = date_str[:7]
                monthly_totals[month_key] += float(rev.get("fiscal_revenue", 0))
                if include_pocket_money:
                    monthly_totals[month_key] += float(rev.get("pocket_money", 0))
                entered_days[month_key].add(date_str[:10])
        # Invoices issued to customers join their month's revenue (no days).
        if window_end > window_start:
            window = Period(window_start.date(), (window_end - timedelta(days=1)).date())
            for month_key, amount in (await self._issued_by_month(scope, window)).items():
                monthly_totals[month_key] += amount
        return dict(monthly_totals), entered_days

    async def _known_revenue_months(
        self, company_id: str, entered_days: Dict[str, set], first_month: str, end: datetime,
    ) -> set:
        """Months whose revenue is known: entered on at least
        REVENUE_MONTH_MIN_COVERAGE of the open days (a day is closed by the
        weekly pattern or a dated exception, as everywhere else). A month
        closed throughout is known too - as nothing."""
        company = await self.db.companies.find_one({"id": company_id}, {"_id": 0, "closed_weekdays": 1})
        closed_weekdays = set((company or {}).get("closed_weekdays") or [])
        exceptions = {
            e["date"]: e["closed"] for e in await self.db.closed_date_exceptions.find(
                {"company_id": company_id}, {"_id": 0, "date": 1, "closed": 1}
            ).to_list(5000)
        }
        known = set()
        y, m = (int(part) for part in first_month.split("-"))
        while (y, m) < (end.year, end.month):
            month_key = _month_key(y, m)
            open_days = set()
            for day in range(1, calendar.monthrange(y, m)[1] + 1):
                date_str = f"{month_key}-{day:02d}"
                closed = exceptions[date_str] if date_str in exceptions else datetime(y, m, day).weekday() in closed_weekdays
                if not closed:
                    open_days.add(date_str)
            entered = entered_days.get(month_key, set())
            if not open_days or len(entered & open_days) >= REVENUE_MONTH_MIN_COVERAGE * len(open_days):
                known.add(month_key)
            y, m = _ym_add(y, m, 1)
        return known

    async def _year_back(
        self, company_id: str, kind: str, include_hidden: bool, include_payroll: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """_year_back_analysis over the company's last SEASONAL_HISTORY_MONTHS
        whole months, whatever window the forecast itself was asked for:
        months the company had not started yet, a partial first month and
        (for revenue) months logged on too few days are left out as unknown."""
        now = now_local()
        end = _month_start(now.year, now.month)
        start = _month_start(*_ym_add(now.year, now.month, -SEASONAL_HISTORY_MONTHS))
        scope = await self._company_scope(company_id)
        if kind == "revenue":
            totals, entered_days = await self._revenue_monthly_totals(scope, start, end, include_hidden)
            first = await self._first_record_date(self.db.daily_revenue, scope)
            if first:
                first = first.replace(tzinfo=None)
        else:
            totals, first = await self._expense_monthly_totals(company_id, scope, start, end, include_hidden, include_payroll)
        if not first or not totals:
            return None
        first_month = max(first.strftime("%Y-%m"), start.strftime("%Y-%m"))
        series = {k: v for k, v in totals.items() if k >= first_month}
        if kind == "revenue":
            known = await self._known_revenue_months(company_id, entered_days, first_month, end)
            series = {k: series.get(k, 0.0) for k in known}
        _drop_partial_first_month(series, first)
        return _year_back_analysis(series, now)

    async def get_expense_forecast(
        self,
        company_id: str,
        months_ahead: int = 3,
        include_off_book_expenses: bool = True,
        lookback_days: Optional[int] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        include_payroll: bool = True,
    ) -> Dict:
        """Predict future expenses based on historical data.

        include_payroll=False leaves the payroll (and the wages paid through
        Work Schedule) out, for a viewer who does not keep the payroll -
        the same rule as their totals.

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
        Module 4 audit finding this replaced). When the company's own
        history shows a yearly rhythm, the months ahead are read from last
        year instead (see _year_back_analysis)."""
        window_start, window_end = _resolve_window(lookback_days, start_date, end_date)
        scope = await self._company_scope(company_id)
        monthly_totals, first = await self._expense_monthly_totals(
            company_id, scope, window_start, window_end, include_off_book_expenses, include_payroll
        )
        _drop_partial_first_month(monthly_totals, first)

        sorted_months = sorted(monthly_totals.keys())
        historical = [{"month": mk, "amount": monthly_totals[mk]} for mk in sorted_months]
        # The month in progress is reported (so far, and its end at the pace
        # so far) but not fed into the history: invoices come in lumps, and a
        # mid-month pace of them says too little to move a forecast.
        current = await self._current_month_expenses(company_id, scope, include_off_book_expenses, include_payroll)
        year_back = await self._year_back(company_id, "expense", include_off_book_expenses, include_payroll)
        result = _build_forecast(historical, months_ahead, year_back)
        result["current_month"] = current
        # A month ahead holds at least the recurring expenses already known
        # to be paid in it (a floor, not added on top: the history already
        # carries them) - one paid every few months in its own months.
        items = await recurring_service.active_items(self.db, company_id)
        result["known_recurring_monthly"] = recurring_service.known_monthly_total(items, include_off_book_expenses)
        for entry in result["forecast"]:
            known = recurring_service.known_month_total(items, entry["month"], include_off_book_expenses)
            if entry["predicted_amount"] < known:
                entry.update({
                    "predicted_amount": known, "lower_bound": max(entry["lower_bound"], known),
                    "upper_bound": max(entry["upper_bound"], known), "floor": "known_recurring",
                })
        return result

    async def get_revenue_forecast(
        self,
        company_id: str,
        months_ahead: int = 3,
        include_pocket_money: bool = True,
        lookback_days: Optional[int] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict:
        """Predict future revenue based on historical data. See
        get_expense_forecast's docstring for lookback_days/start_date/
        end_date - same adjustable-window fix, same reasoning.

        include_pocket_money mirrors get_expense_forecast's
        include_off_book_expenses: total revenue everywhere else in this
        app (get_summary's total_income) is fiscal_revenue + pocket_money
        ("Джобче" - non-fiscal cash revenue, not personal investment), so
        omitting pocket_money here made this forecast silently undercount
        total revenue for any company that takes meaningful cash income
        outside the register - the forecast card could show a fraction of
        the real turnover with no indication why. False for a viewer
        without view_pocket_money, matching get_summary's own redaction."""
        window_start, window_end = _resolve_window(lookback_days, start_date, end_date)
        scope = await self._company_scope(company_id)
        # Each month read from the days it was entered on: a month with a few
        # days missing counts at its own daily average, one entered on too
        # few days is unknown - never a weak month.
        daily = await self._logs_revenue_daily(company_id, scope)
        monthly_totals = await self._revenue_month_estimates(
            company_id, scope, window_start, window_end, include_pocket_money, daily
        )

        _drop_partial_first_month(
            monthly_totals, await self._first_record_date(self.db.daily_revenue, scope)
        )

        sorted_months = sorted(monthly_totals.keys())
        historical = [{"month": mk, "amount": round(monthly_totals[mk], 2)} for mk in sorted_months]
        # The month in progress joins the history as its expected end.
        current = await self._current_month_revenue(company_id, scope, include_pocket_money, daily)
        if (
            current["expected"] is not None and current["days_elapsed"] >= CURRENT_MONTH_MIN_DAYS
            and window_end >= _month_start(*_ym_parts(current["month"]))
        ):
            historical.append({"month": current["month"], "amount": current["expected"], "estimated": True})
        year_back = await self._year_back(company_id, "revenue", include_pocket_money)
        result = _build_forecast(historical, months_ahead, year_back)
        result["current_month"] = current
        return result

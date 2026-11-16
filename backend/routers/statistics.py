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
    _profit_formula,
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
from services.business_calendar import GROUPS, bucket_label, bucket_of, buckets

router = APIRouter(prefix="/api")

@router.get("/statistics/summary")
async def get_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_month_only: bool = True,  # Default to current month
    current_user: User = Depends(get_current_user)
):
    # The period's whole business days (services/business_calendar): the
    # current month on the business's own calendar when no dates are given,
    # everything when current_month_only is off.
    try:
        period = Period.parse(
            start_date, end_date,
            default=Period.current_month() if current_month_only else Period(OPEN_START, OPEN_END),
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Невалиден период")

    company_id, scope = await get_company_scope(current_user)
    # A period still running counts through today - "so far": its revenue
    # and invoices up to today, and the share of the month's payroll and
    # depreciation for the days gone by, so a month's figures on the 15th
    # are the first half's, not half a month of revenue against a whole
    # month of salaries.
    today = today_local()
    counted = counted_period(period)
    # Every total of the period, read the one way the budget, the chat, the
    # ROI card and the forecast read it too (server.period_totals).
    totals = await period_totals(company_id, scope, current_user.user_id, counted)

    # Outstanding payables (what's currently owed to suppliers) - always
    # company-wide, never scoped to the period filter above: an invoice from
    # two months ago that's still unpaid is still owed today, so it would be
    # misleading to only surface it while browsing that particular month.
    unpaid_query = {**scope, "payment_method": "bank_transfer", "is_paid": False}
    unpaid_invoices = await server.db.invoices.find(
        unpaid_query, {"_id": 0, "total_amount": 1, "paid_amount": 1, "payment_due_date": 1}
    ).to_list(ALL_ROWS)

    def _is_overdue(inv):
        # Overdue once the due day has passed, on the business's calendar.
        due_day = business_day(inv.get("payment_due_date"))
        return due_day is not None and due_day < today
    overdue_invoices = [inv for inv in unpaid_invoices if _is_overdue(inv)]

    visibility = get_financial_visibility(current_user)
    total_invoice_amount = totals["invoice_total"]
    total_invoice_vat = totals["invoice_vat"]
    total_fiscal_revenue = totals["fiscal_revenue"]
    total_pocket_money = totals["pocket_money"]
    total_expenses = totals["off_book_expenses"]
    total_payroll_cost = totals["payroll_cost"]
    total_depreciation_expense = totals["depreciation_cost"]

    # Every aggregate below folds in the RAW pocket-money/off-book-expense
    # totals only when this viewer may see them - otherwise the "effective"
    # value used in every downstream sum is zero, so income/expense/profit/
    # the cash-card split all come out as a fully coherent analytical
    # picture for exactly the data this viewer's access includes, not the
    # real numbers with one line item merely blanked in the UI.
    effective_pocket_money = total_pocket_money if visibility["pocket_money"] else 0

    # Card portion of the fiscalized revenue; everything else (the rest of
    # fiscal_revenue plus all of pocket_money, which is cash by definition)
    # counts as cash.
    total_card_revenue = totals["card_revenue"]
    total_cash_revenue = total_fiscal_revenue - total_card_revenue + effective_pocket_money

    # The outstanding balance, not the invoice's full amount - a partially
    # paid invoice (paid_amount > 0 but < total_amount, still is_paid=False)
    # should only count what's actually still owed.
    total_unpaid_amount = sum(inv.get("total_amount", 0) - inv.get("paid_amount", 0) for inv in unpaid_invoices)
    total_overdue_amount = sum(inv.get("total_amount", 0) - inv.get("paid_amount", 0) for inv in overdue_invoices)

    # ДДС от фискализиран оборот - по действителната ставка на всеки запис
    # (20% стандартна, 9% намалена, 0% и т.н.). Нито джобчето, нито
    # разходите "в канала" влизат в ДДС, така че тази сметка е еднаква за
    # всеки зрител независимо от финансовата видимост.
    # ДДС от продажби: от касата и от издадените към клиенти фактури.
    issued_total = totals["issued_invoice_total"]
    fiscal_vat = totals["fiscal_vat"] + totals["issued_invoice_vat"]

    # Общ ДДС за плащане = ДДС от продажби - ДДС от покупки (фактури)
    vat_to_pay = fiscal_vat - total_invoice_vat

    # Общ приход/разход - единствената формула (_profit_formula), през
    # period_income_expense с видимостта на този зрител.
    total_income, total_expense = period_income_expense(totals, visibility)

    # Печалбата е независимо скриваема от съставните ѝ части - тя влиза или
    # излиза от отговора само по view_profit, макар вече да е изчислена
    # спрямо ефективните (не суровите) приход/разход по-горе.
    profit = round(total_income - total_expense, 2) if visibility["profit"] else None

    # Average per day with revenue entered, and - while the period runs -
    # where it is heading (server.period_pace).
    # Takings are averaged over the days entered; issued invoices are added
    # to the expected end as they are, never spread over days.
    pace = await period_pace(
        company_id, period, total_income - issued_total, totals["revenue_days"], unprojected=issued_total,
    )

    # "statistics" is the overarching gate - without it, a viewer (e.g. a
    # newly invited staff member with no permissions at all) gets back
    # None for every company-wide aggregate, not just the four individually
    # gated sensitive sub-fields above. This was a real incident: a staff
    # account with zero permissions could still see Home's full "Общо
    # приходи"/"Общо разходи" cards, because those were never gated by
    # anything before this. None (not 0), same reasoning as pocket_money/
    # profit above - so the frontend can tell "genuinely zero" apart from
    # "you don't have access to this field".
    show_stats = visibility["statistics"]

    def _redact(value):
        return value if show_stats else None

    return {
        "total_invoice_amount": _redact(round(total_invoice_amount, 2)),
        "total_invoice_vat": _redact(round(total_invoice_vat, 2)),
        "total_fiscal_revenue": _redact(round(total_fiscal_revenue, 2)),
        # Invoices issued to customers in the period (with VAT) - part of income.
        "total_issued_invoices": _redact(round(issued_total, 2)),
        "issued_invoice_count": _redact(totals["issued_invoice_count"]),
        "issued_invoice_vat": _redact(round(totals["issued_invoice_vat"], 2)),
        "total_pocket_money": round(total_pocket_money, 2) if show_stats and visibility["pocket_money"] else None,
        "fiscal_vat": _redact(round(fiscal_vat, 2)),
        "vat_to_pay": _redact(round(vat_to_pay, 2)),
        "total_non_invoice_expenses": round(total_expenses, 2) if show_stats and visibility["off_book_expenses"] else None,
        "total_payroll_cost": _redact(round(total_payroll_cost, 2)),
        "total_depreciation_expense": _redact(round(total_depreciation_expense, 2)),
        "total_income": _redact(round(total_income, 2)),
        "total_expense": _redact(round(total_expense, 2)),
        "profit": _redact(profit),
        "invoice_count": _redact(totals["invoice_count"]),
        "total_cash_revenue": _redact(round(total_cash_revenue, 2)),
        "total_card_revenue": _redact(round(total_card_revenue, 2)),
        "total_unpaid_amount": _redact(round(total_unpaid_amount, 2)),
        "unpaid_invoice_count": _redact(len(unpaid_invoices)),
        "total_overdue_amount": _redact(round(total_overdue_amount, 2)),
        "overdue_invoice_count": _redact(len(overdue_invoices)),
        "financial_visibility": visibility,
        # The exact days these totals cover, and on how many of them
        # revenue was entered - what "the period" means, stated, not implied.
        "period": {
            "start_date": period.start_text, "end_date": period.end_text, "days": period.days,
            "through_date": counted.end_text,
        },
        "revenue_day_count": len(totals["revenue_days"]),
        "pace": _redact(pace),
    }

# A period longer than this is charted by month, not by day.
CHART_DAY_BUCKETS_MAX = 62


@router.get("/statistics/chart-data")
async def get_chart_data(
    period: str = "week",  # the current calendar week, month or year when no dates are given
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Revenue and expenses of a calendar period, by day (by month for a
    period over two months), only for days that have happened. The same
    period, records and formula as /statistics/summary: the buckets add up
    to its totals - expenses include each day's share of the month's
    payroll and depreciation."""
    # Only the Stats tab calls this, and that tab is already hidden from a
    # viewer without view_statistics (frontend's showStatsTab) - this gate
    # is the backend-enforced version of the same rule.
    require_permission(current_user, "view_statistics")
    today = today_local()
    if start_date or end_date:
        try:
            chosen = Period.parse(start_date, end_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Невалиден период")
    elif period == "month":
        chosen = Period.month_of(today)
    elif period == "year":
        chosen = Period.year(today.year)
    else:
        chosen = Period.week_of(today)
    shown = chosen.through(today)
    if shown is None or shown.days > PACE_MAX_DAYS:
        return []

    company_id, scope = await get_company_scope(current_user)
    closed_weekdays, exceptions_map = await get_closed_days_lookup(company_id)
    # Same cascade as get_summary: a hidden field's contribution is zeroed
    # out of the bars, not just omitted from a separate total.
    visibility = get_financial_visibility(current_user)

    invoices = await server.db.invoices.find(
        {**scope, "date": shown.datetime_filter()}, {"_id": 0, "date": 1, "total_amount": 1, "vat_amount": 1, "asset_id": 1}
    ).to_list(ALL_ROWS)
    revenues = await server.db.daily_revenue.find(
        {**scope, "date": shown.text_filter()},
        {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1, "vat_rate_percent": 1},
    ).to_list(ALL_ROWS)
    # Off-book expenses only - wages paid by Work Schedule come with the
    # day's fixed costs (monthly_costs_by_day), visible like any payroll.
    expenses = await server.db.expenses.find(
        {**scope, "date": shown.text_filter(), **NOT_WAGES}, {"_id": 0, "date": 1, "amount": 1}
    ).to_list(ALL_ROWS) if visibility["off_book_expenses"] else []
    fixed_by_day = await monthly_costs_by_day(company_id, current_user.user_id, shown)

    from collections import defaultdict
    days: Dict[str, Dict[str, Any]] = {
        day.isoformat(): {"income": 0.0, "expense": 0.0, "fixed": fixed_by_day.get(day.isoformat(), 0.0), "vat": 0.0,
                          "has_revenue": False}
        for day in shown.iter_days()
    }
    for inv in invoices:
        inv_day = business_day(inv.get("date"))
        if inv_day and inv_day.isoformat() in days:
            if not inv.get("asset_id"):  # an asset's invoice: its depreciation is the expense
                days[inv_day.isoformat()]["expense"] += inv.get("total_amount", 0)
            days[inv_day.isoformat()]["vat"] -= inv.get("vat_amount", 0)  # ДДС кредит
    for rev in revenues:
        date_str = rev["date"][:10] if isinstance(rev.get("date"), str) else None
        if date_str not in days:
            continue
        pocket_money = rev.get("pocket_money", 0) if visibility["pocket_money"] else 0
        days[date_str]["income"] += rev.get("fiscal_revenue", 0) + pocket_money
        days[date_str]["has_revenue"] = True
        rate = rev.get("vat_rate_percent", 20.0)
        if rate and rate > 0:
            days[date_str]["vat"] += rev.get("fiscal_revenue", 0) * rate / (100 + rate)  # ДДС от продажби
    for exp in expenses:
        date_str = exp["date"][:10] if isinstance(exp.get("date"), str) else None
        if date_str in days:
            days[date_str]["expense"] += exp.get("amount", 0)
    # Invoices issued to customers: income and VAT of their issue date.
    for date_str, issued in (await issued_invoices_by_day(scope, shown)).items():
        if date_str in days:
            days[date_str]["income"] += issued["total"]
            days[date_str]["vat"] += issued["vat"]  # ДДС от продажби

    def _point(key: str, label: str, values: Dict[str, Any], **extra: Any) -> Dict[str, Any]:
        return {
            "date": key, "label": label,
            "income": round(values["income"], 2),
            "expense": round(values["expense"] + values["fixed"], 2),
            "fixed_costs": round(values["fixed"], 2),
            "vat": round(values["vat"], 2),
            **extra,
        }

    if shown.days <= CHART_DAY_BUCKETS_MAX:
        return [
            _point(date_str, f"{date_str[8:10]}.{date_str[5:7]}", values,
                   is_closed=is_date_closed(date_str, closed_weekdays, exceptions_map),
                   has_revenue=values["has_revenue"], bucket="day")
            for date_str, values in days.items()
        ]

    months: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {"income": 0.0, "expense": 0.0, "fixed": 0.0, "vat": 0.0, "revenue_days": 0, "open_days": 0}
    )
    for date_str, values in days.items():
        month = months[date_str[:7]]
        for field in ("income", "expense", "fixed", "vat"):
            month[field] += values[field]
        month["revenue_days"] += 1 if values["has_revenue"] else 0
        month["open_days"] += 0 if is_date_closed(date_str, closed_weekdays, exceptions_map) else 1
    return [
        _point(key, f"{key[5:7]}.{key[:4]}", values, is_closed=False, has_revenue=values["revenue_days"] > 0,
               revenue_days=values["revenue_days"], open_days=values["open_days"], bucket="month")
        for key, values in sorted(months.items())
    ]

# Minimum distinct weeks of data required before calling any per-weekday
# pattern "established" rather than noise - a single unusually quiet
# Tuesday shouldn't read as "Tuesdays are always weak". Same reasoning as
# get_reorder_nudges'/ForecastService's own minimum-sample-size gates.
MIN_WEEKS_FOR_WEEKDAY_PATTERN = 4
WEEKDAY_LOOKBACK_DAYS = 56  # 8 weeks

async def _daily_revenue_by_weekday(company_id: str, lookback_days: int = WEEKDAY_LOOKBACK_DAYS) -> Dict[int, List[float]]:
    """Every day's revenue (fiscal_revenue + pocket_money - same proxy
    ForecastService's own revenue forecast uses) over the trailing
    lookback_days, bucketed by weekday (0=Monday..6=Sunday), skipping days
    the business is known to be closed (the recurring weekly pattern plus
    one-off exceptions - see is_date_closed/get_closed_days_lookup).

    Only days with revenue actually LOGGED enter a bucket: an open day with
    nothing entered is unknown, not zero - far more often a forgotten entry
    than a day with no sales. Counting those as 0 turned three forgotten
    Mondays into "Monday is 51% weaker, is a full working day worth it?".
    The gap is surfaced on its own instead (_missing_revenue_days). Today
    is left out too: it isn't over, so its partial total would read as a
    weak day."""
    from collections import defaultdict

    today = today_local()
    start_day = today - timedelta(days=lookback_days)

    # The whole company's revenue - the same records /statistics/summary
    # counts (company_data_scope), not just its current members' own.
    revenues = await server.db.daily_revenue.find(
        {**await company_data_scope(company_id), "date": {"$gte": start_day.isoformat(), "$lt": today.isoformat()}},
        {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1},
    ).to_list(ALL_ROWS)
    revenue_by_date: Dict[str, float] = defaultdict(float)
    for r in revenues:
        date_str = r.get("date")
        if isinstance(date_str, str):
            revenue_by_date[date_str] += r.get("fiscal_revenue", 0) + r.get("pocket_money", 0)

    closed_weekdays, exceptions_map = await get_closed_days_lookup(company_id)

    buckets: Dict[int, List[float]] = defaultdict(list)
    d = start_day
    while d < today:
        date_str = d.strftime("%Y-%m-%d")
        if date_str in revenue_by_date and not is_date_closed(date_str, closed_weekdays, exceptions_map):
            buckets[d.weekday()].append(revenue_by_date[date_str])
        d += timedelta(days=1)
    return buckets

MISSING_REVENUE_LOOKBACK_DAYS = 14
MISSING_REVENUE_COVERAGE_DAYS = 28
# Below this share of open days logged, a company simply doesn't log
# revenue day by day - reminding it about every unlogged day would be noise.
MISSING_REVENUE_MIN_COVERAGE = 0.5

async def _missing_revenue_days(company_id: str) -> List[str]:
    """Open days of the last two weeks (today excluded - it isn't over)
    with no revenue entry at all, oldest first - for a company that logs
    most of its open days. Counted only from the first day it logged
    anything in the last four weeks, so a company that just started isn't
    told about the days before it did."""
    today = today_local()
    window_start = today - timedelta(days=MISSING_REVENUE_COVERAGE_DAYS)
    logged = {
        d for d in await server.db.daily_revenue.distinct(
            "date", {**await company_data_scope(company_id), "date": {"$gte": window_start.isoformat(), "$lt": today.isoformat()}}
        ) if isinstance(d, str)
    }
    if not logged:
        return []
    first_logged = datetime.strptime(min(logged), "%Y-%m-%d").date()
    closed_weekdays, exceptions_map = await get_closed_days_lookup(company_id)
    open_days = [
        day for day in (first_logged + timedelta(days=i) for i in range((today - first_logged).days))
        if not is_date_closed(day.isoformat(), closed_weekdays, exceptions_map)
    ]
    if not open_days:
        return []
    coverage = sum(1 for day in open_days if day.isoformat() in logged) / len(open_days)
    if coverage < MISSING_REVENUE_MIN_COVERAGE:
        return []
    recent_start = today - timedelta(days=MISSING_REVENUE_LOOKBACK_DAYS)
    return [day.isoformat() for day in open_days if day >= recent_start and day.isoformat() not in logged]

async def _weak_day_suggestion(company_id: str) -> Optional[dict]:
    """Module: cross-data-source insight #2 (weekday revenue pattern). A
    weekday open every week that consistently underperforms the rest of
    the week is worth flagging on its own - shortening hours or closing
    it could cut cost with little revenue to lose. Entirely generic
    (restaurant, shop, salon - whatever logs daily revenue), not tuned to
    any particular trade."""
    buckets = await _daily_revenue_by_weekday(company_id)
    qualifying = {
        wd: statistics.mean(vals) for wd, vals in buckets.items()
        if len(vals) >= MIN_WEEKS_FOR_WEEKDAY_PATTERN
    }
    # Needs most of an open week represented, or "weakest day" is just
    # whichever of 2-3 known days happens to be lowest - not a pattern.
    if len(qualifying) < 5:
        return None
    overall_avg = statistics.mean(qualifying.values())
    if overall_avg <= 0:
        return None
    weakest_wd = min(qualifying, key=lambda wd: qualifying[wd])
    pct_below = round((overall_avg - qualifying[weakest_wd]) / overall_avg * 100)
    if pct_below < 30:
        return None
    return {
        "weekday": weakest_wd,
        "avg_revenue": round(qualifying[weakest_wd], 2),
        "overall_avg_revenue": round(overall_avg, 2),
        "percent_below_average": pct_below,
    }

@router.get("/statistics/weekday-revenue")
async def get_weekday_revenue_pattern(current_user: User = Depends(get_current_user)):
    """Average revenue per weekday over the trailing 8 weeks, plus (if a
    clear pattern exists) a suggestion naming the one weekday that
    consistently underperforms the rest. See _weak_day_suggestion."""
    require_permission(current_user, "view_statistics")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"weekdays": [], "weak_day_suggestion": None}

    buckets = await _daily_revenue_by_weekday(company_id)
    weekdays = [
        {"weekday": wd, "avg_revenue": round(statistics.mean(vals), 2), "days_observed": len(vals)}
        for wd, vals in sorted(buckets.items())
        if vals
    ]
    suggestion = await _weak_day_suggestion(company_id)
    return {"weekdays": weekdays, "weak_day_suggestion": suggestion}

async def _weekday_labor_efficiency(company_id: str, lookback_days: int = WEEKDAY_LOOKBACK_DAYS):
    """Average revenue and average scheduled labor-hours per weekday over
    the same trailing window, each only for weekdays with enough distinct
    weeks of data to mean something. Hours come from Work Schedule's own
    occurrence resolution (shift_adjustments-aware, same as
    _signal_schedule_unpaid), not a separate re-derivation of the
    schedule."""
    from collections import defaultdict
    from routers.schedule import _resolve_occurrences

    revenue_buckets = await _daily_revenue_by_weekday(company_id, lookback_days)
    revenue_avg_by_wd = {
        wd: statistics.mean(vals) for wd, vals in revenue_buckets.items()
        if len(vals) >= MIN_WEEKS_FOR_WEEKDAY_PATTERN
    }

    today = today_local()
    start_str = (today - timedelta(days=lookback_days)).isoformat()
    end_str = today.isoformat()
    shifts = await server.db.work_shifts.find({"company_id": company_id}, {"_id": 0}).to_list(5000)
    occurrences = await _resolve_occurrences(shifts, company_id, start_str, end_str) if shifts else []

    hours_sum_by_wd: Dict[int, float] = defaultdict(float)
    weeks_seen_by_wd: Dict[int, set] = defaultdict(set)
    for o in occurrences:
        if not o.get("payable", True):
            continue  # on leave that day: no labour hours worked
        d = datetime.strptime(o["date"], "%Y-%m-%d")
        wd = d.weekday()
        hours_sum_by_wd[wd] += o["hours"]
        weeks_seen_by_wd[wd].add(d.isocalendar()[:2])  # (iso_year, iso_week)

    avg_hours_by_wd = {
        wd: hours_sum_by_wd[wd] / len(weeks_seen_by_wd[wd])
        for wd in hours_sum_by_wd
        if len(weeks_seen_by_wd[wd]) >= MIN_WEEKS_FOR_WEEKDAY_PATTERN
    }
    return revenue_avg_by_wd, avg_hours_by_wd

async def _staffing_rebalance_suggestion(company_id: str) -> Optional[dict]:
    """Module: cross-data-source insight #1 (staffing vs. revenue). Same
    revenue-by-weekday pattern as _weak_day_suggestion, but divided by
    scheduled labor-hours for that weekday - revenue per labor-hour - so a
    weekday that's fully staffed but earns far less per hour than another
    equally-staffed weekday stands out, generically, without assuming
    anything about the business beyond "it uses Work Schedule and logs
    daily revenue". Suggests moving a modest slice of hours from the
    weakest-per-hour day toward the strongest, rather than a wholesale
    schedule rewrite."""
    revenue_avg_by_wd, avg_hours_by_wd = await _weekday_labor_efficiency(company_id)
    efficiency = {
        wd: revenue_avg_by_wd[wd] / avg_hours_by_wd[wd]
        for wd in (set(revenue_avg_by_wd) & set(avg_hours_by_wd))
        if avg_hours_by_wd[wd] > 0
    }
    if len(efficiency) < 4:
        return None
    overall_avg_efficiency = statistics.mean(efficiency.values())
    if overall_avg_efficiency <= 0:
        return None

    overstaffed_wd = min(efficiency, key=lambda wd: efficiency[wd])
    understaffed_wd = max(efficiency, key=lambda wd: efficiency[wd])
    if overstaffed_wd == understaffed_wd:
        return None
    overstaffed_ratio = efficiency[overstaffed_wd] / overall_avg_efficiency
    understaffed_ratio = efficiency[understaffed_wd] / overall_avg_efficiency

    # Both days must deviate clearly from the average, and the
    # overstaffed day needs enough hours on it to actually have something
    # worth trimming - moving "1 hour off a 2-hour shift" isn't useful.
    if overstaffed_ratio > 0.75 or understaffed_ratio < 1.25 or avg_hours_by_wd[overstaffed_wd] < 2:
        return None

    suggested_hours = round(min(avg_hours_by_wd[overstaffed_wd] * 0.25, 4), 1)
    if suggested_hours < 0.5:
        return None

    return {
        "overstaffed_weekday": overstaffed_wd,
        "understaffed_weekday": understaffed_wd,
        "overstaffed_hours": round(avg_hours_by_wd[overstaffed_wd], 1),
        "understaffed_hours": round(avg_hours_by_wd[understaffed_wd], 1),
        "overstaffed_percent_of_average": round(overstaffed_ratio * 100),
        "understaffed_percent_of_average": round(understaffed_ratio * 100),
        "suggested_hours_to_move": suggested_hours,
    }

@router.get("/statistics/staffing-efficiency")
async def get_staffing_efficiency(current_user: User = Depends(get_current_user)):
    """Revenue-per-scheduled-labor-hour per weekday over the trailing 8
    weeks, plus (if a clear mismatch exists) a suggestion to move a slice
    of hours from the weekday that earns least per staffed hour toward
    the one that earns most. Needs both view_statistics (revenue) and
    manage_budget (schedule/payroll) - the same gate _signal_schedule_
    unpaid already uses for schedule-derived labor cost."""
    require_permission(current_user, "view_statistics")
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"weekdays": [], "rebalance_suggestion": None}

    revenue_avg_by_wd, avg_hours_by_wd = await _weekday_labor_efficiency(company_id)
    weekdays = [
        {
            "weekday": wd,
            "avg_revenue": round(revenue_avg_by_wd[wd], 2),
            "avg_scheduled_hours": round(avg_hours_by_wd[wd], 1),
            "revenue_per_labor_hour": round(revenue_avg_by_wd[wd] / avg_hours_by_wd[wd], 2),
        }
        for wd in sorted(set(revenue_avg_by_wd) & set(avg_hours_by_wd))
        if avg_hours_by_wd[wd] > 0
    ]
    suggestion = await _staffing_rebalance_suggestion(company_id)
    return {"weekdays": weekdays, "rebalance_suggestion": suggestion}

@router.get("/statistics/suppliers")
async def get_supplier_statistics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get comprehensive supplier statistics with trends, alerts, and rankings"""
    require_permission(current_user, "view_statistics")
    from collections import defaultdict
    from datetime import timedelta

    # Unlike get_summary, this endpoint has no period selector in the UI -
    # the frontend always calls it with no dates, expecting an all-time
    # supplier-relationship overview (total/active/inactive suppliers, top-3
    # concentration). Defaulting to the current month here used to hide
    # every supplier with no invoices yet this month, making the whole tab
    # read as empty for any account between scans.

    # Build query for current period
    _, query = await get_company_scope(current_user)
    scope = dict(query)
    period: Optional[Period] = None
    if start_date or end_date:
        try:
            period = Period.parse(start_date, end_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Невалиден период")
        query["date"] = period.datetime_filter()

    # Get all invoices for the period
    invoices = await server.db.invoices.find(query, {
        "_id": 0,
        "supplier": 1,
        "total_amount": 1,
        "vat_amount": 1,
        "amount_without_vat": 1,
        "date": 1,
        "document_type": 1,
    }).to_list(ALL_ROWS)
    
    # Group by supplier with detailed data
    supplier_data: Dict[str, Any] = defaultdict(lambda: {
        "total_amount": 0,
        "total_vat": 0,
        "total_net": 0,
        "invoice_count": 0,
        "dates": [],
        "amounts": []
    })
    
    for inv in invoices:
        supplier = inv.get("supplier", "Неизвестен")
        amount = inv.get("total_amount", 0)
        supplier_data[supplier]["total_amount"] += amount
        supplier_data[supplier]["total_vat"] += inv.get("vat_amount", 0)
        supplier_data[supplier]["total_net"] += inv.get("amount_without_vat", 0)
        # A credit note takes its amount off the supplier's total; it is not
        # an invoice, nor a delivery that sets the supplier's rhythm.
        if inv.get("document_type") == CREDIT_NOTE:
            continue
        supplier_data[supplier]["invoice_count"] += 1
        
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            supplier_data[supplier]["dates"].append(date_val)
            supplier_data[supplier]["amounts"].append(amount)
    
    # Active = a delivery in the last 30 days, counted in business days.
    inactivity_days = 30
    today = today_local()
    
    # Build comprehensive supplier list
    suppliers_list = []
    total_all = 0
    
    for supplier, data in supplier_data.items():
        total_all += data["total_amount"]
        
        # Calculate first/last delivery
        sorted_dates = sorted(data["dates"]) if data["dates"] else []
        first_delivery = sorted_dates[0] if sorted_dates else None
        last_delivery = sorted_dates[-1] if sorted_dates else None
        
        # Make dates timezone-aware if they aren't
        if last_delivery and last_delivery.tzinfo is None:
            last_delivery = last_delivery.replace(tzinfo=timezone.utc)
        if first_delivery and first_delivery.tzinfo is None:
            first_delivery = first_delivery.replace(tzinfo=timezone.utc)
        
        # Determine status. With a chosen period every supplier listed here
        # was bought from in it; without one, "active" is a delivery in the
        # last 30 days.
        last_day = business_day(last_delivery)
        days_inactive = (today - last_day).days if last_day else 999
        is_active = True if period is not None else (last_day is not None and days_inactive <= inactivity_days)
        
        # Calculate average
        avg = data["total_amount"] / data["invoice_count"] if data["invoice_count"] > 0 else 0
        
        # Calculate standard deviation for anomaly detection
        amounts = data["amounts"]
        if len(amounts) >= 2:
            mean_amount = sum(amounts) / len(amounts)
            variance = sum((x - mean_amount) ** 2 for x in amounts) / len(amounts)
            std_dev = variance ** 0.5
        else:
            mean_amount = avg
            std_dev = 0
        
        suppliers_list.append({
            "supplier": supplier,
            "total_amount": round(data["total_amount"], 2),
            "total_vat": round(data["total_vat"], 2),
            "total_net": round(data["total_net"], 2),
            "invoice_count": data["invoice_count"],
            "avg_invoice": round(avg, 2),
            "first_delivery": first_delivery.strftime("%Y-%m-%d") if first_delivery else None,
            "last_delivery": last_delivery.strftime("%Y-%m-%d") if last_delivery else None,
            "is_active": is_active,
            "days_inactive": days_inactive if not is_active else 0,
            "std_dev": round(std_dev, 2)
        })
    
    # Add dependency percentage
    for s in suppliers_list:
        s["dependency_percent"] = round((s["total_amount"] / total_all * 100), 1) if total_all > 0 else 0
    
    # Sort by total amount for TOP by amount
    top_by_amount = sorted(suppliers_list, key=lambda x: x["total_amount"], reverse=True)[:10]
    
    # TOP by frequency
    top_by_frequency = sorted(suppliers_list, key=lambda x: x["invoice_count"], reverse=True)[:10]
    
    # TOP by average invoice
    top_by_avg = sorted(suppliers_list, key=lambda x: x["avg_invoice"], reverse=True)[:10]
    
    # Inactive suppliers: without a period, those with no delivery in the
    # last 30 days; with one, those bought from before it but not in it -
    # how long since their last delivery, counted to the period's end.
    if period is None:
        inactive_suppliers = [s for s in suppliers_list if not s["is_active"]]
    else:
        reference = min(period.end, today)
        earlier = await server.db.invoices.aggregate([
            {"$match": {**scope, **NOT_A_CREDIT_NOTE, "date": {"$lt": day_start_utc(period.start)}}},
            {"$group": {"_id": "$supplier", "last": {"$max": "$date"}, "first": {"$min": "$date"}}},
        ]).to_list(ALL_ROWS)
        bought_in_period = set(supplier_data.keys())
        inactive_suppliers = []
        for row in earlier:
            name = row["_id"] or "Неизвестен"
            if name in bought_in_period:
                continue
            last, first = business_day(row.get("last")), business_day(row.get("first"))
            inactive_suppliers.append({
                "supplier": name, "total_amount": 0, "total_vat": 0, "total_net": 0, "invoice_count": 0,
                "avg_invoice": 0, "first_delivery": first.isoformat() if first else None,
                "last_delivery": last.isoformat() if last else None, "is_active": False,
                "days_inactive": (reference - last).days if last else 999, "std_dev": 0, "dependency_percent": 0,
            })
    inactive_suppliers.sort(key=lambda x: x["days_inactive"], reverse=True)
    
    # High dependency alert (>30%)
    high_dependency = [s for s in suppliers_list if s["dependency_percent"] > 30]
    
    # Calculate totals
    total_vat = sum(s["total_vat"] for s in suppliers_list)
    total_net = sum(s["total_net"] for s in suppliers_list)
    total_invoices = sum(s["invoice_count"] for s in suppliers_list)
    
    # Executive summary
    # From the amounts, not the rounded percents (three of them summed to 100.1%).
    def _share(top: List[dict]) -> float:
        return round(min(100.0, sum(s["total_amount"] for s in top) / total_all * 100), 1) if total_all > 0 else 0

    top_3_concentration = _share(top_by_amount[:3]) if len(top_by_amount) >= 3 else 0
    top_5_concentration = _share(top_by_amount[:5]) if len(top_by_amount) >= 5 else 0
    
    return {
        "period": {
            "start_date": period.start_text if period else None,
            "end_date": period.end_text if period else None,
        },
        # What "active" means here: bought from in the chosen period, or -
        # with no period - a delivery in the last 30 days.
        "activity_basis": "period" if period is not None else "last_30_days",
        "executive_summary": {
            "top_3_concentration": round(top_3_concentration, 1),
            "top_5_concentration": round(top_5_concentration, 1),
            "total_suppliers": len(suppliers_list),
            "active_suppliers": len([s for s in suppliers_list if s["is_active"]]),
            "inactive_suppliers": len(inactive_suppliers),
            "high_dependency_count": len(high_dependency),
            "largest_supplier": top_by_amount[0]["supplier"] if top_by_amount else None,
            "largest_amount": top_by_amount[0]["total_amount"] if top_by_amount else 0
        },
        "totals": {
            "total_amount": round(total_all, 2),
            "total_vat": round(total_vat, 2),
            "total_net": round(total_net, 2),
            "supplier_count": len(suppliers_list),
            "invoice_count": total_invoices
        },
        "top_by_amount": top_by_amount,
        "top_by_frequency": top_by_frequency,
        "top_by_avg": top_by_avg,
        "inactive_suppliers": inactive_suppliers[:10],
        "high_dependency_alerts": high_dependency,
        "all_suppliers": suppliers_list
    }

# A detail series longer than this is drawn one granularity coarser.
SERIES_MAX_BUCKETS = 400


def _invoice_series(invoices: List[dict], span: Optional[Period], group_by: str) -> tuple:
    """(granularity used, buckets) - an invoice series over the span by day,
    week, month or year, every bucket present (zero when nothing was bought)
    and flagged partial when it reaches past the span (a week cut by the
    period's start) or is still running (today, this week, this month).
    Growth compares a complete bucket with the complete one before it,
    never a half month with a whole one."""
    group = group_by if group_by in GROUPS else "month"
    if span is None:
        return group, []
    today = today_local()
    while len(buckets(span, group)) > SERIES_MAX_BUCKETS and group != "year":
        group = GROUPS[GROUPS.index(group) + 1]
    amounts: Dict[str, list] = {}
    for inv in invoices:
        inv_day = business_day(inv.get("date"))
        if inv_day is not None and span.contains(inv_day):
            key = bucket_of(inv_day, group).start_text
            entry = amounts.setdefault(key, [0.0, 0])
            entry[0] += inv.get("total_amount", 0)
            entry[1] += 1
    series: List[Dict[str, Any]] = []
    previous: Optional[Dict[str, Any]] = None
    for bucket in buckets(span, group):
        amount, count = amounts.get(bucket.start_text, [0.0, 0])
        partial = bucket.start < span.start or bucket.end > span.end or bucket.end >= today
        growth = None
        if previous is not None and not partial and not previous["is_partial"] and previous["amount"] > 0:
            growth = round((amount - previous["amount"]) / previous["amount"] * 100, 1)
        point = {
            "key": bucket.start_text, "label": bucket_label(bucket, group),
            "start": bucket.start_text, "end": bucket.end_text,
            "amount": round(amount, 2), "count": count, "is_partial": partial, "growth_percent": growth,
        }
        series.append(point)
        previous = point
    return group, series


@router.get("/statistics/supplier/{supplier_name}/detailed")
async def get_detailed_supplier_stats(
    supplier_name: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    group_by: str = "month",  # day | week | month | year
    current_user: User = Depends(get_current_user)
):
    """One supplier for a period (all of its history when no dates are
    given): totals, a series by day, week, month or year with every period
    present, anomalies and the latest invoices - read on the same business
    days as every other module."""
    require_permission(current_user, "view_statistics")
    from urllib.parse import unquote

    supplier_name = unquote(supplier_name)
    try:
        period = Period.parse(start_date, end_date) if (start_date or end_date) else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Невалиден период")

    _, scope = await get_company_scope(current_user)
    supplier_query = {**scope, "supplier": {"$regex": f"^{re.escape(supplier_name)}$", "$options": "i"}}
    query = {**supplier_query, **({"date": period.datetime_filter()} if period else {})}
    invoices = await server.db.invoices.find(query, {"_id": 0, "image_base64": 0, "image_base64s": 0}).sort("date", 1).to_list(ALL_ROWS)
    today = today_local()

    # The last delivery ever, whatever the period - what "active" is about.
    latest = await server.db.invoices.find(supplier_query, {"_id": 0, "date": 1}).sort("date", -1).limit(1).to_list(1)
    last_ever = business_day(latest[0].get("date")) if latest else None
    if not invoices and last_ever is None:
        return {"supplier": supplier_name, "found": False, "invoice_count": 0}

    days = [business_day(inv.get("date")) for inv in invoices]
    known_days = [d for d in days if d is not None]
    first_delivery = min(known_days) if known_days else None
    last_delivery = max(known_days) if known_days else None
    days_inactive = (today - last_ever).days if last_ever else 999
    is_active = days_inactive <= 30

    total_amount = sum(inv.get("total_amount", 0) for inv in invoices)
    span_start = period.start if period else first_delivery
    span_end = min(period.end, today) if period else today
    span = Period(span_start, span_end) if span_start and span_start <= span_end else None
    group, series = _invoice_series(invoices, span, group_by)
    _, months = _invoice_series(invoices, span, "month")

    # Unusually large invoices - more than two standard deviations above the mean.
    amounts = [inv.get("total_amount", 0) for inv in invoices]
    anomalies = []
    if len(amounts) >= 3:
        mean_amount = sum(amounts) / len(amounts)
        std_dev = (sum((x - mean_amount) ** 2 for x in amounts) / len(amounts)) ** 0.5
        threshold = mean_amount + (2 * std_dev)
        for inv, inv_day in zip(invoices, days):
            if inv.get("total_amount", 0) > threshold:
                anomalies.append({
                    "date": inv_day.isoformat() if inv_day else None,
                    "amount": inv.get("total_amount", 0),
                    "invoice_number": inv.get("invoice_number"),
                    "deviation_percent": round((inv.get("total_amount", 0) - mean_amount) / mean_amount * 100, 1),
                })

    recent_invoices = [
        {
            "id": inv.get("id"), "invoice_number": inv.get("invoice_number"),
            "date": inv_day.isoformat() if inv_day else None,
            "total_amount": inv.get("total_amount", 0), "vat_amount": inv.get("vat_amount", 0),
        }
        for inv, inv_day in list(zip(invoices, days))[-10:][::-1]
    ]

    return {
        "supplier": supplier_name,
        "found": True,
        "period": {"start_date": span.start_text, "end_date": span.end_text} if span else None,
        "overview": {
            "total_amount": round(total_amount, 2),
            "total_vat": round(sum(inv.get("vat_amount", 0) for inv in invoices), 2),
            "total_net": round(sum(inv.get("amount_without_vat", 0) for inv in invoices), 2),
            "invoice_count": len(invoices),
            "avg_invoice": round(total_amount / len(invoices), 2) if invoices else 0,
            "first_delivery": first_delivery.isoformat() if first_delivery else None,
            "last_delivery": (last_ever.isoformat() if last_ever else None),
            "is_active": is_active,
            "days_inactive": days_inactive if not is_active else 0,
        },
        "group_by": group,
        "series": series,
        # The last twelve months of the same series, kept for older clients.
        "monthly_trend": [
            {"month": point["key"][:7], "amount": point["amount"], "count": point["count"],
             "growth_percent": point["growth_percent"] or 0, "is_partial": point["is_partial"]}
            for point in months[-12:]
        ],
        "anomalies": anomalies,
        "recent_invoices": recent_invoices,
    }

@router.get("/statistics/suppliers/compare")
async def compare_suppliers(
    suppliers: str,  # comma-separated supplier names
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Compare multiple suppliers"""
    require_permission(current_user, "view_statistics")
    from urllib.parse import unquote

    supplier_names = [unquote(s.strip()) for s in suppliers.split(",") if s.strip()]
    
    if len(supplier_names) < 2 or len(supplier_names) > 5:
        raise HTTPException(status_code=400, detail="Изберете между 2 и 5 доставчика за сравнение")
    
    # The same business days as every other module (services/business_calendar).
    date_query = {}
    if start_date or end_date:
        try:
            date_query = Period.parse(start_date, end_date).datetime_filter()
        except ValueError:
            raise HTTPException(status_code=400, detail="Невалиден период")
    
    comparison = []
    _, base_scope = await get_company_scope(current_user)

    for supplier_name in supplier_names:
        query = {**base_scope, "supplier": {"$regex": f"^{re.escape(supplier_name)}$", "$options": "i"}}
        if date_query:
            query["date"] = date_query
        
        invoices = await server.db.invoices.find(query, {"_id": 0, "total_amount": 1, "date": 1}).to_list(ALL_ROWS)
        
        total = sum(inv.get("total_amount", 0) for inv in invoices)
        count = len(invoices)
        avg = total / count if count > 0 else 0
        
        comparison.append({
            "supplier": supplier_name,
            "total_amount": round(total, 2),
            "invoice_count": count,
            "avg_invoice": round(avg, 2)
        })
    
    # Calculate max for percentage calculation
    max_amount = max(c["total_amount"] for c in comparison) if comparison else 1
    max_count = max(c["invoice_count"] for c in comparison) if comparison else 1
    
    for c in comparison:
        c["amount_percent"] = round(c["total_amount"] / max_amount * 100, 1) if max_amount > 0 else 0
        c["count_percent"] = round(c["invoice_count"] / max_count * 100, 1) if max_count > 0 else 0
    
    return {
        "suppliers": comparison,
        "period": {"start_date": start_date, "end_date": end_date}
    }

@router.get("/statistics/supplier/{supplier_name}")
async def get_single_supplier_stats(
    supplier_name: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get detailed statistics for a specific supplier"""
    require_permission(current_user, "view_statistics")
    _, query = await get_company_scope(current_user)
    query["supplier"] = {"$regex": f"^{re.escape(supplier_name)}$", "$options": "i"}

    if start_date or end_date:
        try:
            query["date"] = Period.parse(start_date, end_date).datetime_filter()
        except ValueError:
            raise HTTPException(status_code=400, detail="Невалиден период")
    
    invoices = await server.db.invoices.find(query, {"_id": 0, "image_base64": 0, "image_base64s": 0}).sort("date", -1).to_list(ALL_ROWS)
    
    if not invoices:
        return {
            "supplier": supplier_name,
            "invoice_count": 0,
            "total_amount": 0,
            "invoices": []
        }
    
    total_amount = sum(inv.get("total_amount", 0) for inv in invoices)
    total_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_net = sum(inv.get("amount_without_vat", 0) for inv in invoices)
    
    # Format invoices
    formatted_invoices = []
    for inv in invoices:
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            date_str = date_val.strftime("%Y-%m-%d")
        else:
            date_str = str(date_val)[:10]
        
        formatted_invoices.append({
            "id": inv.get("id"),
            "invoice_number": inv.get("invoice_number"),
            "date": date_str,
            "total_amount": inv.get("total_amount", 0),
            "vat_amount": inv.get("vat_amount", 0),
            "amount_without_vat": inv.get("amount_without_vat", 0)
        })
    
    return {
        "supplier": supplier_name,
        "invoice_count": len(invoices),
        "total_amount": round(total_amount, 2),
        "total_vat": round(total_vat, 2),
        "total_net": round(total_net, 2),
        "avg_invoice": round(total_amount / len(invoices), 2) if invoices else 0,
        "invoices": formatted_invoices
    }

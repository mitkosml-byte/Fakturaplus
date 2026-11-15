"""Module 1 audit finding - extracted from the former monolithic server.py.
Shares server.py's db/models/helpers/services via `from server import *`;
`db` and `AI_FEATURES_ENABLED` are the two globals tests/startup reassign
after module load, so this file always accesses them as `server.db` /
`server.AI_FEATURES_ENABLED` (qualified), never via the star-import, to
stay correct when server.py's test fixture monkeypatches them."""
from collections import defaultdict
from datetime import date as date_type

from fastapi import APIRouter
from server import *
from server import (
    _as_utc,
    _profit_formula,
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

# ===================== ROI: WHAT THE BUSINESS GIVES BACK =====================
# The owner puts personal money into the business ("Лични вложения"). For
# any business, the questions are: is the business paying that back, what
# moved profit this month, and what can be done about it - answered from
# the company's own numbers. Deterministic and cheap on every view; the AI
# advice on top of it (GET /roi/advice) is asked for on demand and kept
# until the numbers change - before, every Home view made a model call
# with four numbers and no context.

ROI_WINDOW_MONTHS = 6       # the payback view: the month and the five before it
ROI_BASELINE_MONTHS = 3     # "usual", for what moved: the three months before it
ROI_MOVER_MIN_EUR = 50.0
ROI_MOVER_MIN_SHARE = 0.10
ROI_MAX_MOVERS = 4
ROI_PRICE_LOOKBACK_DAYS = 60
ROI_SAVINGS_LOOKBACK_DAYS = 90
ROI_SAVINGS_MIN_MONTHLY = 10.0
ROI_SAVINGS_MIN_SHARE = 0.05
ROI_MIN_RELIABLE_DAYS = 45
ROI_MISSING_DAYS_MIN_COVERAGE = 0.5
# Rows read per collection for the window - far beyond a six-month window
# of any small business, so nothing is silently cut off.
ROI_MAX_ROWS = 200_000


def _roi_months(year: int, month: int, count: int) -> List[tuple]:
    return [_ym_add(year, month, -back) for back in range(count - 1, -1, -1)]


def _month_range(year: int, month: int) -> tuple:
    """(first day, first day of the next month) as YYYY-MM-DD strings."""
    ny, nm = _ym_add(year, month, 1)
    return f"{year}-{month:02d}-01", f"{ny}-{nm:02d}-01"


def _eur_text(value: float) -> str:
    if abs(value) < 0.005:
        return "0"
    # Non-breaking spaces: "9 000 €" never splits over two lines.
    text = f"{value:,.0f}".replace(",", "\u00a0") if abs(value) >= 10 else f"{value:.2f}".replace(".", ",")
    return text.replace("-", "−")


async def _roi_month_data(
    company_id: Optional[str], scope: dict, user_id: str, visibility: dict, months: List[tuple],
) -> Dict[str, Dict[str, Any]]:
    """Each month's personal money in, revenue, supplier invoices, off-book
    expenses, payroll and depreciation - one read per collection for the
    whole window, revenue and expenses kept per day (the comparison with
    earlier months is over the same days when the month is still running)."""
    first_start, _ = _month_range(*months[0])
    _, last_end = _month_range(*months[-1])
    data: Dict[str, Dict[str, Any]] = {
        f"{y}-{m:02d}": {
            "year": y, "month": m, "personal": 0.0, "investment_only": 0.0,
            "fiscal_by_day": defaultdict(float), "pocket_by_day": defaultdict(float),
            "invoices": [], "off_book": [], "payroll": 0.0, "depreciation": 0.0,
        }
        for y, m in months
    }
    if company_id:
        personal = await server.db.personal_expenses.find(
            {"company_id": company_id, "$or": [{"period_year": y, "period_month": m} for y, m in months]},
            {"_id": 0, "amount": 1, "expense_type": 1, "period_month": 1, "period_year": 1},
        ).to_list(ROI_MAX_ROWS)
        for entry in personal:
            month = data.get(f"{entry.get('period_year')}-{int(entry.get('period_month') or 0):02d}")
            if month is not None:
                month["personal"] += entry.get("amount", 0)
                if entry.get("expense_type") == "investment":
                    month["investment_only"] += entry.get("amount", 0)
    revenues = await server.db.daily_revenue.find(
        {**scope, "date": {"$gte": first_start, "$lt": last_end}},
        {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1},
    ).to_list(ROI_MAX_ROWS)
    for r in revenues:
        date_str = r.get("date")
        month = data.get(date_str[:7]) if isinstance(date_str, str) else None
        if month is not None:
            day = int(date_str[8:10])
            month["fiscal_by_day"][day] += r.get("fiscal_revenue", 0)
            month["pocket_by_day"][day] += r.get("pocket_money", 0)
    invoices = await server.db.invoices.find(
        {**scope, "date": {
            "$gte": datetime.fromisoformat(first_start + "T00:00:00+00:00"),
            "$lt": datetime.fromisoformat(last_end + "T00:00:00+00:00"),
        }},
        {"_id": 0, "date": 1, "supplier": 1, "total_amount": 1},
    ).to_list(ROI_MAX_ROWS)
    for inv in invoices:
        inv_day = business_day(inv.get("date")) if isinstance(inv.get("date"), datetime) else None
        month = data.get(inv_day.strftime("%Y-%m")) if inv_day else None
        if month is not None and inv_day is not None:
            month["invoices"].append((inv_day.day, inv.get("supplier") or "—", inv.get("total_amount", 0)))
    if visibility["off_book_expenses"]:
        expenses = await server.db.expenses.find(
            {**scope, "date": {"$gte": first_start, "$lt": last_end}}, {"_id": 0, "date": 1, "amount": 1},
        ).to_list(ROI_MAX_ROWS)
        for exp in expenses:
            date_str = exp.get("date")
            month = data.get(date_str[:7]) if isinstance(date_str, str) else None
            if month is not None:
                month["off_book"].append((int(date_str[8:10]), exp.get("amount", 0)))
    for month in data.values():
        # The month still running counts through today (counted_period):
        # its days so far, and that share of its payroll and depreciation.
        counted = counted_period(Period.month(month["year"], month["month"]))
        month["counted_through"] = counted.end.day if counted.days < Period.month(month["year"], month["month"]).days else None
        month["payroll"] = await get_payroll_cost_for_period(company_id, user_id, counted.start_text, counted.end_text)
        month["depreciation"] = await get_depreciation_cost_for_period(company_id, user_id, counted.start_text, counted.end_text)
    return data


def _month_totals(month: Dict[str, Any], visibility: dict, through_day: Optional[int] = None) -> Dict[str, Any]:
    """Revenue, expenses and profit - the same formula as the dashboard
    (_profit_formula: payroll and depreciation included), with what this
    viewer may not see counted as zero. through_day limits the daily
    figures to days 1..through_day (payroll and depreciation, monthly, then
    stay out: the comparison is about the days themselves)."""
    limit = through_day if through_day is not None else month.get("counted_through")

    def upto(day: int) -> bool:
        return limit is None or day <= limit

    fiscal = sum(v for d, v in month["fiscal_by_day"].items() if upto(d))
    pocket = sum(v for d, v in month["pocket_by_day"].items() if upto(d)) if visibility["pocket_money"] else 0.0
    invoice_total = sum(amount for d, _, amount in month["invoices"] if upto(d))
    off_book = sum(amount for d, amount in month["off_book"] if upto(d))
    payroll = month["payroll"] if through_day is None else 0.0
    depreciation = month["depreciation"] if through_day is None else 0.0
    income, expense = _profit_formula(
        fiscal_revenue=fiscal, pocket_money=pocket, invoice_total=invoice_total,
        off_book_expenses=off_book, payroll_cost=payroll, depreciation_cost=depreciation,
    )
    by_supplier: Dict[str, float] = defaultdict(float)
    for d, supplier, amount in month["invoices"]:
        if upto(d):
            by_supplier[supplier] += amount
    return {
        "revenue": income, "expenses": expense, "profit": income - expense,
        "by_supplier": dict(by_supplier), "off_book": off_book,
        "has_data": bool(month["fiscal_by_day"] or month["invoices"] or month["off_book"] or month["personal"]),
    }


def _profit_movers(target: Dict[str, Any], baseline: List[Dict[str, Any]], is_en: bool) -> List[Dict[str, Any]]:
    """What moved profit: revenue, each supplier and off-book expenses in
    the month against their average over the baseline months (the same
    days of them when the month is still running), largest first."""
    usable = [b for b in baseline if b["has_data"]]
    if not usable or not target["has_data"]:
        return []
    count = len(usable)
    candidates = [("revenue", "Revenue" if is_en else "Оборот", target["revenue"], sum(b["revenue"] for b in usable) / count)]
    for supplier in set(target["by_supplier"]) | {s for b in usable for s in b["by_supplier"]}:
        candidates.append((
            "supplier", supplier, target["by_supplier"].get(supplier, 0.0),
            sum(b["by_supplier"].get(supplier, 0.0) for b in usable) / count,
        ))
    candidates.append((
        "off_book", "Expenses without invoice" if is_en else "Разходи без фактура",
        target["off_book"], sum(b["off_book"] for b in usable) / count,
    ))
    movers = []
    for kind, label, current, usual in candidates:
        delta = current - usual
        if abs(delta) < max(ROI_MOVER_MIN_EUR, ROI_MOVER_MIN_SHARE * usual):
            continue
        effect = delta if kind == "revenue" else -delta
        change = ("+" if delta > 0 else "−") + f"{_eur_text(abs(delta))}\u00a0€"
        if usual > 0:
            change += f", {delta / usual * 100:+.0f}%".replace("-", "−")
        text = (
            f"{label}: {_eur_text(current)}\u00a0€ vs. usually {_eur_text(usual)}\u00a0€ ({change})"
            if is_en else
            f"{label}: {_eur_text(current)}\u00a0€ при обичайни {_eur_text(usual)}\u00a0€ ({change})"
        )
        movers.append({
            "kind": kind, "label": label, "current": round(current, 2), "usual": round(usual, 2),
            "delta": round(delta, 2), "profit_effect": round(effect, 2), "text": text,
        })
    movers.sort(key=lambda m: abs(m["delta"]), reverse=True)
    return movers[:ROI_MAX_MOVERS]


async def _price_increase_action(company_id: str, is_en: bool) -> Optional[Dict[str, Any]]:
    """Price rises from the last two months still in force, in EUR a month
    at the usual quantities - the latest alert per item and supplier."""
    since = datetime.now(timezone.utc) - timedelta(days=ROI_PRICE_LOOKBACK_DAYS)
    alerts = await server.db.price_alerts.find(
        {"company_id": company_id, "direction": "increase", "status": {"$ne": "dismissed"},
         "kind": {"$ne": "pack_suspect"}, "created_at": {"$gte": since}},
        {"_id": 0, "item_name": 1, "supplier": 1, "change_percent": 1, "monthly_impact": 1, "created_at": 1},
    ).to_list(ALL_ROWS)
    latest: Dict[tuple, dict] = {}
    for alert in sorted(alerts, key=lambda a: _as_utc(a["created_at"]) if isinstance(a.get("created_at"), datetime) else since):
        latest[(alert.get("item_name"), alert.get("supplier"))] = alert
    items = sorted(
        (a for a in latest.values() if (a.get("monthly_impact") or 0) > 0),
        key=lambda a: a["monthly_impact"], reverse=True,
    )
    total = sum(a["monthly_impact"] for a in items)
    if total < ROI_SAVINGS_MIN_MONTHLY:
        return None
    top = items[0]
    text = (
        f"Price rises of the last two months cost ≈ {_eur_text(total)}\u00a0€ a month - most of it "
        f"\"{top['item_name']}\" at {top['supplier']} ({top.get('change_percent', 0):+.0f}%). "
        "Negotiate the price or compare suppliers."
        if is_en else
        f"Поскъпванията от последните два месеца струват ≈ {_eur_text(total)}\u00a0€ на месец – най-много "
        f"\"{top['item_name']}\" при {top['supplier']} ({top.get('change_percent', 0):+.0f}%). "
        "Договори цената или сравни доставчиците."
    )
    return {"kind": "price_increases", "monthly_eur": round(total, 2), "route": STATS_ITEMS_ROUTE, "text": text}


async def _cheaper_supplier_action(company_id: str, is_en: bool) -> Optional[Dict[str, Any]]:
    """The same product bought cheaper per kg / l / piece from another
    supplier in the last three months: the saving at the usual quantity if
    the main supplier's purchases had been made at that price."""
    since = datetime.now(timezone.utc) - timedelta(days=ROI_SAVINGS_LOOKBACK_DAYS)
    rows = await server.db.item_price_history.find(
        {"company_id": company_id, "invoice_date": {"$gte": since}},
        {"_id": 0, "item_name": 1, "supplier": 1, "unit_price": 1, "quantity": 1, "unit": 1},
    ).to_list(ROI_MAX_ROWS)
    per_item: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(lambda: defaultdict(lambda: {"spent": 0.0, "base_qty": 0.0}))
    base_units: Dict[str, set] = defaultdict(set)
    for r in rows:
        name = r.get("item_name") or ""
        price = base_unit_price(r.get("unit_price") or 0, name, r.get("unit"))
        quantity = base_quantity(r.get("quantity") or 0, name, r.get("unit"))
        if not price or not quantity or quantity[0] <= 0:
            base_units[name].add(None)
            continue
        base_units[name].add(price[1])
        bucket = per_item[name][r.get("supplier") or "—"]
        bucket["spent"] += price[0] * quantity[0]
        bucket["base_qty"] += quantity[0]
    best: Optional[Dict[str, Any]] = None
    for name, suppliers in per_item.items():
        if len(suppliers) < 2 or len(base_units[name]) != 1 or None in base_units[name]:
            continue
        unit = next(iter(base_units[name]))
        prices = {s: v["spent"] / v["base_qty"] for s, v in suppliers.items() if v["base_qty"] > 0}
        main = max(suppliers, key=lambda s: suppliers[s]["base_qty"])
        cheapest = min(prices, key=lambda s: prices[s])
        if cheapest == main or prices[main] <= 0:
            continue
        share = (prices[main] - prices[cheapest]) / prices[main]
        monthly = (prices[main] - prices[cheapest]) * suppliers[main]["base_qty"] * 30 / ROI_SAVINGS_LOOKBACK_DAYS
        if share < ROI_SAVINGS_MIN_SHARE or monthly < ROI_SAVINGS_MIN_MONTHLY:
            continue
        if best is None or monthly > best["monthly_eur"]:
            text = (
                f"\"{name}\" is {share * 100:.0f}% cheaper per {unit_label(unit)} at {cheapest} than at {main} - "
                f"≈ {_eur_text(monthly)}\u00a0€ a month at your usual quantity."
                if is_en else
                f"\"{name}\" е с {share * 100:.0f}% по-евтин на {unit_label(unit)} при {cheapest}, отколкото при {main} – "
                f"≈ {_eur_text(monthly)}\u00a0€ на месец при обичайното ти количество."
            )
            best = {"kind": "cheaper_supplier", "monthly_eur": round(monthly, 2), "route": STATS_ITEMS_ROUTE, "text": text}
    return best


async def _missing_revenue_action(company_id: Optional[str], scope: dict, year: int, month: int, is_en: bool) -> Optional[Dict[str, Any]]:
    """Open days of the month (until yesterday) with no revenue entered, for
    a company that enters most days - unknown days make profit look worse
    than it is."""
    today = today_local()
    start = date_type(year, month, 1)
    ny, nm = _ym_add(year, month, 1)
    end = min(date_type(ny, nm, 1), today)
    if end <= start:
        return None
    logged = {
        d for d in await server.db.daily_revenue.distinct(
            "date", {**scope, "date": {"$gte": start.isoformat(), "$lt": end.isoformat()}}
        ) if isinstance(d, str)
    }
    closed_weekdays, exceptions_map = await get_closed_days_lookup(company_id)
    open_days = [
        (start + timedelta(days=i)).isoformat() for i in range((end - start).days)
        if not is_date_closed((start + timedelta(days=i)).isoformat(), closed_weekdays, exceptions_map)
    ]
    missing = [d for d in open_days if d not in logged]
    if not open_days or not missing or len(logged) < ROI_MISSING_DAYS_MIN_COVERAGE * len(open_days):
        return None
    text = (
        f"Revenue is missing for {len(missing)} open day(s) this month - until they are entered, profit looks lower than it is."
        if is_en else
        f"Липсва оборот за {len(missing)} работни дни този месец – докато не ги въведеш, печалбата изглежда по-ниска, отколкото е."
    )
    return {"kind": "missing_revenue", "days": len(missing), "monthly_eur": None,
            "route": f"/(tabs)?revenueDate={missing[-1]}", "text": text}


async def build_roi_analysis(
    current_user: User, year: int, month: int, language: str = "bg",
) -> Dict[str, Any]:
    """Everything the ROI card shows, computed from the company's own data
    for this viewer (what they may not see counts as zero, profit only with
    view_profit): the month's totals, the payback over the last six months,
    what moved profit and what can be done, with plain-language lines."""
    is_en = language == "en"
    company_id, scope = await get_company_scope(current_user)
    visibility = get_financial_visibility(current_user)
    now = now_local()
    # The payback window, which also holds the baseline months before the target.
    months = _roi_months(year, month, max(ROI_WINDOW_MONTHS, ROI_BASELINE_MONTHS + 1))
    raw = await _roi_month_data(company_id, scope, current_user.user_id, visibility, months)
    key = f"{year}-{month:02d}"
    in_progress = (year, month) == (now.year, now.month)
    through_day = now.day if in_progress else None
    totals = {k: _month_totals(v, visibility) for k, v in raw.items()}
    target = totals[key]
    personal = raw[key]["personal"]
    profit = target["profit"]
    roi_percent = (profit / personal * 100) if personal > 0 else (0 if profit <= 0 else 100)

    analysis: Dict[str, Any] = {"payback": None, "month": None, "movers": [], "actions": [], "notes": [], "profit_visible": visibility["profit"]}
    if visibility["profit"]:
        window = [f"{y}-{m:02d}" for y, m in months[-ROI_WINDOW_MONTHS:]]
        invested = sum(raw[k]["personal"] for k in window)
        window_profit = sum(totals[k]["profit"] for k in window if totals[k]["has_data"])
        if invested > 0:
            coverage = window_profit / invested
            if window_profit <= 0:
                verdict = (f"the business is at a loss ({_eur_text(window_profit)}\u00a0€), so it is not paying it back yet."
                           if is_en else f"бизнесът е на загуба ({_eur_text(window_profit)}\u00a0€), т.е. вложеното засега не се връща.")
            elif coverage >= 1:
                times = f"{coverage:.1f}"
                verdict = (f"that covers it {times} times." if is_en
                           else f"това го покрива {times.replace('.', ',')} пъти.")
            else:
                verdict = (f"that covers {coverage * 100:.0f}% of it." if is_en
                           else f"това покрива {coverage * 100:.0f}% от него.")
            text = (
                f"Over the last {ROI_WINDOW_MONTHS} months you put in {_eur_text(invested)}\u00a0€ personally; "
                f"the business made {_eur_text(window_profit)}\u00a0€ profit - {verdict}"
                if is_en else
                f"За последните {ROI_WINDOW_MONTHS} месеца си вложил {_eur_text(invested)}\u00a0€ лично, а бизнесът "
                f"е изкарал {_eur_text(window_profit)}\u00a0€ печалба – {verdict}"
            )
            analysis["payback"] = {
                "invested": round(invested, 2), "profit": round(window_profit, 2),
                "coverage": round(coverage, 3), "months": ROI_WINDOW_MONTHS, "text": text,
            }
        so_far = (" so far" if is_en else " досега") if in_progress else ""
        analysis["month"] = {
            "personal": round(personal, 2), "profit": round(profit, 2), "partial": in_progress,
            "through_day": through_day,
            "text": (
                f"This month{so_far}: profit {_eur_text(profit)}\u00a0€ against {_eur_text(personal)}\u00a0€ put in."
                if is_en else
                f"Този месец{so_far}: печалба {_eur_text(profit)}\u00a0€ при вложени {_eur_text(personal)}\u00a0€."
            ),
        }
        # Like with like: while the month runs, the same days of the earlier
        # months, without the monthly payroll and depreciation not due yet.
        before_year, before_month = _ym_add(year, month, -1)
        baseline_keys = [f"{y}-{m:02d}" for y, m in _roi_months(before_year, before_month, ROI_BASELINE_MONTHS)]
        baseline = [_month_totals(raw[k], visibility, through_day) for k in baseline_keys if k in raw]
        target_same_days = _month_totals(raw[key], visibility, through_day) if in_progress else target
        analysis["movers"] = _profit_movers(target_same_days, baseline, is_en)
        if in_progress:
            analysis["notes"].append(
                f"The month is still running: what moved is compared with days 1-{through_day} of the previous months."
                if is_en else
                f"Месецът още тече: промените са спрямо дни 1–{through_day} на предходните месеци."
            )
    if company_id and "view_statistics" in set(current_user.permissions or []):
        for action in (
            await _price_increase_action(company_id, is_en),
            await _cheaper_supplier_action(company_id, is_en),
        ):
            if action:
                analysis["actions"].append(action)
    if company_id and visibility["profit"]:
        missing = await _missing_revenue_action(company_id, scope, year, month, is_en)
        if missing:
            analysis["actions"].append(missing)
    analysis["actions"].sort(key=lambda a: a.get("monthly_eur") or 0, reverse=True)

    days_with_data = await server.db.daily_revenue.count_documents(scope)
    if days_with_data < ROI_MIN_RELIABLE_DAYS:
        analysis["notes"].append(
            f"The company has {days_with_data} days of revenue so far - conclusions get reliable after {ROI_MIN_RELIABLE_DAYS}-60 days."
            if is_en else
            f"Фирмата има {days_with_data} дни с въведен оборот – изводите стават надеждни след {ROI_MIN_RELIABLE_DAYS}–60 дни."
        )
    return {
        "target": target, "personal": personal, "investment_only": raw[key]["investment_only"],
        "roi_percent": roi_percent, "visibility": visibility, "analysis": analysis,
    }


def _analysis_lines(analysis: Dict[str, Any]) -> List[str]:
    """The analysis as plain lines, for app versions that show a list."""
    lines = []
    if analysis.get("payback"):
        lines.append(analysis["payback"]["text"])
    if analysis.get("month"):
        lines.append(analysis["month"]["text"])
    lines += [m["text"] for m in analysis.get("movers", [])]
    lines += [a["text"] for a in analysis.get("actions", [])]
    lines += analysis.get("notes", [])
    return lines


@router.get("/roi/analysis")
@limiter.limit("60/minute")
async def get_roi_analysis(
    request: Request,
    month: Optional[int] = None,
    year: Optional[int] = None,
    language: str = "bg",
    current_user: User = Depends(get_current_user)
):
    """ROI анализ - колко връща бизнесът спрямо личните вложения, какво е
    помръднало печалбата и какво може да се направи. Изисква
    view_personal_investments; без AI извикване (вж. /roi/advice)."""
    require_permission(current_user, "view_personal_investments")
    now = now_local()
    target_month = month or now.month
    target_year = year or now.year
    period_start, period_end = _month_range(target_year, target_month)

    built = await build_roi_analysis(current_user, target_year, target_month, language)
    target, visibility = built["target"], built["visibility"]
    profit = target["profit"]
    personal = built["personal"]
    is_profitable = profit > 0
    investment_covered = profit >= personal

    if visibility["profit"]:
        if personal <= 0 and not built["analysis"]["payback"]:
            ai_insights = ["📊 No personal investment entered for this period"] if language == "en" else ["📊 Няма въведени лични вложения за периода"]
        else:
            ai_insights = _analysis_lines(built["analysis"])
    else:
        ai_insights = ["🔒 You don't have permission to see the profit for the selected period"] if language == "en" else ["🔒 Нямаш право да виждаш печалбата за избрания период"]

    return {
        "period": {"month": target_month, "year": target_year},
        "period_start": period_start,
        "period_end": period_end,
        "total_personal_investment": round(personal, 2),
        "total_investment_only": round(built["investment_only"], 2),
        "total_revenue": round(target["revenue"], 2),
        "total_business_expense": round(target["expenses"], 2),
        "total_profit": round(profit, 2) if visibility["profit"] else None,
        "roi_percent": round(built["roi_percent"], 1) if visibility["profit"] else None,
        "is_profitable": is_profitable if visibility["profit"] else None,
        "investment_covered": investment_covered if visibility["profit"] else None,
        "ai_insights": ai_insights,
        "analysis": built["analysis"] if visibility["profit"] else None,
    }


@router.get("/roi/trend")
async def get_roi_trend(
    months: int = 6,
    current_user: User = Depends(get_current_user)
):
    """Връща ROI тренд за последните N месеца (изисква view_personal_investments) -
    същата печалба като таблото и /roi/analysis (със заплати и амортизация)."""
    require_permission(current_user, "view_personal_investments")
    months = max(1, min(months, 60))
    company_id, scope = await get_company_scope(current_user)
    visibility = get_financial_visibility(current_user)
    now = now_local()
    window = _roi_months(now.year, now.month, months)
    raw = await _roi_month_data(company_id, scope, current_user.user_id, visibility, window)

    trend_data = []
    for target_year, target_month in window:
        month_raw = raw[f"{target_year}-{target_month:02d}"]
        totals = _month_totals(month_raw, visibility)
        total_personal = month_raw["personal"]
        total_profit = totals["profit"]
        roi = (total_profit / total_personal * 100) if total_personal > 0 else (0 if total_profit <= 0 else 100)
        # profit/roi_percent са независимо скриваеми по view_profit, както в
        # get_roi_analysis - личната инвестиция (personal_investment) остава
        # видима, защото целият /roi/trend endpoint вече изисква
        # view_personal_investments за достъп.
        trend_data.append({
            "month": target_month,
            "year": target_year,
            "label": f"{target_month:02d}/{target_year}",
            "personal_investment": round(total_personal, 2),
            "revenue": round(totals["revenue"], 2),
            "profit": round(total_profit, 2) if visibility["profit"] else None,
            "roi_percent": round(roi, 1) if visibility["profit"] else None
        })

    return {"trend": trend_data, "months": months}


class RoiAdvice(BaseModel):
    headline: str = Field(description="One sentence: the single most important thing for the owner now")
    points: List[str] = Field(description="Up to 3 short, concrete next steps, most money first, each grounded in the given numbers")


ROI_ADVICE_SYSTEM = {
    "bg": (
        "Ти си финансов съветник на собственик на малък бизнес - какъвто и да е бизнесът. Получаваш факти, "
        "изчислени от собствените му данни: колко е вложил лично и колко печалба е изкарал бизнесът за последните "
        "месеци, какво е помръднало печалбата този месец и какви действия с ефект в евро са открити. Дай един основен "
        "извод и до 3 конкретни стъпки, подредени по ефект в евро. Използвай само дадените числа - не измисляй нови и "
        "не предполагай бранш. Ако данните са малко или месецът още тече, кажи го и не съветвай за мащабиране. "
        "Суми в евро (€). Пиши кратко и ясно, на български."
    ),
    "en": (
        "You are a financial advisor to the owner of a small business - any kind of business. You get facts computed "
        "from their own data: how much they put in personally and how much profit the business made over recent "
        "months, what moved profit this month, and actions found with an effect in euros. Give one main takeaway and "
        "up to 3 concrete steps, ordered by euro effect. Use only the numbers given - never invent new ones and never "
        "assume a trade. If data is thin or the month is still running, say so and do not advise scaling. Amounts in "
        "euros (€). Short and clear, in English."
    ),
}


@router.get("/roi/advice")
@limiter.limit("20/minute")
async def get_roi_advice(
    request: Request,
    month: Optional[int] = None,
    year: Optional[int] = None,
    language: str = "bg",
    generate: bool = False,
    current_user: User = Depends(get_current_user),
):
    """AI advice on the ROI analysis, grounded in its facts. Kept per company
    and set of facts, so it is asked for once until the numbers change;
    generate=false only returns advice already kept for these facts."""
    require_permission(current_user, "view_personal_investments")
    now = now_local()
    target_month = month or now.month
    target_year = year or now.year
    language = "en" if language == "en" else "bg"
    built = await build_roi_analysis(current_user, target_year, target_month, language)
    analysis = built["analysis"]
    if not server.AI_FEATURES_ENABLED or not built["visibility"]["profit"] or not analysis["payback"]:
        return {"available": False, "advice": None}

    facts = {
        "month": f"{target_month:02d}/{target_year}",
        "payback": {k: analysis["payback"][k] for k in ("invested", "profit", "coverage", "months")},
        "this_month": {k: analysis["month"][k] for k in ("personal", "profit", "partial", "through_day")},
        "what_moved_profit": [{k: m[k] for k in ("kind", "label", "current", "usual", "delta", "profit_effect")} for m in analysis["movers"]],
        "actions": [{"kind": a["kind"], "monthly_eur": a.get("monthly_eur"), "detail": a["text"]} for a in analysis["actions"]],
        "notes": analysis["notes"],
    }
    facts_hash = hashlib.sha1(json.dumps(facts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    company_id, _ = await get_company_scope(current_user)
    cache_key = {"company_id": company_id or current_user.user_id, "facts_hash": facts_hash, "language": language}
    cached = await server.db.roi_advice.find_one(cache_key, {"_id": 0, "headline": 1, "points": 1})
    if cached:
        return {"available": True, "advice": {"headline": cached["headline"], "points": cached["points"]}, "cached": True}
    if not generate:
        return {"available": True, "advice": None}

    try:
        response = await server.anthropic_client.messages.parse(  # type: ignore[union-attr]
            model="claude-opus-5-5",
            max_tokens=1500,
            system=ROI_ADVICE_SYSTEM[language],
            messages=[{"role": "user", "content": json.dumps(facts, ensure_ascii=False)}],
            output_format=RoiAdvice,
        )
    except Exception as e:
        raise ai_exception_to_http(e, "ROI advice")
    await log_ai_usage(company_id, "roi_advice", response)
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise HTTPException(status_code=422, detail="AI не можа да даде съвет за тези данни.")
    advice = {"headline": response.parsed_output.headline.strip(), "points": [p.strip() for p in response.parsed_output.points[:3]]}
    await server.db.roi_advice.update_one(
        cache_key, {"$set": {**cache_key, **advice, "created_at": now}}, upsert=True,
    )
    return {"available": True, "advice": advice, "cached": False}

@router.post("/personal-wallet/entries")
async def create_personal_wallet_entry(
    entry: PersonalWalletEntryCreate,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "add_personal_wallet_entries")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Няма свързана фирма")

    entry_obj = PersonalWalletEntry(
        user_id=current_user.user_id,
        company_id=company_id,
        category=entry.category,
        description=entry.description,
        amount=entry.amount,
        date=entry.date,
        is_recurring=entry.is_recurring,
        next_due_date=entry.next_due_date,
        recurring_until=entry.recurring_until,
        notes=entry.notes,
    )
    await server.db.personal_wallet_entries.insert_one(entry_obj.model_dump())

    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name,
        action="create", entity_type="personal_wallet", entity_id=entry_obj.id,
        company_id=company_id,
        details={"category": entry.category.value, "amount": entry.amount, "description": entry.description},
    )
    return {"message": "Разходът е записан", "id": entry_obj.id}

@router.get("/personal-wallet/entries")
async def get_personal_wallet_entries(
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "view_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"entries": []}

    query: dict = {"company_id": company_id}
    if category:
        query["category"] = category
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = start_date
        if end_date:
            query["date"]["$lte"] = end_date

    entries = await server.db.personal_wallet_entries.find(query, {"_id": 0}).sort("date", -1).to_list(ALL_ROWS)
    return {"entries": entries}

@router.put("/personal-wallet/entries/{entry_id}")
async def update_personal_wallet_entry(
    entry_id: str,
    update: PersonalWalletEntryUpdate,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "manage_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    existing = await server.db.personal_wallet_entries.find_one({"id": entry_id, "company_id": company_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Записът не е намерен")

    update_data = {k: (v.value if hasattr(v, "value") else v) for k, v in update.model_dump(exclude_unset=True).items()}
    update_data["updated_at"] = datetime.now(timezone.utc)
    await server.db.personal_wallet_entries.update_one({"id": entry_id, "company_id": company_id}, {"$set": update_data})

    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name,
        action="update", entity_type="personal_wallet", entity_id=entry_id,
        company_id=company_id, details={k: v for k, v in update_data.items() if k != "updated_at"},
    )
    entry = await server.db.personal_wallet_entries.find_one({"id": entry_id}, {"_id": 0})
    return PersonalWalletEntry(**entry)

@router.delete("/personal-wallet/entries/{entry_id}")
async def delete_personal_wallet_entry(entry_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    existing = await server.db.personal_wallet_entries.find_one({"id": entry_id, "company_id": company_id})
    result = await server.db.personal_wallet_entries.delete_one({"id": entry_id, "company_id": company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")

    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name,
        action="delete", entity_type="personal_wallet", entity_id=entry_id,
        company_id=company_id,
        details={"category": existing.get("category"), "amount": existing.get("amount"), "description": existing.get("description")} if existing else None,
    )
    return {"message": "Записът е изтрит"}

@router.get("/personal-wallet/settings")
async def get_personal_wallet_settings(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "view_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"alert_threshold_percent": 80.0}
    settings = await server.db.personal_wallet_settings.find_one({"company_id": company_id}, {"_id": 0})
    return {"alert_threshold_percent": settings.get("alert_threshold_percent", 80.0) if settings else 80.0}

@router.put("/personal-wallet/settings")
async def update_personal_wallet_settings(
    update: PersonalWalletSettingsUpdate,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "manage_personal_wallet")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Няма свързана фирма")

    await server.db.personal_wallet_settings.update_one(
        {"company_id": company_id},
        {"$set": {"company_id": company_id, "alert_threshold_percent": update.alert_threshold_percent}},
        upsert=True,
    )
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name,
        action="update", entity_type="personal_wallet_settings", company_id=company_id,
        details={"alert_threshold_percent": update.alert_threshold_percent},
    )
    return {"alert_threshold_percent": update.alert_threshold_percent}

@router.get("/personal-wallet/summary")
async def get_personal_wallet_summary(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "view_personal_wallet")
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Няма свързана фирма")

    now = now_local()
    start_date, end_date = _month_bounds(now)
    if now.month == 1:
        prev_month_dt = now.replace(year=now.year - 1, month=12, day=1)
    else:
        prev_month_dt = now.replace(month=now.month - 1, day=1)
    prev_start, prev_end = _month_bounds(prev_month_dt)

    entries = await server.db.personal_wallet_entries.find(
        {"company_id": company_id, "date": {"$gte": start_date, "$lte": end_date}}, {"_id": 0}
    ).to_list(ALL_ROWS)
    prev_entries = await server.db.personal_wallet_entries.find(
        {"company_id": company_id, "date": {"$gte": prev_start, "$lte": prev_end}}, {"_id": 0, "category": 1, "amount": 1}
    ).to_list(ALL_ROWS)

    total_spent = sum(e.get("amount", 0) for e in entries)
    category_totals: dict = {}
    for e in entries:
        category_totals[e["category"]] = category_totals.get(e["category"], 0) + e.get("amount", 0)
    prev_category_totals: dict = {}
    for e in prev_entries:
        prev_category_totals[e["category"]] = prev_category_totals.get(e["category"], 0) + e.get("amount", 0)
    prev_total_spent = sum(prev_category_totals.values())

    needs_total = sum(v for k, v in category_totals.items() if k in {c.value for c in WALLET_NEEDS_CATEGORIES})
    wants_total = sum(v for k, v in category_totals.items() if k in {c.value for c in WALLET_WANTS_CATEGORIES})

    profit_this_month = await _compute_month_profit(company_id, scope, current_user.user_id, start_date, end_date)

    today_str = now.strftime("%Y-%m-%d")
    two_weeks_str = (now + timedelta(days=14)).strftime("%Y-%m-%d")
    upcoming_docs = await server.db.personal_wallet_entries.find(
        {
            "company_id": company_id, "is_recurring": True,
            "next_due_date": {"$gte": today_str, "$lte": two_weeks_str},
            # Once a lease/contract/subscription's own end date has passed,
            # stop flagging it as an upcoming obligation - $or with None
            # matches entries predating this field too.
            "$or": [{"recurring_until": None}, {"recurring_until": {"$gte": today_str}}],
        },
        {"_id": 0, "description": 1, "amount": 1, "next_due_date": 1, "category": 1, "recurring_until": 1},
    ).sort("next_due_date", 1).to_list(50)
    upcoming_due_total = sum(
        u.get("amount", 0) for u in upcoming_docs if u.get("next_due_date", "") <= (now + timedelta(days=7)).strftime("%Y-%m-%d")
    )

    settings = await server.db.personal_wallet_settings.find_one({"company_id": company_id}, {"_id": 0})
    threshold_percent = settings.get("alert_threshold_percent", 80.0) if settings else 80.0

    safe_to_spend = round(profit_this_month - total_spent - upcoming_due_total, 2)
    spent_percent_of_profit = round(total_spent / profit_this_month * 100, 1) if profit_this_month > 0 else None

    status = "ok"
    if spent_percent_of_profit is not None:
        if spent_percent_of_profit >= threshold_percent:
            status = "danger"
        elif spent_percent_of_profit >= threshold_percent * 0.6:
            status = "warning"
    elif profit_this_month <= 0 and total_spent > 0:
        status = "danger"

    advice = generate_wallet_advice(
        total_spent=total_spent, needs_total=needs_total, wants_total=wants_total,
        category_totals=category_totals, last_month_category_totals=prev_category_totals,
        profit_this_month=profit_this_month, safe_to_spend=safe_to_spend,
        threshold_percent=threshold_percent, spent_percent_of_profit=spent_percent_of_profit,
        upcoming=upcoming_docs,
    )

    return {
        "period": {"start": start_date, "end": end_date},
        "total_spent": round(total_spent, 2),
        "prev_month_total_spent": round(prev_total_spent, 2),
        "category_totals": {k: round(v, 2) for k, v in category_totals.items()},
        "needs_total": round(needs_total, 2),
        "wants_total": round(wants_total, 2),
        "profit_this_month": round(profit_this_month, 2),
        "safe_to_spend": safe_to_spend,
        "threshold_percent": threshold_percent,
        "spent_percent_of_profit": spent_percent_of_profit,
        "status": status,
        "upcoming": upcoming_docs,
        "advice": advice,
    }

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
    _compute_month_profit,
    _business_digest_period,
    _business_digest_top_expenses,
    _business_digest_receivables,
    _business_digest_vat_due,
    _business_digest_roi,
    _business_digest_assets,
    _business_digest_payroll,
    _business_digest_schedule,
    _business_digest_scan_credits,
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
# Comprehensive ask-my-numbers digest (2026-10 revision): reuses the real
# forecast/price-alert/reorder-nudge route functions directly instead of
# duplicating their logic a second time - none of the three takes a
# Request or carries its own rate limiter, so calling them with just
# current_user is safe (same cross-router reuse pattern exports.py
# already uses for get_summary/get_supplier_statistics/get_item_statistics).
from routers.price_tracking import get_price_alerts, get_reorder_nudges
from routers.forecast import get_revenue_forecast, get_expense_forecast
from routers.roi_wallet import get_personal_wallet_summary

router = APIRouter(prefix="/api")

async def build_business_chat_digest(current_user: User) -> dict:
    """Everything ask_my_numbers grounds its answer in - split out from the
    route handler so it's directly unit-testable (asyncio.run) without
    needing AI_FEATURES_ENABLED on or a live Anthropic call. Every field a
    role-sensitive permission gates returns None for a viewer who lacks
    it, exactly like the single-purpose endpoint each duplicates/reuses -
    never a 403 for the whole digest, since most of it is still valid for
    them."""
    company_id, scope = await get_company_scope(current_user)
    visibility = get_financial_visibility(current_user)

    now = datetime.now(timezone.utc)
    this_month_start = now.replace(day=1).strftime("%Y-%m-%d")
    this_month_end = now.strftime("%Y-%m-%d")
    last_month_last_day = now.replace(day=1) - timedelta(days=1)
    last_month_start = last_month_last_day.replace(day=1).strftime("%Y-%m-%d")
    last_month_end = last_month_last_day.strftime("%Y-%m-%d")

    this_month = await _business_digest_period(company_id, scope, current_user.user_id, this_month_start, this_month_end, visibility)
    last_month = await _business_digest_period(company_id, scope, current_user.user_id, last_month_start, last_month_end, visibility)
    top_expenses = await _business_digest_top_expenses(scope, this_month_start, this_month_end, visibility)

    # Outstanding payables - always company-wide, same reasoning as
    # /statistics/summary: an invoice from two months ago that's still
    # unpaid is still owed today.
    unpaid_invoices = await server.db.invoices.find(
        {**scope, "payment_method": "bank_transfer", "is_paid": False},
        {"_id": 0, "total_amount": 1, "paid_amount": 1, "payment_due_date": 1},
    ).to_list(1000)
    now_ts = datetime.now(timezone.utc)

    def _is_overdue(inv):
        due = inv.get("payment_due_date")
        if not due:
            return False
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        return due < now_ts

    unpaid = {
        "count": len(unpaid_invoices),
        "overdue_count": sum(1 for inv in unpaid_invoices if _is_overdue(inv)),
        "total_unpaid_amount": round(sum(inv.get("total_amount", 0) - inv.get("paid_amount", 0) for inv in unpaid_invoices), 2),
    }

    budget = None
    if company_id and "manage_budget" in set(current_user.permissions or []):
        budget_status = await compute_budget_status(company_id, now.strftime("%Y-%m"))
        if budget_status:
            budget = {
                "expense_limit": budget_status["expense_limit"],
                "total_spent": budget_status["total_spent"],
                "percent_used": budget_status["percent_used"],
            }

    # What customers owe the business - the mirror image of unpaid_invoices
    # above, gated the same way the real /receivables/summary endpoint is
    # (add_revenue), same pattern as budget's manage_budget gate just above.
    perms = set(current_user.permissions or [])
    receivables = None
    if "add_revenue" in perms:
        receivables = await _business_digest_receivables(scope)

    # VAT due this period - role-invariant (see _business_digest_vat_due).
    vat_due_this_month = await _business_digest_vat_due(scope, this_month_start, this_month_end)

    # Next-month forecast - reuses the real, already-visibility-correct
    # endpoints rather than calling ForecastService a second time here.
    def _compact_forecast(raw: dict) -> Optional[dict]:
        if not raw or not raw.get("forecast"):
            return None
        next_month = raw["forecast"][0]
        return {
            "next_month_predicted": next_month["predicted_amount"],
            "trend": raw["trend"],  # "increasing" | "decreasing" | "stable" | "insufficient_data"
            "months_of_history": raw.get("months_of_history", 0),
        }
    revenue_forecast_raw = await get_revenue_forecast(months_ahead=1, current_user=current_user)
    expense_forecast_raw = await get_expense_forecast(months_ahead=1, current_user=current_user)
    forecast = {
        "revenue": _compact_forecast(revenue_forecast_raw),
        "expenses": _compact_forecast(expense_forecast_raw),
    }

    # ROI / personal-investment snapshot - gated by view_personal_investments,
    # same permission the real /roi/analysis endpoint requires.
    roi = None
    if "view_personal_investments" in perms:
        roi = await _business_digest_roi(company_id, scope, now, visibility)

    # Fixed assets - gated by manage_budget, same as /assets/summary.
    assets = None
    if "manage_budget" in perms:
        assets = await _business_digest_assets(scope)

    # Payroll headcount/cost - gated by manage_budget, same as /payroll.
    payroll = None
    if "manage_budget" in perms:
        payroll = await _business_digest_payroll(company_id, current_user.user_id, scope, this_month_start, this_month_end)

    # Work Schedule hours/unpaid amount/who's on leave - gated by
    # manage_budget, same as /work-schedule itself for a manager's view of it.
    schedule = None
    if "manage_budget" in perms:
        schedule = await _business_digest_schedule(company_id, this_month_start, this_month_end)

    # Personal-wallet status - gated by view_personal_wallet, same as the
    # real /personal-wallet/summary endpoint. Compact on purpose: the full
    # advice list is for the dashboard teaser, not for grounding an AI answer.
    personal_wallet = None
    if "view_personal_wallet" in perms:
        wallet_summary = await get_personal_wallet_summary(current_user=current_user)
        personal_wallet = {
            "total_spent": wallet_summary["total_spent"],
            "status": wallet_summary["status"],
            "spent_percent_of_profit": wallet_summary.get("spent_percent_of_profit"),
        }

    # Scan credits - no extra gate, same as GET /scan-credits (a shared
    # company resource, not private financial data).
    scan_credits = await _business_digest_scan_credits(company_id, current_user.user_id)

    # Price alerts / reorder nudges - both already ungated beyond
    # view_statistics (which the whole endpoint already requires), reused
    # directly from their own routers rather than re-querying here.
    price_alerts_raw = await get_price_alerts(current_user=current_user)
    reorder_raw = await get_reorder_nudges(current_user=current_user)
    price_alerts_unread_count = price_alerts_raw.get("unread_count", 0)
    reorder_nudges = [
        {
            "item_name": n["item_name"], "days_since_last": n["days_since_last"],
            "median_days_between": n["median_days_between"], "avg_order_value": n.get("avg_order_value", 0),
        }
        for n in reorder_raw.get("nudges", [])[:5]
    ]

    digest = {
        "this_month": {"label": this_month_start[:7], **this_month},
        "last_month": {"label": last_month_start[:7], **last_month},
        "top_expenses_this_month": top_expenses,
        "unpaid_invoices": unpaid,
        "vat_due_this_month": vat_due_this_month,
        "forecast": forecast,
        "budget": budget,
        "receivables": receivables,
        "roi": roi,
        "assets": assets,
        "payroll": payroll,
        "schedule": schedule,
        "personal_wallet": personal_wallet,
        "scan_credits": scan_credits,
        "price_alerts_unread_count": price_alerts_unread_count,
        "reorder_nudges": reorder_nudges,
    }
    return digest

@router.post("/ai/ask-my-numbers", response_model=BusinessChatResponse)
@limiter.limit("15/minute")
async def ask_my_numbers(
    request: Request,
    query: BusinessChatQuery,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, "view_statistics")
    question = query.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Въпросът не може да бъде празен.")
    if len(question) > 500:
        raise HTTPException(status_code=400, detail="Въпросът е твърде дълъг.")
    if not server.AI_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="AI функцията не е конфигурирана на сървъра.")

    digest = await build_business_chat_digest(current_user)
    company_id, _ = await get_company_scope(current_user)

    # The app's own UI can be in Bulgarian or English (Профил/Profile ->
    # language switch, or the Home screen's own quick toggle) - the
    # answer must follow whichever one the client is actually showing,
    # not always Bulgarian regardless of it (that mismatch - an English
    # screen around a Bulgarian answer - is exactly what was reported).
    response_language = "английски (English)" if query.language == "en" else "български"

    system_prompt = (
        "Ти си асистент на малък бизнес във Фактура+, който отговаря САМО въз основа на подадените му по-долу "
        "реални данни за тази фирма (JSON) и предходния разговор. Никога не отговаряй с измислени или закръглени "
        "наизуст числа - цитирай само числата от JSON-а. Полетата, които са null (budget, receivables, roi, assets, "
        "payroll, schedule, personal_wallet), означават, че този потребител няма права да ги вижда - кажи му го ясно вместо да твърдиш, че "
        "данните липсват изобщо. Ако въпросът иска нещо извън тези данни (НАП, данъчни декларации, конкуренти, "
        "обща информация извън тази фирма, или нещо, за което просто няма поле в JSON-а), кажи ясно, че не "
        "разполагаш с тази информация, вместо да гадаеш. forecast.*.trend == 'insufficient_data' означава, че "
        "фирмата няма достатъчно история (под 4 месеца) за истинска прогноза - next_month_predicted е просто "
        "средното от наличните месеци, не истинска тенденция; кажи го изрично, вместо да звучиш по-сигурен, "
        "отколкото данните позволяват. Предходните съобщения по-долу са същият разговор - при последващ въпрос "
        "('сравни с него', 'ами миналата седмица') използвай контекста им, но винаги смятай с актуалните данни от "
        "ПОСЛЕДНИЯ JSON, не с число, спомена в по-ранен твой отговор. Отговаряй кратко (до 4 изречения), ВИНАГИ на "
        f"{response_language} независимо от езика на въпроса или на по-ранни съобщения в разговора, сумите винаги "
        "в евро (€). Профитът (profit) може да е null вътре в този JSON дори когато "
        "самият обект не е null - това означава, че този потребител няма права да вижда печалбата конкретно; в "
        "такъв случай кажи, че печалбата не е видима за него, вместо да я извеждаш или предполагаш."
    )

    # The client resends this chat's prior turns on every call since the
    # endpoint itself holds no session state - capped here regardless of
    # what it sends, both so one runaway/malicious client can't blow up a
    # single request's token cost and so a very long on-screen chat still
    # costs roughly the same per message instead of growing unbounded.
    MAX_HISTORY_TURNS = 12
    MAX_TURN_CHARS = 2000
    history_messages = [
        {"role": turn.role, "content": turn.text[:MAX_TURN_CHARS]}
        for turn in query.history[-MAX_HISTORY_TURNS:]
    ]
    prompt = f"Данни за фирмата (JSON, актуални към момента):\n{json.dumps(digest, ensure_ascii=False)}\n\nВъпрос: {question}"

    try:
        response = await anthropic_client.messages.create(  # type: ignore[union-attr]  # guarded by the AI_FEATURES_ENABLED check above; anthropic_client is non-None whenever that is true
            model="claude-opus-5-5",
            max_tokens=500,
            system=system_prompt,
            messages=[*history_messages, {"role": "user", "content": prompt}],  # type: ignore[list-item]  # plain dicts matching MessageParam's shape; the SDK's union is stricter than a dict literal can satisfy
        )
        await log_ai_usage(company_id, "ask_my_numbers", response)
        answer = next((b.text for b in response.content if b.type == "text"), "").strip()  # type: ignore[union-attr]  # b.type == "text" guards this at runtime; mypy cannot narrow a discriminated union inside a generator expression
        if not answer:
            raise RuntimeError("empty AI response")
    except Exception as e:
        raise ai_exception_to_http(e, "Ask-my-numbers error")

    return BusinessChatResponse(answer=answer, digest=digest)

@router.get("/proactive/signals")
async def list_proactive_signals(current_user: User = Depends(get_current_user)):
    return {"signals": await get_proactive_signals(current_user)}

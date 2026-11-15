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
from routers.price_tracking import get_price_alerts, get_reorder_nudges, get_merged_item_statistics
from routers.forecast import get_revenue_forecast, get_expense_forecast
from routers.roi_wallet import get_personal_wallet_summary
from routers.chat_tools import ChatDataTools, build_chat_tools

router = APIRouter(prefix="/api")

# Model calls one question may use for look-ups before it must answer.
ASK_MAX_MODEL_CALLS = 6

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
            "recommended_quantity": n.get("recommended_quantity", 0), "unit": n.get("unit", ""),
        }
        for n in reorder_raw.get("nudges", [])[:5]
    ]

    # Per-item purchase quantities - the actual "what and how much did I
    # buy" data ask-my-numbers was previously missing entirely: it only
    # ever carried overdue-reorder nudges (a narrow, overdue-only subset),
    # never a plain quantity breakdown. Unrestricted date range (the
    # company's whole item_price_history, not just the current/previous
    # calendar month) so a question about any item ever bought can be
    # answered, not only a recent one - capped to the top 10 by money
    # spent (matching get_merged_item_statistics's own default cap) to keep
    # the digest bounded. Ranked by spend, not quantity: a quantity ranking
    # adds pieces to kilograms, so cheap sachets and napkins pushed the
    # items that actually cost money (meat, cheese) out of the list.
    # Reuses the already-built, already-merge-mapping-aware
    # /statistics/items/merged endpoint (top_by_value) rather than
    # re-aggregating item_price_history a second time here.
    item_purchases_raw = await get_merged_item_statistics(
        start_date=None, end_date=None, top_n=10, current_user=current_user
    )
    item_purchases = [
        {
            "name": it["name"],
            "quantity": it["total_quantity"],
            "unit": it.get("unit", "бр."),
            "purchases_count": it["frequency"],
            "total_spent": it["total_value"],
        }
        for it in item_purchases_raw.get("top_by_value", [])[:10]
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
        "item_purchases": item_purchases,
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
    company_id, scope = await get_company_scope(current_user)

    # The app's own UI can be in Bulgarian or English (Профил/Profile ->
    # language switch, or the Home screen's own quick toggle) - the
    # answer must follow whichever one the client is actually showing,
    # not always Bulgarian regardless of it (that mismatch - an English
    # screen around a Bulgarian answer - is exactly what was reported).
    response_language = "английски (English)" if query.language == "en" else "български"

    today = datetime.now(timezone.utc).date().isoformat()
    system_prompt = (
        "Ти си асистент на малък бизнес във Фактура+ и отговаряш САМО въз основа на реалните данни на тази "
        f"фирма: резюмето (JSON) в съобщението и инструментите, с които търсиш в данните й. Днес е {today}. "
        "Първо провери дали резюмето вече съдържа отговора. Ако въпросът е за конкретен артикул, доставчик, "
        "ден, седмица, месец, година или сравнение, които ги няма в резюмето, използвай инструментите - никога "
        "не отговаряй, че няма данни, преди да си потърсил с подходящия инструмент. Периоди като 'миналия "
        "месец', 'през март', 'миналата седмица' превръщай в точни дати спрямо днешната. item_purchases в "
        "резюмето са само 10-те артикула с най-голям разход за цялата история; за всеки друг артикул или период "
        "ползвай инструмента item_purchases. Когато инструментът върне няколко сходни артикула, ползвай тези, "
        "които отговарят на въпроса, кажи кои си ползвал и никога не събирай различни мерни единици. Ден без "
        "въведен оборот е неизвестен, а не нулев - ако в периода има невъведени дни, кажи го. Цитирай само числа "
        "от данните - никога измислени или закръглени наизуст. Полетата, които са null (budget, receivables, "
        "roi, assets, payroll, schedule, personal_wallet), както и profit: null, означават, че този потребител "
        "няма права да ги вижда - кажи му го ясно, вместо да твърдиш, че данните липсват изобщо. Ако въпросът е "
        "извън данните на фирмата (НАП, данъчни декларации, конкуренти, обща информация), кажи ясно, че не "
        "разполагаш с такава информация, вместо да гадаеш. forecast.*.trend == 'insufficient_data' означава "
        "под 4 месеца история - next_month_predicted е просто средното, не истинска тенденция; кажи го изрично. "
        "Предходните съобщения са същият разговор - при последващ въпрос ('сравни с него', 'ами миналата "
        "седмица') ползвай контекста им, но смятай с актуалните данни, не с число от по-ранен твой отговор. "
        f"Отговаряй кратко (до 4 изречения), ВИНАГИ на {response_language} независимо от езика на въпроса или "
        "на по-ранни съобщения, сумите в евро (€)."
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

    # The model answers from the digest when it can and looks up anything
    # else itself (an item, a supplier, any period) through these tools -
    # all scoped to this company and to what this viewer may see. The SDK's
    # tool runner runs the loop; each model call is logged for cost.
    tools = build_chat_tools(ChatDataTools(current_user, company_id, scope, get_financial_visibility(current_user)))
    try:
        runner = server.anthropic_client.beta.messages.tool_runner(  # type: ignore[union-attr, call-overload]  # client is non-None whenever AI_FEATURES_ENABLED (checked above); the params are plain dicts the SDK's TypedDict overloads can't match
            model="claude-opus-5-5",
            max_tokens=4000,
            max_iterations=ASK_MAX_MODEL_CALLS,
            system=system_prompt,
            tools=tools,
            messages=[*history_messages, {"role": "user", "content": prompt}],  # type: ignore[list-item]  # plain dicts matching MessageParam's shape; the SDK's union is stricter than a dict literal can satisfy
            output_config={"effort": "medium"},
            cache_control={"type": "ephemeral"},
            # A policy decline is retried on another model inside the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        final = None
        async for message in runner:
            await log_ai_usage(company_id, "ask_my_numbers", message)
            final = message
        if final is None:
            raise RuntimeError("empty AI response")
        if final.stop_reason == "refusal":
            raise HTTPException(status_code=422, detail="AI асистентът не може да отговори на този въпрос.")
        answer = "\n".join(b.text for b in final.content if b.type == "text").strip()
        if not answer:
            # Still looking things up when the call budget ran out.
            answer = (
                "Не успях да събера отговора с позволения брой търсения - попитай по-конкретно "
                "(артикул, доставчик или период)." if query.language != "en" else
                "I couldn't put the answer together within the allowed number of look-ups - "
                "please ask more specifically (an item, a supplier or a period)."
            )
    except HTTPException:
        raise
    except Exception as e:
        raise ai_exception_to_http(e, "Ask-my-numbers error")

    return BusinessChatResponse(answer=answer, digest=digest)

@router.get("/proactive/signals")
async def list_proactive_signals(current_user: User = Depends(get_current_user)):
    return {"signals": await get_proactive_signals(current_user)}


class SignalStateUpdate(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    fingerprint: str = Field(min_length=1, max_length=64)
    action: Literal["snooze", "dismiss", "still_buying", "discontinue"]
    # reorder_stale only: which (merged) item the answer is about
    item_key: Optional[str] = Field(default=None, max_length=300)


@router.post("/proactive/signals/state")
async def update_signal_state(body: SignalStateUpdate, current_user: User = Depends(get_current_user)):
    """Remembers what this viewer said about a Home signal: "snooze" puts
    it off for SIGNAL_SNOOZE_DAYS, "dismiss" (done/hide) hides it until
    its situation changes. Money-at-risk signals can only be snoozed.

    For the "do you still buy it?" question: "discontinue" also stops
    reorder reminders for the item until it is bought again - company-wide,
    since it is a fact about the business, not a view preference - and
    "still_buying" just stops asking until the next purchase."""
    now = datetime.now(timezone.utc)
    if body.action in ("still_buying", "discontinue"):
        if body.key != "reorder_stale" or not body.item_key:
            raise HTTPException(status_code=400, detail="Невалидно действие за този сигнал")
        require_permission(current_user, "view_statistics")
        if body.action == "discontinue":
            company_id, _ = await get_company_scope(current_user)
            if not company_id:
                raise HTTPException(status_code=400, detail="Нямате фирма")
            item_key = body.item_key.strip().lower()
            await server.db.item_preferences.update_one(
                {"company_id": company_id, "item_key": item_key},
                {"$set": {
                    "company_id": company_id, "item_key": item_key,
                    "discontinued_at": now, "discontinued_by": current_user.user_id,
                }},
                upsert=True,
            )
        stored_action = "dismiss"
    elif body.action == "dismiss" and body.key in SNOOZE_ONLY_SIGNALS:
        raise HTTPException(status_code=400, detail="Сигнал за пари в риск може само да се отложи")
    else:
        stored_action = body.action

    days = SIGNAL_SNOOZE_DAYS if stored_action == "snooze" else SIGNAL_DISMISS_DAYS
    await server.db.signal_states.update_one(
        {"user_id": current_user.user_id, "key": body.key, "fingerprint": body.fingerprint},
        {"$set": {
            "user_id": current_user.user_id, "key": body.key, "fingerprint": body.fingerprint,
            "action": stored_action, "until": now + timedelta(days=days), "updated_at": now,
        }},
        upsert=True,
    )
    # "Done" on the price signal means these alerts were seen - same as
    # closing the price-alert popup, so the two never disagree.
    if stored_action == "dismiss" and body.key == "price_alerts" and "view_statistics" in set(current_user.permissions or []):
        _, scope = await get_company_scope(current_user)
        await server.db.price_alerts.update_many({**scope, "status": "unread"}, {"$set": {"status": "read"}})
    return {"ok": True, "action": stored_action}

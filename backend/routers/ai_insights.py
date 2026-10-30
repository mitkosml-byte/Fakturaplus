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

    digest = {
        "this_month": {"label": this_month_start[:7], **this_month},
        "last_month": {"label": last_month_start[:7], **last_month},
        "top_expenses_this_month": top_expenses,
        "unpaid_invoices": unpaid,
        "budget": budget,
    }

    system_prompt = (
        "Ти си асистент на малък бизнес във Фактура+, който отговаря САМО въз основа на подадените му по-долу "
        "реални данни за тази фирма (JSON). Никога не отговаряй с измислени или закръглени наизуст числа - "
        "цитирай само числата от JSON-а. Ако въпросът иска нещо извън тези данни (НАП, данъчни декларации, "
        "конкуренти, обща информация извън тази фирма), кажи ясно, че не разполагаш с тази информация. "
        "Отговаряй кратко (до 4 изречения), на български, сумите винаги в евро (€). Профитът (profit) може да "
        "е null - това означава, че този потребител няма права да го вижда; в такъв случай кажи, че печалбата "
        "не е видима за него, вместо да я извеждаш или предполагаш."
    )
    prompt = f"Данни за фирмата (JSON):\n{json.dumps(digest, ensure_ascii=False)}\n\nВъпрос: {question}"

    try:
        response = await anthropic_client.messages.create(  # type: ignore[union-attr]  # guarded by the AI_FEATURES_ENABLED check above; anthropic_client is non-None whenever that is true
            model="claude-opus-5-5",
            max_tokens=400,
            system=system_prompt,
            messages=[{"role": "user", "content": prompt}],
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

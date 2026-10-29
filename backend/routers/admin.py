"""Module 1 audit finding - extracted from the former monolithic server.py.
Shares server.py's db/models/helpers/services via `from server import *`;
`db` and `AI_FEATURES_ENABLED` are the two globals tests/startup reassign
after module load, so this file always accesses them as `server.db` /
`server.AI_FEATURES_ENABLED` (qualified), never via the star-import, to
stay correct when server.py's test fixture monkeypatches them."""
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

@router.get("/admin/ai-usage-summary")
async def get_ai_usage_summary(days: int = 30, current_user: User = Depends(get_current_user)):
    """Real AI-cost summary built from logged response.usage data (see
    log_ai_usage above) - the measurement channel this app uses instead of
    Anthropic's own Usage/Cost Admin API, which it has no admin key for.
    Costs are an ESTIMATE at Claude Opus 5.5's currently published rates
    (fetched from platform.claude.com/docs/en/about-claude/pricing on
    2026-10-28) - re-check that page if the real bill ever looks off, since
    rates can change and this endpoint doesn't re-fetch them."""
    require_permission(current_user, "manage_budget")
    from collections import defaultdict

    _, scope = await get_company_scope(current_user)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    entries = await server.db.ai_usage_log.find({**scope, "created_at": {"$gte": since}}, {"_id": 0}).to_list(100000)

    RATES_USD_PER_MTOK = {"input": 4.0, "output": 20.0, "cache_creation": 5.0, "cache_read": 0.20}

    by_endpoint = defaultdict(lambda: {
        "calls": 0, "input_tokens": 0, "output_tokens": 0,
        "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0,
    })
    for e in entries:
        bucket = by_endpoint[e.get("endpoint", "unknown")]
        bucket["calls"] += 1
        bucket["input_tokens"] += e.get("input_tokens", 0)
        bucket["output_tokens"] += e.get("output_tokens", 0)
        bucket["cache_creation_input_tokens"] += e.get("cache_creation_input_tokens", 0)
        bucket["cache_read_input_tokens"] += e.get("cache_read_input_tokens", 0)

    def estimate_cost(b: dict) -> float:
        return (
            b["input_tokens"] / 1_000_000 * RATES_USD_PER_MTOK["input"] +
            b["output_tokens"] / 1_000_000 * RATES_USD_PER_MTOK["output"] +
            b["cache_creation_input_tokens"] / 1_000_000 * RATES_USD_PER_MTOK["cache_creation"] +
            b["cache_read_input_tokens"] / 1_000_000 * RATES_USD_PER_MTOK["cache_read"]
        )

    breakdown = []
    total_cost = 0.0
    for endpoint, bucket in by_endpoint.items():
        cost = estimate_cost(bucket)
        total_cost += cost
        breakdown.append({"endpoint": endpoint, "estimated_cost_usd": round(cost, 4), **bucket})
    breakdown.sort(key=lambda x: x["estimated_cost_usd"], reverse=True)

    return {
        "days": days,
        "total_estimated_cost_usd": round(total_cost, 4),
        "by_endpoint": breakdown,
    }

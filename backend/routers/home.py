"""Home in one request (Л14): the period's numbers, the day's review, a new
business's first steps, the invoicing card, the scans left, the day card and
the personal notebook's month - which used to be separate requests, some
sent two or three times as each card refreshed itself.

Each part is exactly what its own endpoint answers, worked out by that
endpoint's handler, so the numbers on Home and on every other screen stay
one and the same. A part this viewer may not see comes back as null, as
its endpoint would have refused it."""
import asyncio
import logging
from typing import Any, Awaitable, Optional

from fastapi import APIRouter, Depends, HTTPException

from server import User, get_current_user
from routers.ai_insights import list_proactive_signals
from routers.company import getting_started
from routers.day_card import build_day_card
from routers.receivables import get_billing_overview
from routers.roi_wallet import get_personal_wallet_summary
from routers.scan_credits import get_scan_credits
from routers.statistics import get_summary

router = APIRouter(prefix="/api")


async def _part(work: Awaitable[Any]) -> Any:
    try:
        return await work
    except HTTPException:
        return None


@router.get("/home")
async def get_home(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    # The invoicing card is worked out only where Home shows it.
    with_billing: bool = False,
    # The day card's texts.
    language: str = "bg",
    current_user: User = Depends(get_current_user),
):
    """Everything Home shows for the period, in one answer."""
    async def nothing() -> None:
        return None

    # The personal notebook's month - only for whoever may see the notebook.
    sees_notebook = "view_personal_wallet" in set(current_user.permissions or [])
    summary, signals, started, billing, credits, day_card, notebook = await asyncio.gather(
        _part(get_summary(start_date=start_date, end_date=end_date, current_month_only=True, current_user=current_user)),
        _part(list_proactive_signals(current_user=current_user)),
        _part(getting_started(current_user=current_user)),
        _part(get_billing_overview(start_date=start_date, end_date=end_date, current_user=current_user))
        if with_billing else nothing(),
        _part(get_scan_credits(current_user=current_user)),
        _day_card(current_user, "en" if language == "en" else "bg"),
        _quiet(get_personal_wallet_summary(current_user=current_user), "Personal notebook")
        if sees_notebook else nothing(),
    )
    return {
        "summary": summary,
        "signals": signals["signals"] if signals else None,
        "getting_started": started,
        "billing_overview": billing,
        "scan_credits": credits,
        "day_card": day_card,
        "personal_wallet": notebook,
    }


async def _day_card(current_user: User, language: str) -> Any:
    """The day card never keeps Home from loading: whatever goes wrong in
    it, Home comes without it."""
    return await _quiet(build_day_card(current_user, language), "Day card")


async def _quiet(work: Awaitable[Any], what: str) -> Any:
    """A part that never keeps Home from loading: whatever goes wrong in it
    (a refusal included), Home comes without it."""
    try:
        return await work
    except HTTPException:
        return None
    except Exception:
        logging.getLogger(__name__).exception(f"{what} failed")
        return None

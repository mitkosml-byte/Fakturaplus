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
    _expand_shift_occurrences,
    _shift_hours,
    _leave_conflict_for,
)
import server

router = APIRouter(prefix="/api")

# Work schedule is deliberately NOT gated behind team_collaboration or
# manage_budget for a caller looking at their OWN shifts - it's their own
# worked time/pay, same principle as every other self-facing field in this
# app (e.g. the business-chat digest never 403s a viewer out of their own
# data). Only creating/editing shifts - anyone else's time and money - and
# viewing the whole team's schedule requires manage_budget, same tier as
# payroll/leave/holiday-work.


def _can_manage_schedule(current_user: User) -> bool:
    return "manage_budget" in set(current_user.permissions or [])


@router.post("/schedule/shifts", response_model=WorkShift)
async def create_shift(payload: WorkShiftCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате активна фирма")

    assignee = await server.db.users.find_one({"user_id": payload.user_id, **scope}, {"_id": 0, "user_id": 1})
    if not assignee:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен в тази фирма")

    if payload.repeat_pattern not in WORK_SHIFT_REPEAT_PATTERNS:
        raise HTTPException(status_code=400, detail="Невалиден тип повторение")
    if payload.repeat_pattern != "none" and not payload.repeat_until:
        raise HTTPException(status_code=400, detail="Повтарящ се график трябва да има крайна дата")
    if payload.repeat_until and payload.repeat_until < payload.date:
        raise HTTPException(status_code=400, detail="Крайната дата е преди началната")

    shift = WorkShift(company_id=company_id, created_by=current_user.user_id, **payload.model_dump())
    await server.db.work_shifts.insert_one(shift.model_dump())
    return shift


async def _resolve_occurrences(shifts: List[dict], company_id: Optional[str], start: str, end: str) -> List[dict]:
    user_ids = {s["user_id"] for s in shifts}
    users = await server.db.users.find(
        {"user_id": {"$in": list(user_ids)}}, {"_id": 0, "user_id": 1, "name": 1}
    ).to_list(1000) if user_ids else []
    name_by_id = {u["user_id"]: u["name"] for u in users}

    occurrences = []
    for shift in shifts:
        dates = _expand_shift_occurrences(shift, start, end)
        for occ_date in dates:
            conflict = await _leave_conflict_for(company_id, shift["user_id"], occ_date)
            occurrences.append({
                "shift_id": shift["id"],
                "user_id": shift["user_id"],
                "user_name": name_by_id.get(shift["user_id"], "?"),
                "date": occ_date,
                "start_time": shift["start_time"],
                "end_time": shift["end_time"],
                "hours": _shift_hours(shift["start_time"], shift["end_time"]),
                "hourly_rate": shift.get("hourly_rate"),
                "note": shift.get("note"),
                "repeat_pattern": shift.get("repeat_pattern", "none"),
                "repeat_until": shift.get("repeat_until"),
                "leave_conflict": conflict is not None,
            })
    occurrences.sort(key=lambda o: (o["date"], o["start_time"]))
    return occurrences


@router.get("/schedule/shifts")
async def list_shifts(
    start: str, end: str, user_id: Optional[str] = None, current_user: User = Depends(get_current_user)
):
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        return {"occurrences": []}

    query: Dict[str, Any] = {"company_id": company_id}
    if _can_manage_schedule(current_user):
        if user_id:
            query["user_id"] = user_id
    else:
        # Never trusts a caller-supplied user_id here - a plain team
        # member can only ever see their own shifts, regardless of what
        # the query string asks for.
        query["user_id"] = current_user.user_id

    # A recurring shift's own anchor date can be well before `start` (its
    # occurrences still fall inside the window) - so the DB filter can
    # only narrow by "not already fully past repeat_until", the
    # occurrence-level date filtering happens in _resolve_occurrences.
    query["$or"] = [{"repeat_until": {"$gte": start}}, {"repeat_until": None, "date": {"$lte": end}}]

    shifts = await server.db.work_shifts.find(query, {"_id": 0}).to_list(5000)
    occurrences = await _resolve_occurrences(shifts, company_id, start, end)
    return {"occurrences": occurrences}


@router.put("/schedule/shifts/{shift_id}", response_model=WorkShift)
async def update_shift(shift_id: str, update: WorkShiftUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    existing = await server.db.work_shifts.find_one({"id": shift_id, "company_id": company_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Смяната не е намерена")

    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    repeat_pattern = update_data.get("repeat_pattern", existing.get("repeat_pattern", "none"))
    if repeat_pattern not in WORK_SHIFT_REPEAT_PATTERNS:
        raise HTTPException(status_code=400, detail="Невалиден тип повторение")
    repeat_until = update_data.get("repeat_until", existing.get("repeat_until"))
    if repeat_pattern != "none" and not repeat_until:
        raise HTTPException(status_code=400, detail="Повтарящ се график трябва да има крайна дата")

    if update_data:
        await server.db.work_shifts.update_one({"id": shift_id}, {"$set": update_data})
    updated = await server.db.work_shifts.find_one({"id": shift_id}, {"_id": 0})
    return WorkShift(**updated)


@router.delete("/schedule/shifts/{shift_id}")
async def delete_shift(shift_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    result = await server.db.work_shifts.delete_one({"id": shift_id, "company_id": company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Смяната не е намерена")
    return {"message": "Смяната е изтрита"}


@router.get("/schedule/summary")
async def get_schedule_summary(
    start: str, end: str, user_id: Optional[str] = None, current_user: User = Depends(get_current_user)
):
    """Total scheduled hours + an estimated gross pay (hours * hourly_rate)
    for one team member over a period - a planning estimate from the
    schedule itself, not a substitute for the real payroll calculation in
    routers/payroll.py (which handles taxes/insurance for a formal
    monthly salary, a different computation entirely)."""
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        return {"total_hours": 0, "estimated_pay": 0, "shift_count": 0}

    target_user_id = current_user.user_id
    if _can_manage_schedule(current_user) and user_id:
        target_user_id = user_id
    elif not _can_manage_schedule(current_user) and user_id and user_id != current_user.user_id:
        raise HTTPException(status_code=403, detail="Нямате права да виждате чужд график")

    shifts = await server.db.work_shifts.find(
        {"company_id": company_id, "user_id": target_user_id}, {"_id": 0}
    ).to_list(5000)
    occurrences = await _resolve_occurrences(shifts, company_id, start, end)

    total_hours = round(sum(o["hours"] for o in occurrences), 2)
    estimated_pay = round(sum(o["hours"] * (o["hourly_rate"] or 0) for o in occurrences), 2)
    return {"total_hours": total_hours, "estimated_pay": estimated_pay, "shift_count": len(occurrences)}

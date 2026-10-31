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

from routers.payroll import list_leave

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

    shift_ids = [s["id"] for s in shifts]
    adjustment_rows = await server.db.shift_adjustments.find(
        {"shift_id": {"$in": shift_ids}, "date": {"$gte": start, "$lte": end}}, {"_id": 0}
    ).to_list(5000) if shift_ids else []
    adjustment_by_key = {(a["shift_id"], a["date"]): a for a in adjustment_rows}

    occurrences = []
    for shift in shifts:
        dates = _expand_shift_occurrences(shift, start, end)
        for occ_date in dates:
            conflict = await _leave_conflict_for(company_id, shift["user_id"], occ_date)
            scheduled_hours = _shift_hours(shift["start_time"], shift["end_time"])
            adjustment = adjustment_by_key.get((shift["id"], occ_date))
            # An adjustment corrects what actually happened on this one
            # date - when present, it's authoritative over the plan
            # (hours AND, if given, rate), without touching any other
            # occurrence of the same recurring series.
            effective_hours = adjustment["actual_hours"] if adjustment else scheduled_hours
            effective_rate = shift.get("hourly_rate")
            if adjustment and adjustment.get("actual_hourly_rate") is not None:
                effective_rate = adjustment["actual_hourly_rate"]
            occurrences.append({
                "shift_id": shift["id"],
                "user_id": shift["user_id"],
                "user_name": name_by_id.get(shift["user_id"], "?"),
                "date": occ_date,
                "start_time": shift["start_time"],
                "end_time": shift["end_time"],
                "scheduled_hours": scheduled_hours,
                "hours": effective_hours,
                "hourly_rate": effective_rate,
                "note": shift.get("note"),
                "repeat_pattern": shift.get("repeat_pattern", "none"),
                "repeat_until": shift.get("repeat_until"),
                "leave_conflict": conflict is not None,
                "adjusted": adjustment is not None,
                "adjustment_reason": adjustment.get("reason") if adjustment else None,
                "adjusted_by_name": adjustment.get("adjusted_by_name") if adjustment else None,
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


@router.get("/schedule/leave")
async def get_schedule_leave(start: str, end: str, current_user: User = Depends(get_current_user)):
    """Approved leave for every team member who has a linked payroll
    record, resolved from employee_id to their real account's user_id -
    lets the grid show "on leave" blocks directly, without the frontend
    having to cross-reference employees itself. Reuses list_leave's own
    overlap query and manage_budget gate directly rather than
    re-deriving either."""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return {"leave": []}

    leave_entries = await list_leave(start_date=start, end_date=end, current_user=current_user)
    if not leave_entries:
        return {"leave": []}

    employee_ids = list({entry.employee_id for entry in leave_entries})
    employees = await server.db.employees.find(
        {"id": {"$in": employee_ids}, "company_id": company_id}, {"_id": 0, "id": 1, "linked_user_id": 1}
    ).to_list(1000)
    linked_by_employee = {e["id"]: e.get("linked_user_id") for e in employees}

    result = []
    for entry in leave_entries:
        user_id = linked_by_employee.get(entry.employee_id)
        if not user_id:
            continue
        result.append({
            "id": entry.id,
            "user_id": user_id,
            "employee_name": entry.employee_name,
            "leave_type": entry.leave_type,
            "start_date": entry.start_date,
            "end_date": entry.end_date,
            "note": entry.note,
        })
    return {"leave": result}


@router.put("/schedule/shifts/{shift_id}/occurrences/{occ_date}/adjustment", response_model=ShiftAdjustment)
async def adjust_shift_occurrence(
    shift_id: str, occ_date: str, payload: ShiftAdjustmentCreate, current_user: User = Depends(get_current_user)
):
    """Corrects the hours (and optionally the rate) actually worked on ONE
    occurrence of a shift - for a dispute or an inaccuracy, without
    editing the shift's own template (which would change the plan for
    every other occurrence of the same recurring series too). Re-running
    this for the same (shift_id, occ_date) replaces the previous
    correction rather than stacking a second one."""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    shift = await server.db.work_shifts.find_one({"id": shift_id, "company_id": company_id}, {"_id": 0})
    if not shift:
        raise HTTPException(status_code=404, detail="Смяната не е намерена")

    # The date must be a real occurrence of this shift, not an arbitrary
    # one - same narrow single-day expansion used by the generic listing,
    # just bounded to one date.
    if occ_date not in _expand_shift_occurrences(shift, occ_date, occ_date):
        raise HTTPException(status_code=400, detail="Тази дата не е част от графика на тази смяна")
    if payload.actual_hours <= 0:
        raise HTTPException(status_code=400, detail="Отработените часове трябва да са положително число")
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Моля, посочете причина за корекцията")

    adjustment = ShiftAdjustment(
        company_id=company_id or "",
        shift_id=shift_id,
        user_id=shift["user_id"],
        date=occ_date,
        actual_hours=payload.actual_hours,
        actual_hourly_rate=payload.actual_hourly_rate,
        reason=payload.reason.strip(),
        adjusted_by=current_user.user_id,
        adjusted_by_name=current_user.name,
    )
    await server.db.shift_adjustments.update_one(
        {"shift_id": shift_id, "date": occ_date},
        {"$set": adjustment.model_dump()},
        upsert=True,
    )
    # A correction to someone's pay is exactly the kind of action
    # GET /audit-logs needs to be able to answer "who changed this, to
    # what, and why" for - same reasoning as logging a role/permission
    # change.
    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="update",
        entity_type="shift_adjustment",
        entity_id=shift_id,
        company_id=company_id,
        details={
            "date": occ_date, "employee_user_id": adjustment.user_id,
            "actual_hours": payload.actual_hours, "actual_hourly_rate": payload.actual_hourly_rate,
            "reason": adjustment.reason,
        },
    )
    return adjustment


@router.delete("/schedule/shifts/{shift_id}/occurrences/{occ_date}/adjustment")
async def remove_shift_adjustment(shift_id: str, occ_date: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    result = await server.db.shift_adjustments.delete_one(
        {"shift_id": shift_id, "date": occ_date, "company_id": company_id}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Няма корекция за тази дата")
    return {"message": "Корекцията е премахната - часовете се връщат по график"}


@router.post("/schedule/payments", response_model=SchedulePayment)
async def create_schedule_payment(payload: SchedulePaymentCreate, current_user: User = Depends(get_current_user)):
    """Marks a period's scheduled (and any corrected) hours for one team
    member as paid - unlike the formal payroll entries, Work Schedule's
    hours*rate estimate is never counted in business expenses on its
    own, only once a manager explicitly confirms it was actually paid.
    Creates a real off-book expense for the computed amount, so it's
    counted in /statistics/summary like any other cost, and records a
    marker so the same days can't be paid twice."""
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате активна фирма")
    if payload.period_end < payload.period_start:
        raise HTTPException(status_code=400, detail="Крайната дата е преди началната")

    member = await server.db.users.find_one({"user_id": payload.user_id, **scope}, {"_id": 0, "user_id": 1, "name": 1})
    if not member:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен в тази фирма")

    # A period that overlaps an already-paid one is rejected outright -
    # the same days must never be paid (and expensed) twice.
    overlap = await server.db.schedule_payments.find_one({
        "company_id": company_id, "user_id": payload.user_id,
        "period_start": {"$lte": payload.period_end}, "period_end": {"$gte": payload.period_start},
    })
    if overlap:
        raise HTTPException(status_code=409, detail="Част от този период вече е маркирана като платена")

    shifts = await server.db.work_shifts.find(
        {"company_id": company_id, "user_id": payload.user_id}, {"_id": 0}
    ).to_list(5000)
    occurrences = await _resolve_occurrences(shifts, company_id, payload.period_start, payload.period_end)
    total_hours = round(sum(o["hours"] for o in occurrences), 2)
    amount = round(sum(o["hours"] * (o["hourly_rate"] or 0) for o in occurrences), 2)
    if total_hours <= 0 or amount <= 0:
        raise HTTPException(status_code=400, detail="Няма отработени часове с положителна сума за този период")

    expense = NonInvoiceExpense(
        user_id=current_user.user_id,
        company_id=company_id,
        description=f"Възнаграждение по график - {member['name']} ({payload.period_start} - {payload.period_end})",
        amount=amount,
        date=payload.period_end,
    )
    await server.db.expenses.insert_one(expense.model_dump())

    payment = SchedulePayment(
        company_id=company_id,
        user_id=payload.user_id,
        user_name=member["name"],
        period_start=payload.period_start,
        period_end=payload.period_end,
        total_hours=total_hours,
        amount=amount,
        expense_id=expense.id,
        paid_by=current_user.user_id,
        paid_by_name=current_user.name,
    )
    await server.db.schedule_payments.insert_one(payment.model_dump())

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="create",
        entity_type="schedule_payment",
        entity_id=payment.id,
        company_id=company_id,
        details={
            "employee": member["name"], "period": f"{payload.period_start} - {payload.period_end}",
            "amount": amount, "total_hours": total_hours,
        },
    )
    return payment


@router.get("/schedule/payments")
async def list_schedule_payments(
    start: str, end: str, user_id: Optional[str] = None, current_user: User = Depends(get_current_user)
):
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        return {"payments": []}

    query: Dict[str, Any] = {"company_id": company_id, "period_start": {"$lte": end}, "period_end": {"$gte": start}}
    if _can_manage_schedule(current_user):
        if user_id:
            query["user_id"] = user_id
    else:
        query["user_id"] = current_user.user_id

    payments = await server.db.schedule_payments.find(query, {"_id": 0}).sort("period_start", 1).to_list(1000)
    return {"payments": payments}


@router.delete("/schedule/payments/{payment_id}")
async def delete_schedule_payment(payment_id: str, current_user: User = Depends(get_current_user)):
    """Undoes a payment marker AND removes the expense it created - a
    whole reversal, not a partial one, so the two collections never
    drift out of sync."""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    payment = await server.db.schedule_payments.find_one({"id": payment_id, "company_id": company_id}, {"_id": 0})
    if not payment:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    await server.db.expenses.delete_one({"id": payment["expense_id"], "company_id": company_id})
    await server.db.schedule_payments.delete_one({"id": payment_id})
    return {"message": "Плащането е отменено"}

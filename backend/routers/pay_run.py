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
import server

# Reuses the real single-item endpoints directly rather than duplicating
# their validation/computation a second time - same cross-router pattern
# ai_insights.py already uses for forecast/price-tracking. Neither takes
# a Request or carries its own rate limiter, so calling them with just
# (payload, current_user) is safe.
from routers.payroll import create_payroll_entry
from routers.schedule import create_schedule_payment

router = APIRouter(prefix="/api")


class BatchPayResultItem(BaseModel):
    kind: str  # "payroll" | "schedule"
    label: str  # employee/team-member name, for display regardless of success
    success: bool
    error: Optional[str] = None
    amount: Optional[float] = None


class BatchPayRequest(BaseModel):
    payroll_entries: List[PayrollEntryCreate] = Field(default_factory=list)
    schedule_payments: List[SchedulePaymentCreate] = Field(default_factory=list)


@router.post("/pay-run/batch")
async def batch_pay(payload: BatchPayRequest, current_user: User = Depends(get_current_user)):
    """Pays several team members in one action - some on a fixed monthly
    salary (formal payroll), others hourly (Work Schedule) - instead of
    visiting two separate screens one person at a time. Each item is
    attempted independently via the exact same endpoints a single-item
    payment would use (create_payroll_entry/create_schedule_payment), so
    one failure (a duplicate entry for someone already paid this month,
    zero scheduled hours for someone else) never blocks the rest of the
    batch - the response reports success/failure per person."""
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)

    employee_names: Dict[str, str] = {}
    if payload.payroll_entries:
        employee_ids = [item.employee_id for item in payload.payroll_entries]
        employees = await server.db.employees.find(
            {"id": {"$in": employee_ids}, **scope}, {"_id": 0, "id": 1, "name": 1}
        ).to_list(1000)
        employee_names = {e["id"]: e["name"] for e in employees}

    member_names: Dict[str, str] = {}
    if payload.schedule_payments:
        user_ids = [item.user_id for item in payload.schedule_payments]
        members = await server.db.users.find(
            {"user_id": {"$in": user_ids}, **scope}, {"_id": 0, "user_id": 1, "name": 1}
        ).to_list(1000)
        member_names = {m["user_id"]: m["name"] for m in members}

    results: List[BatchPayResultItem] = []

    for item in payload.payroll_entries:
        label = employee_names.get(item.employee_id, item.employee_id)
        try:
            entry = await create_payroll_entry(item, current_user)
            results.append(BatchPayResultItem(
                kind="payroll", label=entry["employee_name"], success=True, amount=entry["total_employer_cost"],
            ))
        except HTTPException as e:
            results.append(BatchPayResultItem(kind="payroll", label=label, success=False, error=str(e.detail)))

    for sched_item in payload.schedule_payments:
        label = member_names.get(sched_item.user_id, sched_item.user_id)
        try:
            schedule_payment = await create_schedule_payment(sched_item, current_user)
            results.append(BatchPayResultItem(
                kind="schedule", label=schedule_payment.user_name, success=True, amount=schedule_payment.amount,
            ))
        except HTTPException as e:
            results.append(BatchPayResultItem(kind="schedule", label=label, success=False, error=str(e.detail)))

    return {"results": results}

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

@router.get("/payroll/rates")
async def get_payroll_rates(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    return await get_payroll_rates_dict(company_id)

@router.put("/payroll/rates")
async def update_payroll_rates(request: Request, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")

    body = await request.json()
    update_data = {k: float(v) for k, v in body.items() if k in DEFAULT_PAYROLL_RATES}

    existing = await server.db.payroll_rates.find_one({"company_id": company_id})
    if existing:
        await server.db.payroll_rates.update_one({"company_id": company_id}, {"$set": update_data})
    else:
        rates = PayrollRates(company_id=company_id, **{**DEFAULT_PAYROLL_RATES, **update_data})
        await server.db.payroll_rates.insert_one(rates.model_dump())

    return await get_payroll_rates_dict(company_id)

async def _validate_linked_user_id(linked_user_id: Optional[str], company_id: Optional[str], scope: dict) -> None:
    if linked_user_id is None:
        return
    member = await server.db.users.find_one({"user_id": linked_user_id, **scope}, {"_id": 0, "user_id": 1})
    if not member:
        raise HTTPException(status_code=404, detail="Избраният потребител не е от вашата фирма")

@router.post("/employees", response_model=Employee)
async def create_employee(employee: EmployeeCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    await _validate_linked_user_id(employee.linked_user_id, company_id, scope)

    employee_obj = Employee(user_id=current_user.user_id, company_id=company_id, **employee.model_dump())
    await server.db.employees.insert_one(employee_obj.model_dump())
    return employee_obj

@router.get("/employees", response_model=List[Employee])
async def get_employees(active_only: bool = False, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    # Uses the same get_company_scope-based scope as update/delete_employee
    # and the payroll endpoints below (not simple_scope_query) - otherwise a
    # legacy pre-company-id employee record would still be reachable by ID
    # through those, but invisible in this very list (Module 1 audit finding).
    _, scope = await get_company_scope(current_user)

    query = dict(scope)
    if active_only:
        query["active"] = True

    employees = await server.db.employees.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return [Employee(**e) for e in employees]

@router.put("/employees/{employee_id}", response_model=Employee)
async def update_employee(employee_id: str, update: EmployeeUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    update_data = {k: v for k, v in update.model_dump().items() if v is not None}
    company_id, scope = await get_company_scope(current_user)
    if "linked_user_id" in update_data:
        await _validate_linked_user_id(update_data["linked_user_id"], company_id, scope)
    result = await server.db.employees.update_one({"id": employee_id, **scope}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")
    employee = await server.db.employees.find_one({"id": employee_id}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")
    return Employee(**employee)

@router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    result = await server.db.employees.delete_one({"id": employee_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")
    return {"message": "Служителят е изтрит"}

@router.post("/payroll/preview")
async def preview_payroll(entry: PayrollEntryCreate, current_user: User = Depends(get_current_user)):
    """Изчислява разбивка без да записва - за преглед преди потвърждение."""
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    employee = await server.db.employees.find_one({"id": entry.employee_id, **scope}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")

    rates = await get_payroll_rates_dict(company_id)

    base_amount = entry.net_target if employee["agreement_type"] == "net" and entry.net_target is not None else (entry.gross_amount if entry.gross_amount is not None else employee["base_salary"])

    return calculate_payroll(
        base_amount=base_amount,
        agreement_type=employee["agreement_type"],
        rates=rates,
        bonus_amount=entry.bonus_amount,
        food_vouchers=employee.get("food_vouchers", 0),
        additional_insurance=employee.get("additional_insurance", 0),
    )

@router.post("/payroll")
async def create_payroll_entry(entry: PayrollEntryCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    employee = await server.db.employees.find_one({"id": entry.employee_id, **scope}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")

    rates = await get_payroll_rates_dict(company_id)

    base_amount = entry.net_target if employee["agreement_type"] == "net" and entry.net_target is not None else (entry.gross_amount if entry.gross_amount is not None else employee["base_salary"])

    breakdown = calculate_payroll(
        base_amount=base_amount,
        agreement_type=employee["agreement_type"],
        rates=rates,
        bonus_amount=entry.bonus_amount,
        food_vouchers=employee.get("food_vouchers", 0),
        additional_insurance=employee.get("additional_insurance", 0),
    )

    existing = await server.db.payroll_entries.find_one({
        "employee_id": entry.employee_id,
        "period_month": entry.period_month,
        "period_year": entry.period_year,
    })
    if existing:
        raise HTTPException(status_code=409, detail="Вече има ведомост за този служител за този месец")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user.user_id,
        "company_id": company_id,
        "employee_id": entry.employee_id,
        "employee_name": employee["name"],
        "period_month": entry.period_month,
        "period_year": entry.period_year,
        "bonus_amount": round(entry.bonus_amount, 2),
        "notes": entry.notes,
        "image_base64": entry.image_base64,
        "created_at": datetime.now(timezone.utc),
        # Whether this specific record should count toward total business
        # expenses (get_payroll_cost_for_period) - on by default, since
        # that's the real formal payroll cost. Lets the owner/accountant
        # explicitly exclude one entry (e.g. a draft, or one already
        # accounted for elsewhere) without deleting the record itself.
        "counted_in_expenses": True,
        **breakdown,
    }
    await server.db.payroll_entries.insert_one(doc)

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="create",
        entity_type="payroll",
        entity_id=doc["id"],
        company_id=company_id,
        details={"employee": employee["name"], "period": f"{entry.period_month}/{entry.period_year}", "total_employer_cost": breakdown["total_employer_cost"]}
    )

    doc.pop("_id", None)
    doc.pop("image_base64", None)
    return doc

@router.get("/payroll")
async def get_payroll_entries(
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)

    query = simple_scope_query(company_id, current_user.user_id)
    if year:
        query["period_year"] = year
    if month:
        query["period_month"] = month

    entries = await server.db.payroll_entries.find(query, {"_id": 0, "image_base64": 0}).sort([("period_year", -1), ("period_month", -1)]).to_list(1000)
    return entries

@router.put("/payroll/{entry_id}/counted-in-expenses")
async def set_payroll_entry_counted_in_expenses(entry_id: str, request: Request, current_user: User = Depends(get_current_user)):
    """Toggles whether this one payroll entry counts toward total business
    expenses (get_payroll_cost_for_period) - gives the owner/accountant
    explicit control per entry, same reasoning as Work Schedule's own
    pay-as-expense toggle, without needing to delete/recreate the record."""
    require_permission(current_user, "manage_budget")
    body = await request.json()
    counted = body.get("counted_in_expenses")
    if not isinstance(counted, bool):
        raise HTTPException(status_code=400, detail="counted_in_expenses трябва да е true/false")
    _, scope = await get_company_scope(current_user)
    result = await server.db.payroll_entries.update_one(
        {"id": entry_id, **scope}, {"$set": {"counted_in_expenses": counted}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    return {"counted_in_expenses": counted}

@router.delete("/payroll/{entry_id}")
async def delete_payroll_entry(entry_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    result = await server.db.payroll_entries.delete_one({"id": entry_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    return {"message": "Записът е изтрит"}

@router.get("/holidays")
async def get_holidays(year: int, current_user: User = Depends(get_current_user)):
    """Официалният календар на неработните дни за годината - публична
    информация, не се филтрира по фирма."""
    return get_bulgarian_public_holidays(year)

@router.post("/employees/holiday-work", response_model=EmployeeHolidayWork)
async def create_holiday_work(payload: EmployeeHolidayWorkCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    employee = await _get_employee_for_company(payload.employee_id, company_id, current_user)

    holiday_name = _holiday_name_for_date(payload.date)
    if not holiday_name:
        raise HTTPException(status_code=400, detail="Избраната дата не е официален празник")

    entry = EmployeeHolidayWork(
        company_id=company_id or "",
        employee_id=payload.employee_id,
        employee_name=employee["name"],
        date=payload.date,
        holiday_name=holiday_name,
        note=payload.note,
    )
    await server.db.employee_holiday_work.insert_one(entry.model_dump())
    return entry

@router.get("/employees/holiday-work", response_model=List[EmployeeHolidayWork])
async def list_holiday_work(start_date: Optional[str] = None, end_date: Optional[str] = None, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    query = dict(scope)
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = start_date
        if end_date:
            query["date"]["$lte"] = end_date
    entries = await server.db.employee_holiday_work.find(query, {"_id": 0}).sort("date", 1).to_list(10000)
    return [EmployeeHolidayWork(**e) for e in entries]

@router.delete("/employees/holiday-work/{entry_id}")
async def delete_holiday_work(entry_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    result = await server.db.employee_holiday_work.delete_one({"id": entry_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    return {"message": "Записът е изтрит"}

@router.post("/employees/leave", response_model=EmployeeLeave)
async def create_leave(payload: EmployeeLeaveCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    employee = await _get_employee_for_company(payload.employee_id, company_id, current_user)

    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="Крайната дата е преди началната")

    entry = EmployeeLeave(
        company_id=company_id or "",
        employee_id=payload.employee_id,
        employee_name=employee["name"],
        leave_type=payload.leave_type,
        start_date=payload.start_date,
        end_date=payload.end_date,
        note=payload.note,
    )
    await server.db.employee_leave.insert_one(entry.model_dump())
    return entry

@router.get("/employees/leave", response_model=List[EmployeeLeave])
async def list_leave(start_date: Optional[str] = None, end_date: Optional[str] = None, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    query = dict(scope)
    # Overlap match - a leave period only needs to intersect the requested
    # window, not fall entirely inside it (e.g. leave spanning month-end).
    if start_date:
        query["end_date"] = {"$gte": start_date}
    if end_date:
        query["start_date"] = {"$lte": end_date}
    entries = await server.db.employee_leave.find(query, {"_id": 0}).sort("start_date", 1).to_list(10000)
    return [EmployeeLeave(**e) for e in entries]

@router.delete("/employees/leave/{entry_id}")
async def delete_leave(entry_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    result = await server.db.employee_leave.delete_one({"id": entry_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    return {"message": "Записът е изтрит"}

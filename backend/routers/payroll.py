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
    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="create",
        entity_type="employee",
        entity_id=employee_obj.id,
        company_id=company_id,
        details={"name": employee_obj.name, "base_salary": employee_obj.base_salary},
    )
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
    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="update",
        entity_type="employee",
        entity_id=employee_id,
        company_id=company_id,
        details={"name": employee["name"], "changed_fields": update_data},
    )
    return Employee(**employee)

@router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    existing = await server.db.employees.find_one({"id": employee_id, **scope}, {"_id": 0, "name": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")
    await server.db.employees.delete_one({"id": employee_id, **scope})
    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="delete",
        entity_type="employee",
        entity_id=employee_id,
        company_id=company_id,
        details={"name": existing["name"]},
    )
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

# ===================== PAYROLL PDF IMPORT (ведомост от счетоводителя) =====================

class PayrollImportEntryPreview(BaseModel):
    name: str
    egn: Optional[str] = None
    position: Optional[str] = None
    gross_amount: float
    insurance_base: float
    employee_contributions: float
    employer_contributions: float
    income_tax: float
    other_deductions: float = 0
    net_amount: float
    matched_employee_id: Optional[str] = None
    matched_employee_name: Optional[str] = None
    match_confidence: float = 0
    already_imported: bool = False

class PayrollImportPreviewResponse(BaseModel):
    period_month: int
    period_year: int
    entries: List[PayrollImportEntryPreview]

class PayrollImportCommitEntry(BaseModel):
    employee_id: str
    period_month: int = Field(ge=1, le=12)
    period_year: int
    gross_amount: float = Field(gt=0)
    insurance_base: float = Field(ge=0)
    employee_contributions: float = Field(ge=0)
    employer_contributions: float = Field(ge=0)
    income_tax: float = Field(ge=0)
    other_deductions: float = Field(default=0, ge=0)
    net_amount: float = Field(ge=0)

class PayrollImportCommitRequest(BaseModel):
    entries: List[PayrollImportCommitEntry]

# Below this, a fuzzy name match is treated as "no confident suggestion" -
# the UI still lets the user pick an employee manually, this just controls
# whether a dropdown opens pre-filled or empty.
MIN_PAYROLL_IMPORT_MATCH_CONFIDENCE = 0.5

def _match_payroll_import_entries(
    parsed_entries: List[dict], employees: List[dict], employees_with_existing_entry: set
) -> List[dict]:
    """Fuzzy-matches each parsed ведомост entry to one of the company's own
    Employee records by name - the only identifying field both sides share
    (the PDF's ЕГН is shown back to the user for visual confirmation but
    never persisted; Employee itself carries no такова поле). Same
    _compare_key/_similarity normalization already used for supplier-name
    matching elsewhere, kept here as its own pure function so it's testable
    without a live Anthropic call. employees_with_existing_entry is a set
    of employee_ids that already have a payroll_entries doc for this exact
    period, so a re-import of the same ведомост is flagged before commit
    rather than silently creating a duplicate."""
    previews = []
    for entry in parsed_entries:
        entry_key = _compare_key(entry["name"])
        best_id = None
        best_name = None
        best_score = 0.0
        for emp in employees:
            score = _similarity(entry_key, _compare_key(emp["name"]))
            if score > best_score:
                best_score = score
                best_id = emp["id"]
                best_name = emp["name"]
        matched = best_score >= MIN_PAYROLL_IMPORT_MATCH_CONFIDENCE
        matched_id = best_id if matched else None
        previews.append({
            **entry,
            "matched_employee_id": matched_id,
            "matched_employee_name": best_name if matched else None,
            "match_confidence": round(best_score, 2),
            "already_imported": bool(matched_id and matched_id in employees_with_existing_entry),
        })
    return previews

# Generous for a multi-page, multi-employee ведомост PDF exported straight
# from accounting software - these are small (text + a couple of logos),
# nowhere near a scanned-photo invoice's size.
MAX_PAYROLL_PDF_BYTES = 15 * 1024 * 1024

@router.post("/payroll/import/preview", response_model=PayrollImportPreviewResponse)
@limiter.limit("10/minute")
async def preview_payroll_import(request: Request, file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """Parses the accountant's own ведомост PDF (one of the two standard
    layouts - see PAYROLL_IMPORT_SYSTEM_PROMPT) via Claude's native PDF
    understanding, fuzzy-matches each parsed person to a company Employee
    record, and returns a preview for the user to confirm/adjust - nothing
    is written to the database here, exactly like /ocr/scan's own
    preview-before-save contract for invoices."""
    require_permission(current_user, "manage_budget")
    if not server.AI_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="AI разпознаването временно не е налично. Моля, въведете данните ръчно.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Празен файл")
    if len(content) > MAX_PAYROLL_PDF_BYTES:
        raise HTTPException(status_code=413, detail="Файлът е твърде голям (макс. 15MB).")

    company_id, scope = await get_company_scope(current_user)
    pdf_base64 = base64.b64encode(content).decode()

    try:
        response = await anthropic_client.messages.parse(  # type: ignore[union-attr]  # guarded by the AI_FEATURES_ENABLED check above; anthropic_client is non-None whenever that is true
            model="claude-opus-5-5",
            max_tokens=8000,
            system=PAYROLL_IMPORT_SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_base64}},  # type: ignore[list-item]  # plain dict matching DocumentBlockParam's shape; the SDK's content union is stricter than a dict literal can satisfy
                    {"type": "text", "text": "Извлечи всички лица от тази ведомост за заплати."}
                ]
            }],
            output_format=ClaudePayrollImportExtraction,
        )
        await log_ai_usage(company_id, "payroll_import", response)
        extracted = response.parsed_output
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Payroll import parse failed: {str(e)}")
        raise HTTPException(status_code=500, detail="Грешка при разпознаване на ведомостта")

    if extracted is None or not extracted.entries:
        raise HTTPException(status_code=422, detail="Не успяхме да разпознаем лица във ведомостта. Моля, проверете файла или въведете данните ръчно.")

    employees = await server.db.employees.find(scope, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
    existing = await server.db.payroll_entries.find(
        {**scope, "period_month": extracted.period_month, "period_year": extracted.period_year},
        {"_id": 0, "employee_id": 1},
    ).to_list(1000)
    employees_with_existing_entry = {e["employee_id"] for e in existing}

    parsed_dicts = [e.model_dump() for e in extracted.entries]
    enriched = _match_payroll_import_entries(parsed_dicts, employees, employees_with_existing_entry)

    return PayrollImportPreviewResponse(
        period_month=extracted.period_month,
        period_year=extracted.period_year,
        entries=[PayrollImportEntryPreview(**e) for e in enriched],
    )

@router.post("/payroll/import/commit")
async def commit_payroll_import(payload: PayrollImportCommitRequest, current_user: User = Depends(get_current_user)):
    """Creates one payroll_entries doc per confirmed entry, carrying the
    accountant's own real breakdown through verbatim (no calculate_payroll
    re-derivation) - the entries list here is exactly what the user
    confirmed/edited on top of the preview, each tied to an employee_id
    they picked explicitly."""
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)

    imported = 0
    skipped = []
    for entry in payload.entries:
        employee = await server.db.employees.find_one({"id": entry.employee_id, **scope}, {"_id": 0})
        if not employee:
            skipped.append({"employee_id": entry.employee_id, "message": "Служителят не е намерен"})
            continue

        existing = await server.db.payroll_entries.find_one({
            "employee_id": entry.employee_id,
            "period_month": entry.period_month,
            "period_year": entry.period_year,
        })
        if existing:
            skipped.append({"employee_id": entry.employee_id, "message": f"Вече има ведомост за {employee['name']} за {entry.period_month}/{entry.period_year}"})
            continue

        total_employer_cost = round(
            entry.gross_amount + entry.employer_contributions
            + employee.get("food_vouchers", 0) + employee.get("additional_insurance", 0),
            2,
        )
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": current_user.user_id,
            "company_id": company_id,
            "employee_id": entry.employee_id,
            "employee_name": employee["name"],
            "period_month": entry.period_month,
            "period_year": entry.period_year,
            "bonus_amount": 0.0,
            "notes": "Импортирано от ведомост на счетоводителя",
            "image_base64": None,
            "created_at": datetime.now(timezone.utc),
            "counted_in_expenses": True,
            "source": "accountant_import",
            "gross_amount": round(entry.gross_amount, 2),
            "insurance_base": round(entry.insurance_base, 2),
            "employee_contributions": round(entry.employee_contributions, 2),
            "employer_contributions": round(entry.employer_contributions, 2),
            "income_tax": round(entry.income_tax, 2),
            "other_deductions": round(entry.other_deductions, 2),
            "net_amount": round(entry.net_amount, 2),
            "food_vouchers": round(employee.get("food_vouchers", 0), 2),
            "additional_insurance": round(employee.get("additional_insurance", 0), 2),
            "total_employer_cost": total_employer_cost,
        }
        await server.db.payroll_entries.insert_one(doc)
        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="create",
            entity_type="payroll",
            entity_id=doc["id"],
            company_id=company_id,
            details={
                "employee": employee["name"],
                "period": f"{entry.period_month}/{entry.period_year}",
                "total_employer_cost": total_employer_cost,
                "source": "accountant_import",
            },
        )
        imported += 1

    return {"imported": imported, "skipped": skipped, "total": len(payload.entries)}

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

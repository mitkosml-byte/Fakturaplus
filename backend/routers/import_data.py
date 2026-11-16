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

# Cross-domain reuse: the commit handler below calls each entity's own
# create_* route handler directly per row (see this module's own
# docstring further down) - explicit imports, not the `from server
# import *` above, since server.py's own re-export of these (for
# _signal_receivables/_signal_reorder) runs AFTER this module is first
# imported from the bottom of server.py and wouldn't be visible yet.
from routers.invoices import create_invoice
from routers.revenue_expenses import create_daily_revenue, create_expense
from routers.assets import create_asset
from routers.budget import create_budget
from routers.payroll import create_payroll_entry
from server import _IMPORT_PERMISSIONS

router = APIRouter(prefix="/api")


def _below_zero(value: Any) -> bool:
    try:
        return float(value) < 0
    except (TypeError, ValueError):
        return False


def _expense_key(day: Any, description: Any, amount: Any) -> tuple:
    try:
        money = round(float(amount or 0), 2)
    except (TypeError, ValueError):
        money = 0.0
    return (str(day or "")[:10], " ".join(str(description or "").split()).lower(), money)

@router.get("/import/template/{entity}")
async def get_import_template(entity: str, current_user: User = Depends(get_current_user)):
    if entity not in import_service.ENTITY_TEMPLATES:
        raise HTTPException(status_code=404, detail="Непознат тип за импорт")
    require_permission(current_user, _IMPORT_PERMISSIONS[entity])
    try:
        data = import_service.build_template(entity)
    except import_service.ImportFileError as e:
        raise HTTPException(status_code=500, detail=str(e))
    filename = f"shablon_{entity}.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@router.post("/import/{entity}/preview")
@limiter.limit("20/minute")
async def import_preview(entity: str, request: Request, file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    if entity not in import_service.ENTITY_TEMPLATES:
        raise HTTPException(status_code=404, detail="Непознат тип за импорт")
    require_permission(current_user, _IMPORT_PERMISSIONS[entity])

    content = await file.read()
    try:
        df = import_service.read_uploaded_table(content, file.filename or "")
    except import_service.ImportFileError as e:
        raise HTTPException(status_code=400, detail=str(e))

    context: Dict[str, Any] = {}
    if entity == "payroll":
        _, scope = await get_company_scope(current_user)
        employees = await server.db.employees.find(scope, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        context["employees_by_name"] = {e["name"].strip().lower(): e["id"] for e in employees}

    try:
        return import_service.preview_rows(entity, df, context)
    except import_service.ImportFileError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/import/{entity}/commit")
@limiter.limit("10/minute")
async def import_commit(entity: str, request: Request, payload: ImportCommitRequest, current_user: User = Depends(get_current_user)):
    if entity not in import_service.ENTITY_TEMPLATES:
        raise HTTPException(status_code=404, detail="Непознат тип за импорт")
    require_permission(current_user, _IMPORT_PERMISSIONS[entity])

    imported = 0
    failed = []
    bg_tasks = BackgroundTasks()

    # Short Bulgarian reasons for the validation-error types a bad import
    # row actually hits (missing/negative/wrong-type cells), so a failed
    # row shows something a non-technical user can act on instead of a
    # raw Python/Pydantic exception string.
    VALIDATION_ERROR_REASONS = {
        "missing": "липсва задължително поле",
        "greater_than": "трябва да е положително число",
        "greater_than_equal": "не може да е отрицателно число",
        "less_than_equal": "стойността е твърде голяма",
        "float_parsing": "не е валидно число",
        "int_parsing": "не е валидно цяло число",
    }

    def describe_validation_error(e: ValidationError) -> str:
        parts = []
        for err in e.errors():
            field = ".".join(str(p) for p in err.get("loc", []))
            reason = VALIDATION_ERROR_REASONS.get(err.get("type"), "невалидна стойност")
            parts.append(f"{field}: {reason}" if field else reason)
        return "; ".join(parts) or "невалидни данни в реда"

    # Expenses already held - the same day, description and amount - are
    # not imported again (a file imported twice used to double them all).
    # Counted, so two identical expenses in a day stay two.
    already_held: Dict[tuple, int] = {}
    already_present = 0
    if entity == "expenses":
        _, expense_scope = await get_company_scope(current_user)
        for doc in await server.db.expenses.find({**expense_scope, **NOT_WAGES}, {"_id": 0, "date": 1, "description": 1, "amount": 1}).to_list(ALL_ROWS):
            key = _expense_key(doc.get("date"), doc.get("description"), doc.get("amount"))
            already_held[key] = already_held.get(key, 0) + 1

    for index, row_data in enumerate(payload.rows):
        try:
            if entity == "expenses":
                key = _expense_key(row_data.get("date"), row_data.get("description"), row_data.get("amount"))
                if already_held.get(key, 0) > 0:
                    already_held[key] -= 1
                    already_present += 1
                    continue
            if entity == "invoices":
                invoice_row = dict(row_data)
                # An accounting list shows a credit note as a row below zero.
                if not invoice_row.get("document_type") and _below_zero(invoice_row.get("total_amount")):
                    invoice_row["document_type"] = CREDIT_NOTE
                await create_invoice(invoice=InvoiceCreate(**invoice_row), background_tasks=bg_tasks, current_user=current_user)
            elif entity == "assets":
                await create_asset(asset=FixedAssetCreate(**row_data), current_user=current_user)
            elif entity == "budget":
                await create_budget(budget=BudgetCreate(**row_data), current_user=current_user)
            elif entity == "daily_revenue":
                await create_daily_revenue(revenue=DailyRevenueCreate(**row_data), current_user=current_user)
            elif entity == "expenses":
                await create_expense(expense=NonInvoiceExpenseCreate(**row_data), current_user=current_user)
            elif entity == "payroll":
                await create_payroll_entry(entry=PayrollEntryCreate(**row_data), current_user=current_user)
            imported += 1
        except HTTPException as e:
            failed.append({"index": index, "message": e.detail})
        except ValidationError as e:
            failed.append({"index": index, "message": describe_validation_error(e)})
        except Exception:
            failed.append({"index": index, "message": "Редът не можа да бъде обработен"})

    if entity == "invoices":
        # No HTTP response cycle will run these for us since create_invoice
        # was called directly rather than as the request handler.
        await bg_tasks()

    return {"imported": imported, "failed": failed, "total": len(payload.rows), "already_present": already_present}

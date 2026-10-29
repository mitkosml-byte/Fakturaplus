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

@router.post("/backup/create")
@limiter.limit("5/minute")
async def create_backup(request: Request, current_user: User = Depends(get_current_user)):
    """Създава backup на всички данни на ЦЯЛАТА фирма (не само тези,
    въведени лично от текущия потребител), за да е реален backup на
    книгите на компанията."""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да прави резервно копие")

    import json

    company_id, scope = await get_company_scope(current_user)

    # Събиране на фактури
    invoices = await server.db.invoices.find(scope, {"_id": 0}).to_list(10000)

    # Конвертиране на datetime обекти
    for inv in invoices:
        if isinstance(inv.get("date"), datetime):
            inv["date"] = inv["date"].isoformat()
        if isinstance(inv.get("created_at"), datetime):
            inv["created_at"] = inv["created_at"].isoformat()

    # Събиране на дневни обороти
    revenues = await server.db.daily_revenue.find(scope, {"_id": 0}).to_list(10000)

    for rev in revenues:
        if isinstance(rev.get("date"), datetime):
            rev["date"] = rev["date"].isoformat()
        if isinstance(rev.get("created_at"), datetime):
            rev["created_at"] = rev["created_at"].isoformat()

    # Събиране на разходи
    expenses = await server.db.expenses.find(scope, {"_id": 0}).to_list(10000)

    for exp in expenses:
        if isinstance(exp.get("date"), datetime):
            exp["date"] = exp["date"].isoformat()
        if isinstance(exp.get("created_at"), datetime):
            exp["created_at"] = exp["created_at"].isoformat()
    
    # Събиране на данни за фирма
    company_data = None
    if company_id:
        company_data = await server.db.companies.find_one({"id": company_id}, {"_id": 0})
        if company_data:
            if isinstance(company_data.get("created_at"), datetime):
                company_data["created_at"] = company_data["created_at"].isoformat()
            if isinstance(company_data.get("updated_at"), datetime):
                company_data["updated_at"] = company_data["updated_at"].isoformat()
    
    backup_data = {
        "id": str(uuid.uuid4()),
        "user_id": current_user.user_id,
        "user_email": current_user.email,
        "user_name": current_user.name,
        "company_id": company_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "app_version": "1.0.0",
        "invoices": invoices,
        "daily_revenues": revenues,
        "expenses": expenses,
        "company": company_data,
        "statistics": {
            "invoice_count": len(invoices),
            "revenue_count": len(revenues),
            "expense_count": len(expenses)
        }
    }
    
    # Записване на metadata за backup
    backup_json = json.dumps(backup_data, ensure_ascii=False)
    metadata = BackupMetadata(
        user_id=current_user.user_id,
        file_name=f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        size_bytes=len(backup_json.encode('utf-8')),
        invoice_count=len(invoices),
        revenue_count=len(revenues),
        expense_count=len(expenses)
    )
    
    await server.db.backup_metadata.insert_one(metadata.dict())
    
    return backup_data

@router.get("/backup/list")
async def list_backups(current_user: User = Depends(get_current_user)):
    """Връща списък с всички backups на потребителя"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да вижда резервните копия")

    backups = await server.db.backup_metadata.find(
        {"user_id": current_user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return {"backups": backups}

@router.post("/backup/restore")
@limiter.limit("5/minute")
async def restore_backup(request: Request, backup_data: BackupRestoreRequest, current_user: User = Depends(get_current_user)):
    """Възстановява данни от backup - само Owner, само в собствената му
    фирма (company_id винаги се презаписва от сесията, никога от подадените
    данни). Всеки запис се обработва поотделно, за да не провали един
    невалиден ред цялото възстановяване."""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да възстановява резервно копие")

    company_id, _ = await get_company_scope(current_user)

    restored_counts = {"invoices": 0, "revenues": 0, "expenses": 0}
    skipped_counts = {"invoices": 0, "revenues": 0, "expenses": 0}

    # One existence-check query per collection instead of one per record -
    # a backup can hold thousands of rows, and this was previously an
    # N+1 (a find_one per item) on top of the N inserts already needed.
    existing_invoice_ids = {
        d["id"] for d in await server.db.invoices.find(
            {"id": {"$in": [inv.id for inv in backup_data.invoices]}}, {"id": 1}
        ).to_list(len(backup_data.invoices) or 1)
    }
    existing_revenue_ids = {
        d["id"] for d in await server.db.daily_revenue.find(
            {"id": {"$in": [r.id for r in backup_data.daily_revenues]}}, {"id": 1}
        ).to_list(len(backup_data.daily_revenues) or 1)
    }
    existing_expense_ids = {
        d["id"] for d in await server.db.expenses.find(
            {"id": {"$in": [e.id for e in backup_data.expenses]}}, {"id": 1}
        ).to_list(len(backup_data.expenses) or 1)
    }

    # Възстановяване на фактури
    for invoice in backup_data.invoices:
        try:
            if invoice.id in existing_invoice_ids:
                continue
            doc = invoice.dict()
            doc["user_id"] = current_user.user_id
            doc["company_id"] = company_id
            doc["date"] = datetime.fromisoformat(doc["date"].replace("Z", "+00:00"))
            doc["created_at"] = (
                datetime.fromisoformat(doc["created_at"].replace("Z", "+00:00"))
                if doc.get("created_at") else datetime.now(timezone.utc)
            )
            await server.db.invoices.insert_one(doc)
            restored_counts["invoices"] += 1
        except Exception as e:
            logger.warning(f"Backup restore: skipped invalid invoice {invoice.id}: {e}")
            skipped_counts["invoices"] += 1

    # Възстановяване на дневни обороти (date си остава низ "YYYY-MM-DD",
    # както при нормално създаване - НЕ datetime обект)
    for revenue in backup_data.daily_revenues:
        try:
            if revenue.id in existing_revenue_ids:
                continue
            doc = revenue.dict()
            doc["user_id"] = current_user.user_id
            doc["company_id"] = company_id
            doc["date"] = doc["date"][:10]
            doc["created_at"] = (
                datetime.fromisoformat(doc["created_at"].replace("Z", "+00:00"))
                if doc.get("created_at") else datetime.now(timezone.utc)
            )
            await server.db.daily_revenue.insert_one(doc)
            restored_counts["revenues"] += 1
        except Exception as e:
            logger.warning(f"Backup restore: skipped invalid daily revenue {revenue.id}: {e}")
            skipped_counts["revenues"] += 1

    # Възстановяване на разходи (date също остава низ)
    for expense in backup_data.expenses:
        try:
            if expense.id in existing_expense_ids:
                continue
            doc = expense.dict()
            doc["user_id"] = current_user.user_id
            doc["company_id"] = company_id
            doc["date"] = doc["date"][:10]
            doc["created_at"] = (
                datetime.fromisoformat(doc["created_at"].replace("Z", "+00:00"))
                if doc.get("created_at") else datetime.now(timezone.utc)
            )
            await server.db.expenses.insert_one(doc)
            restored_counts["expenses"] += 1
        except Exception as e:
            logger.warning(f"Backup restore: skipped invalid expense {expense.id}: {e}")
            skipped_counts["expenses"] += 1
    
    return {
        "success": True,
        "message": "Данните са възстановени успешно",
        "restored": restored_counts,
        "skipped": skipped_counts
    }

@router.get("/backup/status")
async def get_backup_status(current_user: User = Depends(get_current_user)):
    """Връща статус на последния backup"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да вижда статуса на резервните копия")

    last_backup = await server.db.backup_metadata.find_one(
        {"user_id": current_user.user_id},
        {"_id": 0}
    )
    
    if last_backup:
        return {
            "has_backup": True,
            "last_backup_date": last_backup.get("created_at"),
            "file_name": last_backup.get("file_name"),
            "statistics": {
                "invoices": last_backup.get("invoice_count", 0),
                "revenues": last_backup.get("revenue_count", 0),
                "expenses": last_backup.get("expense_count", 0)
            }
        }
    
    return {
        "has_backup": False,
        "last_backup_date": None
    }

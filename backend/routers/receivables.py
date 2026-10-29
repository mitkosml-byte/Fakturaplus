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

@router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    company_id, _ = await get_company_scope(current_user)
    customer = Customer(user_id=current_user.user_id, company_id=company_id, **payload.dict())
    await server.db.customers.insert_one(customer.dict())
    return customer

@router.get("/customers", response_model=List[Customer])
async def get_customers(search: Optional[str] = None, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, query = await get_company_scope(current_user)
    if search:
        query["name"] = {"$regex": re.escape(search), "$options": "i"}
    customers = await server.db.customers.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return [Customer(**c) for c in customers]

@router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, payload: CustomerUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    update_data = {k: v for k, v in payload.dict().items() if v is not None}
    if update_data:
        result = await server.db.customers.update_one({"id": customer_id, **scope}, {"$set": update_data})
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Клиентът не е намерен")
    customer = await server.db.customers.find_one({"id": customer_id, **scope}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Клиентът не е намерен")
    return Customer(**customer)

@router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    result = await server.db.customers.delete_one({"id": customer_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Клиентът не е намерен")
    return {"message": "Клиентът е изтрит"}

@router.post("/receivables", response_model=Receivable)
async def create_receivable(payload: ReceivableCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    company_id, _ = await get_company_scope(current_user)
    receivable = Receivable(user_id=current_user.user_id, company_id=company_id, **payload.dict())
    await server.db.receivables.insert_one(receivable.dict())
    return receivable

@router.get("/receivables", response_model=List[Receivable])
async def get_receivables(
    status: Optional[str] = None,  # unpaid | overdue | paid
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, "add_revenue")
    _, query = await get_company_scope(current_user)
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if status == "paid":
        query["is_paid"] = True
    elif status == "unpaid":
        query["is_paid"] = False
    elif status == "overdue":
        query["is_paid"] = False
        query["due_date"] = {"$ne": None, "$lt": now_str}
    # Unlike invoices' period filter, overdue/unpaid receivables are
    # always shown regardless of when they were created - a receivable
    # from two months ago that's still unpaid is still owed today.
    receivables = await server.db.receivables.find(query, {"_id": 0}).sort("due_date", 1).to_list(1000)
    return [Receivable(**r) for r in receivables]

@router.get("/receivables/summary")
async def get_receivables_summary(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, query = await get_company_scope(current_user)
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    unpaid = await server.db.receivables.find({**query, "is_paid": False}, {"_id": 0, "amount": 1, "due_date": 1}).to_list(10000)
    total_owed = sum(r.get("amount", 0) for r in unpaid)
    overdue = [r for r in unpaid if r.get("due_date") and r["due_date"] < now_str]
    total_overdue = sum(r.get("amount", 0) for r in overdue)
    return {
        "total_owed": round(total_owed, 2),
        "unpaid_count": len(unpaid),
        "total_overdue": round(total_overdue, 2),
        "overdue_count": len(overdue),
    }

@router.put("/receivables/{receivable_id}", response_model=Receivable)
async def update_receivable(receivable_id: str, payload: ReceivableUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    existing = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Записът не е намерен")

    update_data = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
    if update_data.get("is_paid") is True and not existing.get("is_paid"):
        update_data["paid_at"] = datetime.now(timezone.utc)
        update_data.setdefault("paid_amount", existing.get("amount", 0))
    await server.db.receivables.update_one({"id": receivable_id, **scope}, {"$set": update_data})
    receivable = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0})
    return Receivable(**receivable)

@router.delete("/receivables/{receivable_id}")
async def delete_receivable(receivable_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    result = await server.db.receivables.delete_one({"id": receivable_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    return {"message": "Записът е изтрит"}

@router.post("/billing-documents", response_model=BillingDocument)
async def create_billing_document(payload: BillingDocumentCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    company_id, _ = await get_company_scope(current_user)
    total_amount = round(sum(item.quantity * item.unit_price for item in payload.items), 2)
    issue_date = payload.issue_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    document = BillingDocument(
        user_id=current_user.user_id, company_id=company_id, total_amount=total_amount,
        issue_date=issue_date, **payload.dict(exclude={"issue_date"}),
    )

    # A "bill" (not a quote) is money actually owed - automatically record
    # it as a receivable instead of making the owner re-enter the same
    # amount a second time.
    if document.doc_type == BillingDocumentType.BILL:
        receivable = Receivable(
            user_id=current_user.user_id, company_id=company_id,
            customer_id=document.customer_id, customer_name=document.customer_name,
            description=f"Сметка от {issue_date}" + (f" - {payload.notes}" if payload.notes else ""),
            amount=total_amount, due_date=None,
        )
        await server.db.receivables.insert_one(receivable.dict())
        document.receivable_id = receivable.id

    await server.db.billing_documents.insert_one(document.dict())
    return document

@router.get("/billing-documents", response_model=List[BillingDocument])
async def get_billing_documents(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, query = await get_company_scope(current_user)
    docs = await server.db.billing_documents.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [BillingDocument(**d) for d in docs]

@router.get("/billing-documents/{document_id}", response_model=BillingDocument)
async def get_billing_document(document_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    document = await server.db.billing_documents.find_one({"id": document_id, **scope}, {"_id": 0})
    if not document:
        raise HTTPException(status_code=404, detail="Документът не е намерен")
    return BillingDocument(**document)

@router.get("/billing-documents/{document_id}/pdf")
async def export_billing_document_pdf(document_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    document = await server.db.billing_documents.find_one({"id": document_id, **scope}, {"_id": 0})
    if not document:
        raise HTTPException(status_code=404, detail="Документът не е намерен")

    company_name = ""
    if current_user.company_id:
        company = await server.db.companies.find_one({"id": current_user.company_id})
        company_name = company.get("name", "") if company else ""

    try:
        pdf_data = await asyncio.to_thread(ExportService.generate_billing_document_pdf, document, company_name)
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF export not available")

    doc_label = "offerta" if document["doc_type"] == "quote" else "smetka"
    filename = f"{doc_label}_{document_id[:8]}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_data), media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

@router.delete("/billing-documents/{document_id}")
async def delete_billing_document(document_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    result = await server.db.billing_documents.delete_one({"id": document_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Документът не е намерен")
    return {"message": "Документът е изтрит"}

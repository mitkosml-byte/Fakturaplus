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
import uuid
from pymongo.errors import DuplicateKeyError

router = APIRouter(prefix="/api")

@router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    company_id, _ = await get_company_scope(current_user)
    customer = Customer(user_id=current_user.user_id, company_id=company_id, **payload.model_dump())
    await server.db.customers.insert_one(customer.model_dump())
    return customer

@router.get("/customers", response_model=List[Customer])
async def get_customers(search: Optional[str] = None, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, query = await get_company_scope(current_user)
    if search:
        query["name"] = {"$regex": re.escape(search), "$options": "i"}
    customers = await server.db.customers.find(query, {"_id": 0}).sort("name", 1).to_list(ALL_ROWS)
    return [Customer(**c) for c in customers]

@router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, payload: CustomerUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
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
    receivable = Receivable(user_id=current_user.user_id, company_id=company_id, **payload.model_dump())
    await server.db.receivables.insert_one(receivable.model_dump())
    return receivable

@router.get("/receivables", response_model=List[Receivable])
async def get_receivables(
    status: Optional[str] = None,  # unpaid | overdue | paid
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, "add_revenue")
    _, query = await get_company_scope(current_user)
    now_str = today_local().isoformat()
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
    receivables = await server.db.receivables.find(query, {"_id": 0}).sort("due_date", 1).to_list(ALL_ROWS)
    return [Receivable(**r) for r in receivables]

@router.get("/receivables/summary")
async def get_receivables_summary(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, query = await get_company_scope(current_user)
    now_str = today_local().isoformat()
    unpaid = await server.db.receivables.find({**query, "is_paid": False}, {"_id": 0, "amount": 1, "paid_amount": 1, "due_date": 1}).to_list(ALL_ROWS)
    # What is still owed: less whatever was already paid in parts.
    total_owed = sum(receivable_left(r) for r in unpaid)
    overdue = [r for r in unpaid if r.get("due_date") and r["due_date"] < now_str]
    total_overdue = sum(receivable_left(r) for r in overdue)
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

    update_data = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if update_data.get("is_paid") is True and not existing.get("is_paid"):
        # "Paid in full" today: whatever was left is the last payment.
        left = receivable_left(existing)
        update_data["paid_at"] = datetime.now(timezone.utc)
        update_data.setdefault("paid_amount", existing.get("amount", 0))
        if left > 0:
            update_data["payments"] = [*(existing.get("payments") or []), {
                "id": str(uuid.uuid4()), "amount": round(left, 2), "date": today_local().isoformat(), "method": None,
            }]
    await server.db.receivables.update_one({"id": receivable_id, **scope}, {"$set": update_data})
    receivable = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0})
    return Receivable(**receivable)

@router.post("/receivables/{receivable_id}/payments", response_model=Receivable)
async def add_receivable_payment(
    receivable_id: str, payload: ReceivablePaymentCreate, current_user: User = Depends(get_current_user),
):
    """A payment received on a receivable - in part or in full, on its own
    day and by its own method. Paid in full once the payments reach the
    amount. Daily revenue is never touched here: the screen offers to add
    a cash payment to that day's pocket money."""
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    existing = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    left = receivable_left(existing)
    if existing.get("is_paid") or left <= 0:
        raise HTTPException(status_code=400, detail="Вземането вече е платено")
    if payload.amount > left + 0.01:
        raise HTTPException(status_code=400, detail=f"Остават {left:.2f} € - плащането е по-голямо")
    day = business_day(payload.date) if payload.date else today_local()
    if day is None:
        raise HTTPException(status_code=400, detail="Невалидна дата")
    paid = round(float(existing.get("paid_amount") or 0) + payload.amount, 2)
    fully = paid >= float(existing.get("amount") or 0) - 0.01
    update: Dict[str, Any] = {
        "paid_amount": paid,
        "is_paid": fully,
        "payments": [*(existing.get("payments") or []), {
            "id": str(uuid.uuid4()), "amount": round(payload.amount, 2), "date": day.isoformat(), "method": payload.method,
        }],
    }
    if fully:
        update["paid_at"] = day_start_utc(day)
    await server.db.receivables.update_one({"id": receivable_id, **scope}, {"$set": update})
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

async def _latest_invoice_number(scope: dict) -> Optional[str]:
    """The highest number issued here (cancelled ones included - their
    numbers are spent)."""
    latest = await server.db.billing_documents.find(
        {**scope, "doc_type": "invoice", "invoice_number": {"$type": "string"}}, {"_id": 0, "invoice_number": 1},
    ).sort("invoice_number", -1).limit(1).to_list(1)
    return latest[0]["invoice_number"] if latest else None


async def _create_issued_invoice(payload: BillingDocumentCreate, current_user: User) -> BillingDocument:
    """An invoice to a customer: the next number in sequence (or the one the
    business continues from), VAT by rate, revenue and VAT on its issue
    date (period_totals reads it there). Paid in cash or by card when
    issued; otherwise owed - a receivable that is already revenue."""
    company_id, scope = await get_company_scope(current_user)
    issued = business_day(payload.issue_date) if payload.issue_date else today_local()
    if issued is None:
        raise HTTPException(status_code=400, detail="Невалидна дата на издаване")
    amounts = invoice_vat_breakdown(payload.items)
    paid_when_issued = payload.payment_method in ("cash", "card")
    due_date = None
    if not paid_when_issued:
        due_day = business_day(payload.due_date) if payload.due_date else issued + timedelta(days=INVOICE_TERM_DAYS)
        if due_day is None:
            raise HTTPException(status_code=400, detail="Невалиден срок за плащане")
        due_date = due_day.isoformat()

    if payload.invoice_number:
        number = payload.invoice_number.zfill(INVOICE_NUMBER_DIGITS)
        if await server.db.billing_documents.find_one({**scope, "doc_type": "invoice", "invoice_number": number}):
            raise HTTPException(status_code=409, detail=f"Фактура № {number} вече е издадена")
    else:
        latest = await _latest_invoice_number(scope)
        number = str(int(latest) + 1 if latest else 1).zfill(INVOICE_NUMBER_DIGITS)

    document = BillingDocument(
        user_id=current_user.user_id, company_id=company_id, doc_type=BillingDocumentType.INVOICE,
        customer_id=payload.customer_id, customer_name=payload.customer_name, items=payload.items,
        notes=payload.notes, issue_date=issued.isoformat(), due_date=due_date,
        invoice_number=number, customer_eik=(payload.customer_eik or "").strip() or None,
        customer_address=(payload.customer_address or "").strip() or None, payment_method=payload.payment_method,
        amount_without_vat=amounts["amount_without_vat"], vat_amount=amounts["vat_amount"],
        total_amount=amounts["total_amount"], vat_by_rate=amounts["by_rate"],
    )
    if not paid_when_issued:
        receivable = Receivable(
            user_id=current_user.user_id, company_id=company_id,
            customer_id=document.customer_id, customer_name=document.customer_name,
            description=f"Фактура № {number} от {issued.strftime('%d.%m.%Y')}",
            amount=document.total_amount, due_date=due_date,
            billing_document_id=document.id, revenue_counted=True,
        )
        await server.db.receivables.insert_one(receivable.model_dump())
        document.receivable_id = receivable.id
    try:
        await server.db.billing_documents.insert_one(document.model_dump())
    except DuplicateKeyError:
        # Someone issued the same number at the same moment.
        if document.receivable_id:
            await server.db.receivables.delete_one({"id": document.receivable_id})
        raise HTTPException(status_code=409, detail=f"Фактура № {number} току-що беше издадена - опитайте отново")
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="create", entity_type="issued_invoice",
        entity_id=document.id, company_id=company_id,
        details={"invoice_number": number, "customer_name": document.customer_name, "total_amount": document.total_amount},
    )
    return document


@router.post("/billing-documents", response_model=BillingDocument)
async def create_billing_document(payload: BillingDocumentCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    if payload.doc_type == BillingDocumentType.INVOICE:
        return await _create_issued_invoice(payload, current_user)
    company_id, _ = await get_company_scope(current_user)
    total_amount = round(sum(item.quantity * item.unit_price for item in payload.items), 2)
    issue_date = payload.issue_date or today_local().isoformat()
    due_date = None
    if payload.doc_type == BillingDocumentType.BILL:
        # A bill is owed by a date - never "some day", which never became overdue.
        issued = business_day(issue_date) or today_local()
        due_date = payload.due_date or (issued + timedelta(days=BILL_TERM_DAYS)).isoformat()

    document = BillingDocument(
        user_id=current_user.user_id, company_id=company_id, total_amount=total_amount,
        issue_date=issue_date, due_date=due_date,
        **payload.model_dump(exclude={"issue_date", "due_date", "invoice_number", "payment_method"}),
    )

    # A "bill" (not a quote) is money actually owed - automatically record
    # it as a receivable instead of making the owner re-enter the same
    # amount a second time.
    if document.doc_type == BillingDocumentType.BILL:
        receivable = Receivable(
            user_id=current_user.user_id, company_id=company_id,
            customer_id=document.customer_id, customer_name=document.customer_name,
            description=f"Сметка от {issue_date}" + (f" - {payload.notes}" if payload.notes else ""),
            amount=total_amount, due_date=due_date,
        )
        await server.db.receivables.insert_one(receivable.model_dump())
        document.receivable_id = receivable.id

    await server.db.billing_documents.insert_one(document.model_dump())
    return document

@router.get("/billing-documents", response_model=List[BillingDocument])
async def get_billing_documents(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, query = await get_company_scope(current_user)
    docs = await server.db.billing_documents.find(query, {"_id": 0}).sort("created_at", -1).to_list(ALL_ROWS)
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
    company: Dict[str, Any] = {}
    if current_user.company_id:
        company = dict(await server.db.companies.find_one({"id": current_user.company_id}, {"_id": 0}) or {})
        company_name = company.get("name", "")

    try:
        if document["doc_type"] == "invoice":
            pdf_data = await asyncio.to_thread(ExportService.generate_issued_invoice_pdf, document, company)
        else:
            pdf_data = await asyncio.to_thread(ExportService.generate_billing_document_pdf, document, company_name)
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF export not available")

    if document["doc_type"] == "invoice":
        filename = f"faktura_{document.get('invoice_number') or document_id[:8]}.pdf"
    else:
        doc_label = "offerta" if document["doc_type"] == "quote" else "smetka"
        filename = f"{doc_label}_{document_id[:8]}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_data), media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

@router.delete("/billing-documents/{document_id}")
async def delete_billing_document(document_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    company_id, scope = await get_company_scope(current_user)
    document: Dict[str, Any] = dict(await server.db.billing_documents.find_one(
        {"id": document_id, **scope}, {"_id": 0, "receivable_id": 1, "doc_type": 1, "invoice_number": 1, "cancelled": 1},
    ) or {})
    if not document:
        raise HTTPException(status_code=404, detail="Документът не е намерен")
    cancelled = False
    if document.get("doc_type") == "invoice":
        # The numbering stays unbroken: the last invoice issued can go; an
        # earlier one is cancelled - it keeps its number and counts for
        # nothing (revenue, VAT) from then on.
        if document.get("cancelled"):
            raise HTTPException(status_code=409, detail="Фактурата вече е анулирана")
        if document.get("invoice_number") != await _latest_invoice_number(scope):
            await server.db.billing_documents.update_one(
                {"id": document_id, **scope}, {"$set": {"cancelled": True, "cancelled_at": datetime.now(timezone.utc)}},
            )
            cancelled = True
        await audit_service.log_action(
            user_id=current_user.user_id, user_name=current_user.name,
            action="update" if cancelled else "delete", entity_type="issued_invoice", entity_id=document_id,
            company_id=company_id, details={"invoice_number": document.get("invoice_number"), "cancelled": cancelled},
        )
    if not cancelled:
        result = await server.db.billing_documents.delete_one({"id": document_id, **scope})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Документът не е намерен")
    # Its receivable goes with it while nothing was paid on it - before, a
    # deleted bill left the customer "owing" it for ever. Once money came
    # in, the receivable (and what was paid) stays.
    receivable_status = None
    receivable_id = document.get("receivable_id")
    if receivable_id:
        receivable = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0, "paid_amount": 1})
        if receivable and float(receivable.get("paid_amount") or 0) <= 0:
            await server.db.receivables.delete_one({"id": receivable_id, **scope})
            receivable_status = "deleted"
        elif receivable:
            receivable_status = "kept"
    if cancelled:
        return {"message": "Фактурата е анулирана", "cancelled": True, "receivable": receivable_status}
    return {"message": "Документът е изтрит", "cancelled": False, "receivable": receivable_status}

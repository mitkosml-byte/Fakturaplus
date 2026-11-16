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

def _clean_customer_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    """Trimmed, and an emptied field is cleared (None), not kept as ""."""
    return {k: (v.strip() or None) if isinstance(v, str) else v for k, v in data.items()}


async def _refuse_duplicate_eik(scope: dict, eik: Optional[str], exclude_id: Optional[str] = None) -> None:
    """One customer per EIK: a second would split their invoices and debts."""
    if not eik_key(eik):
        return
    for other in await server.db.customers.find(scope, {"_id": 0, "id": 1, "name": 1, "eik": 1}).to_list(ALL_ROWS):
        if other["id"] != exclude_id and eik_key(other.get("eik")) == eik_key(eik):
            raise HTTPException(status_code=409, detail=f"Вече има клиент с ЕИК {eik}: {other.get('name')}")


@router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate, current_user: User = Depends(get_current_user)):
    require_sales_access(current_user)
    company_id, scope = await get_company_scope(current_user)
    data = _clean_customer_fields(payload.model_dump())
    if not data.get("name"):
        raise HTTPException(status_code=400, detail="Името на клиента е задължително")
    await _refuse_duplicate_eik(scope, data.get("eik"))
    customer = Customer(user_id=current_user.user_id, company_id=company_id, **data)
    await server.db.customers.insert_one(customer.model_dump())
    return customer

@router.get("/customers", response_model=List[Customer])
async def get_customers(search: Optional[str] = None, current_user: User = Depends(get_current_user)):
    require_sales_access(current_user)
    _, query = await get_company_scope(current_user)
    if search:
        query["name"] = {"$regex": re.escape(search), "$options": "i"}
    customers = await server.db.customers.find(query, {"_id": 0}).sort("name", 1).to_list(ALL_ROWS)
    return [Customer(**c) for c in customers]

@router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, payload: CustomerUpdate, current_user: User = Depends(get_current_user)):
    require_sales_access(current_user)
    _, scope = await get_company_scope(current_user)
    update_data = _clean_customer_fields(payload.model_dump(exclude_unset=True))
    if "name" in update_data and not update_data["name"]:
        raise HTTPException(status_code=400, detail="Името на клиента е задължително")
    if update_data.get("eik"):
        await _refuse_duplicate_eik(scope, update_data["eik"], exclude_id=customer_id)
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
    require_sales_access(current_user)
    _, scope = await get_company_scope(current_user)
    result = await server.db.customers.delete_one({"id": customer_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Клиентът не е намерен")
    # Their documents and debts stay, under the name they were issued to.
    for collection in (server.db.billing_documents, server.db.receivables):
        await collection.update_many({**scope, "customer_id": customer_id}, {"$set": {"customer_id": None}})
    return {"message": "Клиентът е изтрит"}


@router.get("/customers/{customer_id}/card")
async def get_customer_card(customer_id: str, current_user: User = Depends(get_current_user)):
    """One customer at a glance: invoiced, owed and overdue now, their last
    documents and open debts. Documents from before they were tied to the
    customer count by the name they were issued to."""
    require_sales_access(current_user)
    _, scope = await get_company_scope(current_user)
    customer = await server.db.customers.find_one({"id": customer_id, **scope}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Клиентът не е намерен")
    name_key = _compare_key(customer.get("name") or "")

    def theirs(doc: dict) -> bool:
        if doc.get("customer_id"):
            return doc["customer_id"] == customer_id
        return _compare_key(doc.get("customer_name") or "") == name_key

    # Theirs within this company only: the company scope is itself an $or,
    # so the two go side by side (merged, this one replaced it).
    who = {"$and": [scope, {"$or": [{"customer_id": customer_id}, {"customer_id": None}, {"customer_id": {"$exists": False}}]}]}
    documents = [d for d in await server.db.billing_documents.find(
        who, {"_id": 0, "items": 0},
    ).to_list(ALL_ROWS) if theirs(d)]
    receivables = [r for r in await server.db.receivables.find(who, {"_id": 0}).to_list(ALL_ROWS) if theirs(r)]

    invoices = [d for d in documents if d.get("doc_type") == "invoice" and not d.get("cancelled")]
    credit_notes = [d for d in documents if d.get("doc_type") == "credit_note" and not d.get("cancelled")]
    today = today_local().isoformat()
    open_debts = [r for r in receivables if not r.get("is_paid") and receivable_left(r) > 0]
    documents.sort(key=lambda d: (str(d.get("issue_date") or ""), str(d.get("invoice_number") or "")), reverse=True)
    return {
        "customer": Customer(**customer),
        "totals": {
            # Less what credit notes took off (theirs are below zero).
            "invoiced": round(sum(float(d.get("total_amount") or 0) for d in invoices + credit_notes), 2),
            "invoice_count": len(invoices),
            "last_invoice_date": max((str(d.get("issue_date")) for d in invoices), default=None),
            "owed": round(sum(receivable_left(r) for r in open_debts), 2),
            "overdue": round(sum(receivable_left(r) for r in open_debts if r.get("due_date") and str(r["due_date"]) < today), 2),
            "paid": round(sum(float(r.get("paid_amount") or 0) for r in receivables), 2),
            "to_refund": round(sum(receivable_refund_due(r) for r in receivables), 2),
        },
        "documents": [
            {k: d.get(k) for k in ("id", "doc_type", "invoice_number", "issue_date", "total_amount", "cancelled", "external", "in_till",
                                   "credited_invoice_number")}
            for d in documents[:15]
        ],
        "open_receivables": [
            {"id": r["id"], "description": r.get("description"), "amount": r.get("amount"), "left": round(receivable_left(r), 2),
             "due_date": r.get("due_date"), "overdue": bool(r.get("due_date") and str(r["due_date"]) < today)}
            for r in sorted(open_debts, key=lambda r: str(r.get("due_date") or ""))
        ],
    }

@router.post("/receivables", response_model=Receivable)
async def create_receivable(payload: ReceivableCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    company_id, scope = await get_company_scope(current_user)
    data = payload.model_dump()
    if not data.get("customer_id"):
        data["customer_id"] = await remember_customer(company_id, scope, current_user.user_id, data.get("customer_name"))
    receivable = Receivable(user_id=current_user.user_id, company_id=company_id, **data)
    await server.db.receivables.insert_one(receivable.model_dump())
    return receivable

@router.get("/receivables", response_model=List[ReceivableView])
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
    return [receivable_view(r) for r in receivables]

@router.get("/receivables/summary")
async def get_receivables_summary(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, query = await get_company_scope(current_user)
    # What is still owed: less whatever was already paid in parts.
    return await receivables_summary_for(query)


async def _document_label(scope: dict, document_id: str) -> str:
    document = await server.db.billing_documents.find_one(
        {"id": document_id, **scope}, {"_id": 0, "doc_type": 1, "invoice_number": 1},
    )
    if document and document.get("doc_type") == "invoice":
        return f"фактура № {document.get('invoice_number')}"
    return "издадения документ"


@router.put("/receivables/{receivable_id}", response_model=ReceivableView)
async def update_receivable(receivable_id: str, payload: ReceivableUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    existing = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Записът не е намерен")

    update_data = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if existing.get("billing_document_id"):
        # Owed on an invoice: its amount and customer are the invoice's - a
        # credit note or cancelling the invoice changes them, never an edit
        # here (before, an invoice of 1 200 € could be "owed" as 900 €).
        label = await _document_label(scope, existing["billing_document_id"])
        if "amount" in update_data and abs(float(update_data["amount"]) - float(existing.get("amount") or 0)) > 0.005:
            raise HTTPException(status_code=400, detail=f"Сумата е по {label} - променя се с кредитно известие или с анулиране")
        if "customer_name" in update_data and update_data["customer_name"].strip() != existing.get("customer_name"):
            raise HTTPException(status_code=400, detail=f"Клиентът е по {label} и не се променя тук")
        if "paid_amount" in update_data or update_data.get("is_paid") is False:
            raise HTTPException(status_code=400, detail="Плащанията по фактура се въвеждат едно по едно, с датата си")
        update_data.pop("amount", None)
        update_data.pop("customer_name", None)
    if update_data.get("is_paid") is True and not existing.get("is_paid"):
        # "Paid in full" today: whatever was left is the last payment.
        left = receivable_left(existing)
        update_data["paid_at"] = datetime.now(timezone.utc)
        update_data.setdefault("paid_amount", round(float(existing.get("paid_amount") or 0) + left, 2))
        if left > 0:
            update_data["payments"] = [*(existing.get("payments") or []), {
                "id": str(uuid.uuid4()), "amount": round(left, 2), "date": today_local().isoformat(), "method": None,
            }]
    if update_data:
        await server.db.receivables.update_one({"id": receivable_id, **scope}, {"$set": update_data})
    receivable = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0})
    return receivable_view(receivable)

@router.post("/receivables/{receivable_id}/payments", response_model=ReceivableView)
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
    fully = receivable_left({**existing, "paid_amount": paid}) <= 0.01
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
    return receivable_view(receivable)


@router.delete("/receivables/{receivable_id}")
async def delete_receivable(receivable_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    _, scope = await get_company_scope(current_user)
    linked = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0, "billing_document_id": 1})
    if linked and linked.get("billing_document_id"):
        # Owed on an invoice: it goes only with the invoice (cancelled).
        label = await _document_label(scope, linked["billing_document_id"])
        raise HTTPException(status_code=400, detail=f"Вземането е по {label} - маха се само с анулиране на фактурата")
    result = await server.db.receivables.delete_one({"id": receivable_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    return {"message": "Записът е изтрит"}

async def _latest_invoice_number(scope: dict) -> Optional[str]:
    """The highest number issued here (cancelled ones included - their
    numbers are spent)."""
    latest = await server.db.billing_documents.find(
        {**scope, "doc_type": {"$in": NUMBERED_DOC_TYPES}, "invoice_number": {"$type": "string"}}, {"_id": 0, "invoice_number": 1},
    ).sort("invoice_number", -1).limit(1).to_list(1)
    return latest[0]["invoice_number"] if latest else None


async def _customer_for(company_id: Optional[str], scope: dict, user_id: str, payload: BillingDocumentCreate) -> Optional[str]:
    """The customer a document is to: the one picked (if it is this
    company's - its missing EIK/address filled in), else one remembered by
    EIK or name."""
    if payload.customer_id:
        picked = await server.db.customers.find_one({"id": payload.customer_id, **scope}, {"_id": 0, "id": 1, "eik": 1, "address": 1})
        if picked:
            missing = {
                field: value.strip() for field, value in (("eik", payload.customer_eik), ("address", payload.customer_address))
                if value and value.strip() and not picked.get(field)
            }
            if missing:
                await server.db.customers.update_one({"id": picked["id"]}, {"$set": missing})
            return picked["id"]
    return await remember_customer(company_id, scope, user_id, payload.customer_name, payload.customer_eik, payload.customer_address)


async def _create_issued_invoice(payload: BillingDocumentCreate, current_user: User) -> BillingDocument:
    """An invoice to a customer: the next number in sequence (or the one the
    business continues from), VAT by rate, revenue and VAT on its issue
    date (period_totals reads it there). Paid in cash or by card when
    issued; otherwise owed - a receivable that is already revenue."""
    company_id, scope = await get_company_scope(current_user)
    issued = business_day(payload.issue_date) if payload.issue_date else today_local()
    if issued is None:
        raise HTTPException(status_code=400, detail="Невалидна дата на издаване")
    # A business not registered for VAT issues invoices without VAT, and
    # the invoice says on what basis.
    company = await server.db.companies.find_one({"id": company_id}, {"_id": 0}) if company_id else None
    vat_registered = company_vat_registered(company)
    if not vat_registered:
        payload.items = [item.model_copy(update={"vat_rate": 0}) for item in payload.items]
    amounts = invoice_vat_breakdown(payload.items)
    # The customer is remembered (or picked): the next invoice to them is a pick.
    payload.customer_id = await _customer_for(company_id, scope, current_user.user_id, payload)
    paid_when_issued = payload.payment_method in ("cash", "card")
    # Paid in cash or by card it went through the till (a fiscal receipt),
    # unless the business says otherwise or keeps no till here: then its
    # money is in that day's till revenue and the invoice adds none.
    in_till = paid_when_issued and (
        payload.in_till if payload.in_till is not None else await company_logs_till(scope)
    )
    due_date = None
    if not paid_when_issued:
        due_day = business_day(payload.due_date) if payload.due_date else issued + timedelta(days=INVOICE_TERM_DAYS)
        if due_day is None:
            raise HTTPException(status_code=400, detail="Невалиден срок за плащане")
        due_date = due_day.isoformat()

    if payload.external and not payload.invoice_number:
        raise HTTPException(status_code=400, detail="Въведи номера на фактурата, както е отпечатан")
    if payload.invoice_number:
        number = payload.invoice_number.zfill(INVOICE_NUMBER_DIGITS)
        if await server.db.billing_documents.find_one({**scope, "doc_type": {"$in": NUMBERED_DOC_TYPES}, "invoice_number": number}):
            raise HTTPException(
                status_code=409,
                detail=f"Фактура № {number} вече е въведена" if payload.external else f"Фактура № {number} вече е издадена",
            )
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
        vat_exempt_basis=None if vat_registered else VAT_EXEMPT_BASIS,
        external=payload.external, in_till=in_till,
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
        details={"invoice_number": number, "customer_name": document.customer_name, "total_amount": document.total_amount,
                 "external": document.external, "in_till": document.in_till},
    )
    return document


async def _apply_credit(scope: dict, invoice: dict, delta: float) -> None:
    """A credit note's amount (delta above zero; below zero when it is
    cancelled) on its invoice and on what is owed on that invoice - the
    receivable is settled once nothing is left to collect, and owed again
    if a cancelled credit note leaves something."""
    await server.db.billing_documents.update_one({"id": invoice["id"], **scope}, {"$inc": {"credited_amount": round(delta, 2)}})
    receivable_id = invoice.get("receivable_id")
    if not receivable_id:
        return
    await server.db.receivables.update_one({"id": receivable_id, **scope}, {"$inc": {"credited_amount": round(delta, 2)}})
    receivable = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0})
    if receivable and not receivable.get("cancelled"):
        settled = receivable_left(receivable) <= 0.005
        if settled != bool(receivable.get("is_paid")):
            await server.db.receivables.update_one({"id": receivable_id, **scope}, {"$set": {"is_paid": settled}})


async def _create_credit_note(payload: BillingDocumentCreate, current_user: User) -> BillingDocument:
    """A credit note to a customer on an invoice issued to them: the next
    number in the invoice sequence (or its own, issued elsewhere), the
    invoice's customer, payment and VAT treatment, its amounts below zero -
    revenue and VAT less on its own date - and what it credits off what is
    owed on the invoice; paid already, that much is to give back."""
    company_id, scope = await get_company_scope(current_user)
    if not payload.credited_document_id:
        raise HTTPException(status_code=400, detail="Изберете фактурата, към която е известието")
    invoice = await server.db.billing_documents.find_one(
        {"id": payload.credited_document_id, **scope, "doc_type": "invoice"}, {"_id": 0},
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    if invoice.get("cancelled"):
        raise HTTPException(status_code=400, detail="Фактурата е анулирана")
    issued = business_day(payload.issue_date) if payload.issue_date else today_local()
    if issued is None:
        raise HTTPException(status_code=400, detail="Невалидна дата на издаване")
    if issued.isoformat() < str(invoice.get("issue_date") or ""):
        raise HTTPException(status_code=400, detail="Кредитното известие не може да е с дата преди фактурата")
    reason = (payload.notes or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Напишете основанието (напр. отстъпка, върната стока)")
    # The invoice's VAT treatment: one issued without VAT is credited without it.
    items = payload.items
    if invoice.get("vat_exempt_basis"):
        items = [item.model_copy(update={"vat_rate": 0}) for item in items]
    amounts = invoice_vat_breakdown(items)
    left = round(float(invoice.get("total_amount") or 0) - float(invoice.get("credited_amount") or 0), 2)
    if amounts["total_amount"] > left + 0.005:
        raise HTTPException(status_code=400, detail=f"Известието е по-голямо от остатъка по фактурата ({left:.2f} €)")

    if payload.external and not payload.invoice_number:
        raise HTTPException(status_code=400, detail="Въведи номера на известието, както е отпечатан")
    if payload.invoice_number:
        number = payload.invoice_number.zfill(INVOICE_NUMBER_DIGITS)
        if await server.db.billing_documents.find_one({**scope, "doc_type": {"$in": NUMBERED_DOC_TYPES}, "invoice_number": number}):
            raise HTTPException(status_code=409, detail=f"№ {number} вече е издаден")
    else:
        latest = await _latest_invoice_number(scope)
        number = str(int(latest) + 1 if latest else 1).zfill(INVOICE_NUMBER_DIGITS)

    document = BillingDocument(
        user_id=current_user.user_id, company_id=company_id, doc_type=BillingDocumentType.CREDIT_NOTE,
        customer_id=invoice.get("customer_id"), customer_name=invoice.get("customer_name") or payload.customer_name,
        customer_eik=invoice.get("customer_eik"), customer_address=invoice.get("customer_address"),
        items=items, notes=reason, issue_date=issued.isoformat(), invoice_number=number,
        payment_method=invoice.get("payment_method"), in_till=bool(invoice.get("in_till")),
        amount_without_vat=-amounts["amount_without_vat"], vat_amount=-amounts["vat_amount"],
        total_amount=-amounts["total_amount"],
        vat_by_rate=[{**part, "base": -float(part.get("base") or 0), "vat": -float(part.get("vat") or 0)} for part in amounts["by_rate"]],
        vat_exempt_basis=invoice.get("vat_exempt_basis"), external=payload.external,
        credited_document_id=invoice["id"], credited_invoice_number=invoice.get("invoice_number"),
        credited_issue_date=invoice.get("issue_date"),
    )
    try:
        await server.db.billing_documents.insert_one(document.model_dump())
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail=f"№ {number} току-що беше издаден - опитайте отново")
    await _apply_credit(scope, invoice, amounts["total_amount"])
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="create", entity_type="issued_credit_note",
        entity_id=document.id, company_id=company_id,
        details={"invoice_number": number, "credited_invoice_number": invoice.get("invoice_number"),
                 "customer_name": document.customer_name, "total_amount": document.total_amount},
    )
    return document


@router.post("/billing-documents", response_model=BillingDocument)
async def create_billing_document(payload: BillingDocumentCreate, current_user: User = Depends(get_current_user)):
    # An invoice is a tax document - its own right; bills and quotes go with revenue.
    if payload.doc_type == BillingDocumentType.INVOICE:
        require_permission(current_user, "issue_invoices")
        return await _create_issued_invoice(payload, current_user)
    if payload.doc_type == BillingDocumentType.CREDIT_NOTE:
        require_permission(current_user, "issue_invoices")
        return await _create_credit_note(payload, current_user)
    require_permission(current_user, "add_revenue")
    company_id, scope = await get_company_scope(current_user)
    payload.customer_id = await _customer_for(company_id, scope, current_user.user_id, payload)
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
        **payload.model_dump(exclude={"issue_date", "due_date", "invoice_number", "payment_method", "in_till", "external"}),
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

@router.get("/billing-documents/invoice-defaults")
async def get_invoice_defaults(current_user: User = Depends(get_current_user)):
    """What the invoice form starts from: whether the business is registered
    for VAT, and whether it enters its till's daily revenue (then an invoice
    paid in cash or by card went through the till)."""
    require_sales_access(current_user)
    company_id, scope = await get_company_scope(current_user)
    company = await server.db.companies.find_one(
        {"id": company_id}, {"_id": 0, "id": 1, "vat_registered": 1, "vat_number": 1},
    ) if company_id else None
    return {"vat_registered": company_vat_registered(company), "logs_till": await company_logs_till(scope)}


async def _with_payment(scope: dict, docs: List[dict]) -> List[BillingDocumentView]:
    """The documents with where their money stands, from their receivables."""
    ids = [d["receivable_id"] for d in docs if d.get("receivable_id")]
    receivables = {
        r["id"]: r for r in await server.db.receivables.find(
            {**scope, "id": {"$in": ids}}, {**RECEIVABLE_BALANCE_FIELDS, "id": 1},
        ).to_list(ALL_ROWS)
    } if ids else {}
    today = today_local().isoformat()
    return [
        BillingDocumentView(**d, **billing_payment_of(d, receivables.get(d.get("receivable_id") or ""), today))
        for d in docs
    ]


@router.get("/billing-documents", response_model=List[BillingDocumentView])
async def get_billing_documents(current_user: User = Depends(get_current_user)):
    require_sales_access(current_user)
    _, query = await get_company_scope(current_user)
    docs = await server.db.billing_documents.find(query, {"_id": 0}).sort("created_at", -1).to_list(ALL_ROWS)
    return await _with_payment(query, docs)

@router.get("/billing-documents/{document_id}", response_model=BillingDocumentView)
async def get_billing_document(document_id: str, current_user: User = Depends(get_current_user)):
    require_sales_access(current_user)
    _, scope = await get_company_scope(current_user)
    document = await server.db.billing_documents.find_one({"id": document_id, **scope}, {"_id": 0})
    if not document:
        raise HTTPException(status_code=404, detail="Документът не е намерен")
    return (await _with_payment(scope, [document]))[0]

@router.get("/billing-documents/{document_id}/pdf")
async def export_billing_document_pdf(document_id: str, current_user: User = Depends(get_current_user)):
    require_sales_access(current_user)
    _, scope = await get_company_scope(current_user)
    document = await server.db.billing_documents.find_one({"id": document_id, **scope}, {"_id": 0})
    if not document:
        raise HTTPException(status_code=404, detail="Документът не е намерен")

    company_name = ""
    company: Dict[str, Any] = {}
    if current_user.company_id:
        company = dict(await server.db.companies.find_one({"id": current_user.company_id}, {"_id": 0}) or {})
        company_name = company.get("name", "")

    if document.get("external"):
        raise HTTPException(status_code=400, detail="Фактурата е издадена в друга програма - документът е там")
    try:
        if document["doc_type"] in NUMBERED_DOC_TYPES:
            pdf_data = await asyncio.to_thread(ExportService.generate_issued_invoice_pdf, document, company)
        else:
            pdf_data = await asyncio.to_thread(ExportService.generate_billing_document_pdf, document, company_name)
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF export not available")

    if document["doc_type"] == "credit_note":
        filename = f"kreditno_izvestie_{document.get('invoice_number') or document_id[:8]}.pdf"
    elif document["doc_type"] == "invoice":
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
    require_sales_access(current_user)
    company_id, scope = await get_company_scope(current_user)
    document: Dict[str, Any] = dict(await server.db.billing_documents.find_one(
        {"id": document_id, **scope},
        {"_id": 0, "id": 1, "receivable_id": 1, "doc_type": 1, "invoice_number": 1, "cancelled": 1, "external": 1,
         "total_amount": 1, "credited_document_id": 1},
    ) or {})
    if not document:
        raise HTTPException(status_code=404, detail="Документът не е намерен")
    cancelled = False
    numbered = document.get("doc_type") in NUMBERED_DOC_TYPES
    entity_type = "issued_credit_note" if document.get("doc_type") == "credit_note" else "issued_invoice"
    if numbered:
        require_permission(current_user, "issue_invoices")
        if not document.get("external") and current_user.role not in INVOICE_CANCEL_ROLES:
            raise HTTPException(status_code=403, detail="Само собственикът или управителят могат да анулират или изтрият издадена фактура")
    else:
        require_permission(current_user, "add_revenue")
    if document.get("doc_type") == "invoice" and not document.get("cancelled") and await server.db.billing_documents.find_one(
        {**scope, "doc_type": "credit_note", "credited_document_id": document_id, "cancelled": {"$ne": True}}, {"_id": 1},
    ):
        raise HTTPException(status_code=409, detail="Към фактурата има кредитно известие - първо анулирайте него")
    if numbered and document.get("external"):
        # Issued in another program: cancelled there if at all - the record
        # here (entered by mistake, say) just goes.
        await audit_service.log_action(
            user_id=current_user.user_id, user_name=current_user.name, action="delete", entity_type=entity_type,
            entity_id=document_id, company_id=company_id,
            details={"invoice_number": document.get("invoice_number"), "external": True},
        )
    elif numbered:
        # The numbering stays unbroken: the last number issued can go; an
        # earlier one is cancelled - it keeps its number and counts for
        # nothing (revenue, VAT) from then on.
        if document.get("cancelled"):
            raise HTTPException(status_code=409, detail="Документът вече е анулиран")
        if document.get("invoice_number") != await _latest_invoice_number(scope):
            await server.db.billing_documents.update_one(
                {"id": document_id, **scope}, {"$set": {"cancelled": True, "cancelled_at": datetime.now(timezone.utc)}},
            )
            cancelled = True
        await audit_service.log_action(
            user_id=current_user.user_id, user_name=current_user.name,
            action="update" if cancelled else "delete", entity_type=entity_type, entity_id=document_id,
            company_id=company_id, details={"invoice_number": document.get("invoice_number"), "cancelled": cancelled},
        )
    if not cancelled:
        result = await server.db.billing_documents.delete_one({"id": document_id, **scope})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Документът не е намерен")
    if document.get("doc_type") == "credit_note" and not document.get("cancelled") and document.get("credited_document_id"):
        # Gone or cancelled, it takes nothing off its invoice any more.
        invoice = await server.db.billing_documents.find_one(
            {"id": document["credited_document_id"], **scope}, {"_id": 0, "id": 1, "receivable_id": 1},
        )
        if invoice:
            await _apply_credit(scope, invoice, -abs(float(document.get("total_amount") or 0)))
        return {"message": "Кредитното известие е анулирано" if cancelled else "Документът е изтрит",
                "cancelled": cancelled, "receivable": None, "refund_due": 0.0}
    # Its receivable goes with it while nothing was paid on it - before, a
    # deleted bill left the customer "owing" it for ever. Once money came
    # in, the receivable (and what was paid) stays.
    receivable_status = None
    refund_due = 0.0
    receivable_id = document.get("receivable_id")
    if receivable_id:
        receivable = await server.db.receivables.find_one(
            {"id": receivable_id, **scope}, {"_id": 0, "paid_amount": 1, "description": 1},
        )
        if receivable and float(receivable.get("paid_amount") or 0) <= 0:
            await server.db.receivables.delete_one({"id": receivable_id, **scope})
            receivable_status = "deleted"
        elif receivable and document.get("doc_type") == "invoice":
            # Money came in on an invoice now void: the record stays, closed
            # - nothing is owed on it any more, and what was paid is the
            # customer's to get back (before, the rest stayed "owed" on a
            # cancelled invoice). A bill is only paper: its debt stays.
            refund_due = round(float(receivable.get("paid_amount") or 0), 2)
            await server.db.receivables.update_one({"id": receivable_id, **scope}, {"$set": {
                "cancelled": True, "is_paid": True,
                "description": f"{receivable.get('description') or ''} - анулирана".strip(" -"),
            }})
            receivable_status = "kept"
        elif receivable:
            receivable_status = "kept"
    if cancelled:
        return {"message": "Фактурата е анулирана", "cancelled": True, "receivable": receivable_status, "refund_due": refund_due}
    return {"message": "Документът е изтрит", "cancelled": False, "receivable": receivable_status, "refund_due": refund_due}

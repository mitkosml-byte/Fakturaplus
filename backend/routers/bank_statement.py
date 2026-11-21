"""A bank statement file (Н2): its movements matched to the supplier
invoices they pay and the customer debts they settle - what is certain
offered ticked, what is only likely asked - and the payments the person
confirms recorded through the same code as payments entered by hand (so an
invoice's revenue is never counted again and a document is never paid past
what it owes).

Nothing is recorded twice: a movement is recorded once however often its
statement is read (its id stays on the payment), and a movement already on
record another way - a payment someone entered by hand, or the same
movement read from another file of the same days - is shown as that, never
offered as a new one. Movements with no document are only listed - no expense is made
up from them. The statement's closing balance can become the money in the
bank the cash flow starts from. See services/bank_statement."""
from fastapi import APIRouter
from server import *
import server

from routers.invoices import add_invoice_payment
from routers.receivables import add_receivable_payment
from services import bank_statement as statements

router = APIRouter(prefix="/api")

MAX_STATEMENT_BYTES = 5 * 1024 * 1024


def _day(value: Any) -> Optional[date]:
    """A day sent by the screen - None when it is no day at all."""
    try:
        return business_day(value)
    except (TypeError, ValueError):
        return None


def _may_pay_invoices(user: User) -> bool:
    return "manage_invoices" in set(user.permissions or [])


def _may_receive(user: User) -> bool:
    return "add_revenue" in set(user.permissions or [])


def _require_statement_access(user: User) -> None:
    if not (_may_pay_invoices(user) or _may_receive(user)):
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")


def _invoice_label(invoice: dict) -> str:
    number = str(invoice.get("invoice_number") or "").strip()
    return f"{invoice.get('supplier') or 'Доставчик'}" + (f" № {number}" if number else "")


def _recorded_payments(document: dict) -> List[Tuple[str, float, str]]:
    """The payments on record that a bank shows too (not the ones in cash),
    with the movement each was recorded from, if any."""
    return [
        (str(payment["date"]), round(float(payment.get("amount") or 0), 2), str(payment.get("bank_transaction") or ""))
        for payment in document.get("payments") or []
        if payment.get("date") and payment.get("method") != "cash"
    ]


async def _documents(scope: dict, user: User, first_day: str, last_day: str) -> List[statements.OpenDocument]:
    """What a movement can be about, each for whoever may record it: the
    supplier invoices by bank still owed and what customers still owe - and
    the ones settled by hand around the statement's days, so their movement
    is known for what it is."""
    around = {
        "$gte": (date.fromisoformat(first_day) - timedelta(days=statements.HAND_DAYS_BEFORE)).isoformat(),
        "$lte": (date.fromisoformat(last_day) + timedelta(days=statements.HAND_DAYS_AFTER)).isoformat(),
    }
    open_or_settled_lately = {"$or": [{"is_paid": False}, {"payments": {"$elemMatch": {"date": around}}}]}
    documents: List[statements.OpenDocument] = []
    if _may_pay_invoices(user):
        invoices = await server.db.invoices.find(
            {"$and": [scope, {"payment_method": "bank_transfer"}, open_or_settled_lately]},
            {"_id": 0, "id": 1, "supplier": 1, "supplier_eik": 1, "invoice_number": 1, "total_amount": 1, "paid_amount": 1,
             "credited_amount": 1, "date": 1, "document_type": 1, "is_paid": 1, "payments": 1},
        ).to_list(ALL_ROWS)
        for invoice in invoices:
            if invoice.get("document_type") == CREDIT_NOTE:
                continue
            left = 0.0 if invoice.get("is_paid") else round(invoice_left(invoice), 2)
            on_record = _recorded_payments(invoice)
            if left <= 0.005 and not on_record:
                continue
            day = business_day(invoice.get("date"))
            documents.append(statements.OpenDocument(
                kind="invoice", id=invoice["id"], name=str(invoice.get("supplier") or ""), left=left,
                number=str(invoice.get("invoice_number") or ""), eik=str(invoice.get("supplier_eik") or ""),
                date=day.isoformat() if day else "", label=_invoice_label(invoice), recorded_payments=on_record,
            ))
    if _may_receive(user):
        receivables = await server.db.receivables.find(
            {"$and": [scope, open_or_settled_lately]}, {"_id": 0},
        ).to_list(ALL_ROWS)
        document_ids = [r["billing_document_id"] for r in receivables if r.get("billing_document_id")]
        billing = {
            d["id"]: d for d in await server.db.billing_documents.find(
                {**scope, "id": {"$in": document_ids}},
                {"_id": 0, "id": 1, "invoice_number": 1, "customer_eik": 1, "issue_date": 1},
            ).to_list(ALL_ROWS)
        } if document_ids else {}
        customer_ids = [r["customer_id"] for r in receivables if r.get("customer_id")]
        customers = {
            c["id"]: c for c in await server.db.customers.find(
                {**scope, "id": {"$in": customer_ids}}, {"_id": 0, "id": 1, "eik": 1},
            ).to_list(ALL_ROWS)
        } if customer_ids else {}
        for receivable in receivables:
            left = 0.0 if receivable.get("is_paid") else round(receivable_left(receivable), 2)
            on_record = _recorded_payments(receivable)
            if left <= 0.005 and not on_record:
                continue
            document = billing.get(receivable.get("billing_document_id") or "", {})
            number = str(document.get("invoice_number") or "")
            name = str(receivable.get("customer_name") or "")
            if number:
                label = f"{name} - фактура № {number}"
            else:
                label = name + (f" - {receivable['description']}" if receivable.get("description") else "")
            customer = customers.get(receivable.get("customer_id") or "", {})
            documents.append(statements.OpenDocument(
                kind="receivable", id=receivable["id"], name=name, left=left, number=number,
                eik=str(document.get("customer_eik") or customer.get("eik") or ""),
                date=str(document.get("issue_date") or receivable.get("due_date") or ""), label=label, recorded_payments=on_record,
            ))
    return documents


async def _already_recorded(scope: dict, transaction_ids: List[str]) -> Dict[str, List[dict]]:
    """The movements already recorded as payments from a statement, and on what."""
    recorded: Dict[str, List[dict]] = {}
    if not transaction_ids:
        return recorded
    wanted = set(transaction_ids)
    invoices = await server.db.invoices.find(
        {**scope, "payments.bank_transaction": {"$in": transaction_ids}},
        {"_id": 0, "id": 1, "supplier": 1, "invoice_number": 1, "payments": 1},
    ).to_list(ALL_ROWS)
    for invoice in invoices:
        for payment in invoice.get("payments") or []:
            if payment.get("bank_transaction") in wanted:
                recorded.setdefault(payment["bank_transaction"], []).append({
                    "kind": "invoice", "id": invoice["id"], "label": _invoice_label(invoice), "name": invoice.get("supplier") or "",
                    "number": str(invoice.get("invoice_number") or ""), "left": 0, "amount": round(float(payment.get("amount") or 0), 2),
                })
    receivables = await server.db.receivables.find(
        {**scope, "payments.bank_transaction": {"$in": transaction_ids}},
        {"_id": 0, "id": 1, "customer_name": 1, "payments": 1},
    ).to_list(ALL_ROWS)
    for receivable in receivables:
        for payment in receivable.get("payments") or []:
            if payment.get("bank_transaction") in wanted:
                recorded.setdefault(payment["bank_transaction"], []).append({
                    "kind": "receivable", "id": receivable["id"], "label": receivable.get("customer_name") or "",
                    "name": receivable.get("customer_name") or "", "number": "", "left": 0,
                    "amount": round(float(payment.get("amount") or 0), 2),
                })
    return recorded


async def _balance_state(company_id: Optional[str], user: User, closing_date: Optional[str]) -> dict:
    """May the statement's closing balance become the money in the bank the
    cash flow starts from? For whoever sees the cash flow, and only when no
    newer amount was entered after the statement's last day - what the
    person said since then is the more recent truth."""
    today = today_local()
    day = min(_day(closing_date) or today, today)
    if not company_id or not sees_cash_flow(user):
        return {"allowed": False, "day": day, "position": None, "newer": False}
    position = await latest_cash_position(company_id)
    position_day = business_day(position.get("date")) if position else None
    newer = bool(position_day and position_day > day)
    return {"allowed": not newer, "day": day, "position": position, "newer": newer}


@router.post("/bank-statement/preview")
@limiter.limit("20/minute")
async def preview_bank_statement(request: Request, file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """The statement read and matched - nothing is recorded yet."""
    _require_statement_access(current_user)
    content = await file.read(MAX_STATEMENT_BYTES + 1)
    if len(content) > MAX_STATEMENT_BYTES:
        raise HTTPException(status_code=413, detail="Файлът е над 5 MB - изтеглете извлечение за по-кратък период.")
    try:
        statement = await asyncio.to_thread(statements.read_statement, content, file.filename or "")
    except statements.StatementError as error:
        raise HTTPException(status_code=400, detail=str(error))
    company_id, scope = await get_company_scope(current_user)
    first_day = min(t.date for t in statement.transactions)
    last_day = max(t.date for t in statement.transactions)
    documents = await _documents(scope, current_user, first_day, last_day)
    recorded = await _already_recorded(scope, [t.id for t in statement.transactions])
    rows = await asyncio.to_thread(statements.match_statement, statement.transactions, documents, recorded)
    balance = await _balance_state(company_id, current_user, statement.closing_date)
    position = balance["position"]
    return {
        "format": statement.format, "count": len(rows),
        "skipped_rows": statement.skipped_rows, "other_currency_rows": statement.other_currency_rows,
        "from": first_day, "to": last_day,
        "money_in": round(sum(t.amount for t in statement.transactions if t.amount > 0), 2),
        "money_out": round(-sum(t.amount for t in statement.transactions if t.amount < 0), 2),
        "closing_balance": statement.closing_balance, "closing_date": balance["day"].isoformat(),
        "can_set_balance": bool(balance["allowed"] and statement.closing_balance is not None),
        "current_bank_balance": round(float(position.get("bank") or 0), 2) if position else None,
        "current_balance_date": position.get("date") if position else None,
        "balance_is_newer": balance["newer"],
        "can_pay_invoices": _may_pay_invoices(current_user), "can_receive": _may_receive(current_user),
        "counts": {
            status: sum(1 for row in rows if row["status"] == status)
            for status in (statements.SURE, statements.ASK, statements.ENTERED, statements.NONE, statements.APPLIED)
        },
        "transactions": rows,
    }


class BankTarget(BaseModel):
    kind: Literal["invoice", "receivable"]
    id: str = Field(min_length=1, max_length=80)
    amount: float = Field(gt=0)


class BankPayment(BaseModel):
    transaction_id: str = Field(min_length=8, max_length=64)
    date: str
    amount: float  # the movement's own sum: in above zero, out below
    targets: List[BankTarget] = Field(min_length=1, max_length=12)


class BankApply(BaseModel):
    payments: List[BankPayment] = Field(default_factory=list, max_length=2000)
    # The statement's closing balance, to become the money in the bank.
    closing_balance: Optional[float] = Field(default=None, ge=-10_000_000, le=1_000_000_000)
    closing_date: Optional[str] = None


@router.post("/bank-statement/apply")
@limiter.limit("10/minute")
async def apply_bank_statement(request: Request, payload: BankApply, current_user: User = Depends(get_current_user)):
    """Records the payments the person confirmed, each on its movement's
    day - and, when asked, the closing balance as the money in the bank."""
    _require_statement_access(current_user)
    company_id, scope = await get_company_scope(current_user)
    today = today_local()
    recorded = await _already_recorded(scope, [p.transaction_id for p in payload.payments])
    applied = 0
    already = 0
    failed: List[dict] = []
    paid_out = received = 0.0
    seen: set = set()
    for payment in payload.payments:
        if payment.transaction_id in recorded or payment.transaction_id in seen:
            already += 1
            continue
        seen.add(payment.transaction_id)
        day = _day(payment.date)
        kind = "receivable" if payment.amount > 0 else "invoice"
        problem = None
        if day is None:
            problem = "Невалидна дата на движението"
        elif any(target.kind != kind for target in payment.targets):
            problem = "Постъпление се отнася към вземане, а плащане - към фактура от доставчик"
        elif sum(target.amount for target in payment.targets) > abs(payment.amount) + statements.CENT:
            problem = "Разпределеното е повече от сумата на движението"
        elif len({target.id for target in payment.targets}) != len(payment.targets):
            problem = "Един документ е посочен два пъти"
        if problem or day is None:
            failed.append({"transaction_id": payment.transaction_id, "target_id": None, "message": problem})
            continue
        when = min(day, today).isoformat()
        for target in payment.targets:
            try:
                if target.kind == "invoice":
                    await add_invoice_payment(target.id, InvoicePaymentCreate(
                        amount=round(target.amount, 2), date=when, method="bank_transfer", bank_transaction=payment.transaction_id,
                    ), current_user)
                    paid_out += target.amount
                else:
                    await add_receivable_payment(target.id, ReceivablePaymentCreate(
                        amount=round(target.amount, 2), date=when, method="bank_transfer", bank_transaction=payment.transaction_id,
                    ), current_user)
                    received += target.amount
                applied += 1
            except HTTPException as error:
                failed.append({"transaction_id": payment.transaction_id, "target_id": target.id, "message": str(error.detail)})

    balance_set = False
    if payload.closing_balance is not None:
        balance = await _balance_state(company_id, current_user, payload.closing_date)
        if balance["allowed"]:
            await server.db.cash_positions.insert_one({
                "id": str(uuid.uuid4()), "company_id": company_id, "date": balance["day"].isoformat(),
                "cash": round(float((balance["position"] or {}).get("cash") or 0), 2), "bank": round(payload.closing_balance, 2),
                "source": "bank_statement", "created_by": current_user.user_id, "created_at": datetime.now(timezone.utc),
            })
            balance_set = True
    if applied or balance_set:
        await audit_service.log_action(
            user_id=current_user.user_id, user_name=current_user.name, action="import", entity_type="bank_statement",
            company_id=company_id,
            details={"payments": applied, "paid_to_suppliers": round(paid_out, 2), "received_from_customers": round(received, 2),
                     "failed": len(failed),
                     "bank_balance": round(payload.closing_balance, 2) if balance_set and payload.closing_balance is not None else None},
        )
    return {
        "applied": applied, "already_recorded": already, "failed": failed, "balance_set": balance_set,
        "paid_to_suppliers": round(paid_out, 2), "received_from_customers": round(received, 2),
    }

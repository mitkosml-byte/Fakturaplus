"""Module 1 audit finding - extracted from the former monolithic server.py.
Shares server.py's db/models/helpers/services via `from server import *`;
`db` and `AI_FEATURES_ENABLED` are the two globals tests/startup reassign
after module load, so this file always accesses them as `server.db` /
`server.AI_FEATURES_ENABLED` (qualified), never via the star-import, to
stay correct when server.py's test fixture monkeypatches them."""
import uuid

from fastapi import APIRouter
from pymongo.errors import DuplicateKeyError
from routers.recurring import maintain_quietly
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
from routers.price_tracking import (
    detect_pack_multiple,
    forget_pack_rule,
    get_pack_rule,
    learn_pack_rule,
    evaluate_price_change,
    get_price_alert_settings_dict,
    price_history_row,
    purge_invoice_price_data,
    rebuild_invoice_price_history,
    resync_invoice_header,
    resync_invoice_line,
)

from services.invoice_check import check_invoice_draft
from services.business_calendar import Period, day_start_utc, stored_day, today_local

router = APIRouter(prefix="/api")


def _day_or_400(value, what: str) -> datetime:
    """A submitted invoice or due date as its stored business day - a clear
    400 for text that is no date at all, instead of a server error."""
    try:
        day = stored_day(value)
    except (TypeError, ValueError):
        day = None
    if day is None:
        raise HTTPException(status_code=400, detail=f"Невалидна {what}")
    return day

# Cash and card are paid at the till, the moment the invoice is issued.
PAID_ON_THE_SPOT = {"cash", "card"}


@router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice: InvoiceCreate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_invoices")
    company_id, scope = await get_company_scope(current_user)

    # Merge with an already-known counterparty regardless of punctuation or
    # letter case - by EIK first - so this also applies to manually
    # typed/edited invoices, not just ones that came straight out of OCR.
    normalized_supplier, _ = await normalize_supplier_name(invoice.supplier, company_id, invoice.supplier_eik)
    invoice.supplier = normalized_supplier

    is_credit_note = invoice.document_type == CREDIT_NOTE
    duplicate = await find_duplicate_invoice(
        scope, invoice.supplier, invoice.supplier_eik, invoice.invoice_number, invoice.document_type,
    )
    if duplicate:
        added_by_user = await server.db.users.find_one({"user_id": duplicate.get("user_id")}, {"_id": 0, "name": 1})
        added_by = f" от {added_by_user['name']}" if added_by_user and added_by_user.get("name") else ""
        what = "Кредитно известие" if is_credit_note else "Фактура"
        done = "добавено" if is_credit_note else "добавена"
        raise HTTPException(
            status_code=409,
            detail=f"{what} с номер {invoice.invoice_number} от {invoice.supplier} вече е {done}{added_by}!",
        )

    invoice_dict = invoice.model_dump()
    # The business day the invoice is dated, kept as 00:00 UTC of it
    # (services/business_calendar) - whatever device or time of day it was
    # picked at, every module then reads it as the same day.
    invoice_date = _day_or_400(invoice_dict["date"], "дата на фактурата")

    # Suggest a VAT treatment when the caller didn't set one, based on the
    # VAT-to-base ratio - saves the common case (standard 20%) a manual pick,
    # while leaving anything unusual (0%, reverse charge...) for the user to
    # classify correctly themselves.
    if invoice_dict.get("vat_treatment") is None and invoice_dict.get("amount_without_vat"):
        vat_ratio = invoice_dict["vat_amount"] / invoice_dict["amount_without_vat"]
        if abs(vat_ratio - 0.20) < 0.01:
            invoice_dict["vat_treatment"] = VatTreatment.STANDARD_20
        elif abs(vat_ratio - 0.09) < 0.01:
            invoice_dict["vat_treatment"] = VatTreatment.REDUCED_9

    # Payment tracking - cash purchases settle on the spot, so they mark
    # themselves paid automatically instead of asking the user to tick a box
    # for something that's already true. Bank transfer starts unpaid and
    # gets a due date - the caller's own date if given, otherwise a 14-day
    # default (common B2B trade credit term), so the reminder has something
    # to compare against even if nobody set one explicitly.
    is_paid = False
    paid_amount = 0.0
    paid_at = None
    payment_due_date = None
    if is_credit_note:
        # Nothing is owed on a credit note: settled from its own date.
        is_paid = True
        paid_amount = invoice_dict.get("total_amount", 0)
        paid_at = invoice_date
    elif invoice_dict.get("payment_method") in PAID_ON_THE_SPOT:
        is_paid = True
        paid_amount = invoice_dict.get("total_amount", 0)
        paid_at = invoice_date
    elif invoice_dict.get("payment_method") == "bank_transfer":
        if invoice_dict.get("payment_due_date"):
            payment_due_date = _day_or_400(invoice_dict["payment_due_date"], "дата на падеж")
        else:
            payment_due_date = invoice_date + timedelta(days=14)

    # Reverse-charge purchases (services from abroad, ВОП...) need a
    # self-billing протокол по чл.117 ЗДДС, issued within 15 days of the
    # tax point - assign the next sequential number automatically so
    # nobody has to track this by hand.
    if invoice_dict.get("vat_treatment") == VatTreatment.REVERSE_CHARGE:
        invoice_dict["protocol_number"] = await next_protocol_number(company_id, current_user.user_id, invoice_date.year)

    # A credit note names the invoice it corrects; tied to it when that
    # invoice is in (otherwise once it is entered - link_waiting_credit_notes).
    credited_target = None
    if is_credit_note:
        invoice_dict["credited_invoice_number"] = (invoice_dict.get("credited_invoice_number") or "").strip() or None
        credited_target = await find_credited_invoice(scope, invoice_dict)
    else:
        invoice_dict["credited_invoice_number"] = None

    # Process items and convert to dict format. The invoice id is fixed up
    # front so every price-history row and alert is written already linked
    # to its invoice and line - no after-the-fact backfill that could miss.
    invoice_id = str(uuid.uuid4())
    items_list = None
    history_rows = []
    price_alerts = []

    pack_lessons: List[tuple] = []
    if invoice.items:
        items_list = []
        alert_settings = await get_price_alert_settings_dict(company_id) if company_id else None
        for item in invoice.items:
            item_dict = item.model_dump()
            # Scan-review signals, not part of the stored line.
            applied = item_dict.pop("pack_multiple_applied", None)
            rejected = item_dict.pop("pack_rule_rejected", None)
            if is_credit_note:
                pass  # what went back teaches nothing about how a supplier packs
            elif applied:
                pack_lessons.append(("learn", item_dict["name"], applied))
            elif rejected:
                pack_lessons.append(("forget", item_dict["name"], None))
            # Calculate total_price if not provided
            if item_dict.get("total_price") is None:
                item_dict["total_price"] = item_dict["quantity"] * item_dict["unit_price"]
            # Calculate VAT if not provided (20%)
            if item_dict.get("vat_amount") is None:
                item_dict["vat_amount"] = item_dict["total_price"] * 0.2

            item_dict["id"] = str(uuid.uuid4())
            items_list.append(item_dict)

            # A credit note's lines are what went back, not purchase prices.
            if company_id and alert_settings and not is_credit_note:
                row = await price_history_row(
                    company_id, invoice.supplier, invoice_id, invoice.invoice_number, invoice_date, item_dict
                )
                if row:
                    alert = await evaluate_price_change(company_id, row, alert_settings)
                    if alert:
                        price_alerts.append(PriceAlert(company_id=company_id, **alert))
                    history_rows.append(row)

    invoice_obj = Invoice(
        id=invoice_id,
        user_id=current_user.user_id,
        company_id=company_id,
        date=invoice_date,
        items=items_list,
        is_paid=is_paid,
        paid_amount=paid_amount,
        paid_at=paid_at,
        payment_due_date=payment_due_date,
        credited_invoice_id=credited_target["id"] if credited_target else None,
        **{k: v for k, v in invoice_dict.items() if k not in ["date", "items", "payment_due_date"]}
    )
    await server.db.invoices.insert_one(invoice_obj.model_dump())
    # What a credit note took off is no longer owed on its invoice; an
    # invoice picks up credit notes entered before it.
    if credited_target:
        await settle_credited_invoice(credited_target["id"], scope)
    elif not is_credit_note:
        await link_waiting_credit_notes(scope, invoice_obj.model_dump())

    if company_id and invoice.items:
        if history_rows:
            await server.db.item_price_history.insert_many(history_rows)
        for price_alert in price_alerts:
            await server.db.price_alerts.insert_one(price_alert.model_dump())

        # A suspected pack misread is a question about this invoice, not
        # news worth a phone notification - only real price changes push.
        price_changes = [a for a in price_alerts if a.kind == "price_change"]
        if price_changes:
            background_tasks.add_task(send_price_alert_pushes, company_id, price_changes)

        # Keep raw-material grouping fresh automatically, without the user
        # having to trigger it - throttled inside the task itself.
        background_tasks.add_task(maybe_schedule_ai_item_merge, company_id)

    if company_id:
        for lesson, item_name, multiple in pack_lessons:
            if lesson == "learn":
                await learn_pack_rule(company_id, invoice.supplier, item_name, multiple, "scan")
            else:
                await forget_pack_rule(company_id, invoice.supplier, item_name)

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="create",
        entity_type="invoice",
        entity_id=invoice_obj.id,
        company_id=company_id,
        details={"supplier": invoice_obj.supplier, "invoice_number": invoice_obj.invoice_number, "total_amount": invoice_obj.total_amount}
    )
    # It may pay a recurring expense's month - one recorded without an
    # invoice included (then it replaces that record).
    await maintain_quietly(company_id, {"user_id": current_user.user_id, "user_name": current_user.name})

    return invoice_obj

class MarkInvoicesPaidRequest(BaseModel):
    invoice_ids: List[str] = Field(min_length=1, max_length=500)


@router.post("/invoices/mark-paid")
async def mark_invoices_paid(body: MarkInvoicesPaidRequest, current_user: User = Depends(get_current_user)):
    """Marks several unpaid invoices fully paid in one go - the answer to
    "these overdue invoices look paid, mark them?" on Home. Only unpaid
    invoices of the caller's own company are touched; each change is
    audit-logged like a single "mark paid"."""
    require_permission(current_user, "manage_invoices")
    company_id, scope = await get_company_scope(current_user)
    now = datetime.now(timezone.utc)
    invoices = await server.db.invoices.find(
        {**scope, "id": {"$in": body.invoice_ids}, "is_paid": False},
        {"_id": 0, "id": 1, "total_amount": 1, "credited_amount": 1, "supplier": 1, "invoice_number": 1,
         "paid_amount": 1, "payments": 1},
    ).to_list(len(body.invoice_ids))
    for inv in invoices:
        # Paid in full is the total less what credit notes took off - the
        # rest paid today, as one payment in its history.
        paid = max(float(inv.get("total_amount") or 0) - float(inv.get("credited_amount") or 0), 0.0)
        await server.db.invoices.update_one(
            {**scope, "id": inv["id"]},
            {"$set": {"is_paid": True, "paid_amount": round(paid, 2), "paid_at": now,
                      "payments": invoice_payments_for(inv, paid, today_local())}},
        )
        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="update",
            entity_type="invoice",
            entity_id=inv["id"],
            company_id=company_id,
            details={
                "is_paid": True, "marked_in_bulk": True,
                "supplier": inv.get("supplier"), "invoice_number": inv.get("invoice_number"),
            },
        )
    return {"updated": len(invoices)}


async def _payable_invoice(scope: dict, invoice_id: str) -> dict:
    existing = await server.db.invoices.find_one(
        {"id": invoice_id, **scope}, {"_id": 0, "image_base64": 0, "image_base64s": 0},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    if existing.get("document_type") == CREDIT_NOTE:
        raise HTTPException(status_code=400, detail="Кредитното известие не се плаща")
    if existing.get("payment_method") != "bank_transfer":
        raise HTTPException(status_code=400, detail="Плащания се въвеждат за фактури по банков път - тази е платена на място")
    return existing


def _paid_at(existing: dict, payments: List[dict], fully: bool) -> Optional[datetime]:
    """Paid in full on the day of the payment that completed it."""
    if not fully:
        return None
    days = [business_day(p.get("date")) for p in payments]
    latest = max((d for d in days if d), default=None)
    return day_start_utc(latest) if latest else existing.get("paid_at") or datetime.now(timezone.utc)


async def _invoice_now(scope: dict, invoice_id: str) -> Invoice:
    saved = await server.db.invoices.find_one({"id": invoice_id, **scope}, {"_id": 0, "image_base64": 0, "image_base64s": 0})
    if not saved:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    return Invoice(**saved)


@router.post("/invoices/{invoice_id}/payments", response_model=Invoice)
async def add_invoice_payment(invoice_id: str, payload: InvoicePaymentCreate, current_user: User = Depends(get_current_user)):
    """A payment to the supplier on an invoice by bank - in part or in
    full, on its own day and by its own method (before, every payment was
    "today" and part payments only a sum). Paid in full once the payments
    and credit notes reach the total."""
    require_permission(current_user, "manage_invoices")
    company_id, scope = await get_company_scope(current_user)
    existing = await _payable_invoice(scope, invoice_id)
    left = invoice_left(existing)
    if existing.get("is_paid") or left <= 0.005:
        raise HTTPException(status_code=400, detail="Фактурата вече е платена")
    if payload.amount > left + 0.01:
        raise HTTPException(status_code=400, detail=f"Остават {left:.2f} € - плащането е по-голямо")
    day = business_day(payload.date) if payload.date else today_local()
    if day is None:
        raise HTTPException(status_code=400, detail="Невалидна дата")
    if day > today_local():
        raise HTTPException(status_code=400, detail="Плащането не може да е с бъдеща дата")
    paid = round(float(existing.get("paid_amount") or 0) + payload.amount, 2)
    entry: Dict[str, Any] = {
        "id": str(uuid.uuid4()), "amount": round(payload.amount, 2), "date": day.isoformat(), "method": payload.method,
    }
    target: Dict[str, Any] = {"id": invoice_id, **scope}
    if payload.bank_transaction:
        # From a bank statement: the same movement is on an invoice once.
        entry["bank_transaction"] = payload.bank_transaction
        target["payments.bank_transaction"] = {"$ne": payload.bank_transaction}
    payments = [*(existing.get("payments") or []), entry]
    fully = invoice_left({**existing, "paid_amount": paid}) <= 0.01
    written = await server.db.invoices.update_one(target, {"$set": {
        "paid_amount": paid, "is_paid": fully, "payments": payments, "paid_at": _paid_at(existing, payments, fully),
    }})
    if written.matched_count == 0:
        raise HTTPException(status_code=409, detail="Това движение от извлечението вече е отразено по фактурата")
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="update", entity_type="invoice",
        entity_id=invoice_id, company_id=company_id,
        details={"payment": round(payload.amount, 2), "payment_date": day.isoformat(), "method": payload.method,
                 "supplier": existing.get("supplier"), "invoice_number": existing.get("invoice_number")},
    )
    return await _invoice_now(scope, invoice_id)


@router.delete("/invoices/{invoice_id}/payments/{payment_id}", response_model=Invoice)
async def delete_invoice_payment(invoice_id: str, payment_id: str, current_user: User = Depends(get_current_user)):
    """A payment entered by mistake, taken out of the invoice's history -
    what is paid and owed follows."""
    require_permission(current_user, "manage_invoices")
    company_id, scope = await get_company_scope(current_user)
    existing = await _payable_invoice(scope, invoice_id)
    payment = next((p for p in existing.get("payments") or [] if p.get("id") == payment_id), None)
    if not payment:
        raise HTTPException(status_code=404, detail="Плащането не е намерено")
    payments = [p for p in existing.get("payments") or [] if p.get("id") != payment_id]
    paid = round(max(float(existing.get("paid_amount") or 0) - float(payment.get("amount") or 0), 0.0), 2)
    fully = invoice_left({**existing, "paid_amount": paid}) <= 0.01
    await server.db.invoices.update_one({"id": invoice_id, **scope}, {"$set": {
        "paid_amount": paid, "is_paid": fully, "payments": payments, "paid_at": _paid_at(existing, payments, fully),
    }})
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="update", entity_type="invoice",
        entity_id=invoice_id, company_id=company_id,
        details={"payment_removed": payment.get("amount"), "payment_date": payment.get("date"),
                 "supplier": existing.get("supplier"), "invoice_number": existing.get("invoice_number")},
    )
    return await _invoice_now(scope, invoice_id)


class DraftCheckLine(BaseModel):
    name: str = Field(default="", max_length=300)
    quantity: float = 0
    unit_price: float = 0
    # The line's value as printed on the invoice (recognized lines only).
    printed_total: Optional[float] = None


class DraftCheckRequest(BaseModel):
    amount_without_vat: float = 0
    vat_amount: float = 0
    total_amount: float = 0
    items: List[DraftCheckLine] = Field(default_factory=list, max_length=500)


@router.post("/invoices/draft-check")
@limiter.limit("120/minute")
async def check_invoice_draft_endpoint(
    request: Request, body: DraftCheckRequest, current_user: User = Depends(get_current_user),
):
    """Scan review, before saving: do the amounts add up, and which line is
    most likely wrong if not (see services/invoice_check.py). Reads nothing
    stored - cheap enough to run again after every edit."""
    require_permission(current_user, "manage_invoices")
    return check_invoice_draft(
        body.amount_without_vat, body.vat_amount, body.total_amount,
        [item.model_dump() for item in body.items],
    )


@router.get("/invoices", response_model=List[Invoice])
async def get_invoices(
    response: Response,
    supplier: Optional[str] = None,
    invoice_number: Optional[str] = None,
    search: Optional[str] = None,  # matches supplier OR invoice_number, unlike the two above which AND together
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    payment_status: Optional[str] = None,  # paid | unpaid | partial | overdue
    limit: int = 1000,
    offset: int = 0,
    current_user: User = Depends(get_current_user)
):
    # Same gate as creating/editing/deleting an invoice - there's no
    # separate "view invoices" permission, so an owner unticking
    # manage_invoices for a member must actually revoke list access too,
    # not just the write endpoints.
    require_permission(current_user, "manage_invoices")
    _, query = await get_company_scope(current_user)

    if supplier:
        query["supplier"] = {"$regex": re.escape(supplier), "$options": "i"}
    if invoice_number:
        query["invoice_number"] = {"$regex": re.escape(invoice_number), "$options": "i"}
    if search:
        # Next to the company's own scope (itself an $or), never in its
        # place - before, a search listed every company's invoices.
        pattern = {"$regex": re.escape(search), "$options": "i"}
        query = {"$and": [query, {"$or": [{"supplier": pattern}, {"invoice_number": pattern}]}]}
    if start_date or end_date:
        # Whole business days, whatever form the bounds came in (a day, or
        # a device's local midnight sent as a UTC moment) - the same days
        # Home, Statistics and every other module count for this period.
        try:
            query["date"] = Period.parse(start_date, end_date).datetime_filter()
        except ValueError:
            raise HTTPException(status_code=400, detail="Невалиден период")
    if payment_status == "paid":
        query["is_paid"] = True
    elif payment_status == "unpaid":
        query["is_paid"] = False
        query["payment_method"] = "bank_transfer"
    elif payment_status == "partial":
        # A subset of "unpaid" - something has been paid, but not all of it.
        query["is_paid"] = False
        query["payment_method"] = "bank_transfer"
        query["paid_amount"] = {"$gt": 0}
    elif payment_status == "overdue":
        query["is_paid"] = False
        query["payment_method"] = "bank_transfer"
        # Overdue = the due day has passed: due before today, on the
        # business's own calendar.
        query["payment_due_date"] = {"$lt": day_start_utc(today_local())}

    # Previously a hardcoded .to_list(1000) with no way to go further -
    # once a company passed 1,000 matching invoices, the oldest ones became
    # permanently invisible with no error, no indicator, nothing. Now a
    # real (capped) limit/offset, plus X-Total-Count so a caller - today
    # just a diagnostic, eventually the frontend's own "load more" - can
    # tell whether it's seeing everything.
    clamped_limit = max(1, min(limit, 5000))
    clamped_offset = max(0, offset)
    total_count = await server.db.invoices.count_documents(query)
    response.headers["X-Total-Count"] = str(total_count)
    # The sums of every matching invoice, not just the page sent back - so
    # the list's totals for a period are the period's totals, however many
    # invoices it holds.
    sums = await server.db.invoices.aggregate([
        {"$match": query},
        {"$group": {"_id": None, "amount": {"$sum": "$total_amount"}, "vat": {"$sum": "$vat_amount"}}},
    ]).to_list(ALL_ROWS)
    response.headers["X-Total-Amount"] = f"{float(sums[0].get('amount') or 0) if sums else 0.0:.2f}"
    response.headers["X-Total-Vat"] = f"{float(sums[0].get('vat') or 0) if sums else 0.0:.2f}"
    invoices = await server.db.invoices.find(
        query, {"_id": 0, "image_base64": 0, "image_base64s": 0}
    ).sort("date", -1).skip(clamped_offset).limit(clamped_limit).to_list(clamped_limit)
    return [Invoice(**inv) for inv in invoices]

@router.get("/invoices/protocols/reverse-charge")
async def get_reverse_charge_protocols(current_user: User = Depends(get_current_user)):
    """List all reverse-charge purchases (self-billing протокол по чл.117
    ЗДДС) across the whole company, newest first - lets the owner or
    accountant see every protocol's number and check none has slipped
    past its 15-day filing deadline."""
    require_permission(current_user, "view_statistics")
    _, query = await get_company_scope(current_user)
    query["vat_treatment"] = VatTreatment.REVERSE_CHARGE

    invoices = await server.db.invoices.find(query, {"_id": 0, "image_base64": 0, "image_base64s": 0}).sort("date", -1).to_list(ALL_ROWS)
    return [Invoice(**inv) for inv in invoices]

@router.get("/invoices/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_invoices")
    _, scope = await get_company_scope(current_user)
    invoice = await server.db.invoices.find_one({"id": invoice_id, **scope}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    return Invoice(**invoice)

@router.put("/invoices/{invoice_id}", response_model=Invoice)
async def update_invoice(invoice_id: str, invoice_update: InvoiceUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_invoices")
    update_data = {k: v for k, v in invoice_update.model_dump().items() if v is not None}
    if "date" in update_data:
        update_data["date"] = _day_or_400(update_data["date"], "дата на фактурата")
    if "payment_due_date" in update_data:
        update_data["payment_due_date"] = _day_or_400(update_data["payment_due_date"], "дата на падеж")

    company_id, scope = await get_company_scope(current_user)
    existing = await server.db.invoices.find_one({"id": invoice_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")

    # The document's type after this edit, and its amounts signed for it: a
    # credit note's below zero, an invoice's never. Switching the type flips
    # the stored amounts with it, whichever way the form shows them.
    old_type = existing.get("document_type") or "invoice"
    new_type = update_data.get("document_type", old_type)
    is_credit_note = new_type == CREDIT_NOTE
    amounts = {f: update_data[f] for f in INVOICE_AMOUNT_FIELDS if f in update_data}
    if new_type != old_type:
        amounts = {f: abs(float(amounts.get(f, existing.get(f) or 0))) for f in INVOICE_AMOUNT_FIELDS}
    try:
        update_data.update(sign_invoice_amounts(new_type, amounts))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    if is_credit_note:
        # Settled by nature - worked out below, never taken from the form.
        for field in ("is_paid", "paid_amount", "paid_at", "payment_due_date"):
            update_data.pop(field, None)

    # A corrected supplier or number must not turn it into a copy of
    # another invoice the company already holds.
    if {"supplier", "supplier_eik", "invoice_number", "document_type"} & set(update_data):
        if "supplier" in update_data:
            update_data["supplier"], _ = await normalize_supplier_name(
                update_data["supplier"], company_id, update_data.get("supplier_eik", existing.get("supplier_eik")),
            )
        duplicate = await find_duplicate_invoice(
            scope,
            update_data.get("supplier", existing.get("supplier", "")),
            update_data.get("supplier_eik", existing.get("supplier_eik")),
            update_data.get("invoice_number", existing.get("invoice_number", "")),
            new_type,
            exclude_id=invoice_id,
        )
        if duplicate:
            what = "кредитно известие" if is_credit_note else "фактура"
            raise HTTPException(
                status_code=409,
                detail=f"Вече има {what} с номер {update_data.get('invoice_number', existing.get('invoice_number'))} от този доставчик",
            )

    # Credit notes to this invoice already took this much off what is owed.
    credited = 0.0 if is_credit_note else float(existing.get("credited_amount") or 0)

    explicit_payment = "is_paid" in update_data or "paid_amount" in update_data
    computed_payment = False  # the payment state below was worked out here, not sent
    old_method = existing.get("payment_method")
    new_method = update_data.get("payment_method", old_method)
    # A credit note turned back into an invoice starts as any new invoice
    # does: paid at the till, or owed (with a due date by bank).
    if old_type == CREDIT_NOTE and not is_credit_note and not explicit_payment:
        if new_method in PAID_ON_THE_SPOT:
            update_data["is_paid"] = True
            update_data["paid_amount"] = update_data["total_amount"]
            update_data["paid_at"] = update_data.get("date", existing["date"])
        else:
            update_data["is_paid"] = False
            update_data["paid_amount"] = 0.0
            update_data["paid_at"] = None
            if new_method == "bank_transfer" and "payment_due_date" not in update_data:
                update_data["payment_due_date"] = update_data.get("date", existing["date"]) + timedelta(days=14)
        explicit_payment = computed_payment = True
    # Switched from paid at the till to a bank transfer: owed until someone
    # says it was paid (the edit form asks) - it used to stay "paid".
    if (
        not explicit_payment and "payment_method" in update_data
        and old_method in PAID_ON_THE_SPOT and new_method == "bank_transfer"
    ):
        update_data["is_paid"] = False
        update_data["paid_amount"] = 0.0
        update_data["paid_at"] = None
        explicit_payment = computed_payment = True
    # A corrected total moves what is paid with it: paid at the till, the
    # paid amount follows the new total; by bank, what was paid stays and
    # the invoice is part-paid (or paid) against the new total. Before, a
    # paid invoice corrected from 100 to 1 000 stayed "paid" with 100 paid.
    if (
        "total_amount" in update_data and not explicit_payment
        and abs(float(update_data["total_amount"]) - float(existing.get("total_amount") or 0)) > 0.005
    ):
        new_total = float(update_data["total_amount"])
        paid_before = float(existing.get("paid_amount") or 0)
        if new_method in PAID_ON_THE_SPOT:
            update_data["paid_amount"] = new_total
            update_data["is_paid"] = True
            update_data["paid_at"] = existing.get("paid_at") or update_data.get("date", existing["date"])
        elif new_method == "bank_transfer":
            paid_now = min(paid_before, new_total)
            update_data["paid_amount"] = round(paid_now, 2)
            update_data["is_paid"] = paid_now + credited >= new_total - 0.01
            if not update_data["is_paid"]:
                update_data["paid_at"] = None
        explicit_payment = computed_payment = new_method in PAID_ON_THE_SPOT or new_method == "bank_transfer"

    # Same auto-paid/due-date rules as on create, so switching an invoice's
    # payment method later behaves the same as picking it up front.
    cash_auto_paid = (
        update_data.get("payment_method") in PAID_ON_THE_SPOT
        and "is_paid" not in update_data
        and "paid_amount" not in update_data
    )
    if cash_auto_paid:
        update_data["is_paid"] = True
        update_data["paid_amount"] = update_data.get("total_amount", existing.get("total_amount", 0))
        update_data["paid_at"] = update_data.get("date", existing["date"])  # paid on the spot, at invoice date
    if update_data.get("payment_method") == "bank_transfer" and "payment_due_date" not in update_data and not existing.get("payment_due_date"):
        update_data["payment_due_date"] = update_data.get("date", existing["date"]) + timedelta(days=14)

    if "paid_amount" in update_data and not cash_auto_paid and not computed_payment:
        # paid_amount is the source of truth for payment progress once
        # given - it drives is_paid/paid_at, not the other way round, so a
        # partial payment (0 < paid_amount < total) always shows is_paid as
        # False with the exact remaining balance recoverable as
        # total_amount - paid_amount (see /statistics/summary's use of it).
        # What can be paid: the total less what credit notes took off.
        effective_total = max(float(update_data.get("total_amount", existing.get("total_amount", 0))) - credited, 0.0)
        paid_amount = update_data["paid_amount"]
        if paid_amount < 0:
            raise HTTPException(status_code=400, detail="Платената сума не може да е отрицателна")
        if paid_amount > effective_total + 0.01:
            raise HTTPException(status_code=400, detail="Платената сума не може да надвишава общата сума на фактурата")
        was_fully_paid = bool(existing.get("is_paid"))
        now_fully_paid = paid_amount >= effective_total - 0.01
        update_data["is_paid"] = now_fully_paid
        if now_fully_paid and not was_fully_paid:
            update_data["paid_at"] = datetime.now(timezone.utc)
        elif not now_fully_paid:
            update_data["paid_at"] = None
    elif "is_paid" in update_data and not cash_auto_paid and not computed_payment:
        # Ticking "is_paid" directly (the quick mark-fully-paid/unpaid
        # toggle, without keying in an exact amount) keeps paid_amount
        # consistent with it, and stamps/clears paid_at to "now" - when the
        # user actually confirmed the payment.
        update_data["paid_at"] = datetime.now(timezone.utc) if update_data["is_paid"] else None
        update_data["paid_amount"] = (
            round(max(float(update_data.get("total_amount", existing.get("total_amount", 0))) - credited, 0.0), 2)
            if update_data["is_paid"] else 0.0
        )

    if is_credit_note:
        update_data["is_paid"] = True
        update_data["paid_amount"] = update_data.get("total_amount", existing.get("total_amount", 0))
        update_data["paid_at"] = existing.get("paid_at") or update_data.get("date", existing["date"])
        update_data["payment_due_date"] = None
        update_data["payments"] = []
    elif "paid_amount" in update_data:
        # The payment history follows a paid amount set at once: by bank, a
        # rise is a payment of today; paid on the spot keeps none.
        update_data["payments"] = (
            invoice_payments_for(existing, float(update_data["paid_amount"]), today_local())
            if new_method == "bank_transfer" else []
        )

    # A credit note's invoice ("към фактура №"), worked out again whenever
    # its number, supplier or type changes; an invoice names none.
    old_target = existing.get("credited_invoice_id")
    if is_credit_note:
        if {"credited_invoice_number", "supplier", "supplier_eik", "document_type"} & set(update_data):
            number = update_data.get("credited_invoice_number", existing.get("credited_invoice_number"))
            update_data["credited_invoice_number"] = (number or "").strip() or None
            target = await find_credited_invoice(scope, {
                "supplier": update_data.get("supplier", existing.get("supplier")),
                "supplier_eik": update_data.get("supplier_eik", existing.get("supplier_eik")),
                "credited_invoice_number": update_data["credited_invoice_number"],
            })
            update_data["credited_invoice_id"] = target["id"] if target else None
    else:
        update_data.pop("credited_invoice_number", None)
        if old_type == CREDIT_NOTE:
            update_data.update({"credited_invoice_number": None, "credited_invoice_id": None})

    # Newly switched to reverse charge and no протокол yet - assign one,
    # same as on create.
    if update_data.get("vat_treatment") == VatTreatment.REVERSE_CHARGE and not existing.get("protocol_number"):
        protocol_year = update_data.get("date", existing["date"]).year
        update_data["protocol_number"] = await next_protocol_number(
            company_id, current_user.user_id, protocol_year
        )

    # The invoice's price history and alerts follow its header: a corrected
    # supplier, number or date must not leave them pointing at the old one.
    header = {
        "supplier": update_data.get("supplier", existing.get("supplier", "")),
        "invoice_number": update_data.get("invoice_number", existing.get("invoice_number", "")),
        "date": update_data.get("date", existing["date"]),
    }
    if company_id:
        header_changes = {k: update_data[k] for k in ("supplier", "invoice_number", "date") if k in update_data}
        if header_changes:
            await resync_invoice_header(company_id, invoice_id, header_changes)

    # Correcting one or more already-saved line items - the real incident
    # this guards against: OCR (or a fat-fingered manual entry) read a
    # 6-pack as "1 бр.", so the per-unit price looked 6x higher than it
    # actually is and fired a bogus price-change alert. Only the items
    # named by id are touched; every other item on the invoice is left
    # exactly as it was.
    if update_data.get("items"):
        existing_items_by_id = {it["id"]: it for it in (existing.get("items") or [])}
        merged_items = list(existing.get("items") or [])
        for i, it in enumerate(merged_items):
            upd = next((u for u in update_data["items"] if u["id"] == it["id"]), None)
            if not upd:
                continue
            old_item = existing_items_by_id[it["id"]]
            merged = dict(it)
            if upd.get("name") is not None:
                merged["name"] = upd["name"]
            if upd.get("quantity") is not None:
                merged["quantity"] = upd["quantity"]
            if upd.get("unit") is not None:
                merged["unit"] = upd["unit"]
            if upd.get("unit_price") is not None:
                merged["unit_price"] = upd["unit_price"]
            # Same total_price/vat_amount formula create_invoice uses - an
            # edited line shouldn't leave its own total stale.
            merged["total_price"] = round(merged["quantity"] * merged["unit_price"], 2)
            merged["vat_amount"] = round(merged["total_price"] * 0.2, 2)
            merged_items[i] = merged

            # Re-derive this line's price history and its alert from the
            # corrected values - otherwise the wrong per-unit price keeps
            # poisoning every future comparison and its bogus alert stays.
            # (A credit note's lines have no price history to correct.)
            if company_id and not is_credit_note:
                await resync_invoice_line(
                    company_id, invoice_id, header["supplier"], header["invoice_number"], header["date"],
                    old_item, merged,
                )
                # A pack re-read as pieces is remembered for this supplier
                # and item; the same correction undone is forgotten.
                learned = detect_pack_multiple(
                    old_item.get("quantity"), old_item.get("unit_price"), merged["quantity"], merged["unit_price"]
                )
                undone = detect_pack_multiple(
                    merged["quantity"], merged["unit_price"], old_item.get("quantity"), old_item.get("unit_price")
                )
                if learned:
                    await learn_pack_rule(company_id, header["supplier"], merged["name"], learned, "invoice_edit")
                elif undone:
                    item_key, _ = await normalize_item_name(merged["name"], company_id)
                    if await get_pack_rule(company_id, header["supplier"], item_key) == undone:
                        await forget_pack_rule(company_id, header["supplier"], merged["name"])
        update_data["items"] = merged_items

    # Existence was already confirmed above via `existing` - modified_count
    # being 0 here just means the new values matched the old ones (e.g.
    # re-saving unchanged fields), not that the invoice is missing.
    await server.db.invoices.update_one(
        {"id": invoice_id, **scope},
        {"$set": update_data}
    )

    invoice = await server.db.invoices.find_one({"id": invoice_id}, {"_id": 0})

    # What credit notes took off, recounted on both sides of any change.
    if is_credit_note or old_type == CREDIT_NOTE:
        for target_id in {old_target, (invoice or {}).get("credited_invoice_id")} - {None}:
            await settle_credited_invoice(target_id, scope)
    if invoice and not is_credit_note:
        await settle_credited_invoice(invoice_id, scope)
        await link_waiting_credit_notes(scope, invoice)
        invoice = await server.db.invoices.find_one({"id": invoice_id}, {"_id": 0})

    # Its lines follow its type: a credit note's never stand as purchase
    # prices; an invoice it was turned back into gets them back.
    if company_id and invoice and new_type != old_type:
        if is_credit_note:
            await purge_invoice_price_data(company_id, invoice_id)
        else:
            await rebuild_invoice_price_history(company_id, invoice)

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="update",
        entity_type="invoice",
        entity_id=invoice_id,
        company_id=company_id,
        details={k: v for k, v in update_data.items() if k != "date"}
    )
    await maintain_quietly(company_id, {"user_id": current_user.user_id, "user_name": current_user.name})

    return Invoice(**invoice)

@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_invoices")
    company_id, scope = await get_company_scope(current_user)
    invoice = await server.db.invoices.find_one({"id": invoice_id, **scope}, {"_id": 0})
    result = await server.db.invoices.delete_one({"id": invoice_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    if company_id:
        await purge_invoice_price_data(company_id, invoice_id)
    if invoice and invoice.get("document_type") == CREDIT_NOTE:
        # Its invoice is owed again what it took off.
        await settle_credited_invoice(invoice.get("credited_invoice_id"), scope)
    elif invoice:
        # Credit notes to it wait for it again (restored, it picks them up).
        await server.db.invoices.update_many(
            {**scope, "credited_invoice_id": invoice_id}, {"$set": {"credited_invoice_id": None}},
        )
    if invoice and invoice.get("asset_id"):
        # The asset stays; it just no longer points at a purchase invoice.
        await server.db.assets.update_one(
            {"id": invoice["asset_id"], "invoice_id": invoice_id}, {"$set": {"invoice_id": None, "invoice_label": None}},
        )

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="delete",
        entity_type="invoice",
        entity_id=invoice_id,
        company_id=company_id,
        # invoice_snapshot keeps the full document (not just the display
        # summary below) so a holder of restore_deleted_data can undo an
        # accidental delete from the audit log - see restore_audit_entry.
        details={
            "supplier": invoice.get("supplier"), "invoice_number": invoice.get("invoice_number"),
            "total_amount": invoice.get("total_amount"),
            "invoice_snapshot": invoice, "restored": False,
        } if invoice else None
    )

    return {"message": "Фактурата е изтрита"}

async def _restore_record(log_entry: dict, details: dict, company_id: str, current_user: User) -> dict:
    """Puts back a deleted off-book expense or payroll entry from the full
    record kept on its delete entry - into the same company, once."""
    snapshot = details.get("snapshot")
    if not snapshot or not snapshot.get("id"):
        raise HTTPException(status_code=400, detail="Няма запазени данни за възстановяване на този запис")
    kind = log_entry["entity_type"]
    collection = server.db.expenses if kind == "expense" else server.db.payroll_entries
    if await collection.find_one({"id": snapshot["id"]}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Записът вече съществува")
    doc = {**snapshot, "company_id": company_id}
    if kind == "expense" and details.get("replaced_by_invoice"):
        # Put back on purpose although an invoice paid the same month: a
        # cost of its own now, no longer that recurring expense's month
        # (tied to it, the invoice would replace it again).
        doc.update({"recurring_id": None, "recurring_month": None})
    if kind == "payroll" and await server.db.payroll_entries.find_one({
        "employee_id": doc.get("employee_id"), "period_year": doc.get("period_year"), "period_month": doc.get("period_month"),
    }, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Вече има ведомост за този служител за този месец")
    await collection.insert_one(dict(doc))
    await server.db.audit_logs.update_one({"id": log_entry["id"]}, {"$set": {"details.restored": True}})
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="restore",
        entity_type=kind, entity_id=snapshot["id"], company_id=company_id,
        details={k: v for k, v in details.items() if k not in ("snapshot", "restored")},
    )
    return {"message": "Разходът е възстановен" if kind == "expense" else "Ведомостта е възстановена"}


async def _restore_issued_document(log_entry: dict, details: dict, company_id: str, scope: dict, current_user: User) -> dict:
    """An issued invoice or credit note deleted by mistake, back with its
    own number (while no later document took it) and its receivable; a
    credit note takes its amount off its invoice again."""
    from routers.receivables import _apply_credit

    snapshot = dict(details.get("snapshot") or {})
    if not snapshot.get("id"):
        raise HTTPException(status_code=400, detail="Няма запазени данни за възстановяване на този документ")
    if await server.db.billing_documents.find_one({"id": snapshot["id"]}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Документът вече съществува")
    try:
        await server.db.billing_documents.insert_one(dict(snapshot))
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail=f"№ {snapshot.get('invoice_number')} вече е на нов документ - този не може да се върне със същия номер",
        )
    receivable = details.get("receivable_snapshot")
    if receivable and not await server.db.receivables.find_one({"id": receivable.get("id")}, {"_id": 1}):
        await server.db.receivables.insert_one(dict(receivable))
    if snapshot.get("doc_type") == "credit_note" and snapshot.get("credited_document_id") and not snapshot.get("cancelled"):
        invoice = await server.db.billing_documents.find_one(
            {"id": snapshot["credited_document_id"], **scope}, {"_id": 0, "id": 1, "receivable_id": 1},
        )
        if invoice:
            await _apply_credit(scope, invoice, abs(float(snapshot.get("total_amount") or 0)))
    await server.db.audit_logs.update_one({"id": log_entry["id"]}, {"$set": {"details.restored": True}})
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="restore",
        entity_type=log_entry["entity_type"], entity_id=snapshot["id"], company_id=company_id,
        details={"invoice_number": snapshot.get("invoice_number"), "customer_name": snapshot.get("customer_name"),
                 "total_amount": snapshot.get("total_amount")},
    )
    return {"message": "Документът е възстановен"}


@router.post("/audit-logs/{log_id}/restore")
async def restore_audit_entry(log_id: str, current_user: User = Depends(get_current_user)):
    """Restores an invoice deleted earlier, from the full snapshot kept on
    its own audit log entry. Deliberately separate from manage_invoices -
    undoing someone else's delete (possibly days later) is a sensitive,
    infrequent admin action, not routine invoice work, so it is gated on
    its own permission the owner grants explicitly (see restore_deleted_data
    in ROLE_PERMISSIONS)."""
    require_permission(current_user, "restore_deleted_data")
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")

    log_entry = await server.db.audit_logs.find_one({"id": log_id, "company_id": company_id})
    if not log_entry:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    restorable_types = ("invoice", "expense", "payroll", "issued_invoice", "issued_credit_note")
    if log_entry.get("action") != "delete" or log_entry.get("entity_type") not in restorable_types:
        raise HTTPException(status_code=400, detail="Това действие не може да бъде възстановено")

    details = log_entry.get("details") or {}
    if details.get("restored"):
        raise HTTPException(status_code=400, detail="Вече е възстановена")
    if log_entry["entity_type"] in ("expense", "payroll"):
        return await _restore_record(log_entry, details, company_id, current_user)
    if log_entry["entity_type"] in ("issued_invoice", "issued_credit_note"):
        return await _restore_issued_document(log_entry, details, company_id, scope, current_user)
    snapshot = details.get("invoice_snapshot")
    if not snapshot:
        raise HTTPException(status_code=400, detail="Няма запазени данни за възстановяване на тази фактура")

    if await server.db.invoices.find_one({"id": snapshot["id"]}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Вече съществува фактура с това ID")

    snapshot = dict(snapshot)
    # A snapshot taken before invoice dates were kept as business days
    # comes back as one, like every invoice saved today.
    for field in ("date", "payment_due_date"):
        if snapshot.get(field):
            snapshot[field] = stored_day(snapshot[field])
    # Back on its asset only if that asset still has no other invoice.
    if snapshot.get("asset_id"):
        relinked = await server.db.assets.update_one(
            {"id": snapshot["asset_id"], "company_id": company_id, "invoice_id": None},
            {"$set": {"invoice_id": snapshot["id"],
                      "invoice_label": f"{snapshot.get('supplier') or ''} № {snapshot.get('invoice_number') or ''}".strip()}},
        )
        if not relinked.modified_count:
            snapshot["asset_id"] = None
    await server.db.invoices.insert_one(dict(snapshot))
    await rebuild_invoice_price_history(company_id, snapshot)
    if snapshot.get("document_type") == CREDIT_NOTE:
        await settle_credited_invoice(snapshot.get("credited_invoice_id"), scope)
    else:
        await link_waiting_credit_notes(scope, snapshot)
    await server.db.audit_logs.update_one({"id": log_id}, {"$set": {"details.restored": True}})

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="restore",
        entity_type="invoice",
        entity_id=snapshot.get("id"),
        company_id=company_id,
        details={"supplier": snapshot.get("supplier"), "invoice_number": snapshot.get("invoice_number"), "total_amount": snapshot.get("total_amount")}
    )

    return {"message": "Фактурата е възстановена"}

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

router = APIRouter(prefix="/api")

@router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice: InvoiceCreate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_invoices")
    # Get user's company_id
    company_id, _ = await get_company_scope(current_user)

    # Merge with an already-known counterparty regardless of punctuation or
    # letter case, so this also applies to manually-typed/edited invoices,
    # not just ones that came straight out of OCR.
    normalized_supplier, _ = await normalize_supplier_name(invoice.supplier, company_id)
    invoice.supplier = normalized_supplier

    # Check for duplicate invoice
    if company_id:
        # If user has a company, check across all company users
        company_users = await server.db.users.find({"company_id": company_id}, {"user_id": 1}).to_list(1000)
        company_user_ids = [u["user_id"] for u in company_users]
        
        existing_invoice = await server.db.invoices.find_one({
            "user_id": {"$in": company_user_ids},
            "invoice_number": invoice.invoice_number,
            "supplier": {"$regex": f"^{re.escape(invoice.supplier)}$", "$options": "i"}
        }, {"_id": 0, "id": 1, "date": 1, "user_id": 1})
        
        if existing_invoice:
            # Find who added the duplicate
            added_by_user = await server.db.users.find_one({"user_id": existing_invoice["user_id"]}, {"name": 1})
            added_by_name = added_by_user.get("name", "друг потребител") if added_by_user else "друг потребител"
            raise HTTPException(
                status_code=409,
                detail=f"Фактура с номер {invoice.invoice_number} от {invoice.supplier} вече е добавена от {added_by_name}!"
            )
    else:
        # No company - check only for current user
        existing_invoice = await server.db.invoices.find_one({
            "user_id": current_user.user_id,
            "invoice_number": invoice.invoice_number,
            "supplier": {"$regex": f"^{re.escape(invoice.supplier)}$", "$options": "i"}
        }, {"_id": 0, "id": 1, "date": 1})
        
        if existing_invoice:
            raise HTTPException(
                status_code=409,
                detail=f"Фактура с номер {invoice.invoice_number} от {invoice.supplier} вече съществува в системата!"
            )
    
    invoice_dict = invoice.model_dump()
    invoice_date = datetime.fromisoformat(invoice_dict["date"].replace("Z", "+00:00"))

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
    if invoice_dict.get("payment_method") == "cash":
        is_paid = True
        paid_amount = invoice_dict.get("total_amount", 0)
        paid_at = invoice_date
    elif invoice_dict.get("payment_method") == "bank_transfer":
        if invoice_dict.get("payment_due_date"):
            payment_due_date = datetime.fromisoformat(invoice_dict["payment_due_date"].replace("Z", "+00:00"))
        else:
            payment_due_date = invoice_date + timedelta(days=14)

    # Reverse-charge purchases (services from abroad, ВОП...) need a
    # self-billing протокол по чл.117 ЗДДС, issued within 15 days of the
    # tax point - assign the next sequential number automatically so
    # nobody has to track this by hand.
    if invoice_dict.get("vat_treatment") == VatTreatment.REVERSE_CHARGE:
        invoice_dict["protocol_number"] = await next_protocol_number(company_id, current_user.user_id, invoice_date.year)

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
            if applied:
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

            if company_id and alert_settings:
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
        **{k: v for k, v in invoice_dict.items() if k not in ["date", "items", "payment_due_date"]}
    )
    await server.db.invoices.insert_one(invoice_obj.model_dump())

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
        {"_id": 0, "id": 1, "total_amount": 1, "supplier": 1, "invoice_number": 1},
    ).to_list(len(body.invoice_ids))
    for inv in invoices:
        await server.db.invoices.update_one(
            {**scope, "id": inv["id"]},
            {"$set": {"is_paid": True, "paid_amount": inv.get("total_amount", 0), "paid_at": now}},
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
        pattern = {"$regex": re.escape(search), "$options": "i"}
        query["$or"] = [{"supplier": pattern}, {"invoice_number": pattern}]
    if start_date:
        query["date"] = {"$gte": datetime.fromisoformat(start_date.replace("Z", "+00:00"))}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        else:
            query["date"] = {"$lte": datetime.fromisoformat(end_date.replace("Z", "+00:00"))}
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
        query["payment_due_date"] = {"$lt": datetime.now(timezone.utc)}

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

    invoices = await server.db.invoices.find(query, {"_id": 0, "image_base64": 0, "image_base64s": 0}).sort("date", -1).to_list(1000)
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
        update_data["date"] = datetime.fromisoformat(update_data["date"].replace("Z", "+00:00"))
    if "payment_due_date" in update_data:
        update_data["payment_due_date"] = datetime.fromisoformat(update_data["payment_due_date"].replace("Z", "+00:00"))

    company_id, scope = await get_company_scope(current_user)
    existing = await server.db.invoices.find_one({"id": invoice_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")

    # Same auto-paid/due-date rules as on create, so switching an invoice's
    # payment method later behaves the same as picking it up front.
    cash_auto_paid = (
        update_data.get("payment_method") == "cash"
        and "is_paid" not in update_data
        and "paid_amount" not in update_data
    )
    if cash_auto_paid:
        update_data["is_paid"] = True
        update_data["paid_amount"] = update_data.get("total_amount", existing.get("total_amount", 0))
        update_data["paid_at"] = update_data.get("date", existing["date"])  # paid on the spot, at invoice date
    if update_data.get("payment_method") == "bank_transfer" and "payment_due_date" not in update_data and not existing.get("payment_due_date"):
        update_data["payment_due_date"] = update_data.get("date", existing["date"]) + timedelta(days=14)

    if "paid_amount" in update_data and not cash_auto_paid:
        # paid_amount is the source of truth for payment progress once
        # given - it drives is_paid/paid_at, not the other way round, so a
        # partial payment (0 < paid_amount < total) always shows is_paid as
        # False with the exact remaining balance recoverable as
        # total_amount - paid_amount (see /statistics/summary's use of it).
        effective_total = update_data.get("total_amount", existing.get("total_amount", 0))
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
    elif "is_paid" in update_data and not cash_auto_paid:
        # Ticking "is_paid" directly (the quick mark-fully-paid/unpaid
        # toggle, without keying in an exact amount) keeps paid_amount
        # consistent with it, and stamps/clears paid_at to "now" - when the
        # user actually confirmed the payment.
        update_data["paid_at"] = datetime.now(timezone.utc) if update_data["is_paid"] else None
        update_data["paid_amount"] = (
            update_data.get("total_amount", existing.get("total_amount", 0))
            if update_data["is_paid"] else 0.0
        )

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
            if company_id:
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

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="update",
        entity_type="invoice",
        entity_id=invoice_id,
        company_id=company_id,
        details={k: v for k, v in update_data.items() if k != "date"}
    )

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

@router.post("/audit-logs/{log_id}/restore")
async def restore_audit_entry(log_id: str, current_user: User = Depends(get_current_user)):
    """Restores an invoice deleted earlier, from the full snapshot kept on
    its own audit log entry. Deliberately separate from manage_invoices -
    undoing someone else's delete (possibly days later) is a sensitive,
    infrequent admin action, not routine invoice work, so it is gated on
    its own permission the owner grants explicitly (see restore_deleted_data
    in ROLE_PERMISSIONS)."""
    require_permission(current_user, "restore_deleted_data")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")

    log_entry = await server.db.audit_logs.find_one({"id": log_id, "company_id": company_id})
    if not log_entry:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    if log_entry.get("action") != "delete" or log_entry.get("entity_type") != "invoice":
        raise HTTPException(status_code=400, detail="Това действие не може да бъде възстановено")

    details = log_entry.get("details") or {}
    if details.get("restored"):
        raise HTTPException(status_code=400, detail="Вече е възстановена")
    snapshot = details.get("invoice_snapshot")
    if not snapshot:
        raise HTTPException(status_code=400, detail="Няма запазени данни за възстановяване на тази фактура")

    if await server.db.invoices.find_one({"id": snapshot["id"]}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Вече съществува фактура с това ID")

    await server.db.invoices.insert_one(dict(snapshot))
    await rebuild_invoice_price_history(company_id, snapshot)
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

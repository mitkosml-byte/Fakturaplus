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
    
    invoice_dict = invoice.dict()
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

    # Process items and convert to dict format
    items_list = None
    price_alerts = []
    item_normalized_names = {}  # item_dict["id"] -> normalized_name, reused below when backfilling invoice_id

    if invoice.items:
        items_list = []
        for item in invoice.items:
            item_dict = item.dict()
            # Calculate total_price if not provided
            if item_dict.get("total_price") is None:
                item_dict["total_price"] = item_dict["quantity"] * item_dict["unit_price"]
            # Calculate VAT if not provided (20%)
            if item_dict.get("vat_amount") is None:
                item_dict["vat_amount"] = item_dict["total_price"] * 0.2

            item_dict["id"] = str(uuid.uuid4())
            items_list.append(item_dict)

            # A negative-priced row is a discount/rebate line ("отстъпка"),
            # not a product with its own trackable price - skip price-change
            # alerts and price history for it so it doesn't get compared
            # against (or pollute) a real item's price trend.
            if company_id and item.unit_price >= 0:
                normalized_name, _ = await normalize_item_name(item.name, company_id)
                item_normalized_names[item_dict["id"]] = normalized_name

                # Baseline = median of the last up-to-3 purchases of this item
                # from this supplier, not just the single last one - a lone
                # one-off (a misread, a rush order, a one-time discount) used
                # to become "the price" and make the *next* normal purchase
                # look like the anomaly.
                recent_records = await server.db.item_price_history.find(
                    {
                        "company_id": company_id,
                        "supplier": {"$regex": f"^{re.escape(invoice.supplier)}$", "$options": "i"},
                        "item_name": normalized_name
                    },
                    {"_id": 0},
                    sort=[("invoice_date", -1)]
                ).to_list(3)

                # Get threshold/mute settings
                alert_settings = await server.db.price_alert_settings.find_one(
                    {"company_id": company_id},
                    {"_id": 0}
                )
                threshold = alert_settings.get("threshold_percent", 10.0) if alert_settings else 10.0
                min_absolute_change = alert_settings.get("min_absolute_change", 2.0) if alert_settings else 2.0
                alert_on_decrease = alert_settings.get("alert_on_decrease", False) if alert_settings else False
                alert_enabled = alert_settings.get("enabled", True) if alert_settings else True

                is_muted = alert_enabled and bool(await server.db.price_alert_mutes.find_one({
                    "company_id": company_id,
                    "item_name": normalized_name,
                    "supplier": {"$regex": f"^{re.escape(invoice.supplier)}$", "$options": "i"},
                }))

                if recent_records and alert_enabled and not is_muted:
                    old_price = statistics.median(r["unit_price"] for r in recent_records)
                    new_price = item.unit_price

                    if old_price > 0:
                        change_percent = ((new_price - old_price) / old_price) * 100
                        absolute_change = abs(new_price - old_price)
                        crosses_threshold = (
                            (change_percent >= threshold) or
                            (alert_on_decrease and change_percent <= -threshold)
                        )

                        if crosses_threshold and absolute_change >= min_absolute_change:
                            alert = PriceAlert(
                                company_id=company_id,
                                item_name=item.name,
                                supplier=invoice.supplier,
                                old_price=round(old_price, 4),
                                new_price=new_price,
                                change_percent=round(change_percent, 2),
                                direction="increase" if change_percent >= 0 else "decrease",
                                baseline_purchase_count=len(recent_records),
                                invoice_id="",  # Will be set after invoice is created
                                invoice_number=invoice.invoice_number
                            )
                            price_alerts.append(alert)
                
                # Save to price history
                price_history = ItemPriceHistory(
                    company_id=company_id,
                    supplier=invoice.supplier,
                    item_name=normalized_name,
                    unit_price=item.unit_price,
                    quantity=item.quantity,
                    unit=item.unit,
                    invoice_id="",  # Will be set after invoice is created
                    invoice_number=invoice.invoice_number,
                    invoice_date=invoice_date
                )
                await server.db.item_price_history.insert_one(price_history.dict())
    
    invoice_obj = Invoice(
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
    await server.db.invoices.insert_one(invoice_obj.dict())
    
    # Update price history and alerts with invoice_id
    if company_id and invoice.items:
        for item_dict in items_list:
            normalized_name = item_normalized_names.get(item_dict["id"], item_dict["name"].strip().lower())
            await server.db.item_price_history.update_many(
                {
                    "company_id": company_id,
                    "invoice_number": invoice.invoice_number,
                    "item_name": normalized_name,
                    "invoice_id": ""
                },
                {"$set": {"invoice_id": invoice_obj.id}}
            )
        
        # Save alerts with invoice_id
        for alert in price_alerts:
            alert.invoice_id = invoice_obj.id
            await server.db.price_alerts.insert_one(alert.dict())

        if price_alerts:
            background_tasks.add_task(send_price_alert_pushes, company_id, price_alerts)

        # Keep raw-material grouping fresh automatically, without the user
        # having to trigger it - throttled inside the task itself.
        background_tasks.add_task(maybe_schedule_ai_item_merge, company_id)

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
    update_data = {k: v for k, v in invoice_update.dict().items() if v is not None}
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

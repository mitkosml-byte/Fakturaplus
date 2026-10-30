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

@router.post("/ocr/scan", response_model=OCRResult)
@limiter.limit("20/minute")
async def scan_invoice(request: Request, image_base64: Optional[str] = None, current_user: User = Depends(get_current_user)):
    # OCR only ever feeds a draft into POST /invoices (which already
    # requires manage_invoices) - gating the scan itself too means a member
    # without that permission can't burn the company's shared, paid scan
    # credits on a result they could never save anyway.
    require_permission(current_user, "manage_invoices")
    if not server.AI_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="AI разпознаването временно не е налично. Моля, въведете данните ръчно.")

    body = await request.json()
    # Multi-page capture sends a list; a single legacy image still sends
    # the singular field - normalize both into one ordered list of pages.
    images_data: List[str] = body.get("image_base64s") or []
    if not images_data:
        single = body.get("image_base64", "")
        if single:
            images_data = [single]

    if not images_data:
        raise HTTPException(status_code=400, detail="Липсва изображение")

    MAX_OCR_PAGES = 6
    if len(images_data) > MAX_OCR_PAGES:
        raise HTTPException(status_code=400, detail=f"Твърде много страници (макс. {MAX_OCR_PAGES}).")

    # Reject oversized images before they're decoded and forwarded to the
    # Anthropic API - otherwise a single request can exhaust server memory
    # on decode and amplify AI API cost with no real invoice-photo use case
    # ever needing more than this. Base64 is ~4/3 the size of the raw
    # bytes, so this caps each decoded page at roughly 10MB.
    MAX_OCR_IMAGE_BASE64_CHARS = 14_000_000

    image_blocks = []
    for raw in images_data:
        page_data = raw
        media_type = "image/jpeg"
        if page_data.startswith("data:") and "," in page_data:
            header, page_data = page_data.split(",", 1)
            header_match = re.match(r"data:([^;]+);base64", header)
            if header_match:
                media_type = header_match.group(1)
        elif "," in page_data:
            page_data = page_data.split(",")[1]

        if len(page_data) > MAX_OCR_IMAGE_BASE64_CHARS:
            raise HTTPException(status_code=413, detail="Изображението е твърде голямо. Моля, използвайте по-малка снимка (до ~10MB на страница).")

        image_blocks.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": page_data}
        })

    # Get company_id for supplier matching
    company_id, _ = await get_company_scope(current_user)

    # Scan-credit gate - the one real variable cost in the whole app (see
    # SCAN CREDITS below). Checked before the AI call is made, not after,
    # so a company with an empty balance never triggers (and never pays
    # for) the expensive part of this endpoint. Skipped entirely while
    # SCAN_CREDITS_ENFORCED is off (see its own comment above).
    if SCAN_CREDITS_ENFORCED and not await scan_credit_service.has_scans_remaining(company_id, current_user.user_id):
        raise HTTPException(
            status_code=402,
            detail="Нямате оставащи сканирания. Купете пакет, за да продължите.",
        )

    prompt_text = (
        "Извлечи всички данни от тази фактура: доставчика (не получателя!), ЕИК ако е видим, номер, дата, суми и ВСИЧКИ редове от таблицата с артикули."
        if len(image_blocks) == 1 else
        f"Изображенията по-горе са {len(image_blocks)} последователни страници на ЕДНА фактура. Извлечи всички данни от нея: доставчика (не получателя!), ЕИК ако е видим, номер, дата, сумите от последната страница и ВСИЧКИ редове от таблицата с артикули, обединени от всички страници."
    )

    try:
        response = await anthropic_client.messages.parse(  # type: ignore[union-attr]  # guarded by the AI_FEATURES_ENABLED check above; anthropic_client is non-None whenever that is true
            model="claude-opus-5-5",
            max_tokens=8000,
            system=OCR_SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": [
                    *image_blocks,  # type: ignore[list-item]  # built as plain dicts matching ImageBlockParam's shape; the SDK's content union is stricter than a dict literal can satisfy
                    {
                        "type": "text",
                        "text": prompt_text
                    }
                ]
            }],
            output_format=ClaudeInvoiceExtraction,
        )
        await log_ai_usage(company_id, "ocr_scan", response, {"page_count": len(image_blocks)})

        extracted = response.parsed_output
        if extracted is None:
            raise HTTPException(status_code=500, detail="Не можах да разпозная фактурата")

        raw_result = extracted.model_dump()

        # Apply AI correction module (доставчик/продукти нормализиране и сливане)
        correction_result = await correct_ocr_data(raw_result, company_id)
        corrected = correction_result.corrected

        if correction_result.corrections_made:
            logger.info(f"OCR Corrections: {correction_result.corrections_made}")

        # Spend exactly one scan now that the AI call actually succeeded -
        # a failed/errored scan (any branch below) never gets charged.
        # Skipped while SCAN_CREDITS_ENFORCED is off, so the balance is
        # exactly where it was left once enforcement resumes.
        if SCAN_CREDITS_ENFORCED:
            await scan_credit_service.spend_scan(
                company_id, current_user.user_id, current_user.name,
                invoice_label=corrected.get("supplier") or None,
            )

        return OCRResult(
            supplier=corrected.get("supplier", ""),
            supplier_eik=corrected.get("supplier_eik"),
            invoice_number=corrected.get("invoice_number", ""),
            amount_without_vat=float(corrected.get("amount_without_vat", 0)),
            vat_amount=float(corrected.get("vat_amount", 0)),
            total_amount=float(corrected.get("total_amount", 0)),
            invoice_date=corrected.get("invoice_date"),
            payment_due_date=corrected.get("payment_due_date"),
            items=[OCRItemResult(**item) for item in corrected.get("items", [])],
            corrections=correction_result.corrections_made,
            confidence=correction_result.confidence
        )

    except HTTPException:
        raise
    except anthropic_sdk.AuthenticationError:
        logger.error("OCR Error: invalid or missing Anthropic API key")
        raise HTTPException(status_code=503, detail="AI разпознаването не е конфигурирано правилно на сървъра. Моля, въведете данните ръчно.")
    except (anthropic_sdk.RateLimitError, anthropic_sdk.OverloadedError):
        raise HTTPException(status_code=503, detail="AI услугата за разпознаване е временно претоварена. Моля, опитайте отново след малко.")
    except anthropic_sdk.PermissionDeniedError:
        # Anthropic returns 403 for a depleted/too-low credit balance on the
        # API key, not just real permission issues - this is the one case a
        # user might reasonably describe as "hit a limit", so it gets its
        # own distinct message instead of falling into the generic bucket
        # below, which is indistinguishable from a transient connectivity blip.
        logger.error("OCR Error: Anthropic API permission denied - likely a depleted/too-low credit balance")
        raise HTTPException(status_code=503, detail="AI акаунтът на приложението няма достатъчен баланс в момента. Моля, свържете се със системния администратор.")
    except anthropic_sdk.RequestTooLargeError:
        raise HTTPException(status_code=413, detail="Изображението е твърде голямо за AI услугата. Моля, използвайте по-малка снимка.")
    except anthropic_sdk.APIConnectionError:
        logger.exception("OCR Error: could not reach the Anthropic API (network/TLS)")
        raise HTTPException(status_code=502, detail="Сървърът не успя да се свърже с AI услугата (мрежов проблем). Моля, опитайте отново след малко.")
    except anthropic_sdk.APIStatusError as e:
        logger.error(f"OCR Error (API status): {e}")
        # A depleted credit balance comes back from Anthropic as a plain 400
        # invalid_request_error, not the 403 PermissionDeniedError handled
        # above - confirmed from a real production log: "Error code: 400 -
        # {'type': 'invalid_request_error', 'message': 'Your credit balance
        # is too low to access the Anthropic API...'}". Every single request
        # fails identically with this one, all day, regardless of retries -
        # unlike a transient overload - so it gets the same clear balance
        # message instead of the generic "connection error" bucket.
        if "credit balance" in str(e).lower():
            raise HTTPException(status_code=503, detail="AI акаунтът на приложението няма достатъчен баланс в момента. Моля, свържете се със системния администратор.")
        raise HTTPException(status_code=502, detail="Грешка при връзка с AI услугата за разпознаване.")
    except Exception as e:
        logger.exception("OCR Error")
        raise HTTPException(status_code=500, detail=f"Грешка при сканиране: {str(e)}")

@router.get("/scan-credits", response_model=ScanBalanceOut)
async def get_scan_credits(current_user: User = Depends(get_current_user)):
    summary = await scan_credit_service.get_balance_summary(current_user.company_id, current_user.user_id)
    return ScanBalanceOut(**summary)

@router.get("/scan-credits/forecast")
async def get_scan_credits_forecast(current_user: User = Depends(get_current_user)):
    """"At your pace, that's about N days" - Module 5's audit finding
    that the credit ledger already has what it needs to predict a
    depletion date, turning a static low-balance warning into one with
    an actual timeline."""
    return await scan_credit_service.get_depletion_forecast(current_user.company_id, current_user.user_id)

@router.get("/scan-credits/packages", response_model=List[ScanPackageOut])
async def get_scan_packages(current_user: User = Depends(get_current_user)):
    return _scan_packages_catalogue()

@router.get("/scan-credits/history", response_model=List[ScanTransactionOut])
async def get_scan_credits_history(current_user: User = Depends(get_current_user)):
    rows = await scan_credit_service.get_history(current_user.company_id, current_user.user_id)
    return [ScanTransactionOut(**row) for row in rows]

@router.get("/scan-credits/history/export")
@limiter.limit("20/minute")
async def export_scan_credits_history(request: Request, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "export_data")
    rows = await scan_credit_service.get_history(current_user.company_id, current_user.user_id)
    company_name = ""
    if current_user.company_id:
        company = await server.db.companies.find_one({"id": current_user.company_id})
        company_name = company.get("name", "") if company else ""
    excel_data = await asyncio.to_thread(ExportService.generate_scan_credits_excel, rows, company_name)
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name,
        action="export", entity_type="scan_credits_history",
        company_id=current_user.company_id, details={"format": "excel", "count": len(rows)},
    )
    filename = f"scan_credits_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

@router.post("/scan-credits/purchase/package")
@limiter.limit("10/minute")
async def purchase_scan_package(request: Request, payload: PurchasePackageRequest, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_billing")
    _require_billing_enabled()
    pkg = scan_credit_service_module.SCAN_PACKAGES.get(payload.package_id)
    if not pkg:
        raise HTTPException(status_code=400, detail="Непознат пакет")
    total_scans = pkg["paid_scans"] + pkg["bonus_scans"]
    scope_id = scan_credit_service.scope_id(current_user.company_id, current_user.user_id)

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "unit_amount": round(pkg["price_eur"] * 100),
                    "product_data": {"name": f"Фактура+ — {pkg['name']} ({total_scans} сканирания)"},
                },
                "quantity": 1,
            }],
            metadata={
                "scope_id": scope_id,
                "company_id": current_user.company_id or "",
                "user_id": current_user.user_id,
                "user_name": current_user.name,
                "purchase_type": "package",
                "package_id": payload.package_id,
                "scans": str(total_scans),
                "price_eur": str(pkg["price_eur"]),
            },
            success_url=f"{FRONTEND_URL}/scan-credits?purchase=success",
            cancel_url=f"{FRONTEND_URL}/scan-credits?purchase=cancelled",
        )
    except stripe.error.StripeError as e:
        logger.error(f"Stripe checkout session error (package): {e}")
        raise HTTPException(status_code=502, detail="Грешка при свързване с платежната система.")

    return {"checkout_url": session.url}

@router.post("/scan-credits/purchase/custom")
@limiter.limit("10/minute")
async def purchase_scan_custom(request: Request, payload: PurchaseCustomRequest, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_billing")
    _require_billing_enabled()
    price_eur = scan_credit_service_module.custom_price_eur(payload.quantity)
    scope_id = scan_credit_service.scope_id(current_user.company_id, current_user.user_id)

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "unit_amount": round(price_eur * 100),
                    "product_data": {"name": f"Фактура+ — {payload.quantity} сканирания (персонализирано)"},
                },
                "quantity": 1,
            }],
            metadata={
                "scope_id": scope_id,
                "company_id": current_user.company_id or "",
                "user_id": current_user.user_id,
                "user_name": current_user.name,
                "purchase_type": "custom",
                "scans": str(payload.quantity),
                "price_eur": str(price_eur),
            },
            success_url=f"{FRONTEND_URL}/scan-credits?purchase=success",
            cancel_url=f"{FRONTEND_URL}/scan-credits?purchase=cancelled",
        )
    except stripe.error.StripeError as e:
        logger.error(f"Stripe checkout session error (custom): {e}")
        raise HTTPException(status_code=502, detail="Грешка при свързване с платежната система.")

    return {"checkout_url": session.url}

@router.post("/scan-credits/auto-reload")
@limiter.limit("10/minute")
async def set_scan_auto_reload(request: Request, payload: AutoReloadRequest, current_user: User = Depends(get_current_user)):
    """Enabling starts a real Stripe Subscription (one real monthly charge,
    never a silent client-side flag) and returns a checkout_url the client
    must complete - the subscription only takes effect once Stripe confirms
    it via webhook. Disabling cancels the Stripe subscription immediately
    (no "at period end" grace, no confirmation step) - a one-click, no-
    questions-asked stop is the whole point: see the pricing conversation
    this was built from."""
    require_permission(current_user, "manage_billing")

    if not payload.enabled:
        subscription_id = await scan_credit_service.get_auto_reload_subscription_id(current_user.company_id, current_user.user_id)
        if subscription_id and BILLING_ENABLED:
            try:
                stripe.Subscription.cancel(subscription_id)
            except stripe.error.StripeError as e:
                logger.error(f"Stripe subscription cancel error: {e}")
        await scan_credit_service.set_auto_reload(current_user.company_id, current_user.user_id, enabled=False)
        await audit_service.log_action(
            user_id=current_user.user_id, user_name=current_user.name,
            action="disable", entity_type="scan_auto_reload", company_id=current_user.company_id,
        )
        return {"auto_reload_enabled": False}

    _require_billing_enabled()
    pkg = scan_credit_service_module.SCAN_PACKAGES.get(payload.package_id)
    if not pkg:
        raise HTTPException(status_code=400, detail="Непознат пакет")
    total_scans = pkg["paid_scans"] + pkg["bonus_scans"]
    scope_id = scan_credit_service.scope_id(current_user.company_id, current_user.user_id)

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "eur",
                    "unit_amount": round(pkg["price_eur"] * 100),
                    "recurring": {"interval": "month"},
                    "product_data": {"name": f"Фактура+ — автоматично презареждане ({pkg['name']}, {total_scans} сканирания/месец)"},
                },
                "quantity": 1,
            }],
            metadata={
                "scope_id": scope_id,
                "company_id": current_user.company_id or "",
                "user_id": current_user.user_id,
                "user_name": current_user.name,
                "purchase_type": "auto_reload_setup",
                "package_id": payload.package_id,
                "scans": str(total_scans),
                "price_eur": str(pkg["price_eur"]),
            },
            success_url=f"{FRONTEND_URL}/scan-credits?auto_reload=success",
            cancel_url=f"{FRONTEND_URL}/scan-credits?auto_reload=cancelled",
        )
    except stripe.error.StripeError as e:
        logger.error(f"Stripe subscription checkout error: {e}")
        raise HTTPException(status_code=502, detail="Грешка при свързване с платежната система.")

    return {"checkout_url": session.url}

@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    """Server-authoritative confirmation of a payment - this is the ONLY
    code path anywhere that is allowed to credit purchased scan balance.
    Never trust a plain "my payment succeeded" claim from an
    authenticated-user endpoint instead of this signature-verified one;
    that would let anyone grant themselves free scans by replaying or
    forging the request."""
    if not BILLING_ENABLED:
        raise HTTPException(status_code=503, detail="Billing not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        logger.error("Stripe webhook: invalid payload or signature")
        raise HTTPException(status_code=400, detail="Invalid signature")

    # Idempotency - Stripe redelivers events on any non-2xx response or
    # timeout, so the exact same event id can arrive more than once. This
    # must be checked before any balance mutation, not after.
    first_time = await scan_credit_service.mark_webhook_event_processed(event["id"])
    if not first_time:
        return {"status": "already_processed"}

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        metadata = data.get("metadata") or {}
        purchase_type = metadata.get("purchase_type")
        company_id = metadata.get("company_id") or None
        user_id = metadata.get("user_id")
        user_name = metadata.get("user_name", "")

        if purchase_type in ("package", "custom") and user_id:
            scans = int(metadata.get("scans", 0))
            price_eur = float(metadata.get("price_eur", 0))
            label = (
                f"Пакет „{scan_credit_service_module.SCAN_PACKAGES[metadata['package_id']]['name']}“"
                if purchase_type == "package" and metadata.get("package_id") in scan_credit_service_module.SCAN_PACKAGES
                else f"Персонализирана покупка ({scans} сканирания)"
            )
            await scan_credit_service.credit_purchase(
                company_id, user_id, user_name, scans=scans, description=label,
                price_eur=price_eur, payment_reference=data.get("id"),
            )
        elif purchase_type == "auto_reload_setup" and user_id:
            # The Checkout Session itself only sets up the subscription;
            # the recurring credit for THIS first period comes from the
            # matching invoice.payment_succeeded event below, same as
            # every later month - so this branch only records which
            # subscription now backs the auto-reload toggle.
            subscription_id = data.get("subscription")
            await scan_credit_service.set_auto_reload(
                company_id, user_id, enabled=True,
                package_id=metadata.get("package_id"), subscription_id=subscription_id,
            )
            await audit_service.log_action(
                user_id=user_id, user_name=user_name, action="enable",
                entity_type="scan_auto_reload", company_id=company_id,
                details={"package_id": metadata.get("package_id")},
            )

    elif event_type == "invoice.payment_succeeded":
        subscription_id = data.get("subscription")
        if subscription_id:
            balance_doc = await server.db.scan_balances.find_one({"auto_reload_subscription_id": subscription_id})
            if balance_doc and balance_doc.get("auto_reload_enabled"):
                package_id = balance_doc.get("auto_reload_package_id")
                pkg = scan_credit_service_module.SCAN_PACKAGES.get(package_id)
                if pkg:
                    total_scans = pkg["paid_scans"] + pkg["bonus_scans"]
                    doc_company_id = balance_doc.get("company_id")
                    # credit_purchase only uses user_id to derive the scope
                    # when there's no company_id (see ScanCreditService.scope_id) -
                    # recover the original one from the balance doc's own
                    # _id in that case so the credit lands back on the same
                    # scope it came from.
                    doc_user_id = "" if doc_company_id else balance_doc["_id"].replace("user:", "", 1)
                    await scan_credit_service.credit_purchase(
                        doc_company_id, doc_user_id, "Автоматично презареждане",
                        scans=total_scans,
                        description=f"Автоматично презареждане — {pkg['name']}",
                        price_eur=pkg["price_eur"], payment_reference=data.get("id"),
                    )

    elif event_type == "customer.subscription.deleted":
        subscription_id = data.get("id")
        balance_doc = await server.db.scan_balances.find_one({"auto_reload_subscription_id": subscription_id})
        if balance_doc:
            await server.db.scan_balances.update_one(
                {"_id": balance_doc["_id"]},
                {"$set": {"auto_reload_enabled": False, "auto_reload_package_id": None, "auto_reload_subscription_id": None}},
            )

    return {"status": "ok"}

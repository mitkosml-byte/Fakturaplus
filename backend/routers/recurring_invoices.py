"""Invoices that repeat (Н7): a subscription, a rent, a monthly service -
the same customer and lines each month. On its day the month's invoice is
ready: looked at and issued with one tap, through the same code as any
invoice (its number in sequence, revenue and VAT on its date, a debt to
collect when paid by bank). Nothing is issued by itself.

One invoice a month: the issued invoice itself names the repeating invoice
and the month (recurring_invoice_id, recurring_month), and issuing takes
the month first (a claim on the template), so a second tap, a second
device or a retry never issues the month twice. A month whose invoice was
cancelled can be issued again.

"{месец}" in a line or in the notes becomes the month ("Абонамент за
{месец}" - "Абонамент за ноември 2026")."""
import calendar

from fastapi import APIRouter
from server import *
import server
from routers.locations import require_location

from routers.receivables import _create_issued_invoice

router = APIRouter(prefix="/api")

# A claim on a month whose invoice was never made (a crash mid-issue) is freed after this long.
CLAIM_MINUTES = 5
_MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"]
_MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"

# The month's invoices of each template that stand: (template id, month) -> document.
Issued = Dict[Tuple[str, str], dict]


class RecurringInvoiceCreate(BaseModel):
    # Made from an invoice already issued: its customer, lines and payment.
    from_document_id: Optional[str] = None
    customer_id: Optional[str] = None
    customer_name: Optional[str] = Field(default=None, max_length=200)
    customer_eik: Optional[str] = Field(default=None, max_length=20)
    customer_address: Optional[str] = Field(default=None, max_length=300)
    items: Optional[List[BillingDocumentItem]] = Field(default=None, max_length=50)
    notes: Optional[str] = Field(default=None, max_length=1000)
    payment_method: Optional[Literal["cash", "bank_transfer", "card"]] = None
    # The day of the month it is issued (31: the month's last day).
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    # Days from issue to the due date (paid by bank); left out, INVOICE_TERM_DAYS.
    due_days: Optional[int] = Field(default=None, ge=0, le=180)
    start_month: Optional[str] = Field(default=None, pattern=_MONTH_PATTERN)
    end_month: Optional[str] = Field(default=None, pattern=_MONTH_PATTERN)
    # The location its invoices are for (routers/locations).
    location_id: Optional[str] = Field(default=None, max_length=64)


class RecurringInvoiceUpdate(BaseModel):
    items: Optional[List[BillingDocumentItem]] = Field(default=None, min_length=1, max_length=50)
    notes: Optional[str] = Field(default=None, max_length=1000)
    customer_eik: Optional[str] = Field(default=None, max_length=20)
    customer_address: Optional[str] = Field(default=None, max_length=300)
    payment_method: Optional[Literal["cash", "bank_transfer", "card"]] = None
    day_of_month: Optional[int] = Field(default=None, ge=1, le=31)
    due_days: Optional[int] = Field(default=None, ge=0, le=180)
    # "" clears it: no last month.
    end_month: Optional[str] = Field(default=None, pattern=r"^(\d{4}-(0[1-9]|1[0-2]))?$")
    is_active: Optional[bool] = None
    # "" takes it off any location.
    location_id: Optional[str] = Field(default=None, max_length=64)


def month_of(day: date) -> str:
    return day.strftime("%Y-%m")


def month_label(month: str) -> str:
    return f"{_MONTHS[int(month[5:7]) - 1]} {month[:4]}"


def issue_day(template: dict, month: str) -> date:
    """The day of `month` the invoice is issued on - the month's last day
    for a day it does not have (31 in November)."""
    year, number = int(month[:4]), int(month[5:7])
    last = calendar.monthrange(year, number)[1]
    return date(year, number, min(int(template.get("day_of_month") or 1), last))


def with_month(text: Optional[str], month: str) -> Optional[str]:
    if text is None:
        return None
    label = month_label(month)
    return text.replace("{месец}", label).replace("{month}", label)


def _aware(moment: Any) -> datetime:
    if not isinstance(moment, datetime):
        return datetime.min.replace(tzinfo=timezone.utc)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


async def _issued(scope: dict, template_ids: List[str]) -> Issued:
    """The invoices the templates issued that still stand (not cancelled)."""
    if not template_ids:
        return {}
    documents = await server.db.billing_documents.find(
        {**scope, "recurring_invoice_id": {"$in": template_ids}, "cancelled": {"$ne": True}},
        {"_id": 0, "id": 1, "invoice_number": 1, "issue_date": 1, "total_amount": 1, "recurring_invoice_id": 1, "recurring_month": 1},
    ).to_list(ALL_ROWS)
    return {(d["recurring_invoice_id"], d.get("recurring_month") or ""): d for d in documents}


def month_state(template: dict, month: str, today: date, issued: Issued) -> Tuple[str, Optional[dict]]:
    """Where the month's invoice stands: issued, ready (its day came),
    upcoming (later this month, or the template starts later), paused or ended."""
    document = issued.get((template["id"], month))
    if document:
        return "issued", document
    if not template.get("is_active", True):
        return "paused", None
    if template.get("end_month") and month > template["end_month"]:
        return "ended", None
    if template.get("start_month") and month < template["start_month"]:
        return "upcoming", None
    return ("ready" if today >= issue_day(template, month) else "upcoming"), None


async def _vat_registered(company_id: Optional[str]) -> bool:
    company = await server.db.companies.find_one({"id": company_id}, {"_id": 0, "vat_registered": 1, "vat_number": 1}) if company_id else None
    return company_vat_registered(company)


def _amounts(template: dict, vat_registered: bool) -> dict:
    items = [BillingDocumentItem(**item) for item in template.get("items") or []]
    if not vat_registered:
        items = [item.model_copy(update={"vat_rate": 0}) for item in items]
    return invoice_vat_breakdown(items)


def template_view(template: dict, month: str, today: date, issued: Issued, vat_registered: bool) -> dict:
    state, document = month_state(template, month, today, issued)
    amounts = _amounts(template, vat_registered)
    history = sorted(
        ({"month": m, "document_id": d["id"], "invoice_number": d.get("invoice_number"), "total_amount": d.get("total_amount")}
         for (template_id, m), d in issued.items() if template_id == template["id"]),
        key=lambda entry: entry["month"], reverse=True,
    )[:12]
    return {
        **{key: template.get(key) for key in (
            "id", "customer_id", "customer_name", "customer_eik", "customer_address", "items", "notes",
            "payment_method", "day_of_month", "due_days", "start_month", "end_month",
        )},
        "is_active": template.get("is_active", True),
        "amount_without_vat": amounts["amount_without_vat"], "vat_amount": amounts["vat_amount"],
        "total_amount": amounts["total_amount"],
        "month": month, "month_label": month_label(month), "issue_day": issue_day(template, month).isoformat(),
        "state": state,
        "issued_document": {
            "id": document["id"], "invoice_number": document.get("invoice_number"),
            "issue_date": document.get("issue_date"), "total_amount": document.get("total_amount"),
        } if document else None,
        "history": history,
    }


async def _template(scope: dict, template_id: str) -> dict:
    template = await server.db.recurring_invoices.find_one({"id": template_id, **scope}, {"_id": 0})
    if not template:
        raise HTTPException(status_code=404, detail="Повтарящата се фактура не е намерена")
    return template


async def _view(company_id: Optional[str], scope: dict, template: dict) -> dict:
    today = server.today_local()
    return template_view(template, month_of(today), today, await _issued(scope, [template["id"]]), await _vat_registered(company_id))


@router.get("/recurring-invoices")
async def list_recurring_invoices(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "issue_invoices")
    company_id, scope = await get_company_scope(current_user)
    templates = await server.db.recurring_invoices.find(scope, {"_id": 0}).sort("customer_name", 1).to_list(ALL_ROWS)
    today = server.today_local()
    issued = await _issued(scope, [t["id"] for t in templates])
    vat = await _vat_registered(company_id)
    return [template_view(t, month_of(today), today, issued, vat) for t in templates]


@router.post("/recurring-invoices")
async def create_recurring_invoice(payload: RecurringInvoiceCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "issue_invoices")
    company_id, scope = await get_company_scope(current_user)
    fields: Dict[str, Any] = {}
    source = None
    if payload.from_document_id:
        source = await server.db.billing_documents.find_one(
            {"id": payload.from_document_id, **scope, "doc_type": "invoice"}, {"_id": 0},
        )
        if not source:
            raise HTTPException(status_code=404, detail="Фактурата не е намерена")
        issued_on = business_day(source.get("issue_date"))
        due = business_day(source.get("due_date")) if source.get("due_date") else None
        fields = {
            "customer_id": source.get("customer_id"), "customer_name": source.get("customer_name"),
            "customer_eik": source.get("customer_eik"), "customer_address": source.get("customer_address"),
            "items": source.get("items") or [], "notes": source.get("notes"),
            "payment_method": source.get("payment_method") or "bank_transfer",
            "location_id": source.get("location_id"),
            "day_of_month": issued_on.day if issued_on else 1,
            "due_days": (due - issued_on).days if due and issued_on and due >= issued_on else INVOICE_TERM_DAYS,
        }
    # What was given overrides what the invoice had.
    fields.update({
        key: value for key, value in payload.model_dump(exclude_unset=True, exclude={"from_document_id"}).items()
        if value is not None
    })
    if not (fields.get("customer_name") or "").strip():
        raise HTTPException(status_code=400, detail="Посочете клиента")
    if not fields.get("items"):
        raise HTTPException(status_code=400, detail="Добавете поне един ред")
    today = server.today_local()
    template = {
        "id": str(uuid.uuid4()), "company_id": company_id, "user_id": current_user.user_id,
        "customer_id": fields.get("customer_id"), "customer_name": fields["customer_name"].strip(),
        "customer_eik": (fields.get("customer_eik") or "").strip() or None,
        "customer_address": (fields.get("customer_address") or "").strip() or None,
        "items": [BillingDocumentItem(**item).model_dump() if isinstance(item, dict) else item for item in fields["items"]],
        "notes": fields.get("notes"), "payment_method": fields.get("payment_method") or "bank_transfer",
        "day_of_month": int(fields.get("day_of_month") or today.day),
        "due_days": int(fields["due_days"]) if fields.get("due_days") is not None else INVOICE_TERM_DAYS,
        "start_month": fields.get("start_month") or month_of(today), "end_month": fields.get("end_month"),
        "is_active": True, "issued": [], "source_document_id": source["id"] if source else None,
        "location_id": await require_location(company_id, fields.get("location_id")),
        "created_at": datetime.now(timezone.utc),
    }
    await server.db.recurring_invoices.insert_one(dict(template))
    # The invoice it was made from is its month's - that month is not issued twice.
    if source and not source.get("cancelled") and not source.get("recurring_invoice_id"):
        await server.db.billing_documents.update_one(
            {"id": source["id"], **scope},
            {"$set": {"recurring_invoice_id": template["id"], "recurring_month": str(source.get("issue_date") or "")[:7]}},
        )
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="create", entity_type="recurring_invoice",
        entity_id=template["id"], company_id=company_id,
        details={"customer_name": template["customer_name"], "day_of_month": template["day_of_month"]},
    )
    return await _view(company_id, scope, template)


@router.put("/recurring-invoices/{template_id}")
async def update_recurring_invoice(template_id: str, payload: RecurringInvoiceUpdate, current_user: User = Depends(get_current_user)):
    """What the next invoices will be - the ones issued stay as they are."""
    require_permission(current_user, "issue_invoices")
    company_id, scope = await get_company_scope(current_user)
    await _template(scope, template_id)
    update = payload.model_dump(exclude_none=True)
    if "items" in update:
        update["items"] = [BillingDocumentItem(**item).model_dump() for item in update["items"]]
    if update.get("end_month") == "":
        update["end_month"] = None
    if "location_id" in update:
        update["location_id"] = await require_location(company_id, update["location_id"])
    if update:
        await server.db.recurring_invoices.update_one({"id": template_id, **scope}, {"$set": update})
    return await _view(company_id, scope, await _template(scope, template_id))


@router.delete("/recurring-invoices/{template_id}")
async def delete_recurring_invoice(template_id: str, current_user: User = Depends(get_current_user)):
    """The template only - the invoices it issued stay what they are."""
    require_permission(current_user, "issue_invoices")
    company_id, scope = await get_company_scope(current_user)
    template = await _template(scope, template_id)
    await server.db.recurring_invoices.delete_one({"id": template_id, **scope})
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="delete", entity_type="recurring_invoice",
        entity_id=template_id, company_id=company_id, details={"customer_name": template.get("customer_name")},
    )
    return {"deleted": True}


@router.post("/recurring-invoices/{template_id}/issue")
async def issue_recurring_invoice(template_id: str, current_user: User = Depends(get_current_user)):
    """This month's invoice, dated today - once."""
    require_permission(current_user, "issue_invoices")
    company_id, scope = await get_company_scope(current_user)
    template = await _template(scope, template_id)
    today = server.today_local()
    month = month_of(today)
    state, document = month_state(template, month, today, await _issued(scope, [template_id]))
    if state == "issued" and document:
        raise HTTPException(status_code=409, detail=f"Фактурата за {month_label(month)} вече е издадена - № {document.get('invoice_number')}")
    if state in ("paused", "ended") or (template.get("start_month") and month < template["start_month"]):
        raise HTTPException(status_code=400, detail="Повтарящата се фактура не е активна за този месец")

    # No invoice stands for the month: a claim left by a cancelled invoice,
    # or by issuing that never finished, is freed.
    stale = datetime.now(timezone.utc) - timedelta(minutes=CLAIM_MINUTES)
    for entry in template.get("issued") or []:
        if entry.get("month") == month and (entry.get("document_id") or _aware(entry.get("claimed_at")) < stale):
            await server.db.recurring_invoices.update_one(
                {"id": template_id, **scope}, {"$pull": {"issued": {"month": month, "claimed_at": entry.get("claimed_at")}}},
            )
    claim = {"month": month, "document_id": None, "claimed_at": datetime.now(timezone.utc)}
    taken = await server.db.recurring_invoices.update_one(
        {"id": template_id, **scope, "issued.month": {"$ne": month}}, {"$push": {"issued": claim}},
    )
    if taken.matched_count == 0:
        raise HTTPException(status_code=409, detail=f"Фактурата за {month_label(month)} се издава в момента")
    paid_by_bank = (template.get("payment_method") or "bank_transfer") == "bank_transfer"
    invoice = BillingDocumentCreate(
        doc_type=BillingDocumentType.INVOICE, customer_id=template.get("customer_id"),
        customer_name=template["customer_name"], customer_eik=template.get("customer_eik"),
        customer_address=template.get("customer_address"),
        items=[BillingDocumentItem(**{**item, "name": with_month(item.get("name"), month) or ""}) for item in template.get("items") or []],
        notes=with_month(template.get("notes"), month), issue_date=today.isoformat(),
        due_date=(today + timedelta(days=int(template.get("due_days") or 0))).isoformat() if paid_by_bank else None,
        payment_method=template.get("payment_method") or "bank_transfer",
        location_id=template.get("location_id"),
    )
    try:
        issued = await _create_issued_invoice(invoice, current_user, recurring=(template_id, month))
    except Exception:
        await server.db.recurring_invoices.update_one(
            {"id": template_id, **scope}, {"$pull": {"issued": {"month": month, "claimed_at": claim["claimed_at"]}}},
        )
        raise
    await server.db.recurring_invoices.update_one(
        {"id": template_id, **scope, "issued.month": month},
        {"$set": {"issued.$.document_id": issued.id, "customer_id": issued.customer_id or template.get("customer_id")}},
    )
    return {"document": issued.model_dump(), "template": await _view(company_id, scope, await _template(scope, template_id))}


async def expected_receipts(company_id: Optional[str], scope: dict, today: date, end: date) -> List[Tuple[date, float, str]]:
    """The money the repeating invoices paid by bank will bring from today
    to `end`: each month not issued yet, by its issue day (today, for one
    ready and waiting) plus its days to pay. An issued one is a debt to
    collect already, counted as that. Paid in cash or by card they are
    the till's revenue or come on the day - not counted here."""
    templates = await server.db.recurring_invoices.find({**scope, "is_active": True}, {"_id": 0}).to_list(ALL_ROWS)
    templates = [t for t in templates if (t.get("payment_method") or "bank_transfer") == "bank_transfer"]
    if not templates:
        return []
    issued = await _issued(scope, [t["id"] for t in templates])
    vat = await _vat_registered(company_id)
    months = sorted({month_of(today + timedelta(days=i)) for i in range((end - today).days + 1)})
    receipts = []
    for template in templates:
        total = _amounts(template, vat)["total_amount"]
        for month in months:
            state, _ = month_state(template, month, today, issued)
            if state not in ("ready", "upcoming") or (template.get("start_month") and month < template["start_month"]):
                continue
            day = max(issue_day(template, month), today) + timedelta(days=int(template.get("due_days") or 0))
            if today <= day <= end and total > 0:
                receipts.append((day, total, str(template.get("customer_name") or "Клиент")))
    return receipts


async def recurring_invoices_signal(company_id: Optional[str], scope: dict, current_user: User) -> Optional[dict]:
    """This month's invoices whose day came, waiting to be issued."""
    if "issue_invoices" not in set(current_user.permissions or []):
        return None
    templates = await server.db.recurring_invoices.find({**scope, "is_active": True}, {"_id": 0}).to_list(ALL_ROWS)
    if not templates:
        return None
    today = server.today_local()
    month = month_of(today)
    issued = await _issued(scope, [t["id"] for t in templates])
    ready = [t for t in templates if month_state(t, month, today, issued)[0] == "ready"]
    if not ready:
        return None
    vat = await _vat_registered(company_id)
    names = ", ".join(f"{t['customer_name']} - {_amounts(t, vat)['total_amount']:.2f} €" for t in ready[:3])
    more = f" и още {len(ready) - 3}" if len(ready) > 3 else ""
    count = "1 фактура е готова" if len(ready) == 1 else f"{len(ready)} фактури са готови"
    return {
        "key": "recurring_invoices", "severity": "info", "priority": 62, "title": f"Фактури за {month_label(month)}",
        "detail": f"{count} за издаване: {names}{more}.", "route": "/recurring-invoices",
        "fingerprint": f"recurring_invoices|{month}|" + "|".join(sorted(t["id"] for t in ready)),
    }

"""Payment reminders to customers (Н6): the program says when one is due -
on the due date, a week after it, two weeks after it - and words it; the
person reads it, changes what they like and sends it, one at a time. Each
stage is sent once (a second tap, another device or a retry never sends it
twice); one put off, or sent another way (a call, a message), is not
suggested again. The business's own invoice or bill goes with the email as
a PDF. Nothing is ever sent by itself."""
import base64
import html
import re

from fastapi import APIRouter
from server import *
import server

router = APIRouter(prefix="/api")

# When a reminder is due: days after the due date.
STAGES: Tuple[Tuple[str, int], ...] = (("due", 0), ("week", 7), ("two_weeks", 14))
STAGE_RANK = {name: index for index, (name, _) in enumerate(STAGES)}
# Sent by the person outside the suggested stages ("send again").
MANUAL = "manual"
# A claim on a stage whose email never went (a crash mid-send) is freed after this long.
CLAIM_MINUTES = 5

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def stage_for(days_overdue: int) -> Optional[str]:
    """The stage a debt is at, by days after its due date."""
    current = None
    for name, start in STAGES:
        if days_overdue >= start:
            current = name
    return current


def _done_rank(receivable: dict) -> int:
    """The latest stage already sent or put off (-1: none yet)."""
    return max((STAGE_RANK.get(r.get("stage") or "", -1) for r in receivable.get("reminders") or []), default=-1)


def _day(value: Any) -> Optional[date]:
    try:
        return business_day(value)
    except (TypeError, ValueError):
        return None


def _document_label(document: Optional[dict], receivable: dict) -> str:
    if document and document.get("doc_type") == "invoice":
        issued = _day(document.get("issue_date"))
        return f"фактура № {document.get('invoice_number')}" + (f" от {issued.strftime('%d.%m.%Y')}" if issued else "")
    if document and document.get("doc_type") == "bill":
        issued = _day(document.get("issue_date"))
        return "сметка" + (f" от {issued.strftime('%d.%m.%Y')}" if issued else "")
    return str(receivable.get("description") or "задължение").strip()


def reminder_text(stage: str, *, company: dict, label: str, left: float, due: date, days_overdue: int) -> Tuple[str, str]:
    """The subject and the message, plainly worded - the person changes
    what they like before sending."""
    iban = str(company.get("bank_iban") or "").strip()
    bank = str(company.get("bank_name") or "").strip()
    pay_line = f"IBAN: {iban}" + (f" ({bank})" if bank else "") + "\n\n" if iban else ""
    sign = f"Поздрави,\n{company.get('name') or ''}".strip()
    already = "Ако вече сте платили, моля, не обръщайте внимание на това писмо.\n\n"
    if stage == "due":
        body = f"напомняме, че днес е падежът за плащане по {label} - {fmt_eur(left)}.\n\n{pay_line}{already}"
        subject = f"Падеж днес - {label}"
    elif stage == "two_weeks":
        body = (
            f"плащането по {label} с падеж {due.strftime('%d.%m.%Y')} закъснява с {days_overdue} дни - остават {fmt_eur(left)}. "
            f"Молим да го направите или да се свържете с нас, ако има въпрос по документа.\n\n{pay_line}"
        )
        subject = f"Просрочено плащане - {label}"
    else:
        body = (
            f"плащането по {label} с падеж {due.strftime('%d.%m.%Y')} все още не е постъпило - остават {fmt_eur(left)}. "
            f"Молим да го направите в най-скоро време.\n\n{pay_line}{already}"
        )
        subject = f"Напомняне за плащане - {label}"
    return subject, f"Здравейте,\n\n{body}{sign}"


async def reminder_items(company_id: Optional[str], scope: dict) -> List[dict]:
    """Every debt past (or on) its due date, with the stage it is at,
    whether a reminder is due now and the words for it - the most overdue
    first."""
    today = server.today_local()
    receivables = [
        r for r in await server.db.receivables.find({**scope, "is_paid": False}, {"_id": 0}).to_list(ALL_ROWS)
        if receivable_left(r) > 0.005 and (_day(r.get("due_date")) or today + timedelta(days=1)) <= today
    ]
    if not receivables:
        return []
    ids = [r["id"] for r in receivables]
    documents = {
        d["receivable_id"]: d for d in await server.db.billing_documents.find(
            {**scope, "receivable_id": {"$in": ids}},
            {"_id": 0, "id": 1, "receivable_id": 1, "doc_type": 1, "invoice_number": 1, "issue_date": 1, "external": 1, "cancelled": 1},
        ).to_list(ALL_ROWS)
    }
    customer_ids = [r["customer_id"] for r in receivables if r.get("customer_id")]
    customers = {
        c["id"]: c for c in await server.db.customers.find(
            {**scope, "id": {"$in": customer_ids}}, {"_id": 0, "id": 1, "email": 1},
        ).to_list(ALL_ROWS)
    } if customer_ids else {}
    company = await server.db.companies.find_one(
        {"id": company_id}, {"_id": 0, "name": 1, "bank_iban": 1, "bank_name": 1},
    ) if company_id else None
    items = []
    for receivable in receivables:
        due = _day(receivable.get("due_date"))
        assert due is not None
        days = (today - due).days
        stage = stage_for(days)
        assert stage is not None
        document = documents.get(receivable["id"])
        label = _document_label(document, receivable)
        left = round(receivable_left(receivable), 2)
        subject, message = reminder_text(stage, company=company or {}, label=label, left=left, due=due, days_overdue=days)
        history = [
            {"stage": r.get("stage"), "channel": r.get("channel"), "to": r.get("to"), "at": r.get("at")}
            for r in receivable.get("reminders") or [] if r.get("channel")
        ]
        items.append({
            "receivable_id": receivable["id"], "customer_id": receivable.get("customer_id"),
            "customer_name": receivable.get("customer_name") or "",
            "email": (customers.get(receivable.get("customer_id") or "") or {}).get("email") or None,
            "document": {
                "id": document["id"], "kind": document.get("doc_type"), "number": document.get("invoice_number"),
                "has_pdf": not document.get("external") and document.get("doc_type") in ("invoice", "bill"),
            } if document else None,
            "label": label, "amount_left": left, "due_date": due.isoformat(), "days_overdue": days,
            "stage": stage, "suggested": STAGE_RANK[stage] > _done_rank(receivable),
            "history": history, "subject": subject, "message": message,
        })
    items.sort(key=lambda item: (-item["days_overdue"], item["customer_name"]))
    return items


@router.get("/payment-reminders")
async def get_payment_reminders(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "add_revenue")
    company_id, scope = await get_company_scope(current_user)
    items = await reminder_items(company_id, scope)
    return {
        "email_enabled": bool(server.EMAIL_FEATURES_ENABLED),
        "suggested": [item for item in items if item["suggested"]],
        "other": [item for item in items if not item["suggested"]],
    }


class ReminderSend(BaseModel):
    stage: Literal["due", "week", "two_weeks", "manual"]
    email: str = Field(min_length=3, max_length=200)
    subject: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=5000)


class ReminderRecord(BaseModel):
    stage: Literal["due", "week", "two_weeks"]
    # Put off, or sent another way (a call, a message on the phone).
    action: Literal["skipped", "sent_other"]


async def _open_receivable(scope: dict, receivable_id: str) -> dict:
    receivable = await server.db.receivables.find_one({"id": receivable_id, **scope}, {"_id": 0})
    if not receivable:
        raise HTTPException(status_code=404, detail="Вземането не е намерено")
    if receivable.get("is_paid") or receivable_left(receivable) <= 0.005:
        raise HTTPException(status_code=400, detail="Вземането вече е платено")
    return receivable


async def _claim(scope: dict, receivable_id: str, entry: dict) -> None:
    """Takes the stage for this reminder - once: a second claim is refused."""
    stale = datetime.now(timezone.utc) - timedelta(minutes=CLAIM_MINUTES)
    # A claim left by an email that never went is freed.
    await server.db.receivables.update_one(
        {"id": receivable_id, **scope},
        {"$pull": {"reminders": {"stage": entry["stage"], "channel": None, "at": {"$lt": stale}}}},
    )
    taken = await server.db.receivables.update_one(
        {"id": receivable_id, **scope, "reminders.stage": {"$ne": entry["stage"]}}, {"$push": {"reminders": entry}},
    )
    if taken.matched_count == 0:
        raise HTTPException(status_code=409, detail="Това напомняне вече е изпратено или отложено")


async def _attachment(scope: dict, receivable_id: str, company_id: Optional[str]) -> Optional[Dict[str, str]]:
    """The business's own invoice or bill for the debt, as a PDF."""
    document = await server.db.billing_documents.find_one({**scope, "receivable_id": receivable_id}, {"_id": 0})
    if not document or document.get("external") or document.get("doc_type") not in ("invoice", "bill"):
        return None
    company = dict(await server.db.companies.find_one({"id": company_id}, {"_id": 0}) or {}) if company_id else {}
    try:
        if document["doc_type"] == "invoice":
            pdf = await asyncio.to_thread(ExportService.generate_issued_invoice_pdf, document, company)
            name = f"faktura_{document.get('invoice_number') or document['id'][:8]}.pdf"
        else:
            pdf = await asyncio.to_thread(ExportService.generate_billing_document_pdf, document, company.get("name", ""))
            name = f"smetka_{document['id'][:8]}.pdf"
    except ImportError:
        return None
    return {"filename": name, "content": base64.b64encode(pdf).decode("ascii")}


@router.post("/payment-reminders/{receivable_id}/send")
@limiter.limit("30/minute")
async def send_payment_reminder(
    request: Request, receivable_id: str, payload: ReminderSend, current_user: User = Depends(get_current_user),
):
    """The reminder the person read and approved, by email."""
    require_permission(current_user, "add_revenue")
    if not server.EMAIL_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="Изпращането на имейли не е настроено - изпратете напомнянето по друг начин.")
    email = payload.email.strip()
    if not _EMAIL.match(email):
        raise HTTPException(status_code=400, detail="Невалиден имейл адрес")
    company_id, scope = await get_company_scope(current_user)
    receivable = await _open_receivable(scope, receivable_id)
    entry: Dict[str, Any] = {
        "id": str(uuid.uuid4()), "stage": payload.stage, "channel": None, "to": email,
        "at": datetime.now(timezone.utc), "by": current_user.user_id,
    }
    claimed = payload.stage != MANUAL
    if claimed:
        await _claim(scope, receivable_id, entry)
    attachment = await _attachment(scope, receivable_id, company_id)
    body = "<p>" + html.escape(payload.message.strip()).replace("\n\n", "</p><p>").replace("\n", "<br>") + "</p>"
    sent = await server.send_email(email, payload.subject.strip(), body, [attachment] if attachment else None)
    if not sent:
        if claimed:
            await server.db.receivables.update_one({"id": receivable_id, **scope}, {"$pull": {"reminders": {"id": entry["id"]}}})
        raise HTTPException(status_code=502, detail="Имейлът не беше изпратен - опитайте отново след малко.")
    if claimed:
        await server.db.receivables.update_one(
            {"id": receivable_id, **scope, "reminders.id": entry["id"]}, {"$set": {"reminders.$.channel": "email"}},
        )
    else:
        await server.db.receivables.update_one({"id": receivable_id, **scope}, {"$push": {"reminders": {**entry, "channel": "email"}}})
    # The address typed for a customer without one is remembered for next time.
    if receivable.get("customer_id"):
        await server.db.customers.update_one(
            {"$and": [scope, {"id": receivable["customer_id"]}, {"$or": [{"email": None}, {"email": ""}]}]},
            {"$set": {"email": email}},
        )
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="send", entity_type="payment_reminder",
        entity_id=receivable_id, company_id=company_id,
        details={"customer_name": receivable.get("customer_name"), "stage": payload.stage, "to": email,
                 "amount_left": round(receivable_left(receivable), 2), "attached": bool(attachment)},
    )
    return {"sent": True, "to": email, "stage": payload.stage, "attached": bool(attachment)}


@router.post("/payment-reminders/{receivable_id}/record")
async def record_payment_reminder(receivable_id: str, payload: ReminderRecord, current_user: User = Depends(get_current_user)):
    """A stage put off, or done another way - not suggested again."""
    require_permission(current_user, "add_revenue")
    company_id, scope = await get_company_scope(current_user)
    receivable = await _open_receivable(scope, receivable_id)
    entry = {
        "id": str(uuid.uuid4()), "stage": payload.stage, "channel": "skipped" if payload.action == "skipped" else "other",
        "to": None, "at": datetime.now(timezone.utc), "by": current_user.user_id,
    }
    await _claim(scope, receivable_id, entry)
    if payload.action == "sent_other":
        await audit_service.log_action(
            user_id=current_user.user_id, user_name=current_user.name, action="send", entity_type="payment_reminder",
            entity_id=receivable_id, company_id=company_id,
            details={"customer_name": receivable.get("customer_name"), "stage": payload.stage, "channel": "other"},
        )
    return {"recorded": True, "stage": payload.stage, "action": payload.action}


async def payment_reminders_signal(company_id: Optional[str], scope: dict, current_user: User) -> Optional[dict]:
    """The reminders due now, waiting for the person to read and send them."""
    if "add_revenue" not in set(current_user.permissions or []):
        return None
    due = [item for item in await reminder_items(company_id, scope) if item["suggested"]]
    if not due:
        return None
    total = sum(item["amount_left"] for item in due)
    oldest = due[0]
    detail = tr(
        f"{len(due)} {'напомняне чака' if len(due) == 1 else 'напомняния чакат'} да ги прегледате и изпратите - "
        f"общо {tr_eur(total)}. Най-старото: {oldest['customer_name']}, {oldest['label']}.",
        f"{len(due)} {'reminder waits' if len(due) == 1 else 'reminders wait'} for you to look over and send - "
        f"{tr_eur(total)} in all. The oldest: {oldest['customer_name']}.",
    )
    return {
        "key": "payment_reminders", "severity": "warning", "priority": 70,
        "title": tr("Напомняния за плащане към клиенти", "Payment reminders to customers"),
        "detail": detail, "route": "/payment-reminders",
        "fingerprint": "reminders|" + "|".join(sorted(f"{item['receivable_id']}:{item['stage']}" for item in due)),
    }

"""The month's pack for the accountant (Н4): one button gathers the
purchases and sales (the VAT ledger), the invoices issued (each as its
PDF), the credit notes, the scanned documents and the payroll; checks it
for what is missing - days without revenue, invoices without an EIK or a
number, employees without a payroll - and sends it by email, or it is
downloaded. The thresholds and the returns stay with the accountant."""
import base64
import io
import re
import zipfile

from fastapi import APIRouter
from server import *
from server import _count_bg
import server

router = APIRouter(prefix="/api")

# What one email can carry; a bigger pack is downloaded and sent another way.
PACK_EMAIL_LIMIT = 20 * 1024 * 1024
# A month's pack is offered for the month before from the 1st to the 15th.
PACK_REMIND_UNTIL_DAY = 15

_CYRILLIC = "абвгдежзийклмнопрстуфхцчшщъьюя"
_LATIN_OF = ["a", "b", "v", "g", "d", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f",
             "h", "ts", "ch", "sh", "sht", "a", "y", "yu", "ya"]
_LATIN = {**dict(zip(_CYRILLIC, _LATIN_OF)), **dict(zip(_CYRILLIC.upper(), (l.capitalize() for l in _LATIN_OF)))}


def _file_part(text: Any, limit: int = 40) -> str:
    """A file name part any computer opens: Latin letters, digits, dashes."""
    latin = "".join(_LATIN.get(ch, ch) for ch in str(text or ""))
    return re.sub(r"[^A-Za-z0-9]+", "-", latin).strip("-")[:limit] or "bez-ime"


def _month_period(month: Optional[str]) -> Period:
    """"YYYY-MM", or else the month before this one - the month a pack is
    usually for."""
    if not month:
        today = today_local()
        first = today.replace(day=1) - timedelta(days=1)
        return Period.month(first.year, first.month)
    match = re.fullmatch(r"(\d{4})-(\d{2})", month)
    if not match or not 1 <= int(match.group(2)) <= 12:
        raise HTTPException(status_code=400, detail="Месецът е във вида ГГГГ-ММ")
    return Period.month(int(match.group(1)), int(match.group(2)))


def _image_bytes(data: Any) -> Optional[Tuple[bytes, str]]:
    """A stored scan (base64, maybe a data URL) and its file extension."""
    text = str(data or "")
    if not text:
        return None
    if text.startswith("data:"):
        text = text.split(",", 1)[-1]
    try:
        raw = base64.b64decode(text, validate=False)
    except Exception:
        return None
    if raw[:4] == b"%PDF":
        return raw, "pdf"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw, "png"
    return raw, "jpg"


async def _pack_records(scope: dict, period: Period, with_images: bool = False) -> dict:
    hide_images = {} if with_images else {"image_base64": 0, "image_base64s": 0}
    purchases = await server.db.invoices.find(
        {**scope, "date": period.datetime_filter()}, {"_id": 0, **hide_images},
    ).sort("date", 1).to_list(ALL_ROWS)
    sales = await server.db.daily_revenue.find({**scope, "date": period.text_filter()}, {"_id": 0}).sort("date", 1).to_list(ALL_ROWS)
    issued = await server.db.billing_documents.find(
        {**scope, "doc_type": {"$in": NUMBERED_DOC_TYPES}, "issue_date": period.text_filter()}, {"_id": 0},
    ).sort("invoice_number", 1).to_list(ALL_ROWS)
    payroll = await server.db.payroll_entries.find(
        {**scope, "period_year": period.start.year, "period_month": period.start.month}, {"_id": 0, "image_base64": 0},
    ).sort("employee_name", 1).to_list(ALL_ROWS)
    return {"purchases": purchases, "sales": sales, "issued": issued, "payroll": payroll}


def _has_scan(invoice: dict) -> bool:
    return bool(invoice.get("image_base64") or invoice.get("image_base64s"))


async def _pack_checks(company_id: Optional[str], scope: dict, period: Period, records: dict) -> List[dict]:
    """What the accountant would ask about - before it reaches them."""
    checks: List[dict] = []
    modules = await modules_for_company(company_id)
    today = today_local()
    if modules["till"]:
        closed_weekdays, exceptions = await get_closed_days_lookup(company_id)
        entered = {str(row.get("date")) for row in records["sales"]}
        missing = []
        day = period.start
        while day <= period.end and day < today:
            text = day.isoformat()
            if text not in entered and not is_date_closed(text, closed_weekdays, exceptions):
                missing.append(text)
            day += timedelta(days=1)
        if missing:
            listed = ", ".join(date.fromisoformat(d).strftime("%d.%m") for d in missing[:10])
            more = f" и още {len(missing) - 10}" if len(missing) > 10 else ""
            checks.append({
                "key": "missing_revenue", "severity": "warning",
                "message": f"Липсва оборот за {_count_bg(len(missing), 'ден', 'дни')}: {listed}{more}.",
                "items": missing,
            })
    no_eik = [inv for inv in records["purchases"] if not str(inv.get("supplier_eik") or "").strip()]
    if no_eik:
        checks.append({
            "key": "purchases_without_eik", "severity": "warning",
            "message": f"{_count_bg(len(no_eik), 'фактура', 'фактури')} без ЕИК на доставчика.",
            "items": [f"{inv.get('supplier') or '?'} № {inv.get('invoice_number') or '?'}" for inv in no_eik[:20]],
        })
    no_number = [inv for inv in records["purchases"] if not str(inv.get("invoice_number") or "").strip()]
    if no_number:
        checks.append({
            "key": "purchases_without_number", "severity": "warning",
            "message": f"{_count_bg(len(no_number), 'фактура', 'фактури')} без номер.",
            "items": [str(inv.get("supplier") or "?") for inv in no_number[:20]],
        })
    no_scan = [inv for inv in records["purchases"] if not inv.get("has_scan")]
    if no_scan:
        checks.append({
            "key": "purchases_without_scan", "severity": "info",
            "message": f"{_count_bg(len(no_scan), 'фактура', 'фактури')} без снимка - счетоводителят може да поиска оригинала.",
            "items": [f"{inv.get('supplier') or '?'} № {inv.get('invoice_number') or '?'}" for inv in no_scan[:20]],
        })
    if modules["payroll"]:
        paid = {entry.get("employee_id") for entry in records["payroll"]}
        employees = await server.db.employees.find({**scope, "active": True}, {"_id": 0, "id": 1, "name": 1, "hire_date": 1}).to_list(ALL_ROWS)
        without = [
            e for e in employees
            if e["id"] not in paid and not (e.get("hire_date") and str(e["hire_date"]) > period.end_text)
        ]
        if without:
            checks.append({
                "key": "payroll_missing", "severity": "warning",
                "message": f"Няма заплата за месеца за {_count_bg(len(without), 'служител', 'служители')}: "
                           + ", ".join(e["name"] for e in without[:5]) + ("..." if len(without) > 5 else "") + ".",
                "items": [e["name"] for e in without],
            })
    return checks


async def _pack_summary(company_id: Optional[str], scope: dict, period: Period) -> dict:
    records = await _pack_records(scope, period)
    scanned_ids = set(await server.db.invoices.distinct("id", {"$and": [
        scope, {"date": period.datetime_filter()},
        {"$or": [{"image_base64": {"$nin": [None, ""]}}, {"image_base64s.0": {"$exists": True}}]},
    ]}))
    for invoice in records["purchases"]:
        invoice["has_scan"] = invoice.get("id") in scanned_ids
    checks = await _pack_checks(company_id, scope, period, records)
    issued = [d for d in records["issued"] if d.get("doc_type") == "invoice"]
    notes = [d for d in records["issued"] if d.get("doc_type") == "credit_note"]
    return {
        "month": period.start.strftime("%Y-%m"),
        "label": f"{_MONTHS_BG[period.start.month - 1]} {period.start.year}",
        "counts": {
            "purchases": len(records["purchases"]),
            "scanned": len(scanned_ids),
            "revenue_days": len(records["sales"]),
            "issued_invoices": len(issued),
            "credit_notes": len(notes),
            "payroll_entries": len(records["payroll"]),
        },
        "checks": checks,
    }


_MONTHS_BG = ["Януари", "Февруари", "Март", "Април", "Май", "Юни",
              "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември"]


async def build_accountant_pack(company_id: Optional[str], scope: dict, current_user: User, period: Period) -> Tuple[bytes, dict]:
    """The pack as one ZIP: the VAT ledger, the payroll, each issued invoice
    and credit note as its PDF, each scanned page, and a summary of what
    is in it and what is missing."""
    summary = await _pack_summary(company_id, scope, period)
    records = await _pack_records(scope, period, with_images=True)
    company = await server.db.companies.find_one({"id": company_id}, {"_id": 0}) if company_id else None
    company = dict(company or {})
    company_name = company.get("name", "")
    month = summary["month"]
    sales = records["sales"]
    if not get_financial_visibility(current_user)["pocket_money"]:
        for row in sales:
            row["pocket_money"] = 0

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as pack:
        ledger = await asyncio.to_thread(
            ExportService.generate_vat_ledger_excel,
            purchases=[{k: v for k, v in inv.items() if k not in ("image_base64", "image_base64s")} for inv in records["purchases"]],
            sales=sales, company_name=company_name,
            period_label=f"Период: {period.start_text} - {period.end_text}", issued_invoices=records["issued"],
        )
        pack.writestr(f"dnevnik_pokupki_prodajbi_{month}.xlsx", ledger)
        if records["payroll"]:
            payroll = await asyncio.to_thread(
                ExportService.generate_payroll_excel, records["payroll"], company_name, f"Месец: {summary['label']}",
            )
            pack.writestr(f"zaplati_{month}.xlsx", payroll)
        for document in records["issued"]:
            if document.get("external"):
                continue   # issued in another program: its document is there
            pdf = await asyncio.to_thread(ExportService.generate_issued_invoice_pdf, document, company)
            kind = "kreditno-izvestie" if document.get("doc_type") == "credit_note" else "faktura"
            pack.writestr(f"izdadeni/{kind}_{document.get('invoice_number') or document.get('id')}.pdf", pdf)
        for invoice in records["purchases"]:
            pages = list(invoice.get("image_base64s") or []) or ([invoice["image_base64"]] if invoice.get("image_base64") else [])
            day = business_day(invoice.get("date"))
            stem = f"{day.isoformat() if day else 'bez-data'}_{_file_part(invoice.get('supplier'))}_{_file_part(invoice.get('invoice_number'), 20)}"
            for number, page in enumerate(pages, 1):
                image = _image_bytes(page)
                if image:
                    suffix = f"_{number}" if len(pages) > 1 else ""
                    pack.writestr(f"pokupki/{stem}{suffix}.{image[1]}", image[0])
        lines = [
            f"{company_name} - документи за {summary['label']}", "",
            f"Покупки (фактури): {summary['counts']['purchases']}, от тях със снимка: {summary['counts']['scanned']}",
            f"Дни с въведен оборот: {summary['counts']['revenue_days']}",
            f"Издадени фактури: {summary['counts']['issued_invoices']}, кредитни известия: {summary['counts']['credit_notes']}",
            f"Заплати (ведомости): {summary['counts']['payroll_entries']}", "",
        ]
        if summary["checks"]:
            lines.append("За проверка:")
            for check in summary["checks"]:
                lines.append(f"- {check['message']}")
        else:
            lines.append("Проверката не откри липси.")
        pack.writestr("spravka.txt", "\n".join(lines) + "\n")
    return buffer.getvalue(), summary


def _require_pack(current_user: User) -> None:
    require_permission(current_user, "export_data")


class PackSend(BaseModel):
    month: Optional[str] = None
    email: Optional[EmailStr] = None


@router.get("/accountant-pack")
async def get_accountant_pack(month: Optional[str] = None, current_user: User = Depends(get_current_user)):
    """What the month's pack holds and what is missing - before it goes."""
    _require_pack(current_user)
    company_id, scope = await get_company_scope(current_user)
    period = _month_period(month)
    summary = await _pack_summary(company_id, scope, period)
    company = await server.db.companies.find_one({"id": company_id}, {"_id": 0, "accountant_email": 1}) if company_id else None
    sent = await server.db.accountant_packs.find(
        {"company_id": company_id, "month": summary["month"]}, {"_id": 0},
    ).sort("sent_at", -1).limit(1).to_list(1) if company_id else []
    return {
        **summary,
        "accountant_email": (company or {}).get("accountant_email"),
        "email_available": server.EMAIL_FEATURES_ENABLED,
        "last_sent": sent[0] if sent else None,
    }


@router.get("/accountant-pack/zip")
@limiter.limit("10/minute")
async def download_accountant_pack(request: Request, month: Optional[str] = None, current_user: User = Depends(get_current_user)):
    _require_pack(current_user)
    company_id, scope = await get_company_scope(current_user)
    period = _month_period(month)
    data, summary = await build_accountant_pack(company_id, scope, current_user, period)
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="export", entity_type="accountant_pack",
        company_id=company_id, details={"month": summary["month"], "size": len(data)},
    )
    return Response(
        content=data, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="dokumenti_{summary["month"]}.zip"'},
    )


@router.post("/accountant-pack/send")
@limiter.limit("5/minute")
async def send_accountant_pack(request: Request, payload: PackSend, current_user: User = Depends(get_current_user)):
    """The pack by email to the accountant (the address is remembered)."""
    _require_pack(current_user)
    if not server.EMAIL_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="Изпращането на имейли не е настроено - изтеглете пакета")
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    company = await server.db.companies.find_one({"id": company_id}, {"_id": 0, "name": 1, "accountant_email": 1}) or {}
    to_email = str(payload.email or company.get("accountant_email") or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Въведете имейла на счетоводителя")
    period = _month_period(payload.month)
    data, summary = await build_accountant_pack(company_id, scope, current_user, period)
    if len(data) > PACK_EMAIL_LIMIT:
        raise HTTPException(
            status_code=413,
            detail=f"Пакетът е {len(data) / 1024 / 1024:.1f} MB - твърде голям за имейл. Изтеглете го и го изпратете с друга услуга.",
        )
    checks = "".join(f"<li>{check['message']}</li>" for check in summary["checks"])
    counts = summary["counts"]
    sent = await server.send_email(
        to_email=to_email,
        subject=f"Документи за {summary['label']} - {company.get('name', '')}",
        html_body=(
            f"<p>Здравейте,</p><p>Изпращам документите на {company.get('name', '')} за {summary['label']}:</p>"
            f"<ul><li>Покупки: {counts['purchases']} (със снимка: {counts['scanned']})</li>"
            f"<li>Дни с оборот: {counts['revenue_days']}</li>"
            f"<li>Издадени фактури: {counts['issued_invoices']}, кредитни известия: {counts['credit_notes']}</li>"
            f"<li>Заплати: {counts['payroll_entries']}</li></ul>"
            + (f"<p>За проверка:</p><ul>{checks}</ul>" if checks else "")
            + f"<p>Поздрави,<br>{current_user.name}</p>"
        ),
        attachments=[{"filename": f"dokumenti_{summary['month']}.zip", "content": base64.b64encode(data).decode("ascii")}],
    )
    if not sent:
        raise HTTPException(status_code=502, detail="Имейлът не можа да бъде изпратен - опитайте пак или изтеглете пакета")
    await server.db.companies.update_one({"id": company_id}, {"$set": {"accountant_email": to_email}})
    record = {
        "company_id": company_id, "month": summary["month"], "sent_to": to_email, "size": len(data),
        "sent_by": current_user.user_id, "sent_at": datetime.now(timezone.utc),
    }
    await server.db.accountant_packs.insert_one(dict(record))
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="export", entity_type="accountant_pack",
        company_id=company_id, details={"month": summary["month"], "sent_to": to_email, "size": len(data)},
    )
    return {"sent_to": to_email, "month": summary["month"], "size": len(data)}


async def accountant_pack_signal(company_id: Optional[str], scope: dict, current_user: User) -> Optional[dict]:
    """From the 1st to the 15th: last month's documents for the accountant,
    with what is missing - until the pack is sent."""
    if "export_data" not in set(current_user.permissions or []) or not company_id:
        return None
    today = today_local()
    if today.day > PACK_REMIND_UNTIL_DAY:
        return None
    period = _month_period(None)
    month = period.start.strftime("%Y-%m")
    if await server.db.accountant_packs.find_one({"company_id": company_id, "month": month}, {"_id": 1}):
        return None
    summary = await _pack_summary(company_id, scope, period)
    counts = summary["counts"]
    if not (counts["purchases"] or counts["revenue_days"] or counts["issued_invoices"]):
        return None
    warnings = [c for c in summary["checks"] if c["severity"] == "warning"]
    detail = (
        f"Документите за {summary['label'].lower()} са готови за счетоводителя: "
        f"{_count_bg(counts['purchases'], 'покупка', 'покупки')}, {_count_bg(counts['issued_invoices'], 'издадена фактура', 'издадени фактури')}."
        + (f" Преди да ги изпратиш: {warnings[0]['message'][0].lower()}{warnings[0]['message'][1:]}" if warnings else "")
    )
    return {
        "key": "accountant_pack", "severity": "info", "priority": 45, "title": "Месечен пакет за счетоводителя",
        "detail": detail, "route": f"/accountant-pack?month={month}", "fingerprint": f"pack|{month}",
    }

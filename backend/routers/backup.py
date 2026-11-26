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
from fastapi import Body
from services import backup_crypto, backup_service, error_log, object_storage
from services.business_calendar import now_local, stored_day, today_local
from routers.price_tracking import rebuild_invoice_price_history

router = APIRouter(prefix="/api")

import base64
import gzip
import json
import os
import re

# A monthly backup by email: every 30 days, and only while it fits an email.
# It is locked with a password the owner chose (services/backup_crypto):
# whoever gets into the mailbox must not read salaries and the notebook.
BACKUP_EMAIL_DAYS = 30
BACKUP_EMAIL_MAX_BYTES = 20 * 1024 * 1024

# The daily backup outside the database (P1-3): every company's data, once a
# day, into the file storage (services/object_storage), the last
# BACKUP_KEEP_DAYS days kept. Off without a file storage.
BACKUP_KEEP_DAYS = max(int(os.environ.get("BACKUP_KEEP_DAYS", "30") or 30), 1)
DAILY_PREFIX = "backups/"
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


async def _backup_document(company_id: Optional[str], scope: dict) -> Dict[str, Any]:
    """A full backup of the whole company's records (services/backup_service:
    every section the business entered, not only invoices, revenue and
    off-book expenses)."""
    collections = await backup_service.build_backup(server.db, company_id, scope)

    company_data = None
    if company_id:
        company_data = await server.db.companies.find_one({"id": company_id}, {"_id": 0})
    counts = {name: len(docs) for name, docs in collections.items()}
    statistics: Dict[str, Any] = {
        "invoice_count": counts.get("invoices", 0),
        "revenue_count": counts.get("daily_revenue", 0),
        "expense_count": counts.get("expenses", 0),
        "total_records": sum(counts.values()),
        "sections": [
            {"key": s.collection, "label": s.label, "count": counts.get(s.collection, 0)}
            for s in backup_service.SECTIONS if counts.get(s.collection)
        ],
    }
    backup_data = {
        "format": backup_service.BACKUP_FORMAT,
        "version": backup_service.BACKUP_VERSION,
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "company": backup_service.encode(company_data) if company_data else None,
        "collections": collections,
        "statistics": statistics,
    }
    return backup_data


async def _record_backup(user_id: str, backup_data: Dict[str, Any], size_bytes: int, via: str = "download") -> None:
    statistics = backup_data["statistics"]
    metadata = BackupMetadata(
        user_id=user_id,
        file_name=f"backup_{now_local().strftime('%Y%m%d_%H%M%S')}.json",
        size_bytes=size_bytes,
        invoice_count=statistics["invoice_count"],
        revenue_count=statistics["revenue_count"],
        expense_count=statistics["expense_count"],
    )
    meta_doc = metadata.model_dump()
    meta_doc["total_records"] = statistics["total_records"]
    meta_doc["via"] = via
    await server.db.backup_metadata.insert_one(meta_doc)


@router.post("/backup/create")
@limiter.limit("5/minute")
async def create_backup(request: Request, current_user: User = Depends(get_current_user)):
    """A full backup of the whole company's records, for the owner to keep."""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да прави резервно копие")
    company_id, scope = await get_company_scope(current_user)
    backup_data = await _backup_document(company_id, scope)
    await _record_backup(current_user.user_id, backup_data, len(json.dumps(backup_data, ensure_ascii=False).encode("utf-8")))
    return backup_data


class BackupSettingsUpdate(BaseModel):
    monthly_email: bool
    # The password that locks the emailed file - needed to turn it on the
    # first time, and to change it.
    password: Optional[str] = Field(default=None, max_length=200)


async def _backup_key(user_id: str) -> Optional[Dict[str, Any]]:
    """The key that locks this owner's emailed backups - kept apart from the
    user record, so nothing that sends a user out can carry it."""
    return await server.db.backup_keys.find_one({"user_id": user_id}, {"_id": 0})


@router.put("/backup/settings")
@limiter.limit("10/minute")
async def update_backup_settings(request: Request, payload: BackupSettingsUpdate, current_user: User = Depends(get_current_user)):
    """The owner's monthly copy of the data by email - on or off, locked
    with a password."""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да прави резервно копие")
    if payload.monthly_email and not server.EMAIL_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="Изпращането на имейли не е настроено")
    if payload.password is not None:
        if len(payload.password) < backup_crypto.MIN_PASSWORD:
            raise HTTPException(status_code=400, detail=f"Паролата за архива трябва да е поне {backup_crypto.MIN_PASSWORD} знака")
        salt, key = await asyncio.to_thread(backup_crypto.new_key, payload.password)
        await server.db.backup_keys.update_one(
            {"user_id": current_user.user_id},
            {"$set": {"user_id": current_user.user_id, "salt": backup_crypto.to_text(salt),
                      "key": backup_crypto.to_text(key), "set_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    if payload.monthly_email and not await _backup_key(current_user.user_id):
        raise HTTPException(status_code=400, detail={
            "code": "backup_password_required",
            "message": "Изберете парола за архива - с нея се отваря файлът от имейла",
        })
    await server.db.users.update_one({"user_id": current_user.user_id}, {"$set": {"backup_email_monthly": payload.monthly_email}})
    return {"monthly_email": payload.monthly_email, "password_set": bool(await _backup_key(current_user.user_id))}


async def send_monthly_backup_emails() -> int:
    """Every owner who asked for it gets a backup by email every 30 days
    (gzip-ed JSON, the same as the one made by hand) - or, too big for an
    email, a note to make one in the app. Returns how many were sent."""
    if not server.EMAIL_FEATURES_ENABLED:
        return 0
    sent = 0
    due_before = datetime.now(timezone.utc) - timedelta(days=BACKUP_EMAIL_DAYS)
    owners = await server.db.users.find(
        {"backup_email_monthly": True, "role": "owner",
         "$or": [{"backup_emailed_at": None}, {"backup_emailed_at": {"$lt": due_before}}]},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "company_id": 1},
    ).to_list(1000)
    for owner in owners:
        if not owner.get("email"):
            continue
        # Never to an email not confirmed (P1-7): it may be someone else's.
        user_doc = await server.db.users.find_one({"user_id": owner["user_id"]}, {"_id": 0, "email_verified": 1})
        if not server.email_is_verified(user_doc or {}):
            continue
        key = await _backup_key(owner["user_id"])
        if not key:
            # From before the password: no unlocked file by email any more,
            # a note to choose one instead.
            ok = await server.send_email(
                owner["email"], "Изберете парола за месечния архив - Фактура+",
                "<p>Здравейте! Месечният архив по имейл вече е заключен с парола, за да не го прочете "
                "никой, който влезе в пощата ви. Изберете парола от екрана „Архив“ в приложението - "
                "дотогава архивът не се изпраща.</p>",
            )
            if ok:
                sent += 1
                await server.db.users.update_one({"user_id": owner["user_id"]}, {"$set": {"backup_emailed_at": datetime.now(timezone.utc)}})
            continue
        company_id = owner.get("company_id")
        scope = await company_data_scope(company_id) if company_id else {"user_id": owner["user_id"]}
        backup_data = await _backup_document(company_id, scope)
        raw = json.dumps(backup_data, ensure_ascii=False, default=str).encode("utf-8")
        packed = backup_crypto.seal(gzip.compress(raw), backup_crypto.from_text(key["key"]), backup_crypto.from_text(key["salt"]))
        day = now_local().strftime("%Y-%m-%d")
        if len(packed) <= BACKUP_EMAIL_MAX_BYTES:
            ok = await server.send_email(
                owner["email"], f"Месечен архив на данните - Фактура+ ({day})",
                "<p>Здравейте! Прикачен е месечният архив на данните ви във Фактура+, заключен с паролата, "
                "която избрахте. Пазете го - с него данните се възстановяват от екрана „Архив“ "
                "(„Възстанови от файл“ и паролата).</p>",
                attachments=[{"filename": f"faktura_plus_arhiv_{day}.fpbak",
                              "content": base64.b64encode(packed).decode("ascii")}],
            )
            if ok:
                await _record_backup(owner["user_id"], backup_data, len(raw), via="email")
        else:
            ok = await server.send_email(
                owner["email"], "Архивът на данните е твърде голям за имейл - Фактура+",
                "<p>Здравейте! Архивът на данните ви вече е твърде голям, за да се прати по имейл. "
                "Създайте го от екрана „Архив“ в приложението и го пазете извън него.</p>",
            )
        if ok:
            sent += 1
            await server.db.users.update_one({"user_id": owner["user_id"]}, {"$set": {"backup_emailed_at": datetime.now(timezone.utc)}})
    return sent

@router.get("/backup/list")
async def list_backups(current_user: User = Depends(get_current_user)):
    """Връща списък с всички backups на потребителя"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да вижда резервните копия")

    backups = await server.db.backup_metadata.find(
        {"user_id": current_user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return {"backups": backups}

def _restored_invoice_day(doc: dict) -> dict:
    # Photo keys come back as they are: they are read only under the
    # restoring company's own folder (services/photo_store), so a key that
    # points at another company's photos shows nothing.
    # Kept as its business day, like every invoice saved today
    # (services/business_calendar) - a backup from before that change
    # restores onto the same day it showed.
    doc["date"] = stored_day(doc["date"])
    if doc.get("payment_due_date"):
        doc["payment_due_date"] = stored_day(doc["payment_due_date"])
    return doc


def _restored_plain_day(doc: dict) -> dict:
    # Revenue and expense days stay "YYYY-MM-DD" text, as when entered.
    doc["date"] = str(doc["date"])[:10]
    return doc


@router.post("/backup/restore")
@limiter.limit("5/minute")
async def restore_backup(request: Request, body: Dict[str, Any] = Body(...), current_user: User = Depends(get_current_user)):
    """Restores a backup into the owner's OWN company only (company_id is
    always the session's, never the file's). Adds only what the company
    does not already hold - by id and by each record's natural key - so a
    second restore of the same file changes nothing. Accepts both the full
    format (2) and the older invoices/revenue/expenses-only files."""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да възстановява резервно копие")
    return await _restore_into_company(current_user, body)


class BackupFile(BaseModel):
    file_base64: str
    password: Optional[str] = Field(default=None, max_length=200)


@router.post("/backup/restore-file")
@limiter.limit("5/minute")
async def restore_backup_file(request: Request, payload: BackupFile, current_user: User = Depends(get_current_user)):
    """Restores a backup file as it is: a plain one made in the app, a
    gzip-ed one, or the monthly one from the email, locked with the
    password."""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да възстановява резервно копие")
    try:
        blob = base64.b64decode(payload.file_base64.split(",", 1)[-1], validate=False)
    except ValueError:
        raise HTTPException(status_code=400, detail="Файлът не е резервно копие на Фактура+")
    try:
        body = await asyncio.to_thread(backup_crypto.read_backup, blob, payload.password)
    except backup_crypto.PasswordNeeded:
        raise HTTPException(status_code=400, detail={
            "code": "backup_password_needed", "message": "Архивът е заключен с парола - въведете я",
        })
    except backup_crypto.WrongPassword:
        raise HTTPException(status_code=400, detail={
            "code": "backup_password_wrong", "message": "Грешна парола за архива",
        })
    except backup_crypto.NotABackup:
        raise HTTPException(status_code=400, detail="Файлът не е резервно копие на Фактура+")
    return await _restore_into_company(current_user, body)


async def _restore_into_company(current_user: User, body: Dict[str, Any]) -> Dict[str, Any]:
    if isinstance(body.get("collections"), dict):
        collections = body["collections"]
    elif any(isinstance(body.get(k), list) for k in ("invoices", "daily_revenues", "expenses")):
        collections = backup_service.from_format_1(body)
    else:
        raise HTTPException(status_code=400, detail="Файлът не е резервно копие на Фактура+")

    company_id, scope = await get_company_scope(current_user)
    if company_id:
        members = await server.db.users.find({"company_id": company_id}, {"_id": 0, "user_id": 1}).to_list(ALL_ROWS)
        member_ids = {m["user_id"] for m in members} | {current_user.user_id}
    else:
        member_ids = {current_user.user_id}

    result = await backup_service.restore(
        server.db, collections, company_id=company_id, scope=scope,
        owner_id=current_user.user_id, member_ids=member_ids,
        prepare={"invoices": _restored_invoice_day, "daily_revenue": _restored_plain_day, "expenses": _restored_plain_day},
    )
    if company_id:
        for invoice in result.restored_invoices:
            await rebuild_invoice_price_history(company_id, invoice)

    def legacy(bucket: Dict[str, int]) -> Dict[str, int]:
        main = {"invoices": bucket.get("invoices", 0), "revenues": bucket.get("daily_revenue", 0),
                "expenses": bucket.get("expenses", 0)}
        total = sum(bucket.values())
        return {**main, "other": total - sum(main.values()), "total": total}

    labels = {s.collection: s.label for s in backup_service.SECTIONS}
    sections = [
        {"key": name, "label": labels.get(name, name), "restored": result.restored.get(name, 0),
         "already_present": result.already_present.get(name, 0), "invalid": result.invalid.get(name, 0),
         "not_in_team": result.not_in_team.get(name, 0)}
        for name in labels
        if any(b.get(name) for b in (result.restored, result.already_present, result.invalid, result.not_in_team))
    ]
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="restore",
        entity_type="backup", entity_id=str(body.get("id") or ""), company_id=company_id,
        details={"restored": sum(result.restored.values()), "already_present": sum(result.already_present.values())},
    )
    return {
        "success": True,
        "message": "Данните са възстановени успешно",
        "restored": legacy(result.restored),
        "already_present": sum(result.already_present.values()),
        "not_in_team": sum(result.not_in_team.values()),
        "skipped": legacy(result.invalid),
        "sections": sections,
    }

@router.get("/backup/status")
async def get_backup_status(current_user: User = Depends(get_current_user)):
    """Връща статус на последния backup"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да вижда статуса на резервните копия")

    # The newest one - find_one alone returned the OLDEST backup as "last".
    latest = await server.db.backup_metadata.find(
        {"user_id": current_user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).limit(1).to_list(1)
    last_backup = latest[0] if latest else None
    
    owner = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "backup_email_monthly": 1})
    company_id, _ = await get_company_scope(current_user)
    daily_state: Dict[str, Any] = (
        await server.db.daily_backup_state.find_one({"company_id": company_id}, {"_id": 0}) if company_id else None
    ) or {}
    email_settings = {
        "monthly_email": bool(owner.get("backup_email_monthly")) if owner else False,
        "email_available": server.EMAIL_FEATURES_ENABLED,
        "email_password_set": bool(await _backup_key(current_user.user_id)),
        "daily": {
            "enabled": object_storage.enabled(),
            "keep_days": BACKUP_KEEP_DAYS,
            "last_day": daily_state.get("stored_day"),
        },
    }
    if last_backup:
        return {
            "has_backup": True,
            "last_backup_date": last_backup.get("created_at"),
            "file_name": last_backup.get("file_name"),
            "statistics": {
                "invoices": last_backup.get("invoice_count", 0),
                "revenues": last_backup.get("revenue_count", 0),
                "expenses": last_backup.get("expense_count", 0),
                "total": last_backup.get("total_records"),
            },
            **email_settings,
        }

    return {
        "has_backup": False,
        "last_backup_date": None,
        **email_settings,
    }


# ---- The daily backup outside the database (P1-3) ----

def _daily_key(company_id: str, day: str) -> str:
    return f"{DAILY_PREFIX}{company_id}/{day}.json.gz"


def _day_of(key: str) -> str:
    return key.rsplit("/", 1)[-1].split(".", 1)[0]


async def _prune_daily(company_id: str) -> None:
    """Only the last BACKUP_KEEP_DAYS days stay."""
    oldest = (today_local() - timedelta(days=BACKUP_KEEP_DAYS - 1)).isoformat()
    for stored in await object_storage.list_files(f"{DAILY_PREFIX}{company_id}/"):
        if _day_of(stored.key) < oldest:
            await object_storage.delete(stored.key)


async def run_daily_backups(only: Optional[List[str]] = None) -> int:
    """Every company's data into the file storage, once a day (the job runs
    every hour and does only what today still lacks). A company with
    nothing entered is not stored. Returns how many were stored. `only`
    narrows it to some companies (the tests)."""
    if not object_storage.enabled():
        return 0
    today = today_local().isoformat()
    stored = 0
    query: Dict[str, Any] = {"id": {"$in": only}} if only is not None else {}
    companies = await server.db.companies.find(query, {"_id": 0, "id": 1}).to_list(ALL_ROWS)
    for company in companies:
        company_id = company.get("id")
        if not company_id:
            continue
        state = await server.db.daily_backup_state.find_one({"company_id": company_id}, {"_id": 0, "day": 1})
        if state and state.get("day") == today:
            continue
        try:
            scope = await company_data_scope(company_id)
            backup_data = await _backup_document(company_id, scope)
            fields: Dict[str, Any] = {"company_id": company_id, "day": today, "at": datetime.now(timezone.utc)}
            if backup_data["statistics"]["total_records"]:
                packed = await asyncio.to_thread(backup_crypto.pack, backup_data)
                await object_storage.put(_daily_key(company_id, today), packed, "application/gzip")
                await _prune_daily(company_id)
                fields.update({"stored_day": today, "size_bytes": len(packed),
                               "records": backup_data["statistics"]["total_records"]})
                stored += 1
            await server.db.daily_backup_state.update_one({"company_id": company_id}, {"$set": fields}, upsert=True)
        except Exception as e:  # one company's failure does not stop the others
            await error_log.record_exception(server.db, e, source="job", where="daily_backup", company_id=company_id)
    return stored


async def _owner_company(current_user: User) -> str:
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да вижда резервните копия")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=404, detail="Няма фирма")
    return company_id


@router.get("/backup/daily")
async def list_daily_backups(current_user: User = Depends(get_current_user)):
    """The days kept in the daily backup, newest first."""
    company_id = await _owner_company(current_user)
    if not object_storage.enabled():
        return {"enabled": False, "keep_days": BACKUP_KEEP_DAYS, "days": []}
    files = await object_storage.list_files(f"{DAILY_PREFIX}{company_id}/")
    kept = sorted((f for f in files if _DAY.match(_day_of(f.key))), key=lambda f: _day_of(f.key), reverse=True)
    days = [{"day": _day_of(f.key), "size_bytes": f.size} for f in kept]
    return {"enabled": True, "keep_days": BACKUP_KEEP_DAYS, "days": days}


async def _daily_backup(current_user: User, day: str) -> Dict[str, Any]:
    company_id = await _owner_company(current_user)
    if not _DAY.match(day):
        raise HTTPException(status_code=400, detail="Невалиден ден")
    if not object_storage.enabled():
        raise HTTPException(status_code=503, detail="Дневният архив не е настроен")
    blob = await object_storage.get(_daily_key(company_id, day))
    if blob is None:
        raise HTTPException(status_code=404, detail="Няма архив за този ден")
    return await asyncio.to_thread(backup_crypto.read_backup, blob)


@router.get("/backup/daily/{day}")
@limiter.limit("10/minute")
async def download_daily_backup(request: Request, day: str, current_user: User = Depends(get_current_user)):
    """One day's backup, to keep as a file."""
    return await _daily_backup(current_user, day)


@router.post("/backup/daily/{day}/restore")
@limiter.limit("5/minute")
async def restore_daily_backup(request: Request, day: str, current_user: User = Depends(get_current_user)):
    """Brings back from one day's backup what the company no longer holds -
    nothing is overwritten or doubled (the same rule as any restore)."""
    return await _restore_into_company(current_user, await _daily_backup(current_user, day))

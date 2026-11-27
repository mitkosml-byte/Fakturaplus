"""Full company backup and restore.

Format 2 keeps every record the business itself entered - not only
invoices, daily revenue and off-book expenses as format 1 did, which lost
the team, payroll, schedule, assets, receivables and every setting on a
restore. Derived data (price history and price alerts, rebuilt from the
invoices), identities and access (users, sessions, invitations), the scan
credit ledger and the audit log are deliberately not in it: a restore must
never be able to add credits or rewrite who did what.

A restore only ever ADDS what the company does not already hold, judged by
the record's own id and by its natural key - the same day's revenue, the
same supplier's invoice number, the same employee's month of payroll - so
restoring the same file twice, or a file into a company that re-entered
some of it by hand, never doubles anything. Records that point at each
other (payroll -> employee, receivable -> customer, payment -> expense)
keep pointing at each other even when one side already existed under a
different id."""
from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

BACKUP_FORMAT = "fakturaplus-backup"
BACKUP_VERSION = 2

# No cap on how many records a section holds (motor: length=None).
ALL = None

# Fields that name a person (an app account), not a record.
USER_FIELDS = {
    "user_id", "creator_id", "created_by", "adjusted_by", "paid_by",
    "linked_user_id", "discontinued_by", "updated_by",
}
# Never taken from a file: the restoring company's own values are used.
FORCED_FIELDS = {"_id", "company_id"}


def _norm(value: Any) -> str:
    return " ".join(str(value or "").split()).lower()


def _day(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")[:10]


def _money(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


@dataclass
class Section:
    collection: str
    # What makes two records the same thing within one company, or None
    # when only the id can tell.
    natural_key: Optional[Callable[[dict], tuple]]
    # The team member a record is ABOUT (their shift, their pay): without
    # that person in this company the record means nothing and is skipped.
    person_field: Optional[str] = None
    # One per company (settings): kept as it is when the company has one.
    singleton: bool = False
    label: str = ""
    legacy_key: Optional[str] = None  # its key in format 1 files / replies
    skip_projection: Tuple[str, ...] = field(default_factory=tuple)
    # Settings-like records are keyed by the company (and their own key
    # fields) and carry no "id" of their own.
    has_id: bool = True
    # Fields holding a map keyed by other records' ids (a day's revenue by
    # location): the keys are carried over as the references are.
    keyed_by_id: Tuple[str, ...] = field(default_factory=tuple)


# Records whose user_id is who ENTERED them (older files left it out).
AUTHORED = {
    "customers", "employees", "invoices", "assets", "billing_documents", "receivables",
    "daily_revenue", "expenses", "recurring_expenses", "payroll_entries",
    "personal_wallet_entries", "personal_expenses", "recurring_invoices", "price_list", "deadlines",
}


# Parents before the records that point at them.
SECTIONS: List[Section] = [
    Section("locations", lambda d: (_norm(d.get("name")),), label="Обекти"),
    Section("customers", lambda d: (_norm(d.get("name")),), label="Клиенти"),
    Section("employees", lambda d: (_norm(d.get("name")),), label="Служители"),
    Section("payroll_rates", None, singleton=True, has_id=False, label="Осигурителни ставки"),
    Section("personal_wallet_settings", None, singleton=True, has_id=False, label="Настройки на личния портфейл"),
    Section("price_alert_settings", None, singleton=True, has_id=False, label="Настройки на ценовите сигнали"),
    Section(
        "invoices",
        lambda d: (
            _norm(d.get("document_type") or "invoice"),
            _norm(d.get("supplier_eik")) or _norm(d.get("supplier")),
            _norm(d.get("invoice_number")),
        ),
        label="Фактури", legacy_key="invoices", skip_projection=("image_base64", "image_base64s", "image_keys", "items"),
    ),
    Section(
        "assets",
        lambda d: (_norm(d.get("name")), _day(d.get("acquisition_date")), _money(d.get("acquisition_value"))),
        label="Активи",
    ),
    Section(
        "billing_documents",
        # An issued invoice is its number; a bill or quote its day, amount, customer.
        lambda d: (
            _norm(d.get("doc_type")), _norm(d.get("invoice_number")), _day(d.get("issue_date")),
            _money(d.get("total_amount")), _norm(d.get("customer_name")),
        ),
        label="Сметки, оферти и издадени фактури",
    ),
    Section(
        "receivables",
        lambda d: (_norm(d.get("customer_name")), _norm(d.get("description")), _money(d.get("amount")), _day(d.get("due_date"))),
        label="Вземания",
    ),
    Section("price_list", lambda d: (_norm(d.get("name")),), label="Ценоразпис"),
    Section("deadlines", lambda d: (_norm(d.get("title")), _day(d.get("due_date"))), label="Срокове"),
    Section(
        "recurring_invoices",
        lambda d: (
            _norm(d.get("customer_name")), d.get("day_of_month"),
            _norm(((d.get("items") or [{}])[0] or {}).get("name") if isinstance(d.get("items"), list) else ""),
        ),
        label="Повтарящи се фактури",
    ),
    Section(
        "daily_revenue", lambda d: (_day(d.get("date")),), label="Дневни обороти", legacy_key="daily_revenues",
        keyed_by_id=("by_location",),
    ),
    Section(
        "expenses",
        lambda d: (_day(d.get("date")), _money(d.get("amount")), _norm(d.get("description"))),
        label="Разходи без фактура", legacy_key="expenses",
    ),
    Section(
        "recurring_expenses",
        lambda d: (_norm(d.get("description")), _money(d.get("amount")), d.get("day_of_month")),
        label="Повтарящи се разходи",
    ),
    Section("budgets", lambda d: (str(d.get("month") or ""),), label="Бюджети"),
    Section(
        "payroll_entries",
        lambda d: (d.get("employee_id"), d.get("period_year"), d.get("period_month")),
        label="Заплати", skip_projection=("image_base64",),
    ),
    Section(
        "employee_leave",
        lambda d: (d.get("employee_id"), _day(d.get("start_date")), _day(d.get("end_date")), _norm(d.get("leave_type"))),
        label="Отпуски",
    ),
    Section("employee_holiday_work", lambda d: (d.get("employee_id"), _day(d.get("date"))), label="Труд в празник"),
    Section("closed_date_exceptions", lambda d: (_day(d.get("date")),), label="Почивни дни"),
    Section(
        "calendar_events",
        lambda d: (_day(d.get("event_date")), str(d.get("event_time") or ""), _norm(d.get("title"))),
        label="Календар",
    ),
    Section(
        "work_shifts",
        lambda d: (d.get("user_id"), _day(d.get("date")), d.get("start_time"), d.get("end_time"), d.get("repeat_pattern")),
        person_field="user_id", label="Смени",
    ),
    Section("shift_adjustments", lambda d: (d.get("shift_id"), _day(d.get("date"))), person_field="user_id", label="Корекции на смени"),
    Section(
        "schedule_payments",
        lambda d: (d.get("user_id"), _day(d.get("period_start")), _day(d.get("period_end"))),
        person_field="user_id", label="Плащания по график",
    ),
    Section(
        "team_notes",
        lambda d: (d.get("user_id"), _norm(d.get("text")), _day(d.get("created_at"))),
        person_field="user_id", label="Бележки за екипа",
    ),
    Section(
        "personal_wallet_entries",
        lambda d: (_day(d.get("date")), _money(d.get("amount")), _norm(d.get("description")), _norm(d.get("category"))),
        label="Личен портфейл",
    ),
    Section(
        "personal_expenses",
        lambda d: (d.get("period_year"), d.get("period_month"), _money(d.get("amount")), _norm(d.get("description"))),
        label="Лични вложения",
    ),
    Section("item_merge_mappings", lambda d: (d.get("canonical_name"),), label="Обединени артикули", has_id=False),
    Section("item_pack_rules", lambda d: (d.get("item_key"), d.get("supplier_key")), label="Разфасовки", has_id=False),
    Section("item_distinctions", lambda d: (d.get("a"), d.get("b")), label="Различни артикули", has_id=False),
    Section("item_preferences", lambda d: (d.get("item_key"),), label="Спрени артикули", has_id=False),
    Section("price_alert_mutes", lambda d: (_norm(d.get("item_name")), _norm(d.get("supplier"))), label="Заглушени ценови сигнали"),
]
SECTIONS_BY_NAME = {s.collection: s for s in SECTIONS}


# ---------------------------------------------------------------- encoding

def encode(value: Any) -> Any:
    """JSON-safe copy; a moment in time stays one ({"$date": ...})."""
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return {"$date": moment.isoformat()}
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [encode(v) for v in value]
    return value


class InvalidRecord(ValueError):
    pass


def decode(value: Any) -> Any:
    """Inverse of encode. Any other "$"-key (a query operator smuggled into
    a file) makes the whole record invalid."""
    if isinstance(value, dict):
        if set(value) == {"$date"}:
            try:
                moment = datetime.fromisoformat(str(value["$date"]).replace("Z", "+00:00"))
            except ValueError as exc:
                raise InvalidRecord(f"unreadable date {value['$date']!r}") from exc
            return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)
        out = {}
        for k, v in value.items():
            if not isinstance(k, str) or k.startswith("$") or "." in k:
                raise InvalidRecord(f"field name {k!r} is not allowed")
            out[k] = decode(v)
        return out
    if isinstance(value, list):
        return [decode(v) for v in value]
    return value


# ---------------------------------------------------------------- backup

async def build_backup(db, company_id: Optional[str], scope: dict) -> Dict[str, List[dict]]:
    collections: Dict[str, List[dict]] = {}
    for section in SECTIONS:
        if section.singleton:
            query = {"company_id": company_id} if company_id else None
            docs = await db[section.collection].find(query, {"_id": 0}).to_list(10) if query else []
        else:
            docs = await db[section.collection].find(scope, {"_id": 0}).to_list(ALL)
        collections[section.collection] = [encode(d) for d in docs]
    return collections


# ---------------------------------------------------------------- restore

def from_format_1(body: dict) -> Dict[str, List[dict]]:
    """Format 1 files kept dates as plain ISO text and only three lists."""
    def moments(doc: dict, fields: Tuple[str, ...]) -> dict:
        doc = dict(doc)
        for f in fields:
            if isinstance(doc.get(f), str) and doc[f]:
                doc[f] = {"$date": doc[f]}
        return doc

    return {
        "invoices": [moments(d, ("date", "payment_due_date", "created_at", "paid_at")) for d in body.get("invoices") or []],
        "daily_revenue": [moments(d, ("created_at",)) for d in body.get("daily_revenues") or []],
        "expenses": [moments(d, ("created_at",)) for d in body.get("expenses") or []],
    }


def _reference_fields(doc: dict) -> List[str]:
    return [
        k for k, v in doc.items()
        if k.endswith("_id") and k not in USER_FIELDS and k not in FORCED_FIELDS and isinstance(v, str)
    ]


@dataclass
class RestoreResult:
    restored: Dict[str, int] = field(default_factory=dict)
    already_present: Dict[str, int] = field(default_factory=dict)
    invalid: Dict[str, int] = field(default_factory=dict)
    # About a team member who is not in this company (their shifts, pay).
    not_in_team: Dict[str, int] = field(default_factory=dict)
    restored_invoices: List[dict] = field(default_factory=list)
    restored_assets: List[dict] = field(default_factory=list)

    def bump(self, bucket: Dict[str, int], name: str) -> None:
        bucket[name] = bucket.get(name, 0) + 1


async def restore(
    db, collections: Dict[str, Any], *, company_id: Optional[str], scope: dict,
    owner_id: str, member_ids: set, prepare: Optional[Dict[str, Callable[[dict], dict]]] = None,
) -> RestoreResult:
    """Adds what the company does not hold yet; see the module docstring.

    `prepare` lets the caller normalise a section's record (invoice dates
    onto business days) after decoding and before it is matched."""
    result = RestoreResult()
    id_map: Dict[str, str] = {}
    pending: List[Tuple[str, str, str, str]] = []  # collection, new id, field, old reference

    for section in SECTIONS:
        raw = collections.get(section.collection)
        if not isinstance(raw, list) or not raw:
            continue
        name = section.collection
        coll = db[name]

        projection = {"_id": 0, **{f: 0 for f in section.skip_projection}}
        if section.singleton:
            if not company_id or await coll.find_one({"company_id": company_id}, {"_id": 0}):
                result.already_present[name] = len(raw)
                continue
            existing: List[dict] = []
        else:
            existing = await coll.find(scope, projection).to_list(ALL)
        here_ids = {d["id"] for d in existing if d.get("id")}
        free_by_key: Dict[tuple, List[Optional[str]]] = {}
        if section.natural_key:
            for d in existing:
                try:
                    free_by_key.setdefault(section.natural_key(d), []).append(d.get("id"))
                except Exception:
                    continue

        file_ids = [d.get("id") for d in raw if isinstance(d, dict) and isinstance(d.get("id"), str)]
        taken_elsewhere: set = set()
        if file_ids:
            found = await coll.find({"id": {"$in": file_ids}}, {"_id": 0, "id": 1}).to_list(ALL)
            taken_elsewhere = {d["id"] for d in found} - here_ids

        for item in raw:
            try:
                if not isinstance(item, dict):
                    raise InvalidRecord("not a record")
                doc = decode(item)
                for f in FORCED_FIELDS:
                    doc.pop(f, None)
                if prepare and name in prepare:
                    doc = prepare[name](doc)

                person = section.person_field
                if person and doc.get(person) not in member_ids:
                    result.bump(result.not_in_team, name)
                    continue
                for f in USER_FIELDS:
                    if f == person or f not in doc or doc[f] is None:
                        continue
                    if doc[f] not in member_ids:
                        doc[f] = None if f == "linked_user_id" else owner_id
                if name in AUTHORED and not doc.get("user_id"):
                    doc["user_id"] = owner_id

                unresolved = []
                for f in _reference_fields(doc):
                    if doc[f] in id_map:
                        doc[f] = id_map[doc[f]]
                    else:
                        unresolved.append(f)
                for f in section.keyed_by_id:
                    if isinstance(doc.get(f), dict):
                        doc[f] = {id_map.get(key, key): value for key, value in doc[f].items()}

                old_id = doc.get("id") if isinstance(doc.get("id"), str) else None
                if old_id and old_id in here_ids:
                    id_map[old_id] = old_id
                    result.bump(result.already_present, name)
                    continue
                if section.natural_key:
                    free = free_by_key.get(section.natural_key(doc))
                    if free:
                        match = free.pop(0)
                        if old_id and match:
                            id_map[old_id] = match
                        result.bump(result.already_present, name)
                        continue

                if old_id and old_id in taken_elsewhere:
                    doc["id"] = str(uuid.uuid4())
                elif not old_id and section.has_id:
                    doc["id"] = str(uuid.uuid4())
                if old_id:
                    id_map[old_id] = doc["id"]
                doc["company_id"] = company_id
                doc.setdefault("created_at", datetime.now(timezone.utc))

                await coll.insert_one(dict(doc))
                pending.extend((name, doc.get("id") or "", f, doc[f]) for f in unresolved)
                result.bump(result.restored, name)
                if name == "invoices":
                    result.restored_invoices.append(doc)
                elif name == "assets":
                    result.restored_assets.append(doc)
            except Exception as exc:
                logger.warning(f"Backup restore: skipped a record in {name}: {exc}")
                result.bump(result.invalid, name)

    # A reference to a record restored LATER (an expense naming the
    # schedule payment that created it) is settled once everything is in.
    for name, new_id, f, old_ref in pending:
        target = id_map.get(old_ref)
        if new_id and target and target != old_ref:
            await db[name].update_one({"id": new_id, "company_id": company_id}, {"$set": {f: target}})

    await _keep_numbering_ahead(db, company_id, owner_id, result)
    return result


async def _keep_numbering_ahead(db, company_id: Optional[str], owner_id: str, result: RestoreResult) -> None:
    """Inventory and protocol numbers come from counters; after a restore
    the next one must follow the highest restored, never repeat it."""
    scope = company_id or f"user:{owner_id}"
    highest_asset = 0
    for asset in result.restored_assets:
        m = re.search(r"(\d+)\s*$", str(asset.get("inventory_number") or ""))
        if m:
            highest_asset = max(highest_asset, int(m.group(1)))
    if highest_asset:
        await db.counters.update_one({"_id": f"asset_{scope}"}, {"$max": {"seq": highest_asset}}, upsert=True)
    by_year: Dict[str, int] = {}
    for invoice in result.restored_invoices:
        m = re.match(r"^\s*(\d+)\s*/\s*(\d{4})\s*$", str(invoice.get("protocol_number") or ""))
        if m:
            by_year[m.group(2)] = max(by_year.get(m.group(2), 0), int(m.group(1)))
    for year, seq in by_year.items():
        await db.counters.update_one({"_id": f"protocol_{scope}_{year}"}, {"$max": {"seq": seq}}, upsert=True)

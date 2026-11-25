"""Recurring expenses - the routes, the upkeep and the signals.

What an occurrence is (paid by an invoice, recorded, skipped, a likely
match, due...) is decided in services/recurring_service.py. Here:

- the owner's list and answers: "paid - record it", "skip this month",
  "yes, that is it" / "no, a different cost";
- upkeep (maintain_company), run on every change that can settle a month -
  an invoice saved, a recurring expense saved, the list opened - and
  hourly: an off-book expense recorded on its day where the owner asked
  for that, and an off-book record replaced by the supplier's invoice that
  arrived for the same month, so one cost is never counted twice;
- the daily review's questions about them.

Shares server.py's db/models/helpers via `from server import *`, reading
the db as `server.db` (tests swap it)."""
import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter
from pymongo.errors import DuplicateKeyError

from server import *
import server
from services.month_names import MONTHS_BG
from services import recurring_service as rs

router = APIRouter(prefix="/api")

# Who the audit trail names for what the app did by itself.
APP_ACTOR = {"user_id": "system", "user_name": "Фактура+"}
# How long the notice about a record replaced by an invoice stays.
REPLACED_NOTICE_DAYS = 14
MONTH_NAMES = MONTHS_BG


MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


class RecurringExpenseIn(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0)
    day_of_month: int = Field(ge=1, le=28)
    category: Optional[str] = Field(default=None, max_length=60)
    # Does an invoice come for it? "invoice": its invoice is the expense;
    # "no_invoice": the app records it as an off-book expense.
    kind: Literal["invoice", "no_invoice"] = "no_invoice"
    supplier_name: Optional[str] = Field(default=None, max_length=200)
    supplier_eik: Optional[str] = Field(default=None, max_length=20)
    # no_invoice only: record it on its day without asking.
    auto_record: bool = False
    # Every how many months it is paid: 1 every month, 3 quarterly
    # installments, 12 once a year - any number.
    interval_months: int = Field(default=1, ge=1, le=rs.MAX_INTERVAL_MONTHS)
    # The month of its first payment ("YYYY-MM"); by default the first
    # month its day comes in from today on.
    start_month: Optional[str] = Field(default=None, pattern=MONTH_PATTERN)
    # How many payments in all (installments, a lease); none - no end.
    payments_count: Optional[int] = Field(default=None, ge=1, le=rs.MAX_PAYMENTS)


class RecurringExpenseUpdateIn(BaseModel):
    description: Optional[str] = Field(default=None, min_length=1, max_length=200)
    amount: Optional[float] = Field(default=None, gt=0)
    day_of_month: Optional[int] = Field(default=None, ge=1, le=28)
    category: Optional[str] = Field(default=None, max_length=60)
    kind: Optional[Literal["invoice", "no_invoice"]] = None
    supplier_name: Optional[str] = Field(default=None, max_length=200)
    supplier_eik: Optional[str] = Field(default=None, max_length=20)
    auto_record: Optional[bool] = None
    is_active: Optional[bool] = None
    interval_months: Optional[int] = Field(default=None, ge=1, le=rs.MAX_INTERVAL_MONTHS)
    start_month: Optional[str] = Field(default=None, pattern=MONTH_PATTERN)
    # null clears it: no end.
    payments_count: Optional[int] = Field(default=None, ge=1, le=rs.MAX_PAYMENTS)


class RecordMonthIn(BaseModel):
    # What was actually paid, when it differs from the usual amount.
    amount: Optional[float] = Field(default=None, gt=0)


class MatchAnswerIn(BaseModel):
    source: Literal["expense", "invoice"]
    id: str = Field(min_length=1, max_length=100)
    same: bool


def month_label(key: str) -> str:
    year, month = rs.parse_month(key)
    return f"{MONTH_NAMES[month - 1]} {year}"


def _short_day(iso_day: Optional[str]) -> str:
    if not iso_day:
        return ""
    day = date.fromisoformat(str(iso_day)[:10])
    return f"{day.day} {MONTH_NAMES[day.month - 1]}"


def _signal_month(key: str) -> str:
    """A month in a signal, in the viewer's language: "Ноември 2026" - "November 2026"."""
    year, month = rs.parse_month(key)
    return tr_month(year, month)


def _signal_day(iso_day: Optional[str]) -> str:
    """A day in a signal, in the viewer's language: "21 ноември" - "21 November"."""
    return tr_day(date.fromisoformat(str(iso_day)[:10])) if iso_day else ""


async def _items(company_id: str, active_only: bool = True) -> List[dict]:
    query: Dict[str, Any] = {"company_id": company_id}
    if active_only:
        query["is_active"] = {"$ne": False}
    return await server.db.recurring_expenses.find(query, {"_id": 0}).to_list(ALL_ROWS)


async def resolve_company_month(company_id: str, scope: dict, year: int, month: int, items: List[dict]) -> Dict[str, dict]:
    if not items:
        return {}
    records = await rs.load_month_records(server.db, scope, [item["id"] for item in items], year, month)
    return rs.resolve_month(items, year, month, records, today=rs.current_day())


def _months_to_keep_up(today: date) -> List[Tuple[int, int]]:
    """The months upkeep and the daily review look at: last month (a
    question left open, an invoice that came late) and this one."""
    return [rs.add_months(today.year, today.month, -1), (today.year, today.month)]


async def _replace_with_invoice(company_id: str, item: dict, occurrence: dict, actor: dict, notify: bool = True) -> int:
    """The month is paid by the supplier's invoice and was also recorded
    without one: the off-book record goes (kept whole on its audit entry,
    restorable), and an expense that turned out to come with invoices is
    expected with one from now on."""
    invoice = occurrence["invoices"][0]
    removed = 0
    for expense in occurrence["expenses"]:
        doc = await server.db.expenses.find_one({"id": expense["id"], "company_id": company_id}, {"_id": 0})
        if not doc:
            continue
        result = await server.db.expenses.delete_one({"id": expense["id"], "company_id": company_id})
        if not result.deleted_count:
            continue
        removed += 1
        await audit_service.log_action(
            user_id=actor["user_id"], user_name=actor["user_name"], action="delete",
            entity_type="expense", entity_id=expense["id"], company_id=company_id,
            details={
                "description": doc.get("description"), "amount": doc.get("amount"), "date": doc.get("date"),
                "snapshot": doc, "restored": False,
                "replaced_by_invoice": {
                    "id": invoice["id"], "number": invoice.get("number"), "supplier": invoice.get("supplier"),
                },
            },
        )
    if not removed:
        return 0
    update: Dict[str, Any] = {}
    if notify:
        update["last_replaced"] = {
            "month": occurrence["month"], "invoice_number": invoice.get("number"), "supplier": invoice.get("supplier"),
            "invoice_amount": occurrence.get("paid_amount"),
            "expense_amount": round(sum(e["amount"] for e in occurrence["expenses"]), 2),
            "switched_to_invoice": rs.item_kind(item) == rs.NO_INVOICE,
            "at": datetime.now(timezone.utc).isoformat(),
        }
    if rs.item_kind(item) == rs.NO_INVOICE:
        update.update({"kind": rs.INVOICE, "auto_record": False})
    if not rs.has_supplier_eik(item) and not item.get("supplier_name"):
        full = await server.db.invoices.find_one({"id": invoice["id"]}, {"_id": 0, "supplier": 1, "supplier_eik": 1})
        if full:
            update.update({"supplier_name": full.get("supplier"), "supplier_eik": full.get("supplier_eik")})
    if update:
        await server.db.recurring_expenses.update_one({"id": item["id"], "company_id": company_id}, {"$set": update})
    return removed


async def _record_expense(
    company_id: str, item: dict, month_key: str, amount: float, day: date, user_id: str,
) -> Optional[dict]:
    """The month's off-book expense of a recurring expense - one per month
    (a unique index guards it against two at once)."""
    existing = await server.db.expenses.find_one(
        {"company_id": company_id, "recurring_id": item["id"], "recurring_month": month_key}, {"_id": 0},
    )
    if existing:
        return None
    expense = NonInvoiceExpense(
        user_id=user_id, company_id=company_id, description=item["description"], amount=round(amount, 2),
        date=day.isoformat(), recurring_id=item["id"], recurring_month=month_key,
    )
    try:
        await server.db.expenses.insert_one(expense.model_dump())
    except DuplicateKeyError:
        return None
    return expense.model_dump()


async def maintain_company(company_id: Optional[str], actor: Optional[dict] = None) -> Dict[str, int]:
    """Brings the recurring expenses' recent months up to date (see the
    module docstring). Safe to run any number of times."""
    done = {"recorded": 0, "replaced": 0}
    if not company_id:
        return done
    items = await _items(company_id)
    if not items:
        return done
    actor = actor or APP_ACTOR
    scope = await company_data_scope(company_id)
    today = rs.current_day()
    for year, month in _months_to_keep_up(today):
        occurrences = await resolve_company_month(company_id, scope, year, month, items)
        for item in items:
            occurrence = occurrences.get(item["id"])
            if not occurrence:
                continue
            if occurrence["state"] == rs.PAID_BY_INVOICE and occurrence.get("duplicate") and occurrence.get("replace_automatically"):
                done["replaced"] += await _replace_with_invoice(company_id, item, occurrence, actor)
            elif occurrence["state"] == rs.DUE and item.get("auto_record") and rs.item_kind(item) == rs.NO_INVOICE:
                due = date.fromisoformat(occurrence["due_date"])
                # Only days from when "record by itself" was turned on - a
                # month left unanswered before that stays a question.
                if due.isoformat() < str(item.get("auto_record_since") or ""):
                    continue
                recorded = await _record_expense(
                    company_id, item, occurrence["month"], float(item["amount"]), due, item.get("user_id") or actor["user_id"],
                )
                if recorded:
                    done["recorded"] += 1
                    await audit_service.log_action(
                        user_id=APP_ACTOR["user_id"], user_name=APP_ACTOR["user_name"], action="create",
                        entity_type="expense", entity_id=recorded["id"], company_id=company_id,
                        details={"description": recorded["description"], "amount": recorded["amount"],
                                 "date": recorded["date"], "recurring": True},
                    )
        if done["replaced"]:
            items = await _items(company_id)
    return done


async def maintain_quietly(company_id: Optional[str], actor: Optional[dict] = None) -> None:
    """maintain_company for a save that must succeed whatever happens here."""
    try:
        await maintain_company(company_id, actor)
    except Exception:
        logger.exception(f"Recurring expenses upkeep failed for {company_id}")


async def _recurring_tick() -> None:
    company_ids = await server.db.recurring_expenses.distinct("company_id", {"is_active": {"$ne": False}})
    for company_id in company_ids:
        await maintain_quietly(company_id)


async def _recurring_loop():
    while True:
        try:
            await _recurring_tick()
        except Exception as error:
            logger.error(f"Recurring expenses loop error: {error}")
        await asyncio.sleep(3600)


async def start_recurring_expense_loop():
    asyncio.create_task(_recurring_loop())


def _this_month() -> str:
    today = rs.current_day()
    return rs.month_key_of(today.year, today.month)


def _public(item: dict) -> dict:
    return {
        "id": item["id"], "description": item.get("description"), "amount": item.get("amount"),
        "day_of_month": item.get("day_of_month"), "category": item.get("category"),
        "kind": rs.item_kind(item), "supplier_name": item.get("supplier_name"), "supplier_eik": item.get("supplier_eik"),
        "auto_record": bool(item.get("auto_record")) and rs.item_kind(item) == rs.NO_INVOICE,
        "is_active": item.get("is_active", True) is not False, "start_month": rs.first_month(item),
        "interval_months": rs.interval_months(item), "payments_count": rs.payments_count(item),
        "last_month": rs.last_month(item),
    }


# How far back a first payment may be set: an expense the business had
# before it came to the app - its months count in the margins (rent from
# then, not goods) and their invoices are recognized by the supplier.
# Nothing is recorded for them by itself (auto_record_since is today).
START_MONTHS_BACK = 12


def _check_start(month_key: str, unchanged: Optional[str] = None) -> None:
    """A first payment up to START_MONTHS_BACK months ago, or later. One
    already set may stay."""
    if month_key != unchanged and month_key < rs.shift_month(_this_month(), -START_MONTHS_BACK):
        raise HTTPException(status_code=400, detail=f"Първото плащане може да е най-много {START_MONTHS_BACK} месеца назад")


@router.get("/recurring-expenses")
async def get_recurring_expenses(current_user: User = Depends(get_current_user)):
    """The recurring expenses with this month's state of each (and last
    month's, while it still waits for something), and the month's total:
    paid so far and still expected."""
    # Same gate as /budget, whose screen lists them.
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    if not company_id:
        return {"recurring_expenses": [], "month": None, "outlook": None}
    await maintain_quietly(company_id, {"user_id": current_user.user_id, "user_name": current_user.name})
    every_item = await _items(company_id, active_only=False)
    active = [item for item in every_item if item.get("is_active", True) is not False]
    today = rs.current_day()
    (prev_year, prev_month), (year, month) = _months_to_keep_up(today)
    current = await resolve_company_month(company_id, scope, year, month, active)
    previous = await resolve_company_month(company_id, scope, prev_year, prev_month, active)
    open_states = {rs.DUE, rs.PROBABLE, rs.INVOICE_MISSING, rs.AWAITING_INVOICE}
    this_month = rs.month_key_of(year, month)
    next_month = rs.shift_month(this_month, 1)
    settled = {rs.PAID_BY_INVOICE, rs.PAID_BY_EXPENSE, rs.SKIPPED}

    def _order(doc: dict) -> Tuple[bool, int]:
        over = rs.next_due_month(doc, this_month) is None
        return (doc.get("is_active", True) is False or over, int(doc.get("day_of_month") or 1))

    listed = []
    for item in sorted(every_item, key=_order):
        before = previous.get(item["id"])
        waiting = before and (
            before["state"] in open_states or before.get("duplicate_suspected")
            or (before.get("duplicate") and not before.get("replace_automatically"))
        )
        now = current.get(item["id"])
        # The payments still to make: this month's while it is not paid or
        # skipped, and the ones after it.
        upcoming = next_month if now and now["state"] in settled else this_month
        next_key = rs.next_due_month(item, upcoming)
        listed.append({
            **_public(item), "current": now, "previous": before if waiting else None,
            "next_payment": {
                "month": next_key, "due_date": rs.due_date(item, *rs.parse_month(next_key)).isoformat(),
            } if next_key else None,
            # With an end: how many are left.
            "payments_left": rs.payments_from(item, upcoming),
        })
    sees_off_book = get_financial_visibility(current_user)["off_book_expenses"]
    month_outlook = rs.outlook(active, current, today, sees_off_book)
    # Not paid yet - what the rest of the month still brings.
    month_outlook["still_expected"] = round(sum(
        occurrence["expected_amount"] for occurrence in current.values()
        if occurrence["state"] in rs.UNPAID_STATES and (sees_off_book or occurrence["kind"] == rs.INVOICE)
    ), 2)
    return {"recurring_expenses": listed, "month": rs.month_key_of(year, month), "outlook": month_outlook}


async def _clean_supplier(company_id: str, name: Optional[str], eik: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    name = (name or "").strip() or None
    eik = (eik or "").strip() or None
    if name:
        name, _ = await normalize_supplier_name(name, company_id, eik)
    return name, eik


def _check_kind(kind: str, supplier_name: Optional[str], supplier_eik: Optional[str]) -> None:
    if kind == rs.INVOICE and not (supplier_name or supplier_eik):
        raise HTTPException(
            status_code=400,
            detail="Посочи доставчика, от когото идва фактурата - по него програмата я разпознава всеки месец",
        )


@router.post("/recurring-expenses")
async def create_recurring_expense(body: RecurringExpenseIn, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="No company associated")
    supplier_name, supplier_eik = await _clean_supplier(company_id, body.supplier_name, body.supplier_eik)
    _check_kind(body.kind, supplier_name, supplier_eik)
    start_month = body.start_month or rs.start_month_for(body.day_of_month, rs.current_day())
    _check_start(start_month)
    doc = {
        "id": str(uuid.uuid4()), "company_id": company_id, "user_id": current_user.user_id,
        "description": body.description.strip(), "amount": round(body.amount, 2), "day_of_month": body.day_of_month,
        "category": body.category, "kind": body.kind, "supplier_name": supplier_name, "supplier_eik": supplier_eik,
        "auto_record": body.auto_record and body.kind == rs.NO_INVOICE,
        "auto_record_since": rs.current_day().isoformat() if body.auto_record else None, "is_active": True,
        "start_month": start_month, "interval_months": body.interval_months, "payments_count": body.payments_count,
        "skipped_months": [], "rejected_matches": [], "created_at": datetime.now(timezone.utc),
    }
    await server.db.recurring_expenses.insert_one(dict(doc))
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="create",
        entity_type="recurring_expense", entity_id=doc["id"], company_id=company_id,
        details={"description": doc["description"], "amount": doc["amount"], "kind": doc["kind"]},
    )
    await maintain_quietly(company_id, {"user_id": current_user.user_id, "user_name": current_user.name})
    return {"message": "Recurring expense created", "id": doc["id"], "recurring_expense": _public(doc)}


async def _owned_item(item_id: str, company_id: Optional[str]) -> dict:
    item = await server.db.recurring_expenses.find_one({"id": item_id, "company_id": company_id}, {"_id": 0}) if company_id else None
    if not item:
        raise HTTPException(status_code=404, detail="Периодичният разход не е намерен")
    return item


# Fields an edit may empty (null): the rest keep their value when null.
CLEARABLE = ("supplier_name", "supplier_eik", "category", "payments_count")


@router.put("/recurring-expenses/{item_id}")
async def update_recurring_expense(item_id: str, body: RecurringExpenseUpdateIn, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    item = await _owned_item(item_id, company_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("start_month"):
        _check_start(changes["start_month"], unchanged=rs.first_month(item))
    if "description" in changes and changes["description"] is not None:
        changes["description"] = changes["description"].strip()
    if "amount" in changes and changes["amount"] is not None:
        changes["amount"] = round(changes["amount"], 2)
    if "supplier_name" in changes or "supplier_eik" in changes:
        changes["supplier_name"], changes["supplier_eik"] = await _clean_supplier(
            company_id, changes.get("supplier_name", item.get("supplier_name")),
            changes.get("supplier_eik", item.get("supplier_eik")),
        )
    merged = {**item, **{k: v for k, v in changes.items() if v is not None or k in CLEARABLE}}
    kind = rs.item_kind(merged)
    _check_kind(kind, merged.get("supplier_name"), merged.get("supplier_eik"))
    if kind == rs.INVOICE:
        changes["auto_record"] = False
    if changes.get("auto_record") and not item.get("auto_record"):
        changes["auto_record_since"] = rs.current_day().isoformat()
    updates = {k: v for k, v in changes.items() if v is not None or k in CLEARABLE}
    if updates:
        await server.db.recurring_expenses.update_one({"id": item_id, "company_id": company_id}, {"$set": updates})
        await audit_service.log_action(
            user_id=current_user.user_id, user_name=current_user.name, action="update",
            entity_type="recurring_expense", entity_id=item_id, company_id=company_id,
            details={"description": merged.get("description"), "changes": sorted(updates)},
        )
    await maintain_quietly(company_id, {"user_id": current_user.user_id, "user_name": current_user.name})
    return {"recurring_expense": _public(await _owned_item(item_id, company_id))}


@router.delete("/recurring-expenses/{expense_id}")
async def delete_recurring_expense(expense_id: str, current_user: User = Depends(get_current_user)):
    """Stops the recurring expense; what it already recorded stays - those
    were real payments."""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    result = await server.db.recurring_expenses.delete_one({"id": expense_id, "company_id": company_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return {"message": "Deleted"}


async def _occurrence(company_id: str, item: dict, month_key: str) -> dict:
    try:
        year, month = rs.parse_month(month_key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Невалиден месец")
    if month_key < rs.first_month(item):
        raise HTTPException(status_code=400, detail="Периодичният разход започва от по-късен месец")
    if not rs.is_due_month(item, month_key):
        raise HTTPException(status_code=400, detail="В този месец няма плащане по този разход")
    scope = await company_data_scope(company_id)
    occurrences = await resolve_company_month(company_id, scope, year, month, [item])
    return occurrences[item["id"]]


@router.post("/recurring-expenses/{item_id}/months/{month_key}/record")
async def record_recurring_month(
    item_id: str, month_key: str, body: Optional[RecordMonthIn] = None, current_user: User = Depends(get_current_user),
):
    """"Paid - record it": the month's off-book expense, on its day (or
    today, when paid ahead of it)."""
    require_permission(current_user, "manage_budget")
    require_permission(current_user, "add_expenses")
    company_id, _ = await get_company_scope(current_user)
    item = await _owned_item(item_id, company_id)
    occurrence = await _occurrence(company_id, item, month_key)
    if occurrence["state"] in (rs.PAID_BY_INVOICE, rs.PAID_BY_EXPENSE):
        raise HTTPException(status_code=409, detail="Този месец вече е платен")
    day = min(date.fromisoformat(occurrence["due_date"]), rs.current_day())
    amount = body.amount if body and body.amount else float(item["amount"])
    recorded = await _record_expense(company_id, item, month_key, amount, day, current_user.user_id)
    if not recorded:
        raise HTTPException(status_code=409, detail="Този месец вече е записан")
    await server.db.recurring_expenses.update_one({"id": item_id}, {"$pull": {"skipped_months": month_key}})
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="create",
        entity_type="expense", entity_id=recorded["id"], company_id=company_id,
        details={"description": recorded["description"], "amount": recorded["amount"], "date": recorded["date"], "recurring": True},
    )
    return {"expense": recorded, "occurrence": await _occurrence(company_id, item, month_key)}


@router.post("/recurring-expenses/{item_id}/months/{month_key}/skip")
async def skip_recurring_month(item_id: str, month_key: str, current_user: User = Depends(get_current_user)):
    """Not paid this month on purpose - nothing to record or wait for."""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    item = await _owned_item(item_id, company_id)
    await _occurrence(company_id, item, month_key)
    await server.db.recurring_expenses.update_one({"id": item_id}, {"$addToSet": {"skipped_months": month_key}})
    return {"occurrence": await _occurrence(company_id, await _owned_item(item_id, company_id), month_key)}


@router.post("/recurring-expenses/{item_id}/months/{month_key}/unskip")
async def unskip_recurring_month(item_id: str, month_key: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    item = await _owned_item(item_id, company_id)
    await _occurrence(company_id, item, month_key)
    await server.db.recurring_expenses.update_one({"id": item_id}, {"$pull": {"skipped_months": month_key}})
    return {"occurrence": await _occurrence(company_id, await _owned_item(item_id, company_id), month_key)}


@router.post("/recurring-expenses/{item_id}/months/{month_key}/match")
async def answer_recurring_match(
    item_id: str, month_key: str, body: MatchAnswerIn, current_user: User = Depends(get_current_user),
):
    """The owner's answer to "is this it?" - for a likely match (an
    expense or invoice not tied to the month), or for an invoice that came
    for a month already recorded without one.

    Yes: the record pays the month - an expense is tied to it, an invoice
    too, and an invoice replaces the month's off-book record. No: it is a
    different cost, never offered for this expense again."""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    item = await _owned_item(item_id, company_id)
    occurrence = await _occurrence(company_id, item, month_key)
    offered = {(occurrence["match"] or {}).get("source"): (occurrence["match"] or {}).get("id")}
    duplicate_invoice_ids = {inv["id"] for inv in occurrence["invoices"]} if occurrence.get("duplicate") else set()
    if offered.get(body.source) != body.id and not (body.source == "invoice" and body.id in duplicate_invoice_ids):
        raise HTTPException(status_code=409, detail="Този въпрос вече не е актуален - обнови списъка")
    actor = {"user_id": current_user.user_id, "user_name": current_user.name}
    # Tying an expense to the month, or an invoice replacing its off-book
    # record, changes expenses - the right to do that is needed up front.
    if body.same and (body.source == "expense" or occurrence["expenses"]):
        require_permission(current_user, "add_expenses")

    if not body.same:
        await server.db.recurring_expenses.update_one(
            {"id": item_id}, {"$addToSet": {"rejected_matches": body.id}},
        )
    elif body.source == "expense":
        await server.db.expenses.update_one(
            {"id": body.id, "company_id": company_id, "recurring_id": None},
            {"$set": {"recurring_id": item_id, "recurring_month": month_key}},
        )
    else:
        await server.db.invoices.update_one(
            {"id": body.id, "company_id": company_id},
            {"$set": {"recurring_id": item_id, "recurring_month": month_key}},
        )
        # An invoice came for it: expected with one from now on, from this
        # supplier, unless the expense already names its own.
        invoice = await server.db.invoices.find_one({"id": body.id}, {"_id": 0, "supplier": 1, "supplier_eik": 1})
        updates: Dict[str, Any] = {"kind": rs.INVOICE, "auto_record": False}
        if invoice and not item.get("supplier_name") and not rs.has_supplier_eik(item):
            updates.update({"supplier_name": invoice.get("supplier"), "supplier_eik": invoice.get("supplier_eik")})
        await server.db.recurring_expenses.update_one({"id": item_id}, {"$set": updates})
        refreshed = await _occurrence(company_id, await _owned_item(item_id, company_id), month_key)
        if refreshed["state"] == rs.PAID_BY_INVOICE and refreshed.get("duplicate"):
            await _replace_with_invoice(company_id, await _owned_item(item_id, company_id), refreshed, actor, notify=False)
    return {"occurrence": await _occurrence(company_id, await _owned_item(item_id, company_id), month_key)}


async def recurring_expense_signals(company_id: Optional[str], current_user: User) -> List[dict]:
    """The daily review's questions about recurring expenses, for whoever
    keeps them (manage_budget): paid or not, is this it, an invoice late,
    the same month paid twice - and a notice when an invoice replaced a
    month's off-book record."""
    perms = set(current_user.permissions or [])
    if not company_id or "manage_budget" not in perms:
        return []
    items = await _items(company_id)
    if not items:
        return []
    scope = await company_data_scope(company_id)
    today = rs.current_day()
    months = _months_to_keep_up(today)
    resolved = [(year, month, await resolve_company_month(company_id, scope, year, month, items)) for year, month in months]
    by_id = {item["id"]: item for item in items}

    def _waits_for_upkeep(item_id: str, occ: dict) -> bool:
        item = by_id.get(item_id) or {}
        if occ["state"] == rs.DUE and item.get("auto_record") and rs.item_kind(item) == rs.NO_INVOICE:
            return True
        return bool(occ.get("duplicate") and occ.get("replace_automatically"))

    # Something upkeep settles by itself (a record due on its day, an
    # invoice that replaces a record) is settled now, not asked about.
    if any(_waits_for_upkeep(item_id, occ) for _, _, occurrences in resolved for item_id, occ in occurrences.items()):
        await maintain_quietly(company_id)
        items = await _items(company_id)
        resolved = [(year, month, await resolve_company_month(company_id, scope, year, month, items)) for year, month in months]

    can_record = "add_expenses" in perms
    signals: List[dict] = []
    for _, _, occurrences in resolved:
        for item in items:
            occ = occurrences.get(item["id"])
            if not occ:
                continue
            what = item["description"]
            when = _signal_month(occ["month"])
            base = {
                "route": "/budget", "recurring_id": item["id"], "recurring_month": occ["month"],
                "fingerprint": f"{item['id']}:{occ['month']}:{occ['state']}",
            }
            if occ["state"] == rs.DUE:
                signals.append({
                    **base, "key": "recurring_due", "severity": "info", "priority": 44,
                    "title": tr(f"{what} {tr_eur(occ['expected_amount'])} за {when} - платен ли е?",
                                f"{what} {tr_eur(occ['expected_amount'])} for {when} - is it paid?"),
                    "detail": tr(
                        f"Плаща се на {_signal_day(occ['due_date'])}, без фактура. Ако е платен, запиши го като разход - "
                        "тогава влиза в разходите и печалбата за месеца.",
                        f"It is paid on {_signal_day(occ['due_date'])}, without an invoice. If it is paid, record it as an "
                        "expense - then it counts in the month's expenses and profit.",
                    ),
                    "actions": ["recurring_record", "recurring_skip"] if can_record else ["recurring_skip", "snooze"],
                })
            elif occ["state"] == rs.PROBABLE:
                match = occ["match"]
                if match["source"] == "expense":
                    seen = tr(f"разход „{match.get('description')}“ {tr_eur(match['amount'])} на {_signal_day(match.get('date'))}",
                              f"an expense \"{match.get('description')}\" of {tr_eur(match['amount'])} on {_signal_day(match.get('date'))}")
                else:
                    seen = tr(f"фактура № {match.get('number')} от {match.get('supplier')} за {tr_eur(match['amount'])} "
                              f"на {_signal_day(match.get('date'))}",
                              f"invoice No. {match.get('number')} from {match.get('supplier')} for {tr_eur(match['amount'])} "
                              f"on {_signal_day(match.get('date'))}")
                signals.append({
                    **base, "key": "recurring_match", "severity": "info", "priority": 46,
                    "title": tr(f"{what} за {when} - това ли е?", f"{what} for {when} - is this it?"),
                    "detail": tr(f"Има {seen}. Ако е същото плащане, отбележи го - иначе разходът би се отчел два пъти.",
                                 f"There is {seen}. If it is the same payment, mark it - otherwise the expense would count twice."),
                    "match_source": match["source"], "match_id": match["id"],
                    "actions": ["recurring_yes", "recurring_no"],
                })
            elif occ["state"] == rs.INVOICE_MISSING:
                supplier = tr(f" от {item['supplier_name']}", f" from {item['supplier_name']}") if item.get("supplier_name") else ""
                signals.append({
                    **base, "key": "recurring_invoice_missing", "severity": "info", "priority": 36,
                    "route": "/(tabs)/scan",
                    "title": tr(f"Липсва фактурата за {what.lower()} за {when}", f"The invoice for {what} for {when} is missing"),
                    "detail": tr(
                        f"Очаква се{supplier} около {_signal_day(occ['due_date'])} (обичайно {tr_eur(occ['expected_amount'])}). "
                        "Въведи я, когато дойде - тя е разходът, програмата не записва отделен.",
                        f"Expected{supplier} around {_signal_day(occ['due_date'])} (usually {tr_eur(occ['expected_amount'])}). "
                        "Enter it when it comes - it is the expense, the app records no separate one.",
                    ),
                    "actions": ["recurring_skip", "snooze"],
                })
            elif (occ["state"] == rs.PAID_BY_INVOICE and occ.get("duplicate") and not occ.get("replace_automatically")) \
                    or occ.get("duplicate_suspected"):
                invoice = occ["match"] if occ.get("duplicate_suspected") else occ["invoices"][0]
                recorded = sum(e["amount"] for e in occ["expenses"])
                signals.append({
                    **base, "key": "recurring_duplicate", "severity": "warning", "priority": 58,
                    "title": tr(f"{what} за {when} - записан два пъти?", f"{what} for {when} - recorded twice?"),
                    "detail": tr(
                        f"Има фактура № {invoice.get('number')} от {invoice.get('supplier')} за {tr_eur(invoice['amount'])} "
                        f"и записан разход без фактура за {tr_eur(recorded)}. Ако са едно и също, остави фактурата.",
                        f"There is invoice No. {invoice.get('number')} from {invoice.get('supplier')} for {tr_eur(invoice['amount'])} "
                        f"and an expense recorded without an invoice for {tr_eur(recorded)}. If they are the same, keep the invoice.",
                    ),
                    "match_source": "invoice", "match_id": invoice["id"],
                    "actions": ["recurring_yes", "recurring_no"],
                })

    cutoff = datetime.now(timezone.utc) - timedelta(days=REPLACED_NOTICE_DAYS)
    for item in items:
        notice = item.get("last_replaced")
        if not notice:
            continue
        try:
            at = datetime.fromisoformat(str(notice.get("at")))
        except ValueError:
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        if at < cutoff:
            continue
        switched = (tr(" Занапред се очаква с фактура.", " From now on it is expected with an invoice.")
                    if notice.get("switched_to_invoice") else "")
        replaced_amount = tr_eur(float(notice.get("expense_amount") or 0))
        signals.append({
            "key": "recurring_replaced", "severity": "info", "priority": 32, "route": "/budget",
            "fingerprint": f"{item['id']}:{notice.get('month')}:{notice.get('at')}",
            "title": tr(f"{item['description']} за {_signal_month(notice['month'])} дойде с фактура",
                        f"{item['description']} for {_signal_month(notice['month'])} came with an invoice"),
            "detail": tr(
                f"Фактура № {notice.get('invoice_number')} от {notice.get('supplier')} замени записания без фактура "
                f"разход ({replaced_amount}), за да не се брои два пъти.{switched}",
                f"Invoice No. {notice.get('invoice_number')} from {notice.get('supplier')} replaced the expense recorded "
                f"without an invoice ({replaced_amount}), so it is not counted twice.{switched}",
            ),
            "actions": ["dismiss"],
        })
    return signals

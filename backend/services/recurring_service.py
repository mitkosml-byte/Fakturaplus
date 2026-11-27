"""Recurring expenses: what a business pays regularly and knows in
advance - rent, a subscription, insurance, a utility bill. Most are paid
every month; some every few months (insurance in quarterly installments,
a yearly licence) - every `interval_months` months from the month of the
first payment, and some only so many times (installments, a lease:
`payments_count`).

Each one says whether an invoice comes for it:

- "invoice": the supplier's invoice IS the expense. The app never records
  anything for it - it waits for the month's invoice from that supplier,
  shows the month as paid once the invoice is entered, and reminds when it
  is late.
- "no_invoice": nothing will be scanned for it, so the app records the
  off-book expense itself - when the owner says it is paid, or on its day
  when the owner chose that.

One payment of one recurring expense - its month - is an occurrence; a
month without a payment of it has none. Whatever already pays
an occurrence is looked for first, so the same cost is never counted
twice: an invoice from its supplier, an invoice or expense linked to it,
or - when it is only a guess (the same amount, a similar description) - a
question to the owner instead of a second record. An invoice that arrives
for a month already recorded without one replaces that record
(routers/recurring.py).

This module only reads: load_month_records gathers a month's records,
resolve_month says what each occurrence is, outlook sums a month up for
the projections (budget, forecast). Generic - any cost, any business."""
import difflib
import re
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from services.business_calendar import Period, add_months, business_day, today_local

INVOICE = "invoice"
NO_INVOICE = "no_invoice"
KINDS = (INVOICE, NO_INVOICE)

# A month's invoice is late this many days after its expected day.
INVOICE_GRACE_DAYS = 5
# "The same amount" for a guessed match: within 1% (and at least a cent).
AMOUNT_TOLERANCE = 0.01
# The same cost on an invoice can carry VAT the off-book amount did not
# (800 € paid, 960 € invoiced): a match by amount also tries these rates.
VAT_FACTORS = (1.0, 1.2, 1.09)
# For a business that deducts VAT: an invoice still to come for a recurring
# cost is taken as its usual amount with VAT at the standard rate in it.
STANDARD_VAT_FACTOR = 1.2
# An invoice from the supplier replaces the month's off-book record by
# itself only when the two amounts are this close; otherwise the owner is
# asked whether they are the same cost.
REPLACE_BAND = (0.65, 1.35)

# How often it is paid: every month, or every few months - any number of
# months up to this. And an end, when it has one: a number of payments.
MAX_INTERVAL_MONTHS = 36
MAX_PAYMENTS = 600

# Mirrors of server.py's constants (services never import server.py).
CREDIT_NOTE = "credit_note"
SCHEDULE_WAGES = "schedule_wages"

# What an occurrence is.
PAID_BY_INVOICE = "paid_by_invoice"
PAID_BY_EXPENSE = "paid_by_expense"
SKIPPED = "skipped"
PROBABLE = "probable"
UPCOMING = "upcoming"
AWAITING_INVOICE = "awaiting_invoice"
INVOICE_MISSING = "invoice_missing"
DUE = "due"
UNPAID_STATES = {UPCOMING, AWAITING_INVOICE, INVOICE_MISSING, DUE}


def current_day() -> date:
    """Today on the business's clock - one place tests can move."""
    return today_local()


def _key(value: Any) -> str:
    return re.sub(r"[^\w]", "", str(value or "").upper())


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def item_kind(item: dict) -> str:
    kind = item.get("kind")
    return kind if kind in KINDS else NO_INVOICE


def month_key_of(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def parse_month(key: str) -> Tuple[int, int]:
    """'YYYY-MM' -> (year, month); ValueError for anything else."""
    match = re.fullmatch(r"(\d{4})-(\d{2})", str(key or ""))
    if not match or not 1 <= int(match.group(2)) <= 12:
        raise ValueError(key)
    return int(match.group(1)), int(match.group(2))


def due_date(item: dict, year: int, month: int) -> date:
    return date(year, month, max(1, min(28, int(item.get("day_of_month") or 1))))


def start_month_for(day_of_month: int, today: date) -> str:
    """A new recurring expense starts with its first day from today on -
    a day already gone this month was paid (or not) before it existed."""
    year, month = today.year, today.month
    if today.day > day_of_month:
        year, month = add_months(year, month, 1)
    return month_key_of(year, month)


def first_month(item: dict) -> str:
    """The month of its first payment the app follows."""
    stored = str(item.get("start_month") or "")
    try:
        parse_month(stored)
        return stored
    except ValueError:  # none saved (or unreadable): from when it was created
        created = business_day(item.get("created_at")) or current_day()
        return start_month_for(int(item.get("day_of_month") or 1), created)


def shift_month(key: str, months: int) -> str:
    year, month = parse_month(key)
    return month_key_of(*add_months(year, month, months))


def months_between(first: str, second: str) -> int:
    """Months from `first` to `second` - negative when `second` is before."""
    (first_year, first_month_number), (second_year, second_month_number) = parse_month(first), parse_month(second)
    return (second_year - first_year) * 12 + (second_month_number - first_month_number)


def interval_months(item: dict) -> int:
    """Every how many months it is paid - 1 for every month."""
    try:
        months = int(item.get("interval_months") or 1)
    except (TypeError, ValueError):
        return 1
    return max(1, min(MAX_INTERVAL_MONTHS, months))


def payments_count(item: dict) -> Optional[int]:
    """How many payments it has in all - None for no end."""
    try:
        count = int(item.get("payments_count") or 0)
    except (TypeError, ValueError):
        return None
    return count if count > 0 else None


def _payments_before(item: dict, key: str) -> int:
    """How many of its payments fall in the months before `key`."""
    steps = months_between(first_month(item), key)
    return 0 if steps <= 0 else -(-steps // interval_months(item))


def is_due_month(item: dict, key: str) -> bool:
    """Whether a payment of it falls in the month: from its first month
    on, every interval_months months, up to its last payment."""
    steps = months_between(first_month(item), key)
    if steps < 0 or steps % interval_months(item):
        return False
    count = payments_count(item)
    return count is None or steps // interval_months(item) < count


def next_due_month(item: dict, from_key: str) -> Optional[str]:
    """Its first payment month from `from_key` on - None once its payments are over."""
    done = _payments_before(item, from_key)
    count = payments_count(item)
    if count is not None and done >= count:
        return None
    return shift_month(first_month(item), done * interval_months(item))


def last_month(item: dict) -> Optional[str]:
    """The month of its last payment - None when it has no end."""
    count = payments_count(item)
    if count is None:
        return None
    return shift_month(first_month(item), (count - 1) * interval_months(item))


def payments_from(item: dict, key: str) -> Optional[int]:
    """How many of its payments fall in `key` and the months after - None
    when it has no end."""
    count = payments_count(item)
    if count is None:
        return None
    return max(0, count - _payments_before(item, key))


def has_supplier_eik(item: dict) -> bool:
    return bool(_digits(item.get("supplier_eik")))


def supplier_matches(item: dict, invoice: dict) -> bool:
    """The invoice is from the recurring expense's supplier: by EIK when
    both have one, else by name (case, spacing and punctuation aside)."""
    item_eik, invoice_eik = _digits(item.get("supplier_eik")), _digits(invoice.get("supplier_eik"))
    if item_eik and invoice_eik:
        return item_eik == invoice_eik
    name = _key(item.get("supplier_name"))
    return bool(name) and name == _key(invoice.get("supplier"))


def same_amount(a: Any, b: Any) -> bool:
    a, b = float(a or 0), float(b or 0)
    return abs(a - b) <= max(0.01, AMOUNT_TOLERANCE * max(abs(a), abs(b)))


def same_amount_maybe_with_vat(expected: Any, actual: Any) -> bool:
    return any(same_amount(float(expected or 0) * factor, actual) for factor in VAT_FACTORS)


def similar_text(a: Any, b: Any) -> bool:
    ka, kb = _key(a), _key(b)
    if not ka or not kb:
        return False
    if min(len(ka), len(kb)) >= 4 and (ka in kb or kb in ka):
        return True
    return difflib.SequenceMatcher(None, ka, kb).ratio() >= 0.6


def within_replace_band(invoice_amount: float, recorded_amount: float) -> bool:
    if recorded_amount <= 0:
        return False
    ratio = invoice_amount / recorded_amount
    return REPLACE_BAND[0] <= ratio <= REPLACE_BAND[1]


INVOICE_FIELDS = {
    "_id": 0, "id": 1, "supplier": 1, "supplier_eik": 1, "total_amount": 1, "vat_amount": 1, "invoice_number": 1,
    "date": 1, "document_type": 1, "asset_id": 1, "recurring_id": 1, "recurring_month": 1, "items.name": 1,
}
EXPENSE_FIELDS = {
    "_id": 0, "id": 1, "description": 1, "amount": 1, "date": 1, "kind": 1, "recurring_id": 1, "recurring_month": 1,
}


async def load_month_records(db, scope: dict, item_ids: List[str], year: int, month: int) -> Dict[str, list]:
    """The month's invoices and off-book expenses (by their date), plus any
    linked to one of these recurring expenses for this month wherever its
    date has been moved since. Credit notes, fixed-asset invoices (expensed
    through depreciation) and wages are never a month's payment."""
    period = Period.month(year, month)
    key = month_key_of(year, month)
    invoices = await db.invoices.find({**scope, "date": period.datetime_filter()}, INVOICE_FIELDS).to_list(None)
    expenses = await db.expenses.find({**scope, "date": period.text_filter()}, EXPENSE_FIELDS).to_list(None)
    if item_ids:
        linked = {"recurring_id": {"$in": item_ids}, "recurring_month": key}
        invoices += await db.invoices.find({**scope, **linked}, INVOICE_FIELDS).to_list(None)
        expenses += await db.expenses.find({**scope, **linked}, EXPENSE_FIELDS).to_list(None)
    unique_invoices = {doc["id"]: doc for doc in invoices if doc.get("id")}
    unique_expenses = {doc["id"]: doc for doc in expenses if doc.get("id")}
    return {
        "invoices": [
            doc for doc in unique_invoices.values()
            if doc.get("document_type") != CREDIT_NOTE and not doc.get("asset_id")
        ],
        "expenses": [doc for doc in unique_expenses.values() if doc.get("kind") != SCHEDULE_WAGES],
    }


def _invoice_summary(invoice: dict) -> dict:
    day = business_day(invoice.get("date"))
    return {
        "id": invoice["id"], "number": invoice.get("invoice_number"), "supplier": invoice.get("supplier"),
        "amount": round(float(invoice.get("total_amount") or 0), 2), "date": day.isoformat() if day else None,
        # Its VAT: a business that deducts VAT counts the cost without it (period_costs).
        "vat": round(float(invoice.get("vat_amount") or 0), 2),
    }


def _expense_summary(expense: dict) -> dict:
    return {
        "id": expense["id"], "description": expense.get("description"),
        "amount": round(float(expense.get("amount") or 0), 2), "date": expense.get("date"),
    }


def _invoice_mentions(invoice: dict, text: Any) -> bool:
    return any(similar_text(text, line.get("name")) for line in (invoice.get("items") or []) if isinstance(line, dict))


def resolve_month(
    items: List[dict], year: int, month: int, records: Dict[str, list], today: Optional[date] = None,
) -> Dict[str, dict]:
    """What each recurring expense's occurrence of this month is, keyed by
    its id - for the expenses with a payment in the month (is_due_month).

    In order: invoices that pay it (linked to it, or from its supplier -
    each invoice to the one expense of that supplier closest in amount),
    expenses linked to it, a month skipped on purpose, a likely match the
    owner has to confirm, and otherwise not paid yet (upcoming, awaiting
    its invoice, its invoice late, or due)."""
    today = today or current_day()
    key = month_key_of(year, month)
    active = [item for item in items if is_due_month(item, key)]
    by_id = {item["id"]: item for item in active}
    invoices, expenses = records["invoices"], records["expenses"]
    paying_invoices: Dict[str, List[dict]] = {item_id: [] for item_id in by_id}
    paying_expenses: Dict[str, List[dict]] = {item_id: [] for item_id in by_id}
    used: set = set()

    for invoice in invoices:
        linked_to = invoice.get("recurring_id")
        if linked_to:
            used.add(invoice["id"])
            if linked_to in by_id and invoice.get("recurring_month") == key:
                paying_invoices[linked_to].append(invoice)
    for expense in expenses:
        linked_to = expense.get("recurring_id")
        if linked_to:
            used.add(expense["id"])
            if linked_to in by_id and expense.get("recurring_month") == key:
                paying_expenses[linked_to].append(expense)

    for invoice in sorted(invoices, key=lambda doc: str(doc.get("id"))):
        if invoice["id"] in used:
            continue
        candidates = [
            item for item in active
            if supplier_matches(item, invoice) and invoice["id"] not in set(item.get("rejected_matches") or [])
        ]
        if not candidates:
            continue
        amount = float(invoice.get("total_amount") or 0)
        best = min(candidates, key=lambda item: (abs(float(item.get("amount") or 0) - amount), item["id"]))
        paying_invoices[best["id"]].append(invoice)
        used.add(invoice["id"])

    skipped_of = {item["id"]: set(item.get("skipped_months") or []) for item in active}
    occurrences: Dict[str, dict] = {}
    for item in sorted(active, key=lambda doc: (int(doc.get("day_of_month") or 1), str(doc.get("id")))):
        item_id = item["id"]
        due = due_date(item, year, month)
        expected = round(float(item.get("amount") or 0), 2)
        occurrence: Dict[str, Any] = {
            "recurring_id": item_id, "month": key, "due_date": due.isoformat(), "expected_amount": expected,
            "kind": item_kind(item), "invoices": [_invoice_summary(doc) for doc in paying_invoices[item_id]],
            "expenses": [_expense_summary(doc) for doc in paying_expenses[item_id]],
            "paid_amount": None, "match": None,
        }
        if paying_invoices[item_id]:
            occurrence["state"] = PAID_BY_INVOICE
            invoiced = sum(float(doc.get("total_amount") or 0) for doc in paying_invoices[item_id])
            occurrence["paid_amount"] = round(invoiced, 2)
            if paying_expenses[item_id]:
                # The same month paid twice: the invoice and an off-book
                # record. Close amounts are the same cost - replaced at once;
                # otherwise the owner says.
                recorded = sum(float(doc.get("amount") or 0) for doc in paying_expenses[item_id])
                occurrence["duplicate"] = True
                occurrence["replace_automatically"] = within_replace_band(invoiced, recorded)
        elif paying_expenses[item_id]:
            occurrence["state"] = PAID_BY_EXPENSE
            occurrence["paid_amount"] = round(sum(float(doc.get("amount") or 0) for doc in paying_expenses[item_id]), 2)
            # Recorded without an invoice - and an invoice that looks like
            # the same payment came after all (the expense names no supplier
            # EIK to tell): asked, never counted twice in silence.
            invoice_match = _probable_invoice(item, invoices, used)
            if invoice_match:
                used.add(invoice_match["id"])
                occurrence["match"] = invoice_match
                occurrence["duplicate_suspected"] = True
        elif key in skipped_of[item_id]:
            occurrence["state"] = SKIPPED
        else:
            match = _probable_expense(item, expenses, used) or _probable_invoice(item, invoices, used)
            if match:
                used.add(match["id"])
                occurrence["state"] = PROBABLE
                occurrence["match"] = match
            elif due > today:
                occurrence["state"] = UPCOMING
            elif item_kind(item) == INVOICE:
                late = today > due + timedelta(days=INVOICE_GRACE_DAYS)
                occurrence["state"] = INVOICE_MISSING if late else AWAITING_INVOICE
            else:
                occurrence["state"] = DUE
        occurrences[item_id] = occurrence
    return occurrences


def _probable_expense(item: dict, expenses: List[dict], used: set) -> Optional[dict]:
    """An off-book expense not tied to anything that looks like this
    month's payment: the same amount and a similar description. Only ever
    a question for the owner."""
    rejected = set(item.get("rejected_matches") or [])
    expected = float(item.get("amount") or 0)
    for expense in sorted(expenses, key=lambda doc: str(doc.get("date") or "")):
        if expense["id"] in used or expense["id"] in rejected or expense.get("recurring_id"):
            continue
        if same_amount(expected, expense.get("amount")) and similar_text(item.get("description"), expense.get("description")):
            return {"source": "expense", **_expense_summary(expense)}
    return None


def _probable_invoice(item: dict, invoices: List[dict], used: set) -> Optional[dict]:
    """An invoice not tied to anything that looks like this month's
    payment - when the expense names no supplier EIK to tell its invoices
    apart: the same amount (VAT added or not), or lines that name it at a
    similar amount. Only ever a question for the owner."""
    if has_supplier_eik(item):
        return None
    rejected = set(item.get("rejected_matches") or [])
    expected = float(item.get("amount") or 0)
    for invoice in sorted(invoices, key=lambda doc: str(doc.get("id"))):
        if invoice["id"] in used or invoice["id"] in rejected or invoice.get("recurring_id"):
            continue
        amount = float(invoice.get("total_amount") or 0)
        named = _invoice_mentions(invoice, item.get("description")) and within_replace_band(amount, expected)
        if same_amount_maybe_with_vat(expected, amount) or named:
            return {"source": "invoice", **_invoice_summary(invoice)}
    return None


def outlook(
    items: List[dict], occurrences: Dict[str, dict], through: date, include_off_book: bool,
    net_of_vat: bool = False,
) -> Dict[str, float]:
    """The month's recurring expenses for a projection of its expenses:

    - paid_so_far: what they already added to the month's records dated
      through `through` (so a pace over the days so far can leave it out);
    - month_total: the whole month of them - what was paid, or else what
      is still expected (nothing for a month skipped).

    Off-book records only for a viewer who sees off-book expenses; an
    expense without an invoice, still to come, likewise. With net_of_vat,
    an invoice counts without its VAT (a business that deducts it): the
    money that leaves is with VAT, the cost is not."""
    paid_so_far = 0.0
    kinds = {item["id"]: item_kind(item) for item in items}
    for occurrence in occurrences.values():
        paid_so_far += sum(
            _amount(record, net_of_vat) for record in _records(occurrence, include_off_book)
            if record.get("date") and str(record["date"]) <= through.isoformat()
        )
    month_total = month_cost(occurrences, kinds, include_off_book, net_of_vat)
    return {"paid_so_far": round(paid_so_far, 2), "month_total": round(month_total, 2)}


def _records(occurrence: dict, include_off_book: bool) -> List[dict]:
    """What paid an occurrence - a likely match counted as paying it until
    the owner says otherwise: its invoices, and its off-book records for a
    viewer who sees them."""
    records = list(occurrence["invoices"])
    if include_off_book:
        records += occurrence["expenses"]
    match = occurrence.get("match")
    if match and (match["source"] == "invoice" or include_off_book):
        records.append(match)
    return records


def _amount(record: dict, net_of_vat: bool) -> float:
    """A record's amount - less its VAT (an invoice's) when the VAT is deducted."""
    amount = float(record.get("amount") or 0)
    return amount - float(record.get("vat") or 0) if net_of_vat else amount


def _record_day(record: dict) -> Optional[date]:
    try:
        return business_day(record.get("date"))
    except (TypeError, ValueError):
        return None


def month_cost(occurrences: Dict[str, dict], kinds: Dict[str, str], include_off_book: bool,
               net_of_vat: bool = False) -> float:
    """The whole month of recurring costs: what paid each, or else what is
    still expected (nothing for a month skipped). An invoice still to come,
    for a business that deducts VAT: its usual amount taken as including
    VAT at the standard rate, until the invoice itself says."""
    total = 0.0
    for item_id, occurrence in occurrences.items():
        records = _records(occurrence, include_off_book)
        if records:
            total += sum(_amount(record, net_of_vat) for record in records)
        elif occurrence["state"] in UNPAID_STATES and (include_off_book or kinds.get(item_id) == INVOICE):
            expected = float(occurrence["expected_amount"] or 0)
            total += expected / STANDARD_VAT_FACTOR if net_of_vat and kinds.get(item_id) == INVOICE else expected
    return total


async def period_costs(
    db, company_id: Optional[str], scope: dict, period: Period, include_off_book: bool, net_of_vat: bool,
) -> Dict[str, Any]:
    """A period's recurring costs, for its margins (routers/margins.py):

    - paid: what the records paying them that are dated in the period come
      to, whichever month they paid - they are among the period's invoices
      and expenses, and are no goods;
    - accrued: each month's recurring costs (month_cost) by the share of
      its days in the period, as payroll is counted - the cost of running
      the business in those days, not on the day it was paid;
    - items: how many recurring costs the business follows;
    - paid_by_day / accrued_by_month: the same two day by day and month by
      month (a month's whole cost), for a chart of the one profit."""
    items = await active_items(db, company_id)
    if not items:
        return {"paid": 0.0, "accrued": 0.0, "items": 0, "paid_by_day": {}, "accrued_by_month": {}}
    kinds = {item["id"]: item_kind(item) for item in items}
    ids = [item["id"] for item in items]
    # A payment dated in the period can be the month before's (paid late)
    # or the next month's (paid early); none comes before the first one.
    month = max(add_months(period.start.year, period.start.month, -1), min(parse_month(first_month(item)) for item in items))
    last = add_months(period.end.year, period.end.month, 1)
    paid: Dict[str, dict] = {}
    accrued = 0.0
    accrued_by_month: Dict[Tuple[int, int], float] = {}
    while month <= last:
        year, number = month
        occurrences = resolve_month(items, year, number, await load_month_records(db, scope, ids, year, number))
        share = period.month_share(year, number)
        if share:
            whole = month_cost(occurrences, kinds, include_off_book, net_of_vat)
            accrued_by_month[(year, number)] = whole
            accrued += share * whole
        for occurrence in occurrences.values():
            for record in _records(occurrence, include_off_book):
                if period.contains(_record_day(record)):
                    paid[str(record["id"])] = record
        month = add_months(year, number, 1)
    paid_by_day: Dict[str, float] = {}
    for record in paid.values():
        day = _record_day(record)
        if day is not None:
            paid_by_day[day.isoformat()] = paid_by_day.get(day.isoformat(), 0.0) + _amount(record, net_of_vat)
    return {
        "paid": round(sum(_amount(record, net_of_vat) for record in paid.values()), 2),
        "accrued": round(accrued, 2),
        "items": len(items),
        "paid_by_day": paid_by_day,
        "accrued_by_month": accrued_by_month,
    }


async def active_items(db, company_id: Optional[str]) -> List[dict]:
    if not company_id:
        return []
    return await db.recurring_expenses.find(
        {"company_id": company_id, "is_active": {"$ne": False}}, {"_id": 0},
    ).to_list(None)


async def month_projection(
    db, company_id: Optional[str], scope: dict, year: int, month: int, through: date, include_off_book: bool,
    net_of_vat: bool = False,
) -> Dict[str, float]:
    """outlook() for one company and month, straight from the database."""
    items = await active_items(db, company_id)
    if not items:
        return {"paid_so_far": 0.0, "month_total": 0.0}
    records = await load_month_records(db, scope, [item["id"] for item in items], year, month)
    occurrences = resolve_month(items, year, month, records)
    return outlook(items, occurrences, through, include_off_book, net_of_vat)


def _usual_amount(item: dict, net_of_vat: bool) -> float:
    """An item's usual amount - an invoice's taken as including VAT at the
    standard rate, so without it for a business that deducts VAT."""
    amount = float(item.get("amount") or 0)
    return amount / STANDARD_VAT_FACTOR if net_of_vat and item_kind(item) == INVOICE else amount


def known_month_total(items: List[dict], key: str, include_off_book: bool, net_of_vat: bool = False) -> float:
    """What the active recurring expenses with a payment in the month come to."""
    return round(sum(
        _usual_amount(item, net_of_vat) for item in items
        if (include_off_book or item_kind(item) == INVOICE) and is_due_month(item, key)
    ), 2)


def known_monthly_total(
    items: List[dict], include_off_book: bool, today: Optional[date] = None, net_of_vat: bool = False,
) -> float:
    """What the active recurring expenses come to in an average month: one
    paid every few months counts its share of each month, one whose
    payments are over nothing."""
    today = today or current_day()
    this_month = month_key_of(today.year, today.month)
    return round(sum(
        _usual_amount(item, net_of_vat) / interval_months(item) for item in items
        if (include_off_book or item_kind(item) == INVOICE) and next_due_month(item, this_month) is not None
    ), 2)

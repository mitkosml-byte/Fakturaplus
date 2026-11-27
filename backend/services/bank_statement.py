"""A bank statement file (Н2): read into transactions, each matched to the
supplier invoice it pays or the customer debt it settles - by the document's
number in the transfer's reason, by the counterparty and by the amount.

What is certain is offered ticked, what is only likely is asked, the rest is
shown and left alone. Nothing here writes: routers/bank_statement gathers
the open documents, shows the proposals and records the payments the person
confirms through the same payment code as when they are entered by hand.

Files as banks give them: CSV or Excel with whatever columns the bank calls
them (found by their names, in Bulgarian or English, wherever the table
starts), MT940 and CAMT.053 (the two bank standards). Generic - any bank,
any business."""
import csv
import difflib
import hashlib
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import lru_cache
from itertools import combinations
from typing import Any, Dict, FrozenSet, List, Optional, Set, Tuple

from services.translit import to_latin

try:
    import openpyxl  # type: ignore[import-untyped]
    EXCEL_AVAILABLE = True
except ImportError:  # pragma: no cover
    EXCEL_AVAILABLE = False

MAX_TRANSACTIONS = 5000
# An Excel file is a zip: more than this unpacked is no bank statement.
MAX_UNPACKED_BYTES = 60 * 1024 * 1024
# Two amounts are the same within a cent.
CENT = 0.011
# Everything in the program is in euro: a movement in another currency
# cannot be set against a document's amount.
PROGRAM_CURRENCY = "EUR"

# How sure a proposal is.
SURE = "sure"
ASK = "ask"
NONE = "none"
# Already recorded: this very movement, from this statement read before.
APPLIED = "applied"
# Already entered another way: a payment typed in by hand, or the same
# movement recorded from another file of the same days (CSV, then MT940).
ENTERED = "entered"

# A payment entered by hand is the movement when it is dated from a week
# before the bank's day (ordered, booked later) to three weeks after it
# (typed in late, on the day it was entered). A month apart is the next
# instalment, not this one.
HAND_DAYS_BEFORE = 7
HAND_DAYS_AFTER = 21


class StatementError(Exception):
    """The file itself could not be read as a bank statement."""


@dataclass
class BankTransaction:
    date: str                 # "YYYY-MM-DD"
    amount: float             # money in above zero, money out below
    counterparty: str = ""
    description: str = ""
    reference: str = ""
    balance: Optional[float] = None
    id: str = ""              # its fingerprint (fingerprint_all)


@dataclass
class Statement:
    transactions: List[BankTransaction]
    format: str
    closing_balance: Optional[float] = None
    closing_date: Optional[str] = None
    currency: Optional[str] = None
    skipped_rows: int = 0
    # Movements in another currency, left out (see PROGRAM_CURRENCY).
    other_currency_rows: int = 0


@dataclass
class OpenDocument:
    """A supplier invoice still to pay ("invoice") or a customer debt still
    to receive ("receivable") - or one settled lately (nothing left), kept
    for the payments recorded on it: a movement that is one of them is not
    a new payment."""
    kind: str
    id: str
    name: str
    left: float
    number: str = ""
    eik: str = ""
    date: str = ""
    label: str = ""
    # The payments on record that a bank shows (not the ones in cash):
    # (day, amount, the movement's id when recorded from a statement, else "").
    recorded_payments: List[Tuple[str, float, str]] = field(default_factory=list)


# ===================== values =====================

def parse_amount(value: Any) -> Optional[float]:
    """A sum as banks write it: "1 234,56", "1,234.56", "-12.50", "12,50-",
    "(12.50)", "150.00 DR", with or without the currency."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    upper = text.upper()
    negative = upper.endswith("-") or (upper.startswith("(") and upper.endswith(")")) or bool(re.search(r"\b(DR|ДТ)\b", upper))
    if text.lstrip().startswith("-") or text.lstrip().startswith("−"):
        negative = True
    # Marks left over from the currency ("1 200,00 лв.") are no separators.
    digits = re.sub(r"[^\d.,]", "", text).strip(".,")
    if not re.search(r"\d", digits):
        return None
    if "," in digits and "." in digits:
        decimal = "," if digits.rfind(",") > digits.rfind(".") else "."
        other = "." if decimal == "," else ","
        digits = digits.replace(other, "").replace(decimal, ".")
    elif "," in digits or "." in digits:
        mark = "," if "," in digits else "."
        head, _, tail = digits.rpartition(mark)
        # One mark with exactly three digits after it groups thousands
        # ("1,234", "1.234" - money has two decimals); anything else is the
        # decimal mark ("12,5", "12.50").
        if digits.count(mark) > 1 or (len(tail) == 3 and head not in ("", "0") and len(head) <= 3):
            digits = digits.replace(mark, "")
        else:
            digits = head.replace(mark, "") + "." + tail
    try:
        amount = float(digits)
    except ValueError:
        return None
    return -amount if negative else amount


_DATE_PATTERNS = (
    (re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})"), ("y", "m", "d")),
    (re.compile(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})"), ("d", "m", "y")),
    (re.compile(r"(\d{4})/(\d{1,2})/(\d{1,2})"), ("y", "m", "d")),
    (re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{2})\b"), ("d", "m", "yy")),
    (re.compile(r"^(\d{4})(\d{2})(\d{2})$"), ("y", "m", "d")),
)


def parse_date(value: Any) -> Optional[str]:
    """A day as banks write it (day first): 05.11.2026, 2026-11-05,
    05/11/26, with or without a time."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    for pattern, order in _DATE_PATTERNS:
        found = pattern.search(text)
        if not found:
            continue
        parts = dict(zip(order, found.groups()))
        year = int(parts["y"]) if "y" in parts else 2000 + int(parts["yy"])
        try:
            return date(year, int(parts["m"]), int(parts["d"])).isoformat()
        except ValueError:
            continue
    return None


def _clean(value: Any) -> str:
    return " ".join(str(value if value is not None else "").split())


_CURRENCY_MARKS: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("EUR", ("eur", "евро", "€")),
    ("BGN", ("bgn", "лв", "лев")),
    ("USD", ("usd", "$", "долар")),
    ("GBP", ("gbp", "£", "паунд")),
    ("CHF", ("chf", "франк")),
)


def currency_code(value: Any, beside_a_sum: bool = False) -> Optional[str]:
    """The currency a cell names ("EUR", "Евро", "лв.", any three-letter
    code) - or the one written beside a sum ("1 200,00 лв."), where only the
    known marks count ("150.00 DR" names none)."""
    text = _clean(value).lower()
    if not text:
        return None
    for code, marks in _CURRENCY_MARKS:
        if any(mark in text for mark in marks):
            return code
    if not beside_a_sum and re.fullmatch(r"[a-z]{3}", text):
        return text.upper()
    return None


def _other_currency(codes: Set[str]) -> "StatementError":
    return StatementError(
        f"Извлечението е в {', '.join(sorted(codes))}, а програмата работи в евро - "
        "изтеглете извлечението на сметката в евро."
    )


# ===================== tables (CSV, Excel) =====================

# What a column is, by what its name holds - the more specific first.
_COLUMN_HINTS: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("balance", ("салдо", "balance", "наличност", "остатък")),
    ("value_date", ("вальор", "value date", "valuedate", "валутна дата")),
    ("date", ("дата", "date")),
    ("debit", ("дебит", "debit", "изходящ", "withdraw", "paid out", "разход", "теглен")),
    ("credit", ("кредит", "credit", "входящ", "deposit", "paid in", "приход", "постъпл")),
    ("amount", ("сума", "amount", "стойност", "размер")),
    ("payer", ("наредител", "платец", "payer", "remitter", "debtor", "ordering")),
    ("payee", ("получател", "бенефициент", "beneficiary", "payee", "creditor")),
    ("counterparty", ("контрагент", "кореспондент", "насрещна", "counterparty", "partner", "име", "name")),
    ("description", ("основание", "описание", "пояснени", "детайли", "detail", "description", "reason", "narrative",
                     "purpose", "remittance", "бележк", "информация")),
    ("reference", ("референ", "reference", "документ", "номер")),
    ("currency", ("валута", "currency")),
)
# An account's own number is no counterparty and no reference.
_ACCOUNT_WORDS = ("iban", "сметка", "account", "bic", "банка", "bank")
_DIRECTION_OUT = {"дт", "d", "dr", "debit", "дебит", "д", "изходящ", "изходящо", "out"}
_DIRECTION_IN = {"кт", "c", "cr", "credit", "кредит", "к", "входящ", "входящо", "in"}
# What a column that says debit or credit is called, when a file holds only one of them.
_DIRECTION_NAMES = ("дт", "кт", "d/c", "dr/cr", "тип", "вид", "type", "direction", "знак", "sign", "операция")
_CLOSING_WORDS = ("крайно салдо", "closing balance", "салдо в края", "крайна наличност", "final balance")


def _column_kind(header: Any) -> Optional[str]:
    name = _clean(header).lower().strip(":*")
    if not name:
        return None
    matched = [kind for kind, hints in _COLUMN_HINTS if any(hint in name for hint in hints)]
    if not matched:
        return None
    # "Наредител/Получател": the other side, whichever way the money went.
    kind = "counterparty" if "payer" in matched and "payee" in matched else matched[0]
    if any(word in name for word in _ACCOUNT_WORDS) and kind in ("counterparty", "payer", "payee", "reference", "date"):
        return None
    return kind


def _header_row(rows: List[List[Any]]) -> Tuple[int, Dict[str, List[int]]]:
    """The row that names the columns: the first (near the top) with a date
    and a sum among its names. Returns its index and the columns by kind."""
    for index, row in enumerate(rows[:60]):
        columns: Dict[str, List[int]] = {}
        for position, cell in enumerate(row):
            kind = _column_kind(cell)
            if kind:
                columns.setdefault(kind, []).append(position)
        has_date = "date" in columns or "value_date" in columns
        has_sum = "amount" in columns or "debit" in columns or "credit" in columns
        if has_date and has_sum:
            return index, columns
    raise StatementError(
        "Не намирам колоните на извлечението - трябват поне дата и сума (или дебит и кредит). "
        "Изтеглете го от банката като CSV или Excel."
    )


def _cell(row: List[Any], positions: Optional[List[int]]) -> Any:
    for position in positions or []:
        if position < len(row) and row[position] not in (None, ""):
            return row[position]
    return None


def _joined(row: List[Any], positions: Optional[List[int]]) -> str:
    parts = [_clean(row[p]) for p in positions or [] if p < len(row) and row[p] not in (None, "")]
    return _clean(" ".join(dict.fromkeys(part for part in parts if part)))


def _direction_column(rows: List[List[Any]], header: List[Any], taken: set) -> Optional[int]:
    """A column that only ever says debit or credit (Дт/Кт, D/C): one that
    holds both words - or, in a statement of payments only (or receipts
    only), one of them under a name that says what it is."""
    words = _DIRECTION_OUT | _DIRECTION_IN
    width = max([len(header), *(len(row) for row in rows)], default=0)
    one_sided: Optional[int] = None
    for position in range(width):
        if position in taken:
            continue
        values = {_clean(row[position]).lower() for row in rows if position < len(row) and _clean(row[position])}
        if not values or not values <= words:
            continue
        if values & _DIRECTION_OUT and values & _DIRECTION_IN:
            return position
        name = _clean(header[position]).lower() if position < len(header) else ""
        if one_sided is None and any(word in name for word in _DIRECTION_NAMES):
            one_sided = position
    return one_sided


def _closing_from_notes(rows: List[List[Any]]) -> Optional[float]:
    """"Крайно салдо: 1 234,56" on a line of its own, above or below the table."""
    for row in rows:
        cells = [_clean(cell) for cell in row]
        for position, cell in enumerate(cells):
            lowered = cell.lower()
            if not any(word in lowered for word in _CLOSING_WORDS):
                continue
            after = cell.split(":", 1)[1] if ":" in cell else ""
            for candidate in [after, *cells[position + 1:]]:
                amount = parse_amount(candidate) if re.search(r"\d", candidate or "") else None
                if amount is not None:
                    return round(amount, 2)
    return None


def _from_table(rows: List[List[Any]], file_format: str) -> Statement:
    header_index, columns = _header_row(rows)
    body = rows[header_index + 1:]
    taken = {position for positions in columns.values() for position in positions}
    direction_at = (
        _direction_column(body, rows[header_index], taken) if "amount" in columns and "debit" not in columns else None
    )
    transactions: List[BankTransaction] = []
    skipped = 0
    currency: Optional[str] = None
    other_currencies: Set[str] = set()
    other_rows = 0
    sum_columns = [*columns.get("amount", []), *columns.get("debit", []), *columns.get("credit", [])]
    for row in body:
        if not any(_clean(cell) for cell in row):
            continue
        day = parse_date(_cell(row, columns.get("date"))) or parse_date(_cell(row, columns.get("value_date")))
        amount: Optional[float] = None
        if "debit" in columns or "credit" in columns:
            debit = parse_amount(_cell(row, columns.get("debit")))
            credit = parse_amount(_cell(row, columns.get("credit")))
            if debit or credit:
                amount = abs(credit or 0.0) - abs(debit or 0.0)
        if amount is None and "amount" in columns:
            amount = parse_amount(_cell(row, columns.get("amount")))
            if amount is not None and direction_at is not None and direction_at < len(row):
                word = _clean(row[direction_at]).lower()
                amount = -abs(amount) if word in _DIRECTION_OUT else abs(amount)
        if day is None or amount is None or abs(amount) < 0.005:
            # A movement that could not be read is counted and said; a note
            # or a total between the movements (no sum, or no date) is not.
            date_text = _clean(_cell(row, columns.get("date")) or _cell(row, columns.get("value_date")))
            sum_text = _clean(_cell(row, sum_columns))
            if (day is not None and amount is None and sum_text) or (day is None and amount and re.search(r"\d", date_text)):
                skipped += 1
            continue
        code = currency_code(_cell(row, columns.get("currency"))) or currency_code(_cell(row, sum_columns), beside_a_sum=True)
        if code and code != PROGRAM_CURRENCY:
            other_currencies.add(code)
            other_rows += 1
            continue
        currency = currency or code
        if "counterparty" in columns:
            counterparty = _joined(row, columns["counterparty"])
        else:
            counterparty = _joined(row, columns.get("payer") if amount > 0 else columns.get("payee"))
        transactions.append(BankTransaction(
            date=day, amount=round(amount, 2), counterparty=counterparty,
            description=_joined(row, columns.get("description")), reference=_joined(row, columns.get("reference")),
            balance=parse_amount(_cell(row, columns.get("balance"))),
        ))
        if len(transactions) > MAX_TRANSACTIONS:
            raise StatementError(f"Извлечението е с над {MAX_TRANSACTIONS} движения - изтеглете го за по-кратък период.")
    if not transactions:
        if other_currencies:
            raise _other_currency(other_currencies)
        raise StatementError("В извлечението няма движения с дата и сума.")
    closing = _closing_from_notes(rows[:header_index] + [row for row in body if parse_date(_cell(row, columns.get("date"))) is None])
    with_balance = [t for t in transactions if t.balance is not None]
    if closing is None and with_balance:
        # The balance after the latest movement - the file may run either way.
        newest_first = transactions[0].date > transactions[-1].date
        closing = (with_balance[0] if newest_first else with_balance[-1]).balance
    return Statement(
        transactions=transactions, format=file_format,
        closing_balance=round(closing, 2) if closing is not None else None,
        closing_date=max(t.date for t in transactions), currency=currency, skipped_rows=skipped,
        other_currency_rows=other_rows,
    )


def _decode(content: bytes) -> str:
    """The text of a file as banks save it: UTF-8 (with or without its
    mark), UTF-16 (Excel's "Unicode text") or Windows-1251."""
    if content[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return content.decode("utf-16", errors="replace")
    head = content[:4000]
    if head.count(b"\x00") >= 4:
        # UTF-16 without its mark - text in the other two has no zero bytes.
        little = head[1::2].count(0) >= head[0::2].count(0)
        return content.decode("utf-16-le" if little else "utf-16-be", errors="replace")
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("cp1251", errors="replace")


def _standard_amount(value: Any, decimal: str) -> Optional[float]:
    """A sum in a bank standard: digits and its one decimal mark (MT940 a
    comma, CAMT a point) - never read as thousands."""
    text = _clean(value)
    if not re.fullmatch(r"\d+(?:" + re.escape(decimal) + r"\d*)?", text):
        return None
    return float(text.replace(",", "."))


def _read_csv(content: bytes) -> Statement:
    text = _decode(content)
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise StatementError("Файлът е празен.")
    # The separator the table uses: the one most lines agree on.
    separator = max((";", "\t", ",", "|"), key=lambda mark: sum(1 for line in lines[:80] if line.count(mark) >= 2))
    rows = [list(row) for row in csv.reader(io.StringIO(text), delimiter=separator)]
    return _from_table(rows, "csv")


def _read_xlsx(content: bytes) -> Statement:
    if not EXCEL_AVAILABLE:
        raise StatementError("Четенето на Excel файлове не е налично на сървъра - изтеглете извлечението като CSV.")
    too_long = StatementError(f"Извлечението е с над {MAX_TRANSACTIONS} движения - изтеглете го за по-кратък период.")
    rows: List[List[Any]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as packed:
            if sum(entry.file_size for entry in packed.infolist()) > MAX_UNPACKED_BYTES:
                raise too_long
        workbook = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
        for row in workbook.active.iter_rows(values_only=True, max_col=80):
            rows.append(list(row))
            if len(rows) > MAX_TRANSACTIONS + 500:
                raise too_long
    except StatementError:
        raise
    except Exception:
        raise StatementError("Файлът не е валиден Excel (.xlsx) - изтеглете извлечението като CSV или .xlsx.")
    return _from_table(rows, "xlsx")


# ===================== MT940 =====================

_MT940_LINE = re.compile(r"^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?(\d+(?:,\d*)?)(.*)$")
_MT940_BALANCE = re.compile(r"^([CD])(\d{6})([A-Z]{3})(\d+(?:,\d*)?)")


def _yymmdd(text: str) -> Optional[str]:
    try:
        return date(2000 + int(text[:2]), int(text[2:4]), int(text[4:6])).isoformat()
    except ValueError:
        return None


def _mt940_details(text: str) -> Tuple[str, str]:
    """(counterparty, description) of a :86: field - its ?NN subfields when
    it has them (20-29 the reason, 32-33 the name), else the text as it is."""
    if "?" not in text:
        return "", _clean(text)
    fields: Dict[str, str] = {}
    for code, value in re.findall(r"\?(\d{2})([^?]*)", text):
        fields[code] = fields.get(code, "") + value
    reason = " ".join(fields[code] for code in sorted(fields) if "20" <= code <= "29" or "60" <= code <= "63")
    name = " ".join(fields[code] for code in ("32", "33") if code in fields)
    return _clean(name), _clean(reason) or _clean(re.sub(r"\?\d{2}", " ", text))


def _read_mt940(text: str) -> Statement:
    tags: List[Tuple[str, str]] = []
    for line in text.replace("\r", "").split("\n"):
        found = re.match(r"^:(\d{2}[A-Z]?):(.*)$", line)
        if found:
            tags.append((found.group(1), found.group(2)))
        elif tags and line.strip() and not line.startswith(("-", "{")):
            tags[-1] = (tags[-1][0], tags[-1][1] + "\n" + line)
    transactions: List[BankTransaction] = []
    closing: Optional[float] = None
    closing_date: Optional[str] = None
    currency: Optional[str] = None
    for index, (tag, value) in enumerate(tags):
        if tag in ("60F", "60M", "62F", "62M"):
            found = _MT940_BALANCE.match(value.strip())
            if found and tag.startswith("62"):
                balance = _standard_amount(found.group(4), ",") or 0.0
                closing = round(-balance if found.group(1) == "D" else balance, 2)
                closing_date, currency = _yymmdd(found.group(2)), found.group(3)
            elif found:
                currency = currency or found.group(3)
        if tag != "61":
            continue
        first, _, rest = value.partition("\n")
        found = _MT940_LINE.match(first.strip())
        if not found:
            continue
        day = _yymmdd(found.group(1))
        amount = _standard_amount(found.group(5), ",")
        if day is None or amount is None:
            continue
        sign = 1 if found.group(3) in ("C", "RD") else -1
        tail = found.group(6)
        reference = tail[4:].split("//")[0] if len(tail) > 4 else ""
        details = tags[index + 1][1] if index + 1 < len(tags) and tags[index + 1][0] == "86" else ""
        counterparty, description = _mt940_details(details.replace("\n", ""))
        transactions.append(BankTransaction(
            date=day, amount=round(sign * amount, 2), counterparty=counterparty,
            description=_clean(f"{description} {rest}"), reference="" if reference.upper().startswith("NONREF") else _clean(reference),
        ))
    if not transactions:
        raise StatementError("В MT940 файла няма движения.")
    if currency and currency != PROGRAM_CURRENCY:
        raise _other_currency({currency})
    return Statement(transactions, "mt940", closing, closing_date or max(t.date for t in transactions), currency)


# ===================== CAMT.053 =====================

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find(node: Optional[ET.Element], *path: str) -> Optional[ET.Element]:
    for name in path:
        if node is None:
            return None
        node = next((child for child in node if _local(child.tag) == name), None)
    return node


def _text(node: Optional[ET.Element], *path: str) -> str:
    found = _find(node, *path)
    return _clean(found.text) if found is not None and found.text else ""


def _all(node: Optional[ET.Element], name: str) -> List[ET.Element]:
    return [child for child in node if _local(child.tag) == name] if node is not None else []


def _read_camt(content: bytes) -> Statement:
    head = content[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in content.upper():
        raise StatementError("Файлът не е банково извлечение.")
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        raise StatementError("XML файлът не може да бъде прочетен.")
    statements = [node for node in root.iter() if _local(node.tag) in ("Stmt", "Rpt")]
    if not statements:
        raise StatementError("В XML файла няма банково извлечение (CAMT.053).")
    transactions: List[BankTransaction] = []
    closing: Optional[float] = None
    closing_date: Optional[str] = None
    currency: Optional[str] = None
    other_currencies: Set[str] = set()
    other_rows = 0
    for statement in statements:
        for balance in _all(statement, "Bal"):
            if _text(balance, "Tp", "CdOrPrtry", "Cd") not in ("CLBD", "CLAV"):
                continue
            amount_node = _find(balance, "Amt")
            amount = _standard_amount(amount_node.text, ".") if amount_node is not None else None
            if amount is not None:
                closing = round(-amount if _text(balance, "CdtDbtInd") == "DBIT" else amount, 2)
                closing_date = parse_date(_text(balance, "Dt", "Dt") or _text(balance, "Dt", "DtTm"))
                currency = amount_node.get("Ccy") if amount_node is not None else currency
        for entry in _all(statement, "Ntry"):
            day = parse_date(_text(entry, "BookgDt", "Dt") or _text(entry, "BookgDt", "DtTm")
                             or _text(entry, "ValDt", "Dt") or _text(entry, "ValDt", "DtTm"))
            entry_sum = _find(entry, "Amt")
            entry_amount = _standard_amount(entry_sum.text, ".") if entry_sum is not None else None
            incoming = _text(entry, "CdtDbtInd") != "DBIT"
            if day is None or entry_amount is None:
                continue
            entry_currency = (entry_sum.get("Ccy") or "").upper() if entry_sum is not None else ""
            if entry_currency and entry_currency != PROGRAM_CURRENCY:
                other_currencies.add(entry_currency)
                other_rows += 1
                continue
            details: List[Optional[ET.Element]] = [tx for block in _all(entry, "NtryDtls") for tx in _all(block, "TxDtls")] or [None]
            for tx in details:
                amount = entry_amount
                if tx is not None and len(details) > 1:
                    own = _standard_amount(_text(tx, "Amt") or _text(tx, "AmtDtls", "TxAmt", "Amt"), ".")
                    if own is None:
                        continue
                    amount = own
                party = _find(tx, "RltdPties", "Dbtr" if incoming else "Cdtr")
                name = _text(party, "Nm") or _text(party, "Pty", "Nm")
                reason = " ".join(_clean(node.text) for node in _all(_find(tx, "RmtInf"), "Ustrd") if node.text)
                reference = _text(tx, "Refs", "EndToEndId")
                transactions.append(BankTransaction(
                    date=day, amount=round(abs(amount) if incoming else -abs(amount), 2), counterparty=name,
                    description=_clean(reason or _text(entry, "AddtlNtryInf")),
                    reference="" if reference.upper() in ("NOTPROVIDED", "NONREF") else reference,
                ))
    if currency and currency.upper() != PROGRAM_CURRENCY:
        raise _other_currency({currency.upper()})
    if not transactions:
        if other_currencies:
            raise _other_currency(other_currencies)
        raise StatementError("В извлечението няма движения.")
    return Statement(
        transactions, "camt", closing, closing_date or max(t.date for t in transactions), currency,
        other_currency_rows=other_rows,
    )


# ===================== any file =====================

def read_statement(content: bytes, filename: str = "") -> Statement:
    """The statement in whichever of the formats the file is - told by what
    it holds, not by its name."""
    if not content or not content.strip():
        raise StatementError("Файлът е празен.")
    name = (filename or "").lower()
    if content[:4] == b"PK\x03\x04":
        statement = _read_xlsx(content)
    elif content[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" or name.endswith(".xls"):
        raise StatementError("Старият Excel формат (.xls) не се чете - изтеглете извлечението като CSV или .xlsx.")
    elif content[:5] == b"%PDF-" or name.endswith(".pdf"):
        raise StatementError("PDF извлечение не се чете - изтеглете го от банката като CSV, Excel, MT940 или XML.")
    else:
        start = content.lstrip()[:300].lstrip(b"\xef\xbb\xbf")
        if start.startswith(b"<"):
            statement = _read_camt(content)
        else:
            text = _decode(content)
            statement = _read_mt940(text) if re.search(r"^:61:", text, re.M) else _read_csv(content)
    fingerprint_all(statement.transactions)
    return statement


def fingerprint_all(transactions: List[BankTransaction]) -> None:
    """Each movement's own id, the same whenever the same file - or another
    statement covering the same days - is read again: its day, sum, party
    and reason, and which one it is among movements identical in all four."""
    seen: Dict[str, int] = {}
    for transaction in transactions:
        base = "|".join([
            transaction.date, f"{transaction.amount:.2f}", name_key(transaction.counterparty),
            _clean(transaction.description).lower(), _clean(transaction.reference).lower(),
        ])
        nth = seen.get(base, 0)
        seen[base] = nth + 1
        transaction.id = hashlib.sha1(f"{base}#{nth}".encode("utf-8")).hexdigest()[:20]


# ===================== matching =====================

# A company's legal form says nothing about which company it is.
_LEGAL_FORMS = {
    "eood", "ood", "ad", "ead", "et", "sd", "kd", "kda", "dzzd", "ltd", "llc", "gmbh", "inc", "sa", "srl", "plc", "dp",
}


@lru_cache(maxsize=20_000)
def _tokens(name: str) -> Tuple[str, ...]:
    words = re.findall(r"[a-z0-9]+", to_latin(name).lower())
    return tuple(word for word in words if word not in _LEGAL_FORMS)


def name_tokens(name: Any) -> List[str]:
    return list(_tokens(str(name or "")))


def name_key(name: Any) -> str:
    """A name as compared: in Latin letters (a bank writes "STROY DEPO
    EOOD" for "Строй Депо ЕООД"), without its legal form and spacing."""
    return "".join(_tokens(str(name or "")))


@lru_cache(maxsize=50_000)
def _same_name(document_name: str, counterparty: str) -> bool:
    """One company under two spellings: the same name, one inside the other,
    most of its words, or close enough to be a typing difference."""
    wanted, party = name_key(document_name), name_key(counterparty)
    if len(wanted) < 3 or not party:
        return False
    if wanted == party:
        return True
    shorter, longer = sorted((wanted, party), key=len)
    if len(shorter) >= 5 and shorter in longer:
        return True
    mine, theirs = _tokens(document_name), _tokens(counterparty)
    shared = [word for word in mine if len(word) >= 3 and word in theirs]
    if mine and len(shared) / len(mine) >= 0.6 and any(len(word) >= 4 for word in shared):
        return True
    if min(len(wanted), len(party)) >= 6:
        close = difflib.SequenceMatcher(None, wanted, party)
        return close.real_quick_ratio() >= 0.86 and close.quick_ratio() >= 0.86 and close.ratio() >= 0.86
    return False


@lru_cache(maxsize=20_000)
def _text_index(text: str) -> Tuple[str, str, FrozenSet[str], FrozenSet[str]]:
    """A transfer's text, worked out once for every document it is set
    against: lowered, as one Latin word, its numbers, its EIK-long numbers."""
    lowered = _clean(text).lower()
    runs = re.findall(r"\d+", lowered)
    return (
        lowered, re.sub(r"[\W_]+", "", to_latin(lowered).lower()),
        frozenset(run.lstrip("0") for run in runs), frozenset(run for run in runs if 9 <= len(run) <= 13),
    )


def _transfer_text(transaction: BankTransaction) -> str:
    return f"{transaction.description} {transaction.reference}"


def same_party(document: OpenDocument, transaction: BankTransaction) -> bool:
    """Is the transfer's other side the document's supplier or customer? By
    the EIK in the transfer, or by the names (see _same_name)."""
    everything = f"{transaction.counterparty} {transaction.description} {transaction.reference}"
    eik = re.sub(r"\D", "", document.eik or "")
    if len(eik) >= 9 and eik in _text_index(everything)[3]:
        return True
    if transaction.counterparty.strip():
        return _same_name(document.name, transaction.counterparty)
    # No counterparty at all (some MT940 files): the name in the reason.
    wanted = name_key(document.name)
    return len(wanted) >= 6 and wanted in _text_index(everything)[1]


_NUMBER_WORDS = r"(?:ф[-.\s]*ра|фактура|факт\.?|ф\.|inv(?:oice)?\.?|faktura|fakt\.?|f-ra|№|no\.?|nr\.?|n\.|#)"


@lru_cache(maxsize=20_000)
def _number_index(number: str) -> Tuple[str, str, bool]:
    """A document's number: as one Latin word, its digits without leading
    zeros, and whether it has letters."""
    raw = _clean(number)
    return (
        re.sub(r"[\W_]+", "", to_latin(raw).lower()), re.sub(r"\D", "", raw).lstrip("0"),
        bool(re.search(r"[^\W\d_]", raw)),
    )


def mentions_number(text: str, number: str) -> bool:
    """Does the transfer's reason name this document's number? A number of
    four digits or more wherever it stands; a shorter one only after a word
    for it ("ф-ра 12", "inv. 7", "№ 3"); a number with letters as written."""
    if not _clean(number):
        return False
    key, digits, lettered = _number_index(number)
    lowered, joined, runs, _ = _text_index(text)
    if lettered:
        if len(key) >= 4 and key in joined:
            return True
        if len(digits) < 4:
            return False
    if not digits:
        return False
    if len(digits) >= 4:
        return digits in runs
    return bool(re.search(rf"{_NUMBER_WORDS}\s*0*{re.escape(digits)}(?!\d)", lowered))


def _kind_of(transaction: BankTransaction) -> str:
    """Money in settles what a customer owes; money out pays a supplier."""
    return "receivable" if transaction.amount > 0 else "invoice"


def _candidates(transaction: BankTransaction, documents: List[OpenDocument]) -> Tuple[List[OpenDocument], List[OpenDocument]]:
    """The documents a movement can be about: those whose number its reason
    names, and those of its other side."""
    kind, text = _kind_of(transaction), _transfer_text(transaction)
    mine = [d for d in documents if d.kind == kind]
    return (
        [d for d in mine if d.number and mentions_number(text, d.number)],
        [d for d in mine if same_party(d, transaction)],
    )


def _as_target(document: OpenDocument, left: float, amount: Optional[float] = None) -> dict:
    target: Dict[str, Any] = {
        "kind": document.kind, "id": document.id, "label": document.label, "name": document.name,
        "number": document.number, "left": round(left, 2),
    }
    if amount is not None:
        target["amount"] = round(amount, 2)
    return target


def _subset_for(documents: List[OpenDocument], left: Dict[str, float], amount: float) -> Optional[List[OpenDocument]]:
    """Several of one party's documents that together make the amount - the
    fewest, the oldest first."""
    pool = sorted(documents, key=lambda d: (d.date or "", d.number))[:12]
    for size in range(2, min(len(pool), 6) + 1):
        for group in combinations(pool, size):
            if abs(sum(left[d.id] for d in group) - amount) <= CENT:
                return list(group)
    return None


def _targets(documents: List[OpenDocument], left: Dict[str, float], amount: float) -> List[dict]:
    """What a payment of `amount` puts on each document, the oldest first."""
    targets = []
    remaining = amount
    for document in sorted(documents, key=lambda d: (d.date or "", d.number)):
        share = round(min(left[document.id], remaining), 2)
        if share <= 0.005:
            continue
        targets.append(_as_target(document, left[document.id], share))
        remaining = round(remaining - share, 2)
    return targets


def propose(
    transaction: BankTransaction, documents: List[OpenDocument], left: Dict[str, float],
    candidates: Optional[Tuple[List[OpenDocument], List[OpenDocument]]] = None,
) -> dict:
    """What a movement pays, and how sure that is: {"status", "reason",
    "targets", "alternatives"}. `left` is what each document still owes -
    a sure proposal takes its share off it, so no document is paid twice."""
    amount = abs(transaction.amount)
    by_number, by_name = candidates if candidates is not None else _candidates(transaction, documents)
    numbered = [d for d in by_number if left.get(d.id, 0) > 0.005]
    named = [d for d in by_name if left.get(d.id, 0) > 0.005]

    def others(listed: List[OpenDocument]) -> List[dict]:
        return [_as_target(d, left[d.id]) for d in listed[:6]]

    def result(status: str, reason: str, chosen: List[OpenDocument], rest: Optional[List[OpenDocument]] = None) -> dict:
        targets = _targets(chosen, left, amount)
        if status == SURE:
            for target in targets:
                left[target["id"]] = round(left[target["id"]] - target["amount"], 2)
        return {"status": status, "reason": reason, "targets": targets, "alternatives": others(rest or [])}

    if numbered:
        # The party's own documents first, should two suppliers share a number.
        mine = [d for d in numbered if d in named] or numbered
        total = sum(left[d.id] for d in mine)
        if len(mine) == 1:
            owed = left[mine[0].id]
            if abs(owed - amount) <= CENT:
                return result(SURE, "number_amount", mine)
            return result(ASK, "number_partial" if amount < owed else "number_over", mine)
        if abs(total - amount) <= CENT:
            return result(SURE, "numbers_amount", mine)
        exact = [d for d in mine if abs(left[d.id] - amount) <= CENT]
        if len(exact) == 1:
            return result(ASK, "number_amount_one_of", exact, [d for d in mine if d is not exact[0]])
        return result(ASK, "numbers_partial", mine)
    if named:
        exact = sorted((d for d in named if abs(left[d.id] - amount) <= CENT), key=lambda d: (d.date or "", d.number))
        if len(exact) == 1:
            return result(SURE, "name_amount", exact)
        if len(exact) > 1:
            return result(ASK, "name_amount_several", exact[:1], exact[1:])
        if len(named) > 1 and abs(sum(left[d.id] for d in named) - amount) <= CENT:
            return result(SURE, "name_all", named)
        group = _subset_for(named, left, amount)
        if group:
            return result(ASK, "name_combined", group, [d for d in named if d not in group])
        if len(named) == 1 and left[named[0].id] > amount + CENT:
            return result(ASK, "name_partial", named)
        return {"status": NONE, "reason": "name_no_amount", "targets": [], "alternatives": others(named)}
    kind = _kind_of(transaction)
    exact = [d for d in documents if d.kind == kind and abs(left.get(d.id, 0) - amount) <= CENT and left.get(d.id, 0) > 0.005]
    if len(exact) == 1:
        return result(ASK, "amount_only", exact)
    return {"status": NONE, "reason": "no_match", "targets": [], "alternatives": []}


def _offset(paid_on: str, moved_on: str) -> Optional[int]:
    """How many days after the movement the payment is dated."""
    try:
        return (date.fromisoformat(paid_on) - date.fromisoformat(moved_on)).days
    except ValueError:
        return None


def already_entered(
    transactions: List[BankTransaction], documents: List[OpenDocument],
    candidates: Dict[str, Tuple[List[OpenDocument], List[OpenDocument]]], in_file: Set[str],
) -> Dict[str, dict]:
    """The movements already on record another way: the same sum on a
    document the movement is about (its number in the reason, else its
    other side), entered by hand on a day near the movement's - or recorded
    from another file of the same days, on the movement's very day. Each
    payment on record answers for one movement, the closest in days, so of
    two equal instalments, one entered and one not, only one is taken."""
    pairs: List[Tuple[int, str, str, str, int]] = []
    found: Dict[Tuple[str, int], Tuple[OpenDocument, str, float, bool]] = {}
    for transaction in transactions:
        by_number, by_name = candidates[transaction.id]
        for document in (by_number or by_name):
            for index, (paid_on, paid, movement) in enumerate(document.recorded_payments):
                if abs(paid - abs(transaction.amount)) > CENT:
                    continue
                offset = _offset(paid_on, transaction.date)
                if offset is None:
                    continue
                if movement:
                    # From a statement: from this one it is that movement
                    # itself (shown as recorded); from another, the same day's.
                    if movement in in_file or offset != 0:
                        continue
                elif not -HAND_DAYS_BEFORE <= offset <= HAND_DAYS_AFTER:
                    continue
                pairs.append((abs(offset), transaction.date, transaction.id, document.id, index))
                found[(document.id, index)] = (document, paid_on, paid, bool(movement))
    matched: Dict[str, dict] = {}
    answered: Set[Tuple[str, int]] = set()
    for _, _, transaction_id, document_id, index in sorted(pairs):
        if transaction_id in matched or (document_id, index) in answered:
            continue
        answered.add((document_id, index))
        document, paid_on, paid, from_statement = found[(document_id, index)]
        by_hand = not from_statement and document.left > 0.005
        matched[transaction_id] = {
            "status": ENTERED, "reason": "other_statement" if from_statement else "by_hand",
            # Entered by hand on a document still owed: should the movement
            # be another payment after all, what it would put on it.
            "targets": [_as_target(document, document.left, min(document.left, paid))] if by_hand else [],
            "alternatives": [],
            "entered": {"kind": document.kind, "id": document.id, "label": document.label, "date": paid_on, "amount": round(paid, 2)},
        }
    return matched


def match_statement(
    transactions: List[BankTransaction], documents: List[OpenDocument], applied: Optional[Dict[str, List[dict]]] = None,
) -> List[dict]:
    """Every movement with what it pays. `applied`: the movements already
    recorded from a statement (by id) and where - shown as done, never
    proposed again. A movement already on record another way (by hand, from
    another file) is shown as that, not as a new payment. Of the rest, those whose reason names a
    document are settled first, whatever their place in the file, so a
    weaker guess never takes their document."""
    applied = applied or {}
    left = {document.id: round(document.left, 2) for document in documents}
    pending = [t for t in transactions if t.id not in applied]
    candidates = {t.id: _candidates(t, documents) for t in pending}
    proposals: Dict[str, dict] = already_entered(pending, documents, candidates, {t.id for t in transactions})
    for strong in (True, False):
        for transaction in sorted(pending, key=lambda t: t.date):
            if transaction.id in proposals or bool(candidates[transaction.id][0]) != strong:
                continue
            proposals[transaction.id] = propose(transaction, documents, left, candidates[transaction.id])
    rows = []
    for transaction in transactions:
        row: Dict[str, Any] = {
            "id": transaction.id, "date": transaction.date, "amount": transaction.amount,
            "counterparty": transaction.counterparty, "description": transaction.description,
            "reference": transaction.reference,
        }
        if transaction.id in applied:
            row.update({"status": APPLIED, "reason": "applied", "targets": applied[transaction.id], "alternatives": []})
        else:
            row.update(proposals[transaction.id])
        rows.append(row)
    return rows

"""Bulk import (CSV/Excel) parsing for the "Импортирай от Excel" buttons.

Deliberately only PARSES and VALIDATES rows into the same shape the manual
entry forms already produce (InvoiceCreate, FixedAssetCreate, BudgetCreate,
DailyRevenueCreate, NonInvoiceExpenseCreate, PayrollEntryCreate) - server.py's
commit endpoints call the existing create_* route functions directly for
each parsed row, so all the real business logic (duplicate detection,
depreciation rate defaults, payroll gross-up math, budget upsert...) lives
in exactly one place and never has to be re-implemented or kept in sync here.

Reads .csv with the stdlib csv module and .xlsx with openpyxl - no pandas,
since openpyxl is the one spreadsheet dependency already proven to work in
production (the Excel export feature has used it for a while); pulling in a
second, unused one just for this would risk the whole app failing to start
if it were ever missing from the deploy environment.
"""
import csv
import io
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

try:
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    EXCEL_AVAILABLE = True
except ImportError:
    EXCEL_AVAILABLE = False


class ImportFileError(Exception):
    """The uploaded file itself couldn't be read (wrong format, empty, corrupted)."""


class ParsedTable:
    """A minimal stand-in for a dataframe: a header row plus raw data rows,
    both as plain Python lists - all a spreadsheet import needs, without a
    dependency any heavier than what's already required to write one."""

    def __init__(self, headers: List[str], rows: List[List[Any]]):
        self.headers = headers
        self.rows = rows
        self.column_index = {h.strip().lower(): i for i, h in enumerate(headers)}


# ===================== reading the uploaded file =====================

def _read_csv_bytes(content: bytes) -> ParsedTable:
    text = None
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ImportFileError("Файлът не можа да бъде прочетен - запазете го като CSV UTF-8 и опитайте отново.")

    # Sniff the delimiter (Excel-exported CSVs on some locales use ';') -
    # falls back to comma if there's too little text to sniff reliably.
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel

    reader = csv.reader(io.StringIO(text), dialect)
    all_rows = [row for row in reader if any(cell.strip() for cell in row)]
    if not all_rows:
        raise ImportFileError("Файлът не съдържа никакви редове с данни.")

    headers = [str(c).strip() for c in all_rows[0]]
    data_rows = all_rows[1:]
    if not data_rows:
        raise ImportFileError("Файлът съдържа само заглавен ред, без данни.")
    return ParsedTable(headers, data_rows)


def _read_xlsx_bytes(content: bytes) -> ParsedTable:
    if not EXCEL_AVAILABLE:
        raise ImportFileError("Четенето на Excel файлове не е налично на сървъра.")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
        ws = wb.active
        all_rows = [list(row) for row in ws.iter_rows(values_only=True)]
    except Exception:
        raise ImportFileError("Файлът не изглежда да е валиден Excel файл.")

    all_rows = [row for row in all_rows if any(not _is_blank(cell) for cell in row)]
    if not all_rows:
        raise ImportFileError("Файлът не съдържа никакви редове с данни.")

    headers = [str(c).strip() if c is not None else "" for c in all_rows[0]]
    data_rows = all_rows[1:]
    if not data_rows:
        raise ImportFileError("Файлът съдържа само заглавен ред, без данни.")
    return ParsedTable(headers, data_rows)


def read_uploaded_table(content: bytes, filename: str) -> ParsedTable:
    name = (filename or "").lower()
    if name.endswith(".csv"):
        return _read_csv_bytes(content)
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return _read_xlsx_bytes(content)
    raise ImportFileError("Поддържат се само .csv, .xlsx и .xls файлове.")


def _is_blank(v: Any) -> bool:
    if v is None:
        return True
    return str(v).strip() == ""


def _get(row: List[Any], table: ParsedTable, *names: str) -> Optional[Any]:
    for name in names:
        idx = table.column_index.get(name.strip().lower())
        if idx is not None and idx < len(row):
            val = row[idx]
            if not _is_blank(val):
                return val
    return None


def _parse_date(value: Any) -> Optional[str]:
    if _is_blank(value):
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _parse_float(value: Any) -> Optional[float]:
    if _is_blank(value):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace("€", "").replace("лв.", "").replace("лв", "")
    s = s.replace(" ", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _parse_int(value: Any) -> Optional[int]:
    f = _parse_float(value)
    return int(round(f)) if f is not None else None


VAT_TREATMENT_LABELS = {
    "стандартна 20%": "standard_20", "стандартна": "standard_20", "20%": "standard_20", "standard_20": "standard_20",
    "намалена 9%": "reduced_9", "намалена": "reduced_9", "9%": "reduced_9", "reduced_9": "reduced_9",
    "нулева ставка": "zero_rate", "нулева": "zero_rate", "0%": "zero_rate", "zero_rate": "zero_rate",
    "освободена доставка": "exempt", "освободена": "exempt", "exempt": "exempt",
    "обратно начисляване": "reverse_charge", "reverse_charge": "reverse_charge",
    "извън обхвата на ддс": "outside_scope", "извън обхвата": "outside_scope", "outside_scope": "outside_scope",
}

PAYMENT_METHOD_LABELS = {
    "в брой": "cash", "кеш": "cash", "cash": "cash",
    "банков превод": "bank_transfer", "превод": "bank_transfer", "bank_transfer": "bank_transfer",
}

ASSET_CATEGORY_LABELS = {
    "i": "cat_i", "1": "cat_i", "cat_i": "cat_i",
    "ii": "cat_ii", "2": "cat_ii", "cat_ii": "cat_ii",
    "iii": "cat_iii", "3": "cat_iii", "cat_iii": "cat_iii",
    "iv": "cat_iv", "4": "cat_iv", "cat_iv": "cat_iv",
    "v": "cat_v", "5": "cat_v", "cat_v": "cat_v",
    "vi": "cat_vi", "6": "cat_vi", "cat_vi": "cat_vi",
    "vii": "cat_vii", "7": "cat_vii", "cat_vii": "cat_vii",
}


def _resolve_label(raw: Any, mapping: Dict[str, str]) -> Optional[str]:
    if _is_blank(raw):
        return None
    s = str(raw).strip().lower()
    if s in mapping:
        return mapping[s]
    stripped = s.replace("категория", "").strip()
    first_token = stripped.split()[0].strip(" .():-–") if stripped else ""
    return mapping.get(first_token)


# ===================== per-entity row parsers =====================
# Each returns (data | None, errors, warnings). `data` is already shaped for
# the matching xxxCreate model's constructor (JSON-safe primitives only).

def _parse_invoice_row(row: List[Any], table: ParsedTable, _ctx: Dict[str, Any]) -> Tuple[Optional[dict], List[str], List[str]]:
    errors: List[str] = []
    date_val = _parse_date(_get(row, table, "Дата", "Дата на фактурата"))
    supplier = _get(row, table, "Доставчик")
    invoice_number = _get(row, table, "№ Фактура", "Номер на фактура", "Фактура №", "Фактура номер")
    total_amount = _parse_float(_get(row, table, "Обща сума", "Сума"))

    if not date_val:
        errors.append("невалидна или липсваща дата")
    if not supplier:
        errors.append("липсва доставчик")
    if not invoice_number:
        errors.append("липсва номер на фактура")
    if total_amount is None:
        errors.append("липсва или невалидна обща сума")
    if errors:
        return None, errors, []

    eik = _get(row, table, "ЕИК")
    amount_without_vat = _parse_float(_get(row, table, "Сума без ДДС")) or 0
    vat_amount = _parse_float(_get(row, table, "ДДС")) or 0
    vat_treatment_raw = _get(row, table, "ДДС третиране")
    vat_treatment = _resolve_label(vat_treatment_raw, VAT_TREATMENT_LABELS)
    payment_method_raw = _get(row, table, "Начин на плащане")
    payment_method = _resolve_label(payment_method_raw, PAYMENT_METHOD_LABELS)
    due_date = _parse_date(_get(row, table, "Срок за плащане"))
    notes = _get(row, table, "Бележки")

    warnings: List[str] = []
    if vat_treatment_raw and not vat_treatment:
        warnings.append("непознато ДДС третиране - ще се определи автоматично")
    if payment_method_raw and not payment_method:
        warnings.append("непознат начин на плащане - оставен непопълнен")

    data = {
        "date": date_val + "T00:00:00Z",
        "supplier": str(supplier).strip(),
        "supplier_eik": str(eik).strip() if eik else None,
        "invoice_number": str(invoice_number).strip(),
        "amount_without_vat": amount_without_vat,
        "vat_amount": vat_amount,
        "total_amount": total_amount,
        "vat_treatment": vat_treatment,
        "payment_method": payment_method,
        "payment_due_date": f"{due_date}T00:00:00Z" if due_date else None,
        "notes": str(notes).strip() if notes else None,
    }
    return data, [], warnings


def _parse_asset_row(row: List[Any], table: ParsedTable, _ctx: Dict[str, Any]) -> Tuple[Optional[dict], List[str], List[str]]:
    errors: List[str] = []
    name = _get(row, table, "Име на актива", "Име")
    category_raw = _get(row, table, "Категория")
    category = _resolve_label(category_raw, ASSET_CATEGORY_LABELS)
    acquisition_date = _parse_date(_get(row, table, "Дата на придобиване"))
    acquisition_value = _parse_float(_get(row, table, "Стойност на придобиване", "Стойност"))

    if not name:
        errors.append("липсва име на актива")
    if category_raw and not category:
        errors.append(f"непозната категория \"{category_raw}\" (очаква се I-VII)")
    elif not category:
        errors.append("липсва категория (I-VII)")
    if not acquisition_date:
        errors.append("невалидна или липсваща дата на придобиване")
    if acquisition_value is None or acquisition_value <= 0:
        errors.append("липсва или невалидна стойност на придобиване")
    if errors:
        return None, errors, []

    in_service_date = _parse_date(_get(row, table, "Дата на въвеждане в експлоатация")) or acquisition_date
    rate = _parse_float(_get(row, table, "Годишна данъчна норма %", "Норма %"))
    responsible_person = _get(row, table, "Отговорно лице")
    notes = _get(row, table, "Бележки")

    data = {
        "name": str(name).strip(),
        "category": category,
        "acquisition_date": acquisition_date,
        "in_service_date": in_service_date,
        "acquisition_value": acquisition_value,
        "annual_depreciation_rate_percent": rate,
        "responsible_person": str(responsible_person).strip() if responsible_person else None,
        "notes": str(notes).strip() if notes else None,
    }
    return data, [], []


def _parse_budget_row(row: List[Any], table: ParsedTable, _ctx: Dict[str, Any]) -> Tuple[Optional[dict], List[str], List[str]]:
    errors: List[str] = []
    month_raw = _get(row, table, "Месец")
    limit_val = _parse_float(_get(row, table, "Лимит на разходите", "Лимит"))

    month = None
    if not _is_blank(month_raw):
        s = str(month_raw).strip()
        if len(s) == 7 and s[4] == "-":
            month = s
        else:
            parsed_date = _parse_date(s if len(s) > 7 else f"{s}-01")
            if parsed_date:
                month = parsed_date[:7]

    if not month:
        errors.append("невалиден или липсващ месец (очаква се ГГГГ-ММ)")
    if limit_val is None or limit_val <= 0:
        errors.append("липсва или невалиден лимит на разходите")
    if errors:
        return None, errors, []

    threshold = _parse_float(_get(row, table, "Праг за известяване %", "Праг %"))
    data = {
        "month": month,
        "expense_limit": limit_val,
        "alert_threshold": threshold if threshold is not None else 80.0,
    }
    return data, [], []


def _parse_daily_revenue_row(row: List[Any], table: ParsedTable, _ctx: Dict[str, Any]) -> Tuple[Optional[dict], List[str], List[str]]:
    errors: List[str] = []
    date_val = _parse_date(_get(row, table, "Дата"))
    fiscal_revenue = _parse_float(_get(row, table, "Фискализиран оборот", "Оборот"))

    if not date_val:
        errors.append("невалидна или липсваща дата")
    if fiscal_revenue is None:
        errors.append("липсва или невалиден фискализиран оборот")
    if errors:
        return None, errors, []

    pocket_money = _parse_float(_get(row, table, "Джобче")) or 0
    card_revenue = _parse_float(_get(row, table, "От тях - платено с карта", "Платено с карта")) or 0
    vat_rate = _parse_float(_get(row, table, "ДДС ставка %", "ДДС ставка"))

    data = {
        "date": date_val,
        "fiscal_revenue": fiscal_revenue,
        "pocket_money": pocket_money,
        "card_revenue": card_revenue,
        "vat_rate_percent": vat_rate if vat_rate is not None else 20.0,
    }
    warnings = ["ще замести вече въведен оборот за тази дата, ако има такъв"]
    return data, [], warnings


def _parse_expense_row(row: List[Any], table: ParsedTable, _ctx: Dict[str, Any]) -> Tuple[Optional[dict], List[str], List[str]]:
    errors: List[str] = []
    date_val = _parse_date(_get(row, table, "Дата"))
    description = _get(row, table, "Описание")
    amount = _parse_float(_get(row, table, "Сума"))

    if not date_val:
        errors.append("невалидна или липсваща дата")
    if not description:
        errors.append("липсва описание")
    if amount is None:
        errors.append("липсва или невалидна сума")
    if errors:
        return None, errors, []

    data = {"date": date_val, "description": str(description).strip(), "amount": amount}
    return data, [], []


def _parse_payroll_row(row: List[Any], table: ParsedTable, ctx: Dict[str, Any]) -> Tuple[Optional[dict], List[str], List[str]]:
    errors: List[str] = []
    employee_name = _get(row, table, "Служител", "Име на служител")
    month = _parse_int(_get(row, table, "Месец"))
    year = _parse_int(_get(row, table, "Година"))
    gross_amount = _parse_float(_get(row, table, "Брутна сума", "Брутна"))
    net_target = _parse_float(_get(row, table, "Нетна цел", "Нетна"))

    employees_by_name: Dict[str, str] = ctx.get("employees_by_name", {})
    employee_id = None
    if employee_name:
        employee_id = employees_by_name.get(str(employee_name).strip().lower())

    if not employee_name:
        errors.append("липсва име на служител")
    elif not employee_id:
        errors.append(f"служител \"{employee_name}\" не е намерен - добавете го първо в Служители")
    if not month or not (1 <= month <= 12):
        errors.append("невалиден или липсващ месец (1-12)")
    if not year:
        errors.append("липсва или невалидна година")
    if gross_amount is None and net_target is None:
        errors.append("попълнете поне брутна сума или нетна цел")
    if errors:
        return None, errors, []

    bonus = _parse_float(_get(row, table, "Бонус")) or 0
    notes = _get(row, table, "Бележки")

    data = {
        "employee_id": employee_id,
        "period_month": month,
        "period_year": year,
        "gross_amount": gross_amount,
        "net_target": net_target,
        "bonus_amount": bonus,
        "notes": str(notes).strip() if notes else None,
    }
    return data, [], []


_PARSERS = {
    "invoices": _parse_invoice_row,
    "assets": _parse_asset_row,
    "budget": _parse_budget_row,
    "daily_revenue": _parse_daily_revenue_row,
    "expenses": _parse_expense_row,
    "payroll": _parse_payroll_row,
}


def preview_rows(entity: str, table: ParsedTable, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    parser = _PARSERS.get(entity)
    if not parser:
        raise ImportFileError("Непознат тип за импорт.")

    ctx = context or {}
    results = []
    valid_count = 0

    for i, row in enumerate(table.rows):
        if all(_is_blank(v) for v in row):
            continue
        data, errors, warnings = parser(row, table, ctx)
        results.append({
            "row_number": i + 2,  # +1 for the header row, +1 for 1-based counting
            "status": "error" if errors else "ok",
            "data": data,
            "errors": errors,
            "warnings": warnings,
        })
        if not errors:
            valid_count += 1

    return {
        "total_rows": len(results),
        "valid_count": valid_count,
        "error_count": len(results) - valid_count,
        "rows": results,
    }


# ===================== downloadable templates =====================

ENTITY_TEMPLATES = {
    "invoices": {
        "label": "Фактури от доставчици",
        "headers": ["Дата*", "Доставчик*", "ЕИК", "№ Фактура*", "Сума без ДДС", "ДДС", "Обща сума*", "ДДС третиране", "Начин на плащане", "Срок за плащане", "Бележки"],
        "example": ["01.09.2026", "Мелница Добруджа АД", "131071587", "0000001234", "500.00", "100.00", "600.00", "Стандартна 20%", "Банков превод", "15.09.2026", ""],
        "notes": "Полетата с * са задължителни. ДДС третиране: Стандартна 20% / Намалена 9% / Нулева ставка / Освободена доставка / Обратно начисляване / Извън обхвата на ДДС. Начин на плащане: В брой / Банков превод. Дублирана фактура (същия номер + доставчик) се пропуска.",
    },
    "assets": {
        "label": "Дълготрайни активи (ДМА)",
        "headers": ["Име на актива*", "Категория*", "Дата на придобиване*", "Дата на въвеждане в експлоатация", "Стойност на придобиване*", "Годишна данъчна норма %", "Отговорно лице", "Бележки"],
        "example": ["Лаптоп Dell", "IV", "01.03.2026", "05.03.2026", "1800.00", "", "Иван Иванов", ""],
        "notes": "Категория: римско число I-VII. Ако липсва дата на въвеждане в експлоатация, се ползва датата на придобиване. Ако липсва норма, се ползва максималната законова за категорията.",
    },
    "budget": {
        "label": "Бюджет (месечни лимити)",
        "headers": ["Месец*", "Лимит на разходите*", "Праг за известяване %"],
        "example": ["2026-09", "3000.00", "80"],
        "notes": "Месецът е във формат ГГГГ-ММ. Ако вече има бюджет за същия месец, стойностите се заменят с новите, не се сумират.",
    },
    "daily_revenue": {
        "label": "Дневен оборот (назад във времето)",
        "headers": ["Дата*", "Фискализиран оборот*", "Джобче", "От тях - платено с карта", "ДДС ставка %"],
        "example": ["01.09.2026", "450.00", "20.00", "150.00", "20"],
        "notes": "Ако вече има въведен оборот за дадена дата, той се ЗАМЕСТВА с новите стойности, не се сумира с тях.",
    },
    "expenses": {
        "label": "Разходи \"в канала\" (без фактура)",
        "headers": ["Дата*", "Описание*", "Сума*"],
        "example": ["01.09.2026", "Наем на помещение", "800.00"],
        "notes": "Всеки ред се добавя като отделен разход - не презаписва предишни разходи за същата дата.",
    },
    "payroll": {
        "label": "Ведомости за заплати",
        "headers": ["Служител*", "Месец*", "Година*", "Брутна сума", "Нетна цел", "Бонус", "Бележки"],
        "example": ["Иван Иванов", "9", "2026", "1500.00", "", "100.00", ""],
        "notes": "Служителят трябва вече да съществува (Профил -> Служители) с точно това име. Попълнете Брутна сума или Нетна цел според договора му - не и двете. За месец, за който вече има ведомост, редът се пропуска.",
    },
}


def build_template(entity: str) -> bytes:
    if not EXCEL_AVAILABLE:
        raise ImportFileError("Генерирането на Excel файлове не е налично на сървъра.")
    config = ENTITY_TEMPLATES.get(entity)
    if not config:
        raise ImportFileError("Непознат тип за импорт.")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Шаблон"

    n_cols = len(config["headers"])
    last_col = get_column_letter(n_cols)

    ws.merge_cells(f"A1:{last_col}1")
    ws["A1"] = f"Шаблон за импорт - {config['label']}"
    ws["A1"].font = Font(bold=True, size=14)

    ws.merge_cells(f"A2:{last_col}2")
    ws["A2"] = config["notes"]
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    ws["A2"].font = Font(size=10, italic=True, color="475569")
    ws.row_dimensions[2].height = 45

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="8B5CF6", end_color="8B5CF6", fill_type="solid")
    for col, header in enumerate(config["headers"], 1):
        cell = ws.cell(row=4, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    example_font = Font(italic=True, color="94A3B8")
    for col, value in enumerate(config["example"], 1):
        cell = ws.cell(row=5, column=col, value=value)
        cell.font = example_font
    ws.cell(row=5, column=n_cols + 1, value="<- пример, изтрийте този ред преди качване").font = Font(italic=True, size=9, color="EF4444")

    for col in range(1, n_cols + 1):
        ws.column_dimensions[get_column_letter(col)].width = 24

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()

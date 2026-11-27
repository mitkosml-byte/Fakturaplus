"""Checks a purchase invoice before it is saved: do its amounts add up, and
if not, which line most likely is wrong.

Pure arithmetic over what the owner sees in scan review - nothing stored is
read - so it can run again after every edit. Generic for any invoice from
any supplier: the tax base plus VAT against the total, the lines against
the tax base (or against the total, for lines read with VAT), each line's
printed value against quantity x price, and the usual reading slips that
explain a gap: a skipped line, a line read twice, a misplaced decimal
point, a per-line discount."""
from typing import Any, Dict, List, Optional, Tuple

# Base + VAT against the total: rounding only.
HEADER_TOLERANCE = 0.02
HEADER_TOLERANCE_SHARE = 0.0005
# One line: quantity x price against its printed value - the value is
# rounded to cents, the price can carry more digits.
LINE_TOLERANCE = 0.02
LINE_TOLERANCE_SHARE = 0.005
# All lines against the base: each printed value is rounded on its own.
SUM_TOLERANCE = 0.05
SUM_TOLERANCE_PER_LINE = 0.006
# A misplaced decimal point multiplies a value by one of these.
DECIMAL_FACTORS = (10.0, 100.0, 0.1, 0.01)


def _money(value: float) -> float:
    return round(value + 0.0, 2)


def _is_round(value: float, decimals: int) -> bool:
    scaled = value * (10 ** decimals)
    return abs(scaled - round(scaled)) < 1e-6 * max(1.0, abs(scaled))


def _name_key(name: str) -> str:
    return " ".join((name or "").lower().split())


def _line_value_flag(line: Dict[str, Any]) -> Dict[str, Any]:
    """quantity x price differs from the printed value: one of the two was
    read wrong. Both readings that would match are offered - a price that
    gives the printed value (always), and a quantity that does when it is a
    plausible quantity (at most 3 decimals)."""
    flag: Dict[str, Any] = {
        "index": line["index"], "kind": "line_value_mismatch",
        "computed": _money(line["value"]), "printed": _money(line["printed"]),
    }
    if line["quantity"]:
        flag["unit_price"] = round(line["printed"] / line["quantity"], 4)
    if line["unit_price"]:
        quantity = line["printed"] / line["unit_price"]
        if quantity > 0 and _is_round(quantity, 3) and abs(quantity - line["quantity"]) > 1e-9:
            flag["quantity"] = round(quantity, 3)
    return flag


def _duplicate_line(lines: List[Dict[str, Any]], difference: float, tolerance: float) -> Optional[int]:
    """The later of two identical lines (name, quantity, price) whose value
    is exactly the excess - a row read twice, typically where a table runs
    over a page break."""
    if difference <= 0:
        return None
    seen: Dict[Tuple[str, float, float], int] = {}
    for line in lines:
        key = (_name_key(line["name"]), round(line["quantity"], 6), round(line["unit_price"], 6))
        if key in seen and key[0] and abs(line["value"] - difference) <= tolerance:
            return line["index"]
        seen.setdefault(key, line["index"])
    return None


def _decimal_slip(lines: List[Dict[str, Any]], difference: float, tolerance: float) -> Optional[Tuple[int, float]]:
    """The one line whose value, with the decimal point moved, closes the
    gap. More than one such line is a guess, not an answer - then none."""
    found: List[Tuple[int, float]] = []
    for line in lines:
        if not line["value"]:
            continue
        for factor in DECIMAL_FACTORS:
            if abs(difference - line["value"] + line["value"] * factor) <= tolerance:
                found.append((line["index"], factor))
    return found[0] if len(found) == 1 else None


def check_invoice_draft(
    amount_without_vat: float, vat_amount: float, total_amount: float, items: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """{"header": ..., "lines": ..., "line_flags": [...]} for a draft.

    items: dicts with name, quantity, unit_price and, for a recognized line,
    printed_total - the line's value as printed on the invoice (without
    VAT, like the base).

    header: None when base + VAT matches the total, else what they add up to.
    lines: None without lines or a base; else the sum against the base with
    `ok`, and when it is off, the most likely `cause` and the `fixes` that
    would close the gap ({index, unit_price} per line, or `remove_index`):
    line_values (the printed line values add up, quantity x price does not -
    a per-line discount or a misread line), vat_included (the lines add up
    to the total, so their prices carry VAT), duplicate_line, decimal_slip,
    missing_line (lines short of the base) or extra (lines over it).
    line_flags: lines whose quantity x price differs from their printed value."""
    base = float(amount_without_vat or 0)
    vat = float(vat_amount or 0)
    total = float(total_amount or 0)
    result: Dict[str, Any] = {"header": None, "lines": None, "line_flags": []}

    if base > 0 and total > 0 and abs(base + vat - total) > max(HEADER_TOLERANCE, HEADER_TOLERANCE_SHARE * total):
        result["header"] = {
            "expected_total": _money(base + vat), "total_amount": _money(total),
            "difference": _money(total - base - vat),
        }

    lines: List[Dict[str, Any]] = []
    for index, item in enumerate(items):
        quantity = float(item.get("quantity") or 0)
        unit_price = float(item.get("unit_price") or 0)
        printed_raw = item.get("printed_total")
        printed = float(printed_raw) if isinstance(printed_raw, (int, float)) and printed_raw != 0 else None
        value = quantity * unit_price
        mismatch = printed is not None and abs(value - printed) > max(LINE_TOLERANCE, LINE_TOLERANCE_SHARE * abs(printed))
        line = {
            "index": index, "name": item.get("name") or "", "quantity": quantity,
            "unit_price": unit_price, "value": value, "printed": printed, "mismatch": mismatch,
        }
        lines.append(line)
        if mismatch:
            result["line_flags"].append(_line_value_flag(line))

    if not lines or base <= 0:
        return result

    tolerance = SUM_TOLERANCE + SUM_TOLERANCE_PER_LINE * len(lines)
    lines_sum = sum(line["value"] for line in lines)
    printed_sum = sum(line["printed"] if line["printed"] is not None else line["value"] for line in lines)
    difference = lines_sum - base
    check: Dict[str, Any] = {
        "sum": _money(lines_sum), "base": _money(base), "difference": _money(difference),
        "ok": False, "cause": None, "fixes": [], "remove_index": None, "index": None, "factor": None,
    }
    if abs(difference) <= tolerance:
        check.update(ok=True, cause="ok")
    elif any(line["mismatch"] for line in lines) and abs(printed_sum - base) <= tolerance:
        mismatched = [line for line in lines if line["mismatch"] and line["quantity"]]
        check["cause"] = "line_values"
        check["fixes"] = [
            {"index": line["index"], "unit_price": round(line["printed"] / line["quantity"], 4)} for line in mismatched
        ]
        if len(mismatched) == 1:
            check["index"] = mismatched[0]["index"]
    elif vat > 0 and total > 0 and (abs(lines_sum - total) <= tolerance or abs(printed_sum - total) <= tolerance):
        factor = total / base
        check["cause"] = "vat_included"
        check["factor"] = round(factor, 4)
        check["fixes"] = [
            {"index": line["index"], "unit_price": round(line["unit_price"] / factor, 4)}
            for line in lines if line["unit_price"]
        ]
    else:
        duplicate = _duplicate_line(lines, difference, tolerance)
        slip = None if duplicate is not None else _decimal_slip(lines, difference, tolerance)
        if duplicate is not None:
            check["cause"] = "duplicate_line"
            check["remove_index"] = duplicate
            check["index"] = duplicate
        elif slip is not None:
            index, factor = slip
            check["cause"] = "decimal_slip"
            check["index"] = index
            check["factor"] = factor
            check["fixes"] = [{"index": index, "unit_price": round(lines[index]["unit_price"] * factor, 4)}]
        else:
            check["cause"] = "missing_line" if difference < 0 else "extra"
    result["lines"] = check
    return result

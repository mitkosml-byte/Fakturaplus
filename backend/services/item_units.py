"""Items: their size and content as written in their names (500 г, 2 л,
6x330 мл), the price per base unit (кг, л, бр), units and their labels, and
the keys that match a supplier's EIK and an invoice's number however they
were typed. Pure functions - no database; moved out of server.py, which
imports them from here."""
import re
from typing import Dict, List, Optional

# What one invoice line of an item actually holds, read from its name and
# unit - "Доматен сос 5кг" is 5 kg a tin, "Айран 250мл" 0.25 l a cup, "Кола
# 0,5л x 6" 3 l a pack, "Яйца 30 бр" 30 pieces - so prices and quantities
# can be compared per kg, l or piece across pack sizes and suppliers.
# Generic: plain units of measure, nothing trade-specific.

_CONTENT_UNITS = {
    "кг": ("кг", 1.0), "kg": ("кг", 1.0),
    "гр": ("кг", 0.001), "г": ("кг", 0.001), "g": ("кг", 0.001),
    "мл": ("л", 0.001), "ml": ("л", 0.001),
    "лт": ("л", 1.0), "lt": ("л", 1.0), "л": ("л", 1.0), "l": ("л", 1.0),
}
_SIZE_TOKEN_RE = re.compile(r'(\d+(?:[.,]\d+)?)\s*(кг|kg|гр|г|g|мл|ml|лт|lt|л|l)(?![^\W\d_])', re.IGNORECASE)
_MULTIPACK_RE = re.compile(r'(?:[xх×*]\s*(\d+)(?![\d.,]))|(?:(?<![\d.,])(\d+)\s*[xх×*](?![^\W\d_]))', re.IGNORECASE)
_PIECES_RE = re.compile(r'(\d+)\s*(?:бр|броя|pcs)(?![^\W\d_])', re.IGNORECASE)
# normalize_unit() keys sold by weight or volume: (base unit, factor to it)
_MEASURE_UNIT_BASE = {"кг": ("кг", 1.0), "г": ("кг", 0.001), "л": ("л", 1.0), "мл": ("л", 0.001)}


def _fmt_amount(value: float) -> str:
    return f"{round(value, 6):g}"


def _fmt_bare_number(n: str) -> str:
    int_part, _, frac = n.replace(',', '.').partition('.')
    int_part = int_part.lstrip('0') or '0'
    frac = frac.rstrip('0')
    return f"{int_part}.{frac}" if frac else int_part


def item_content(name: str) -> Optional[tuple]:
    """(amount, base unit) one line unit of this item holds, from its name:
    "Доматен сос 5кг" -> (5, 'кг'), "Айран 250мл" -> (0.25, 'л'),
    "Кола 0,5л x 6" -> (3, 'л'), "Яйца 30 бр" -> (30, 'бр'); None when
    the name says nothing about size."""
    text = (name or "").lower()
    size = _SIZE_TOKEN_RE.search(text)
    rest = _SIZE_TOKEN_RE.sub(' ', text)
    multipack = _MULTIPACK_RE.search(rest)
    count = int(next(g for g in multipack.groups() if g)) if multipack else None
    pieces = _PIECES_RE.search(rest)
    if size:
        base, factor = _CONTENT_UNITS[size.group(2).lower()]
        amount = float(size.group(1).replace(',', '.')) * factor * (count or (int(pieces.group(1)) if pieces else 1))
        return (round(amount, 6), base) if amount > 0 else None
    if pieces:
        amount = int(pieces.group(1)) * (count or 1)
        return (float(amount), "бр") if amount > 0 else None
    return None


def base_unit_price(unit_price: float, name: str, unit: Optional[str]) -> Optional[tuple]:
    """(price per kg / l / piece, that base unit) for one line, or None when
    neither the unit nor the name tells what a unit holds (a "стек" of an
    item whose name has no size)."""
    key = normalize_unit(unit)
    if key in _MEASURE_UNIT_BASE:
        base, factor = _MEASURE_UNIT_BASE[key]
        return round(unit_price / factor, 6), base
    content = item_content(name)
    if content:
        return round(unit_price / content[0], 6), content[1]
    if key == "бр":
        return unit_price, "бр"
    return None


def base_quantity(quantity: float, name: str, unit: Optional[str]) -> Optional[tuple]:
    """(amount in kg / l / pieces, that base unit) for a line's quantity, or
    None when what a unit holds is unknown."""
    key = normalize_unit(unit)
    if key in _MEASURE_UNIT_BASE:
        base, factor = _MEASURE_UNIT_BASE[key]
        return quantity * factor, base
    content = item_content(name)
    if content:
        return quantity * content[0], content[1]
    if key == "бр":
        return float(quantity), "бр"
    return None


UNIT_LABELS = {"бр": "бр.", "оп": "оп.", "кг": "кг", "г": "г", "л": "л", "мл": "мл", "м": "м"}


def unit_label(unit_key: str) -> str:
    return UNIT_LABELS.get(unit_key, unit_key)


def item_size_signature(name: str) -> tuple:
    """The sizes and numbers in an item name, normalized and sorted
    ("Доматен сос 5кг" -> ('5кг',), "Кока-Кола 0,5л x 6" -> ('0.5л', '6'),
    "Кола 500мл" -> ('0.5л',) like "Кола 0.5л"). Two names that differ in
    these are different products for pricing purposes - a 1 kg and a 5 kg
    tin, a single bottle and a 6-pack - however similar the rest of the
    text, so every item-merging path (fuzzy match at write time, AI
    grouping, saved merge mappings, the owner's own "same" choice) refuses
    to join names whose signatures differ."""
    text = (name or "").lower()
    tokens = [
        f"{_fmt_amount(float(amount.replace(',', '.')) * _CONTENT_UNITS[unit.lower()][1])}{_CONTENT_UNITS[unit.lower()][0]}"
        for amount, unit in _SIZE_TOKEN_RE.findall(text)
    ]
    tokens += [_fmt_bare_number(n) for n in re.findall(r'\d+(?:[.,]\d+)?', _SIZE_TOKEN_RE.sub(' ', text))]
    return tuple(sorted(tokens))

_UNIT_ALIASES = {
    "бр": "бр", "броя": "бр", "брой": "бр", "pcs": "бр", "pc": "бр", "бройка": "бр",
    "кг": "кг", "kg": "кг", "килограм": "кг", "килограма": "кг",
    "г": "г", "гр": "г", "g": "г", "грам": "г",
    "л": "л", "l": "л", "литър": "л", "литра": "л", "lt": "л",
    "мл": "мл", "ml": "мл",
    "м": "м", "m": "м", "метър": "м",
    "оп": "оп", "опаковка": "оп", "опак": "оп", "пак": "оп", "пакет": "оп",
    "стек": "стек", "кашон": "кашон", "кутия": "кутия", "кут": "кутия",
}

def normalize_unit(unit: Optional[str]) -> str:
    """Folds the spellings OCR and people use for one unit ("бр", "бр.",
    "БР", "броя", "pcs") into one key, so a price is only ever compared
    with earlier prices in the same unit."""
    key = re.sub(r'[\s.]', '', (unit or "").lower())
    return _UNIT_ALIASES.get(key, key or "бр")

def build_variant_to_canonical(mappings: List[dict]) -> tuple:
    """(variant -> canonical, canonical -> display name) from saved
    item_merge_mappings, skipping any variant whose size signature differs
    from its canonical's - older AI groupings were told to merge different
    pack sizes, and those joins must not keep comparing a 5 kg price with a
    1 kg one. Every reader of merge mappings goes through this one place."""
    variant_to_canonical: Dict[str, str] = {}
    canonical_display: Dict[str, str] = {}
    for m in mappings:
        canonical = m["canonical_name"]
        canonical_display[canonical] = m.get("display_name", canonical)
        canonical_signature = item_size_signature(canonical)
        for variant in m.get("variants", []):
            if item_size_signature(variant) == canonical_signature:
                variant_to_canonical[variant.lower()] = canonical
    return variant_to_canonical, canonical_display

def eik_key(value: Optional[str]) -> str:
    """An EIK / VAT number as its digits only ("BG 123456789" -> "123456789")."""
    return re.sub(r"\D", "", str(value or ""))


def invoice_number_key(value: Optional[str]) -> str:
    """How two invoice numbers are compared: without spaces, case-blind,
    and a purely numeric one without its leading zeros - "0000001234" read
    off one copy and "1234" typed from another are the same invoice."""
    key = re.sub(r"\s+", "", str(value or "")).upper()
    if key.isdigit():
        return key.lstrip("0") or "0"
    return key

"""Cyrillic to Latin, letter by letter - for file names any computer opens
and for comparing names a bank wrote in Latin with names entered in
Cyrillic."""
from typing import Any

_CYRILLIC = "абвгдежзийклмнопрстуфхцчшщъьюя"
_LATIN_OF = ["a", "b", "v", "g", "d", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f",
             "h", "ts", "ch", "sh", "sht", "a", "y", "yu", "ya"]
_MAP = {
    **dict(zip(_CYRILLIC, _LATIN_OF)),
    **dict(zip(_CYRILLIC.upper(), (latin.capitalize() for latin in _LATIN_OF))),
}


def to_latin(text: Any) -> str:
    return "".join(_MAP.get(ch, ch) for ch in str(text or ""))

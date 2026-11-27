"""The names of the months, once for the whole server: Bulgarian as in a
date ("15 ноември"), with a capital to start a title ("Ноември 2026"), and
English."""
from typing import List

MONTHS_BG: List[str] = [
    "януари", "февруари", "март", "април", "май", "юни",
    "юли", "август", "септември", "октомври", "ноември", "декември",
]
MONTHS_BG_TITLE: List[str] = [name.capitalize() for name in MONTHS_BG]
MONTHS_EN: List[str] = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

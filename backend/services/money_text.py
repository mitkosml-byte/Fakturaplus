"""Money in the texts the program writes - signals, reminders, analyses,
PDFs - in the one format the screens use (Л11): "18 844,00 €", thousands
apart, a decimal comma, two decimals; in English "18,844.00 €".

The spaces are non-breaking, so an amount never splits over two lines.
Only for text: a number stored or sent as data stays a number."""
from typing import Optional

NBSP = " "


def fmt_amount(value: Optional[float], en: bool = False) -> str:
    """The amount without the euro sign: for a text that has the € after it."""
    number = float(value or 0)
    text = f"{abs(number):,.2f}"  # "18,844.00"
    if not en:
        text = text.replace(",", NBSP).replace(".", ",")
    # No "-0,00": a minus only on what is still below zero once rounded.
    return ("-" if number < 0 and round(abs(number), 2) > 0 else "") + text


def fmt_eur(value: Optional[float], en: bool = False) -> str:
    return f"{fmt_amount(value, en)}{NBSP}€"

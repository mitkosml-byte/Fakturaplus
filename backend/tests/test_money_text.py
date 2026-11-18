"""The one money format in the texts the program writes (Л11)."""
from services.money_text import fmt_amount, fmt_eur

NBSP = " "


def test_amounts_read_the_same_everywhere():
    assert fmt_eur(18844) == f"18{NBSP}844,00{NBSP}€"
    assert fmt_eur(1234567.891) == f"1{NBSP}234{NBSP}567,89{NBSP}€"
    assert fmt_eur(0.5) == f"0,50{NBSP}€"
    assert fmt_eur(None) == f"0,00{NBSP}€"
    assert fmt_amount(-120) == "-120,00"
    assert fmt_amount(-0.001) == "0,00"          # no "-0,00"
    assert fmt_eur(18844, en=True) == f"18,844.00{NBSP}€"

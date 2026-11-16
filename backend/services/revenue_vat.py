"""A day's till revenue by VAT rate.

The fiscal device's daily report gives a day's sales by VAT group (each
group with its own rate). A day is either split that way, in its
`vat_groups`, or all at its one `vat_rate_percent`. This is the one place
that says how much of a day is at which rate, for every VAT figure: the
summary, the chart and the sales ledger.
"""
from typing import Any, Dict, Iterable, List, Tuple

DEFAULT_RATE = 20.0


def rate_of(value: Any) -> float:
    """A stored rate; one never set counts as the standard 20%."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return DEFAULT_RATE


def vat_parts(rev: dict) -> List[Tuple[float, float]]:
    """(rate %, amount with VAT) of each part of a day's till revenue:
    its VAT groups when the day has them, else the whole at its one rate."""
    groups = [g for g in (rev.get("vat_groups") or []) if isinstance(g, dict)]
    if groups:
        return [(rate_of(g.get("rate_percent")), float(g.get("amount") or 0)) for g in groups]
    return [(rate_of(rev.get("vat_rate_percent", DEFAULT_RATE)), float(rev.get("fiscal_revenue") or 0))]


def vat_of(rate: float, amount: float) -> float:
    """The VAT inside an amount that includes it."""
    return amount * rate / (100 + rate) if rate > 0 else 0.0


def vat_in(rev: dict) -> float:
    """The VAT inside a day's till revenue, each part at its own rate."""
    return sum(vat_of(rate, amount) for rate, amount in vat_parts(rev))


def normalize_groups(groups: Iterable[Any]) -> List[Dict[str, float]]:
    """The groups as stored: the same rate added together (two groups of the
    report can share a rate), empty ones left out, the highest rate first."""
    by_rate: Dict[float, float] = {}
    for group in groups:
        data = group if isinstance(group, dict) else group.model_dump()
        rate = round(float(data["rate_percent"]), 2)
        by_rate[rate] = by_rate.get(rate, 0.0) + float(data["amount"])
    return [
        {"rate_percent": rate, "amount": round(amount, 2)}
        for rate, amount in sorted(by_rate.items(), reverse=True)
        if round(amount, 2) > 0
    ]

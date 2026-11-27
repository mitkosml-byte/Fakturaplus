"""The daily review points at invoices whose amount without VAT and VAT do
not add up to their total - a typo, or an amount saved without its cents
before the decimal comma was read in every form. Invented suppliers and
numbers."""
import asyncio
from datetime import timedelta

import server
from tests.test_whole_program_fixes import _company, _user


def _invoice(company_id, owner_id, number, net, vat, total, days_ago=10, **extra):
    asyncio.run(server.db.invoices.insert_one({
        "id": f"inv-{company_id}-{number}", "company_id": company_id, "user_id": owner_id,
        "supplier": "Доставчик Проба", "invoice_number": number,
        "date": server.day_start_utc(server.today_local() - timedelta(days=days_ago)),
        "amount_without_vat": net, "vat_amount": vat, "total_amount": total, **extra,
    }))


def _signal(client, headers):
    signals = client.get("/api/proactive/signals", headers=headers).json()
    items = signals.get("signals", signals) if isinstance(signals, dict) else signals
    return next((s for s in items if s["key"] == "invoice_sums"), None)


def test_invoices_that_do_not_add_up_are_pointed_at(client):
    company_id, owner_id, owner = _company()
    _invoice(company_id, owner_id, "A-1", 100, 20, 120)            # adds up
    _invoice(company_id, owner_id, "A-2", 100.004, 20, 120)        # rounding
    assert _signal(client, owner) is None

    _invoice(company_id, owner_id, "A-3", 12, 2.5, 15)             # "12,50" saved as 12
    _invoice(company_id, owner_id, "A-4", 0, 0, 50, vat_treatment="reverse_charge")
    _invoice(company_id, owner_id, "A-5", 1, 1, 50, days_ago=400)  # older than a year
    signal = _signal(client, owner)
    assert signal is not None and signal["detail"].startswith("1 фактура")
    assert signal["route"].endswith(f"invoiceId=inv-{company_id}-A-3")

    # Someone who may not correct invoices is not told.
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    assert _signal(client, cashier) is None

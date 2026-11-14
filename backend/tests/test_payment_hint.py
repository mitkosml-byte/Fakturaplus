"""P1 payment hint: overdue bank-transfer invoices from a supplier the
company kept buying from after the due date are most likely paid but not
ticked - asked about with a one-tap "mark paid", instead of a permanent
red alarm. Builds its own company, so it does not depend on test order."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import server
from routers.invoices import MarkInvoicesPaidRequest, mark_invoices_paid


def test_overdue_invoices_from_suppliers_still_used_are_asked_about_not_alarmed():
    company_id = f"company_{uuid.uuid4().hex[:12]}"
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    perms = ["manage_invoices", "view_statistics"]
    user = server.User(user_id=user_id, email=f"{user_id}@test.com", name="Owner", role="owner",
                       company_id=company_id, permissions=perms)
    now = datetime.now(timezone.utc)

    def _invoice(inv_id, supplier, days_ago, method="bank_transfer", paid=False, due_days_after=14):
        date = now - timedelta(days=days_ago)
        return {
            "id": inv_id, "company_id": company_id, "user_id": user_id, "supplier": supplier,
            "invoice_number": inv_id, "date": date, "total_amount": 120.0, "amount_without_vat": 100.0,
            "vat_amount": 20.0, "payment_method": method, "is_paid": paid, "paid_amount": 0.0,
            "payment_due_date": date + timedelta(days=due_days_after) if method == "bank_transfer" else None,
        }

    async def _run():
        await server.db.users.insert_one({
            "user_id": user_id, "email": user.email, "name": "Owner", "role": "owner", "company_id": company_id,
            "permissions": perms, "auth_provider": "email", "has_password": True,
            "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION, "created_at": now,
        })
        await server.db.invoices.insert_many([
            _invoice("metro-old", "Метро", 45),            # due 31 days ago...
            _invoice("metro-new", "Метро", 5, "cash"),     # ...but bought from Метро again since
            _invoice("bakery-old", "Пекарна", 40),         # due 26 days ago, nothing since
        ])
        before = {s["key"]: s for s in await server.get_proactive_signals(user)}
        result = await mark_invoices_paid(MarkInvoicesPaidRequest(invoice_ids=["metro-old", "bakery-new-unknown"]),
                                          current_user=user)
        after = {s["key"]: s for s in await server.get_proactive_signals(user)}
        metro = await server.db.invoices.find_one({"id": "metro-old"}, {"_id": 0})
        return before, result, after, metro

    before, result, after, metro = asyncio.run(_run())
    assert before["unpaid_invoices"]["severity"] == "critical"
    assert before["unpaid_invoices"]["detail"].startswith("1 от 2")
    likely = before["invoices_likely_paid"]
    assert likely["invoice_ids"] == ["metro-old"] and likely["actions"] == ["mark_paid", "snooze"]
    assert "Метро" in likely["detail"]

    assert result == {"updated": 1}
    assert metro["is_paid"] is True and metro["paid_amount"] == 120.0
    assert "invoices_likely_paid" not in after
    assert after["unpaid_invoices"]["detail"].startswith("1 от 1")

"""End-to-end API regression suite for Фактура+.

Committed version of the ad-hoc manual test script used throughout
development, converted to real pytest so it runs as part of CI/local
`pytest` instead of only ever being run by hand. Tests share one
in-memory database and largely one owner/staff pair across the whole
module (like the original script), so they run in file order and build
on each other's state - this mirrors real usage (an owner invites staff,
enters revenue, then checks permission gating against that same data)
rather than testing each endpoint in total isolation.
"""
import time
from datetime import datetime

from .conftest import auth_headers as h

TS = int(time.time())
CURRENT_MONTH = datetime.now().strftime("%Y-%m")

# Shared across test functions within this module, mirroring the shared
# variables the original manual script used (owner_token, invoice_id, ...).
STATE = {}


def test_auth(client):
    owner_email = f"master_owner_{TS}@test.com"
    r = client.post("/api/auth/register", json={"name": "Master Owner", "email": owner_email, "password": "Passw0rd1"})
    assert r.status_code == 200, r.text
    STATE["owner_token"] = r.json()["session_token"]
    STATE["owner_id"] = r.json()["user"]["user_id"]

    r = client.post("/api/auth/login", json={"email": owner_email, "password": "WrongPass1"})
    assert r.status_code == 401 and r.json()["detail"] == "Невалиден имейл или парола"

    r = client.post("/api/auth/login", json={"email": owner_email, "password": "Passw0rd1"})
    assert r.status_code == 200

    r = client.get("/api/auth/me", headers=h(STATE["owner_token"]))
    assert r.status_code == 200 and r.json()["role"] == "owner"


def test_invoices(client):
    owner = h(STATE["owner_token"])
    r = client.post("/api/invoices", headers=owner, json={
        "supplier": "Тест Доставчик ЕООД", "invoice_number": "INV-0001",
        "amount_without_vat": 100, "vat_amount": 20, "total_amount": 120, "date": "2026-09-01",
    })
    assert r.status_code == 200, r.text
    invoice_id = r.json()["id"]

    r = client.get("/api/invoices", headers=owner)
    assert r.status_code == 200 and len(r.json()) == 1

    r = client.get("/api/invoices?supplier=Тест", headers=owner)
    assert r.status_code == 200 and len(r.json()) == 1

    r = client.get(f"/api/invoices/{invoice_id}", headers=owner)
    assert r.status_code == 200

    r = client.put(f"/api/invoices/{invoice_id}", headers=owner, json={"total_amount": 150})
    assert r.status_code == 200 and r.json()["total_amount"] == 150

    # Re-saving the exact same value must not 404 (modified_count == 0 is
    # not "not found" - see the fix for this bug).
    r = client.put(f"/api/invoices/{invoice_id}", headers=owner, json={"total_amount": 150})
    assert r.status_code == 200

    # Regex-injection defense sanity check (should not error, should not
    # match unrelated data via an unescaped metacharacter).
    r = client.get("/api/invoices?supplier=.*", headers=owner)
    assert r.status_code == 200

    # Negative/zero amounts must be rejected at the API boundary.
    r = client.post("/api/invoices", headers=owner, json={
        "supplier": "X", "invoice_number": "BAD-1",
        "amount_without_vat": 10, "vat_amount": 2, "total_amount": -12, "date": "2026-09-01",
    })
    assert r.status_code == 422

    r = client.delete(f"/api/invoices/{invoice_id}", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/invoices", headers=owner)
    assert r.status_code == 200 and len(r.json()) == 0


def test_daily_revenue(client):
    owner = h(STATE["owner_token"])
    r = client.post("/api/daily-revenue", headers=owner, json={
        "date": "2026-09-10", "fiscal_revenue": 100, "pocket_money": 20, "vat_rate_percent": 20,
    })
    assert r.status_code == 200

    # Second save for the same date edits in place - REPLACED, not summed.
    r = client.post("/api/daily-revenue", headers=owner, json={
        "date": "2026-09-10", "fiscal_revenue": 100, "pocket_money": 15, "vat_rate_percent": 20,
    })
    assert r.status_code == 200
    assert r.json()["pocket_money"] == 15

    r = client.get("/api/daily-revenue/by-date/2026-09-10", headers=owner)
    assert r.status_code == 200 and r.json()["pocket_money"] == 15

    r = client.get("/api/daily-revenue/today", headers=owner)
    assert r.status_code == 200


def test_customers_and_receivables(client):
    """Module 7 Finding #2: the mirror image of payables (what the
    business owes suppliers, already covered by test_invoices'
    payment_status filters) - what customers owe the business."""
    owner = h(STATE["owner_token"])

    r = client.post("/api/customers", headers=owner, json={"name": "Иван Иванов", "phone": "0888123456"})
    assert r.status_code == 200, r.text
    customer_id = r.json()["id"]

    r = client.get("/api/customers?search=Иван", headers=owner)
    assert r.status_code == 200 and len(r.json()) == 1

    r = client.put(f"/api/customers/{customer_id}", headers=owner, json={"email": "ivan@test.com"})
    assert r.status_code == 200 and r.json()["email"] == "ivan@test.com"

    # A receivable doesn't require a Customer record - customer_name alone
    # is enough (the "lightweight, never a CRM" boundary from the audit).
    r = client.post("/api/receivables", headers=owner, json={
        "customer_name": "Петър Петров (без запис)", "amount": 150, "due_date": "2020-01-01",
    })
    assert r.status_code == 200, r.text
    overdue_id = r.json()["id"]

    r = client.post("/api/receivables", headers=owner, json={
        "customer_id": customer_id, "customer_name": "Иван Иванов", "amount": 80, "due_date": "2099-01-01",
    })
    assert r.status_code == 200
    not_due_id = r.json()["id"]

    # Validation: amount must be positive.
    r = client.post("/api/receivables", headers=owner, json={"customer_name": "x", "amount": 0})
    assert r.status_code == 422

    r = client.get("/api/receivables?status=overdue", headers=owner)
    assert r.status_code == 200
    overdue_ids = {x["id"] for x in r.json()}
    assert overdue_id in overdue_ids and not_due_id not in overdue_ids

    r = client.get("/api/receivables/summary", headers=owner)
    assert r.status_code == 200
    summary = r.json()
    assert summary["total_owed"] == 230 and summary["unpaid_count"] == 2
    assert summary["total_overdue"] == 150 and summary["overdue_count"] == 1

    # Marking paid stamps paid_at/paid_amount and drops it out of the
    # overdue/unpaid totals.
    r = client.put(f"/api/receivables/{overdue_id}", headers=owner, json={"is_paid": True})
    assert r.status_code == 200
    assert r.json()["is_paid"] is True and r.json()["paid_amount"] == 150 and r.json()["paid_at"] is not None

    r = client.get("/api/receivables/summary", headers=owner)
    assert r.json()["total_owed"] == 80 and r.json()["overdue_count"] == 0

    r = client.delete(f"/api/receivables/{not_due_id}", headers=owner)
    assert r.status_code == 200
    r = client.delete(f"/api/customers/{customer_id}", headers=owner)
    assert r.status_code == 200

    # A staff member without add_revenue must be refused - created
    # directly against the DB (same shortcut other tests in this module
    # use for an extra user) rather than through the rate-limited
    # register/invite/accept flow, which is already exercised elsewhere.
    import asyncio
    import uuid as uuid_module
    import server as server_module
    from datetime import timedelta, timezone as tz

    no_revenue_staff_id = f"user_{uuid_module.uuid4().hex[:12]}"
    no_revenue_staff_token = uuid_module.uuid4().hex

    async def _make_no_revenue_staff():
        me = client.get("/api/auth/me", headers=owner).json()
        await server_module.db.users.insert_one({
            "user_id": no_revenue_staff_id, "email": f"{no_revenue_staff_id}@test.com", "name": "No Revenue Staff",
            # A non-empty list that excludes add_revenue - an EMPTY list is
            # treated by sanitize_user as "never configured" and silently
            # backfilled to the role's default set, which would defeat
            # this exact check.
            "role": "staff", "company_id": me["company_id"], "permissions": ["view_statistics"],
            "auth_provider": "email", "has_password": True,
            "permissions_schema_version": server_module.PERMISSIONS_SCHEMA_VERSION,
            "created_at": server_module.datetime.now(tz.utc),
        })
        await server_module.db.user_sessions.insert_one({
            "user_id": no_revenue_staff_id, "session_token": no_revenue_staff_token,
            "expires_at": server_module.datetime.now(tz.utc) + timedelta(days=7),
            "created_at": server_module.datetime.now(tz.utc),
        })

    asyncio.run(_make_no_revenue_staff())
    r = client.post("/api/customers", headers=h(no_revenue_staff_token), json={"name": "x"})
    assert r.status_code == 403


def test_billing_documents(client):
    """Module 7 Finding #3 (decided): a non-fiscal bill/quote - a quote
    never touches receivables, a bill automatically creates one (Module
    11's "full non-fiscal loop")."""
    owner = h(STATE["owner_token"])

    # A quote is just a document - no money owed yet, no receivable.
    r = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "quote", "customer_name": "Оферта Клиент",
        "items": [{"name": "Монтаж", "quantity": 2, "unit": "час", "unit_price": 30}],
    })
    assert r.status_code == 200, r.text
    quote = r.json()
    assert quote["total_amount"] == 60
    assert quote["receivable_id"] is None

    # A bill IS money owed - must auto-create a matching receivable.
    r = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "bill", "customer_name": "Сметка Клиент",
        "items": [{"name": "Труд", "quantity": 1, "unit": "бр.", "unit_price": 100}],
        "notes": "Поправка на инсталация",
    })
    assert r.status_code == 200, r.text
    bill = r.json()
    assert bill["total_amount"] == 100
    assert bill["receivable_id"] is not None

    r = client.get("/api/receivables?status=unpaid", headers=owner)
    assert r.status_code == 200
    matching = [x for x in r.json() if x["id"] == bill["receivable_id"]]
    assert len(matching) == 1 and matching[0]["amount"] == 100 and matching[0]["customer_name"] == "Сметка Клиент"

    # Empty items list must be rejected, not silently accepted as a 0-total doc.
    r = client.post("/api/billing-documents", headers=owner, json={"customer_name": "x", "items": []})
    assert r.status_code == 422

    # PDF export must actually return a PDF.
    r = client.get(f"/api/billing-documents/{bill['id']}/pdf", headers=owner)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")

    r = client.get("/api/billing-documents", headers=owner)
    assert r.status_code == 200 and len(r.json()) >= 2

    r = client.delete(f"/api/billing-documents/{quote['id']}", headers=owner)
    assert r.status_code == 200
    r = client.get(f"/api/billing-documents/{quote['id']}", headers=owner)
    assert r.status_code == 404


def test_expenses(client):
    owner = h(STATE["owner_token"])
    r = client.post("/api/expenses", headers=owner, json={"description": "Гориво", "amount": 50, "date": "2026-09-10"})
    assert r.status_code == 200
    exp1_id = r.json()["id"]

    r = client.post("/api/expenses", headers=owner, json={"description": "Канцеларски материали", "amount": 30, "date": "2026-09-10"})
    assert r.status_code == 200

    r = client.get("/api/expenses", headers=owner)
    assert r.status_code == 200 and len(r.json()) == 2

    r = client.delete(f"/api/expenses/{exp1_id}", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/expenses", headers=owner)
    assert r.status_code == 200 and len(r.json()) == 1


def test_personal_expenses(client):
    owner = h(STATE["owner_token"])
    r = client.post("/api/personal-expenses", headers=owner, json={
        "amount": 200, "description": "Лична инвестиция", "expense_type": "investment", "category": "other",
        "period_month": 9, "period_year": 2026,
    })
    assert r.status_code == 200
    pe_id = r.json()["id"]

    r = client.get("/api/personal-expenses", headers=owner)
    assert r.status_code == 200 and len(r.json()["personal_expenses"]) == 1

    r = client.delete(f"/api/personal-expenses/{pe_id}", headers=owner)
    assert r.status_code == 200


def test_budget(client):
    owner = h(STATE["owner_token"])
    r = client.post("/api/budget", headers=owner, json={"month": CURRENT_MONTH, "expense_limit": 500, "alert_threshold": 80})
    assert r.status_code == 200

    # Re-saving for the same month overwrites, it doesn't duplicate.
    r = client.post("/api/budget", headers=owner, json={"month": CURRENT_MONTH, "expense_limit": 1000, "alert_threshold": 90})
    assert r.status_code == 200

    r = client.get("/api/budget", headers=owner)
    budgets = r.json()["budgets"]
    assert len(budgets) == 1 and budgets[0]["expense_limit"] == 1000

    r = client.get("/api/budget/status", headers=owner)
    assert r.status_code == 200 and r.json()["has_budget"] is True

    r = client.post("/api/recurring-expenses", headers=owner, json={
        "description": "Наем", "amount": 500, "day_of_month": 1,
    })
    assert r.status_code == 200
    recurring_id = r.json()["id"]

    r = client.get("/api/recurring-expenses", headers=owner)
    assert r.status_code == 200 and len(r.json()["recurring_expenses"]) == 1

    r = client.delete(f"/api/recurring-expenses/{recurring_id}", headers=owner)
    assert r.status_code == 200


def test_statistics(client):
    owner = h(STATE["owner_token"])
    r = client.get("/api/statistics/summary", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/statistics/chart-data?period=month", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/statistics/suppliers", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/statistics/items", headers=owner)
    assert r.status_code == 200


def test_roi_and_forecast(client):
    owner = h(STATE["owner_token"])
    r = client.get("/api/roi/analysis", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/roi/trend", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/forecast/expenses", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/forecast/revenue", headers=owner)
    assert r.status_code == 200


def test_employees_and_payroll(client):
    owner = h(STATE["owner_token"])
    r = client.post("/api/employees", headers=owner, json={
        "name": "Иван Иванов", "position": "Продавач", "base_salary": 1000, "agreement_type": "gross",
    })
    assert r.status_code == 200
    emp_id = r.json()["id"]

    r = client.get("/api/payroll/rates", headers=owner)
    assert r.status_code == 200

    r = client.post("/api/payroll/preview", headers=owner, json={
        "employee_id": emp_id, "period_month": 9, "period_year": 2026, "gross_amount": 1000,
    })
    assert r.status_code == 200 and "net_amount" in r.json()

    r = client.post("/api/payroll", headers=owner, json={
        "employee_id": emp_id, "period_month": 9, "period_year": 2026, "gross_amount": 1000,
    })
    assert r.status_code == 200
    payroll_id = r.json().get("id")

    r = client.get("/api/payroll", headers=owner)
    assert r.status_code == 200 and len(r.json()) >= 1

    if payroll_id:
        r = client.delete(f"/api/payroll/{payroll_id}", headers=owner)
        assert r.status_code == 200

    r = client.delete(f"/api/employees/{emp_id}", headers=owner)
    assert r.status_code == 200


def test_fixed_assets(client):
    owner = h(STATE["owner_token"])
    r = client.post("/api/assets", headers=owner, json={
        "name": "Лаптоп Dell", "category": "cat_iv", "acquisition_date": "2026-01-15",
        "in_service_date": "2026-01-15", "acquisition_value": 2000,
    })
    assert r.status_code == 200
    asset_id = r.json()["id"]

    r = client.get("/api/assets", headers=owner)
    assert r.status_code == 200 and len(r.json()) == 1

    r = client.get("/api/assets/categories", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/assets/summary", headers=owner)
    assert r.status_code == 200

    r = client.delete(f"/api/assets/{asset_id}", headers=owner)
    assert r.status_code == 200


def test_items_price_tracking(client):
    owner = h(STATE["owner_token"])
    r = client.get("/api/items/price-alert-settings", headers=owner)
    assert r.status_code == 200

    r = client.put("/api/items/price-alert-settings", headers=owner, json={"threshold_percent": 15, "enabled": True})
    assert r.status_code == 200

    r = client.get("/api/items/price-alerts", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/items/merge-mappings", headers=owner)
    assert r.status_code == 200

    r = client.post("/api/items/ai-merge", headers=owner)
    assert r.status_code == 200


def test_notifications_and_company(client):
    owner = h(STATE["owner_token"])
    r = client.get("/api/notifications/settings", headers=owner)
    assert r.status_code == 200

    r = client.put("/api/notifications/settings", headers=owner, json={"vat_threshold_enabled": True, "vat_threshold_amount": 100})
    assert r.status_code == 200

    r = client.get("/api/company", headers=owner)
    assert r.status_code == 200


def test_utils(client):
    owner = h(STATE["owner_token"])
    r = client.get("/api/utils/validate-eik?eik=131059528", headers=owner)
    assert r.status_code == 200


def test_roles_invitations_permissions(client):
    owner = h(STATE["owner_token"])
    staff_email = f"master_staff_{TS}@test.com"
    r = client.post("/api/auth/register", json={"name": "Master Staff", "email": staff_email, "password": "Passw0rd1"})
    assert r.status_code == 200
    staff_token = r.json()["session_token"]
    staff_id = r.json()["user"]["user_id"]
    staff = h(staff_token)

    r = client.post("/api/invitations", headers=owner, json={"email": staff_email, "role": "accountant"})
    assert r.status_code == 200
    code = r.json()["invitation"]["code"]

    r = client.get("/api/invitations", headers=owner)
    assert r.status_code == 200 and len(r.json()) == 1

    r = client.post("/api/invitations/accept", headers=staff, json={"code": code})
    assert r.status_code == 200

    r = client.get("/api/auth/users", headers=owner)
    users = r.json()
    accountant_entry = next((u for u in users if u["user_id"] == staff_id), None)
    assert accountant_entry is not None
    assert accountant_entry["role"] == "accountant"
    assert "manage_budget" in accountant_entry.get("permissions", [])

    # Permission gating: accountant lacks add_revenue -> forbidden.
    r = client.post("/api/daily-revenue", headers=staff, json={"date": "2026-09-11", "fiscal_revenue": 10, "pocket_money": 0, "vat_rate_percent": 20})
    assert r.status_code == 403

    # accountant lacks view_off_book_expenses -> GET /expenses forbidden.
    r = client.get("/api/expenses", headers=staff)
    assert r.status_code == 403

    # accountant lacks view_pocket_money -> redacted (0), not blocked.
    r = client.get("/api/daily-revenue/by-date/2026-09-10", headers=staff)
    assert r.status_code == 200 and r.json()["pocket_money"] == 0
    r = client.get("/api/daily-revenue/by-date/2026-09-10", headers=owner)
    assert r.status_code == 200 and r.json()["pocket_money"] == 15

    r = client.get("/api/daily-revenue", headers=staff)
    staff_revenues = r.json()
    assert r.status_code == 200 and all(rv["pocket_money"] == 0 for rv in staff_revenues)
    r = client.get("/api/daily-revenue", headers=owner)
    owner_revenues = r.json()
    assert r.status_code == 200 and any(rv["pocket_money"] == 15 for rv in owner_revenues)

    # "Advanced statistics" is its own permission, not implied by
    # view_off_book_expenses or anything else an accountant gets by
    # default - staff registered with no role at all must be refused.
    plain_staff_email = f"master_plainstaff_{TS}@test.com"
    r = client.post("/api/auth/register", json={"name": "Plain Staff", "email": plain_staff_email, "password": "Passw0rd1"})
    assert r.status_code == 200
    plain_staff = h(r.json()["session_token"])
    r = client.post("/api/invitations", headers=owner, json={"email": plain_staff_email, "role": "staff"})
    assert r.status_code == 200
    plain_code = r.json()["invitation"]["code"]
    r = client.post("/api/invitations/accept", headers=plain_staff, json={"code": plain_code})
    assert r.status_code == 200
    r = client.get("/api/statistics/suppliers", headers=plain_staff)
    assert r.status_code == 403
    r = client.get("/api/items/price-alerts", headers=plain_staff)
    assert r.status_code == 200  # deliberately NOT gated - used by the invoice-detail badge flow

    r = client.get("/api/forecast/expenses", headers=plain_staff)
    assert r.status_code == 403  # plain staff lacks view_statistics
    r = client.get("/api/forecast/revenue", headers=plain_staff)
    assert r.status_code == 403

    r = client.get("/api/invoices", headers=plain_staff)
    assert r.status_code == 200  # staff role defaults to manage_invoices

    r = client.post("/api/items/ai-merge", headers=plain_staff)
    assert r.status_code == 403  # plain staff lacks view_statistics

    r = client.get("/api/recurring-expenses", headers=plain_staff)
    assert r.status_code == 403  # plain staff lacks manage_budget
    r = client.post("/api/recurring-expenses", headers=plain_staff, json={
        "description": "Наем", "amount": 500, "day_of_month": 1,
    })
    assert r.status_code == 403
    r = client.delete("/api/recurring-expenses/nonexistent-id", headers=plain_staff)
    assert r.status_code == 403

    r = client.put("/api/items/price-alert-settings", headers=plain_staff, json={"threshold_percent": 20})
    assert r.status_code == 403  # plain staff lacks view_statistics

    r = client.get("/api/items/merge-mappings", headers=plain_staff)
    assert r.status_code == 403
    r = client.delete("/api/items/merge-mappings/nonexistent", headers=plain_staff)
    assert r.status_code == 403

    # Financial-visibility redaction on /roi/analysis, /roi/trend and
    # /forecast/expenses: view_personal_investments/view_statistics gate the
    # endpoint itself, but pocket_money/off_book_expenses/profit stay
    # independently gated by their own view_* permission, same convention
    # as get_summary - zeroed out of every aggregate, not just blanked.
    r = client.post("/api/personal-expenses", headers=owner, json={
        "amount": 50, "description": "За тест на видимост", "expense_type": "investment", "category": "other",
        "period_month": 9, "period_year": 2026,
    })
    assert r.status_code == 200
    visibility_pe_id = r.json()["id"]

    r = client.put(f"/api/auth/role/{staff_id}", headers=owner, json={
        "role": "accountant",
        "permissions": [
            "view_audit_log", "manage_budget", "export_data", "view_statistics", "manage_invoices",
            "view_profit", "team_collaboration", "view_personal_investments",
        ],
    })
    assert r.status_code == 200

    r = client.get("/api/roi/analysis?month=9&year=2026", headers=owner)
    assert r.status_code == 200
    owner_roi = r.json()
    assert owner_roi["total_revenue"] == 115  # fiscal_revenue(100) + pocket_money(15)
    assert owner_roi["total_business_expense"] == 30  # off-book expense, no invoice left
    assert owner_roi["total_profit"] == 85

    r = client.get("/api/roi/analysis?month=9&year=2026", headers=staff)
    assert r.status_code == 200
    staff_roi = r.json()
    # No view_pocket_money/view_off_book_expenses: both folded in as zero,
    # not just blanked, so revenue/expense/profit stay internally coherent
    # for exactly what this viewer may see - not the owner's real numbers.
    assert staff_roi["total_revenue"] == 100
    assert staff_roi["total_business_expense"] == 0
    assert staff_roi["total_profit"] == 100  # has view_profit, so still shown
    assert staff_roi["total_profit"] != owner_roi["total_profit"]

    r = client.get("/api/roi/trend?months=2", headers=staff)
    assert r.status_code == 200
    assert r.json()["trend"][0]["profit"] == 100

    # Now strip view_profit too - profit/ROI must disappear from every
    # field AND from the ai_insights prose (no leaking the same figures via
    # text once the structured fields are null).
    r = client.put(f"/api/auth/role/{staff_id}", headers=owner, json={
        "role": "accountant",
        "permissions": [
            "view_audit_log", "manage_budget", "export_data", "view_statistics", "manage_invoices",
            "team_collaboration", "view_personal_investments",
        ],
    })
    assert r.status_code == 200

    r = client.get("/api/roi/analysis?month=9&year=2026", headers=staff)
    assert r.status_code == 200
    no_profit_roi = r.json()
    assert no_profit_roi["total_profit"] is None
    assert no_profit_roi["roi_percent"] is None
    assert no_profit_roi["is_profitable"] is None
    assert no_profit_roi["investment_covered"] is None
    assert no_profit_roi["ai_insights"] == ["🔒 Нямаш право да виждаш печалбата за избрания период"]

    r = client.get("/api/roi/trend?months=2", headers=staff)
    assert r.status_code == 200
    no_profit_trend = r.json()["trend"]
    assert no_profit_trend[0]["profit"] is None
    assert no_profit_trend[0]["roi_percent"] is None

    # The raw VAT-ledger Excel export must redact pocket_money too (same
    # right as the other views above), not just the aggregated endpoints.
    from io import BytesIO
    from openpyxl import load_workbook
    r = client.get("/api/export/vat-ledger/excel?start_date=2026-09-01&end_date=2026-09-30", headers=owner)
    assert r.status_code == 200
    owner_ws = load_workbook(BytesIO(r.content))["Дневник продажби"]
    assert owner_ws.cell(row=5, column=9).value == 15  # pocket_money, visible to the owner
    assert owner_ws.cell(row=5, column=10).value == 115  # total = fiscal_revenue + pocket_money

    r = client.get("/api/export/vat-ledger/excel?start_date=2026-09-01&end_date=2026-09-30", headers=staff)
    assert r.status_code == 200
    staff_ws = load_workbook(BytesIO(r.content))["Дневник продажби"]
    assert staff_ws.cell(row=5, column=9).value == 0  # no view_pocket_money -> redacted, not just blanked
    assert staff_ws.cell(row=5, column=10).value == 100

    # Off-book expense (30) must not leak into the expense-forecast
    # aggregate for a viewer without view_off_book_expenses either.
    r = client.get("/api/forecast/expenses", headers=owner)
    assert r.status_code == 200
    owner_hist = {e["month"]: e["amount"] for e in r.json()["historical"]}
    r = client.get("/api/forecast/expenses", headers=staff)
    assert r.status_code == 200
    staff_hist = {e["month"]: e["amount"] for e in r.json()["historical"]}
    assert owner_hist.get("2026-09", 0) - staff_hist.get("2026-09", 0) == 30

    r = client.delete(f"/api/personal-expenses/{visibility_pe_id}", headers=owner)
    assert r.status_code == 200

    # No separate "view invoices" permission exists - unticking
    # manage_invoices for a member must revoke read access too, not just
    # the write endpoints that already required it.
    r = client.put(f"/api/auth/role/{staff_id}", headers=owner, json={
        "role": "accountant",
        "permissions": [
            "view_audit_log", "manage_budget", "export_data", "view_statistics",
            "team_collaboration", "view_personal_investments",
        ],  # manage_invoices deliberately left out
    })
    assert r.status_code == 200
    r = client.get("/api/invoices", headers=staff)
    assert r.status_code == 403
    r = client.get("/api/invoices/nonexistent-id", headers=staff)
    assert r.status_code == 403

    # OCR scanning only ever feeds a draft into POST /invoices, so it's
    # gated the same way - no burning the company's shared scan credits on
    # a result this viewer could never save.
    r = client.post("/api/ocr/scan", headers=staff, json={"image_base64": "x"})
    assert r.status_code == 403

    # Owner removes the accountant - permissions must reset, not stay elevated.
    r = client.delete(f"/api/auth/users/{staff_id}", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/auth/me", headers=staff)
    me = r.json()
    assert r.status_code == 200 and me.get("role") in ("owner", "staff")


def test_backup_restore(client):
    owner = h(STATE["owner_token"])
    r = client.get("/api/backup/status", headers=owner)
    assert r.status_code == 200

    r = client.post("/api/backup/create", headers=owner)
    assert r.status_code == 200 and "invoices" in r.json()
    backup_payload = r.json()

    r = client.get("/api/backup/list", headers=owner)
    assert r.status_code == 200

    r = client.post("/api/backup/restore", headers=owner, json=backup_payload)
    assert r.status_code == 200


def test_exports(client):
    owner = h(STATE["owner_token"])
    r = client.get("/api/export/invoices/excel", headers=owner)
    assert r.status_code == 200 and "spreadsheet" in r.headers.get("content-type", "")

    r = client.get("/api/export/invoices/pdf", headers=owner)
    assert r.status_code == 200 and "pdf" in r.headers.get("content-type", "")

    r = client.get("/api/export/statistics/pdf", headers=owner)
    assert r.status_code == 200

    r = client.get("/api/export/vat-ledger/excel", headers=owner)
    assert r.status_code == 200


def test_ocr_size_gate(client):
    """Regression check: no AI key locally, so this only confirms an
    oversized image is rejected cleanly instead of crashing."""
    owner = h(STATE["owner_token"])
    huge_b64 = "A" * 15_000_000
    r = client.post("/api/ocr/scan", headers=owner, json={"image_base64": huge_b64})
    assert r.status_code in (413, 503)


def test_feedback_box(client):
    owner = h(STATE["owner_token"])
    r = client.post("/api/feedback", headers=owner, json={"message": "Много добро приложение, но искам PDF за дневника.", "is_anonymous": False})
    assert r.status_code == 200

    r = client.post("/api/feedback", headers=owner, json={"message": "Анонимен коментар за тест.", "is_anonymous": True})
    assert r.status_code == 200

    r = client.post("/api/feedback", headers=owner, json={"message": "a", "is_anonymous": False})
    assert r.status_code == 422

    r = client.get("/api/feedback", headers=owner)
    assert r.status_code == 403  # non-admin owner blocked from the feedback inbox


def test_scan_credits(client):
    """Fakturaplus's whole monetization surface - see ScanCreditService's
    module docstring. Uses its own fresh owner/company so the balance
    assertions below aren't order-dependent on what other tests in this
    module may or may not have scanned.

    The owner is created directly against the DB (same shortcut
    test_cross_tenant_isolation and test_csrf_protection use), not via the
    rate-limited POST /auth/register - this test still goes through
    register() once below for the staff invite/accept flow, which is the
    one part of this test actually worth exercising as real HTTP calls;
    the owner's own identity isn't."""
    import asyncio
    import uuid
    from datetime import timedelta, timezone
    import server

    owner_email = f"master_credits_owner_{TS}@test.com"
    owner_id = f"user_{uuid.uuid4().hex[:12]}"
    owner_token = uuid.uuid4().hex

    async def _make_owner():
        company = server.Company(name="Credits Owner Co", eik=f"TEST{uuid.uuid4().hex[:9].upper()}")
        await server.db.companies.insert_one(company.model_dump())
        await server.db.users.insert_one({
            "user_id": owner_id, "email": owner_email, "name": "Credits Owner",
            "role": "owner", "company_id": company.id, "permissions": list(server.ROLE_PERMISSIONS["owner"]),
            "auth_provider": "email", "has_password": True,
            "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION,
            "created_at": server.datetime.now(timezone.utc),
        })
        await server.db.user_sessions.insert_one({
            "user_id": owner_id, "session_token": owner_token,
            "expires_at": server.datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": server.datetime.now(timezone.utc),
        })

    asyncio.run(_make_owner())
    owner = h(owner_token)

    # Fresh company starts with the full free monthly quota and nothing purchased.
    r = client.get("/api/scan-credits", headers=owner)
    assert r.status_code == 200, r.text
    balance = r.json()
    assert balance["free_remaining"] == 10
    assert balance["free_quota"] == 10
    assert balance["purchased_balance"] == 0
    assert balance["total_remaining"] == 10
    assert balance["auto_reload_enabled"] is False

    # Fixed catalogue, matches the pricing conversation this was built from.
    r = client.get("/api/scan-credits/packages", headers=owner)
    assert r.status_code == 200
    packages = {p["id"]: p for p in r.json()}
    assert packages["small"]["total_scans"] == 10 and packages["small"]["price_eur"] == 2.50
    assert packages["medium"]["total_scans"] == 50 and packages["medium"]["price_eur"] == 11.00
    assert packages["large"]["total_scans"] == 150 and packages["large"]["price_eur"] == 30.00
    assert packages["business"]["total_scans"] == 400 and packages["business"]["price_eur"] == 72.00

    # No Stripe keys configured in the test environment -> a clear 503
    # instead of a crash, same disabled-until-configured pattern as the AI
    # features. Never a silent "pretend it worked".
    r = client.post("/api/scan-credits/purchase/package", headers=owner, json={"package_id": "small"})
    assert r.status_code == 503

    r = client.post("/api/scan-credits/auto-reload", headers=owner, json={"enabled": True, "package_id": "small"})
    assert r.status_code == 503

    r = client.post("/api/webhooks/stripe", json={})
    assert r.status_code == 503

    # manage_billing is owner-only, never configurable onto staff - see
    # ROLE_PERMISSIONS/ROLE_CONFIGURABLE_PERMISSIONS.
    staff_email = f"master_credits_staff_{TS}@test.com"
    r = client.post("/api/auth/register", json={"name": "Credits Staff", "email": staff_email, "password": "Passw0rd1"})
    assert r.status_code == 200
    staff = h(r.json()["session_token"])
    r = client.post("/api/invitations", headers=owner, json={"email": staff_email, "role": "staff"})
    assert r.status_code == 200
    code = r.json()["invitation"]["code"]
    r = client.post("/api/invitations/accept", headers=staff, json={"code": code})
    assert r.status_code == 200

    r = client.post("/api/scan-credits/purchase/package", headers=staff, json={"package_id": "small"})
    assert r.status_code == 403
    r = client.post("/api/scan-credits/auto-reload", headers=staff, json={"enabled": False})
    assert r.status_code == 403
    # Balance is shared company-wide though - any teammate can check it.
    r = client.get("/api/scan-credits", headers=staff)
    assert r.status_code == 200

    # Custom-quantity validation at the API boundary.
    r = client.post("/api/scan-credits/purchase/custom", headers=owner, json={"quantity": 0})
    assert r.status_code == 422
    r = client.post("/api/scan-credits/purchase/custom", headers=owner, json={"quantity": 1001})
    assert r.status_code == 422

    # --- Direct service-level tests: the part that actually protects money ---
    svc = server.scan_credit_service
    company_id = balance_company_id = None
    # Pull this fresh user's company_id the same way the endpoints do.
    me = client.get("/api/auth/me", headers=owner).json()
    company_id = me["company_id"]

    async def _run():
        # Stepped custom pricing matches the package brackets exactly.
        assert server.scan_credit_service_module.custom_price_eur(10) == 2.50
        assert server.scan_credit_service_module.custom_price_eur(11) == round(11 * (11.00 / 50), 2)
        assert server.scan_credit_service_module.custom_price_eur(50) == round(50 * (11.00 / 50), 2)
        assert server.scan_credit_service_module.custom_price_eur(51) == round(51 * (30.00 / 150), 2)
        assert server.scan_credit_service_module.custom_price_eur(1000) == round(1000 * (72.00 / 400), 2)

        # Spend down the free quota one at a time; the 11th spend with
        # nothing purchased must fail closed, never go negative.
        for _ in range(10):
            spent = await svc.spend_scan(company_id, owner_id, "Credits Owner")
            assert spent is True
        assert await svc.has_scans_remaining(company_id, owner_id) is False
        spent = await svc.spend_scan(company_id, owner_id, "Credits Owner")
        assert spent is False
        summary = await svc.get_balance_summary(company_id, owner_id)
        assert summary["free_remaining"] == 0 and summary["purchased_balance"] == 0

        # Credits only ever arrive via credit_purchase (the webhook path) -
        # never from spend_scan or any client-facing endpoint directly.
        await svc.credit_purchase(company_id, owner_id, "Credits Owner", scans=50, description="Пакет „Среден“", price_eur=11.0, payment_reference="pi_test_1")
        summary = await svc.get_balance_summary(company_id, owner_id)
        assert summary["purchased_balance"] == 50 and summary["total_remaining"] == 50

        # Free is exhausted, so the next spend must draw from purchased.
        spent = await svc.spend_scan(company_id, owner_id, "Credits Owner")
        assert spent is True
        summary = await svc.get_balance_summary(company_id, owner_id)
        assert summary["purchased_balance"] == 49

        # Webhook idempotency: the same Stripe event id is only ever
        # processed once, no matter how many times it's redelivered.
        assert await svc.mark_webhook_event_processed("evt_test_1") is True
        assert await svc.mark_webhook_event_processed("evt_test_1") is False
        assert await svc.mark_webhook_event_processed("evt_test_2") is True

        # History reflects both the spends and the purchase, newest first.
        history = await svc.get_history(company_id, owner_id)
        assert history[0]["type"] == "scan_used"
        assert any(tx["type"] == "purchase" and tx["delta"] == 50 for tx in history)

    asyncio.run(_run())

    r = client.get("/api/scan-credits/history", headers=owner)
    assert r.status_code == 200 and len(r.json()) >= 2

    r = client.get("/api/scan-credits/history/export", headers=owner)
    assert r.status_code == 200 and "spreadsheet" in r.headers.get("content-type", "")


def test_cross_tenant_isolation(client):
    """Second, independent audit pass: IDOR / company-scoping, not
    roles/permissions. Two completely separate, freshly-created companies -
    company Y's owner must never be able to read, modify, or delete
    company X's records by guessing/reusing an id, nor act on company X's
    user account, even though every call here is a legitimately
    authenticated request with a real session.

    Tenants are created directly against the DB (not via the rate-limited
    POST /auth/register, which the rest of this module's tests already
    use up to its 5/minute cap) - same shortcut test_scan_credits already
    uses for its own setup."""
    import asyncio
    import uuid
    from datetime import timedelta, timezone
    import server

    async def _make_tenant(label: str) -> tuple:
        company = server.Company(name=f"{label} Co", eik=f"TEST{uuid.uuid4().hex[:9].upper()}")
        await server.db.companies.insert_one(company.model_dump())
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await server.db.users.insert_one({
            "user_id": user_id,
            "email": f"{label.lower()}_{TS}@test.com",
            "name": f"{label} Owner",
            "picture": None,
            "role": "owner",
            "permissions": server.resolve_permissions("owner", None),
            "company_id": company.id,
            "password_hash": None,
            "auth_provider": "email",
            "created_at": datetime.now(timezone.utc),
        })
        token = uuid.uuid4().hex
        await server.db.user_sessions.insert_one({
            "user_id": user_id,
            "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc),
        })
        return user_id, token

    x_user_id, x_token = asyncio.run(_make_tenant("TenantX"))
    _, y_token = asyncio.run(_make_tenant("TenantY"))
    x = h(x_token)
    y = h(y_token)

    # Company X creates one record in each collection that has a
    # by-id GET/PUT/DELETE endpoint.
    r = client.post("/api/invoices", headers=x, json={
        "supplier": "X Supplier", "invoice_number": "X-1",
        "amount_without_vat": 100, "vat_amount": 20, "total_amount": 120, "date": "2026-09-01",
    })
    assert r.status_code == 200
    x_invoice_id = r.json()["id"]

    r = client.post("/api/daily-revenue", headers=x, json={"date": "2026-09-05", "fiscal_revenue": 50, "pocket_money": 5, "vat_rate_percent": 20})
    assert r.status_code == 200

    r = client.post("/api/expenses", headers=x, json={"description": "X разход", "amount": 10, "date": "2026-09-05"})
    assert r.status_code == 200
    x_expense_id = r.json()["id"]

    r = client.post("/api/employees", headers=x, json={
        "name": "X Служител", "position": "Продавач", "base_salary": 900, "agreement_type": "gross",
    })
    assert r.status_code == 200
    x_employee_id = r.json()["id"]

    r = client.post("/api/assets", headers=x, json={
        "name": "X Актив", "category": "cat_iv", "acquisition_date": "2026-01-15",
        "in_service_date": "2026-01-15", "acquisition_value": 1000,
    })
    assert r.status_code == 200
    x_asset_id = r.json()["id"]

    r = client.post("/api/calendar/events", headers=x, json={
        "title": "X Event", "event_date": "2026-09-10", "visibility": "shared",
    })
    assert r.status_code == 200
    x_event_id = r.json()["id"]

    # Company Y must not see company X's record in its own list endpoints.
    r = client.get("/api/invoices", headers=y)
    assert r.status_code == 200 and all(inv["id"] != x_invoice_id for inv in r.json())
    r = client.get("/api/employees", headers=y)
    assert r.status_code == 200 and all(e["id"] != x_employee_id for e in r.json())
    r = client.get("/api/assets", headers=y)
    assert r.status_code == 200 and all(a["id"] != x_asset_id for a in r.json())

    # Company Y must get a plain 404 (not the record, not a 403 that would
    # at least confirm existence) when addressing company X's id directly.
    r = client.get(f"/api/invoices/{x_invoice_id}", headers=y)
    assert r.status_code == 404
    r = client.put(f"/api/invoices/{x_invoice_id}", headers=y, json={"total_amount": 1})
    assert r.status_code == 404
    r = client.delete(f"/api/invoices/{x_invoice_id}", headers=y)
    assert r.status_code == 404

    r = client.delete(f"/api/expenses/{x_expense_id}", headers=y)
    assert r.status_code == 404

    r = client.put(f"/api/employees/{x_employee_id}", headers=y, json={"base_salary": 1})
    assert r.status_code == 404
    r = client.delete(f"/api/employees/{x_employee_id}", headers=y)
    assert r.status_code == 404

    r = client.put(f"/api/assets/{x_asset_id}", headers=y, json={"name": "hijacked"})
    assert r.status_code == 404
    r = client.delete(f"/api/assets/{x_asset_id}", headers=y)
    assert r.status_code == 404

    r = client.put(f"/api/calendar/events/{x_event_id}", headers=y, json={"title": "hijacked"})
    assert r.status_code == 404
    r = client.delete(f"/api/calendar/events/{x_event_id}", headers=y)
    assert r.status_code == 404

    # Company Y's owner must not be able to touch company X's user account
    # either - changing their role or kicking them out of THEIR company.
    r = client.put(f"/api/auth/role/{x_user_id}", headers=y, json={"role": "staff"})
    assert r.status_code == 403
    r = client.delete(f"/api/auth/users/{x_user_id}", headers=y)
    assert r.status_code == 403

    # And confirm the two companies' financial pictures never mix.
    r = client.get("/api/statistics/summary?start_date=2026-09-01&end_date=2026-09-30", headers=y)
    assert r.status_code == 200 and r.json()["total_fiscal_revenue"] == 0

    r = client.get("/api/statistics/summary?start_date=2026-09-01&end_date=2026-09-30", headers=x)
    assert r.status_code == 200 and r.json()["total_fiscal_revenue"] == 50


def test_set_session_cookies_shape():
    """Pure unit check of the cookie-setting helper itself, independent of
    any endpoint or rate limit: session_token stays httponly (never
    readable by page JS), csrf_token is deliberately NOT httponly (the
    frontend must be able to read and echo it back), and both carry
    secure + samesite=none, required for the cross-origin frontend/
    backend split this app runs under."""
    from fastapi import Response
    import server

    resp = Response()
    csrf_value = server.set_session_cookies(resp, "fake-session-token")
    set_cookie_headers = [v.decode() for k, v in resp.headers.raw if k == b"set-cookie"]
    assert len(set_cookie_headers) == 2

    session_header = next(h for h in set_cookie_headers if h.startswith("session_token="))
    csrf_header = next(h for h in set_cookie_headers if h.startswith(f"{server.CSRF_COOKIE_NAME}="))
    assert "httponly" in session_header.lower()
    assert "httponly" not in csrf_header.lower()
    assert "secure" in session_header.lower() and "secure" in csrf_header.lower()
    assert "samesite=none" in session_header.lower() and "samesite=none" in csrf_header.lower()
    assert csrf_value in csrf_header


def test_csrf_protection(client):
    """A request authenticated purely by a session cookie, with no
    Authorization header - exactly what a forged cross-site request looks
    like - must carry a matching X-CSRF-Token header or be rejected.
    Every other test in this module authenticates via the Authorization
    header instead (see `h()`), which the middleware always lets through
    untouched; this is the one test exercising the cookie-only path the
    double-submit check actually exists to cover.

    The session here is created directly against the DB, like
    test_cross_tenant_isolation's tenants, rather than through the
    rate-limited POST /auth/register this module's other tests have
    already used up to its 5/minute cap - and the cookies are passed
    explicitly per request rather than relying on the TestClient cookie
    jar, which (correctly, like a real browser) won't store a Secure
    cookie over the plain-http test transport anyway."""
    import uuid
    import server
    from datetime import timedelta, timezone

    user_id = f"csrf_user_{uuid.uuid4().hex[:12]}"
    session_token = uuid.uuid4().hex
    csrf_token = uuid.uuid4().hex

    async def _setup():
        company = server.Company(name="CSRF Test Co", eik=f"TEST{uuid.uuid4().hex[:9].upper()}")
        await server.db.companies.insert_one(company.model_dump())
        await server.db.users.insert_one({
            "user_id": user_id, "email": f"{user_id}@test.com", "name": "CSRF Tester",
            "role": "owner", "company_id": company.id, "permissions": list(server.ROLE_PERMISSIONS["owner"]),
            "auth_provider": "email", "has_password": True,
            "permissions_schema_version": server.PERMISSIONS_SCHEMA_VERSION,
            "created_at": server.datetime.now(timezone.utc),
        })
        await server.db.user_sessions.insert_one({
            "user_id": user_id, "session_token": session_token,
            "expires_at": server.datetime.now(timezone.utc) + timedelta(days=7),
            "created_at": server.datetime.now(timezone.utc),
        })

    import asyncio
    asyncio.run(_setup())

    cookies_only = {"session_token": session_token}
    cookies_and_csrf = {"session_token": session_token, "csrf_token": csrf_token}

    # Cookie-only (no Authorization, no CSRF header) - must be rejected.
    r = client.post(
        "/api/calendar/events", json={"title": "x", "event_date": "2026-01-01"},
        cookies=cookies_only,
    )
    assert r.status_code == 403

    # Cookie-only, but with the matching X-CSRF-Token header - must succeed.
    r = client.post(
        "/api/calendar/events", json={"title": "x", "event_date": "2026-01-01"},
        cookies=cookies_and_csrf, headers={"X-CSRF-Token": csrf_token},
    )
    assert r.status_code == 200, r.text

    # Cookie-only, with a non-matching CSRF header - must still be rejected.
    r = client.post(
        "/api/calendar/events", json={"title": "y", "event_date": "2026-01-02"},
        cookies=cookies_and_csrf, headers={"X-CSRF-Token": "not-the-right-value"},
    )
    assert r.status_code == 403

    # GET is a safe method - never gated, cookie-only or not.
    r = client.get("/api/calendar/events", cookies=cookies_only)
    assert r.status_code == 200

    # The Authorization-header path (every other test in this file) is
    # never gated by this check, even without any CSRF header or cookie.
    r = client.post(
        "/api/calendar/events", headers=h(STATE["owner_token"]),
        json={"title": "z", "event_date": "2026-01-03"},
    )
    assert r.status_code == 200, r.text


def test_ask_my_numbers(client):
    """Module 4 Finding #3: the plain-language 'ask your own numbers' chat
    surface. AI_FEATURES_ENABLED is forced False for the whole test session
    (see conftest), so a well-formed request can never reach a real
    Anthropic call here - the point of this test is that the digest
    computation (the actual company-scoped, permission-redacted logic this
    endpoint adds) runs cleanly before that gate, and that validation/
    permission checks happen in the right order ahead of it."""
    owner = h(STATE["owner_token"])

    # Empty/missing question - rejected before anything else.
    r = client.post("/api/ai/ask-my-numbers", headers=owner, json={"question": "   "})
    assert r.status_code == 400

    r = client.post("/api/ai/ask-my-numbers", headers=owner, json={"question": "x" * 501})
    assert r.status_code == 400

    # Well-formed question from a permitted user reaches the AI-disabled
    # gate (503), proving the digest built without error along the way.
    r = client.post("/api/ai/ask-my-numbers", headers=owner, json={"question": "Какви са най-големите ми разходи?"})
    assert r.status_code == 503, r.text

    # A staff member without view_statistics must be refused before the
    # digest is even built - same direct-DB staff shortcut as
    # test_customers_and_receivables, with a non-empty permissions list
    # that simply excludes view_statistics (an empty list would be
    # silently backfilled to the role's default set by sanitize_user).
    import asyncio
    import uuid as uuid_module
    import server as server_module
    from datetime import timedelta, timezone as tz

    no_stats_staff_id = f"user_{uuid_module.uuid4().hex[:12]}"
    no_stats_staff_token = uuid_module.uuid4().hex

    async def _make_no_stats_staff():
        me = client.get("/api/auth/me", headers=owner).json()
        await server_module.db.users.insert_one({
            "user_id": no_stats_staff_id, "email": f"{no_stats_staff_id}@test.com", "name": "No Stats Staff",
            "role": "staff", "company_id": me["company_id"], "permissions": ["add_revenue"],
            "auth_provider": "email", "has_password": True,
            "permissions_schema_version": server_module.PERMISSIONS_SCHEMA_VERSION,
            "created_at": server_module.datetime.now(tz.utc),
        })
        await server_module.db.user_sessions.insert_one({
            "user_id": no_stats_staff_id, "session_token": no_stats_staff_token,
            "expires_at": server_module.datetime.now(tz.utc) + timedelta(days=7),
            "created_at": server_module.datetime.now(tz.utc),
        })

    asyncio.run(_make_no_stats_staff())
    r = client.post(
        "/api/ai/ask-my-numbers", headers=h(no_stats_staff_token), json={"question": "Как съм този месец?"}
    )
    assert r.status_code == 403


def test_proactive_signals(client):
    """Module 11 Finding #1: one ranked signal list over every other
    signal this audit built. Never an all-or-nothing 403 - each signal is
    permission-gated individually inside get_proactive_signals - and
    whatever it does return must be sorted most-urgent first."""
    owner = h(STATE["owner_token"])
    r = client.get("/api/proactive/signals", headers=owner)
    assert r.status_code == 200, r.text
    signals = r.json()["signals"]
    priorities = [s["priority"] for s in signals]
    assert priorities == sorted(priorities, reverse=True)
    for s in signals:
        assert set(s.keys()) >= {"key", "severity", "priority", "title", "detail", "route"}

    # A staff member with no revenue/budget/stats-adjacent permission at
    # all still gets 200 (never all-or-nothing) - just a narrower list,
    # since unpaid-invoices (the one signal with no extra permission gate)
    # can still apply regardless.
    import asyncio
    import uuid as uuid_module
    import server as server_module
    from datetime import timedelta, timezone as tz

    bare_staff_id = f"user_{uuid_module.uuid4().hex[:12]}"
    bare_staff_token = uuid_module.uuid4().hex

    async def _make_bare_staff():
        me = client.get("/api/auth/me", headers=owner).json()
        await server_module.db.users.insert_one({
            "user_id": bare_staff_id, "email": f"{bare_staff_id}@test.com", "name": "Bare Staff",
            "role": "staff", "company_id": me["company_id"], "permissions": ["view_personal_wallet"],
            "auth_provider": "email", "has_password": True,
            "permissions_schema_version": server_module.PERMISSIONS_SCHEMA_VERSION,
            "created_at": server_module.datetime.now(tz.utc),
        })
        await server_module.db.user_sessions.insert_one({
            "user_id": bare_staff_id, "session_token": bare_staff_token,
            "expires_at": server_module.datetime.now(tz.utc) + timedelta(days=7),
            "created_at": server_module.datetime.now(tz.utc),
        })

    asyncio.run(_make_bare_staff())
    r = client.get("/api/proactive/signals", headers=h(bare_staff_token))
    assert r.status_code == 200, r.text
    bare_signal_keys = {s["key"] for s in r.json()["signals"]}
    assert not bare_signal_keys & {"budget", "receivables", "price_alerts", "reorder", "forecast_revenue", "forecast_expense", "scan_credits"}


def test_legacy_scope_consistency(client):
    """Module 1 audit finding: 40 endpoints built their own company_id
    lookup inline instead of the shared get_company_scope()/scope helper,
    which also matches a record that predates a collection's company_id
    field (company_id=None, but owned by a CURRENT member of the
    company) - a ghost record otherwise reachable by ID through a
    sibling endpoint (update/delete) but invisible in the list. Simulates
    that legacy shape directly against the DB for price_alerts, employees
    and assets, and confirms the list endpoints (get_price_alerts,
    get_employees, get_assets/get_assets_summary) now see it."""
    owner = h(STATE["owner_token"])
    me = client.get("/api/auth/me", headers=owner).json()
    owner_user_id = me["user_id"]

    import asyncio
    import uuid as uuid_module
    import server as server_module
    from datetime import timezone as tz

    async def _insert_legacy_records():
        await server_module.db.price_alerts.insert_one({
            "id": f"legacy-alert-{uuid_module.uuid4().hex[:8]}", "company_id": None, "user_id": owner_user_id,
            "status": "unread", "item_name": "Legacy Item", "supplier": "Legacy Supplier",
            "invoice_id": "legacy-inv", "invoice_number": "LEGACY-1",
            "old_price": 1.0, "new_price": 2.0, "change_percent": 100.0, "direction": "increase",
            "baseline_purchase_count": 1, "created_at": server_module.datetime.now(tz.utc),
        })
        await server_module.db.employees.insert_one({
            "id": f"legacy-emp-{uuid_module.uuid4().hex[:8]}", "user_id": owner_user_id, "company_id": None,
            "name": "Legacy Employee", "base_salary": 1000.0, "agreement_type": "gross",
            "food_vouchers": 0, "additional_insurance": 0, "active": True,
            "created_at": server_module.datetime.now(tz.utc),
        })
        await server_module.db.assets.insert_one({
            "id": f"legacy-asset-{uuid_module.uuid4().hex[:8]}", "user_id": owner_user_id, "company_id": None,
            "inventory_number": "LEGACY-1", "name": "Legacy Asset", "category": "cat_i",
            "acquisition_date": "2020-01-01", "in_service_date": "2020-01-01",
            "acquisition_value": 1000.0, "annual_depreciation_rate_percent": 10.0,
            "status": "active", "created_at": server_module.datetime.now(tz.utc),
            "monthly_depreciation": 0, "accumulated_depreciation": 0, "net_book_value": 1000.0,
        })

    asyncio.run(_insert_legacy_records())

    r = client.get("/api/items/price-alerts", headers=owner)
    assert r.status_code == 200, r.text
    assert any(a["item_name"] == "Legacy Item" for a in r.json()["alerts"])

    r = client.get("/api/employees", headers=owner)
    assert r.status_code == 200, r.text
    assert any(e["name"] == "Legacy Employee" for e in r.json())

    r = client.get("/api/assets", headers=owner)
    assert r.status_code == 200, r.text
    assert any(a["name"] == "Legacy Asset" for a in r.json())

    r = client.get("/api/assets/summary", headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["active_count"] >= 1

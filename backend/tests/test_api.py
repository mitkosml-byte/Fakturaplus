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

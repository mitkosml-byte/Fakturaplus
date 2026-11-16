"""What the business uses (У1–У3, Н9): the owner leaves out parts of the
program - the till, issued invoices, the team, payroll, assets, the personal
wallet. A part left out leaves the menus, Home and the signals, and keeps
what was entered; a business without a till rings nothing up there, so an
invoice it is paid in cash for is its own revenue. Home's cards for a
business that invoices: issued in the period, owed now, overdue."""
import asyncio

import server
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company, _user


def _owner(owner_id):
    return server.User(**server.sanitize_user(asyncio.run(server.db.users.find_one({"user_id": owner_id}, {"_id": 0}))))


def test_u1_every_part_is_used_until_the_owner_leaves_it_out(client):
    company_id, _, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    everything = {"till": True, "billing": True, "team": True, "payroll": True, "assets": True, "wallet": True}
    assert client.get("/api/company/modules", headers=owner).json() == {"modules": everything, "can_edit": True}
    assert client.get("/api/company/modules", headers=cashier).json()["can_edit"] is False

    assert client.put("/api/company/modules", headers=cashier, json={"modules": {"till": False}}).status_code == 403
    assert client.put("/api/company/modules", headers=owner, json={"modules": {"kitchen": False}}).status_code == 400
    saved = client.put("/api/company/modules", headers=owner, json={"modules": {"till": False, "payroll": False}})
    assert saved.status_code == 200
    assert saved.json()["modules"] == {**everything, "till": False, "payroll": False}
    # Everyone in the business sees the same parts - the menus follow them.
    assert client.get("/api/company/modules", headers=cashier).json()["modules"]["till"] is False
    assert asyncio.run(server.db.companies.find_one({"id": company_id}))["modules"]["payroll"] is False

    log = asyncio.run(server.db.audit_logs.find_one({"company_id": company_id, "entity_type": "company_modules"}, {"_id": 0}))
    assert log["details"]["modules"] == {"till": False, "payroll": False}

    # Back on: nothing was lost.
    assert client.put("/api/company/modules", headers=owner, json={"modules": {"till": True}}).json()["modules"]["till"] is True


def test_u1_a_part_left_out_has_no_signals(client):
    company_id, owner_id, owner = _company()
    client.post("/api/receivables", headers=owner, json={"customer_name": "Ресторант Лале", "amount": 100, "due_date": "2026-01-10"})

    def keys():
        return {s["key"] for s in asyncio.run(server.get_proactive_signals(_owner(owner_id)))}
    assert "receivables" in keys()
    client.put("/api/company/modules", headers=owner, json={"modules": {"billing": False}})
    assert "receivables" not in keys()
    client.put("/api/company/modules", headers=owner, json={"modules": {"billing": True}})
    assert "receivables" in keys()


def test_u1_without_a_till_a_cash_invoice_is_its_own_revenue(client):
    _, _, owner = _company()
    client.post("/api/daily-revenue", headers=owner, json={"date": server.today_local().isoformat(), "fiscal_revenue": 300})
    assert client.get("/api/billing-documents/invoice-defaults", headers=owner).json()["logs_till"] is True
    in_till = _issue(client, owner, payment_method="cash", issue_date=server.today_local().isoformat())
    assert in_till["in_till"] is True

    client.put("/api/company/modules", headers=owner, json={"modules": {"till": False}})
    assert client.get("/api/billing-documents/invoice-defaults", headers=owner).json()["logs_till"] is False
    own = _issue(client, owner, payment_method="cash", issue_date=server.today_local().isoformat())
    assert own["in_till"] is False


def test_u3_home_cards_for_a_business_that_invoices(client):
    company_id, _, owner = _company()
    first = _issue(client, owner, issue_date="2026-10-05", due_date="2026-10-15")                 # 120, overdue
    _issue(client, owner, issue_date="2026-10-20", due_date="2099-12-31",
           items=[{"name": "Услуга", "quantity": 2, "unit_price": 100, "vat_rate": 20}])         # 240, not yet due
    client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "credit_note", "credited_document_id": first["id"], "customer_name": first["customer_name"],
        "issue_date": "2026-10-25", "notes": "Отстъпка",
        "items": [{"name": "Отстъпка", "quantity": 1, "unit_price": 50, "vat_rate": 20}],
    })
    _issue(client, owner, issue_date="2026-09-30", payment_method="cash")                          # another month

    overview = client.get("/api/billing-documents/overview?start_date=2026-10-01&end_date=2026-10-31", headers=owner).json()
    assert (overview["issued_count"], overview["issued_total"]) == (2, 300)
    # Owed now: 120 - 60 credited + 240; overdue: the first invoice's 60 left.
    assert (overview["total_owed"], overview["total_overdue"], overview["overdue_count"]) == (300, 60, 1)

    _, analyst = _user(company_id, "staff", ["view_statistics"], "Анализатор")
    assert client.get("/api/billing-documents/overview", headers=analyst).status_code == 403

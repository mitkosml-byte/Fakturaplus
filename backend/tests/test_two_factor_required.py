"""A second step at login required of the owner and the accountant
(security plan): they see all of a business's money and people - pay,
sick leave, the personal notebook. Until their day, Home asks for it; past
it, only the screen that turns it on is open. Staff are not asked.

Invented people."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import server
from services import two_factor as tf
from tests.test_whole_program_fixes import _company, _user


@pytest.fixture
def required(monkeypatch):
    monkeypatch.setattr(server, "TWO_FACTOR_REQUIRED", True)
    server.limiter.reset()
    yield
    server.limiter.reset()


def _age(user_id, days):
    """The account as if opened `days` ago, the requirement older still."""
    asyncio.run(server.db.users.update_one(
        {"user_id": user_id}, {"$set": {"created_at": datetime.now(timezone.utc) - timedelta(days=days)}}))


def test_a_new_owner_has_two_weeks(client, required):
    _, owner_id, owner = _company()
    me = client.get("/api/auth/me", headers=owner).json()
    due = datetime.fromisoformat(me["two_factor_due_at"].replace("Z", "+00:00"))
    assert me["two_factor_overdue"] is False
    assert timedelta(days=13) < due - datetime.now(timezone.utc) <= timedelta(days=server.TWO_FACTOR_GRACE_DAYS)
    assert client.get("/api/invoices", headers=owner).status_code == 200


def test_past_the_day_only_turning_it_on_is_open(client, required, monkeypatch):
    monkeypatch.setattr(server, "TWO_FACTOR_REQUIRED_FROM", datetime.now(timezone.utc) - timedelta(days=60))
    company_id, owner_id, owner = _company()
    _age(owner_id, 30)

    me = client.get("/api/auth/me", headers=owner).json()
    assert me["two_factor_overdue"] is True
    refused = client.get("/api/invoices", headers=owner)
    assert refused.status_code == 403 and refused.json()["detail"]["code"] == "two_factor_setup_required"

    # Turning it on is open - with an authenticator app here.
    setup = client.post("/api/auth/2fa/setup", headers=owner, json={"method": "totp"})
    assert setup.status_code == 200, setup.text
    code = tf.code_at(setup.json()["secret"], tf.current_step())
    assert client.post("/api/auth/2fa/enable", headers=owner, json={"code": code}).status_code == 200

    me = client.get("/api/auth/me", headers=owner).json()
    assert me["two_factor_enabled"] is True and me["two_factor_overdue"] is False and me["two_factor_due_at"] is None
    assert client.get("/api/invoices", headers=owner).status_code == 200

    # The same for an accountant; never for staff.
    accountant_id, accountant = _user(company_id, "accountant", list(server.ROLE_PERMISSIONS["accountant"]), "Счетоводител")
    _age(accountant_id, 30)
    assert client.get("/api/statistics/summary", headers=accountant).status_code == 403
    staff_id, staff = _user(company_id, "staff", ["add_revenue"], "Касиер")
    _age(staff_id, 30)
    assert client.get("/api/auth/me", headers=staff).json()["two_factor_due_at"] is None
    assert client.post("/api/daily-revenue", headers=staff, json={"date": "2026-10-01", "fiscal_revenue": 10}).status_code == 200


def test_the_setting_lifts_it(client, monkeypatch):
    monkeypatch.setattr(server, "TWO_FACTOR_REQUIRED", False)
    monkeypatch.setattr(server, "TWO_FACTOR_REQUIRED_FROM", datetime.now(timezone.utc) - timedelta(days=60))
    _, owner_id, owner = _company()
    _age(owner_id, 30)
    me = client.get("/api/auth/me", headers=owner).json()
    assert me["two_factor_due_at"] is None and me["two_factor_overdue"] is False
    assert client.get("/api/invoices", headers=owner).status_code == 200

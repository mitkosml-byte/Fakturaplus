"""Phase 5d: new per-router regression coverage for routers/collaboration.py
and routers/admin.py + routers/audit.py, which had no dedicated tests before
(see Module 1 audit finding #3). Self-contained - registers its own
owner/accountant/staff trio rather than depending on test_api.py's shared
STATE, so it can run independently of file order.
"""
import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import server
from .conftest import auth_headers as h

TS = int(time.time())


async def _make_user(label: str) -> tuple:
    """Creates a fresh owner-of-their-own-company user directly against the
    DB, bypassing the rate-limited POST /auth/register (5/minute) - same
    shortcut test_api.py's test_cross_tenant_isolation/test_scan_credits use
    for their own setup. /invitations + /invitations/accept (not
    rate-limited) then move this user into the real team below, exactly as
    production's invite flow would."""
    company = server.Company(name=f"{label} Co", eik=f"TEST{uuid.uuid4().hex[:9].upper()}")
    await server.db.companies.insert_one(company.dict())
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"{label.lower()}_{TS}@test.com"
    await server.db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": label,
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
    return user_id, email, token


def _invite_and_accept(client, owner_headers: dict, email: str, role: str, accept_headers: dict) -> None:
    r = client.post("/api/invitations", headers=owner_headers, json={"email": email, "role": role})
    assert r.status_code == 200, r.text
    code = r.json()["invitation"]["code"]
    r = client.post("/api/invitations/accept", headers=accept_headers, json={"code": code})
    assert r.status_code == 200, r.text


@pytest.fixture(scope="module")
def team(client):
    """Owner + an accountant teammate (has team_collaboration) + a plain
    staff teammate (does not, by default) - all in one company. Built once
    per module (not per test), via direct DB inserts for the three user
    accounts (see _make_user) plus the real, non-rate-limited invitation
    flow to place the accountant/staff into the owner's company."""
    owner_id, _, owner_token = asyncio.run(_make_user("CollabOwner"))
    accountant_id, accountant_email, accountant_token = asyncio.run(_make_user("CollabAccountant"))
    staff_id, staff_email, staff_token = asyncio.run(_make_user("CollabStaff"))

    owner = h(owner_token)
    accountant = h(accountant_token)
    staff = h(staff_token)

    _invite_and_accept(client, owner, accountant_email, "accountant", accountant)
    _invite_and_accept(client, owner, staff_email, "staff", staff)

    return owner, accountant, accountant_id, staff


def test_admin_ai_usage_summary_permission_gating(client, team):
    owner, accountant, _, staff = team

    r = client.get("/api/admin/ai-usage-summary", headers=owner)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_estimated_cost_usd"] == 0.0
    assert body["by_endpoint"] == []

    # staff lacks manage_budget.
    r = client.get("/api/admin/ai-usage-summary", headers=staff)
    assert r.status_code == 403

    r = client.get("/api/admin/ai-usage-summary?days=7", headers=owner)
    assert r.status_code == 200 and r.json()["days"] == 7


def test_audit_logs_permission_gating(client, team):
    owner, accountant, _, staff = team

    # Owner action (inviting the accountant/staff above) already produced
    # at least one audit log entry for this company.
    r = client.get("/api/audit-logs", headers=owner)
    assert r.status_code == 200
    assert "logs" in r.json()

    # Accountant has view_audit_log.
    r = client.get("/api/audit-logs", headers=accountant)
    assert r.status_code == 200

    # Plain staff does not.
    r = client.get("/api/audit-logs", headers=staff)
    assert r.status_code == 403

    r = client.get("/api/audit-logs?limit=5", headers=owner)
    assert r.status_code == 200 and len(r.json()["logs"]) <= 5


def test_collab_members_and_team_chat(client, team):
    owner, accountant, accountant_id, staff = team

    r = client.get("/api/collab/members", headers=owner)
    assert r.status_code == 200
    member_ids = {m["user_id"] for m in r.json()}
    assert accountant_id in member_ids

    # Plain staff lacks team_collaboration by default.
    r = client.get("/api/collab/members", headers=staff)
    assert r.status_code == 403

    r = client.get("/api/messages/conversations", headers=owner)
    assert r.status_code == 200
    team_conv = next(c for c in r.json() if c["name"] == "Екипен чат")
    team_id = team_conv["conversation_id"]

    r = client.post(f"/api/messages/{team_id}", headers=owner, json={"text": "Здравейте, екип!"})
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "Здравейте, екип!"

    r = client.get(f"/api/messages/{team_id}", headers=accountant)
    assert r.status_code == 200
    assert any(m["text"] == "Здравейте, екип!" for m in r.json())

    r = client.post(f"/api/messages/{team_id}/read", headers=accountant)
    assert r.status_code == 200

    # Staff has no team_collaboration -> blocked from the team channel too.
    r = client.post(f"/api/messages/{team_id}", headers=staff, json={"text": "nope"})
    assert r.status_code == 403

    # Empty text is rejected at the handler level.
    r = client.post(f"/api/messages/{team_id}", headers=owner, json={"text": "   "})
    assert r.status_code == 400


def test_direct_messages(client, team):
    owner, accountant, accountant_id, staff = team

    r = client.post("/api/messages/dm/start", headers=owner, json={"user_id": accountant_id})
    assert r.status_code == 200, r.text
    conversation_id = r.json()["conversation_id"]

    # Starting the same DM again returns the same conversation (idempotent).
    r = client.post("/api/messages/dm/start", headers=owner, json={"user_id": accountant_id})
    assert r.status_code == 200 and r.json()["conversation_id"] == conversation_id

    # Cannot DM yourself.
    r = client.get("/api/auth/me", headers=owner)
    owner_id = r.json()["user_id"]
    r = client.post("/api/messages/dm/start", headers=owner, json={"user_id": owner_id})
    assert r.status_code == 400

    # Cannot DM someone outside the team.
    r = client.post("/api/messages/dm/start", headers=owner, json={"user_id": "not-a-real-user"})
    assert r.status_code == 404

    r = client.post(f"/api/messages/{conversation_id}", headers=owner, json={"text": "Поверително съобщение"})
    assert r.status_code == 200

    r = client.get(f"/api/messages/{conversation_id}", headers=accountant)
    assert r.status_code == 200
    assert any(m["text"] == "Поверително съобщение" for m in r.json())

    # A third party (staff, not a participant) must not read this DM.
    r = client.get(f"/api/messages/{conversation_id}", headers=staff)
    assert r.status_code == 403

    # A nonexistent conversation id is a plain 404.
    r = client.get("/api/messages/nonexistent-conversation", headers=owner)
    assert r.status_code == 404


def test_push_subscribe_unsubscribe(client, team):
    owner, _, _, _ = team

    r = client.post("/api/push/subscribe", headers=owner, json={
        "endpoint": f"https://push.example.com/{TS}",
        "keys": {"p256dh": "abc", "auth": "def"},
    })
    assert r.status_code == 200

    r = client.post("/api/push/unsubscribe", headers=owner, json={"endpoint": f"https://push.example.com/{TS}"})
    assert r.status_code == 200

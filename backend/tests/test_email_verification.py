"""The email of a new account is confirmed with a code (P1-7): before, an
account could be opened with someone else's email, and team invitations go
to a person by their email.

- A new account gets a 6-digit code by email; until it is typed in, the
  account works in its own business, but joins no one's team.
- An invitation used at registration waits for the code, then is taken up.
- Without outgoing email there is no code to send: nobody is held back;
  accounts from before the check count as confirmed.

Invented people and emails."""
import asyncio
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import server
from routers import auth as auth_router

PASSWORD = "Passw0rd1"


@pytest.fixture
def mail(client, monkeypatch):
    """Email switched on, every message kept here instead of sent; the
    register/verify limits per address off - these tests make more calls a
    minute than they allow from the one test client."""
    sent = []

    async def fake_send(to_email, subject, html_body, attachments=None):
        sent.append({"to": to_email, "subject": subject, "html": html_body})
        return True

    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "send_email", fake_send)
    server.limiter.reset()
    server.limiter.enabled = False
    yield sent
    client.cookies.clear()
    server.limiter.enabled = True


def _code(message) -> str:
    found = re.search(r">(\d{6})<", message["html"])
    assert found, message["html"]
    return found.group(1)


def _register(client, name="Нов Човек", invitation_code=None, email=None):
    email = email or f"ev_{uuid.uuid4().hex[:10]}@test.com"
    body = {"email": email, "password": PASSWORD, "name": name}
    if invitation_code:
        body["invitation_code"] = invitation_code
    reply = client.post("/api/auth/register", json=body)
    client.cookies.clear()
    assert reply.status_code == 200, reply.text
    return email, reply.json(), {"Authorization": f"Bearer {reply.json()['session_token']}"}


def _post(client, path, headers, body=None):
    reply = client.post(path, headers=headers, json=body or {})
    client.cookies.clear()
    return reply


def test_a_new_account_confirms_its_email_with_the_code(client, mail):
    # A name that is a piece of HTML: never in the email - it may reach the
    # inbox of someone who did not open the account.
    email, body, headers = _register(client, name='<a href="https://example.invalid">Натисни</a>')
    assert body["user"]["email_verified"] is False and body["email_code_sent"] is True
    assert len(mail) == 1 and mail[0]["to"] == email
    assert "example.invalid" not in mail[0]["html"] and "Натисни" not in mail[0]["html"]
    code = _code(mail[0])

    me = client.get("/api/auth/me", headers=headers).json()
    assert me["email_verified"] is False
    # The account works in its own business meanwhile.
    assert client.get("/api/statistics/summary", headers=headers).status_code == 200

    wrong = "000000" if code != "000000" else "111111"
    assert _post(client, "/api/auth/verify-email", headers, {"code": wrong}).status_code == 400
    done = _post(client, "/api/auth/verify-email", headers, {"code": code})
    assert done.status_code == 200, done.text
    assert done.json()["user"]["email_verified"] is True and done.json()["joined_company"] is None
    assert client.get("/api/auth/me", headers=headers).json()["email_verified"] is True
    # The code is spent; asking again says it is done.
    again = _post(client, "/api/auth/verify-email/resend", headers)
    assert again.json() == {"sent": False, "already_verified": True}


def test_five_wrong_tries_spend_the_code_and_a_new_one_waits_a_minute(client, mail):
    _, _, headers = _register(client)
    code = _code(mail[0])
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(auth_router.EMAIL_CODE_TRIES):
        assert _post(client, "/api/auth/verify-email", headers, {"code": wrong}).status_code == 400
    # The right code no longer works after five wrong ones.
    assert _post(client, "/api/auth/verify-email", headers, {"code": code}).status_code == 400

    # A new code at most once a minute.
    soon = _post(client, "/api/auth/verify-email/resend", headers)
    assert soon.status_code == 429
    user_id = client.get("/api/auth/me", headers=headers).json()["user_id"]
    asyncio.run(server.db.email_verifications.update_one(
        {"user_id": user_id}, {"$set": {"sent_at": datetime.now(timezone.utc) - timedelta(minutes=2)}}))
    fresh = _post(client, "/api/auth/verify-email/resend", headers)
    assert fresh.status_code == 200 and fresh.json()["sent"] is True
    new_code = _code(mail[-1])
    assert _post(client, "/api/auth/verify-email", headers, {"code": new_code}).status_code == 200


def test_at_most_ten_codes_a_day(client, mail):
    _, _, headers = _register(client)
    user_id = client.get("/api/auth/me", headers=headers).json()["user_id"]
    for _ in range(auth_router.EMAIL_CODES_PER_DAY - 1):
        asyncio.run(server.db.email_verifications.update_one(
            {"user_id": user_id}, {"$set": {"sent_at": datetime.now(timezone.utc) - timedelta(minutes=2)}}))
        assert _post(client, "/api/auth/verify-email/resend", headers).status_code == 200
    asyncio.run(server.db.email_verifications.update_one(
        {"user_id": user_id}, {"$set": {"sent_at": datetime.now(timezone.utc) - timedelta(minutes=2)}}))
    assert _post(client, "/api/auth/verify-email/resend", headers).status_code == 429
    # A day later the count starts again.
    asyncio.run(server.db.email_verifications.update_one(
        {"user_id": user_id}, {"$set": {"day_start": datetime.now(timezone.utc) - timedelta(hours=25)}}))
    assert _post(client, "/api/auth/verify-email/resend", headers).status_code == 200


def test_an_invitation_waits_for_the_code(client, mail):
    # The owner of a business invites a person by their email.
    owner_email, _, owner = _register(client, name="Собственик Проба")
    assert _post(client, "/api/auth/verify-email", owner, {"code": _code(mail[-1])}).status_code == 200
    owner_company = client.get("/api/auth/me", headers=owner).json()["company_id"]
    invited_email = f"ev_{uuid.uuid4().hex[:10]}@test.com"
    made = _post(client, "/api/invitations", owner, {"email": invited_email, "role": "staff"})
    assert made.status_code == 200, made.text
    code = made.json()["invitation"]["code"]

    # Someone registers with that email and the code: the account starts in
    # its own business, the invitation waits for the email's code.
    _, body, headers = _register(client, name="Служител Проба", invitation_code=code, email=invited_email)
    assert body["invite_error"] is None
    assert body["user"]["invite_pending"] is True and body["user"]["company_id"] != owner_company
    # Typing the invitation in again does not get around the code.
    early = _post(client, "/api/invitations/accept", headers, {"code": code})
    assert early.status_code == 403

    done = _post(client, "/api/auth/verify-email", headers, {"code": _code(mail[-1])})
    assert done.status_code == 200, done.text
    reply = done.json()
    assert reply["invite_error"] is None and reply["joined_company"]["id"] == owner_company
    assert reply["user"]["company_id"] == owner_company and reply["user"]["role"] == "staff"
    assert reply["user"]["invite_pending"] is False
    status = asyncio.run(server.db.invitations.find_one({"code": code}))["status"]
    assert status == "accepted"


def test_without_email_nobody_is_held_back(client, monkeypatch):
    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", False)
    server.limiter.reset()
    server.limiter.enabled = False
    try:
        _, body, headers = _register(client)
        assert body["user"]["email_verified"] is True and body["email_code_sent"] is False
        # An account from before the check has no mark: confirmed.
        user_id = body["user"]["user_id"]
        asyncio.run(server.db.users.update_one({"user_id": user_id}, {"$unset": {"email_verified": ""}}))
        monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", True)
        assert client.get("/api/auth/me", headers=headers).json()["email_verified"] is True
    finally:
        client.cookies.clear()
        server.limiter.enabled = True


def test_a_password_reset_confirms_the_email(client, mail):
    email, body, _ = _register(client)
    assert _post(client, "/api/auth/forgot-password", {}, {"email": email}).status_code == 200
    reset = asyncio.run(server.db.password_reset_codes.find_one({"user_id": body["user"]["user_id"], "used": False}))
    done = _post(client, "/api/auth/reset-password", {}, {"email": email, "code": reset["code"], "new_password": "Passw0rd2"})
    assert done.status_code == 200, done.text
    login = client.post("/api/auth/login", json={"email": email, "password": "Passw0rd2"})
    client.cookies.clear()
    assert login.status_code == 200 and login.json()["user"]["email_verified"] is True

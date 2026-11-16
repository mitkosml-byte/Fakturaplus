"""A second step at login (С1): a code from an authenticator app - or one
sent by email - after the password, with one-time recovery codes for a
lost phone. The secret never leaves the server, a code is good once, and
wrong codes are limited per login and per account."""
import asyncio
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import server
from services import two_factor as tf

PASSWORD = "Passw0rd1"
STEP = 60_000_000   # a fixed time step, so a test does not cross one


@pytest.fixture
def free_client(client, monkeypatch):
    """Register and login allow a few calls a minute per address - these
    tests log in more often than that from the one test client."""
    server.limiter.reset()
    server.limiter.enabled = False
    monkeypatch.setattr(tf, "current_step", lambda now=None: STEP)
    yield client
    client.cookies.clear()
    server.limiter.enabled = True


def _register(client):
    email = f"tf_{uuid.uuid4().hex[:10]}@test.com"
    reply = client.post("/api/auth/register", json={"name": "Иван", "email": email, "password": PASSWORD})
    assert reply.status_code == 200, reply.text
    return email, {"Authorization": f"Bearer {reply.json()['session_token']}"}


def _login(client, email, password=PASSWORD):
    reply = client.post("/api/auth/login", json={"email": email, "password": password})
    client.cookies.clear()
    return reply


def _second(client, challenge, code):
    reply = client.post("/api/auth/login/2fa", json={"challenge_token": challenge, "code": code})
    client.cookies.clear()
    return reply


def _with_app(client):
    email, headers = _register(client)
    setup = client.post("/api/auth/2fa/setup", headers=headers, json={"method": "totp", "password": PASSWORD}).json()
    secret = setup["secret"]
    assert setup["otpauth_uri"].startswith("otpauth://totp/") and f"secret={secret}" in setup["otpauth_uri"]
    enabled = client.post("/api/auth/2fa/enable", headers=headers, json={"code": tf.code_at(secret, STEP)})
    assert enabled.status_code == 200, enabled.text
    return email, headers, secret, enabled.json()["recovery_codes"]


def test_c1_codes_follow_the_standard():
    # RFC 6238's SHA1 vectors (the last 6 of their 8 digits).
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"   # "12345678901234567890"
    assert tf.code_at(secret, 59 // 30) == "287082"
    assert tf.code_at(secret, 1111111109 // 30) == "081804"
    assert tf.code_at(secret, 1234567890 // 30) == "005924"
    # A step either way is fine (a phone's clock a little off); a used one is not.
    assert tf.verify_app_code(secret, "287082", now=59 + 30) == 1
    assert tf.verify_app_code(secret, "287 082", now=59) == 1
    assert tf.verify_app_code(secret, "287082", last_step=1, now=59) is None
    assert tf.verify_app_code(secret, "287082", now=59 + 90) is None


def test_c1_turning_it_on_needs_a_right_first_code(free_client):
    client = free_client
    _, headers = _register(client)
    assert client.get("/api/auth/2fa", headers=headers).json()["enabled"] is False
    # The password again first - an open session alone cannot turn it on.
    assert client.post("/api/auth/2fa/setup", headers=headers, json={"method": "totp"}).status_code == 401
    assert client.post("/api/auth/2fa/setup", headers=headers, json={"method": "totp", "password": "Wrong1234"}).status_code == 401
    secret = client.post("/api/auth/2fa/setup", headers=headers, json={"method": "totp", "password": PASSWORD}).json()["secret"]
    assert client.post("/api/auth/2fa/enable", headers=headers, json={"code": "000000" if tf.code_at(secret, STEP) != "000000" else "111111"}).status_code == 400
    assert client.get("/api/auth/2fa", headers=headers).json()["enabled"] is False

    enabled = client.post("/api/auth/2fa/enable", headers=headers, json={"code": tf.code_at(secret, STEP)}).json()
    assert len(enabled["recovery_codes"]) == 8 and all(re.fullmatch(r"[A-Z2-9]{4}-[A-Z2-9]{4}", c) for c in enabled["recovery_codes"])
    status = client.get("/api/auth/2fa", headers=headers).json()
    assert (status["enabled"], status["method"], status["recovery_codes_left"]) == (True, "totp", 8)

    # The secret and the codes never leave the server - only that it is on.
    me = client.get("/api/auth/me", headers=headers)
    assert me.json()["two_factor_enabled"] is True and me.json()["two_factor_method"] == "totp"
    assert secret not in me.text and "recovery_codes" not in me.text and "two_factor_pending" not in me.text
    assert client.post("/api/auth/2fa/setup", headers=headers, json={"method": "totp", "password": PASSWORD}).status_code == 400


def test_c1_login_asks_for_the_code_once(free_client):
    client = free_client
    email, _, secret, _ = _with_app(client)

    first = _login(client, email)
    assert first.status_code == 200 and first.json()["two_factor_required"] is True
    assert "session_token" not in first.json() and first.json()["method"] == "totp"
    challenge = first.json()["challenge_token"]

    # The code that turned it on is spent; the next step's is good, once.
    assert _second(client, challenge, tf.code_at(secret, STEP)).status_code == 401
    session = _second(client, challenge, tf.code_at(secret, STEP + 1))
    assert session.status_code == 200 and session.json()["session_token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {session.json()['session_token']}"}).status_code == 200
    assert _second(client, challenge, tf.code_at(secret, STEP + 1)).status_code == 401   # the challenge is gone

    again = _login(client, email).json()["challenge_token"]
    assert _second(client, again, tf.code_at(secret, STEP + 1)).status_code == 401       # that code is spent too


def test_c1_a_recovery_code_lets_in_once(free_client):
    client = free_client
    email, headers, _, recovery = _with_app(client)

    challenge = _login(client, email).json()["challenge_token"]
    assert _second(client, challenge, recovery[0].lower()).status_code == 200
    assert client.get("/api/auth/2fa", headers=headers).json()["recovery_codes_left"] == 7
    challenge = _login(client, email).json()["challenge_token"]
    assert _second(client, challenge, recovery[0]).status_code == 401


def test_c1_wrong_codes_end_the_login_and_pause_the_account(free_client):
    client = free_client
    email, _, secret, _ = _with_app(client)
    wrong = "000000" if tf.code_at(secret, STEP + 1) != "000000" else "111111"

    # Five wrong codes end this login, even before the right one.
    challenge = _login(client, email).json()["challenge_token"]
    for _ in range(5):
        assert _second(client, challenge, wrong).status_code == 401
    assert _second(client, challenge, tf.code_at(secret, STEP + 1)).status_code == 401

    # Ten across logins pause the account's second step - and its logins.
    challenge = _login(client, email).json()["challenge_token"]
    for _ in range(5):
        _second(client, challenge, wrong)
    assert _login(client, email).status_code == 429

    # Once the pause has passed, the right code lets in (and the count starts over).
    user = asyncio.run(server.db.users.find_one({"email": email}))
    asyncio.run(server.db.users.update_one({"user_id": user["user_id"]}, {
        "$set": {"two_factor.failed_at": datetime.now(timezone.utc) - timedelta(minutes=16)},
    }))
    challenge = _login(client, email).json()["challenge_token"]
    assert _second(client, challenge, tf.code_at(secret, STEP + 1)).status_code == 200
    assert "failures" not in asyncio.run(server.db.users.find_one({"email": email}))["two_factor"]


def test_c1_turning_it_off_needs_the_password_and_a_code(free_client):
    client = free_client
    email, headers, secret, recovery = _with_app(client)
    assert client.post("/api/auth/2fa/disable", headers=headers, json={"password": "Wrong1234", "code": tf.code_at(secret, STEP + 1)}).status_code == 401
    assert client.post("/api/auth/2fa/disable", headers=headers, json={"password": PASSWORD}).status_code == 400
    off = client.post("/api/auth/2fa/disable", headers=headers, json={"password": PASSWORD, "code": recovery[3]})
    assert off.status_code == 200 and off.json() == {"enabled": False}
    login = _login(client, email)
    assert login.status_code == 200 and login.json()["session_token"]


def test_c1_a_code_by_email(free_client, monkeypatch):
    client = free_client
    sent = []

    async def fake_send(to_email, subject, html_body, attachments=None):
        sent.append((to_email, re.search(r">(\d{6})<", html_body).group(1)))
        return True
    monkeypatch.setattr(server, "send_email", fake_send)

    email, headers = _register(client)
    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", False)
    assert client.post("/api/auth/2fa/setup", headers=headers, json={"method": "email", "password": PASSWORD}).status_code == 503
    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", True)
    assert client.post("/api/auth/2fa/setup", headers=headers, json={"method": "email", "password": PASSWORD}).json()["sent_to"] == email
    assert client.post("/api/auth/2fa/enable", headers=headers, json={"code": sent[-1][1]}).status_code == 200

    login = _login(client, email).json()
    assert (login["method"], login["code_sent"]) == ("email", True) and sent[-1][0] == email
    assert _second(client, login["challenge_token"], sent[-1][1]).status_code == 200
    # Turning it off needs only the password - the account's own email is the second step.
    assert client.post("/api/auth/2fa/disable", headers=headers, json={"password": PASSWORD}).status_code == 200


def test_c1_suggested_once_to_whoever_sees_the_whole_business(free_client):
    from tests.test_whole_program_fixes import _company, _user
    client = free_client
    company_id, owner_id, owner = _company()
    for day in range(1, 21):
        client.post("/api/daily-revenue", headers=owner, json={"date": f"2026-10-{day:02d}", "fiscal_revenue": 100})

    def signal(user_id):
        user = server.User(**server.sanitize_user(asyncio.run(server.db.users.find_one({"user_id": user_id}, {"_id": 0}))))

        async def run():
            _, scope = await server.get_company_scope(user)
            return await server._signal_two_factor(company_id, scope, user, server.get_financial_visibility(user))
        return asyncio.run(run())

    suggestion = signal(owner_id)
    assert suggestion["key"] == "two_factor" and suggestion["route"] == "/account-security"
    staff_id, _ = _user(company_id, "staff", ["add_revenue"], "Касиер")
    assert signal(staff_id) is None
    asyncio.run(server.db.users.update_one({"user_id": owner_id}, {"$set": {"two_factor": {"method": "totp", "secret": tf.new_secret()}}}))
    assert signal(owner_id) is None

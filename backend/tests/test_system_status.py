"""P1-6: the program writes down what went wrong - a request it could not
answer, a background job that failed, an error the app met - and shows it
on the "Състояние" screen: the owner their own company's, the person who
runs the program everyone's. Invented data only."""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi.testclient import TestClient

import server
from services import error_log
from .conftest import auth_headers as h


def _run(coro):
    return asyncio.run(coro)


async def _make_user(role: str = "owner", company_id: Optional[str] = None) -> dict:
    if company_id is None:
        company = server.Company(name=f"Status Co {uuid.uuid4().hex[:6]}", eik="200000002", address="ул. Примерна 1")
        await server.db.companies.insert_one(company.model_dump())
        company_id = company.id
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"status_{uuid.uuid4().hex[:8]}@test.com"
    await server.db.users.insert_one({
        "user_id": user_id, "email": email, "name": "Тест", "picture": None,
        "role": role, "permissions": server.resolve_permissions(role, None),
        "company_id": company_id, "password_hash": None, "auth_provider": "email",
        "created_at": datetime.now(timezone.utc),
    })
    token = uuid.uuid4().hex
    await server.db.user_sessions.insert_one({
        "user_id": user_id, "session_token": token,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user_id": user_id, "email": email, "company_id": company_id, "headers": h(token)}


_BOOM_PATH = f"/api/test-boom-{uuid.uuid4().hex[:6]}/{{item_id}}"


async def _boom(item_id: str):
    raise ValueError(f"nothing for {item_id} 12345")

server.app.add_api_route(_BOOM_PATH, _boom, methods=["GET"])


def test_a_request_that_fails_is_written_down_and_answered_plainly(client):
    owner = _run(_make_user())
    quiet = TestClient(server.app, raise_server_exceptions=False)
    for item in ("4f1c2b9a77", "8e3d1a0c55"):
        r = quiet.get(_BOOM_PATH.replace("{item_id}", item), headers={**owner["headers"], "Origin": "http://localhost:8081"})
        assert r.status_code == 500
        assert r.json()["detail"].startswith("Нещо се обърка")
        # The browser may read the answer: the app shows it, not "no connection".
        assert r.headers.get("access-control-allow-origin") == "http://localhost:8081"
    records = _run(server.db.error_log.find({"company_id": owner["company_id"], "source": "server"}).to_list(10))
    # The same error with other numbers in it is one record, counted twice.
    assert len(records) == 1
    record = records[0]
    assert record["count"] == 2
    assert record["where"] == "GET " + _BOOM_PATH
    assert record["kind"] == "ValueError"
    assert "nothing for" in record["message"]
    assert "ValueError" in record["trace"]
    assert record["expires_at"] > datetime.now() + timedelta(days=error_log.KEEP_DAYS - 1)


def test_a_failing_background_job_keeps_going_and_is_written_down():
    calls = {"n": 0}
    key = f"test_job_{uuid.uuid4().hex[:6]}"

    async def tick():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("supplier feed down")
        if calls["n"] == 3:
            raise asyncio.CancelledError()

    async def scenario():
        try:
            await error_log.run_job(server.db, key, tick, 0)
        except asyncio.CancelledError:
            pass
        return await server.db.job_status.find_one({"key": key}), await server.db.error_log.find_one({"where": key})

    status, logged = _run(scenario())
    assert calls["n"] == 3  # it ran again after the failure
    assert status["runs"] == 2 and status["failures"] == 1
    assert status["ok"] is True  # the last run went well
    assert status["last_error"] == "RuntimeError: supplier feed down"
    assert logged["source"] == "job" and logged["kind"] == "RuntimeError" and logged["company_id"] is None


def test_job_states():
    now = datetime.now(timezone.utc)
    assert error_log.job_state(None, 600, False, now) == "off"
    assert error_log.job_state(None, 600, True, now) == "waiting"
    assert error_log.job_state({"last_run_at": now - timedelta(minutes=5), "ok": True}, 600, True, now) == "ok"
    assert error_log.job_state({"last_run_at": now - timedelta(minutes=5), "ok": False}, 600, True, now) == "failing"
    # Two intervals and five minutes without a run.
    assert error_log.job_state({"last_run_at": now - timedelta(minutes=26), "ok": True}, 600, True, now) == "late"


def test_errors_from_the_app_land_in_the_same_log(client):
    owner = _run(_make_user())
    r = client.post("/api/client-errors", headers=owner["headers"], json={
        "message": "TypeError: Cannot read properties of undefined (reading 'total')",
        "stack": "at Home (index.js:10:5)", "screen": "/supplier/[name]/1234", "kind": "error", "platform": "web",
    })
    assert r.status_code == 204
    record = _run(server.db.error_log.find_one({"company_id": owner["company_id"], "source": "app"}))
    assert record["kind"] == "TypeError"
    assert record["message"] == "Cannot read properties of undefined (reading 'total')"
    assert record["where"] == "web /supplier/[name]/#"
    assert record["trace"] == "at Home (index.js:10:5)"

    # Before signing in too (the login screen can fail) - with no company.
    r = client.post("/api/client-errors", json={"message": "Login screen broke", "platform": "ios"})
    assert r.status_code == 204
    assert _run(server.db.error_log.find_one({"message": "Login screen broke"}))["company_id"] is None

    # Nothing past the limits is taken.
    assert client.post("/api/client-errors", json={"message": "x" * 5000}).status_code == 422


def test_a_flood_from_the_app_stops_at_the_day_cap(client, monkeypatch):
    day = datetime.now(timezone.utc).date().isoformat()
    already = _run(server.db.error_log.count_documents({"day": day, "source": "app"}))
    monkeypatch.setattr(error_log, "APP_NEW_PER_DAY", already + 2)
    tag = uuid.uuid4().hex[:6]
    for n in ("one", "two", "three"):
        assert client.post("/api/client-errors", json={"message": f"flood {tag} {n}"}).status_code == 204
    assert _run(server.db.error_log.count_documents({"message": {"$regex": f"^flood {tag}"}})) == 2
    # A known error still counts.
    client.post("/api/client-errors", json={"message": f"flood {tag} one"})
    assert _run(server.db.error_log.find_one({"message": f"flood {tag} one"}))["count"] == 2


def test_the_owner_sees_their_own_company_and_the_admin_sees_all(client, monkeypatch):
    owner = _run(_make_user())
    staff = _run(_make_user("staff", owner["company_id"]))
    other = _run(_make_user())

    async def seed():
        await error_log.record(server.db, source="server", where="GET /api/mine", kind="KeyError",
                               message="'total'", trace="Traceback mine", company_id=owner["company_id"])
        await error_log.record(server.db, source="server", where="GET /api/theirs", kind="KeyError",
                               message="'name'", trace="Traceback theirs", company_id=other["company_id"])
    _run(seed())

    assert client.get("/api/system/status", headers=staff["headers"]).status_code == 403

    status = client.get("/api/system/status", headers=owner["headers"]).json()
    assert status["scope"] == "company"
    wheres = {e["where"] for e in status["errors"]["items"]}
    assert "GET /api/mine" in wheres and "GET /api/theirs" not in wheres
    assert all("trace" not in e for e in status["errors"]["items"])
    assert [j["key"] for j in status["jobs"]] == list(server.JOB_INTERVALS)
    assert all(j["last_error"] is None for j in status["jobs"])
    assert status["database"]["ok"] is True
    assert set(status["features"]) == {"ai", "email", "payments", "push"}

    monkeypatch.setattr(server, "ADMIN_EMAIL", other["email"].upper().lower())
    status = client.get("/api/system/status", headers=other["headers"]).json()
    assert status["scope"] == "all"
    items = {e["where"]: e for e in status["errors"]["items"]}
    assert "GET /api/mine" in items and "GET /api/theirs" in items
    assert items["GET /api/mine"]["trace"] == "Traceback mine"
    assert items["GET /api/mine"]["company_name"].startswith("Status Co")


def test_nobody_is_admin_when_it_is_not_set(monkeypatch):
    monkeypatch.setattr(server, "ADMIN_EMAIL", "")
    assert server.is_app_admin("") is False
    assert server.is_app_admin("someone@test.com") is False
    monkeypatch.setattr(server, "ADMIN_EMAIL", "boss@test.com")
    assert server.is_app_admin(" Boss@Test.com ") is True

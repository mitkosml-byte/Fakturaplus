"""Backups outside the database (P1-3): before, there was only the monthly
copy by email - and only for whoever turned it on - while the free database
plan keeps no backups of its own: a mistake could cost a month of data. And
the emailed file held everything, readable by whoever got into the mailbox.

- Every company's data goes to the file storage once a day; the last 30 days
  stay; the owner sees the days and brings back what is missing.
- The monthly file by email is locked with a password the owner chose; the
  app opens it again with that password.

Invented businesses and numbers."""
import asyncio
import base64
import gzip
import json
from datetime import timedelta

import pytest

import server
from routers import backup as backup_router
from services import backup_crypto, object_storage
from tests.test_whole_program_fixes import _company, _user

PASSWORD = "Тайна-Парола-1"


@pytest.fixture(autouse=True)
def _fresh_limits():
    """A restore is allowed 5 times a minute from one address - these tests
    restore more often than that from the one test client."""
    server.limiter.reset()
    yield
    server.limiter.reset()


@pytest.fixture
def bucket():
    store = object_storage.MemoryBackend()
    object_storage.use(store)
    yield store
    object_storage.use(None)


@pytest.fixture
def mail(monkeypatch):
    sent = []

    async def fake_send(to_email, subject, html_body, attachments=None):
        sent.append({"to": to_email, "subject": subject, "html": html_body, "attachments": attachments or []})
        return True

    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "send_email", fake_send)
    return sent


def _revenue(client, owner, day="2026-10-01"):
    reply = client.post("/api/daily-revenue", headers=owner, json={"date": day, "fiscal_revenue": 100})
    assert reply.status_code == 200, reply.text


def _email_of(user_id):
    return asyncio.run(server.db.users.find_one({"user_id": user_id}))["email"]


def test_every_company_is_kept_outside_the_database_once_a_day(client, bucket):
    company_id, _, owner = _company()
    _revenue(client, owner)
    empty_company, _, _ = _company()

    assert asyncio.run(backup_router.run_daily_backups(only=[company_id, empty_company])) == 1
    today = server.today_local().isoformat()
    key = f"backups/{company_id}/{today}.json.gz"
    backup = json.loads(gzip.decompress(bucket.files[key]))
    assert backup["company_id"] == company_id and backup["statistics"]["revenue_count"] == 1
    # A business with nothing entered is not stored.
    assert not [k for k in bucket.files if k.startswith(f"backups/{empty_company}/")]

    # Once a day: the next hour leaves it be.
    del bucket.files[key]
    assert asyncio.run(backup_router.run_daily_backups(only=[company_id])) == 0
    assert key not in bucket.files

    # The next day's run keeps only the last 30 days.
    old_day = (server.today_local() - timedelta(days=backup_router.BACKUP_KEEP_DAYS)).isoformat()
    kept_day = (server.today_local() - timedelta(days=backup_router.BACKUP_KEEP_DAYS - 1)).isoformat()
    bucket.put(f"backups/{company_id}/{old_day}.json.gz", b"old", "application/gzip")
    bucket.put(f"backups/{company_id}/{kept_day}.json.gz", b"kept", "application/gzip")
    asyncio.run(server.db.daily_backup_state.update_one({"company_id": company_id}, {"$set": {"day": "2000-01-01"}}))
    assert asyncio.run(backup_router.run_daily_backups(only=[company_id])) == 1
    assert f"backups/{company_id}/{old_day}.json.gz" not in bucket.files
    assert f"backups/{company_id}/{kept_day}.json.gz" in bucket.files and key in bucket.files


def test_the_owner_brings_back_a_day(client, bucket):
    company_id, _, owner = _company()
    _revenue(client, owner)
    asyncio.run(backup_router.run_daily_backups(only=[company_id]))
    today = server.today_local().isoformat()

    days = client.get("/api/backup/daily", headers=owner).json()
    assert days["enabled"] is True and days["keep_days"] == backup_router.BACKUP_KEEP_DAYS
    assert [d["day"] for d in days["days"]] == [today]
    status = client.get("/api/backup/status", headers=owner).json()
    assert status["daily"] == {"enabled": True, "keep_days": backup_router.BACKUP_KEEP_DAYS, "last_day": today}

    # The day's revenue is lost; the day's backup brings it back - once.
    asyncio.run(server.db.daily_revenue.delete_many({"company_id": company_id}))
    restored = client.post(f"/api/backup/daily/{today}/restore", headers=owner)
    assert restored.status_code == 200, restored.text
    assert restored.json()["restored"]["revenues"] == 1
    again = client.post(f"/api/backup/daily/{today}/restore", headers=owner).json()
    assert again["restored"]["revenues"] == 0 and again["already_present"] >= 1
    assert client.get(f"/api/backup/daily/{today}", headers=owner).json()["company_id"] == company_id
    assert client.get("/api/backup/daily/2000-01-01", headers=owner).status_code == 404
    assert client.get("/api/backup/daily/../x", headers=owner).status_code in (400, 404)

    # Only the owner.
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    assert client.get("/api/backup/daily", headers=cashier).status_code == 403
    assert client.post(f"/api/backup/daily/{today}/restore", headers=cashier).status_code == 403


def test_without_a_file_storage_nothing_changes(client):
    company_id, _, owner = _company()
    assert asyncio.run(backup_router.run_daily_backups(only=[company_id])) == 0
    assert client.get("/api/backup/daily", headers=owner).json() == {
        "enabled": False, "keep_days": backup_router.BACKUP_KEEP_DAYS, "days": []}


def test_the_monthly_backup_by_email_is_locked_with_a_password(client, mail):
    company_id, owner_id, owner = _company()
    _revenue(client, owner)

    # A password is chosen first, at least 8 characters.
    first = client.put("/api/backup/settings", headers=owner, json={"monthly_email": True})
    assert first.status_code == 400 and first.json()["detail"]["code"] == "backup_password_required"
    assert client.put("/api/backup/settings", headers=owner, json={"monthly_email": True, "password": "кратка"}).status_code == 400
    done = client.put("/api/backup/settings", headers=owner, json={"monthly_email": True, "password": PASSWORD})
    assert done.status_code == 200 and done.json() == {"monthly_email": True, "password_set": True}
    # Neither the password nor its key goes out anywhere.
    status = client.get("/api/backup/status", headers=owner).json()
    assert status["email_password_set"] is True
    for reply in (status, client.get("/api/auth/me", headers=owner).json()):
        text = json.dumps(reply, ensure_ascii=False)
        key = asyncio.run(server.db.backup_keys.find_one({"user_id": owner_id}))["key"]
        assert PASSWORD not in text and key not in text

    assert asyncio.run(backup_router.send_monthly_backup_emails()) >= 1
    [message] = [m for m in mail if m["to"] == _email_of(owner_id)]
    [attachment] = message["attachments"]
    assert attachment["filename"].endswith(".fpbak")
    blob = base64.b64decode(attachment["content"])
    # Unreadable without the password.
    assert backup_crypto.is_sealed(blob) and b"daily_revenue" not in blob
    with pytest.raises(backup_crypto.PasswordNeeded):
        backup_crypto.read_backup(blob)
    with pytest.raises(backup_crypto.WrongPassword):
        backup_crypto.read_backup(blob, "Друга-Парола-2")
    assert backup_crypto.read_backup(blob, PASSWORD)["company_id"] == company_id

    # The app opens it with the password and brings back what is missing.
    asyncio.run(server.db.daily_revenue.delete_many({"company_id": company_id}))
    file_base64 = attachment["content"]
    needs = client.post("/api/backup/restore-file", headers=owner, json={"file_base64": file_base64})
    assert needs.status_code == 400 and needs.json()["detail"]["code"] == "backup_password_needed"
    wrong = client.post("/api/backup/restore-file", headers=owner, json={"file_base64": file_base64, "password": "Друга-Парола-2"})
    assert wrong.status_code == 400 and wrong.json()["detail"]["code"] == "backup_password_wrong"
    right = client.post("/api/backup/restore-file", headers=owner, json={"file_base64": file_base64, "password": PASSWORD})
    assert right.status_code == 200, right.text
    assert right.json()["restored"]["revenues"] == 1


def test_no_unlocked_file_by_email_any_more(client, mail):
    # An owner who turned the monthly email on before the password: a note
    # to choose one, with nothing of the data in it.
    _, owner_id, owner = _company()
    _revenue(client, owner)
    asyncio.run(server.db.users.update_one({"user_id": owner_id}, {"$set": {"backup_email_monthly": True}}))
    asyncio.run(backup_router.send_monthly_backup_emails())
    [message] = [m for m in mail if m["to"] == _email_of(owner_id)]
    assert message["attachments"] == [] and "парола" in message["subject"]

    # An email not confirmed gets nothing (P1-7).
    _, other_id, other = _company()
    _revenue(client, other)
    asyncio.run(server.db.users.update_one({"user_id": other_id}, {"$set": {
        "backup_email_monthly": True, "email_verified": False}}))
    asyncio.run(backup_router.send_monthly_backup_emails())
    assert not [m for m in mail if m["to"] == _email_of(other_id)]


def test_a_file_made_in_the_app_or_packed_restores_as_it_is(client):
    company_id, _, owner = _company()
    _revenue(client, owner)
    made = client.post("/api/backup/create", headers=owner).json()
    asyncio.run(server.db.daily_revenue.delete_many({"company_id": company_id}))
    plain = base64.b64encode(json.dumps(made).encode("utf-8")).decode("ascii")
    assert client.post("/api/backup/restore-file", headers=owner, json={"file_base64": plain}).json()["restored"]["revenues"] == 1

    asyncio.run(server.db.daily_revenue.delete_many({"company_id": company_id}))
    packed = base64.b64encode(gzip.compress(json.dumps(made).encode("utf-8"))).decode("ascii")
    assert client.post("/api/backup/restore-file", headers=owner, json={"file_base64": packed}).json()["restored"]["revenues"] == 1

    junk = base64.b64encode(b"not a backup at all").decode("ascii")
    assert client.post("/api/backup/restore-file", headers=owner, json={"file_base64": junk}).status_code == 400

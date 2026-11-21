"""The owner's copy of the data (С2): a reminder when there is none or it is
old, and a monthly copy by email for whoever asks; and an issued invoice
deleted by mistake comes back from the activity log (С3) - with its number
while no later document took it, and its receivable."""
import asyncio
import base64
import gzip
import json
from datetime import datetime, timedelta, timezone

import server
from routers import backup as backup_router
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company


def _owner(owner_id):
    return server.User(**asyncio.run(server.db.users.find_one({"user_id": owner_id}, {"_id": 0})))


def _backup_signal(company_id, user):
    async def run():
        _, scope = await server.get_company_scope(user)
        return await server._signal_backup(company_id, scope, user, server.get_financial_visibility(user))
    return asyncio.run(run())


def test_c2_reminded_when_there_is_no_copy_or_it_is_old(client):
    company_id, owner_id, owner = _company()
    for day in range(1, 21):
        client.post("/api/daily-revenue", headers=owner, json={"date": f"2026-10-{day:02d}", "fiscal_revenue": 100})
    signal = _backup_signal(company_id, _owner(owner_id))
    assert signal["key"] == "backup" and "Още нямаш архив" in signal["detail"]

    assert client.post("/api/backup/create", headers=owner).status_code == 200
    assert _backup_signal(company_id, _owner(owner_id)) is None

    asyncio.run(server.db.backup_metadata.update_many(
        {"user_id": owner_id}, {"$set": {"created_at": datetime.now(timezone.utc) - timedelta(days=50)}},
    ))
    assert "отпреди 50 дни" in _backup_signal(company_id, _owner(owner_id))["detail"]


def test_c2_a_monthly_copy_by_email(client, monkeypatch):
    company_id, owner_id, owner = _company()
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-10-01", "fiscal_revenue": 100})
    sent = []

    async def fake_send(to_email, subject, html_body, attachments=None):
        sent.append({"to": to_email, "attachments": attachments or []})
        return True
    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "send_email", fake_send)

    assert client.get("/api/backup/status", headers=owner).json()["monthly_email"] is False
    assert client.put("/api/backup/settings", headers=owner, json={"monthly_email": True}).json() == {"monthly_email": True}
    assert asyncio.run(backup_router.send_monthly_backup_emails()) >= 1
    mine = [m for m in sent if m["to"] == asyncio.run(server.db.users.find_one({"user_id": owner_id}))["email"]]
    [attachment] = mine[0]["attachments"]
    backup = json.loads(gzip.decompress(base64.b64decode(attachment["content"])))
    assert backup["company_id"] == company_id and backup["statistics"]["revenue_count"] == 1
    # Once a month: not again the next hour - and it counts as the owner's copy.
    before = len(sent)
    asyncio.run(backup_router.send_monthly_backup_emails())
    assert len([m for m in sent[before:] if m["to"] == mine[0]["to"]]) == 0
    assert client.get("/api/backup/status", headers=owner).json()["has_backup"] is True


def _delete_log(company_id, document_id):
    return asyncio.run(server.db.audit_logs.find_one(
        {"company_id": company_id, "entity_id": document_id, "action": "delete"}, {"_id": 0},
    ))


def test_c3_a_deleted_issued_invoice_comes_back_from_the_log(client):
    company_id, _, owner = _company()
    invoice = _issue(client, owner, due_date="2099-12-31")
    assert client.delete(f"/api/billing-documents/{invoice['id']}", headers=owner).json()["cancelled"] is False
    log = _delete_log(company_id, invoice["id"])
    assert log["details"]["snapshot"]["invoice_number"] == invoice["invoice_number"]

    restored = client.post(f"/api/audit-logs/{log['id']}/restore", headers=owner)
    assert restored.status_code == 200, restored.text
    back = client.get(f"/api/billing-documents/{invoice['id']}", headers=owner).json()
    assert back["invoice_number"] == invoice["invoice_number"] and back["payment_status"] == "owed"
    assert client.get("/api/receivables/summary", headers=owner).json()["total_owed"] == 120
    assert client.post(f"/api/audit-logs/{log['id']}/restore", headers=owner).status_code == 400   # once

    # Deleted again and its number taken by a new invoice: it cannot come back with it.
    client.delete(f"/api/billing-documents/{invoice['id']}", headers=owner)
    again = asyncio.run(server.db.audit_logs.find(
        {"company_id": company_id, "entity_id": invoice["id"], "action": "delete"}, {"_id": 0},
    ).sort("created_at", -1).to_list(1))[0]
    newer = _issue(client, owner, due_date="2099-12-31")
    assert newer["invoice_number"] == invoice["invoice_number"]
    blocked = client.post(f"/api/audit-logs/{again['id']}/restore", headers=owner)
    assert blocked.status_code == 409 and invoice["invoice_number"] in blocked.json()["detail"]


def test_c3_a_restored_credit_note_takes_its_amount_off_again(client):
    company_id, _, owner = _company()
    invoice = _issue(client, owner, due_date="2099-12-31")
    note = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "credit_note", "credited_document_id": invoice["id"], "customer_name": invoice["customer_name"],
        "notes": "Отстъпка", "items": [{"name": "Отстъпка", "quantity": 1, "unit_price": 50, "vat_rate": 20}],
    }).json()
    client.delete(f"/api/billing-documents/{note['id']}", headers=owner)
    assert client.get(f"/api/billing-documents/{invoice['id']}", headers=owner).json()["credited_amount"] == 0
    log = _delete_log(company_id, note["id"])
    assert client.post(f"/api/audit-logs/{log['id']}/restore", headers=owner).status_code == 200
    assert client.get(f"/api/billing-documents/{invoice['id']}", headers=owner).json()["credited_amount"] == 60

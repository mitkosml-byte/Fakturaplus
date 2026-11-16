"""The month's pack for the accountant (Н4): purchases and sales (the VAT
ledger), each issued invoice and credit note as its PDF, the scanned
documents and the payroll in one ZIP; a check for what is missing (days
without revenue, invoices without an EIK, employees without a payroll);
sent by email to the accountant - or downloaded - and a reminder from the
1st to the 15th until it is sent."""
import asyncio
import base64
import io
import zipfile
from datetime import date

import server
from routers import accountant_pack
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32).decode("ascii")


def _october(client, owner):
    for day in range(1, 32):
        if day not in (7, 12):
            client.post("/api/daily-revenue", headers=owner, json={"date": f"2026-10-{day:02d}", "fiscal_revenue": 100})
    base = {"date": "2026-10-05", "amount_without_vat": 100, "vat_amount": 20, "total_amount": 120, "payment_method": "cash"}
    client.post("/api/invoices", headers=owner, json={**base, "supplier": "Строй Депо", "supplier_eik": "131071587",
                                                       "invoice_number": "W-1", "image_base64": PNG})
    client.post("/api/invoices", headers=owner, json={**base, "supplier": "Пазар", "invoice_number": "77"})
    invoice = _issue(client, owner, issue_date="2026-10-10", due_date="2026-10-24")
    client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "credit_note", "credited_document_id": invoice["id"], "customer_name": invoice["customer_name"],
        "issue_date": "2026-10-20", "notes": "Отстъпка", "items": [{"name": "Отстъпка", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
    })
    return client.post("/api/employees", headers=owner, json={"name": "Мария", "base_salary": 1200, "hire_date": "2024-02-01"}).json()


def test_n4_what_the_pack_holds_and_what_is_missing(client):
    _, _, owner = _company()
    employee = _october(client, owner)
    pack = client.get("/api/accountant-pack?month=2026-10", headers=owner).json()
    assert pack["label"] == "Октомври 2026"
    assert pack["counts"] == {"purchases": 2, "scanned": 1, "revenue_days": 29, "issued_invoices": 1,
                              "credit_notes": 1, "payroll_entries": 0}
    checks = {c["key"]: c for c in pack["checks"]}
    assert checks["missing_revenue"]["message"] == "Липсва оборот за 2 дни: 07.10, 12.10."
    assert checks["purchases_without_eik"]["items"] == ["Пазар № 77"]
    assert checks["purchases_without_scan"]["severity"] == "info"
    assert "Мария" in checks["payroll_missing"]["message"]

    client.post("/api/payroll", headers=owner, json={"employee_id": employee["id"], "period_month": 10, "period_year": 2026, "gross_amount": 1200})
    pack = client.get("/api/accountant-pack?month=2026-10", headers=owner).json()
    assert "payroll_missing" not in {c["key"] for c in pack["checks"]} and pack["counts"]["payroll_entries"] == 1
    assert client.get("/api/accountant-pack?month=2026-13", headers=owner).status_code == 400

    archive = client.get("/api/accountant-pack/zip?month=2026-10", headers=owner)
    assert archive.status_code == 200 and archive.headers["content-type"] == "application/zip"
    names = set(zipfile.ZipFile(io.BytesIO(archive.content)).namelist())
    assert {"dnevnik_pokupki_prodajbi_2026-10.xlsx", "zaplati_2026-10.xlsx", "spravka.txt",
            "izdadeni/faktura_0000000001.pdf", "izdadeni/kreditno-izvestie_0000000002.pdf",
            "pokupki/2026-10-05_Stroy-Depo_W-1.png"} <= names
    summary = zipfile.ZipFile(io.BytesIO(archive.content)).read("spravka.txt").decode("utf-8")
    assert "Липсва оборот за 2 дни" in summary


def test_n4_sent_to_the_accountant_and_reminded_until_then(client, monkeypatch):
    company_id, owner_id, owner = _company()
    _october(client, owner)
    sent = []

    async def fake_send(to_email, subject, html_body, attachments=None):
        sent.append({"to": to_email, "subject": subject, "html": html_body, "attachments": attachments or []})
        return True
    monkeypatch.setattr(server, "send_email", fake_send)
    monkeypatch.setattr(accountant_pack, "today_local", lambda: date(2026, 11, 5))
    user = server.User(**server.sanitize_user(asyncio.run(server.db.users.find_one({"user_id": owner_id}, {"_id": 0}))))

    def signal():
        return asyncio.run(accountant_pack.accountant_pack_signal(company_id, {"company_id": company_id}, user))
    reminder = signal()
    assert reminder["route"] == "/accountant-pack?month=2026-10" and "липсва оборот за 2 дни" in reminder["detail"]

    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", False)
    assert client.post("/api/accountant-pack/send", headers=owner, json={"month": "2026-10", "email": "acc@test.bg"}).status_code == 503
    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", True)
    assert client.post("/api/accountant-pack/send", headers=owner, json={"month": "2026-10"}).status_code == 400   # no address yet
    done = client.post("/api/accountant-pack/send", headers=owner, json={"month": "2026-10", "email": "acc@test.bg"})
    assert done.status_code == 200 and done.json()["sent_to"] == "acc@test.bg"
    [mail] = sent
    assert mail["subject"].startswith("Документи за Октомври 2026") and "Липсва оборот за 2 дни" in mail["html"]
    archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(mail["attachments"][0]["content"])))
    assert "spravka.txt" in archive.namelist()

    # The address is remembered; the month's reminder is gone once sent.
    assert client.get("/api/accountant-pack?month=2026-10", headers=owner).json()["accountant_email"] == "acc@test.bg"
    assert signal() is None
    monkeypatch.setattr(accountant_pack, "today_local", lambda: date(2026, 11, 20))   # after the 15th: none
    asyncio.run(server.db.accountant_packs.delete_many({"company_id": company_id}))
    assert signal() is None

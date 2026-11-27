"""Payment reminders to customers (Н6): the program says when one is due -
on the due date, a week after it, two weeks after it - and words it; the
person sends each one. A stage is sent once; one put off or sent another
way is not suggested again; the business's own invoice goes as a PDF."""
import asyncio
import base64
from datetime import date

import pytest

import server
from routers.payment_reminders import stage_for
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company, _user


@pytest.fixture
def mail(monkeypatch):
    """Email set up; what would be sent is kept instead."""
    sent = []

    async def fake_send(to_email, subject, html_body, attachments=None):
        sent.append({"to": to_email, "subject": subject, "html": html_body, "attachments": attachments})
        return True

    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", True)
    monkeypatch.setattr(server, "send_email", fake_send)
    return sent


def _on(monkeypatch, day):
    monkeypatch.setattr(server, "today_local", lambda: day)


def _business(client):
    """An invoice of 120 € issued on 20.10, due on 3.11, to a customer
    whose email the program does not know yet."""
    company_id, owner_id, owner = _company()
    asyncio.run(server.db.companies.update_one(
        {"id": company_id}, {"$set": {"bank_iban": "BG80BNBG96611020345678", "bank_name": "Примерна банка"}},
    ))
    invoice = _issue(client, owner, issue_date="2026-10-20", due_date="2026-11-03")
    return company_id, owner, invoice


def _reminders(client, owner):
    response = client.get("/api/payment-reminders", headers=owner)
    assert response.status_code == 200, response.text
    return response.json()


def test_n6_the_stages_by_days_after_the_due_date():
    assert [stage_for(days) for days in (-1, 0, 6, 7, 13, 14, 40)] == [None, "due", "due", "week", "week", "two_weeks", "two_weeks"]


def test_n6_the_program_says_when_and_words_it(client, monkeypatch):
    _, owner, invoice = _business(client)
    _on(monkeypatch, date(2026, 11, 2))
    assert _reminders(client, owner)["suggested"] == []          # not due yet

    _on(monkeypatch, date(2026, 11, 3))
    seen = _reminders(client, owner)
    [item] = seen["suggested"]
    assert (item["stage"], item["days_overdue"], item["amount_left"], item["email"]) == ("due", 0, 120, None)
    assert item["label"] == "фактура № 0000000001 от 20.10.2026"
    assert item["document"] == {"id": invoice["id"], "kind": "invoice", "number": "0000000001", "has_pdf": True}
    assert item["subject"] == "Падеж днес - фактура № 0000000001 от 20.10.2026"
    assert "днес е падежът" in item["message"] and "120,00\u00a0€" in item["message"]
    assert "IBAN: BG80BNBG96611020345678 (Примерна банка)" in item["message"] and item["message"].endswith("Проба ООД")

    _on(monkeypatch, date(2026, 11, 10))
    [week] = _reminders(client, owner)["suggested"]
    assert (week["stage"], week["days_overdue"]) == ("week", 7) and "все още не е постъпило" in week["message"]
    _on(monkeypatch, date(2026, 11, 17))
    [late] = _reminders(client, owner)["suggested"]
    assert late["stage"] == "two_weeks" and "закъснява с 14 дни" in late["message"]


def test_n6_each_stage_is_sent_once_with_the_invoice(client, monkeypatch, mail):
    _, owner, invoice = _business(client)
    _on(monkeypatch, date(2026, 11, 4))
    [item] = _reminders(client, owner)["suggested"]
    body = {"stage": "due", "email": "plashtania@gama.bg", "subject": item["subject"], "message": item["message"] + "\n<b>!</b>"}
    sent = client.post(f"/api/payment-reminders/{item['receivable_id']}/send", headers=owner, json=body)
    assert sent.status_code == 200, sent.text
    assert sent.json() == {"sent": True, "to": "plashtania@gama.bg", "stage": "due", "attached": True}
    [email] = mail
    assert (email["to"], email["subject"]) == ("plashtania@gama.bg", item["subject"])
    assert "&lt;b&gt;!&lt;/b&gt;" in email["html"] and "<b>" not in email["html"]   # the text as written, never markup
    [attachment] = email["attachments"]
    assert attachment["filename"] == "faktura_0000000001.pdf" and base64.b64decode(attachment["content"])[:5] == b"%PDF-"

    # Twice (a second tap, another phone): sent once.
    again = client.post(f"/api/payment-reminders/{item['receivable_id']}/send", headers=owner, json=body)
    assert again.status_code == 409 and len(mail) == 1
    seen = _reminders(client, owner)
    assert seen["suggested"] == [] and seen["other"][0]["history"][0]["channel"] == "email"
    # The address is remembered for the customer.
    [customer] = client.get("/api/customers", headers=owner).json()
    assert customer["email"] == "plashtania@gama.bg"

    # A week later the next stage, with the address already there.
    _on(monkeypatch, date(2026, 11, 10))
    [week] = _reminders(client, owner)["suggested"]
    assert (week["stage"], week["email"]) == ("week", "plashtania@gama.bg")
    # The email does not go: nothing is recorded, the reminder is still due.
    monkeypatch.setattr(server, "send_email", lambda *args, **kwargs: _false())
    failed = client.post(f"/api/payment-reminders/{week['receivable_id']}/send", headers=owner,
                         json={**body, "stage": "week", "subject": week["subject"], "message": week["message"]})
    assert failed.status_code == 502
    assert [i["stage"] for i in _reminders(client, owner)["suggested"]] == ["week"]


async def _false():
    return False


def test_n6_put_off_or_sent_another_way_is_not_suggested_again(client, monkeypatch, mail):
    _, owner, _ = _business(client)
    _on(monkeypatch, date(2026, 11, 10))
    [item] = _reminders(client, owner)["suggested"]
    rid = item["receivable_id"]
    put_off = client.post(f"/api/payment-reminders/{rid}/record", headers=owner, json={"stage": "week", "action": "skipped"})
    assert put_off.status_code == 200 and _reminders(client, owner)["suggested"] == []
    assert client.post(f"/api/payment-reminders/{rid}/record", headers=owner, json={"stage": "week", "action": "skipped"}).status_code == 409

    _on(monkeypatch, date(2026, 11, 17))
    [late] = _reminders(client, owner)["suggested"]
    assert late["stage"] == "two_weeks"
    client.post(f"/api/payment-reminders/{rid}/record", headers=owner, json={"stage": "two_weeks", "action": "sent_other"})
    seen = _reminders(client, owner)
    assert seen["suggested"] == [] and {h["channel"] for h in seen["other"][0]["history"]} == {"skipped", "other"}
    # Sending once more by hand is always possible - and changes no stage.
    for _ in range(2):
        manual = client.post(f"/api/payment-reminders/{rid}/send", headers=owner, json={
            "stage": "manual", "email": "a@b.bg", "subject": "Напомняне", "message": "Здравейте"})
        assert manual.status_code == 200
    assert len(mail) == 2 and _reminders(client, owner)["suggested"] == []

    # Paid: nothing more to remind of.
    client.post(f"/api/receivables/{rid}/payments", headers=owner, json={"amount": 120, "date": "2026-11-17", "method": "bank_transfer"})
    assert _reminders(client, owner) == {"email_enabled": True, "suggested": [], "other": []}
    assert client.post(f"/api/payment-reminders/{rid}/send", headers=owner, json={
        "stage": "manual", "email": "a@b.bg", "subject": "Напомняне", "message": "Здравейте"}).status_code == 400


def test_n6_on_home_and_only_for_whoever_enters_revenue(client, monkeypatch, mail):
    company_id, owner, _ = _business(client)
    _on(monkeypatch, date(2026, 11, 3))
    signals = {s["key"]: s for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}
    reminder = signals["payment_reminders"]
    assert reminder["route"] == "/payment-reminders" and "Гама Трейд ООД" in reminder["detail"] and "120,00\u00a0€" in reminder["detail"]

    _, viewer = _user(company_id, "staff", ["view_statistics"], "Зрител")
    assert client.get("/api/payment-reminders", headers=viewer).status_code == 403
    assert "payment_reminders" not in {s["key"] for s in client.get("/api/proactive/signals", headers=viewer).json()["signals"]}
    [item] = _reminders(client, owner)["suggested"]
    _, _, stranger = _company()
    assert client.post(f"/api/payment-reminders/{item['receivable_id']}/send", headers=stranger, json={
        "stage": "due", "email": "a@b.bg", "subject": "x", "message": "y"}).status_code == 404
    assert client.post(f"/api/payment-reminders/{item['receivable_id']}/send", headers=owner, json={
        "stage": "due", "email": "не-е-имейл", "subject": "x", "message": "y"}).status_code == 400

    # A business that does not invoice hears nothing of it.
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"modules.billing": False}}))
    assert "payment_reminders" not in {s["key"] for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}

    # Email not set up on the server: said plainly, nothing claimed.
    monkeypatch.setattr(server, "EMAIL_FEATURES_ENABLED", False)
    off = client.post(f"/api/payment-reminders/{item['receivable_id']}/send", headers=owner, json={
        "stage": "due", "email": "a@b.bg", "subject": "x", "message": "y"})
    assert off.status_code == 503 and _reminders(client, owner)["suggested"][0]["stage"] == "due"

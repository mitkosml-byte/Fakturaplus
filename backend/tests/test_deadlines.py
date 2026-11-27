"""The business's own deadlines (Н10): what the owner enters, how often it
comes back and how early to hear of it - reminded on Home before it, moved
to its next date once done. The dates are the owner's; no law is read."""
import asyncio
from datetime import date

import pytest

import server
from routers.deadlines import add_months
from tests.test_whole_program_fixes import _company, _user

TODAY = date(2026, 11, 17)


@pytest.fixture
def on_today(monkeypatch):
    monkeypatch.setattr(server, "today_local", lambda: TODAY)


def _signals(client, headers):
    return {s["key"]: s for s in client.get("/api/proactive/signals", headers=headers).json()["signals"]}


def test_n10_months_ahead_keep_their_day():
    assert add_months(date(2026, 1, 31), 1, 31) == date(2026, 2, 28)
    assert add_months(date(2026, 2, 28), 1, 31) == date(2026, 3, 31)       # back on the 31st
    assert add_months(date(2026, 11, 20), 12, 20) == date(2027, 11, 20)
    assert add_months(date(2026, 11, 30), 3, 30) == date(2027, 2, 28)


def test_n10_reminded_before_and_moved_on_once_done(client, on_today):
    company_id, _, owner = _company()
    created = client.post("/api/deadlines", headers=owner, json={
        "title": "Застраховка на обекта", "category": "insurance", "due_date": "2026-11-20", "repeat": "yearly",
        "remind_days_before": 7, "amount": 480,
    })
    assert created.status_code == 200, created.text
    insurance = created.json()
    assert (insurance["status"], insurance["days_left"], insurance["next_dates"]) == (
        "soon", 3, ["2026-11-20", "2027-11-20", "2028-11-20"])
    signal = _signals(client, owner)["deadlines"]
    assert (signal["title"], signal["detail"], signal["route"]) == (
        "Наближава срок", "Застраховка на обекта - след 3 дни (20.11).", "/deadlines")

    # Done: next year's date; a second tap with the old date moves nothing.
    done = client.post(f"/api/deadlines/{insurance['id']}/done", headers=owner, json={"due_date": "2026-11-20"})
    assert done.status_code == 200 and (done.json()["due_date"], done.json()["status"]) == ("2027-11-20", "later")
    assert client.post(f"/api/deadlines/{insurance['id']}/done", headers=owner, json={"due_date": "2026-11-20"}).status_code == 409
    assert done.json()["last_done"] == "2026-11-20"
    assert "deadlines" not in _signals(client, owner)

    # Past its date: said as overdue, put off at most - never dismissed for good.
    monthly = client.post("/api/deadlines", headers=owner, json={
        "title": "Документи за счетоводителя", "category": "accountant", "due_date": "2026-11-10", "repeat": "monthly",
        "remind_days_before": 3,
    }).json()
    assert (monthly["status"], monthly["days_left"]) == ("overdue", -7)
    overdue = _signals(client, owner)["deadlines"]
    assert (overdue["title"], overdue["severity"], overdue["detail"]) == (
        "Просрочен срок", "critical", "Документи за счетоводителя - просрочен с 7 дни (10.11).")
    assert "deadlines" in server.SNOOZE_ONLY_SIGNALS
    later = client.post(f"/api/deadlines/{monthly['id']}/done", headers=owner, json={"due_date": "2026-11-10"}).json()
    assert later["due_date"] == "2026-12-10"

    # One that does not come back: finished once done.
    contract = client.post("/api/deadlines", headers=owner, json={
        "title": "Договор за наем - изтича", "category": "contract", "due_date": "2026-12-01", "remind_days_before": 30,
    }).json()
    assert (contract["status"], contract["next_dates"]) == ("soon", ["2026-12-01"])
    finished = client.post(f"/api/deadlines/{contract['id']}/done", headers=owner, json={"due_date": "2026-12-01"}).json()
    assert (finished["status"], finished["is_active"]) == ("done", False)
    # Renewed: a new date makes it live again.
    renewed = client.put(f"/api/deadlines/{contract['id']}", headers=owner, json={"due_date": "2027-12-01"}).json()
    assert (renewed["status"], renewed["is_active"]) == ("later", True)

    every_two = client.post("/api/deadlines", headers=owner, json={
        "title": "Сервиз на климатиците", "category": "inspection", "due_date": "2026-12-31", "repeat": "months", "repeat_months": 2,
    }).json()
    assert every_two["next_dates"] == ["2026-12-31", "2027-02-28", "2027-04-30"]
    # Past and near first, then by date.
    listed = client.get("/api/deadlines", headers=owner).json()
    assert [(d["title"], d["due_date"]) for d in listed] == [
        ("Документи за счетоводителя", "2026-12-10"), ("Сервиз на климатиците", "2026-12-31"),
        ("Застраховка на обекта", "2027-11-20"), ("Договор за наем - изтича", "2027-12-01"),
    ]


def test_n10_kept_by_the_owner_or_a_manager(client, on_today):
    company_id, _, owner = _company()
    deadline = client.post("/api/deadlines", headers=owner, json={"title": "Технически преглед", "due_date": "2026-11-18"}).json()
    _, staff = _user(company_id, "staff", ["add_revenue", "view_statistics"], "Служител")
    assert client.get("/api/deadlines", headers=staff).status_code == 403
    assert "deadlines" not in _signals(client, staff)
    _, manager = _user(company_id, "manager", list(server.ROLE_PERMISSIONS["manager"]), "Управител")
    assert [d["title"] for d in client.get("/api/deadlines", headers=manager).json()] == ["Технически преглед"]
    _, _, stranger = _company()
    assert client.get("/api/deadlines", headers=stranger).json() == []
    assert client.post(f"/api/deadlines/{deadline['id']}/done", headers=stranger, json={"due_date": "2026-11-18"}).status_code == 404
    assert client.post("/api/deadlines", headers=owner, json={"title": "", "due_date": "2026-11-18"}).status_code == 422
    assert client.delete(f"/api/deadlines/{deadline['id']}", headers=owner).status_code == 200
    assert client.get("/api/deadlines", headers=owner).json() == []

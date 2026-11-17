"""Invoices that repeat (Н7): the same customer and lines each month, the
month's invoice ready on its day and issued with one tap through the same
code as any invoice - once a month, whatever happens; counted in the cash
flow before it is issued and as a debt after, never as both."""
import asyncio
from datetime import date

import pytest

import server
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company, _user

TODAY = date(2026, 11, 17)


@pytest.fixture
def on_today(monkeypatch):
    monkeypatch.setattr(server, "today_local", lambda: TODAY)
    monkeypatch.setattr(server.recurring_service, "current_day", lambda: TODAY)


def _template(client, owner, **fields):
    response = client.post("/api/recurring-invoices", headers=owner, json=fields)
    assert response.status_code == 200, response.text
    return response.json()


def _list(client, owner):
    response = client.get("/api/recurring-invoices", headers=owner)
    assert response.status_code == 200, response.text
    return {t["id"]: t for t in response.json()}


def test_n7_the_month_invoice_is_ready_on_its_day_and_issued_once(client, on_today):
    company_id, _, owner = _company()
    october = _issue(client, owner, issue_date="2026-10-05", due_date="2026-10-19")
    template = _template(client, owner, from_document_id=october["id"])
    # Its customer, lines and terms are the October invoice's.
    assert (template["customer_name"], template["customer_eik"], template["day_of_month"], template["due_days"]) == (
        "Гама Трейд ООД", "131071587", 5, 14)
    assert (template["total_amount"], template["month"], template["state"], template["start_month"]) == (120, "2026-11", "ready", "2026-11")

    signals = {s["key"]: s for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}
    assert signals["recurring_invoices"]["title"] == "Фактури за ноември 2026"
    assert "Гама Трейд ООД - 120.00 €" in signals["recurring_invoices"]["detail"]

    issued = client.post(f"/api/recurring-invoices/{template['id']}/issue", headers=owner)
    assert issued.status_code == 200, issued.text
    invoice = issued.json()["document"]
    assert (invoice["invoice_number"], invoice["issue_date"], invoice["due_date"], invoice["total_amount"]) == (
        "0000000002", "2026-11-17", "2026-12-01", 120)
    assert (invoice["recurring_invoice_id"], invoice["recurring_month"]) == (template["id"], "2026-11")
    assert issued.json()["template"]["state"] == "issued"
    # A debt to collect, like any invoice paid by bank; revenue once, on its date.
    receivable = asyncio.run(server.db.receivables.find_one({"id": invoice["receivable_id"]}, {"_id": 0}))
    assert (receivable["amount"], receivable["due_date"]) == (120, "2026-12-01")
    overview = client.get("/api/billing-documents/overview?start_date=2026-11-01&end_date=2026-11-30", headers=owner).json()
    assert (overview["issued_count"], overview["issued_total"]) == (1, 120)

    # Again - another tap, another phone: refused, nothing issued.
    again = client.post(f"/api/recurring-invoices/{template['id']}/issue", headers=owner)
    assert again.status_code == 409 and "0000000002" in again.json()["detail"]
    assert asyncio.run(server.db.billing_documents.count_documents({"company_id": company_id, "doc_type": "invoice"})) == 2
    assert "recurring_invoices" not in {s["key"] for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}
    listed = _list(client, owner)[template["id"]]
    assert listed["issued_document"]["invoice_number"] == "0000000002"
    # The October invoice it was made from is the first of the series.
    assert [(h["month"], h["invoice_number"]) for h in listed["history"]] == [("2026-11", "0000000002"), ("2026-10", "0000000001")]

    # Taken back by mistake (the last one in the sequence goes, its number
    # free again): the month can be issued again.
    assert client.delete(f"/api/billing-documents/{invoice['id']}", headers=owner).status_code == 200
    assert _list(client, owner)[template["id"]]["state"] == "ready"
    redo = client.post(f"/api/recurring-invoices/{template['id']}/issue", headers=owner)
    assert redo.status_code == 200 and redo.json()["document"]["invoice_number"] == "0000000002"
    # An earlier one cancelled (it keeps its number): issued again with the next one.
    _issue(client, owner, issue_date="2026-11-17", customer_name="Друг Клиент ООД", customer_eik="200000003")
    assert client.delete(f"/api/billing-documents/{redo.json()['document']['id']}", headers=owner).status_code == 200
    cancelled = asyncio.run(server.db.billing_documents.find_one({"id": redo.json()["document"]["id"]}, {"_id": 0}))
    assert cancelled["cancelled"] is True
    third = client.post(f"/api/recurring-invoices/{template['id']}/issue", headers=owner)
    assert third.status_code == 200 and third.json()["document"]["invoice_number"] == "0000000004"


def test_n7_made_from_this_months_invoice_that_month_is_done(client, on_today):
    _, _, owner = _company()
    november = _issue(client, owner, issue_date="2026-11-10", due_date="2026-11-24")
    template = _template(client, owner, from_document_id=november["id"])
    assert (template["state"], template["issued_document"]["invoice_number"]) == ("issued", november["invoice_number"])
    assert client.post(f"/api/recurring-invoices/{template['id']}/issue", headers=owner).status_code == 409


def test_n7_the_month_in_its_lines_the_last_day_a_pause_and_an_end(client, on_today):
    _, _, owner = _company()
    monthly = _template(client, owner, customer_name="Делта ЕООД", day_of_month=31, notes="Период: {месец}",
                        items=[{"name": "Поддръжка за {месец}", "quantity": 1, "unit_price": 50, "vat_rate": 20}])
    # November has no 31st: its last day. Before it, it can still be issued now.
    assert (monthly["issue_day"], monthly["state"], monthly["total_amount"], monthly["due_days"]) == ("2026-11-30", "upcoming", 60, 14)
    early = client.post(f"/api/recurring-invoices/{monthly['id']}/issue", headers=owner).json()["document"]
    assert early["items"][0]["name"] == "Поддръжка за ноември 2026" and early["notes"] == "Период: ноември 2026"

    paused = _template(client, owner, customer_name="Епсилон ООД", day_of_month=1,
                       items=[{"name": "Наем", "quantity": 1, "unit_price": 500, "vat_rate": 20}])
    updated = client.put(f"/api/recurring-invoices/{paused['id']}", headers=owner, json={"is_active": False, "day_of_month": 2})
    assert (updated.json()["state"], updated.json()["day_of_month"]) == ("paused", 2)
    assert client.post(f"/api/recurring-invoices/{paused['id']}/issue", headers=owner).status_code == 400

    ended = _template(client, owner, customer_name="Зета ЕТ", day_of_month=1, start_month="2026-08", end_month="2026-10",
                      items=[{"name": "Абонамент", "quantity": 1, "unit_price": 30, "vat_rate": 20}])
    assert ended["state"] == "ended"
    assert client.post(f"/api/recurring-invoices/{ended['id']}/issue", headers=owner).status_code == 400
    # The template goes; the invoices it issued stay.
    assert client.delete(f"/api/recurring-invoices/{monthly['id']}", headers=owner).status_code == 200
    assert client.get(f"/api/billing-documents/{early['id']}", headers=owner).status_code == 200
    assert monthly["id"] not in _list(client, owner)


def test_n7_the_cash_flow_counts_each_month_once(client, on_today):
    _, _, owner = _company()
    client.post("/api/cash-flow/position", headers=owner, json={"cash": 0, "bank": 1000, "date": TODAY.isoformat()})
    template = _template(client, owner, customer_name="Гама Трейд ООД", day_of_month=5, due_days=14,
                         items=[{"name": "Абонамент", "quantity": 1, "unit_price": 100, "vat_rate": 20}])

    def coming():
        flow = client.get("/api/cash-flow?days=60", headers=owner).json()
        return sorted((e["date"], e["kind"], e["amount"]) for e in flow["events"] if e["amount"] > 0)

    # November ready but not issued: paid 14 days after it is (today); December's by 19.12.
    assert coming() == [("2026-12-01", "subscription", 120), ("2026-12-19", "subscription", 120)]
    client.post(f"/api/recurring-invoices/{template['id']}/issue", headers=owner)
    # Issued: the same money, now as the debt it is - not also as expected.
    assert coming() == [("2026-12-01", "receivable", 120), ("2026-12-19", "subscription", 120)]


def test_n7_only_for_whoever_issues_invoices(client, on_today):
    company_id, _, owner = _company()
    template = _template(client, owner, customer_name="Гама Трейд ООД", day_of_month=1,
                         items=[{"name": "Абонамент", "quantity": 1, "unit_price": 100, "vat_rate": 20}])
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    assert client.get("/api/recurring-invoices", headers=cashier).status_code == 403
    assert client.post(f"/api/recurring-invoices/{template['id']}/issue", headers=cashier).status_code == 403
    assert "recurring_invoices" not in {s["key"] for s in client.get("/api/proactive/signals", headers=cashier).json()["signals"]}
    _, _, stranger = _company()
    assert client.post(f"/api/recurring-invoices/{template['id']}/issue", headers=stranger).status_code == 404
    assert client.post("/api/recurring-invoices", headers=owner, json={"items": [{"name": "x", "unit_price": 1}]}).status_code == 400

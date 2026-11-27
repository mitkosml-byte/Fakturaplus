"""Customers (Д5): what an invoice names (EIK, VAT number, address) is kept
with the customer, remembered from the documents themselves, one customer
per EIK, and one card with what they were invoiced and owe."""
import asyncio

import server
from tests.test_whole_program_fixes import _company


def _issue(client, owner, **fields):
    body = {
        "doc_type": "invoice", "customer_name": "Гама Трейд ООД", "customer_eik": "131071587",
        "customer_address": "гр. Варна, ул. Морска 1", "issue_date": "2026-10-10", "payment_method": "bank_transfer",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 100, "vat_rate": 20}], **fields,
    }
    r = client.post("/api/billing-documents", headers=owner, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_d5_a_customer_is_remembered_from_the_invoice_and_picked_next_time(client):
    _, _, owner = _company()
    first = _issue(client, owner)
    [customer] = client.get("/api/customers", headers=owner).json()
    assert first["customer_id"] == customer["id"]
    assert (customer["name"], customer["eik"], customer["address"]) == ("Гама Трейд ООД", "131071587", "гр. Варна, ул. Морска 1")

    # The same EIK under another spelling is the same customer; a bill by name too.
    again = _issue(client, owner, customer_name="ГАМА ТРЕЙД", customer_address=None)
    assert again["customer_id"] == customer["id"]
    bill = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "bill", "customer_name": "гама трейд ООД", "items": [{"name": "Обяд", "quantity": 1, "unit_price": 20}],
    }).json()
    assert bill["customer_id"] == customer["id"]
    # Same name, another EIK: another business.
    other = _issue(client, owner, customer_eik="200000001")
    assert other["customer_id"] != customer["id"]
    assert len(client.get("/api/customers", headers=owner).json()) == 2

    # Picked from the list: tied to it, and what it lacked is filled in.
    plain = client.post("/api/customers", headers=owner, json={"name": "Делта ЕТ"}).json()
    picked = _issue(client, owner, customer_id=plain["id"], customer_name="Делта ЕТ", customer_eik="121212121")
    assert picked["customer_id"] == plain["id"]
    refreshed = next(c for c in client.get("/api/customers", headers=owner).json() if c["id"] == plain["id"])
    assert refreshed["eik"] == "121212121"


def test_d5_one_customer_per_eik(client):
    _, _, owner = _company()
    first = client.post("/api/customers", headers=owner, json={"name": "Омега АД", "eik": "BG131071587", "email": "a@b.bg"})
    assert first.status_code == 200 and first.json()["eik"] == "BG131071587"
    dup = client.post("/api/customers", headers=owner, json={"name": "Омега", "eik": "131071587"})
    assert dup.status_code == 409 and "Омега АД" in dup.json()["detail"]
    second = client.post("/api/customers", headers=owner, json={"name": "Сигма ООД"}).json()
    assert client.put(f"/api/customers/{second['id']}", headers=owner, json={"eik": "131071587"}).status_code == 409
    cleared = client.put(f"/api/customers/{first.json()['id']}", headers=owner, json={"email": "  "}).json()
    assert cleared["email"] is None and cleared["name"] == "Омега АД"


def test_d5_the_customer_card_shows_invoiced_owed_and_overdue(client):
    _, _, owner = _company()
    paid_at_issue = _issue(client, owner, payment_method="card", in_till=False, issue_date="2026-09-01")
    owed = _issue(client, owner, issue_date="2026-10-01", due_date="2026-10-15")
    cancelled = _issue(client, owner, issue_date="2026-10-02")
    _issue(client, owner, issue_date="2026-10-03")   # the last: deleting the one before cancels it
    assert client.delete(f"/api/billing-documents/{cancelled['id']}", headers=owner).json()["cancelled"] is True
    debt = client.post("/api/receivables", headers=owner, json={"customer_name": "гама трейд оод", "amount": 50, "due_date": "2099-01-01"}).json()
    customer_id = paid_at_issue["customer_id"]
    assert debt["customer_id"] == customer_id

    card = client.get(f"/api/customers/{customer_id}/card", headers=owner).json()
    totals = card["totals"]
    assert totals["invoice_count"] == 3 and totals["invoiced"] == 360
    assert totals["last_invoice_date"] == "2026-10-03"
    # Two invoices by bank (both past their due dates) and the debt (not yet due).
    assert totals["owed"] == 290 and totals["overdue"] == 240
    assert [d["issue_date"] for d in card["documents"]][:2] == ["2026-10-03", "2026-10-02"]
    assert any(r["overdue"] for r in card["open_receivables"]) and len(card["open_receivables"]) == 3
    assert owed["receivable_id"] in {r["id"] for r in card["open_receivables"]}

    # Deleted, the customer's documents stay under the name issued to.
    assert client.delete(f"/api/customers/{customer_id}", headers=owner).status_code == 200
    kept = asyncio.run(server.db.billing_documents.find_one({"id": owed["id"]}, {"_id": 0}))
    assert kept["customer_id"] is None and kept["customer_name"] == "Гама Трейд ООД"


def test_e1_issuing_invoices_is_its_own_right_and_only_the_owner_or_manager_cancels(client):
    from tests.test_whole_program_fixes import _user
    company_id, _, owner = _company()
    cashier_id, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    clerk_id, clerk = _user(company_id, "staff", ["issue_invoices"], "Фактуриста")
    invoice = {
        "doc_type": "invoice", "customer_name": "Клиент ООД", "payment_method": "bank_transfer",
        "items": [{"name": "Услуга", "quantity": 1, "unit_price": 100}],
    }
    # Entering revenue no longer issues invoices; bills still go with it.
    assert client.post("/api/billing-documents", headers=cashier, json=invoice).status_code == 403
    bill = {"doc_type": "bill", "customer_name": "Клиент ООД", "items": [{"name": "Обяд", "quantity": 1, "unit_price": 20}]}
    assert client.post("/api/billing-documents", headers=cashier, json=bill).status_code == 200

    issued = client.post("/api/billing-documents", headers=clerk, json=invoice)
    assert issued.status_code == 200, issued.text
    assert client.get("/api/billing-documents", headers=clerk).status_code == 200
    assert client.get("/api/customers", headers=clerk).status_code == 200
    # Cancelling (or deleting) an issued invoice: owner or manager only.
    refused = client.delete(f"/api/billing-documents/{issued.json()['id']}", headers=clerk)
    assert refused.status_code == 403
    external = client.post("/api/billing-documents", headers=clerk, json={**invoice, "external": True, "invoice_number": "900"}).json()
    assert client.delete(f"/api/billing-documents/{external['id']}", headers=clerk).status_code == 200
    assert client.delete(f"/api/billing-documents/{issued.json()['id']}", headers=owner).status_code == 200

    # Someone who issued invoices before the right existed keeps it.
    asyncio.run(server.db.users.update_one({"user_id": cashier_id}, {"$set": {"permissions_schema_version": 6}}))
    assert client.post("/api/billing-documents", headers=cashier, json=invoice).status_code == 200


def test_e2_a_payroll_is_worked_out_with_the_rates_of_its_own_month(client, monkeypatch):
    from datetime import date
    company_id, _, owner = _company()
    employee = client.post("/api/employees", headers=owner, json={"name": "Иван", "base_salary": 500}).json()

    def preview(year, month):
        r = client.post("/api/payroll/preview", headers=owner, json={
            "employee_id": employee["id"], "period_year": year, "period_month": month, "gross_amount": 500,
        })
        assert r.status_code == 200, r.text
        return r.json()

    before = preview(2026, 12)
    # From January the minimum insurance income is higher: December keeps its own.
    saved = client.put("/api/payroll/rates", headers=owner, json={"effective_from": "2027-01", "min_insurance_income": 620})
    assert saved.status_code == 200, saved.text
    assert [v["effective_from"] for v in saved.json()["versions"]] == ["2000-01", "2027-01"]
    assert preview(2026, 12) == before
    january = preview(2027, 1)
    assert january["employee_contributions"] > before["employee_contributions"]
    in_december = client.get("/api/payroll/rates?year=2026&month=12", headers=owner).json()
    assert in_december["min_insurance_income"] == 550.71 and in_december["effective_from"] == "2000-01"
    in_january = client.get("/api/payroll/rates?year=2027&month=3", headers=owner).json()
    assert in_january["min_insurance_income"] == 620 and in_january["effective_from"] == "2027-01"
    assert client.put("/api/payroll/rates", headers=owner, json={"effective_from": "2027-13"}).status_code == 400

    # A version entered by mistake goes; the last one never does.
    assert client.delete("/api/payroll/rates/2027-01", headers=owner).status_code == 200
    assert preview(2027, 1) == preview(2026, 12)
    assert client.delete("/api/payroll/rates/2000-01", headers=owner).status_code == 400

    # In the first months of a year, until its rates are saved, it asks once.
    monkeypatch.setattr(server, "today_local", lambda: date(2027, 1, 12))
    keys = lambda: [s["key"] for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]]
    assert "payroll_rates_year" in keys()
    client.put("/api/payroll/rates", headers=owner, json={"effective_from": "2027-01", "min_insurance_income": 620})
    assert "payroll_rates_year" not in keys()


def test_c3_to_c6_chart_cents_payment_split_and_supplier_detail(client):
    company_id, _, owner = _company()
    october = "start_date=2026-10-01&end_date=2026-10-31"
    employee = client.post("/api/employees", headers=owner, json={"name": "Мария", "base_salary": 1100}).json()
    assert client.post("/api/payroll", headers=owner, json={
        "employee_id": employee["id"], "period_year": 2026, "period_month": 10, "gross_amount": 1100,
    }).status_code == 200
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-10-05", "fiscal_revenue": 1000.01, "card_revenue": 300, "pocket_money": 50})
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-10-06", "fiscal_revenue": 999.99})
    _issue(client, owner, payment_method="cash", issue_date="2026-10-07")   # rung up at the till: this business keeps one
    _issue(client, owner, payment_method="bank_transfer", issue_date="2026-10-08")

    def doc(number, total, kind="invoice"):
        return {"supplier": "Метро ЕООД", "supplier_eik": "BG131071587", "invoice_number": number, "document_type": kind,
                "date": "2026-10-09", "amount_without_vat": round(total / 1.2, 2), "vat_amount": round(total - total / 1.2, 2),
                "total_amount": total, "payment_method": "cash"}
    for number, total in (("1", 120), ("2", 240)):
        assert client.post("/api/invoices", headers=owner, json=doc(number, total)).status_code == 200
    asset = client.post("/api/invoices", headers=owner, json=doc("3", 6000)).json()
    asyncio.run(server.db.invoices.update_one({"id": asset["id"]}, {"$set": {"asset_id": "asset-1"}}))
    assert client.post("/api/invoices", headers=owner, json=doc("CN-1", 24, "credit_note")).status_code == 200

    summary = client.get(f"/api/statistics/summary?{october}", headers=owner).json()
    chart = client.get(f"/api/statistics/chart-data?{october}", headers=owner).json()
    assert len(chart) == 31
    # Ч3: the bars add up to the summary, to the cent.
    assert round(sum(p["expense"] for p in chart), 2) == summary["total_expense"]
    assert round(sum(p["income"] for p in chart), 2) == summary["total_income"]
    # Ч4: cash + card + bank is the takings as rung up, with VAT - the till,
    # the pocket money and the invoices issued (the cash one is at the till
    # here); the income beside it is without VAT (P1-1).
    split = summary["total_cash_revenue"] + summary["total_card_revenue"] + summary["total_bank_revenue"]
    takings = summary["total_fiscal_revenue"] + summary["total_pocket_money"] + summary["total_issued_invoices"]
    assert round(split, 2) == round(takings, 2) and summary["total_bank_revenue"] == 120
    assert summary["vat_excluded"] is True and summary["total_income"] < takings

    # Ч5: a credit note is no invoice of a delivery; Ч6: the asset is said.
    detail = client.get(f"/api/statistics/supplier/Метро ЕООД/detailed?{october}", headers=owner).json()
    overview = detail["overview"]
    assert (overview["invoice_count"], overview["credit_note_count"], overview["credit_note_total"]) == (3, 1, 24)
    assert overview["assets_total"] == 6000
    assert {i["document_type"] for i in detail["recent_invoices"]} == {"invoice", "credit_note"}
    assert any(i["is_asset"] for i in detail["recent_invoices"])
    suppliers = client.get(f"/api/statistics/suppliers?{october}", headers=owner).json()
    assert suppliers["totals"]["assets_total"] == 6000

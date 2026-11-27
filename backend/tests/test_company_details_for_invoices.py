"""No invoice goes out with the "AUTO…" stand-in a business gets at sign-up
(P0-6): before the first invoice or credit note the business gives its real
ЕИК and address; an invoice issued in another program is only recorded, and
bills and quotes are not tax documents.

Invented business, customer and numbers."""
import asyncio

import server
from tests.test_whole_program_fixes import _company

INVOICE = {
    "doc_type": "invoice", "customer_name": "Клиент Проба ООД", "customer_eik": "131071587",
    "customer_address": "гр. Проба", "issue_date": "2026-11-10", "payment_method": "bank_transfer",
    "items": [{"name": "Услуга", "quantity": 1, "unit_price": 100, "vat_rate": 20}],
}


def _new_business():
    """A business as sign-up leaves it: a stand-in ЕИК and no address."""
    company_id, _, owner = _company()
    asyncio.run(server.db.companies.update_one(
        {"id": company_id}, {"$set": {"eik": "AUTO1A2B3C4D5"}, "$unset": {"address": ""}},
    ))
    return company_id, owner


def test_the_first_invoice_waits_for_the_business_details(client):
    company_id, owner = _new_business()
    defaults = client.get("/api/billing-documents/invoice-defaults", headers=owner).json()
    assert defaults["missing_company_details"] == ["eik", "address"]

    refused = client.post("/api/billing-documents", headers=owner, json=INVOICE)
    assert refused.status_code == 409
    detail = refused.json()["detail"]
    assert detail["code"] == "company_details_missing" and detail["missing"] == ["eik", "address"]
    assert "ЕИК и адрес" in detail["message"]
    assert client.get("/api/billing-documents", headers=owner).json() == []   # no number was taken

    asyncio.run(server.db.companies.update_one(
        {"id": company_id}, {"$set": {"eik": "200000002", "address": "гр. Проба, ул. Тестова 1"}},
    ))
    assert client.get("/api/billing-documents/invoice-defaults", headers=owner).json()["missing_company_details"] == []
    issued = client.post("/api/billing-documents", headers=owner, json=INVOICE)
    assert issued.status_code == 200 and issued.json()["invoice_number"] == "0000000001"


def test_recorded_invoices_bills_and_quotes_do_not_wait(client):
    _, owner = _new_business()
    external = client.post("/api/billing-documents", headers=owner, json={**INVOICE, "external": True, "invoice_number": "0000000777"})
    assert external.status_code == 200, external.text
    bill = client.post("/api/billing-documents", headers=owner, json={**INVOICE, "doc_type": "bill"})
    assert bill.status_code == 200, bill.text


def test_a_credit_note_waits_too(client):
    company_id, _, owner = _company()
    invoice = client.post("/api/billing-documents", headers=owner, json=INVOICE).json()
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"eik": "AUTO9Z"}}))
    note = client.post("/api/billing-documents", headers=owner, json={
        "doc_type": "credit_note", "credited_document_id": invoice["id"], "customer_name": invoice["customer_name"],
        "issue_date": "2026-11-20", "notes": "Отстъпка", "items": [{"name": "Отстъпка", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
    })
    assert note.status_code == 409 and note.json()["detail"]["missing"] == ["eik"]


def test_the_pdf_never_prints_the_stand_in(monkeypatch):
    from services import export_service
    printed = []
    real = export_service.Paragraph

    def paragraph(text, *args, **kwargs):
        printed.append(str(text))
        return real(text, *args, **kwargs)

    monkeypatch.setattr(export_service, "Paragraph", paragraph)
    document = {"doc_type": "invoice", "invoice_number": "0000000001", "issue_date": "2026-11-10", "customer_name": "Клиент",
                "items": [], "vat_by_rate": [], "total_amount": 0}
    assert server.ExportService.generate_issued_invoice_pdf(document, {"name": "Проба ООД", "eik": "AUTO1A2B3C4D5"}).startswith(b"%PDF")
    assert printed and not any("AUTO1A2B3C4D5" in text for text in printed)
    printed.clear()
    server.ExportService.generate_issued_invoice_pdf(document, {"name": "Проба ООД", "eik": "200000002"})
    assert any("ЕИК: 200000002" in text for text in printed)

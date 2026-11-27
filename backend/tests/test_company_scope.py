"""A company sees only its own records, also where a query adds its own
"either-or" condition: the company scope is itself an $or, and a second
$or merged into the same filter replaced it - a search listed every
company's invoices, and a customer's card took in other companies'
documents and debts by the same customer name."""
import asyncio

import server
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company


def test_invoice_search_lists_only_the_companys_own_invoices(client):
    _, _, owner = _company()
    _, _, other = _company()
    base = {"date": "2026-11-03", "amount_without_vat": 10, "vat_amount": 2, "total_amount": 12, "payment_method": "card"}
    assert client.post("/api/invoices", headers=other, json={**base, "supplier": "Зърно Трейд", "invoice_number": "Z-1"}).status_code == 200
    mine = client.post("/api/invoices", headers=owner, json={**base, "supplier": "Зърно Трейд", "invoice_number": "Z-2"}).json()

    found = client.get("/api/invoices?search=зърно", headers=owner).json()
    assert [i["id"] for i in found] == [mine["id"]]
    by_number = client.get("/api/invoices?search=Z-1", headers=owner).json()
    assert by_number == []


def test_a_customer_card_holds_only_the_companys_own_documents(client):
    _, _, owner = _company()
    other_company, other_owner_id, _ = _company()
    mine = _issue(client, owner, customer_eik=None, customer_name="Ресторант Лале", due_date="2099-12-31")
    # Another company's debt by the same customer name, tied to no customer.
    asyncio.run(server.db.receivables.insert_one(server.Receivable(
        user_id=other_owner_id, company_id=other_company, customer_name="Ресторант Лале", amount=999,
    ).model_dump()))

    card = client.get(f"/api/customers/{mine['customer_id']}/card", headers=owner).json()
    assert card["totals"]["owed"] == 120
    assert [r["amount"] for r in card["open_receivables"]] == [120]

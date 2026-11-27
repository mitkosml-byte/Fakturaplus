"""An issued invoice says where its money stands, and its receivable is the
invoice's (Д6): paid / partly paid / owed / overdue on the invoice itself;
the amount and customer of its receivable cannot drift from the invoice,
and it goes only with the invoice - cancelled after money came in, nothing
is owed any more and what was paid is to give back."""
from tests.test_customers import _issue
from tests.test_whole_program_fixes import _company


def _doc(client, owner, doc_id):
    return next(d for d in client.get("/api/billing-documents", headers=owner).json() if d["id"] == doc_id)


def test_d6_the_invoice_says_where_its_money_stands(client):
    _, _, owner = _company()
    owed = _issue(client, owner, issue_date="2026-11-10", due_date="2099-12-31")
    doc = _doc(client, owner, owed["id"])
    assert (doc["payment_status"], doc["amount_left"], doc["paid_amount"]) == ("owed", 120, 0)

    pay = client.post(f"/api/receivables/{owed['receivable_id']}/payments", headers=owner,
                      json={"amount": 20, "date": "2026-11-12", "method": "bank_transfer"})
    assert pay.status_code == 200 and pay.json()["left_amount"] == 100
    doc = _doc(client, owner, owed["id"])
    assert (doc["payment_status"], doc["amount_left"], doc["paid_amount"]) == ("partly_paid", 100, 20)

    client.post(f"/api/receivables/{owed['receivable_id']}/payments", headers=owner,
                json={"amount": 100, "date": "2026-11-13", "method": "bank_transfer"})
    assert _doc(client, owner, owed["id"])["payment_status"] == "paid"

    late = _issue(client, owner, issue_date="2026-10-01", due_date="2026-10-15")
    assert _doc(client, owner, late["id"])["payment_status"] == "overdue"
    at_issue = _issue(client, owner, payment_method="card", in_till=False)
    assert _doc(client, owner, at_issue["id"])["payment_status"] == "paid"


def test_d6_the_receivable_of_an_invoice_is_the_invoice(client):
    _, _, owner = _company()
    invoice = _issue(client, owner, due_date="2099-12-31")
    receivable_id = invoice["receivable_id"]

    changed = client.put(f"/api/receivables/{receivable_id}", headers=owner, json={"amount": 90})
    assert changed.status_code == 400 and invoice["invoice_number"] in changed.json()["detail"]
    renamed = client.put(f"/api/receivables/{receivable_id}", headers=owner, json={"customer_name": "Друг"})
    assert renamed.status_code == 400
    # The edit form sends the same amount and customer back - a new due date is fine.
    same = client.put(f"/api/receivables/{receivable_id}", headers=owner, json={
        "customer_name": invoice["customer_name"], "amount": 120, "due_date": "2099-11-30", "description": "Уговорено",
    })
    assert same.status_code == 200 and same.json()["due_date"] == "2099-11-30" and same.json()["amount"] == 120
    gone = client.delete(f"/api/receivables/{receivable_id}", headers=owner)
    assert gone.status_code == 400 and "анулиране" in gone.json()["detail"]

    # One typed by hand is the person's own to change or delete.
    own = client.post("/api/receivables", headers=owner, json={"customer_name": "Иван", "amount": 50}).json()
    assert client.put(f"/api/receivables/{own['id']}", headers=owner, json={"amount": 40}).json()["amount"] == 40
    assert client.delete(f"/api/receivables/{own['id']}", headers=owner).status_code == 200


def test_d6_cancelled_after_a_payment_nothing_is_owed_and_the_payment_is_to_give_back(client):
    _, _, owner = _company()
    first = _issue(client, owner, due_date="2099-12-31")
    _issue(client, owner, due_date="2099-12-31")   # the last one: the first is cancelled, not deleted
    client.post(f"/api/receivables/{first['receivable_id']}/payments", headers=owner,
                json={"amount": 50, "date": "2026-11-12", "method": "cash"})
    before = client.get("/api/receivables/summary", headers=owner).json()
    assert before["total_owed"] == 70 + 120

    result = client.delete(f"/api/billing-documents/{first['id']}", headers=owner).json()
    assert result["cancelled"] is True and result["receivable"] == "kept" and result["refund_due"] == 50
    after = client.get("/api/receivables/summary", headers=owner).json()
    assert after["total_owed"] == 120 and after["unpaid_count"] == 1
    kept = next(r for r in client.get("/api/receivables", headers=owner).json() if r["id"] == first["receivable_id"])
    assert kept["cancelled"] is True and kept["left_amount"] == 0 and kept["refund_due"] == 50
    assert _doc(client, owner, first["id"]).get("payment_status") is None   # a cancelled invoice: no status
    card = client.get(f"/api/customers/{first['customer_id']}/card", headers=owner).json()
    assert card["totals"]["to_refund"] == 50 and card["totals"]["owed"] == 120

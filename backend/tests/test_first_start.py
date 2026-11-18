"""The first start (Л5): one question sets what the business uses and its
VAT; Home's "Започни оттук" ticks off the first steps from what the
business has entered. All data here is made up."""
import asyncio

import server
from tests.test_whole_program_fixes import _company


def test_getting_started_ticks_off_what_was_entered(client):
    _, _, owner = _company()
    status = client.get("/api/company/getting-started", headers=owner).json()
    assert status == {"revenue": False, "invoice": False, "expense": False, "issued": False}

    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-11-10", "fiscal_revenue": 250})
    client.post("/api/expenses", headers=owner, json={"description": "Наем", "amount": 300, "date": "2026-11-10"})
    status = client.get("/api/company/getting-started", headers=owner).json()
    assert status == {"revenue": True, "invoice": False, "expense": True, "issued": False}

    client.post("/api/invoices", headers=owner, json={
        "supplier": "Доставчик Проба ЕООД", "invoice_number": "0000000123", "date": "2026-11-10",
        "amount_without_vat": 100, "vat_amount": 20, "total_amount": 120,
    })
    assert client.get("/api/company/getting-started", headers=owner).json()["invoice"] is True

    # Another business's data never ticks anything here.
    _, _, stranger = _company()
    assert client.get("/api/company/getting-started", headers=stranger).json() == {
        "revenue": False, "invoice": False, "expense": False, "issued": False,
    }


def test_the_one_question_sets_the_parts_and_the_vat(client):
    company_id, _, owner = _company()
    # A company made at registration always has an EIK (made up here).
    asyncio.run(server.db.companies.update_one({"id": company_id}, {"$set": {"eik": "AUTO123456789"}}))
    signals = {s["key"] for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}
    assert "vat_registration" in signals   # not answered yet: asked

    saved = client.put("/api/company/modules", headers=owner, json={"modules": {
        "till": True, "billing": False, "team": False, "payroll": False, "assets": False, "wallet": False,
    }})
    assert saved.status_code == 200, saved.text
    assert client.put("/api/company", headers=owner, json={"vat_registered": False}).status_code == 200

    modules = client.get("/api/company/modules", headers=owner).json()["modules"]
    assert modules["till"] is True and modules["billing"] is False and modules["team"] is False
    signals = {s["key"] for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}
    assert "vat_registration" not in signals   # answered: never asked again

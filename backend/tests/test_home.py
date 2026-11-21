"""Home in one request (Л14): each part is what its own endpoint answers,
and a part the viewer may not see is null. All data here is made up."""
from tests.test_whole_program_fixes import _company, _user


def test_home_is_the_same_as_its_parts(client):
    company_id, _, owner = _company()
    client.post("/api/daily-revenue", headers=owner, json={"date": "2026-11-10", "fiscal_revenue": 250})
    period = "start_date=2026-11-01&end_date=2026-11-30"

    home = client.get(f"/api/home?{period}&with_billing=true", headers=owner)
    assert home.status_code == 200, home.text
    home = home.json()
    assert home["summary"] == client.get(f"/api/statistics/summary?{period}", headers=owner).json()
    assert home["getting_started"] == client.get("/api/company/getting-started", headers=owner).json()
    assert home["billing_overview"] == client.get(f"/api/billing-documents/overview?{period}", headers=owner).json()
    assert home["scan_credits"] == client.get("/api/scan-credits", headers=owner).json()
    signals = client.get("/api/proactive/signals", headers=owner).json()["signals"]
    assert [s["key"] for s in home["signals"]] == [s["key"] for s in signals]

    # The invoicing card only where Home shows it.
    assert client.get(f"/api/home?{period}", headers=owner).json()["billing_overview"] is None


def test_what_a_viewer_may_not_see_is_null(client):
    company_id, _, _ = _company()
    _, helper = _user(company_id, "staff", [], "Помощник")
    home = client.get("/api/home?with_billing=true", headers=helper)
    assert home.status_code == 200, home.text
    body = home.json()
    assert body["scan_credits"] is None          # no manage_invoices
    assert body["billing_overview"] is None      # neither enters revenue nor issues invoices

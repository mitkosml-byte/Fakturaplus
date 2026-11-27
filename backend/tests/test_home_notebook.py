"""The personal notebook on Home: its month comes in Home's one request,
for whoever may see the notebook - and for no one else.

Invented people and numbers."""
import asyncio

import server
from tests.test_whole_program_fixes import _company, _user


def test_home_brings_the_notebooks_month_only_to_who_may_see_it(client):
    company_id, owner_id, owner = _company()
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Ивана Касиерова")
    today = server.today_local().isoformat()
    asyncio.run(server.db.personal_wallet_entries.insert_one({
        "id": f"pw-{company_id}", "company_id": company_id, "user_id": owner_id, "category": "daily",
        "description": "Лични покупки", "amount": 150.0, "date": today, "is_recurring": False,
    }))

    mine = client.get("/api/home", headers=owner).json()["personal_wallet"]
    assert mine["total_spent"] == 150.0 and mine["status"] in ("ok", "warning", "danger")
    # The same month as the notebook's own screen.
    assert mine == client.get("/api/personal-wallet/summary", headers=owner).json()

    # A cashier: no notebook in Home at all - and the rest of Home still comes.
    theirs = client.get("/api/home", headers=cashier).json()
    assert theirs["personal_wallet"] is None and "day_card" in theirs

"""Daily revenue by VAT group (Ч7): a day with sales at 20%, 9% and 0% is
entered as the till's daily report gives it, and every VAT figure - the
summary, the chart, the sales ledger - counts each part at its own rate."""
import asyncio
import io

import openpyxl  # type: ignore[import-untyped]

import server
from services import import_service
from tests.test_whole_program_fixes import _company

DAY = "2026-10-15"
PERIOD = "start_date=2026-10-01&end_date=2026-10-31"
SPLIT = [{"rate_percent": 20, "amount": 120}, {"rate_percent": 9, "amount": 109}, {"rate_percent": 0, "amount": 50}]


def _day(client, owner, day=DAY):
    return client.get(f"/api/daily-revenue/by-date/{day}", headers=owner).json()


def test_c7_a_day_by_vat_group_counts_each_rate_on_its_own(client):
    company_id, _, owner = _company()
    saved = client.post("/api/daily-revenue", headers=owner, json={"date": DAY, "vat_groups": SPLIT, "card_revenue": 100})
    assert saved.status_code == 200, saved.text
    body = saved.json()
    # The till total is the sum of its groups; the day's rate is that of most of it.
    assert body["fiscal_revenue"] == 279 and body["vat_rate_percent"] == 20
    assert [(g["rate_percent"], g["amount"]) for g in body["vat_groups"]] == [(20, 120), (9, 109), (0, 50)]
    assert _day(client, owner)["vat_groups"] == body["vat_groups"]

    # 20 € inside the 120 at 20%, 9 € inside the 109 at 9%, none in the 50 at 0%.
    summary = client.get(f"/api/statistics/summary?{PERIOD}", headers=owner).json()
    assert summary["fiscal_vat"] == 29.0
    chart = client.get(f"/api/statistics/chart-data?{PERIOD}", headers=owner).json()
    points = chart["data"] if isinstance(chart, dict) else chart
    assert next(p for p in points if p["date"] == DAY)["vat"] == 29.0

    # The sales ledger: the day's base and VAT in the column of each rate.
    sales = asyncio.run(server.db.daily_revenue.find({"company_id": company_id, "date": DAY}, {"_id": 0}).to_list(None))
    data =server.ExportService.generate_vat_ledger_excel(purchases=[], sales=sales, issued_invoices=[])
    sheet = openpyxl.load_workbook(io.BytesIO(data))["Дневник продажби"]
    [row] = [[c.value for c in r] for r in sheet.iter_rows() if isinstance(r[0].value, int)]
    assert row[6:11] == [100, 20, 100, 9, 50] and row[-1] == 279


def test_c7_the_groups_and_the_total_cannot_disagree(client):
    _, _, owner = _company()
    wrong = client.post("/api/daily-revenue", headers=owner, json={"date": DAY, "fiscal_revenue": 300, "vat_groups": SPLIT})
    assert wrong.status_code == 400 and "279,00" in wrong.json()["detail"]
    assert client.post("/api/daily-revenue", headers=owner, json={"date": DAY, "fiscal_revenue": 279, "vat_groups": SPLIT}).status_code == 200

    # A new total with no rate, on a day split by rate: refused - which
    # rate's sales changed only the person knows.
    other_total = client.post("/api/daily-revenue", headers=owner, json={"date": DAY, "fiscal_revenue": 400})
    assert other_total.status_code == 400 and "по ставки" in other_total.json()["detail"]
    # The same total (a save that only changes the card part) keeps the split.
    same = client.post("/api/daily-revenue", headers=owner, json={"date": DAY, "fiscal_revenue": 279, "card_revenue": 50})
    assert same.status_code == 200 and len(same.json()["vat_groups"]) == 3
    # Pocket money added to the day leaves the split as it is.
    client.post("/api/daily-revenue/add-pocket", headers=owner, json={"date": DAY, "amount": 30})
    assert len(_day(client, owner)["vat_groups"]) == 3

    # One rate for the whole day: the split is gone.
    single = client.post("/api/daily-revenue", headers=owner, json={"date": DAY, "fiscal_revenue": 400, "vat_rate_percent": 9})
    assert single.status_code == 200 and single.json()["vat_groups"] == [] and single.json()["vat_rate_percent"] == 9
    summary = client.get(f"/api/statistics/summary?{PERIOD}", headers=owner).json()
    assert summary["fiscal_vat"] == round(400 * 9 / 109, 2)


def test_c7_groups_of_one_rate_are_one_rate(client):
    _, _, owner = _company()
    # Two groups of the report at 20% (as a till may show them) and nothing at 9%.
    saved = client.post("/api/daily-revenue", headers=owner, json={"date": DAY, "vat_groups": [
        {"rate_percent": 20, "amount": 100}, {"rate_percent": 20, "amount": 140}, {"rate_percent": 9, "amount": 0},
    ]}).json()
    assert saved["fiscal_revenue"] == 240 and saved["vat_groups"] == [] and saved["vat_rate_percent"] == 20


def test_c7_import_by_rate_and_the_template_imports_back(client):
    _, _, owner = _company()
    # The downloaded template, filled in and uploaded as it is: its title
    # and notes stand above the column names and its sample row is left in.
    book = openpyxl.load_workbook(io.BytesIO(import_service.build_template("daily_revenue")))
    sheet = book.active
    headers = [c.value for c in sheet[4]]
    sheet.cell(row=6, column=1, value="14.10.2026")
    sheet.cell(row=6, column=2, value="300")
    sheet.cell(row=8, column=1, value="15.10.2026")
    sheet.cell(row=8, column=headers.index("Оборот 20%") + 1, value="120")
    sheet.cell(row=8, column=headers.index("Оборот 9%") + 1, value="109")
    sheet.cell(row=9, column=1, value="16.10.2026")
    sheet.cell(row=9, column=2, value="100")
    sheet.cell(row=9, column=headers.index("Оборот 20%") + 1, value="60")
    buffer = io.BytesIO()
    book.save(buffer)

    preview = client.post("/api/import/daily_revenue/preview", headers=owner,
                          files={"file": ("oborot.xlsx", buffer.getvalue(),
                                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}).json()
    rows = {r["row_number"]: r for r in preview["rows"]}
    assert set(rows) == {6, 8, 9}   # each row by its own number in the file; the sample row is not data
    assert rows[6]["status"] == "ok" and rows[8]["status"] == "ok"
    assert rows[9]["status"] == "error" and "сборът" in rows[9]["errors"][0]

    commit = client.post("/api/import/daily_revenue/commit", headers=owner,
                         json={"rows": [rows[6]["data"], rows[8]["data"]]}).json()
    assert commit["imported"] == 2 and not commit["failed"]
    assert _day(client, owner, "2026-10-14")["fiscal_revenue"] == 300
    split = _day(client, owner)
    assert split["fiscal_revenue"] == 229 and len(split["vat_groups"]) == 2

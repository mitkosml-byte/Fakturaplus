"""The pocket money is called „Бакшиш“ (in English: tips) now, as the owner
asked. The Excel template names its column so; a file made before the
rename, with its "Джобче" column, still imports; the server's sentence
about hidden totals says the new word.

Invented numbers."""
import io

import openpyxl  # type: ignore[import-untyped]

import server
from services import import_service
from tests.test_whole_program_fixes import _company


def _preview(client, owner, book):
    buffer = io.BytesIO()
    book.save(buffer)
    reply = client.post("/api/import/daily_revenue/preview", headers=owner,
                        files={"file": ("oborot.xlsx", buffer.getvalue(),
                                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert reply.status_code == 200, reply.text
    return reply.json()


def _template():
    return openpyxl.load_workbook(io.BytesIO(import_service.build_template("daily_revenue")))


def test_the_template_names_the_column_tips():
    headers = [c.value for c in _template().active[4]]
    assert "Бакшиш" in headers and "Джобче" not in headers


def test_a_file_with_the_tips_column_imports_them(client):
    _, _, owner = _company()
    book = _template()
    sheet = book.active
    headers = [c.value for c in sheet[4]]
    sheet.cell(row=6, column=1, value="14.10.2026")
    sheet.cell(row=6, column=2, value="300")
    sheet.cell(row=6, column=headers.index("Бакшиш") + 1, value="45")
    row = next(r for r in _preview(client, owner, book)["rows"] if r["row_number"] == 6)
    assert row["status"] == "ok" and row["data"]["pocket_money"] == 45


def test_a_file_from_before_the_rename_still_imports_its_tips(client):
    _, _, owner = _company()
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.append(["Дата*", "Фискализиран оборот*", "Джобче"])
    sheet.append(["15.10.2026", "200", "30"])
    rows = [r for r in _preview(client, owner, book)["rows"] if r["status"] == "ok"]
    assert len(rows) == 1 and rows[0]["data"]["pocket_money"] == 30


def test_hidden_totals_say_the_new_word():
    note = server.restricted_data_note({
        "statistics": True, "pocket_money": False, "off_book_expenses": True, "payroll": True, "profit": True,
    })
    assert note is not None and "без бакшиша" in note and "джобч" not in note

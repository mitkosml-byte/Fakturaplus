"""Sick leave in "Празници и отпуски": the sheet as the employer gets it
(its number, the reason, first sheet or a continuation) beside the days,
correctable later, never touching paid leave, and in the accountant's
Excel on a sheet of its own. Nothing about health is kept. All data here
is made up."""
from io import BytesIO

from openpyxl import load_workbook  # type: ignore[import-untyped]

from services.business_calendar import today_local
from tests.test_whole_program_fixes import _company, _user


def _employee(client, owner, name="Петър Тестов"):
    response = client.post("/api/employees", headers=owner, json={"name": name, "base_salary": 1500, "hire_date": "2020-01-15"})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_a_sick_leave_keeps_its_sheet_and_paid_leave_none(client):
    _, _, owner = _company()
    employee_id = _employee(client, owner)

    sick = client.post("/api/employees/leave", headers=owner, json={
        "employee_id": employee_id, "leave_type": "sick", "start_date": "2026-10-05", "end_date": "2026-10-11",
        "sheet_number": "  Е2026   0001234 ", "sick_reason": "illness",
    })
    assert sick.status_code == 200, sick.text
    entry = sick.json()
    assert (entry["sheet_number"], entry["sick_reason"], entry["is_continuation"]) == ("Е2026 0001234", "illness", False)

    # A paid leave has no sheet, whatever is sent with it.
    paid = client.post("/api/employees/leave", headers=owner, json={
        "employee_id": employee_id, "leave_type": "paid", "start_date": "2026-08-03", "end_date": "2026-08-07",
        "sheet_number": "X1", "sick_reason": "illness", "is_continuation": True,
    }).json()
    assert (paid["sheet_number"], paid["sick_reason"], paid["is_continuation"]) == (None, None, False)

    # Sick days are no paid leave: only the August week is used.
    [row] = [b for b in client.get("/api/employees/leave-balance?year=2026", headers=owner).json() if b["employee_id"] == employee_id]
    assert row["used"] + row["planned"] == 5

    # Wrong days are refused.
    for start, end in (("2026-10-11", "2026-10-05"), ("2026-13-01", "2026-13-02"), ("утре", "утре")):
        refused = client.post("/api/employees/leave", headers=owner, json={
            "employee_id": employee_id, "leave_type": "sick", "start_date": start, "end_date": end,
        })
        assert refused.status_code == 400, (start, refused.text)
    # An unknown reason too.
    assert client.post("/api/employees/leave", headers=owner, json={
        "employee_id": employee_id, "leave_type": "sick", "start_date": "2026-10-05", "end_date": "2026-10-05",
        "sick_reason": "диагноза",
    }).status_code == 422


def test_a_leave_entry_is_corrected_and_only_by_whoever_keeps_absences(client):
    company_id, _, owner = _company()
    employee_id = _employee(client, owner)
    entry = client.post("/api/employees/leave", headers=owner, json={
        "employee_id": employee_id, "leave_type": "sick", "start_date": "2026-10-05", "end_date": "2026-10-09",
    }).json()
    assert (entry["sheet_number"], entry["sick_reason"]) == (None, None)
    url = f"/api/employees/leave/{entry['id']}"

    # The sheet arrives: its number and reason are added, a continuation
    # moves the last day on.
    fixed = client.put(url, headers=owner, json={"sheet_number": "Е2026 0005678", "sick_reason": "family_care", "end_date": "2026-10-16"})
    assert fixed.status_code == 200, fixed.text
    body = fixed.json()
    assert (body["sheet_number"], body["sick_reason"], body["start_date"], body["end_date"]) == ("Е2026 0005678", "family_care", "2026-10-05", "2026-10-16")
    [listed] = [e for e in client.get("/api/employees/leave?start_date=2026-10-01&end_date=2026-10-31", headers=owner).json() if e["id"] == entry["id"]]
    assert listed["end_date"] == "2026-10-16" and listed["sheet_number"] == "Е2026 0005678"

    # A number sent empty is cleared; what is not sent stays.
    cleared = client.put(url, headers=owner, json={"sheet_number": "", "is_continuation": True}).json()
    assert (cleared["sheet_number"], cleared["sick_reason"], cleared["is_continuation"]) == (None, "family_care", True)

    # Made a paid leave by mistake and back: the sheet goes with the kind.
    as_paid = client.put(url, headers=owner, json={"leave_type": "paid"}).json()
    assert (as_paid["leave_type"], as_paid["sick_reason"], as_paid["is_continuation"]) == ("paid", None, False)

    assert client.put(url, headers=owner, json={"end_date": "2026-10-01"}).status_code == 400
    assert client.put("/api/employees/leave/no-such-entry", headers=owner, json={"note": "x"}).status_code == 404

    # Someone without the absences right cannot; another business cannot see it.
    _, cashier = _user(company_id, "staff", ["add_revenue"], "Касиер")
    assert client.put(url, headers=cashier, json={"note": "x"}).status_code == 403
    _, _, stranger = _company()
    assert client.put(url, headers=stranger, json={"note": "x"}).status_code == 404


def test_the_accountants_excel_has_sick_leave_on_its_own_sheet(client):
    _, _, owner = _company()
    employee_id = _employee(client, owner)
    client.post("/api/employees/leave", headers=owner, json={
        "employee_id": employee_id, "leave_type": "paid", "start_date": "2026-10-12", "end_date": "2026-10-16",
    })
    client.post("/api/employees/leave", headers=owner, json={
        "employee_id": employee_id, "leave_type": "sick", "start_date": "2026-10-05", "end_date": "2026-10-11",
        "sheet_number": "Е2026 0001234", "sick_reason": "work_accident", "is_continuation": True,
    })
    response = client.get("/api/export/employee-compliance/excel?start_date=2026-10-01&end_date=2026-10-31", headers=owner)
    assert response.status_code == 200, response.text
    book = load_workbook(BytesIO(response.content))
    assert book.sheetnames == ["Работа на празници", "Отпуски", "Болнични"]

    leave = [[c.value for c in row] for row in book["Отпуски"].iter_rows(min_row=4)]
    assert leave[0][5:7] == ["Календарни дни", "Работни дни"]
    assert leave[1:] == [[1, "Петър Тестов", "Платена", "12.10.2026", "16.10.2026", 5, 5, None]]

    sick = [[c.value for c in row] for row in book["Болнични"].iter_rows(min_row=4)]
    assert sick[0] == ["№", "Служител", "№ на болничния лист", "Първичен / продължение", "Причина", "От дата", "До дата",
                       "Календарни дни", "Работни дни", "Бележка"]
    # A week: 7 calendar days, 5 of them working days.
    assert sick[1:] == [[1, "Петър Тестов", "Е2026 0001234", "Продължение", "Трудова злополука", "05.10.2026", "11.10.2026", 7, 5, None]]


def test_the_briefing_says_who_is_on_sick_leave_today(client):
    _, _, owner = _company()
    today = today_local().isoformat()
    sick_id = _employee(client, owner, "Иван Пробен")
    client.post("/api/employees/leave", headers=owner, json={
        "employee_id": sick_id, "leave_type": "sick", "start_date": today, "end_date": today,
    })
    signals = {s["key"]: s for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}
    assert signals["team_on_leave"]["detail"] == "Иван Пробен е в болничен днес."

    away_id = _employee(client, owner, "Мария Пробна")
    client.post("/api/employees/leave", headers=owner, json={
        "employee_id": away_id, "leave_type": "paid", "start_date": today, "end_date": today,
    })
    detail = {s["key"]: s for s in client.get("/api/proactive/signals", headers=owner).json()["signals"]}["team_on_leave"]["detail"]
    assert "Иван Пробен (болничен)" in detail and "Мария Пробна" in detail and detail.endswith("отсъстват днес.")

"""Paid leave left (Е3): days a year for each employee (in proportion in the
year of hiring), the unused days carried from the year before, what is used
and booked - in working days, without weekends and official holidays."""
from datetime import date

import server
from tests.test_whole_program_fixes import _company

EMPLOYEE = {"id": "e1", "name": "Мария", "annual_leave_days": 20, "hire_date": "2024-03-01"}


def _paid(start, end):
    return {"leave_type": "paid", "start_date": start, "end_date": end}


def test_e3_used_planned_and_left_in_working_days():
    # A week in August (5 days) is used; the Christmas fortnight is booked:
    # 21-31 December holds only 6 working days (24, 25 and 28 are days off).
    leave = [_paid("2026-08-03", "2026-08-07"), _paid("2026-12-21", "2026-12-31")]
    balance = server.employee_leave_balance(EMPLOYEE, leave, 2026, today=date(2026, 9, 1))
    assert (balance["used"], balance["planned"], balance["entitlement"]) == (5, 6, 20)
    assert balance["remaining"] == 9

    # Leave across the new year counts in each year by its own days.
    across = [_paid("2025-12-29", "2026-01-09")]
    assert server.employee_leave_balance(EMPLOYEE, across, 2025, today=date(2026, 3, 1))["used"] == 3
    assert server.employee_leave_balance(EMPLOYEE, across, 2026, today=date(2026, 3, 1))["used"] == 6


def test_e3_carried_over_and_the_year_of_hiring():
    # 3 days carried into 2025 (entered once), 10 used in 2025: 13 carry into 2026.
    employee = {**EMPLOYEE, "leave_carryover": {"year": 2025, "days": 3}}
    leave = [_paid("2025-06-02", "2025-06-13")]   # two weeks: 10 working days
    balance = server.employee_leave_balance(employee, leave, 2026, today=date(2026, 2, 1))
    assert balance["carried_over"] == 13 and balance["remaining"] == 33
    # Hired on 1 July: about half a year's days.
    new_hire = {**EMPLOYEE, "hire_date": "2026-07-01"}
    assert server.employee_leave_balance(new_hire, [], 2026, today=date(2026, 9, 1))["entitlement"] == 10


def test_e3_balance_and_settings_through_the_api(client):
    _, _, owner = _company()
    employee = client.post("/api/employees", headers=owner, json={
        "name": "Георги", "base_salary": 1200, "hire_date": "2020-01-15",
    }).json()
    assert employee["annual_leave_days"] == 20
    client.post("/api/employees/leave", headers=owner, json={
        "employee_id": employee["id"], "leave_type": "paid", "start_date": "2025-06-02", "end_date": "2025-06-06",
    })
    client.post("/api/employees/leave", headers=owner, json={   # sick leave is no paid leave
        "employee_id": employee["id"], "leave_type": "sick", "start_date": "2025-07-01", "end_date": "2025-07-10",
    })
    [row] = [b for b in client.get("/api/employees/leave-balance?year=2025", headers=owner).json() if b["employee_id"] == employee["id"]]
    assert (row["used"], row["remaining"]) == (5, 15)

    saved = client.put(f"/api/employees/{employee['id']}/leave-settings", headers=owner, json={
        "annual_leave_days": 25, "carryover_year": 2025, "carryover_days": 4,
    })
    assert saved.status_code == 200 and saved.json()["annual_leave_days"] == 25
    [row] = [b for b in client.get("/api/employees/leave-balance?year=2025", headers=owner).json() if b["employee_id"] == employee["id"]]
    assert (row["carried_over"], row["entitlement"], row["remaining"]) == (4, 25, 24)
    assert client.put(f"/api/employees/{employee['id']}/leave-settings", headers=owner, json={}).status_code == 400

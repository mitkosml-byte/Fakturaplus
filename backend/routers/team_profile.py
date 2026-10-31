"""Team member profile: a manager-facing aggregated view of one team
member (identity, linked payroll record if any, this month's schedule
stats, leave/holiday-work history) plus private manager-only performance
notes (positive/negative, with a net score) for easier at-a-glance
analysis - see the work-schedule grid's avatar tap. Shares server.py's
db/models/helpers/services via `from server import *`; `db` is accessed
as `server.db` (qualified), never via the star-import, to stay correct
when server.py's test fixture monkeypatches it."""
from fastapi import APIRouter
from server import *
from server import _month_bounds
import server

from routers.schedule import get_schedule_summary
from routers.payroll import list_leave, list_holiday_work

router = APIRouter(prefix="/api")


@router.post("/team/notes", response_model=TeamNote)
async def create_team_note(payload: TeamNoteCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    if payload.note_type not in TEAM_NOTE_TYPES:
        raise HTTPException(status_code=400, detail="Невалиден тип бележка")
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Текстът е задължителен")

    company_id, _ = await get_company_scope(current_user)
    member = await server.db.users.find_one(
        {"user_id": payload.user_id, "company_id": company_id}, {"_id": 0, "user_id": 1}
    )
    if not member:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")

    note = TeamNote(
        company_id=company_id or "",
        user_id=payload.user_id,
        note_type=payload.note_type,
        text=text,
        created_by=current_user.user_id,
        created_by_name=current_user.name,
    )
    await server.db.team_notes.insert_one(note.model_dump())
    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="create",
        entity_type="team_note",
        entity_id=note.id,
        company_id=company_id,
        details={"target_user_id": payload.user_id, "note_type": payload.note_type},
    )
    return note


@router.get("/team/notes")
async def list_team_notes(user_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    raw_notes = await server.db.team_notes.find(
        {"company_id": company_id, "user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)
    notes = [TeamNote(**n) for n in raw_notes]
    positive = sum(1 for n in notes if n.note_type == "positive")
    negative = sum(1 for n in notes if n.note_type == "negative")
    return {"notes": notes, "positive_count": positive, "negative_count": negative, "net_score": positive - negative}


@router.delete("/team/notes/{note_id}")
async def delete_team_note(note_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)
    note = await server.db.team_notes.find_one({"id": note_id, "company_id": company_id}, {"_id": 0})
    if not note:
        raise HTTPException(status_code=404, detail="Бележката не е намерена")
    if note["created_by"] != current_user.user_id:
        raise HTTPException(status_code=403, detail="Само авторът на бележката може да я изтрие")
    await server.db.team_notes.delete_one({"id": note_id})
    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="delete",
        entity_type="team_note",
        entity_id=note_id,
        company_id=company_id,
        details={"target_user_id": note["user_id"], "note_type": note["note_type"]},
    )
    return {"message": "Бележката е изтрита"}


@router.get("/team/members/{user_id}/profile")
async def get_team_member_profile(user_id: str, current_user: User = Depends(get_current_user)):
    """Everything a manager can already see about one team member across
    the app, gathered into one call: identity + role/permissions, the
    linked payroll record (position/hire date only - the actual salary
    amount stays in Payroll, which has its own dedicated screen for that),
    this month's schedule hours/pay, leave and holiday-work history, and
    the private performance notes with their net score."""
    require_permission(current_user, "manage_budget")
    company_id, _ = await get_company_scope(current_user)

    member = await server.db.users.find_one(
        {"user_id": user_id, "company_id": company_id},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "picture": 1, "role": 1, "permissions": 1, "created_at": 1},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")

    employee_doc = await server.db.employees.find_one(
        {"company_id": company_id, "linked_user_id": user_id},
        {"_id": 0, "id": 1, "name": 1, "position": 1, "hire_date": 1, "active": 1},
    )

    month_start, month_end = _month_bounds(datetime.now(timezone.utc))
    schedule_summary = await get_schedule_summary(
        start=month_start, end=month_end, user_id=user_id, current_user=current_user
    )

    leave_entries: List[Any] = []
    holiday_entries: List[Any] = []
    if employee_doc:
        all_leave = await list_leave(start_date=None, end_date=None, current_user=current_user)
        leave_entries = [l for l in all_leave if l.employee_id == employee_doc["id"]]
        all_holiday = await list_holiday_work(start_date=None, end_date=None, current_user=current_user)
        holiday_entries = [h for h in all_holiday if h.employee_id == employee_doc["id"]]

    notes = await list_team_notes(user_id=user_id, current_user=current_user)

    return {
        "member": member,
        "employee": employee_doc,
        "schedule_summary": schedule_summary,
        "leave_entries": leave_entries,
        "holiday_work_entries": holiday_entries,
        "notes": notes,
    }

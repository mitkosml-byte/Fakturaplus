"""The business's own deadlines (Н10): an insurance to renew, an
inspection, a contract that ends, what the accountant needs by a date -
whatever the owner enters, with how often it comes back and how many days
before it they want to hear of it. The program reminds (on Home and in the
morning notification) and moves a repeating one to its next date once it
is marked done. It does not read or interpret any law - the dates are the
owner's."""
import calendar

from fastapi import APIRouter
from server import *
import server

router = APIRouter(prefix="/api")

# Who keeps the business's deadlines.
DEADLINE_ROLES = {"owner", "manager"}
CATEGORIES = ("insurance", "inspection", "contract", "accountant", "tax", "license", "other")
# How far ahead a repeating deadline's next dates are shown.
PREVIEW_DATES = 3

_REPEAT_MONTHS = {"monthly": 1, "quarterly": 3, "half_yearly": 6, "yearly": 12}


class DeadlineInput(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[Literal["insurance", "inspection", "contract", "accountant", "tax", "license", "other"]] = None
    due_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    repeat: Optional[Literal["none", "monthly", "quarterly", "half_yearly", "yearly", "months"]] = None
    # With repeat "months": every this many months.
    repeat_months: Optional[int] = Field(default=None, ge=1, le=120)
    remind_days_before: Optional[int] = Field(default=None, ge=0, le=365)
    notes: Optional[str] = Field(default=None, max_length=2000)
    amount: Optional[float] = Field(default=None, ge=0, le=100_000_000)


class DeadlineDone(BaseModel):
    # The date marked done - a second tap on an old screen does not move it twice.
    due_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


def _require(user: User) -> None:
    if user.role not in DEADLINE_ROLES:
        raise HTTPException(status_code=403, detail="Сроковете се водят от собственика или управителя")


def add_months(day: date, months: int, anchor_day: int) -> date:
    """`months` later, on the anchor day (the month's last day for a day it
    does not have: 31 January -> 28/29 February -> 31 March)."""
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def step_months(deadline: dict) -> Optional[int]:
    repeat = deadline.get("repeat") or "none"
    if repeat == "months":
        return int(deadline.get("repeat_months") or 1)
    return _REPEAT_MONTHS.get(repeat)


def next_dates(deadline: dict, count: int) -> List[str]:
    """The current date and the ones after it."""
    try:
        day = date.fromisoformat(deadline["due_date"])
    except (KeyError, ValueError):
        return []
    months = step_months(deadline)
    anchor = int(deadline.get("anchor_day") or day.day)
    dates = [day]
    while months and len(dates) < count:
        dates.append(add_months(dates[-1], months, anchor))
    return [d.isoformat() for d in dates]


def deadline_view(deadline: dict, today: date) -> dict:
    due = date.fromisoformat(deadline["due_date"])
    days = (due - today).days
    stored = deadline.get("remind_days_before")
    remind = int(stored) if stored is not None else 7
    if not deadline.get("is_active", True):
        status = "done"
    elif days < 0:
        status = "overdue"
    elif days <= remind:
        status = "soon"
    else:
        status = "later"
    return {
        **{key: deadline.get(key) for key in ("id", "title", "category", "due_date", "repeat", "repeat_months", "notes", "amount")},
        "remind_days_before": remind, "is_active": deadline.get("is_active", True),
        "days_left": days, "status": status,
        "next_dates": next_dates(deadline, PREVIEW_DATES) if deadline.get("is_active", True) else [],
        "last_done": (deadline.get("done_history") or [{}])[-1].get("due_date") if deadline.get("done_history") else None,
    }


async def _deadline(scope: dict, deadline_id: str) -> dict:
    deadline = await server.db.deadlines.find_one({"id": deadline_id, **scope}, {"_id": 0})
    if not deadline:
        raise HTTPException(status_code=404, detail="Срокът не е намерен")
    return deadline


@router.get("/deadlines")
async def list_deadlines(current_user: User = Depends(get_current_user)):
    _require(current_user)
    _, scope = await get_company_scope(current_user)
    today = server.today_local()
    deadlines = await server.db.deadlines.find(scope, {"_id": 0}).to_list(ALL_ROWS)
    views = [deadline_view(d, today) for d in deadlines]
    order = {"overdue": 0, "soon": 1, "later": 2, "done": 3}
    views.sort(key=lambda v: (order[v["status"]], v["due_date"]))
    return views


@router.post("/deadlines")
async def create_deadline(payload: DeadlineInput, current_user: User = Depends(get_current_user)):
    _require(current_user)
    company_id, scope = await get_company_scope(current_user)
    title = (payload.title or "").strip()
    if not title or not payload.due_date:
        raise HTTPException(status_code=400, detail="Посочете какво и до кога")
    due = date.fromisoformat(payload.due_date)
    deadline = {
        "id": str(uuid.uuid4()), "company_id": company_id, "user_id": current_user.user_id,
        "title": title, "category": payload.category or "other", "due_date": due.isoformat(), "anchor_day": due.day,
        "repeat": payload.repeat or "none", "repeat_months": payload.repeat_months if payload.repeat == "months" else None,
        "remind_days_before": payload.remind_days_before if payload.remind_days_before is not None else 7,
        "notes": (payload.notes or "").strip() or None, "amount": payload.amount,
        "is_active": True, "done_history": [], "created_at": datetime.now(timezone.utc),
    }
    await server.db.deadlines.insert_one(dict(deadline))
    return deadline_view(deadline, server.today_local())


@router.put("/deadlines/{deadline_id}")
async def update_deadline(deadline_id: str, payload: DeadlineInput, current_user: User = Depends(get_current_user)):
    _require(current_user)
    _, scope = await get_company_scope(current_user)
    await _deadline(scope, deadline_id)
    update: Dict[str, Any] = {}
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "title":
            if not (value or "").strip():
                raise HTTPException(status_code=400, detail="Посочете какво")
            update["title"] = value.strip()
        elif key == "due_date" and value:
            update.update(due_date=value, anchor_day=date.fromisoformat(value).day, is_active=True)
        elif key == "notes":
            update["notes"] = (value or "").strip() or None
        elif key in ("category", "repeat", "repeat_months", "remind_days_before", "amount"):
            update[key] = value
    if update:
        await server.db.deadlines.update_one({"id": deadline_id, **scope}, {"$set": update})
    return deadline_view(await _deadline(scope, deadline_id), server.today_local())


@router.post("/deadlines/{deadline_id}/done")
async def mark_deadline_done(deadline_id: str, payload: DeadlineDone, current_user: User = Depends(get_current_user)):
    """Done for this date: a repeating one moves to its next date, a single
    one is finished. The date sent must still be the current one."""
    _require(current_user)
    company_id, scope = await get_company_scope(current_user)
    deadline = await _deadline(scope, deadline_id)
    months = step_months(deadline)
    due = date.fromisoformat(payload.due_date)
    entry = {"due_date": payload.due_date, "done_at": datetime.now(timezone.utc), "by": current_user.user_id}
    change: Dict[str, Any] = {"$push": {"done_history": entry}}
    if months:
        change["$set"] = {"due_date": add_months(due, months, int(deadline.get("anchor_day") or due.day)).isoformat()}
    else:
        change["$set"] = {"is_active": False}
    moved = await server.db.deadlines.update_one(
        {"id": deadline_id, **scope, "due_date": payload.due_date, "is_active": True}, change,
    )
    if moved.matched_count == 0:
        raise HTTPException(status_code=409, detail="Срокът вече е отбелязан или датата му е сменена")
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="update", entity_type="deadline",
        entity_id=deadline_id, company_id=company_id, details={"title": deadline.get("title"), "done_for": payload.due_date},
    )
    return deadline_view(await _deadline(scope, deadline_id), server.today_local())


@router.delete("/deadlines/{deadline_id}")
async def delete_deadline(deadline_id: str, current_user: User = Depends(get_current_user)):
    _require(current_user)
    _, scope = await get_company_scope(current_user)
    await _deadline(scope, deadline_id)
    await server.db.deadlines.delete_one({"id": deadline_id, **scope})
    return {"deleted": True}


def _when(view: dict) -> str:
    day = date.fromisoformat(view["due_date"]).strftime("%d.%m")
    days = view["days_left"]
    if days < 0:
        return f"просрочен с {-days} {'ден' if days == -1 else 'дни'} ({day})"
    if days == 0:
        return f"днес ({day})"
    if days == 1:
        return f"утре ({day})"
    return f"след {days} дни ({day})"


async def deadlines_signal(company_id: Optional[str], scope: dict, current_user: User) -> Optional[dict]:
    """The deadlines past or near, in the days before them the owner chose."""
    if current_user.role not in DEADLINE_ROLES:
        return None
    today = server.today_local()
    near = [
        deadline_view(d, today) for d in await server.db.deadlines.find({**scope, "is_active": True}, {"_id": 0}).to_list(ALL_ROWS)
    ]
    near = sorted((v for v in near if v["status"] in ("overdue", "soon")), key=lambda v: v["due_date"])
    if not near:
        return None
    first = near[0]
    overdue = [v for v in near if v["status"] == "overdue"]
    more = f" И още {len(near) - 1}." if len(near) > 1 else ""
    return {
        "key": "deadlines", "severity": "critical" if overdue else "warning", "priority": 80 if overdue else 64,
        "title": "Просрочен срок" if overdue else "Наближава срок",
        "detail": f"{first['title']} - {_when(first)}.{more}", "route": "/deadlines",
        "fingerprint": "deadlines|" + "|".join(f"{v['id']}:{v['due_date']}:{v['status']}" for v in near),
    }

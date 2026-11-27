"""Team moments, as internal messages: a birthday greeted by the owner and
the managers, and the team reminded the day before an official holiday
whether the business works.

A birthday is the person's own day and month ("MM-DD"), set by them in
Account - never the year, so never the age. On the day the colleagues see
it on the day card (routers/day_card), and the person gets a message from
the owner and the managers. The owner turns either moment off in the
company settings (company.team_moments); a business without the team
module gets neither.

Each moment is sent once (team_moments keeps what was sent); the hourly
tick sends the birthday from GREETING_HOUR and the holiday reminder from
REMINDER_HOUR the day before, on the business's clock."""
import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter
from pymongo.errors import DuplicateKeyError

from server import *
import server
from services.month_names import MONTHS_BG
from services import day_card as dc

router = APIRouter(prefix="/api")

GREETING_HOUR = 8
REMINDER_HOUR = 10
APP_SENDER = {"user_id": "system", "name": "Фактура+"}
# MONTHS_BG: services/month_names.


class BirthdayIn(BaseModel):
    # "MM-DD"; null takes it away.
    birthday: Optional[str] = Field(default=None, max_length=5)


class TeamMomentsIn(BaseModel):
    birthdays: Optional[bool] = None
    holidays: Optional[bool] = None


@router.put("/auth/me/birthday")
async def set_my_birthday(body: BirthdayIn, current_user: User = Depends(get_current_user)):
    """One's own birthday - day and month only, set by the person themself:
    the team sees it on the day and the owner's greeting comes."""
    if body.birthday is not None and not dc.valid_birthday(body.birthday):
        raise HTTPException(status_code=400, detail="Невалидна дата - ден и месец")
    await server.db.users.update_one({"user_id": current_user.user_id}, {"$set": {"birthday": body.birthday}})
    return {"birthday": body.birthday}


@router.get("/auth/me/birthday")
async def get_my_birthday(current_user: User = Depends(get_current_user)):
    doc = await server.db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "birthday": 1})
    return {"birthday": doc.get("birthday") if doc else None}


def _moments(company: Optional[dict]) -> Dict[str, bool]:
    chosen = (company or {}).get("team_moments") or {}
    return {"birthdays": chosen.get("birthdays") is not False, "holidays": chosen.get("holidays") is not False}


@router.get("/company/team-moments")
async def get_team_moments(current_user: User = Depends(get_current_user)):
    company_id, _ = await get_company_scope(current_user)
    company = await server.db.companies.find_one({"id": company_id}, {"_id": 0, "team_moments": 1}) if company_id else None
    return _moments(company)


@router.put("/company/team-moments")
async def set_team_moments(body: TeamMomentsIn, current_user: User = Depends(get_current_user)):
    """Whether the app greets birthdays and reminds of holidays in this business."""
    require_permission(current_user, "manage_company")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    company = await server.db.companies.find_one({"id": company_id}, {"_id": 0, "team_moments": 1})
    chosen = {**_moments(company), **{k: v for k, v in body.model_dump().items() if v is not None}}
    await server.db.companies.update_one({"id": company_id}, {"$set": {"team_moments": chosen}})
    return chosen


async def _once(key: str, company_id: str) -> bool:
    """True the first time - the moment is marked as sent."""
    try:
        await server.db.team_moments.insert_one({"_id": key, "company_id": company_id, "at": datetime.now(timezone.utc)})
        return True
    except DuplicateKeyError:
        return False


async def _post(company_id: str, conversation_id: str, sender_id: str, sender_name: str, text: str,
                kind: str, recipients: List[str], push_title: str) -> None:
    now = datetime.now(timezone.utc)
    await server.db.messages.insert_one({
        "id": str(uuid.uuid4()), "company_id": company_id, "conversation_id": conversation_id,
        "sender_id": sender_id, "sender_name": sender_name, "text": text, "created_at": now,
        "automatic": True, "kind": kind,
    })
    if recipients:
        await push_service.send_to_users(
            server.db, recipients, title=push_title, body=text[:120],
            data={"type": "message", "conversation_id": conversation_id},
        )


def _names(names: List[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " и " + names[-1]


async def greet_birthday(company: dict, person: dict) -> bool:
    """The day's greeting to one person, from the owner and the managers."""
    company_id = company["id"]
    people = await server.db.users.find({"company_id": company_id}, {"_id": 0, "user_id": 1, "name": 1, "role": 1}).to_list(1000)
    owner_id = company.get("owner_id")
    senders = [p for p in people if p["user_id"] == owner_id and p["user_id"] != person["user_id"]]
    senders += [p for p in people if p.get("role") == "manager" and p["user_id"] != person["user_id"]]
    if not senders:
        return False
    if not await _once(f"birthday:{company_id}:{person['user_id']}:{dc.today_year()}", company_id):
        return False
    first = senders[0]
    conversation_id = await get_or_create_dm_conversation(company_id, first["user_id"], person["user_id"])
    signed = _names([dc.first_name(s.get("name")) for s in senders])
    text = f"Честит рожден ден, {dc.first_name(person.get('name'))}! 🎉 Много здраве, усмивки и успехи – от {signed}."
    await _post(company_id, conversation_id, first["user_id"], first.get("name") or "", text, "birthday",
                [person["user_id"]], first.get("name") or "Фактура+")
    return True


async def remind_holiday(company: dict, today: date) -> bool:
    """The team, the day before an official holiday: does the business work?"""
    company_id = company["id"]
    tomorrow = today + timedelta(days=1)
    holiday = server._holiday_name_for_date(tomorrow.isoformat())
    if not holiday or not await _once(f"holiday:{company_id}:{tomorrow.isoformat()}", company_id):
        return False
    closed_weekdays, exceptions = await get_closed_days_lookup(company_id)
    closed = is_date_closed(tomorrow.isoformat(), closed_weekdays, exceptions)
    when = f"{tomorrow.day} {MONTHS_BG[tomorrow.month - 1]}"
    text = (f"Утре ({when}) е {holiday}. Почиваме – приятен празник! 🎉" if closed
            else f"Утре ({when}) е {holiday}. Работим по график – проверете смените си.")
    members = await get_team_members(company_id)
    await _post(company_id, team_channel_id(company_id), APP_SENDER["user_id"], APP_SENDER["name"], text, "holiday",
                [m["user_id"] for m in members], "Екипен чат")
    return True


def team_channel_id(company_id: str) -> str:
    return f"team:{company_id}"


async def team_moments_tick(now: Optional[datetime] = None) -> Dict[str, int]:
    """Birthdays of the day and tomorrow's holiday, for every business that
    has a team and keeps the moment on."""
    now = now or now_local()
    today = now.date()
    sent = {"birthdays": 0, "holidays": 0}
    if now.hour >= GREETING_HOUR:
        days = {f"{today.month:02d}-{today.day:02d}"}
        if (today.month, today.day) == (2, 28):
            days.add("02-29")     # a 29 February birthday, in a common year
        celebrating = await server.db.users.find(
            {"birthday": {"$in": sorted(days)}, "company_id": {"$ne": None}},
            {"_id": 0, "user_id": 1, "name": 1, "birthday": 1, "company_id": 1},
        ).to_list(ALL_ROWS)
        for person in celebrating:
            if not dc.birthday_today(person.get("birthday"), today):
                continue
            company = await server.db.companies.find_one({"id": person["company_id"]}, {"_id": 0})
            if not company or not company_modules(company)["team"] or not _moments(company)["birthdays"]:
                continue
            sent["birthdays"] += int(await greet_birthday(company, person))
    if now.hour >= REMINDER_HOUR and server._holiday_name_for_date((today + timedelta(days=1)).isoformat()):
        companies = await server.db.companies.find({}, {"_id": 0}).to_list(ALL_ROWS)
        for company in companies:
            if company_modules(company)["team"] and _moments(company)["holidays"]:
                sent["holidays"] += int(await remind_holiday(company, today))
    return sent


async def _team_moments_loop():
    await error_log.run_job(server.db, "team_moments", team_moments_tick, JOB_INTERVALS["team_moments"])


async def start_team_moments_loop():
    asyncio.create_task(_team_moments_loop())

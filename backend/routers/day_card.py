"""The day card - a personal greeting, the weather where the business is,
one line for the day, what the viewer's role needs today and one spark
(services/day_card for the free parts and the reasons for them).

Every number on it follows the viewer's rights, as everywhere else
(get_financial_visibility): revenue only for whoever sees the statistics,
pocket money in it only for whoever sees pocket money, a colleague's
shift only for whoever keeps the schedule. The AI line, when there is
one, is written from nothing confidential - the weather, the date, the
holidays and name days - once a day per business, and is the same for
everyone in it.

GET /api/day-card, and the "day_card" part of GET /api/home."""
import asyncio
import json
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

from server import *
import server
from services.month_names import MONTHS_BG, MONTHS_EN
from services import day_card as dc
from services.money_text import fmt_eur

router = APIRouter(prefix="/api")

# MONTHS_BG and MONTHS_EN: services/month_names.
WEEKDAYS_BG = ["понеделник", "вторник", "сряда", "четвъртък", "петък", "събота", "неделя"]
WEEKDAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
USUAL_BG = ["обичайния понеделник", "обичайния вторник", "обичайната сряда", "обичайния четвъртък",
            "обичайния петък", "обичайната събота", "обичайната неделя"]
BEST_BG = ["най-добрият понеделник", "най-добрият вторник", "най-добрата сряда", "най-добрият четвъртък",
           "най-добрият петък", "най-добрата събота", "най-добрата неделя"]
KIND_BG = {dc.CLEAR: "слънчево", dc.PARTLY: "разкъсана облачност", dc.CLOUDY: "облачно", dc.FOG: "мъгла",
           dc.RAIN: "дъжд", dc.SLEET: "киша", dc.SNOW: "сняг", dc.THUNDER: "гръмотевици"}
KIND_EN = {dc.CLEAR: "sunny", dc.PARTLY: "partly cloudy", dc.CLOUDY: "cloudy", dc.FOG: "fog",
           dc.RAIN: "rain", dc.SLEET: "sleet", dc.SNOW: "snow", dc.THUNDER: "storms"}

# A streak is worth a word from this many days on; a record needs this
# many earlier days of the same weekday this year to be one.
STREAK_FROM = 5
RECORD_AFTER = 4
# The usual of a weekday: its last this many entered days.
USUAL_WEEKS = 8

# One AI line a day per business: written in the background the first
# time the card is asked for, the template meanwhile.
DAY_LINE_MODEL = "claude-opus-5-5"
_writing: set = set()

# Where the business is: a place not yet looked up is looked up while the
# card waits this long; what takes longer goes on and is kept for next time.
PLACE_WAIT = 2.5
# A name OpenStreetMap did not know (or could not be asked about) is asked
# again after this long.
GEOCODE_RETRY = timedelta(hours=6)
_resolving: Dict[str, "asyncio.Task[Optional[dict]]"] = {}


def _t(english: bool, bg: str, en: str) -> str:
    return en if english else bg


def _day_text(day: date, english: bool) -> str:
    return f"{MONTHS_EN[day.month - 1]} {day.day}" if english else f"{day.day} {MONTHS_BG[day.month - 1]}"


# ---- The weather where the business is.

async def _place_plan(company: dict) -> List[Tuple[str, Any]]:
    """Where the business is, in the order it is believed - nothing typed
    for the weather: the city it gave, a point a manager chose on a device
    there, its address, the address of its first site, and the address its
    suppliers write on the invoices to it (kept when one is scanned)."""
    plan: List[Tuple[str, Any]] = []
    city = (company.get("city") or "").strip()
    if city:
        plan.append(("city", city))
    point = company.get("weather_point") or {}
    if point.get("lat") is not None and point.get("lon") is not None:
        plan.append(("point", point))
    plan += [("address", query) for query in dc.place_queries(company.get("address"))]
    sites = await server.db.locations.find(
        {"company_id": company["id"], "is_active": {"$ne": False}, "address": {"$nin": [None, ""]}},
        {"_id": 0, "address": 1},
    ).sort("created_at", 1).limit(1).to_list(1)
    if sites:
        plan += [("site", query) for query in dc.place_queries(sites[0].get("address"))]
    hint = ((company.get("weather_hint") or {}).get("city") or "").strip()
    if hint:
        plan.append(("invoice", hint))
    unique: List[Tuple[str, Any]] = []
    for source, value in plan:
        if source == "point" or _place_key(value) not in {_place_key(v) for s_, v in unique if s_ != "point"}:
            unique.append((source, value))
    return unique


def _place_key(query: str) -> str:
    return " ".join(str(query).lower().split())


async def _known_place(query: str) -> Tuple[str, Optional[dict]]:
    """A name looked up before, by any business: ("hit", place), ("miss",
    None) while a miss is fresh, or ("unknown", None)."""
    doc = await server.db.geocode_cache.find_one({"_id": _place_key(query)})
    if not doc:
        return "unknown", None
    if doc.get("lat") is not None:
        return "hit", doc
    if datetime.now(timezone.utc) - _aware(doc["at"]) < GEOCODE_RETRY:
        return "miss", None
    return "unknown", None


def _as_place(source: str, found: dict) -> dict:
    return {"lat": found["lat"], "lon": found["lon"], "name": found.get("name"), "source": source}


async def _resolve(plan: List[Tuple[str, Any]]) -> Optional[dict]:
    try:
        async with httpx.AsyncClient() as http:
            for source, value in plan:
                if source == "point":
                    return _as_place(source, value)
                state, found = await _known_place(value)
                if state == "miss":
                    continue
                if state == "unknown":
                    located = await dc.geocode_city(http, value)
                    found = {"_id": _place_key(value), "at": datetime.now(timezone.utc)}
                    if located:
                        found.update(lat=round(located[0], 3), lon=round(located[1], 3), name=located[2])
                    await server.db.geocode_cache.replace_one({"_id": found["_id"]}, found, upsert=True)
                    if not located:
                        continue
                return _as_place(source, found or {})
    except Exception as error:
        logger.warning(f"Place of the business not found: {error}")
    return None


async def _place(company: dict, plan: List[Tuple[str, Any]]) -> Tuple[str, Optional[dict]]:
    """("found", place), ("pending", None) while a lookup goes on, or
    ("none", None) when nothing tells where the business is."""
    for source, value in plan:
        if source == "point":
            return "found", _as_place(source, value)
        state, found = await _known_place(value)
        if state == "hit" and found:
            return "found", _as_place(source, found)
        if state == "unknown":
            break
    else:
        return "none", None
    # A likelier name not looked up yet: looked up now, briefly.
    key = company["id"]
    task = _resolving.get(key)
    if task is None:
        task = asyncio.create_task(_resolve(plan))
        _resolving[key] = task
        task.add_done_callback(lambda _done: _resolving.pop(key, None))
    try:
        place = await asyncio.wait_for(asyncio.shield(task), timeout=PLACE_WAIT)
    except asyncio.TimeoutError:
        return "pending", None
    return ("found", place) if place else ("none", None)


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


async def _forecast(place: dict) -> Optional[dict]:
    """The place's forecast - kept a while, so a business asks MET Norway a
    few times a day at most (and businesses in one town share it)."""
    key = f"{place['lat']:.2f},{place['lon']:.2f}"
    cached = await server.db.weather_cache.find_one({"_id": key})
    if cached and datetime.now(timezone.utc) - _aware(cached["fetched_at"]) < dc.FORECAST_TTL:
        return cached.get("forecast")
    async with httpx.AsyncClient() as http:
        forecast = await dc.fetch_forecast(http, place["lat"], place["lon"])
    if not forecast:
        return cached.get("forecast") if cached else None
    # Only the next two days are ever read.
    horizon = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    steps = ((forecast.get("properties") or {}).get("timeseries") or [])
    kept = {"properties": {"timeseries": [step for step in steps if str(step.get("time", "")) <= horizon]}}
    await server.db.weather_cache.update_one(
        {"_id": key}, {"$set": {"forecast": kept, "fetched_at": datetime.now(timezone.utc)}}, upsert=True,
    )
    return kept


async def _weather(company: dict, plan: List[Tuple[str, Any]], today: date) -> Tuple[Optional[dict], bool]:
    """The day's weather where the business is, and whether nothing at all
    tells where that is."""
    state, place = await _place(company, plan)
    if not place:
        return None, state == "none"
    forecast = await _forecast(place)
    weather = dc.day_weather(forecast or {}, today, now_local()) if forecast else None
    if not weather:
        return None, False
    # The day as it was forecast, kept: from these the business learns how
    # the weather moves its revenue (services/day_card.weather_effect).
    await server.db.weather_days.update_one(
        {"company_id": company["id"], "date": today.isoformat()},
        {"$set": {"kind": weather["kind"], "min": weather["min"], "max": weather["max"],
                  "precipitation_mm": weather["precipitation_mm"]}},
        upsert=True,
    )
    return {**weather, "place": place.get("name")}, False


# ---- Revenue the viewer may see, by day.

async def _revenue_by_day(scope: dict, start: date, end: date, with_pocket: bool) -> Dict[str, float]:
    rows = await server.db.daily_revenue.find(
        {**scope, "date": {"$gte": start.isoformat(), "$lte": end.isoformat()}},
        {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1},
    ).to_list(ALL_ROWS)
    days: Dict[str, float] = {}
    for row in rows:
        day = str(row.get("date") or "")[:10]
        amount = float(row.get("fiscal_revenue") or 0) + (float(row.get("pocket_money") or 0) if with_pocket else 0.0)
        days[day] = days.get(day, 0.0) + amount
    return days


# ---- What the viewer's role needs today.

async def _focus(user: User, company: dict, scope: dict, today: date, english: bool,
                 revenue: Optional[Dict[str, float]]) -> List[dict]:
    perms = set(user.permissions or [])
    modules = company_modules(company)
    company_id = company["id"]
    items: List[dict] = []
    yesterday = today - timedelta(days=1)
    closed_weekdays, exceptions = await get_closed_days_lookup(company_id)
    yesterday_open = not is_date_closed(yesterday.isoformat(), closed_weekdays, exceptions)

    # The till: yesterday not entered (for whoever enters it - no amount in
    # it), or how it went (for whoever sees the revenue).
    if modules["till"] and ("add_revenue" in perms or revenue is not None):
        entered = await server.db.daily_revenue.find_one({**scope, "date": yesterday.isoformat()}, {"_id": 1}) is not None
        # Opens the revenue form on yesterday - on Home, or on Team for
        # whoever enters the revenue but has no Home (no statistics).
        if not entered and yesterday_open and "add_revenue" in perms:
            screen = "/" if "view_statistics" in perms else "/team"
            items.append({"key": "missing_revenue", "priority": 90, "icon": "create-outline",
                          "route": f"{screen}?revenueDate={yesterday.isoformat()}",
                          "text": _t(english, "Вчерашният оборот не е въведен", "Yesterday's revenue isn't entered")})
        elif entered and revenue is not None and yesterday.isoformat() in revenue:
            same_weekday = sorted(
                (day for day in revenue if date.fromisoformat(day).weekday() == yesterday.weekday() and day < yesterday.isoformat()),
                reverse=True,
            )[:USUAL_WEEKS]
            amount = revenue[yesterday.isoformat()]
            text = _t(english, f"Вчера: {fmt_eur(amount)}", f"Yesterday: {fmt_eur(amount, True)}")
            if len(same_weekday) >= 3:
                usual = statistics.median(revenue[day] for day in same_weekday)
                if usual > 0:
                    change = round((amount / usual - 1) * 100)
                    if abs(change) >= 3:
                        text += _t(
                            english,
                            f" – с {abs(change)}% {'над' if change > 0 else 'под'} {USUAL_BG[yesterday.weekday()]}",
                            f" – {abs(change)}% {'above' if change > 0 else 'below'} a usual {WEEKDAYS_EN[yesterday.weekday()]}",
                        )
            items.append({"key": "yesterday", "priority": 40, "icon": "trending-up", "route": "/stats", "text": text})

    # Orders - for whoever orders: sees the plan, keeps the supplier invoices
    # and spends for the business (not the accountant). What to order today
    # (a day before the delivery at the latest), a public holiday on that
    # delivery, a delivery that came without something ordered; and, for
    # whoever keeps the invoices of the day, yesterday's delivery with no
    # invoice scanned.
    orders_by = {"view_statistics", "manage_invoices", "add_expenses"} <= perms
    scans_deliveries = {"manage_invoices", "add_expenses"} <= perms
    if orders_by or scans_deliveries:
        from routers.price_tracking import day_orders
        orders = await day_orders(company_id)
        if orders_by and orders["to_order"]:
            to_order = orders["to_order"]
            names = ", ".join(dc.short_supplier(entry["supplier"]) for entry in to_order[:2])
            more = len(to_order) - 2
            for_tomorrow = all(entry["delivery"] == (today + timedelta(days=1)).isoformat() for entry in to_order)
            items.append({
                "key": "to_order", "priority": 65, "icon": "cart-outline", "route": "/stats?tab=items",
                "text": _t(english,
                           ("За поръчка днес (доставка утре): " if for_tomorrow else "За поръчка днес: ")
                           + names + (f" и още {more}" if more > 0 else ""),
                           ("To order today (delivery tomorrow): " if for_tomorrow else "To order today: ")
                           + names + (f" and {more} more" if more > 0 else "")),
            })
            on_holiday = next((entry for entry in to_order if entry["holiday"]), None)
            if on_holiday:
                day = date.fromisoformat(on_holiday["holiday"]["date"])
                who = dc.short_supplier(on_holiday["supplier"])
                items.append({
                    "key": "delivery_holiday", "priority": 64, "icon": "flag-outline", "route": "/stats?tab=items",
                    "text": _t(english,
                               f"{WEEKDAYS_BG[day.weekday()].capitalize()}, {day.day} {MONTHS_BG[day.month - 1]}, е празник"
                               f" – {who} може да не достави. Поръчай за повече дни.",
                               f"{WEEKDAYS_EN[day.weekday()]}, {MONTHS_EN[day.month - 1]} {day.day}, is a public holiday"
                               f" – {who} may not deliver. Order for more days."),
                })
        if orders_by and orders["missing"]:
            entry = orders["missing"][0]
            names = ", ".join(entry["items"][:2])
            more = len(entry["items"]) - 2
            who = dc.short_supplier(entry["supplier"])
            items.append({
                "key": "missing_delivery", "priority": 72, "icon": "alert-circle-outline", "route": "/stats?tab=items",
                "text": _t(english,
                           f"{who} достави без: {names}" + (f" и още {more}" if more > 0 else ""),
                           f"{who} delivered without: {names}" + (f" and {more} more" if more > 0 else "")),
            })
        if scans_deliveries and orders["no_invoice"]:
            names = ", ".join(dc.short_supplier(entry["supplier"]) for entry in orders["no_invoice"][:2])
            more = len(orders["no_invoice"]) - 2
            items.append({
                "key": "no_invoice", "priority": 62, "icon": "document-text-outline", "route": "/scan",
                "text": _t(english,
                           f"Няма фактура за вчерашната доставка от {names}" + (f" и още {more}" if more > 0 else ""),
                           f"No invoice for yesterday's delivery from {names}" + (f" and {more} more" if more > 0 else "")),
            })

    # Supplier invoices due today - for whoever keeps the invoices.
    if "manage_invoices" in perms:
        start = datetime.combine(today, datetime.min.time())
        due = await server.db.invoices.find(
            {**scope, "is_paid": False, "payment_method": "bank_transfer",
             "payment_due_date": {"$gte": start - timedelta(days=1), "$lt": start + timedelta(days=2)}},
            {"_id": 0, "payment_due_date": 1, "total_amount": 1, "paid_amount": 1, "credited_amount": 1},
        ).to_list(ALL_ROWS)
        due_today = [inv for inv in due if business_day(inv.get("payment_due_date")) == today and invoice_left(inv) > 0]
        if due_today:
            total = sum(invoice_left(inv) for inv in due_today)
            items.append({
                "key": "due_today", "priority": 80, "icon": "alarm-outline", "route": "/invoices",
                "text": _t(english, f"Падеж днес: {len(due_today)} {'фактура' if len(due_today) == 1 else 'фактури'} за {fmt_eur(total)}",
                           f"Due today: {len(due_today)} invoice{'s' if len(due_today) > 1 else ''}, {fmt_eur(total, True)}"),
            })

    # VAT by the 14th - for whoever sees the statistics of a VAT-registered business.
    if "view_statistics" in perms and company_vat_registered(company) and today.day <= 14:
        previous = (today.replace(day=1) - timedelta(days=1))
        left = 14 - today.day
        when = _t(english, "днес" if left == 0 else ("утре" if left == 1 else f"след {left} дни"),
                  "today" if left == 0 else ("tomorrow" if left == 1 else f"in {left} days"))
        items.append({
            "key": "vat_deadline", "priority": 85 if left <= 3 else 60, "icon": "calculator-outline", "route": "/stats",
            "text": _t(english, f"ДДС за {MONTHS_BG[previous.month - 1]} – до 14-о ({when})",
                       f"VAT for {MONTHS_EN[previous.month - 1]} – by the 14th ({when})"),
        })

    # The schedule: one's own shift; for whoever keeps the schedule, who is on and who is off.
    if modules["team"] and company_id:
        from routers.schedule import _resolve_occurrences
        shifts = await server.db.work_shifts.find({"company_id": company_id}, {"_id": 0}).to_list(5000)
        occurrences = await _resolve_occurrences(shifts, company_id, today.isoformat(), today.isoformat()) if shifts else []
        mine = [o for o in occurrences if o["user_id"] == user.user_id and not o.get("leave_conflict")]
        if mine:
            hours = ", ".join(f"{o['start_time']}–{o['end_time']}" for o in mine)
            items.append({"key": "my_shift", "priority": 70, "icon": "time-outline", "route": "/work-schedule",
                          "text": _t(english, f"Твоята смяна днес: {hours}", f"Your shift today: {hours}")})
        if "manage_budget" in perms:
            on_shift = sorted({dc.first_name(o["user_name"]) for o in occurrences if not o.get("leave_conflict")})
            on_leave = await server.db.employee_leave.find(
                {"company_id": company_id, "start_date": {"$lte": today.isoformat()}, "end_date": {"$gte": today.isoformat()}},
                {"_id": 0, "employee_name": 1},
            ).to_list(100)
            away = sorted({dc.first_name(e.get("employee_name")) for e in on_leave if e.get("employee_name")})
            if on_shift or away:
                parts = []
                if on_shift:
                    parts.append(_t(english, "на смяна: ", "on shift: ") + ", ".join(on_shift[:4]) + ("…" if len(on_shift) > 4 else ""))
                if away:
                    parts.append(_t(english, "отсъстват: ", "away: ") + ", ".join(away[:3]) + ("…" if len(away) > 3 else ""))
                items.append({"key": "team_today", "priority": 50, "icon": "people-outline", "route": "/work-schedule",
                              "text": _t(english, "Днес ", "Today ") + " · ".join(parts)})

    items.sort(key=lambda item: -item["priority"])
    return [{key: value for key, value in item.items() if key != "priority"} for item in items[:2]]


# ---- One small spark: a birthday, a holiday, a name day, a record.

async def _spark(user: User, company: dict, today: date, english: bool,
                 revenue: Optional[Dict[str, float]]) -> Optional[dict]:
    company_id = company["id"]
    perms = set(user.permissions or [])
    # A tap opens only what this viewer may open; otherwise the line stays a line.
    messages = "/messages" if company_modules(company)["team"] and "team_collaboration" in perms else None
    days_off = "/closed-days" if "manage_company" in perms else None
    # Everyone in the business - whether they use the team chat or not.
    people = await server.db.users.find(
        {"company_id": company_id}, {"_id": 0, "user_id": 1, "name": 1, "birthday": 1},
    ).to_list(1000)

    # A birthday - its year never kept, only the person's own day and month.
    celebrating = [p for p in people if dc.birthday_today(p.get("birthday"), today)]
    if any(p["user_id"] == user.user_id for p in celebrating):
        return {"key": "birthday_mine", "icon": "gift-outline", "route": messages,
                "text": _t(english, f"Честит рожден ден, {dc.first_name(user.name)}! 🎂", f"Happy birthday, {dc.first_name(user.name)}! 🎂")}
    if celebrating:
        names = ", ".join(dc.first_name(p.get("name")) for p in celebrating[:3])
        return {"key": "birthday", "icon": "gift-outline", "route": messages,
                "text": _t(english, f"Днес е рожденият ден на {names}", f"It's {names}'s birthday today")}

    # A holiday today, or tomorrow - and whether the business works.
    closed_weekdays, exceptions = await get_closed_days_lookup(company_id)
    for offset in (0, 1):
        day = today + timedelta(days=offset)
        holiday = server._holiday_name_for_date(day.isoformat())
        if not holiday:
            continue
        closed = is_date_closed(day.isoformat(), closed_weekdays, exceptions)
        if english:
            when = "Today" if offset == 0 else "Tomorrow"
            text = f"{when} is a public holiday – {'closed' if closed else 'open as scheduled'}"
        else:
            when = "Днес" if offset == 0 else "Утре"
            text = f"{when} е {holiday} – {'почиваме' if closed else 'работим по график'}"
        return {"key": "holiday", "icon": "flag-outline", "route": days_off, "text": text}

    # A name day - of someone in the team, or the day's (in Bulgarian).
    if not english:
        names_today = dc.name_days(today)
        team_names = [dc.first_name(p.get("name")) for p in people if dc.has_name_day(p.get("name"), names_today)]
        if team_names:
            return {"key": "name_day_team", "icon": "sparkles-outline", "route": messages,
                    "text": f"Имен ден в екипа: {', '.join(sorted(set(team_names))[:3])} – честито!"}

    # A record or a streak of the till - for whoever sees the revenue.
    if revenue:
        yesterday = today - timedelta(days=1)
        amount = revenue.get(yesterday.isoformat())
        if amount:
            earlier = [value for day, value in revenue.items()
                       if day < yesterday.isoformat() and day[:4] == str(yesterday.year)
                       and date.fromisoformat(day).weekday() == yesterday.weekday()]
            if len(earlier) >= RECORD_AFTER and amount > max(earlier):
                return {"key": "record", "icon": "trophy-outline", "route": "/stats",
                        "text": _t(english, f"Вчера беше {BEST_BG[yesterday.weekday()]} от началото на годината",
                                   f"Yesterday was the best {WEEKDAYS_EN[yesterday.weekday()]} this year")}
        closed_weekdays, exceptions = await get_closed_days_lookup(company_id)
        streak, day = 0, yesterday
        for _ in range(366):
            if day.isoformat() in revenue:
                streak += 1
            elif not is_date_closed(day.isoformat(), closed_weekdays, exceptions):
                break
            day -= timedelta(days=1)
        if streak >= STREAK_FROM:
            return {"key": "streak", "icon": "flame-outline", "route": "/stats",
                    "text": _t(english, f"{streak} дни подред с въведен оборот", f"{streak} days in a row with revenue entered")}

    if not english:
        names_today = dc.name_days(today)
        if names_today:
            return {"key": "name_day", "icon": "sparkles-outline", "route": None,
                    "text": f"Имен ден имат: {', '.join(names_today[:4])}"}
    return None


# ---- The line of the day.

DAY_LINE_SYSTEM = (
    "Пишеш един кратък ред за деня, който екипът на малък бизнес вижда на началния екран на програмата си. "
    "Само от дадените факти: денят, сезонът, времето, празниците и имените дни. Топло и практично, с усмивка, "
    "без клишета, без суми и цифри за продажби, без имена на хора, без обещания и без съвети, за които трябва "
    "да знаеш какво продава бизнесът. Най-много едно емоджи. До 110 знака. На езика, посочен в language."
)
DAY_LINE_SCHEMA = {
    "type": "object",
    "properties": {"line": {"type": "string"}},
    "required": ["line"],
    "additionalProperties": False,
}


def _line_facts(today: date, weather: Optional[dict], english: bool) -> dict:
    holiday_today = server._holiday_name_for_date(today.isoformat())
    holiday_tomorrow = server._holiday_name_for_date((today + timedelta(days=1)).isoformat())
    return {
        "language": "English" if english else "български",
        "day": f"{WEEKDAYS_BG[today.weekday()]}, {today.day} {MONTHS_BG[today.month - 1]}",
        "season": {"winter": "зима", "spring": "пролет", "summer": "лято", "autumn": "есен"}[dc.season_of(today)],
        "weather": {"kind": KIND_BG.get(weather["kind"]), "min": weather["min"], "max": weather["max"]} if weather else None,
        "holiday_today": holiday_today, "holiday_tomorrow": holiday_tomorrow,
        "name_days": dc.name_days(today),
    }


async def _write_line(company_id: str, today: date, language: str, facts: dict) -> None:
    """The AI's line of the day for one business, kept for the day. Never
    raises: the template line stands in whenever this has nothing."""
    key = (company_id, today.isoformat(), language)
    if key in _writing:
        return
    _writing.add(key)
    try:
        response = await server.anthropic_client.beta.messages.create(  # type: ignore[union-attr]
            model=DAY_LINE_MODEL,
            max_tokens=2000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": DAY_LINE_SCHEMA}},
            system=DAY_LINE_SYSTEM,
            messages=[{"role": "user", "content": json.dumps(facts, ensure_ascii=False)}],
        )
        await log_ai_usage(company_id, "day_line", response)
        if response.stop_reason in ("refusal", "max_tokens"):
            return
        text = next((getattr(block, "text", "") for block in response.content if block.type == "text"), "")
        line = str(json.loads(text).get("line") or "").strip()
        if 8 <= len(line) <= 200:
            await server.db.day_lines.update_one(
                {"company_id": company_id, "date": today.isoformat(), "language": language},
                {"$set": {"text": line, "created_at": datetime.now(timezone.utc)}},
                upsert=True,
            )
    except Exception as error:
        logger.warning(f"Day line not written for {company_id}: {error}")
    finally:
        _writing.discard(key)


async def _line(company_id: str, today: date, weather: Optional[dict], english: bool) -> dict:
    language = "en" if english else "bg"
    kept = await server.db.day_lines.find_one(
        {"company_id": company_id, "date": today.isoformat(), "language": language}, {"_id": 0, "text": 1},
    )
    if kept:
        return {"text": kept["text"], "source": "ai"}
    if server.AI_FEATURES_ENABLED and server.anthropic_client is not None:
        asyncio.create_task(_write_line(company_id, today, language, _line_facts(today, weather, english)))
    return {"text": dc.template_line(weather["kind"] if weather else None, today, company_id, english), "source": "template"}


# ---- The card.

async def build_day_card(current_user: User, language: str = "bg") -> dict:
    english = language == "en"
    today = today_local()
    company_id, scope = await get_company_scope(current_user)
    card: Dict[str, Any] = {
        "date": today.isoformat(),
        "greeting": {"part": dc.part_of_day(now_local()), "name": dc.first_name(current_user.name)},
        "weather": None, "line": None, "focus": [], "spark": None, "place_missing": False,
    }
    if not company_id:
        card["line"] = {"text": dc.template_line(None, today, current_user.user_id, english), "source": "template"}
        return card
    company = await server.db.companies.find_one({"id": company_id}, {"_id": 0}) or {"id": company_id}
    visibility = get_financial_visibility(current_user)

    weather, card["place_missing"] = await _weather(company, await _place_plan(company), today)
    # The till's revenue the viewer may see - for the focus, the spark and
    # the weather's effect; nothing of it for whoever has no statistics.
    revenue: Optional[Dict[str, float]] = None
    if visibility["statistics"] and company_modules(company)["till"]:
        revenue = await _revenue_by_day(scope, today - timedelta(days=370), today - timedelta(days=1), visibility["pocket_money"])
    if weather:
        effect = None
        if revenue:
            weather_log = await server.db.weather_days.find(
                {"company_id": company_id, "date": {"$lt": today.isoformat()}}, {"_id": 0, "date": 1, "kind": 1},
            ).to_list(ALL_ROWS)
            effect = dc.weather_effect(weather_log, revenue)
        weather["effect_percent"] = effect if weather["kind"] in dc.WET_KINDS else None
        weather["label"] = (KIND_EN if english else KIND_BG).get(weather["kind"])
        card["weather"] = weather
        card["attribution"] = "MET Norway"

    card["line"] = await _line(company_id, today, weather, english)
    card["focus"] = await _focus(current_user, company, scope, today, english, revenue)
    card["spark"] = await _spark(current_user, company, today, english, revenue)
    return card


class WeatherPointInput(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


@router.put("/company/weather-place")
async def set_weather_place(body: WeatherPointInput, current_user: User = Depends(get_current_user)):
    """The weather where the business is, from a device there - for when
    nothing the business entered tells where it is. Rounded to about a
    kilometre and kept for the business, never for the person."""
    require_permission(current_user, "manage_company")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    lat, lon = round(body.lat, 2), round(body.lon, 2)
    async with httpx.AsyncClient() as http:
        name = await dc.reverse_geocode(http, lat, lon)
    await server.db.companies.update_one(
        {"id": company_id},
        {"$set": {"weather_point": {"lat": lat, "lon": lon, "name": name, "at": datetime.now(timezone.utc)}}},
    )
    return {"lat": lat, "lon": lon, "name": name}


def _digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


async def remember_place_from_scan(company_id: Optional[str], extraction: dict) -> None:
    """An invoice to the business carries its address: the town in it is
    kept for the weather - only from an invoice whose buyer is the business
    itself, by its EIK or VAT number."""
    city = " ".join(str(extraction.get("buyer_city") or "").split())[:80]
    buyer = _digits(extraction.get("buyer_eik"))
    if not company_id or len(city) < 2 or not buyer:
        return
    company = await server.db.companies.find_one(
        {"id": company_id}, {"_id": 0, "eik": 1, "vat_number": 1, "weather_hint": 1},
    )
    if not company or buyer not in {_digits(company.get("eik")), _digits(company.get("vat_number"))} - {""}:
        return
    if (company.get("weather_hint") or {}).get("city") != city:
        await server.db.companies.update_one(
            {"id": company_id}, {"$set": {"weather_hint": {"city": city, "at": datetime.now(timezone.utc)}}},
        )


@router.get("/day-card")
async def get_day_card(language: Optional[str] = None, current_user: User = Depends(get_current_user)):
    """The day card for whoever opens the app - Home has it in /api/home."""
    await remember_app_language(current_user.user_id, language)
    return await build_day_card(current_user, "en" if language == "en" else "bg")

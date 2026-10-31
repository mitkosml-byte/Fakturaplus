"""Module 1 audit finding - extracted from the former monolithic server.py.
Shares server.py's db/models/helpers/services via `from server import *`;
`db` and `AI_FEATURES_ENABLED` are the two globals tests/startup reassign
after module load, so this file always accesses them as `server.db` /
`server.AI_FEATURES_ENABLED` (qualified), never via the star-import, to
stay correct when server.py's test fixture monkeypatches them. Also
explicitly imports every underscore-prefixed helper in server.py, since
`import *` never pulls those in regardless."""
from fastapi import APIRouter
from server import *
from server import (
_eik_check_digit,
    _compare_key,
    _similarity,
    _scan_packages_catalogue,
    _require_billing_enabled,
    _month_bounds,
    _compute_month_profit,
    _business_digest_period,
    _business_digest_top_expenses,
    _signal_unpaid_invoices,
    _signal_receivables,
    _signal_scan_credits,
    _signal_budget,
    _signal_price_alerts,
    _signal_reorder,
    _signal_forecast,
    _orthodox_easter,
    _holiday_name_for_date,
    _get_employee_for_company,
    _ym_add,
    _ym_diff,
    _team_channel_id,
)
import server

router = APIRouter(prefix="/api")

@router.get("/collab/members")
async def list_collab_members(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    if not current_user.company_id:
        return []
    return await get_team_members(current_user.company_id)

@router.post("/calendar/events", response_model=CalendarEvent)
async def create_calendar_event(payload: CalendarEventCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="Нямате активна фирма")
    if payload.visibility not in ("personal", "shared"):
        raise HTTPException(status_code=400, detail="Невалидна видимост")
    event = CalendarEvent(
        company_id=current_user.company_id,
        creator_id=current_user.user_id,
        creator_name=current_user.name,
        **payload.model_dump(),
    )
    await server.db.calendar_events.insert_one(event.model_dump())
    return event

@router.get("/calendar/events", response_model=List[CalendarEvent])
async def list_calendar_events(start: Optional[str] = None, end: Optional[str] = None, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    if not current_user.company_id:
        return []
    query: Dict[str, Any] = {
        "company_id": current_user.company_id,
        "$or": [{"visibility": "shared"}, {"creator_id": current_user.user_id}],
    }
    date_filter: Dict[str, Any] = {}
    if start:
        date_filter["$gte"] = start
    if end:
        date_filter["$lte"] = end
    if date_filter:
        query["event_date"] = date_filter
    events = await server.db.calendar_events.find(query, {"_id": 0}).sort("event_date", 1).to_list(1000)
    return events

@router.put("/calendar/events/{event_id}", response_model=CalendarEvent)
async def update_calendar_event(event_id: str, payload: CalendarEventUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    existing = await server.db.calendar_events.find_one({"id": event_id, "company_id": current_user.company_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Събитието не е намерено")
    if existing["creator_id"] != current_user.user_id:
        raise HTTPException(status_code=403, detail="Само създателят може да редактира това събитие")

    update_data = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if "visibility" in update_data and update_data["visibility"] not in ("personal", "shared"):
        raise HTTPException(status_code=400, detail="Невалидна видимост")
    # Any change to when the reminder should fire (or whether one exists at
    # all) needs to re-arm it - otherwise an edit made after the original
    # time had already passed would never send a reminder for the new time.
    if {"event_date", "event_time", "reminder_minutes_before"} & update_data.keys():
        update_data["reminder_sent"] = False
    if update_data:
        await server.db.calendar_events.update_one({"id": event_id}, {"$set": update_data})
    return await server.db.calendar_events.find_one({"id": event_id}, {"_id": 0})

@router.delete("/calendar/events/{event_id}")
async def delete_calendar_event(event_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    existing = await server.db.calendar_events.find_one({"id": event_id, "company_id": current_user.company_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Събитието не е намерено")
    if existing["creator_id"] != current_user.user_id:
        raise HTTPException(status_code=403, detail="Само създателят може да изтрива това събитие")
    await server.db.calendar_events.delete_one({"id": event_id})
    return {"message": "Изтрито"}

@router.get("/messages/conversations")
async def list_conversations(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    if not current_user.company_id:
        return []

    team_id = _team_channel_id(current_user.company_id)
    members = await get_team_members(current_user.company_id)
    member_by_id = {m["user_id"]: m for m in members}

    dm_conversations = await server.db.dm_conversations.find(
        {"company_id": current_user.company_id, "participant_ids": current_user.user_id}, {"_id": 0}
    ).to_list(200)

    conversation_ids = [team_id] + [c["id"] for c in dm_conversations]
    reads = await server.db.conversation_reads.find(
        {"conversation_id": {"$in": conversation_ids}, "user_id": current_user.user_id}, {"_id": 0}
    ).to_list(len(conversation_ids))
    last_read = {r["conversation_id"]: r["last_read_at"] for r in reads}

    async def summarize(conversation_id: str, name: str, picture: Optional[str]):
        last_message = await server.db.messages.find_one(
            {"conversation_id": conversation_id}, {"_id": 0}, sort=[("created_at", -1)]
        )
        unread_query: Dict[str, Any] = {"conversation_id": conversation_id, "sender_id": {"$ne": current_user.user_id}}
        if conversation_id in last_read:
            unread_query["created_at"] = {"$gt": last_read[conversation_id]}
        unread_count = await server.db.messages.count_documents(unread_query)
        return {
            "conversation_id": conversation_id,
            "name": name,
            "picture": picture,
            "last_message": last_message["text"] if last_message else None,
            "last_message_at": last_message["created_at"] if last_message else None,
            "unread_count": unread_count,
        }

    result = [await summarize(team_id, "Екипен чат", None)]
    for c in dm_conversations:
        other_id = next((uid for uid in c["participant_ids"] if uid != current_user.user_id), None)
        other = member_by_id.get(other_id)
        name = other["name"] if other else "Потребител"
        picture = other["picture"] if other else None
        result.append(await summarize(c["id"], name, picture))

    result.sort(key=lambda c: c["last_message_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return result

@router.post("/messages/dm/start")
async def start_dm(request: Request, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    body = await request.json()
    other_user_id = body.get("user_id")
    if not other_user_id or other_user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Невалиден получател")
    members = await get_team_members(current_user.company_id or "")
    if not any(m["user_id"] == other_user_id for m in members):
        raise HTTPException(status_code=404, detail="Потребителят не е намерен в екипа")
    conversation_id = await get_or_create_dm_conversation(current_user.company_id or "", current_user.user_id, other_user_id)
    return {"conversation_id": conversation_id}

@router.get("/messages/{conversation_id}")
async def get_messages(conversation_id: str, before: Optional[str] = None, limit: int = 50, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    await get_conversation_recipients(current_user, conversation_id)
    query: Dict[str, Any] = {"company_id": current_user.company_id, "conversation_id": conversation_id}
    if before:
        query["created_at"] = {"$lt": datetime.fromisoformat(before.replace("Z", "+00:00"))}
    messages = await server.db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(min(limit, 200))
    messages.reverse()
    return messages

@router.post("/messages/{conversation_id}")
async def send_message(conversation_id: str, request: Request, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Съобщението е празно")
    text = text[:2000]

    recipients = await get_conversation_recipients(current_user, conversation_id)

    now = datetime.now(timezone.utc)
    message = {
        "id": str(uuid.uuid4()),
        "company_id": current_user.company_id,
        "conversation_id": conversation_id,
        "sender_id": current_user.user_id,
        "sender_name": current_user.name,
        "text": text,
        "created_at": now,
    }
    await server.db.messages.insert_one(dict(message))
    await server.db.conversation_reads.update_one(
        {"conversation_id": conversation_id, "user_id": current_user.user_id},
        {"$set": {"last_read_at": now, "company_id": current_user.company_id}},
        upsert=True,
    )
    background_tasks.add_task(notify_new_message, conversation_id, current_user, text, recipients)
    return message

@router.post("/messages/{conversation_id}/read")
async def mark_conversation_read(conversation_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "team_collaboration")
    await get_conversation_recipients(current_user, conversation_id)
    await server.db.conversation_reads.update_one(
        {"conversation_id": conversation_id, "user_id": current_user.user_id},
        {"$set": {"last_read_at": datetime.now(timezone.utc), "company_id": current_user.company_id}},
        upsert=True,
    )
    return {"message": "OK"}

@router.post("/push/subscribe")
async def push_subscribe(payload: PushSubscriptionIn, current_user: User = Depends(get_current_user)):
    await server.db.push_subscriptions.update_one(
        {"endpoint": payload.endpoint},
        {"$set": {
            "user_id": current_user.user_id,
            "company_id": current_user.company_id,
            "endpoint": payload.endpoint,
            "keys": payload.keys,
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    return {"message": "OK"}

@router.post("/push/unsubscribe")
async def push_unsubscribe(request: Request, current_user: User = Depends(get_current_user)):
    body = await request.json()
    endpoint = body.get("endpoint")
    if endpoint:
        await server.db.push_subscriptions.delete_one({"endpoint": endpoint, "user_id": current_user.user_id})
    return {"message": "OK"}

@router.post("/feedback")
async def submit_feedback(payload: FeedbackCreate, current_user: User = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "message": payload.message,
        "is_anonymous": payload.is_anonymous,
        "created_at": datetime.now(timezone.utc),
    }
    # An anonymous submission carries no identity at all, by design - not
    # even for internal linking - so the choice the user made in the app is
    # actually honored, not just hidden in the UI.
    if not payload.is_anonymous:
        doc["user_name"] = current_user.name
        doc["user_email"] = current_user.email
        doc["company_id"] = current_user.company_id
    await server.db.feedback_submissions.insert_one(doc)
    return {"message": "OK"}

@router.get("/feedback")
async def list_feedback(current_user: User = Depends(get_current_user)):
    # There's no support domain/inbox yet (see privacy-policy.tsx note) - this
    # is a stopgap so submitted feedback is actually reachable in the
    # meantime, restricted to the app's own developer rather than any
    # company's owner.
    if current_user.email != ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Няма достъп")
    items = await server.db.feedback_submissions.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items

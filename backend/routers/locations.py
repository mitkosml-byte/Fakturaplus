"""The business's locations (Н11): shops, sites, branches - each one's
revenue, expenses and team, side by side.

What can be told apart is: the till's revenue of each location (entered
per location, kept as a split of the day - routers/revenue_expenses),
invoices issued, supplier invoices and expenses marked for one, and the
payroll of the employees who work there. What belongs to no location -
depreciation, an invoice for the whole business, a day entered before
there were locations - is shown as shared. The locations and the shared
part add up to the business's own numbers, the same as on Home and in
Statistics, never more and never less."""
from fastapi import APIRouter
from server import *
import server

router = APIRouter(prefix="/api")


class LocationInput(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    address: Optional[str] = Field(default=None, max_length=300)
    is_active: Optional[bool] = None


def _require_manage(user: User) -> None:
    require_permission(user, "manage_company")


async def company_locations(company_id: Optional[str], active_only: bool = False) -> List[dict]:
    if not company_id:
        return []
    query: Dict[str, Any] = {"company_id": company_id}
    if active_only:
        query["is_active"] = {"$ne": False}
    return await server.db.locations.find(query, {"_id": 0}).sort("created_at", 1).to_list(ALL_ROWS)


async def company_has_locations(company_id: Optional[str]) -> bool:
    """Any location, closed ones too (what was entered for them stays theirs)."""
    return bool(company_id) and await server.db.locations.find_one({"company_id": company_id}, {"_id": 1}) is not None


async def require_location(company_id: Optional[str], location_id: Optional[str]) -> Optional[str]:
    """A location of this business ("" or None: none)."""
    if not location_id:
        return None
    if not company_id or not await server.db.locations.find_one({"id": location_id, "company_id": company_id}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Обектът не е намерен")
    return location_id


async def _location(company_id: Optional[str], location_id: str) -> dict:
    location = await server.db.locations.find_one({"id": location_id, "company_id": company_id}, {"_id": 0}) if company_id else None
    if not location:
        raise HTTPException(status_code=404, detail="Обектът не е намерен")
    return location


@router.get("/locations")
async def list_locations(current_user: User = Depends(get_current_user)):
    """The business's locations - for everyone in it (the forms pick one)."""
    company_id, _ = await get_company_scope(current_user)
    return [
        {key: location.get(key) for key in ("id", "name", "address")} | {"is_active": location.get("is_active", True)}
        for location in await company_locations(company_id)
    ]


@router.post("/locations")
async def create_location(payload: LocationInput, current_user: User = Depends(get_current_user)):
    _require_manage(current_user)
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Посочете името на обекта")
    if any(l.get("name", "").strip().lower() == name.lower() for l in await company_locations(company_id)):
        raise HTTPException(status_code=409, detail=f"Обект „{name}“ вече има")
    location = {
        "id": str(uuid.uuid4()), "company_id": company_id, "name": name,
        "address": (payload.address or "").strip() or None, "is_active": True,
        "created_at": datetime.now(timezone.utc),
    }
    await server.db.locations.insert_one(dict(location))
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="create", entity_type="location",
        entity_id=location["id"], company_id=company_id, details={"name": name},
    )
    return {key: location[key] for key in ("id", "name", "address", "is_active")}


@router.put("/locations/{location_id}")
async def update_location(location_id: str, payload: LocationInput, current_user: User = Depends(get_current_user)):
    """A new name or address, or closed (is_active false): what was entered
    for it stays its."""
    _require_manage(current_user)
    company_id, _ = await get_company_scope(current_user)
    await _location(company_id, location_id)
    update = payload.model_dump(exclude_unset=True)
    if "name" in update:
        update["name"] = (update["name"] or "").strip()
        if not update["name"]:
            raise HTTPException(status_code=400, detail="Посочете името на обекта")
        if any(
            l["id"] != location_id and l.get("name", "").strip().lower() == update["name"].lower()
            for l in await company_locations(company_id)
        ):
            raise HTTPException(status_code=409, detail=f"Обект „{update['name']}“ вече има")
    if update.get("is_active") is None:
        update.pop("is_active", None)
    if "address" in update:
        update["address"] = (update["address"] or "").strip() or None
    if update:
        await server.db.locations.update_one({"id": location_id, "company_id": company_id}, {"$set": update})
    location = await server.db.locations.find_one({"id": location_id}, {"_id": 0})
    return {key: location.get(key) for key in ("id", "name", "address")} | {"is_active": location.get("is_active", True)}


@router.delete("/locations/{location_id}")
async def delete_location(location_id: str, current_user: User = Depends(get_current_user)):
    """Only a location nothing was entered for; one with records is closed instead."""
    _require_manage(current_user)
    company_id, scope = await get_company_scope(current_user)
    location = await _location(company_id, location_id)
    used = (
        await server.db.daily_revenue.find_one({**scope, f"by_location.{location_id}": {"$exists": True}}, {"_id": 1})
        or await server.db.invoices.find_one({**scope, "location_id": location_id}, {"_id": 1})
        or await server.db.expenses.find_one({**scope, "location_id": location_id}, {"_id": 1})
        or await server.db.employees.find_one({"company_id": company_id, "location_id": location_id}, {"_id": 1})
        or await server.db.billing_documents.find_one({**scope, "location_id": location_id}, {"_id": 1})
        or await server.db.recurring_invoices.find_one({**scope, "location_id": location_id}, {"_id": 1})
    )
    if used:
        raise HTTPException(status_code=409, detail="За обекта има въведени записи - затворете го вместо да го изтривате")
    await server.db.locations.delete_one({"id": location_id, "company_id": company_id})
    await audit_service.log_action(
        user_id=current_user.user_id, user_name=current_user.name, action="delete", entity_type="location",
        entity_id=location_id, company_id=company_id, details={"name": location.get("name")},
    )
    return {"deleted": True}


async def _payroll_by_location(company_id: Optional[str], user_id: str, period: Period) -> Dict[str, float]:
    """The payroll of the period (as period_totals counts it: each month's
    entry by the share of its days) of the employees of each location."""
    employees = await server.db.employees.find(
        {"company_id": company_id, "location_id": {"$nin": [None, ""]}}, {"_id": 0, "id": 1, "location_id": 1},
    ).to_list(ALL_ROWS) if company_id else []
    where = {e["id"]: e["location_id"] for e in employees}
    if not where:
        return {}
    entries = await server.db.payroll_entries.find(
        {**simple_scope_query(company_id, user_id), "employee_id": {"$in": list(where)}},
        {"_id": 0, "employee_id": 1, "period_month": 1, "period_year": 1, "total_employer_cost": 1, "counted_in_expenses": 1},
    ).to_list(ALL_ROWS)
    totals: Dict[str, float] = {}
    for entry in entries:
        if entry.get("counted_in_expenses") is False:
            continue
        share = period.month_share(int(entry["period_year"]), int(entry["period_month"]))
        if share:
            location = where[entry["employee_id"]]
            totals[location] = totals.get(location, 0.0) + float(entry.get("total_employer_cost") or 0) * share
    return totals


async def _sum_by_location(collection: Any, match: dict, field: str) -> Dict[str, float]:
    rows = await collection.aggregate([
        {"$match": {**match, "location_id": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$location_id", "total": {"$sum": f"${field}"}}},
    ]).to_list(ALL_ROWS)
    return {row["_id"]: float(row.get("total") or 0) for row in rows}


async def compare_locations(company_id: Optional[str], scope: dict, user: User, asked: Period) -> dict:
    # A period still running counts through today, as everywhere (counted_period).
    period = counted_period(asked)
    visibility = get_financial_visibility(user)
    show_pocket, show_off_book = visibility["pocket_money"], visibility["off_book_expenses"]
    locations = await company_locations(company_id)

    fiscal: Dict[str, float] = {}
    pocket: Dict[str, float] = {}
    open_days: Dict[str, int] = {}
    days = await server.db.daily_revenue.find(
        {**scope, "date": period.text_filter(), "by_location": {"$exists": True}}, {"_id": 0, "by_location": 1},
    ).to_list(ALL_ROWS)
    for day in days:
        for location_id, entry in (day.get("by_location") or {}).items():
            fiscal[location_id] = fiscal.get(location_id, 0.0) + float(entry.get("fiscal_revenue") or 0)
            pocket[location_id] = pocket.get(location_id, 0.0) + float(entry.get("pocket_money") or 0)
            if float(entry.get("fiscal_revenue") or 0) > 0:
                open_days[location_id] = open_days.get(location_id, 0) + 1
    issued = await _sum_by_location(
        server.db.billing_documents, {**scope, **ISSUED_INVOICE_REVENUE, "issue_date": period.text_filter()}, "total_amount",
    )
    invoices = await _sum_by_location(server.db.invoices, {**scope, "date": period.datetime_filter(), **NOT_AN_ASSET}, "total_amount")
    expenses = await _sum_by_location(server.db.expenses, {**scope, "date": period.text_filter(), **NOT_WAGES}, "amount")
    payroll = await _payroll_by_location(company_id, user.user_id, period)
    team = {
        row["_id"]: int(row["count"]) for row in await server.db.employees.aggregate([
            {"$match": {"company_id": company_id, "active": {"$ne": False}, "location_id": {"$nin": [None, ""]}}},
            {"$group": {"_id": "$location_id", "count": {"$sum": 1}}},
        ]).to_list(ALL_ROWS)
    } if company_id else {}

    rows = []
    for location in locations:
        lid = location["id"]
        income = fiscal.get(lid, 0.0) + (pocket.get(lid, 0.0) if show_pocket else 0.0) + issued.get(lid, 0.0)
        expense = invoices.get(lid, 0.0) + (expenses.get(lid, 0.0) if show_off_book else 0.0) + payroll.get(lid, 0.0)
        revenue_days = open_days.get(lid, 0)
        rows.append({
            "id": lid, "name": location.get("name"), "is_active": location.get("is_active", True),
            "income": round(income, 2), "expense": round(expense, 2), "profit": round(income - expense, 2),
            "margin_percent": round((income - expense) / income * 100, 1) if income > 0 else None,
            "revenue_days": revenue_days,
            "revenue_per_day": round(fiscal.get(lid, 0.0) / revenue_days, 2) if revenue_days else None,
            "parts": {
                "till": round(fiscal.get(lid, 0.0), 2), "issued_invoices": round(issued.get(lid, 0.0), 2),
                "purchases": round(invoices.get(lid, 0.0), 2), "off_book": round(expenses.get(lid, 0.0), 2) if show_off_book else None,
                "payroll": round(payroll.get(lid, 0.0), 2),
            },
            "team": team.get(lid, 0),
        })
    # The business's own numbers, as everywhere else: what no location holds is shared.
    total_income, total_expense = period_income_expense(
        await period_totals(company_id, scope, user.user_id, period), visibility,
    )
    shared_income = total_income - sum(row["income"] for row in rows)
    shared_expense = total_expense - sum(row["expense"] for row in rows)
    return {
        "period": {"start": period.start.isoformat(), "end": period.end.isoformat()},
        "locations": rows,
        "shared": {"income": round(shared_income, 2), "expense": round(shared_expense, 2), "profit": round(shared_income - shared_expense, 2)},
        "total": {"income": round(total_income, 2), "expense": round(total_expense, 2), "profit": round(total_income - total_expense, 2)},
    }


@router.get("/locations/compare")
async def get_location_comparison(
    start_date: Optional[str] = None, end_date: Optional[str] = None, current_user: User = Depends(get_current_user),
):
    if not sees_cash_flow(current_user):
        raise HTTPException(status_code=403, detail="Нямате права да виждате печалбата")
    company_id, scope = await get_company_scope(current_user)
    try:
        period = Period.parse(start_date, end_date, default=Period.month(server.today_local().year, server.today_local().month))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    return await compare_locations(company_id, scope, current_user, period)

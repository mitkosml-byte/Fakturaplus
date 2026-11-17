"""The business's own selling prices and the margin they leave (Н8).

One price list, the same price everywhere: on an invoice without VAT (the
VAT on top), on a bill or a quote what the customer pays. Each price can
name what it is made of - the items bought on supplier invoices and how
much of each (one bottle; or 9 g of coffee and 150 ml of milk) - so the
program knows its cost from the latest purchases and the margin it leaves.

When purchase prices rise, it says how far the margin fell since the price
was set and what price would keep it: "маржът падна от 38% на 31% - за
същия марж: 2.68 €". The person decides: a new price, or keep this one.
Nothing changes a price by itself.

Costs are without VAT for a business registered for VAT (it gets the VAT
back) and with the VAT it paid for one that is not."""
import re

from fastapi import APIRouter
from server import *
import server

router = APIRouter(prefix="/api")

# Who sets the business's prices.
PRICE_LIST_ROLES = {"owner", "manager"}
# A margin this many points lower than when the price was set is said.
MARGIN_DROP_POINTS = 2.0


class CostPart(BaseModel):
    # A purchased item as the program keeps it (GET /price-list/purchase-items).
    item_name: str = Field(min_length=1, max_length=200)
    # How much of it goes into one unit sold, in the unit it is bought in.
    quantity: float = Field(gt=0, le=100000)
    unit: Optional[str] = Field(default=None, max_length=20)


class PriceEntryInput(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    unit: Optional[str] = Field(default=None, max_length=20)
    # Without VAT - on an invoice the VAT goes on top.
    price: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    vat_rate: Optional[float] = Field(default=None, ge=0, le=100)
    costs: Optional[List[CostPart]] = Field(default=None, max_length=30)


def _sees_costs(user: User) -> bool:
    permissions = set(user.permissions or [])
    return bool({"view_statistics", "manage_invoices"} & permissions)


def _may_read(user: User) -> bool:
    return bool({"add_revenue", "issue_invoices", "view_statistics", "manage_invoices"} & set(user.permissions or []))


def _may_edit(user: User) -> bool:
    return user.role in PRICE_LIST_ROLES


def _require_read(user: User) -> None:
    if not _may_read(user):
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")


def _require_edit(user: User) -> None:
    if not _may_edit(user):
        raise HTTPException(status_code=403, detail="Цените се определят от собственика или управителя")


async def _vat_registered(company_id: Optional[str]) -> bool:
    company = await server.db.companies.find_one({"id": company_id}, {"_id": 0, "vat_registered": 1, "vat_number": 1}) if company_id else None
    return company_vat_registered(company)


async def purchase_prices(company_id: Optional[str], parts: List[dict], vat_registered: bool) -> Dict[Tuple[str, str], dict]:
    """The latest purchase of each part's item, in the part's unit when it
    was bought in it (else in any): its price per unit - with the VAT paid,
    for a business that cannot get it back. Keyed by (item, unit)."""
    names = sorted({part["item_name"] for part in parts})
    if not company_id or not names:
        return {}
    rows = await server.db.item_price_history.find(
        {"company_id": company_id, "item_name": {"$in": names}},
        {"_id": 0, "item_name": 1, "unit_price": 1, "unit": 1, "supplier": 1, "invoice_date": 1, "invoice_id": 1},
    ).sort("invoice_date", -1).to_list(ALL_ROWS)
    found: Dict[Tuple[str, str], dict] = {}
    for part in parts:
        unit = (part.get("unit") or "").strip().lower()
        same_item = [row for row in rows if row["item_name"] == part["item_name"]]
        row = next((r for r in same_item if (r.get("unit") or "").strip().lower() == unit), None) if unit else None
        row = row or (same_item[0] if same_item else None)
        if row:
            found[(part["item_name"], unit)] = dict(row)
    if not vat_registered and found:
        # The VAT on the invoice it was bought on, as a share of its base.
        invoice_ids = list({row["invoice_id"] for row in found.values() if row.get("invoice_id")})
        invoices = {
            i["id"]: i for i in await server.db.invoices.find(
                {"company_id": company_id, "id": {"$in": invoice_ids}}, {"_id": 0, "id": 1, "amount_without_vat": 1, "vat_amount": 1},
            ).to_list(ALL_ROWS)
        }
        for row in found.values():
            invoice = invoices.get(row.get("invoice_id") or "")
            base = float((invoice or {}).get("amount_without_vat") or 0)
            share = float((invoice or {}).get("vat_amount") or 0) / base if base > 0 else 0.0
            row["unit_price"] = float(row.get("unit_price") or 0) * (1 + max(share, 0.0))
    return found


def cost_of(parts: List[dict], prices: Dict[Tuple[str, str], dict]) -> Tuple[Optional[float], List[dict]]:
    """What one unit sold costs now, and of what - None while a part has
    never been bought."""
    lines = []
    total = 0.0
    complete = bool(parts)
    for part in parts:
        row = prices.get((part["item_name"], (part.get("unit") or "").strip().lower()))
        if not row:
            complete = False
            lines.append({**part, "unit_price": None, "line_cost": None, "supplier": None, "date": None})
            continue
        unit_price = float(row.get("unit_price") or 0)
        line = unit_price * float(part["quantity"])
        total += line
        day = row.get("invoice_date")
        lines.append({
            **part, "unit": part.get("unit") or row.get("unit"), "unit_price": round(unit_price, 4), "line_cost": round(line, 4),
            "supplier": row.get("supplier"), "date": day.strftime("%Y-%m-%d") if isinstance(day, datetime) else str(day or "")[:10],
        })
    return (round(total, 4) if complete else None), lines


def margin(price: float, cost: Optional[float]) -> Optional[float]:
    if cost is None or price <= 0:
        return None
    return (price - cost) / price


def gross(price: float, vat_rate: float, vat_registered: bool) -> float:
    """What the customer pays: the VAT on top for a business that charges it."""
    return round(price * (1 + vat_rate / 100) if vat_registered else price, 2)


def entry_view(entry: dict, prices: Dict[Tuple[str, str], dict], vat_registered: bool, sees_costs: bool) -> dict:
    price = float(entry.get("price") or 0)
    stored_rate = entry.get("vat_rate")
    vat_rate = float(stored_rate) if stored_rate is not None else 20.0
    view: Dict[str, Any] = {
        "id": entry["id"], "name": entry.get("name"), "unit": entry.get("unit") or "бр.",
        "price": round(price, 2), "vat_rate": vat_rate if vat_registered else 0,
        "price_gross": gross(price, vat_rate, vat_registered), "price_set_at": entry.get("price_set_at"),
    }
    if not sees_costs:
        return view
    cost, lines = cost_of(entry.get("costs") or [], prices)
    then_cost = entry.get("cost_at_price")
    now, then = margin(price, cost), margin(price, then_cost)
    dropped = (
        now is not None and then is not None and cost is not None and then_cost is not None
        and cost > then_cost and (then - now) * 100 >= MARGIN_DROP_POINTS
    )
    suggested = round(cost / (1 - then), 2) if dropped and cost is not None and then is not None and then < 1 else None
    view.update({
        "costs": lines, "cost": round(cost, 2) if cost is not None else None,
        "cost_at_price": round(float(then_cost), 2) if then_cost is not None else None,
        "margin_percent": round(now * 100, 1) if now is not None else None,
        "margin_then_percent": round(then * 100, 1) if then is not None else None,
        "margin_dropped": dropped,
        "suggested_price": suggested,
        "suggested_gross": gross(suggested, vat_rate, vat_registered) if suggested is not None else None,
    })
    return view


async def _entries_view(company_id: Optional[str], scope: dict, user: User) -> List[dict]:
    entries = await server.db.price_list.find(scope, {"_id": 0}).sort("name", 1).to_list(ALL_ROWS)
    vat = await _vat_registered(company_id)
    sees = _sees_costs(user)
    prices = await purchase_prices(company_id, [part for e in entries for part in e.get("costs") or []], vat) if sees else {}
    return [entry_view(e, prices, vat, sees) for e in entries]


async def _current_cost(company_id: Optional[str], parts: List[dict]) -> Optional[float]:
    vat = await _vat_registered(company_id)
    cost, _ = cost_of(parts, await purchase_prices(company_id, parts, vat))
    return cost


async def _entry(scope: dict, entry_id: str) -> dict:
    entry = await server.db.price_list.find_one({"id": entry_id, **scope}, {"_id": 0})
    if not entry:
        raise HTTPException(status_code=404, detail="Цената не е намерена")
    return entry


async def _one(company_id: Optional[str], scope: dict, user: User, entry_id: str) -> dict:
    vat = await _vat_registered(company_id)
    entry = await _entry(scope, entry_id)
    prices = await purchase_prices(company_id, entry.get("costs") or [], vat)
    return entry_view(entry, prices, vat, _sees_costs(user))


@router.get("/price-list")
async def get_price_list(current_user: User = Depends(get_current_user)):
    _require_read(current_user)
    company_id, scope = await get_company_scope(current_user)
    return {
        "entries": await _entries_view(company_id, scope, current_user),
        "can_edit": _may_edit(current_user), "sees_costs": _sees_costs(current_user),
        "vat_registered": await _vat_registered(company_id),
    }


@router.post("/price-list")
async def create_price_entry(payload: PriceEntryInput, current_user: User = Depends(get_current_user)):
    _require_edit(current_user)
    company_id, scope = await get_company_scope(current_user)
    name = (payload.name or "").strip()
    if not name or payload.price is None:
        raise HTTPException(status_code=400, detail="Посочете името и цената")
    if await server.db.price_list.find_one({**scope, "name_key": name.lower()}, {"_id": 1}):
        raise HTTPException(status_code=409, detail=f"„{name}“ вече е в ценоразписа")
    costs = [part.model_dump() for part in payload.costs or []]
    now = datetime.now(timezone.utc)
    entry = {
        "id": str(uuid.uuid4()), "company_id": company_id, "user_id": current_user.user_id,
        "name": name, "name_key": name.lower(), "unit": (payload.unit or "бр.").strip() or "бр.",
        "price": round(payload.price, 2), "vat_rate": payload.vat_rate if payload.vat_rate is not None else 20,
        "costs": costs, "cost_at_price": await _current_cost(company_id, costs),
        "price_set_at": now, "history": [{"price": round(payload.price, 2), "at": now, "by": current_user.user_id}],
        "created_at": now,
    }
    await server.db.price_list.insert_one(dict(entry))
    return await _one(company_id, scope, current_user, entry["id"])


@router.put("/price-list/{entry_id}")
async def update_price_entry(entry_id: str, payload: PriceEntryInput, current_user: User = Depends(get_current_user)):
    """A new price (or what it is made of): the margin it leaves now is the
    one later purchases are compared with."""
    _require_edit(current_user)
    company_id, scope = await get_company_scope(current_user)
    entry = await _entry(scope, entry_id)
    update: Dict[str, Any] = {}
    if payload.name is not None and payload.name.strip() != entry.get("name"):
        name = payload.name.strip()
        if await server.db.price_list.find_one({**scope, "name_key": name.lower(), "id": {"$ne": entry_id}}, {"_id": 1}):
            raise HTTPException(status_code=409, detail=f"„{name}“ вече е в ценоразписа")
        update.update(name=name, name_key=name.lower())
    if payload.unit is not None:
        update["unit"] = payload.unit.strip() or "бр."
    if payload.vat_rate is not None:
        update["vat_rate"] = payload.vat_rate
    costs = [part.model_dump() for part in payload.costs] if payload.costs is not None else entry.get("costs") or []
    if payload.costs is not None:
        update["costs"] = costs
    now = datetime.now(timezone.utc)
    new_price = payload.price is not None and abs(round(payload.price, 2) - float(entry.get("price") or 0)) > 0.0049
    if new_price:
        assert payload.price is not None
        update.update(price=round(payload.price, 2), price_set_at=now)
        history = [*(entry.get("history") or []), {"price": round(payload.price, 2), "at": now, "by": current_user.user_id}]
        update["history"] = history[-24:]
    if new_price or payload.costs is not None:
        update["cost_at_price"] = await _current_cost(company_id, costs)
    if update:
        await server.db.price_list.update_one({"id": entry_id, **scope}, {"$set": update})
    if new_price:
        await audit_service.log_action(
            user_id=current_user.user_id, user_name=current_user.name, action="update", entity_type="price",
            entity_id=entry_id, company_id=company_id,
            details={"name": update.get("name", entry.get("name")), "old_price": entry.get("price"), "new_price": update["price"]},
        )
    return await _one(company_id, scope, current_user, entry_id)


@router.post("/price-list/{entry_id}/keep")
async def keep_price(entry_id: str, current_user: User = Depends(get_current_user)):
    """The price stays as it is: the margin it leaves now is the new measure."""
    _require_edit(current_user)
    company_id, scope = await get_company_scope(current_user)
    entry = await _entry(scope, entry_id)
    await server.db.price_list.update_one(
        {"id": entry_id, **scope}, {"$set": {"cost_at_price": await _current_cost(company_id, entry.get("costs") or [])}},
    )
    return await _one(company_id, scope, current_user, entry_id)


@router.delete("/price-list/{entry_id}")
async def delete_price_entry(entry_id: str, current_user: User = Depends(get_current_user)):
    _require_edit(current_user)
    _, scope = await get_company_scope(current_user)
    await _entry(scope, entry_id)
    await server.db.price_list.delete_one({"id": entry_id, **scope})
    return {"deleted": True}


@router.get("/price-list/purchase-items")
async def get_purchase_items(q: str = "", current_user: User = Depends(get_current_user)):
    """The items bought on supplier invoices, to say what a price is made
    of - each with its latest purchase."""
    if not _sees_costs(current_user):
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        return []
    query: Dict[str, Any] = {"company_id": company_id}
    words = q.strip().lower()
    if words:
        query["item_name"] = {"$regex": re.escape(words)}
    rows = await server.db.item_price_history.find(
        query, {"_id": 0, "item_name": 1, "unit_price": 1, "unit": 1, "supplier": 1, "invoice_date": 1},
    ).sort("invoice_date", -1).to_list(2000)
    latest: Dict[str, dict] = {}
    for row in rows:
        latest.setdefault(row["item_name"], row)
    items = []
    for name, row in list(latest.items())[:40]:
        day = row.get("invoice_date")
        items.append({
            "item_name": name, "unit": row.get("unit"), "unit_price": round(float(row.get("unit_price") or 0), 4),
            "supplier": row.get("supplier"), "date": day.strftime("%Y-%m-%d") if isinstance(day, datetime) else str(day or "")[:10],
        })
    return items


@router.get("/price-list/sold-items")
async def get_sold_items(current_user: User = Depends(get_current_user)):
    """What was sold on invoices and bills but is not in the price list yet
    - one tap to add, at the price last charged (without VAT)."""
    _require_read(current_user)
    company_id, scope = await get_company_scope(current_user)
    listed = {e.get("name_key") for e in await server.db.price_list.find(scope, {"_id": 0, "name_key": 1}).to_list(ALL_ROWS)}
    vat = await _vat_registered(company_id)
    documents = await server.db.billing_documents.find(
        {**scope, "doc_type": {"$in": ["invoice", "bill", "quote"]}, "cancelled": {"$ne": True}},
        {"_id": 0, "doc_type": 1, "items": 1, "issue_date": 1},
    ).sort("issue_date", -1).to_list(500)
    sold: Dict[str, dict] = {}
    for document in documents:
        for item in document.get("items") or []:
            name = str(item.get("name") or "").strip()
            key = name.lower()
            if not name or key in listed:
                continue
            if key in sold:
                sold[key]["count"] += 1
                continue
            vat_rate = float(item.get("vat_rate") if item.get("vat_rate") is not None else 20)
            price = float(item.get("unit_price") or 0)
            # A bill's price is what the customer paid: the VAT comes off.
            if document.get("doc_type") != "invoice" and vat:
                price = price / (1 + vat_rate / 100)
            sold[key] = {"name": name, "unit": item.get("unit") or "бр.", "price": round(price, 2), "vat_rate": vat_rate,
                         "last_sold": document.get("issue_date"), "count": 1}
    return sorted(sold.values(), key=lambda s: (-s["count"], s["name"]))[:30]


async def margins_signal(company_id: Optional[str], scope: dict, current_user: User) -> Optional[dict]:
    """Prices whose margin fell since they were set, as purchases got dearer."""
    if not (_may_edit(current_user) and _sees_costs(current_user)):
        return None
    dropped = [e for e in await _entries_view(company_id, scope, current_user) if e.get("margin_dropped")]
    if not dropped:
        return None
    dropped.sort(key=lambda e: (e["margin_then_percent"] - e["margin_percent"]), reverse=True)
    top = dropped[0]
    vat = await _vat_registered(company_id)
    price = f"{top['suggested_gross']:.2f} €" + (" с ДДС" if vat else "")
    more = f" И още {len(dropped) - 1} {'цена' if len(dropped) == 2 else 'цени'}." if len(dropped) > 1 else ""
    return {
        "key": "margins", "severity": "warning", "priority": 58, "title": "Покупните цени поскъпнаха",
        "detail": (
            f"Маржът на „{top['name']}“ падна от {top['margin_then_percent']:.0f}% на {top['margin_percent']:.0f}% - "
            f"за същия марж: {price}.{more}"
        ),
        "route": "/price-list",
        "fingerprint": "margins|" + "|".join(sorted(f"{e['id']}:{e['cost']}" for e in dropped)),
    }

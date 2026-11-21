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
import re

router = APIRouter(prefix="/api")

@router.get("/assets/categories")
async def get_asset_categories(current_user: User = Depends(get_current_user)):
    return {
        "categories": [{"value": k, **v} for k, v in ASSET_CATEGORY_INFO.items()],
        "low_value_threshold": ASSET_LOW_VALUE_THRESHOLD_EUR,
    }

async def _attach_invoice(scope: dict, asset_id: str, invoice_id: str) -> str:
    """Links an asset to its purchase invoice; returns the invoice's label.
    The invoice then stops being an expense of its day (period_totals'
    NOT_AN_ASSET) - the asset's depreciation is its expense - while its VAT
    stays a credit."""
    invoice = await server.db.invoices.find_one(
        {"id": invoice_id, **scope},
        {"_id": 0, "id": 1, "asset_id": 1, "supplier": 1, "invoice_number": 1, "document_type": 1},
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    if invoice.get("document_type") == CREDIT_NOTE:
        raise HTTPException(status_code=409, detail="Кредитното известие не е покупка - актив се свързва с фактурата, с която е купен")
    if invoice.get("asset_id") and invoice["asset_id"] != asset_id:
        raise HTTPException(status_code=409, detail="Тази фактура вече е свързана с друг актив")
    await server.db.invoices.update_one({"id": invoice_id, **scope}, {"$set": {"asset_id": asset_id}})
    return f"{invoice.get('supplier') or ''} № {invoice.get('invoice_number') or ''}".strip()


async def _detach_invoice(scope: dict, asset_id: str, invoice_id: Optional[str]) -> None:
    """The invoice is an expense of its day again."""
    if invoice_id:
        await server.db.invoices.update_one({"id": invoice_id, "asset_id": asset_id, **scope}, {"$set": {"asset_id": None}})


@router.get("/assets/linkable-invoices")
async def get_linkable_invoices(
    search: Optional[str] = None, invoice_id: Optional[str] = None, current_user: User = Depends(get_current_user),
):
    """Recent invoices an asset can be linked to (its purchase invoice), or
    one by id ("Record as an asset" from an invoice) - for whoever manages
    both assets and invoices."""
    require_permission(current_user, "manage_budget")
    require_permission(current_user, "manage_invoices")
    _, scope = await get_company_scope(current_user)
    # Purchases only - a credit note is never an asset's purchase invoice.
    query: Dict[str, Any] = {**scope, **NOT_A_CREDIT_NOTE}
    if invoice_id:
        query = {"$and": [scope, NOT_A_CREDIT_NOTE, {"id": invoice_id}]}
    elif search and search.strip():
        pattern = {"$regex": re.escape(search.strip()), "$options": "i"}
        query = {"$and": [scope, NOT_A_CREDIT_NOTE, {"$or": [{"supplier": pattern}, {"invoice_number": pattern}]}]}
    invoices = await server.db.invoices.find(
        query, {"_id": 0, "id": 1, "supplier": 1, "invoice_number": 1, "date": 1, "total_amount": 1,
                "amount_without_vat": 1, "asset_id": 1, "items": {"$slice": 1}},
    ).sort("date", -1).limit(40).to_list(40)
    def _day_text(value: Any) -> Optional[str]:
        day = business_day(value)
        return day.isoformat() if day else None

    return [
        {
            "id": inv["id"], "supplier": inv.get("supplier"), "invoice_number": inv.get("invoice_number"),
            "date": _day_text(inv.get("date")),
            "total_amount": inv.get("total_amount", 0), "amount_without_vat": inv.get("amount_without_vat", 0),
            "first_item": ((inv.get("items") or [{}])[0] or {}).get("name"),
            "asset_id": inv.get("asset_id"),
        }
        for inv in invoices
    ]


@router.post("/assets", response_model=FixedAsset)
async def create_asset(asset: FixedAssetCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    if asset.invoice_id:
        require_permission(current_user, "manage_invoices")

    category_info = ASSET_CATEGORY_INFO[asset.category.value]
    rate = asset.annual_depreciation_rate_percent
    if rate is None:
        rate = category_info["max_rate"]
    elif rate > category_info["max_rate"] and asset.category.value != "cat_vi":
        raise HTTPException(status_code=400, detail=f"Нормата не може да надвишава {category_info['max_rate']}% за {category_info['label']}")
    elif rate <= 0:
        raise HTTPException(status_code=400, detail="Нормата трябва да е положително число")

    inventory_number = await next_asset_inventory_number(company_id, current_user.user_id)

    asset_obj = FixedAsset(
        user_id=current_user.user_id,
        company_id=company_id,
        inventory_number=inventory_number,
        annual_depreciation_rate_percent=rate,
        **asset.model_dump(exclude={"annual_depreciation_rate_percent"})
    )
    if asset.invoice_id:
        asset_obj.invoice_label = await _attach_invoice(scope, asset_obj.id, asset.invoice_id)
    await server.db.assets.insert_one(asset_obj.model_dump())

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="create",
        entity_type="asset",
        entity_id=asset_obj.id,
        company_id=company_id,
        details={"name": asset_obj.name, "inventory_number": inventory_number, "acquisition_value": asset_obj.acquisition_value}
    )

    return enrich_asset_with_depreciation(asset_obj.model_dump())

@router.get("/assets")
async def get_assets(status: Optional[str] = None, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    # get_company_scope-based scope, matching update/dispose/delete_asset
    # below (not simple_scope_query) - otherwise a legacy pre-company-id
    # asset would still be reachable by ID through those, but invisible in
    # this very list (Module 1 audit finding).
    _, scope = await get_company_scope(current_user)

    assets = await server.db.assets.find(scope, {"_id": 0}).sort("created_at", -1).to_list(ALL_ROWS)
    enriched = [enrich_asset_with_depreciation(a) for a in assets]
    if status:
        enriched = [a for a in enriched if a["status"] == status]
    return enriched

@router.get("/assets/summary")
async def get_assets_summary(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)

    assets = await server.db.assets.find(scope, {"_id": 0}).to_list(ALL_ROWS)
    enriched = [enrich_asset_with_depreciation(a) for a in assets]

    active = [a for a in enriched if a["status"] != "disposed"]
    disposed = [a for a in enriched if a["status"] == "disposed"]

    return {
        "total_acquisition_value": round(sum(a["acquisition_value"] for a in active), 2),
        "total_accumulated_depreciation": round(sum(a["accumulated_depreciation"] for a in active), 2),
        "total_net_book_value": round(sum(a["net_book_value"] for a in active), 2),
        "monthly_depreciation_total": round(sum(a["monthly_depreciation"] for a in active if a["status"] == "active"), 2),
        "active_count": len(active),
        "disposed_count": len(disposed),
    }

@router.put("/assets/{asset_id}", response_model=FixedAsset)
async def update_asset(asset_id: str, update: FixedAssetUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    existing = await server.db.assets.find_one({"id": asset_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Активът не е намерен")

    update_data = {k: v for k, v in update.model_dump().items() if v is not None}

    if "invoice_id" in update_data and update_data["invoice_id"] != existing.get("invoice_id"):
        require_permission(current_user, "manage_invoices")
        await _detach_invoice(scope, asset_id, existing.get("invoice_id"))
        if update_data["invoice_id"]:
            update_data["invoice_label"] = await _attach_invoice(scope, asset_id, update_data["invoice_id"])
        else:
            update_data["invoice_id"] = None
            update_data["invoice_label"] = None
    else:
        update_data.pop("invoice_id", None)

    category = update_data.get("category", existing["category"])
    if "annual_depreciation_rate_percent" in update_data:
        category_info = ASSET_CATEGORY_INFO[category]
        if update_data["annual_depreciation_rate_percent"] > category_info["max_rate"] and category != "cat_vi":
            raise HTTPException(status_code=400, detail=f"Нормата не може да надвишава {category_info['max_rate']}% за {category_info['label']}")

    await server.db.assets.update_one({"id": asset_id, **scope}, {"$set": update_data})
    asset = await server.db.assets.find_one({"id": asset_id}, {"_id": 0})
    return enrich_asset_with_depreciation(asset)

@router.post("/assets/{asset_id}/dispose", response_model=FixedAsset)
async def dispose_asset(asset_id: str, request: AssetDisposeRequest, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    existing = await server.db.assets.find_one({"id": asset_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Активът не е намерен")

    await server.db.assets.update_one(
        {"id": asset_id, **scope},
        {"$set": {
            "status": "disposed",
            "disposal_date": request.disposal_date,
            "disposal_reason": request.disposal_reason,
        }}
    )

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="dispose",
        entity_type="asset",
        entity_id=asset_id,
        company_id=company_id,
        details={"name": existing["name"], "reason": request.disposal_reason}
    )

    asset = await server.db.assets.find_one({"id": asset_id}, {"_id": 0})
    return enrich_asset_with_depreciation(asset)

@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    existing: Dict[str, Any] = dict(await server.db.assets.find_one({"id": asset_id, **scope}, {"_id": 0, "invoice_id": 1}) or {})
    result = await server.db.assets.delete_one({"id": asset_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Активът не е намерен")
    # Its purchase invoice is an ordinary expense again.
    await _detach_invoice(scope, asset_id, existing.get("invoice_id"))
    return {"message": "Активът е изтрит"}

"""Cash flow for the weeks ahead (Н1/П1): the projection, the money the
business has now (as the owner enters it) and the day salaries are paid.
See server.cash_flow_projection and services/cash_flow."""
from fastapi import APIRouter
from server import *
import server

router = APIRouter(prefix="/api")


def _require_cash_flow(current_user: User) -> None:
    if not sees_cash_flow(current_user):
        raise HTTPException(status_code=403, detail="Нямате права да виждате паричния поток")


class CashPositionCreate(BaseModel):
    # Money in hand (the till, the safe) and in the bank - a bank account
    # can be overdrawn, so below zero is allowed.
    cash: float = Field(ge=-10_000_000, le=1_000_000_000)
    bank: float = Field(ge=-10_000_000, le=1_000_000_000)
    date: Optional[str] = None


class CashFlowSettings(BaseModel):
    # The day of the month salaries are paid (31 = the month's last day);
    # None goes back to the usual day the payroll was recorded on.
    pay_day: Optional[int] = Field(default=None, ge=1, le=31)


@router.get("/cash-flow")
async def get_cash_flow(days: int = 30, current_user: User = Depends(get_current_user)):
    _require_cash_flow(current_user)
    company_id, scope = await get_company_scope(current_user)
    return await cash_flow_projection(company_id, scope, current_user, days)


@router.post("/cash-flow/position")
async def set_cash_position(payload: CashPositionCreate, current_user: User = Depends(get_current_user)):
    """How much money the business has now - where the projection starts."""
    _require_cash_flow(current_user)
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    day = business_day(payload.date) if payload.date else today_local()
    if day is None:
        raise HTTPException(status_code=400, detail="Невалидна дата")
    if day > today_local():
        raise HTTPException(status_code=400, detail="Наличността е за днес или минал ден")
    doc = {
        "id": str(uuid.uuid4()), "company_id": company_id, "date": day.isoformat(),
        "cash": round(payload.cash, 2), "bank": round(payload.bank, 2),
        "created_by": current_user.user_id, "created_at": datetime.now(timezone.utc),
    }
    await server.db.cash_positions.insert_one(dict(doc))
    doc.pop("created_at")
    return doc


@router.put("/cash-flow/settings")
async def set_cash_flow_settings(payload: CashFlowSettings, current_user: User = Depends(get_current_user)):
    _require_cash_flow(current_user)
    company_id, _ = await get_company_scope(current_user)
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    await server.db.companies.update_one({"id": company_id}, {"$set": {"cash_flow.pay_day": payload.pay_day}})
    return {"pay_day": payload.pay_day}

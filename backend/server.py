from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Response, Request
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import base64
import httpx
import io

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'test_database')]

# Emergent LLM Key
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

# Create the main app
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ===================== MODELS =====================

class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: str = "user"  # "accountant" or "user"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserSession(BaseModel):
    user_id: str
    session_token: str
    expires_at: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Invoice(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    supplier: str
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    date: datetime
    image_base64: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class InvoiceCreate(BaseModel):
    supplier: str
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    date: str
    image_base64: Optional[str] = None
    notes: Optional[str] = None

class InvoiceUpdate(BaseModel):
    supplier: Optional[str] = None
    invoice_number: Optional[str] = None
    amount_without_vat: Optional[float] = None
    vat_amount: Optional[float] = None
    total_amount: Optional[float] = None
    date: Optional[str] = None
    notes: Optional[str] = None

class DailyRevenue(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    date: str
    fiscal_revenue: float = 0
    pocket_money: float = 0  # "джобче" - не влиза в ДДС
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DailyRevenueCreate(BaseModel):
    date: str
    fiscal_revenue: float = 0
    pocket_money: float = 0

class NonInvoiceExpense(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    description: str
    amount: float
    date: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class NonInvoiceExpenseCreate(BaseModel):
    description: str
    amount: float
    date: str

class NotificationSettings(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    vat_threshold_enabled: bool = False
    vat_threshold_amount: float = 0
    periodic_enabled: bool = False
    periodic_dates: List[int] = []  # Days of month (1-31)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class NotificationSettingsUpdate(BaseModel):
    vat_threshold_enabled: Optional[bool] = None
    vat_threshold_amount: Optional[float] = None
    periodic_enabled: Optional[bool] = None
    periodic_dates: Optional[List[int]] = None

class OCRResult(BaseModel):
    supplier: str
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    invoice_date: Optional[str] = None  # Дата на издаване от фактурата

class SessionDataResponse(BaseModel):
    id: str
    email: str
    name: str
    picture: Optional[str] = None
    session_token: str

# ===================== AUTH HELPERS =====================

async def get_session_token(request: Request) -> Optional[str]:
    # Check cookie first
    session_token = request.cookies.get("session_token")
    if session_token:
        return session_token
    # Check Authorization header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header.split(" ")[1]
    return None

async def get_current_user(request: Request) -> User:
    session_token = await get_session_token(request)
    if not session_token:
        raise HTTPException(status_code=401, detail="Не сте влезли в системата")
    
    session = await db.user_sessions.find_one({"session_token": session_token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Невалидна сесия")
    
    expires_at = session["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Сесията е изтекла")
    
    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="Потребителят не е намерен")
    
    return User(**user_doc)

async def get_current_user_optional(request: Request) -> Optional[User]:
    try:
        return await get_current_user(request)
    except:
        return None

# ===================== AUTH ENDPOINTS =====================

@api_router.post("/auth/session")
async def create_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    
    if not session_id:
        raise HTTPException(status_code=400, detail="Липсва session_id")
    
    # Exchange session_id for user data
    async with httpx.AsyncClient() as client_http:
        resp = await client_http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id}
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Невалиден session_id")
        user_data = resp.json()
    
    session_data = SessionDataResponse(**user_data)
    
    # Check if user exists
    existing_user = await db.users.find_one({"email": session_data.email}, {"_id": 0})
    
    if not existing_user:
        # Create new user
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        new_user = {
            "user_id": user_id,
            "email": session_data.email,
            "name": session_data.name,
            "picture": session_data.picture,
            "role": "user",
            "created_at": datetime.now(timezone.utc)
        }
        await db.users.insert_one(new_user)
    else:
        user_id = existing_user["user_id"]
    
    # Create session
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    session_doc = {
        "user_id": user_id,
        "session_token": session_data.session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc)
    }
    await db.user_sessions.insert_one(session_doc)
    
    # Set cookie
    response.set_cookie(
        key="session_token",
        value=session_data.session_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=7 * 24 * 60 * 60,
        path="/"
    )
    
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": user_doc, "session_token": session_data.session_token}

@api_router.get("/auth/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user.dict()

@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    session_token = await get_session_token(request)
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    response.delete_cookie(key="session_token", path="/")
    return {"message": "Успешно излязохте"}

@api_router.put("/auth/role/{user_id}")
async def update_user_role(user_id: str, role: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "accountant":
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")
    
    if role not in ["user", "accountant"]:
        raise HTTPException(status_code=400, detail="Невалидна роля")
    
    result = await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"role": role}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен")
    
    return {"message": "Ролята е обновена"}

@api_router.get("/auth/users")
async def get_all_users(current_user: User = Depends(get_current_user)):
    if current_user.role != "accountant":
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")
    
    users = await db.users.find({}, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1, "picture": 1}).to_list(1000)
    return users

# ===================== NOTIFICATION SETTINGS ENDPOINTS =====================

@api_router.get("/notifications/settings", response_model=NotificationSettings)
async def get_notification_settings(current_user: User = Depends(get_current_user)):
    settings = await db.notification_settings.find_one({"user_id": current_user.user_id}, {"_id": 0})
    if not settings:
        # Create default settings
        default_settings = NotificationSettings(user_id=current_user.user_id)
        await db.notification_settings.insert_one(default_settings.dict())
        return default_settings
    return NotificationSettings(**settings)

@api_router.put("/notifications/settings", response_model=NotificationSettings)
async def update_notification_settings(
    settings_update: NotificationSettingsUpdate,
    current_user: User = Depends(get_current_user)
):
    update_data = {k: v for k, v in settings_update.dict().items() if v is not None}
    update_data["updated_at"] = datetime.now(timezone.utc)
    
    existing = await db.notification_settings.find_one({"user_id": current_user.user_id}, {"_id": 0})
    
    if not existing:
        # Create new settings
        new_settings = NotificationSettings(user_id=current_user.user_id, **update_data)
        await db.notification_settings.insert_one(new_settings.dict())
        return new_settings
    
    await db.notification_settings.update_one(
        {"user_id": current_user.user_id},
        {"$set": update_data}
    )
    
    updated = await db.notification_settings.find_one({"user_id": current_user.user_id}, {"_id": 0})
    return NotificationSettings(**updated)

# ===================== OCR ENDPOINT =====================

@api_router.post("/ocr/scan", response_model=OCRResult)
async def scan_invoice(image_base64: str = None, request: Request = None):
    body = await request.json()
    image_data = body.get("image_base64", "")
    
    if not image_data:
        raise HTTPException(status_code=400, detail="Липсва изображение")
    
    # Remove data URL prefix if present
    if "," in image_data:
        image_data = image_data.split(",")[1]
    
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
        
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"ocr_{uuid.uuid4().hex[:8]}",
            system_message="""Ти си OCR асистент за извличане на данни от фактури на български език.
            Анализирай изображението и извлечи следните данни:
            - Доставчик (име на фирмата)
            - Номер на фактура
            - Сума без ДДС
            - ДДС (обикновено 20%)
            - Обща сума
            
            Отговори САМО в JSON формат:
            {"supplier": "...", "invoice_number": "...", "amount_without_vat": 0.00, "vat_amount": 0.00, "total_amount": 0.00}
            
            Ако не можеш да прочетеш някоя стойност, използвай празен низ за текст или 0 за числа."""
        ).with_model("gemini", "gemini-2.5-flash")
        
        image_content = ImageContent(image_base64=image_data)
        
        user_message = UserMessage(
            text="Извлечи данните от тази фактура. Отговори само с JSON.",
            file_contents=[image_content]
        )
        
        response = await chat.send_message(user_message)
        
        # Parse JSON from response
        import json
        import re
        
        # Find JSON in response
        json_match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
            return OCRResult(
                supplier=result.get("supplier", ""),
                invoice_number=result.get("invoice_number", ""),
                amount_without_vat=float(result.get("amount_without_vat", 0)),
                vat_amount=float(result.get("vat_amount", 0)),
                total_amount=float(result.get("total_amount", 0))
            )
        else:
            raise HTTPException(status_code=500, detail="Не можах да разпозная фактурата")
            
    except Exception as e:
        logger.error(f"OCR Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Грешка при сканиране: {str(e)}")

# ===================== INVOICE ENDPOINTS =====================

@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice: InvoiceCreate, current_user: User = Depends(get_current_user)):
    invoice_dict = invoice.dict()
    invoice_obj = Invoice(
        user_id=current_user.user_id,
        date=datetime.fromisoformat(invoice_dict["date"].replace("Z", "+00:00")),
        **{k: v for k, v in invoice_dict.items() if k != "date"}
    )
    await db.invoices.insert_one(invoice_obj.dict())
    return invoice_obj

@api_router.get("/invoices", response_model=List[Invoice])
async def get_invoices(
    supplier: Optional[str] = None,
    invoice_number: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    query = {"user_id": current_user.user_id}
    
    if supplier:
        query["supplier"] = {"$regex": supplier, "$options": "i"}
    if invoice_number:
        query["invoice_number"] = {"$regex": invoice_number, "$options": "i"}
    if start_date:
        query["date"] = {"$gte": datetime.fromisoformat(start_date.replace("Z", "+00:00"))}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        else:
            query["date"] = {"$lte": datetime.fromisoformat(end_date.replace("Z", "+00:00"))}
    
    invoices = await db.invoices.find(query, {"_id": 0, "image_base64": 0}).sort("date", -1).to_list(1000)
    return [Invoice(**inv) for inv in invoices]

@api_router.get("/invoices/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str, current_user: User = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id, "user_id": current_user.user_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    return Invoice(**invoice)

@api_router.put("/invoices/{invoice_id}", response_model=Invoice)
async def update_invoice(invoice_id: str, invoice_update: InvoiceUpdate, current_user: User = Depends(get_current_user)):
    update_data = {k: v for k, v in invoice_update.dict().items() if v is not None}
    if "date" in update_data:
        update_data["date"] = datetime.fromisoformat(update_data["date"].replace("Z", "+00:00"))
    
    result = await db.invoices.update_one(
        {"id": invoice_id, "user_id": current_user.user_id},
        {"$set": update_data}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    return Invoice(**invoice)

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: User = Depends(get_current_user)):
    result = await db.invoices.delete_one({"id": invoice_id, "user_id": current_user.user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    return {"message": "Фактурата е изтрита"}

# ===================== DAILY REVENUE ENDPOINTS =====================

@api_router.post("/daily-revenue", response_model=DailyRevenue)
async def create_daily_revenue(revenue: DailyRevenueCreate, current_user: User = Depends(get_current_user)):
    # Check if entry for this date already exists
    existing = await db.daily_revenue.find_one({
        "user_id": current_user.user_id,
        "date": revenue.date
    }, {"_id": 0})
    
    if existing:
        # Update existing
        await db.daily_revenue.update_one(
            {"id": existing["id"]},
            {"$set": {"fiscal_revenue": revenue.fiscal_revenue, "pocket_money": revenue.pocket_money}}
        )
        existing["fiscal_revenue"] = revenue.fiscal_revenue
        existing["pocket_money"] = revenue.pocket_money
        return DailyRevenue(**existing)
    
    revenue_obj = DailyRevenue(
        user_id=current_user.user_id,
        date=revenue.date,
        fiscal_revenue=revenue.fiscal_revenue,
        pocket_money=revenue.pocket_money
    )
    await db.daily_revenue.insert_one(revenue_obj.dict())
    return revenue_obj

@api_router.get("/daily-revenue", response_model=List[DailyRevenue])
async def get_daily_revenues(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    query = {"user_id": current_user.user_id}
    
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}
    
    revenues = await db.daily_revenue.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return [DailyRevenue(**r) for r in revenues]

# ===================== NON-INVOICE EXPENSE ENDPOINTS =====================

@api_router.post("/expenses", response_model=NonInvoiceExpense)
async def create_expense(expense: NonInvoiceExpenseCreate, current_user: User = Depends(get_current_user)):
    expense_obj = NonInvoiceExpense(
        user_id=current_user.user_id,
        **expense.dict()
    )
    await db.expenses.insert_one(expense_obj.dict())
    return expense_obj

@api_router.get("/expenses", response_model=List[NonInvoiceExpense])
async def get_expenses(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    query = {"user_id": current_user.user_id}
    
    if start_date:
        query["date"] = {"$gte": start_date}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = end_date
        else:
            query["date"] = {"$lte": end_date}
    
    expenses = await db.expenses.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    return [NonInvoiceExpense(**e) for e in expenses]

@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, current_user: User = Depends(get_current_user)):
    result = await db.expenses.delete_one({"id": expense_id, "user_id": current_user.user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Разходът не е намерен")
    return {"message": "Разходът е изтрит"}

# ===================== STATISTICS ENDPOINTS =====================

@api_router.get("/statistics/summary")
async def get_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    query = {"user_id": current_user.user_id}
    date_query = {}
    
    if start_date:
        date_query["$gte"] = start_date
    if end_date:
        date_query["$lte"] = end_date
    
    # Get invoices
    inv_query = {"user_id": current_user.user_id}
    if start_date or end_date:
        inv_query["date"] = {}
        if start_date:
            inv_query["date"]["$gte"] = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        if end_date:
            inv_query["date"]["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
    
    invoices = await db.invoices.find(inv_query, {"_id": 0, "total_amount": 1, "vat_amount": 1}).to_list(1000)
    
    # Get daily revenues
    rev_query = {"user_id": current_user.user_id}
    if date_query:
        rev_query["date"] = date_query
    revenues = await db.daily_revenue.find(rev_query, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1}).to_list(1000)
    
    # Get expenses
    exp_query = {"user_id": current_user.user_id}
    if date_query:
        exp_query["date"] = date_query
    expenses = await db.expenses.find(exp_query, {"_id": 0, "amount": 1}).to_list(1000)
    
    # Calculate totals
    total_invoice_amount = sum(inv.get("total_amount", 0) for inv in invoices)
    total_invoice_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_fiscal_revenue = sum(r.get("fiscal_revenue", 0) for r in revenues)
    total_pocket_money = sum(r.get("pocket_money", 0) for r in revenues)
    total_expenses = sum(e.get("amount", 0) for e in expenses)
    
    # ДДС от фискализиран оборот (20% от 120% = 16.67% от тотала)
    fiscal_vat = total_fiscal_revenue * 0.2 / 1.2
    
    # Общ ДДС за плащане = ДДС от продажби - ДДС от покупки (фактури)
    vat_to_pay = fiscal_vat - total_invoice_vat
    
    # Общ приход (фискализиран + джобче)
    total_income = total_fiscal_revenue + total_pocket_money
    
    # Общ разход (фактури + разходи без фактури)
    total_expense = total_invoice_amount + total_expenses
    
    return {
        "total_invoice_amount": round(total_invoice_amount, 2),
        "total_invoice_vat": round(total_invoice_vat, 2),
        "total_fiscal_revenue": round(total_fiscal_revenue, 2),
        "total_pocket_money": round(total_pocket_money, 2),
        "fiscal_vat": round(fiscal_vat, 2),
        "vat_to_pay": round(vat_to_pay, 2),
        "total_non_invoice_expenses": round(total_expenses, 2),
        "total_income": round(total_income, 2),
        "total_expense": round(total_expense, 2),
        "profit": round(total_income - total_expense, 2),
        "invoice_count": len(invoices)
    }

@api_router.get("/statistics/chart-data")
async def get_chart_data(
    period: str = "week",  # week, month, year
    current_user: User = Depends(get_current_user)
):
    now = datetime.now(timezone.utc)
    
    if period == "week":
        start = now - timedelta(days=7)
    elif period == "month":
        start = now - timedelta(days=30)
    else:
        start = now - timedelta(days=365)
    
    start_str = start.strftime("%Y-%m-%d")
    
    # Get data
    inv_query = {
        "user_id": current_user.user_id,
        "date": {"$gte": start}
    }
    invoices = await db.invoices.find(inv_query, {"_id": 0, "date": 1, "total_amount": 1, "vat_amount": 1}).to_list(1000)
    
    rev_query = {
        "user_id": current_user.user_id,
        "date": {"$gte": start_str}
    }
    revenues = await db.daily_revenue.find(rev_query, {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1}).to_list(1000)
    
    exp_query = {
        "user_id": current_user.user_id,
        "date": {"$gte": start_str}
    }
    expenses = await db.expenses.find(exp_query, {"_id": 0, "date": 1, "amount": 1}).to_list(1000)
    
    # Group by date
    from collections import defaultdict
    
    daily_data = defaultdict(lambda: {"income": 0, "expense": 0, "vat": 0})
    
    for inv in invoices:
        date_str = inv["date"].strftime("%Y-%m-%d") if isinstance(inv["date"], datetime) else inv["date"][:10]
        daily_data[date_str]["expense"] += inv.get("total_amount", 0)
        daily_data[date_str]["vat"] -= inv.get("vat_amount", 0)  # ДДС кредит
    
    for rev in revenues:
        date_str = rev["date"][:10] if isinstance(rev["date"], str) else rev["date"].strftime("%Y-%m-%d")
        daily_data[date_str]["income"] += rev.get("fiscal_revenue", 0) + rev.get("pocket_money", 0)
        daily_data[date_str]["vat"] += rev.get("fiscal_revenue", 0) * 0.2 / 1.2  # ДДС от продажби
    
    for exp in expenses:
        date_str = exp["date"][:10] if isinstance(exp["date"], str) else exp["date"].strftime("%Y-%m-%d")
        daily_data[date_str]["expense"] += exp.get("amount", 0)
    
    # Convert to list sorted by date
    chart_data = []
    for date_str in sorted(daily_data.keys()):
        chart_data.append({
            "date": date_str,
            "label": date_str[5:],  # MM-DD
            "income": round(daily_data[date_str]["income"], 2),
            "expense": round(daily_data[date_str]["expense"], 2),
            "vat": round(daily_data[date_str]["vat"], 2)
        })
    
    return chart_data

# ===================== EXPORT ENDPOINTS =====================

@api_router.get("/export/excel")
async def export_excel(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill
    
    # Get data
    query = {"user_id": current_user.user_id}
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        if end_date:
            query["date"]["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    
    wb = Workbook()
    ws = wb.active
    ws.title = "Фактури"
    
    # Header style
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="4F46E5", end_color="4F46E5", fill_type="solid")
    
    # Headers
    headers = ["Дата", "Доставчик", "№ Фактура", "Без ДДС", "ДДС", "Общо", "Бележки"]
    for col, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
    
    # Data
    for row, inv in enumerate(invoices, 2):
        date_val = inv["date"]
        if isinstance(date_val, datetime):
            date_str = date_val.strftime("%Y-%m-%d")
        else:
            date_str = str(date_val)[:10]
        
        ws.cell(row=row, column=1, value=date_str)
        ws.cell(row=row, column=2, value=inv.get("supplier", ""))
        ws.cell(row=row, column=3, value=inv.get("invoice_number", ""))
        ws.cell(row=row, column=4, value=inv.get("amount_without_vat", 0))
        ws.cell(row=row, column=5, value=inv.get("vat_amount", 0))
        ws.cell(row=row, column=6, value=inv.get("total_amount", 0))
        ws.cell(row=row, column=7, value=inv.get("notes", ""))
    
    # Adjust column widths
    ws.column_dimensions['A'].width = 12
    ws.column_dimensions['B'].width = 25
    ws.column_dimensions['C'].width = 15
    ws.column_dimensions['D'].width = 12
    ws.column_dimensions['E'].width = 12
    ws.column_dimensions['F'].width = 12
    ws.column_dimensions['G'].width = 30
    
    # Save to bytes
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=fakturi.xlsx"}
    )

@api_router.get("/export/pdf")
async def export_pdf(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    
    # Get data
    query = {"user_id": current_user.user_id}
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        if end_date:
            query["date"]["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("date", -1).to_list(1000)
    
    output = io.BytesIO()
    doc = SimpleDocTemplate(output, pagesize=landscape(A4))
    
    # Table data
    data = [["Data", "Dostavchik", "No Faktura", "Bez DDS", "DDS", "Obshto"]]
    
    for inv in invoices:
        date_val = inv["date"]
        if isinstance(date_val, datetime):
            date_str = date_val.strftime("%Y-%m-%d")
        else:
            date_str = str(date_val)[:10]
        
        data.append([
            date_str,
            inv.get("supplier", "")[:30],
            inv.get("invoice_number", ""),
            f"{inv.get('amount_without_vat', 0):.2f}",
            f"{inv.get('vat_amount', 0):.2f}",
            f"{inv.get('total_amount', 0):.2f}"
        ])
    
    # Create table
    table = Table(data, colWidths=[80, 150, 100, 80, 80, 80])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4F46E5')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#F3F4F6')),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#E5E7EB')),
        ('FONTSIZE', (0, 1), (-1, -1), 10),
    ]))
    
    doc.build([table])
    output.seek(0)
    
    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=fakturi.pdf"}
    )

# ===================== HEALTH CHECK =====================

@api_router.get("/")
async def root():
    return {"message": "Invoice Manager API", "status": "running"}

@api_router.get("/health")
async def health():
    return {"status": "healthy"}

# Include the router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

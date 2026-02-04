from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Response, Request
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import base64
import httpx
import io
import re
from passlib.context import CryptContext

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Environment
IS_PRODUCTION = os.environ.get('ENVIRONMENT', 'development') == 'production'

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'test_database')]

# Emergent LLM Key
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

# Create the main app
app = FastAPI(
    title="Invoice Manager API",
    version="1.0.0",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc"
)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging - less verbose in production
log_level = logging.WARNING if IS_PRODUCTION else logging.INFO
logging.basicConfig(
    level=log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ===================== MODELS =====================

class Company(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str  # Име на фирмата
    eik: str  # ЕИК/Булстат
    vat_number: Optional[str] = None  # ДДС номер (BG + ЕИК)
    mol: Optional[str] = None  # МОЛ (Материално отговорно лице)
    address: Optional[str] = None  # Адрес
    city: Optional[str] = None  # Град
    phone: Optional[str] = None  # Телефон
    email: Optional[str] = None  # Имейл
    bank_name: Optional[str] = None  # Банка
    bank_iban: Optional[str] = None  # IBAN
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CompanyCreate(BaseModel):
    name: str
    eik: str
    vat_number: Optional[str] = None
    mol: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    bank_name: Optional[str] = None
    bank_iban: Optional[str] = None

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    eik: Optional[str] = None
    vat_number: Optional[str] = None
    mol: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    bank_name: Optional[str] = None
    bank_iban: Optional[str] = None

class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    role: str = "staff"  # "owner", "manager", or "staff"
    company_id: Optional[str] = None  # Връзка към фирмата
    password_hash: Optional[str] = None  # За email/password auth
    auth_provider: str = "email"  # "google" or "email"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserSession(BaseModel):
    user_id: str
    session_token: str
    expires_at: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Email/Password Auth Models
class UserRegister(BaseModel):
    email: str
    password: str
    name: str

class UserLogin(BaseModel):
    email: str
    password: str

# Invitation model for user invitations
class Invitation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    invited_by: str  # user_id на изпращача
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str = "staff"  # Роля за поканения
    code: str = Field(default_factory=lambda: uuid.uuid4().hex[:8].upper())  # 8-символен код
    status: str = "pending"  # "pending", "accepted", "cancelled", "expired"
    expires_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc) + timedelta(days=7))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class InvitationCreate(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str = "staff"

class Invoice(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None  # Връзка към фирмата
    supplier: str
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    date: datetime
    image_base64: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[dict]] = None  # Списък с артикули
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Invoice Item models
class InvoiceItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str  # Име на артикула
    quantity: float = 1  # Количество
    unit: str = "бр."  # Мерна единица (бр., кг., л., м.)
    unit_price: float  # Единична цена без ДДС
    total_price: float  # Обща цена без ДДС
    vat_amount: float = 0  # ДДС за артикула

class InvoiceItemCreate(BaseModel):
    name: str
    quantity: float = 1
    unit: str = "бр."
    unit_price: float
    total_price: Optional[float] = None  # Ако не е подадено, се изчислява
    vat_amount: Optional[float] = None

# Item Price History - за проследяване на цените
class ItemPriceHistory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    supplier: str  # Доставчик
    item_name: str  # Нормализирано име на артикул
    unit_price: float  # Единична цена
    quantity: float  # Количество
    unit: str  # Мерна единица
    invoice_id: str  # Връзка към фактурата
    invoice_number: str
    invoice_date: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Price Alert settings
class PriceAlertSettings(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    threshold_percent: float = 10.0  # Праг за аларма в %
    enabled: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PriceAlert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    item_name: str
    supplier: str
    old_price: float
    new_price: float
    change_percent: float
    invoice_id: str
    invoice_number: str
    status: str = "unread"  # unread, read, dismissed
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
    items: Optional[List[InvoiceItemCreate]] = None  # Артикули

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
    except Exception:
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
        
        # Auto-create company for new user
        company_name = session_data.name.split()[0] + " Company" if session_data.name else "My Company"
        new_company = Company(
            name=company_name,
            eik=f"AUTO{uuid.uuid4().hex[:9].upper()}"  # Temporary auto-generated EIK
        )
        await db.companies.insert_one(new_company.dict())
        
        new_user = {
            "user_id": user_id,
            "email": session_data.email,
            "name": session_data.name,
            "picture": session_data.picture,
            "role": "owner",  # First user is owner
            "company_id": new_company.id,
            "auth_provider": "google",
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

# ===================== EMAIL/PASSWORD AUTH =====================

def validate_email(email: str) -> bool:
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password: str) -> tuple[bool, str]:
    """Validate password strength"""
    if len(password) < 8:
        return False, "Паролата трябва да е поне 8 символа"
    if not re.search(r'[A-Za-z]', password):
        return False, "Паролата трябва да съдържа поне една буква"
    if not re.search(r'\d', password):
        return False, "Паролата трябва да съдържа поне една цифра"
    return True, ""

@api_router.post("/auth/register")
async def register_user(user_data: UserRegister, response: Response):
    """Register new user with email/password"""
    # Validate email
    if not validate_email(user_data.email):
        raise HTTPException(status_code=400, detail="Невалиден имейл адрес")
    
    # Validate password
    is_valid, error_msg = validate_password(user_data.password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)
    
    # Validate name
    if not user_data.name or len(user_data.name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Името трябва да е поне 2 символа")
    
    # Check if user already exists
    existing_user = await db.users.find_one({"email": user_data.email.lower()})
    if existing_user:
        raise HTTPException(status_code=400, detail="Потребител с този имейл вече съществува")
    
    # Create user
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    password_hash = pwd_context.hash(user_data.password)
    
    # Auto-create company for new user
    company_name = user_data.name.split()[0] + " Company" if user_data.name else "My Company"
    new_company = Company(
        name=company_name,
        eik=f"AUTO{uuid.uuid4().hex[:9].upper()}"
    )
    await db.companies.insert_one(new_company.dict())
    
    new_user = {
        "user_id": user_id,
        "email": user_data.email.lower(),
        "name": user_data.name.strip(),
        "picture": None,
        "role": "owner",
        "company_id": new_company.id,
        "password_hash": password_hash,
        "auth_provider": "email",
        "created_at": datetime.now(timezone.utc)
    }
    await db.users.insert_one(new_user)
    
    # Create session
    session_token = uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    session_doc = {
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc)
    }
    await db.user_sessions.insert_one(session_doc)
    
    # Set cookie
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=7 * 24 * 60 * 60,
        path="/"
    )
    
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"user": user_doc, "session_token": session_token}

@api_router.post("/auth/login")
async def login_user(user_data: UserLogin, response: Response):
    """Login with email/password"""
    # Find user
    user = await db.users.find_one({"email": user_data.email.lower()})
    if not user:
        raise HTTPException(status_code=401, detail="Невалиден имейл или парола")
    
    # Check if user has password (might be Google-only user)
    if not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Този акаунт използва Google вход. Моля, използвайте бутона за Google.")
    
    # Verify password
    if not pwd_context.verify(user_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Невалиден имейл или парола")
    
    # Create session
    session_token = uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    session_doc = {
        "user_id": user["user_id"],
        "session_token": session_token,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc)
    }
    await db.user_sessions.insert_one(session_doc)
    
    # Set cookie
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=7 * 24 * 60 * 60,
        path="/"
    )
    
    user_doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return {"user": user_doc, "session_token": session_token}

@api_router.put("/auth/role/{user_id}")
async def update_user_role(user_id: str, request: Request, current_user: User = Depends(get_current_user)):
    body = await request.json()
    role = body.get("role")
    
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да променя роли")
    
    if role not in ["owner", "manager", "staff"]:
        raise HTTPException(status_code=400, detail="Невалидна роля. Допустими: owner, manager, staff")
    
    # Get target user
    target_user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target_user:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен")
    
    # Ensure same company
    if target_user.get("company_id") != current_user.company_id:
        raise HTTPException(status_code=403, detail="Потребителят не е от вашата фирма")
    
    # Cannot change own role if owner
    if user_id == current_user.user_id and current_user.role == "owner":
        raise HTTPException(status_code=400, detail="Не можете да променяте собствената си роля на собственик")
    
    result = await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"role": role}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен")
    
    return {"message": "Ролята е обновена"}

@api_router.get("/auth/users")
async def get_all_users(current_user: User = Depends(get_current_user)):
    if current_user.role not in ["owner", "manager"]:
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")
    
    if not current_user.company_id:
        return []
    
    users = await db.users.find(
        {"company_id": current_user.company_id},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1, "picture": 1, "created_at": 1}
    ).to_list(1000)
    return users

@api_router.delete("/auth/users/{user_id}")
async def remove_user_from_company(user_id: str, current_user: User = Depends(get_current_user)):
    """Премахва потребител от фирмата (само Owner)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да премахва потребители")
    
    if user_id == current_user.user_id:
        raise HTTPException(status_code=400, detail="Не можете да премахнете себе си")
    
    target_user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target_user:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен")
    
    if target_user.get("company_id") != current_user.company_id:
        raise HTTPException(status_code=403, detail="Потребителят не е от вашата фирма")
    
    # Remove company_id from user (don't delete user)
    await db.users.update_one(
        {"user_id": user_id},
        {"$unset": {"company_id": ""}, "$set": {"role": "staff"}}
    )
    
    return {"message": "Потребителят е премахнат от фирмата"}

# ===================== INVITATION ENDPOINTS =====================

@api_router.post("/invitations")
async def create_invitation(invitation_data: InvitationCreate, current_user: User = Depends(get_current_user)):
    """Създава покана за нов потребител (само Owner)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да изпраща покани")
    
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    
    if not invitation_data.email and not invitation_data.phone:
        raise HTTPException(status_code=400, detail="Въведете имейл или телефон")
    
    if invitation_data.role not in ["manager", "staff"]:
        raise HTTPException(status_code=400, detail="Невалидна роля за покана")
    
    # Check if user with this email already exists in the company
    if invitation_data.email:
        existing_user = await db.users.find_one({
            "email": invitation_data.email,
            "company_id": current_user.company_id
        })
        if existing_user:
            raise HTTPException(status_code=400, detail="Потребител с този имейл вече е член на фирмата")
    
    # Check for pending invitation
    pending = await db.invitations.find_one({
        "company_id": current_user.company_id,
        "$or": [
            {"email": invitation_data.email} if invitation_data.email else {"email": None},
            {"phone": invitation_data.phone} if invitation_data.phone else {"phone": None}
        ],
        "status": "pending"
    })
    if pending:
        raise HTTPException(status_code=400, detail="Вече има активна покана за този контакт")
    
    invitation = Invitation(
        company_id=current_user.company_id,
        invited_by=current_user.user_id,
        email=invitation_data.email,
        phone=invitation_data.phone,
        role=invitation_data.role
    )
    
    await db.invitations.insert_one(invitation.dict())
    
    # Get company name for response
    company = await db.companies.find_one({"id": current_user.company_id}, {"name": 1})
    company_name = company.get("name", "Unknown") if company else "Unknown"
    
    return {
        "message": "Поканата е създадена",
        "invitation": {
            "id": invitation.id,
            "code": invitation.code,
            "expires_at": invitation.expires_at.isoformat(),
            "company_name": company_name
        }
    }

@api_router.get("/invitations")
async def get_invitations(current_user: User = Depends(get_current_user)):
    """Връща всички покани за фирмата (само Owner)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да вижда покани")
    
    if not current_user.company_id:
        return []
    
    invitations = await db.invitations.find(
        {"company_id": current_user.company_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return invitations

@api_router.delete("/invitations/{invitation_id}")
async def cancel_invitation(invitation_id: str, current_user: User = Depends(get_current_user)):
    """Отменя покана (само Owner)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да отменя покани")
    
    invitation = await db.invitations.find_one({
        "id": invitation_id,
        "company_id": current_user.company_id
    })
    
    if not invitation:
        raise HTTPException(status_code=404, detail="Поканата не е намерена")
    
    if invitation["status"] != "pending":
        raise HTTPException(status_code=400, detail="Поканата вече не е активна")
    
    await db.invitations.update_one(
        {"id": invitation_id},
        {"$set": {"status": "cancelled"}}
    )
    
    return {"message": "Поканата е отменена"}

@api_router.post("/invitations/accept")
async def accept_invitation(request: Request, current_user: User = Depends(get_current_user)):
    """Приема покана по код"""
    body = await request.json()
    code = body.get("code", "").upper().strip()
    
    if not code:
        raise HTTPException(status_code=400, detail="Въведете код на поканата")
    
    # Find valid invitation
    invitation = await db.invitations.find_one({
        "code": code,
        "status": "pending"
    })
    
    if not invitation:
        raise HTTPException(status_code=404, detail="Невалиден или изтекъл код")
    
    # Check expiry
    expires_at = invitation["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    
    if expires_at < datetime.now(timezone.utc):
        await db.invitations.update_one(
            {"id": invitation["id"]},
            {"$set": {"status": "expired"}}
        )
        raise HTTPException(status_code=400, detail="Поканата е изтекла")
    
    # Check if user already has a company
    if current_user.company_id:
        raise HTTPException(status_code=400, detail="Вече сте член на фирма. Първо напуснете текущата фирма.")
    
    # Accept invitation - link user to company
    await db.users.update_one(
        {"user_id": current_user.user_id},
        {"$set": {
            "company_id": invitation["company_id"],
            "role": invitation["role"]
        }}
    )
    
    # Mark invitation as accepted
    await db.invitations.update_one(
        {"id": invitation["id"]},
        {"$set": {"status": "accepted"}}
    )
    
    # Get company info
    company = await db.companies.find_one({"id": invitation["company_id"]}, {"_id": 0})
    
    return {
        "message": f"Успешно се присъединихте към {company['name'] if company else 'фирмата'}",
        "company": company
    }

@api_router.post("/company/leave")
async def leave_company(current_user: User = Depends(get_current_user)):
    """Напускане на фирма (не може Owner)"""
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="Не сте член на фирма")
    
    if current_user.role == "owner":
        raise HTTPException(status_code=400, detail="Титулярят не може да напусне фирмата. Прехвърлете собствеността първо.")
    
    await db.users.update_one(
        {"user_id": current_user.user_id},
        {"$unset": {"company_id": ""}, "$set": {"role": "staff"}}
    )
    
    return {"message": "Успешно напуснахте фирмата"}

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

# ===================== COMPANY ENDPOINTS =====================

@api_router.post("/company", response_model=Company)
async def create_or_update_company(company_data: CompanyCreate, current_user: User = Depends(get_current_user)):
    """Създава нова фирма или обновява съществуваща (само Owner може да редактира)"""
    
    # Check if user already has a company
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    
    if user_doc and user_doc.get("company_id"):
        # User has a company - only owner can edit
        if user_doc.get("role") != "owner":
            raise HTTPException(status_code=403, detail="Само титулярят може да редактира данните на фирмата")
        
        # Update existing company
        update_data = {k: v for k, v in company_data.dict().items() if v is not None}
        update_data["updated_at"] = datetime.now(timezone.utc)
        
        # Don't allow EIK change if company has other users
        other_users = await db.users.count_documents({
            "company_id": user_doc["company_id"],
            "user_id": {"$ne": current_user.user_id}
        })
        if other_users > 0 and "eik" in update_data:
            existing = await db.companies.find_one({"id": user_doc["company_id"]})
            if existing and existing.get("eik") != update_data["eik"]:
                raise HTTPException(status_code=400, detail="Не може да се промени ЕИК на фирма с други потребители")
        
        await db.companies.update_one(
            {"id": user_doc["company_id"]},
            {"$set": update_data}
        )
        
        updated_company = await db.companies.find_one({"id": user_doc["company_id"]}, {"_id": 0})
        return Company(**updated_company)
    else:
        # Check if company with this EIK already exists
        existing_company = await db.companies.find_one({"eik": company_data.eik}, {"_id": 0})
        
        if existing_company:
            raise HTTPException(status_code=400, detail="Фирма с този ЕИК вече съществува. Използвайте код за присъединяване.")
        
        # Create new company
        company = Company(**company_data.dict())
        await db.companies.insert_one(company.dict())
        
        # Link current user to this company as owner
        await db.users.update_one(
            {"user_id": current_user.user_id},
            {"$set": {"company_id": company.id, "role": "owner"}}
        )
        
        return company

@api_router.get("/company", response_model=Optional[Company])
async def get_my_company(current_user: User = Depends(get_current_user)):
    """Връща фирмата на текущия потребител"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    
    if not user_doc or not user_doc.get("company_id"):
        return None
    
    company = await db.companies.find_one({"id": user_doc["company_id"]}, {"_id": 0})
    if not company:
        return None
    
    return Company(**company)

@api_router.put("/company", response_model=Company)
async def update_company(company_update: CompanyUpdate, current_user: User = Depends(get_current_user)):
    """Обновява фирмата на текущия потребител"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    
    if not user_doc or not user_doc.get("company_id"):
        raise HTTPException(status_code=404, detail="Нямате свързана фирма. Първо създайте фирма.")
    
    update_data = {k: v for k, v in company_update.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="Няма данни за обновяване")
    
    update_data["updated_at"] = datetime.now(timezone.utc)
    
    await db.companies.update_one(
        {"id": user_doc["company_id"]},
        {"$set": update_data}
    )
    
    updated_company = await db.companies.find_one({"id": user_doc["company_id"]}, {"_id": 0})
    return Company(**updated_company)

@api_router.post("/company/join/{eik}")
async def join_company_by_eik(eik: str, current_user: User = Depends(get_current_user)):
    """Присъединява потребител към съществуваща фирма по ЕИК"""
    company = await db.companies.find_one({"eik": eik}, {"_id": 0})
    
    if not company:
        raise HTTPException(status_code=404, detail=f"Фирма с ЕИК {eik} не е намерена")
    
    await db.users.update_one(
        {"user_id": current_user.user_id},
        {"$set": {"company_id": company["id"]}}
    )
    
    return {"message": f"Успешно се присъединихте към {company['name']}", "company": Company(**company)}

@api_router.get("/company/users")
async def get_company_users(current_user: User = Depends(get_current_user)):
    """Връща всички потребители от същата фирма"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    
    if not user_doc or not user_doc.get("company_id"):
        return []
    
    users = await db.users.find(
        {"company_id": user_doc["company_id"]},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1, "picture": 1}
    ).to_list(1000)
    
    return users

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
            - Дата на издаване на фактурата (във формат YYYY-MM-DD)
            - Сума без ДДС
            - ДДС (обикновено 20%)
            - Обща сума
            
            Отговори САМО в JSON формат:
            {"supplier": "...", "invoice_number": "...", "invoice_date": "YYYY-MM-DD", "amount_without_vat": 0.00, "vat_amount": 0.00, "total_amount": 0.00}
            
            Ако не можеш да прочетеш някоя стойност, използвай празен низ за текст или 0 за числа.
            За датата: ако не може да се прочете, върни null."""
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
                total_amount=float(result.get("total_amount", 0)),
                invoice_date=result.get("invoice_date")
            )
        else:
            raise HTTPException(status_code=500, detail="Не можах да разпозная фактурата")
            
    except Exception as e:
        logger.error(f"OCR Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Грешка при сканиране: {str(e)}")

# ===================== INVOICE ENDPOINTS =====================

@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice: InvoiceCreate, current_user: User = Depends(get_current_user)):
    # Get user's company_id
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    # Check for duplicate invoice
    if company_id:
        # If user has a company, check across all company users
        company_users = await db.users.find({"company_id": company_id}, {"user_id": 1}).to_list(1000)
        company_user_ids = [u["user_id"] for u in company_users]
        
        existing_invoice = await db.invoices.find_one({
            "user_id": {"$in": company_user_ids},
            "invoice_number": invoice.invoice_number,
            "supplier": {"$regex": f"^{invoice.supplier}$", "$options": "i"}
        }, {"_id": 0, "id": 1, "date": 1, "user_id": 1})
        
        if existing_invoice:
            # Find who added the duplicate
            added_by_user = await db.users.find_one({"user_id": existing_invoice["user_id"]}, {"name": 1})
            added_by_name = added_by_user.get("name", "друг потребител") if added_by_user else "друг потребител"
            raise HTTPException(
                status_code=409,
                detail=f"Фактура с номер {invoice.invoice_number} от {invoice.supplier} вече е добавена от {added_by_name}!"
            )
    else:
        # No company - check only for current user
        existing_invoice = await db.invoices.find_one({
            "user_id": current_user.user_id,
            "invoice_number": invoice.invoice_number,
            "supplier": {"$regex": f"^{invoice.supplier}$", "$options": "i"}
        }, {"_id": 0, "id": 1, "date": 1})
        
        if existing_invoice:
            raise HTTPException(
                status_code=409,
                detail=f"Фактура с номер {invoice.invoice_number} от {invoice.supplier} вече съществува в системата!"
            )
    
    invoice_dict = invoice.dict()
    invoice_date = datetime.fromisoformat(invoice_dict["date"].replace("Z", "+00:00"))
    
    # Process items and convert to dict format
    items_list = None
    price_alerts = []
    
    if invoice.items:
        items_list = []
        for item in invoice.items:
            item_dict = item.dict()
            # Calculate total_price if not provided
            if item_dict.get("total_price") is None:
                item_dict["total_price"] = item_dict["quantity"] * item_dict["unit_price"]
            # Calculate VAT if not provided (20%)
            if item_dict.get("vat_amount") is None:
                item_dict["vat_amount"] = item_dict["total_price"] * 0.2
            
            item_dict["id"] = str(uuid.uuid4())
            items_list.append(item_dict)
            
            # Check price changes and create alerts if company exists
            if company_id:
                normalized_name = item.name.strip().lower()
                
                # Find last price for this item from same supplier
                last_price_record = await db.item_price_history.find_one(
                    {
                        "company_id": company_id,
                        "supplier": {"$regex": f"^{invoice.supplier}$", "$options": "i"},
                        "item_name": normalized_name
                    },
                    {"_id": 0},
                    sort=[("invoice_date", -1)]
                )
                
                # Get threshold setting
                alert_settings = await db.price_alert_settings.find_one(
                    {"company_id": company_id},
                    {"_id": 0}
                )
                threshold = alert_settings.get("threshold_percent", 10.0) if alert_settings else 10.0
                alert_enabled = alert_settings.get("enabled", True) if alert_settings else True
                
                if last_price_record and alert_enabled:
                    old_price = last_price_record["unit_price"]
                    new_price = item.unit_price
                    
                    if old_price > 0:
                        change_percent = ((new_price - old_price) / old_price) * 100
                        
                        # Create alert if price increased above threshold
                        if change_percent >= threshold:
                            alert = PriceAlert(
                                company_id=company_id,
                                item_name=item.name,
                                supplier=invoice.supplier,
                                old_price=old_price,
                                new_price=new_price,
                                change_percent=round(change_percent, 2),
                                invoice_id="",  # Will be set after invoice is created
                                invoice_number=invoice.invoice_number
                            )
                            price_alerts.append(alert)
                
                # Save to price history
                price_history = ItemPriceHistory(
                    company_id=company_id,
                    supplier=invoice.supplier,
                    item_name=normalized_name,
                    unit_price=item.unit_price,
                    quantity=item.quantity,
                    unit=item.unit,
                    invoice_id="",  # Will be set after invoice is created
                    invoice_number=invoice.invoice_number,
                    invoice_date=invoice_date
                )
                await db.item_price_history.insert_one(price_history.dict())
    
    invoice_obj = Invoice(
        user_id=current_user.user_id,
        company_id=company_id,
        date=invoice_date,
        items=items_list,
        **{k: v for k, v in invoice_dict.items() if k not in ["date", "items"]}
    )
    await db.invoices.insert_one(invoice_obj.dict())
    
    # Update price history and alerts with invoice_id
    if company_id and invoice.items:
        for item in invoice.items:
            normalized_name = item.name.strip().lower()
            await db.item_price_history.update_many(
                {
                    "company_id": company_id,
                    "invoice_number": invoice.invoice_number,
                    "item_name": normalized_name,
                    "invoice_id": ""
                },
                {"$set": {"invoice_id": invoice_obj.id}}
            )
        
        # Save alerts with invoice_id
        for alert in price_alerts:
            alert.invoice_id = invoice_obj.id
            await db.price_alerts.insert_one(alert.dict())
    
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
        # ADD to existing values instead of replacing
        new_fiscal = existing.get("fiscal_revenue", 0) + revenue.fiscal_revenue
        new_pocket = existing.get("pocket_money", 0) + revenue.pocket_money
        
        await db.daily_revenue.update_one(
            {"id": existing["id"]},
            {"$set": {"fiscal_revenue": new_fiscal, "pocket_money": new_pocket}}
        )
        existing["fiscal_revenue"] = new_fiscal
        existing["pocket_money"] = new_pocket
        return DailyRevenue(**existing)
    
    revenue_obj = DailyRevenue(
        user_id=current_user.user_id,
        date=revenue.date,
        fiscal_revenue=revenue.fiscal_revenue,
        pocket_money=revenue.pocket_money
    )
    await db.daily_revenue.insert_one(revenue_obj.dict())
    return revenue_obj

@api_router.get("/daily-revenue/today")
async def get_today_revenue(current_user: User = Depends(get_current_user)):
    """Get today's revenue totals"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    existing = await db.daily_revenue.find_one({
        "user_id": current_user.user_id,
        "date": today
    }, {"_id": 0})
    
    if existing:
        return {
            "date": today,
            "fiscal_revenue": existing.get("fiscal_revenue", 0),
            "pocket_money": existing.get("pocket_money", 0)
        }
    return {
        "date": today,
        "fiscal_revenue": 0,
        "pocket_money": 0
    }

@api_router.get("/daily-revenue/by-date/{date}")
async def get_revenue_by_date(date: str, current_user: User = Depends(get_current_user)):
    """Get revenue for a specific date"""
    existing = await db.daily_revenue.find_one({
        "user_id": current_user.user_id,
        "date": date
    }, {"_id": 0})
    
    if existing:
        return {
            "date": date,
            "fiscal_revenue": existing.get("fiscal_revenue", 0),
            "pocket_money": existing.get("pocket_money", 0)
        }
    return {
        "date": date,
        "fiscal_revenue": 0,
        "pocket_money": 0
    }

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
    current_month_only: bool = True,  # Default to current month
    current_user: User = Depends(get_current_user)
):
    # If no dates provided and current_month_only is True, use current month
    if not start_date and not end_date and current_month_only:
        now = datetime.now(timezone.utc)
        start_date = now.replace(day=1).strftime("%Y-%m-%d")
        # End of month
        if now.month == 12:
            end_date = now.replace(year=now.year + 1, month=1, day=1).strftime("%Y-%m-%d")
        else:
            end_date = now.replace(month=now.month + 1, day=1).strftime("%Y-%m-%d")
    
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

@api_router.get("/statistics/suppliers")
async def get_supplier_statistics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get comprehensive supplier statistics with trends, alerts, and rankings"""
    from collections import defaultdict
    from datetime import timedelta
    
    # Default to current month if no dates provided
    now = datetime.now(timezone.utc)
    if not start_date and not end_date:
        start_date = now.replace(day=1).strftime("%Y-%m-%d")
        if now.month == 12:
            end_date = now.replace(year=now.year + 1, month=1, day=1).strftime("%Y-%m-%d")
        else:
            end_date = now.replace(month=now.month + 1, day=1).strftime("%Y-%m-%d")
    
    # Build query for current period
    query = {"user_id": current_user.user_id}
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = datetime.fromisoformat(start_date + "T00:00:00+00:00")
        if end_date:
            query["date"]["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    # Get all invoices for the period
    invoices = await db.invoices.find(query, {
        "_id": 0, 
        "supplier": 1, 
        "total_amount": 1, 
        "vat_amount": 1,
        "amount_without_vat": 1,
        "date": 1
    }).to_list(10000)
    
    # Group by supplier with detailed data
    supplier_data = defaultdict(lambda: {
        "total_amount": 0,
        "total_vat": 0,
        "total_net": 0,
        "invoice_count": 0,
        "dates": [],
        "amounts": []
    })
    
    for inv in invoices:
        supplier = inv.get("supplier", "Неизвестен")
        amount = inv.get("total_amount", 0)
        supplier_data[supplier]["total_amount"] += amount
        supplier_data[supplier]["total_vat"] += inv.get("vat_amount", 0)
        supplier_data[supplier]["total_net"] += inv.get("amount_without_vat", 0)
        supplier_data[supplier]["invoice_count"] += 1
        
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            supplier_data[supplier]["dates"].append(date_val)
            supplier_data[supplier]["amounts"].append(amount)
    
    # Calculate inactivity threshold (30 days)
    inactivity_days = 30
    inactive_threshold = now - timedelta(days=inactivity_days)
    
    # Build comprehensive supplier list
    suppliers_list = []
    total_all = 0
    
    for supplier, data in supplier_data.items():
        total_all += data["total_amount"]
        
        # Calculate first/last delivery
        sorted_dates = sorted(data["dates"]) if data["dates"] else []
        first_delivery = sorted_dates[0] if sorted_dates else None
        last_delivery = sorted_dates[-1] if sorted_dates else None
        
        # Make dates timezone-aware if they aren't
        if last_delivery and last_delivery.tzinfo is None:
            last_delivery = last_delivery.replace(tzinfo=timezone.utc)
        if first_delivery and first_delivery.tzinfo is None:
            first_delivery = first_delivery.replace(tzinfo=timezone.utc)
        
        # Determine status
        is_active = last_delivery and last_delivery > inactive_threshold if last_delivery else False
        days_inactive = (now - last_delivery).days if last_delivery else 999
        
        # Calculate average
        avg = data["total_amount"] / data["invoice_count"] if data["invoice_count"] > 0 else 0
        
        # Calculate standard deviation for anomaly detection
        amounts = data["amounts"]
        if len(amounts) >= 2:
            mean_amount = sum(amounts) / len(amounts)
            variance = sum((x - mean_amount) ** 2 for x in amounts) / len(amounts)
            std_dev = variance ** 0.5
        else:
            mean_amount = avg
            std_dev = 0
        
        suppliers_list.append({
            "supplier": supplier,
            "total_amount": round(data["total_amount"], 2),
            "total_vat": round(data["total_vat"], 2),
            "total_net": round(data["total_net"], 2),
            "invoice_count": data["invoice_count"],
            "avg_invoice": round(avg, 2),
            "first_delivery": first_delivery.strftime("%Y-%m-%d") if first_delivery else None,
            "last_delivery": last_delivery.strftime("%Y-%m-%d") if last_delivery else None,
            "is_active": is_active,
            "days_inactive": days_inactive if not is_active else 0,
            "std_dev": round(std_dev, 2)
        })
    
    # Add dependency percentage
    for s in suppliers_list:
        s["dependency_percent"] = round((s["total_amount"] / total_all * 100), 1) if total_all > 0 else 0
    
    # Sort by total amount for TOP by amount
    top_by_amount = sorted(suppliers_list, key=lambda x: x["total_amount"], reverse=True)[:10]
    
    # TOP by frequency
    top_by_frequency = sorted(suppliers_list, key=lambda x: x["invoice_count"], reverse=True)[:10]
    
    # TOP by average invoice
    top_by_avg = sorted(suppliers_list, key=lambda x: x["avg_invoice"], reverse=True)[:10]
    
    # Inactive suppliers
    inactive_suppliers = [s for s in suppliers_list if not s["is_active"]]
    inactive_suppliers.sort(key=lambda x: x["days_inactive"], reverse=True)
    
    # High dependency alert (>30%)
    high_dependency = [s for s in suppliers_list if s["dependency_percent"] > 30]
    
    # Calculate totals
    total_vat = sum(s["total_vat"] for s in suppliers_list)
    total_net = sum(s["total_net"] for s in suppliers_list)
    total_invoices = sum(s["invoice_count"] for s in suppliers_list)
    
    # Executive summary
    top_3_concentration = sum(s["dependency_percent"] for s in top_by_amount[:3]) if len(top_by_amount) >= 3 else 0
    top_5_concentration = sum(s["dependency_percent"] for s in top_by_amount[:5]) if len(top_by_amount) >= 5 else 0
    
    return {
        "period": {
            "start_date": start_date,
            "end_date": end_date
        },
        "executive_summary": {
            "top_3_concentration": round(top_3_concentration, 1),
            "top_5_concentration": round(top_5_concentration, 1),
            "total_suppliers": len(suppliers_list),
            "active_suppliers": len([s for s in suppliers_list if s["is_active"]]),
            "inactive_suppliers": len(inactive_suppliers),
            "high_dependency_count": len(high_dependency),
            "largest_supplier": top_by_amount[0]["supplier"] if top_by_amount else None,
            "largest_amount": top_by_amount[0]["total_amount"] if top_by_amount else 0
        },
        "totals": {
            "total_amount": round(total_all, 2),
            "total_vat": round(total_vat, 2),
            "total_net": round(total_net, 2),
            "supplier_count": len(suppliers_list),
            "invoice_count": total_invoices
        },
        "top_by_amount": top_by_amount,
        "top_by_frequency": top_by_frequency,
        "top_by_avg": top_by_avg,
        "inactive_suppliers": inactive_suppliers[:10],
        "high_dependency_alerts": high_dependency,
        "all_suppliers": suppliers_list
    }

@api_router.get("/statistics/supplier/{supplier_name}/detailed")
async def get_detailed_supplier_stats(
    supplier_name: str,
    current_user: User = Depends(get_current_user)
):
    """Get detailed statistics for a specific supplier with trends"""
    from collections import defaultdict
    from urllib.parse import unquote
    
    supplier_name = unquote(supplier_name)
    
    # Get all invoices for this supplier (no date filter for full history)
    query = {
        "user_id": current_user.user_id,
        "supplier": {"$regex": f"^{supplier_name}$", "$options": "i"}
    }
    
    invoices = await db.invoices.find(query, {"_id": 0, "image_base64": 0}).sort("date", 1).to_list(10000)
    
    if not invoices:
        return {
            "supplier": supplier_name,
            "found": False,
            "invoice_count": 0
        }
    
    now = datetime.now(timezone.utc)
    
    # Basic stats
    total_amount = sum(inv.get("total_amount", 0) for inv in invoices)
    total_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_net = sum(inv.get("amount_without_vat", 0) for inv in invoices)
    avg_invoice = total_amount / len(invoices) if invoices else 0
    
    # Extract dates
    dates = []
    amounts = []
    for inv in invoices:
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            dates.append(date_val)
            amounts.append(inv.get("total_amount", 0))
    
    first_delivery = min(dates) if dates else None
    last_delivery = max(dates) if dates else None
    
    # Ensure timezone consistency for date calculations
    if last_delivery:
        if last_delivery.tzinfo is None:
            last_delivery = last_delivery.replace(tzinfo=timezone.utc)
        days_inactive = (now - last_delivery).days
    else:
        days_inactive = 999
    
    is_active = days_inactive <= 30
    
    # Monthly breakdown
    monthly_data = defaultdict(lambda: {"amount": 0, "count": 0})
    for inv in invoices:
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            month_key = date_val.strftime("%Y-%m")
            monthly_data[month_key]["amount"] += inv.get("total_amount", 0)
            monthly_data[month_key]["count"] += 1
    
    # Sort monthly data
    sorted_months = sorted(monthly_data.keys())
    monthly_trend = []
    prev_amount = 0
    for month in sorted_months[-12:]:  # Last 12 months
        data = monthly_data[month]
        growth = ((data["amount"] - prev_amount) / prev_amount * 100) if prev_amount > 0 else 0
        monthly_trend.append({
            "month": month,
            "amount": round(data["amount"], 2),
            "count": data["count"],
            "growth_percent": round(growth, 1)
        })
        prev_amount = data["amount"]
    
    # Calculate anomalies
    if len(amounts) >= 3:
        mean_amount = sum(amounts) / len(amounts)
        variance = sum((x - mean_amount) ** 2 for x in amounts) / len(amounts)
        std_dev = variance ** 0.5
        threshold = mean_amount + (2 * std_dev)
        
        anomalies = []
        for inv in invoices:
            if inv.get("total_amount", 0) > threshold:
                date_val = inv.get("date")
                date_str = date_val.strftime("%Y-%m-%d") if isinstance(date_val, datetime) else str(date_val)[:10]
                anomalies.append({
                    "date": date_str,
                    "amount": inv.get("total_amount", 0),
                    "invoice_number": inv.get("invoice_number"),
                    "deviation_percent": round((inv.get("total_amount", 0) - mean_amount) / mean_amount * 100, 1)
                })
    else:
        anomalies = []
    
    # Recent invoices
    recent_invoices = []
    for inv in invoices[-10:][::-1]:
        date_val = inv.get("date")
        date_str = date_val.strftime("%Y-%m-%d") if isinstance(date_val, datetime) else str(date_val)[:10]
        recent_invoices.append({
            "id": inv.get("id"),
            "invoice_number": inv.get("invoice_number"),
            "date": date_str,
            "total_amount": inv.get("total_amount", 0),
            "vat_amount": inv.get("vat_amount", 0)
        })
    
    return {
        "supplier": supplier_name,
        "found": True,
        "overview": {
            "total_amount": round(total_amount, 2),
            "total_vat": round(total_vat, 2),
            "total_net": round(total_net, 2),
            "invoice_count": len(invoices),
            "avg_invoice": round(avg_invoice, 2),
            "first_delivery": first_delivery.strftime("%Y-%m-%d") if first_delivery else None,
            "last_delivery": last_delivery.strftime("%Y-%m-%d") if last_delivery else None,
            "is_active": is_active,
            "days_inactive": days_inactive if not is_active else 0
        },
        "monthly_trend": monthly_trend,
        "anomalies": anomalies,
        "recent_invoices": recent_invoices
    }

@api_router.get("/statistics/suppliers/compare")
async def compare_suppliers(
    suppliers: str,  # comma-separated supplier names
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Compare multiple suppliers"""
    from urllib.parse import unquote
    
    supplier_names = [unquote(s.strip()) for s in suppliers.split(",") if s.strip()]
    
    if len(supplier_names) < 2 or len(supplier_names) > 5:
        raise HTTPException(status_code=400, detail="Изберете между 2 и 5 доставчика за сравнение")
    
    # Build date query
    date_query = {}
    if start_date:
        date_query["$gte"] = datetime.fromisoformat(start_date + "T00:00:00+00:00")
    if end_date:
        date_query["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    comparison = []
    
    for supplier_name in supplier_names:
        query = {
            "user_id": current_user.user_id,
            "supplier": {"$regex": f"^{supplier_name}$", "$options": "i"}
        }
        if date_query:
            query["date"] = date_query
        
        invoices = await db.invoices.find(query, {"_id": 0, "total_amount": 1, "date": 1}).to_list(10000)
        
        total = sum(inv.get("total_amount", 0) for inv in invoices)
        count = len(invoices)
        avg = total / count if count > 0 else 0
        
        comparison.append({
            "supplier": supplier_name,
            "total_amount": round(total, 2),
            "invoice_count": count,
            "avg_invoice": round(avg, 2)
        })
    
    # Calculate max for percentage calculation
    max_amount = max(c["total_amount"] for c in comparison) if comparison else 1
    max_count = max(c["invoice_count"] for c in comparison) if comparison else 1
    
    for c in comparison:
        c["amount_percent"] = round(c["total_amount"] / max_amount * 100, 1) if max_amount > 0 else 0
        c["count_percent"] = round(c["invoice_count"] / max_count * 100, 1) if max_count > 0 else 0
    
    return {
        "suppliers": comparison,
        "period": {"start_date": start_date, "end_date": end_date}
    }

@api_router.get("/statistics/supplier/{supplier_name}")
async def get_single_supplier_stats(
    supplier_name: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get detailed statistics for a specific supplier"""
    query = {
        "user_id": current_user.user_id,
        "supplier": {"$regex": f"^{supplier_name}$", "$options": "i"}
    }
    
    if start_date or end_date:
        query["date"] = {}
        if start_date:
            query["date"]["$gte"] = datetime.fromisoformat(start_date + "T00:00:00+00:00")
        if end_date:
            query["date"]["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    invoices = await db.invoices.find(query, {"_id": 0, "image_base64": 0}).sort("date", -1).to_list(1000)
    
    if not invoices:
        return {
            "supplier": supplier_name,
            "invoice_count": 0,
            "total_amount": 0,
            "invoices": []
        }
    
    total_amount = sum(inv.get("total_amount", 0) for inv in invoices)
    total_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_net = sum(inv.get("amount_without_vat", 0) for inv in invoices)
    
    # Format invoices
    formatted_invoices = []
    for inv in invoices:
        date_val = inv.get("date")
        if isinstance(date_val, datetime):
            date_str = date_val.strftime("%Y-%m-%d")
        else:
            date_str = str(date_val)[:10]
        
        formatted_invoices.append({
            "id": inv.get("id"),
            "invoice_number": inv.get("invoice_number"),
            "date": date_str,
            "total_amount": inv.get("total_amount", 0),
            "vat_amount": inv.get("vat_amount", 0),
            "amount_without_vat": inv.get("amount_without_vat", 0)
        })
    
    return {
        "supplier": supplier_name,
        "invoice_count": len(invoices),
        "total_amount": round(total_amount, 2),
        "total_vat": round(total_vat, 2),
        "total_net": round(total_net, 2),
        "avg_invoice": round(total_amount / len(invoices), 2) if invoices else 0,
        "invoices": formatted_invoices
    }

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

# ===================== BACKUP ENDPOINTS =====================

class BackupData(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    invoices: List[dict] = []
    daily_revenues: List[dict] = []
    expenses: List[dict] = []
    company: Optional[dict] = None

class BackupMetadata(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    file_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    size_bytes: int
    invoice_count: int
    revenue_count: int
    expense_count: int
    google_drive_file_id: Optional[str] = None

@api_router.post("/backup/create")
async def create_backup(current_user: User = Depends(get_current_user)):
    """Създава backup на всички данни на потребителя"""
    import json
    
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    company_id = user_doc.get("company_id") if user_doc else None
    
    # Събиране на фактури
    invoices = await db.invoices.find(
        {"user_id": current_user.user_id},
        {"_id": 0}
    ).to_list(10000)
    
    # Конвертиране на datetime обекти
    for inv in invoices:
        if isinstance(inv.get("date"), datetime):
            inv["date"] = inv["date"].isoformat()
        if isinstance(inv.get("created_at"), datetime):
            inv["created_at"] = inv["created_at"].isoformat()
    
    # Събиране на дневни обороти
    revenues = await db.daily_revenue.find(
        {"user_id": current_user.user_id},
        {"_id": 0}
    ).to_list(10000)
    
    for rev in revenues:
        if isinstance(rev.get("date"), datetime):
            rev["date"] = rev["date"].isoformat()
        if isinstance(rev.get("created_at"), datetime):
            rev["created_at"] = rev["created_at"].isoformat()
    
    # Събиране на разходи
    expenses = await db.expenses.find(
        {"user_id": current_user.user_id},
        {"_id": 0}
    ).to_list(10000)
    
    for exp in expenses:
        if isinstance(exp.get("date"), datetime):
            exp["date"] = exp["date"].isoformat()
        if isinstance(exp.get("created_at"), datetime):
            exp["created_at"] = exp["created_at"].isoformat()
    
    # Събиране на данни за фирма
    company_data = None
    if company_id:
        company_data = await db.companies.find_one({"id": company_id}, {"_id": 0})
        if company_data:
            if isinstance(company_data.get("created_at"), datetime):
                company_data["created_at"] = company_data["created_at"].isoformat()
            if isinstance(company_data.get("updated_at"), datetime):
                company_data["updated_at"] = company_data["updated_at"].isoformat()
    
    backup_data = {
        "id": str(uuid.uuid4()),
        "user_id": current_user.user_id,
        "user_email": current_user.email,
        "user_name": current_user.name,
        "company_id": company_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "app_version": "1.0.0",
        "invoices": invoices,
        "daily_revenues": revenues,
        "expenses": expenses,
        "company": company_data,
        "statistics": {
            "invoice_count": len(invoices),
            "revenue_count": len(revenues),
            "expense_count": len(expenses)
        }
    }
    
    # Записване на metadata за backup
    backup_json = json.dumps(backup_data, ensure_ascii=False)
    metadata = BackupMetadata(
        user_id=current_user.user_id,
        file_name=f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
        size_bytes=len(backup_json.encode('utf-8')),
        invoice_count=len(invoices),
        revenue_count=len(revenues),
        expense_count=len(expenses)
    )
    
    await db.backup_metadata.insert_one(metadata.dict())
    
    return backup_data

@api_router.get("/backup/list")
async def list_backups(current_user: User = Depends(get_current_user)):
    """Връща списък с всички backups на потребителя"""
    backups = await db.backup_metadata.find(
        {"user_id": current_user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return {"backups": backups}

@api_router.post("/backup/restore")
async def restore_backup(backup_data: dict, current_user: User = Depends(get_current_user)):
    """Възстановява данни от backup"""
    
    restored_counts = {
        "invoices": 0,
        "revenues": 0,
        "expenses": 0
    }
    
    # Възстановяване на фактури
    if "invoices" in backup_data:
        for invoice in backup_data["invoices"]:
            # Проверка за дублиране
            existing = await db.invoices.find_one({
                "user_id": current_user.user_id,
                "id": invoice.get("id")
            })
            if not existing:
                invoice["user_id"] = current_user.user_id
                if isinstance(invoice.get("date"), str):
                    invoice["date"] = datetime.fromisoformat(invoice["date"].replace("Z", "+00:00"))
                if isinstance(invoice.get("created_at"), str):
                    invoice["created_at"] = datetime.fromisoformat(invoice["created_at"].replace("Z", "+00:00"))
                await db.invoices.insert_one(invoice)
                restored_counts["invoices"] += 1
    
    # Възстановяване на дневни обороти
    if "daily_revenues" in backup_data:
        for revenue in backup_data["daily_revenues"]:
            existing = await db.daily_revenue.find_one({
                "user_id": current_user.user_id,
                "id": revenue.get("id")
            })
            if not existing:
                revenue["user_id"] = current_user.user_id
                if isinstance(revenue.get("date"), str):
                    revenue["date"] = datetime.fromisoformat(revenue["date"].replace("Z", "+00:00"))
                await db.daily_revenue.insert_one(revenue)
                restored_counts["revenues"] += 1
    
    # Възстановяване на разходи
    if "expenses" in backup_data:
        for expense in backup_data["expenses"]:
            existing = await db.expenses.find_one({
                "user_id": current_user.user_id,
                "id": expense.get("id")
            })
            if not existing:
                expense["user_id"] = current_user.user_id
                if isinstance(expense.get("date"), str):
                    expense["date"] = datetime.fromisoformat(expense["date"].replace("Z", "+00:00"))
                await db.expenses.insert_one(expense)
                restored_counts["expenses"] += 1
    
    return {
        "success": True,
        "message": "Данните са възстановени успешно",
        "restored": restored_counts
    }

@api_router.get("/backup/status")
async def get_backup_status(current_user: User = Depends(get_current_user)):
    """Връща статус на последния backup"""
    last_backup = await db.backup_metadata.find_one(
        {"user_id": current_user.user_id},
        {"_id": 0}
    )
    
    if last_backup:
        return {
            "has_backup": True,
            "last_backup_date": last_backup.get("created_at"),
            "file_name": last_backup.get("file_name"),
            "statistics": {
                "invoices": last_backup.get("invoice_count", 0),
                "revenues": last_backup.get("revenue_count", 0),
                "expenses": last_backup.get("expense_count", 0)
            }
        }
    
    return {
        "has_backup": False,
        "last_backup_date": None
    }

# ===================== ITEM PRICE TRACKING =====================

@api_router.get("/items/price-alerts")
async def get_price_alerts(
    status: Optional[str] = None,  # unread, read, dismissed
    current_user: User = Depends(get_current_user)
):
    """Връща ценови аларми за фирмата"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"alerts": [], "total": 0, "unread_count": 0}
    
    query = {"company_id": company_id}
    if status:
        query["status"] = status
    
    alerts = await db.price_alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)
    
    # Count unread
    unread_count = await db.price_alerts.count_documents({"company_id": company_id, "status": "unread"})
    
    return {
        "alerts": alerts,
        "total": len(alerts),
        "unread_count": unread_count
    }

@api_router.put("/items/price-alerts/{alert_id}")
async def update_price_alert(
    alert_id: str,
    request: Request,
    current_user: User = Depends(get_current_user)
):
    """Обновява статус на аларма (read, dismissed)"""
    body = await request.json()
    status = body.get("status")
    
    if status not in ["read", "dismissed"]:
        raise HTTPException(status_code=400, detail="Невалиден статус")
    
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    result = await db.price_alerts.update_one(
        {"id": alert_id, "company_id": company_id},
        {"$set": {"status": status}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Алармата не е намерена")
    
    return {"message": "Статусът е обновен"}

@api_router.get("/items/price-alert-settings")
async def get_price_alert_settings(current_user: User = Depends(get_current_user)):
    """Връща настройки за ценови аларми"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"threshold_percent": 10.0, "enabled": True}
    
    settings = await db.price_alert_settings.find_one({"company_id": company_id}, {"_id": 0})
    
    if not settings:
        return {"threshold_percent": 10.0, "enabled": True}
    
    return {
        "threshold_percent": settings.get("threshold_percent", 10.0),
        "enabled": settings.get("enabled", True)
    }

@api_router.put("/items/price-alert-settings")
async def update_price_alert_settings(
    request: Request,
    current_user: User = Depends(get_current_user)
):
    """Обновява настройки за ценови аларми"""
    body = await request.json()
    
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")
    
    update_data = {}
    if "threshold_percent" in body:
        update_data["threshold_percent"] = float(body["threshold_percent"])
    if "enabled" in body:
        update_data["enabled"] = bool(body["enabled"])
    
    existing = await db.price_alert_settings.find_one({"company_id": company_id})
    
    if existing:
        await db.price_alert_settings.update_one(
            {"company_id": company_id},
            {"$set": update_data}
        )
    else:
        settings = PriceAlertSettings(company_id=company_id, **update_data)
        await db.price_alert_settings.insert_one(settings.dict())
    
    return {"message": "Настройките са запазени"}

@api_router.get("/items/price-history/{item_name}")
async def get_item_price_history(
    item_name: str,
    supplier: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Връща история на цените за артикул"""
    from urllib.parse import unquote
    
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"history": [], "statistics": {}}
    
    item_name = unquote(item_name).strip().lower()
    
    query = {
        "company_id": company_id,
        "item_name": item_name
    }
    if supplier:
        query["supplier"] = {"$regex": f"^{unquote(supplier)}$", "$options": "i"}
    
    history = await db.item_price_history.find(query, {"_id": 0}).sort("invoice_date", 1).to_list(1000)
    
    if not history:
        return {"history": [], "statistics": {}}
    
    # Calculate statistics
    prices = [h["unit_price"] for h in history]
    avg_price = sum(prices) / len(prices) if prices else 0
    min_price = min(prices) if prices else 0
    max_price = max(prices) if prices else 0
    
    # Calculate variance
    if len(prices) > 1:
        variance = sum((p - avg_price) ** 2 for p in prices) / len(prices)
        std_dev = variance ** 0.5
    else:
        std_dev = 0
    
    # Trend (last 3 vs first 3)
    if len(prices) >= 6:
        first_avg = sum(prices[:3]) / 3
        last_avg = sum(prices[-3:]) / 3
        trend_percent = ((last_avg - first_avg) / first_avg * 100) if first_avg > 0 else 0
    else:
        trend_percent = 0
    
    # Format history for response
    formatted_history = []
    for h in history:
        date_val = h.get("invoice_date")
        date_str = date_val.strftime("%Y-%m-%d") if isinstance(date_val, datetime) else str(date_val)[:10]
        formatted_history.append({
            "date": date_str,
            "supplier": h.get("supplier"),
            "unit_price": h.get("unit_price"),
            "quantity": h.get("quantity"),
            "unit": h.get("unit"),
            "invoice_number": h.get("invoice_number")
        })
    
    return {
        "item_name": item_name,
        "history": formatted_history,
        "statistics": {
            "avg_price": round(avg_price, 2),
            "min_price": round(min_price, 2),
            "max_price": round(max_price, 2),
            "std_dev": round(std_dev, 2),
            "trend_percent": round(trend_percent, 1),
            "total_records": len(history)
        }
    }

@api_router.get("/statistics/items")
async def get_item_statistics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    top_n: int = 10,
    current_user: User = Depends(get_current_user)
):
    """Връща статистика за артикули - топ N по брой и стойност"""
    from collections import defaultdict
    
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {
            "totals": {"total_items": 0, "total_value": 0, "unique_items": 0},
            "top_by_quantity": [],
            "top_by_value": [],
            "top_by_frequency": [],
            "price_trends": []
        }
    
    # Build date query
    query = {"company_id": company_id}
    if start_date or end_date:
        query["invoice_date"] = {}
        if start_date:
            query["invoice_date"]["$gte"] = datetime.fromisoformat(start_date + "T00:00:00+00:00")
        if end_date:
            query["invoice_date"]["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    # Get all price history records
    history = await db.item_price_history.find(query, {"_id": 0}).to_list(10000)
    
    if not history:
        return {
            "totals": {"total_items": 0, "total_value": 0, "unique_items": 0},
            "top_by_quantity": [],
            "top_by_value": [],
            "top_by_frequency": [],
            "price_trends": []
        }
    
    # Aggregate by item
    item_stats = defaultdict(lambda: {
        "quantity": 0,
        "total_value": 0,
        "frequency": 0,
        "prices": [],
        "suppliers": set()
    })
    
    for record in history:
        name = record["item_name"]
        price = record["unit_price"]
        qty = record["quantity"]
        
        item_stats[name]["quantity"] += qty
        item_stats[name]["total_value"] += price * qty
        item_stats[name]["frequency"] += 1
        item_stats[name]["prices"].append(price)
        item_stats[name]["suppliers"].add(record["supplier"])
    
    # Calculate statistics for each item
    items_list = []
    for name, stats in item_stats.items():
        prices = stats["prices"]
        avg_price = sum(prices) / len(prices) if prices else 0
        
        # Price variance
        if len(prices) > 1:
            variance = sum((p - avg_price) ** 2 for p in prices) / len(prices)
            price_variance = (variance ** 0.5) / avg_price * 100 if avg_price > 0 else 0
        else:
            price_variance = 0
        
        # Trend
        if len(prices) >= 4:
            first_half = sum(prices[:len(prices)//2]) / (len(prices)//2)
            second_half = sum(prices[len(prices)//2:]) / (len(prices) - len(prices)//2)
            trend = ((second_half - first_half) / first_half * 100) if first_half > 0 else 0
        else:
            trend = 0
        
        items_list.append({
            "item_name": name,
            "quantity": round(stats["quantity"], 2),
            "total_value": round(stats["total_value"], 2),
            "frequency": stats["frequency"],
            "avg_price": round(avg_price, 2),
            "min_price": round(min(prices), 2) if prices else 0,
            "max_price": round(max(prices), 2) if prices else 0,
            "price_variance": round(price_variance, 1),
            "trend_percent": round(trend, 1),
            "supplier_count": len(stats["suppliers"])
        })
    
    # Sort by different criteria
    top_by_quantity = sorted(items_list, key=lambda x: x["quantity"], reverse=True)[:top_n]
    top_by_value = sorted(items_list, key=lambda x: x["total_value"], reverse=True)[:top_n]
    top_by_frequency = sorted(items_list, key=lambda x: x["frequency"], reverse=True)[:top_n]
    
    # Items with significant price changes
    price_trends = sorted(
        [i for i in items_list if abs(i["trend_percent"]) > 5],
        key=lambda x: abs(x["trend_percent"]),
        reverse=True
    )[:top_n]
    
    # Totals
    total_quantity = sum(i["quantity"] for i in items_list)
    total_value = sum(i["total_value"] for i in items_list)
    
    return {
        "totals": {
            "total_items": round(total_quantity, 2),
            "total_value": round(total_value, 2),
            "unique_items": len(items_list)
        },
        "top_by_quantity": top_by_quantity,
        "top_by_value": top_by_value,
        "top_by_frequency": top_by_frequency,
        "price_trends": price_trends
    }

@api_router.get("/statistics/items/{item_name}/by-supplier")
async def get_item_by_supplier(
    item_name: str,
    current_user: User = Depends(get_current_user)
):
    """Сравнява цените на артикул между различни доставчици"""
    from collections import defaultdict
    from urllib.parse import unquote
    
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"item_name": item_name, "suppliers": []}
    
    normalized_name = unquote(item_name).strip().lower()
    
    history = await db.item_price_history.find(
        {"company_id": company_id, "item_name": normalized_name},
        {"_id": 0}
    ).to_list(10000)
    
    if not history:
        return {"item_name": item_name, "suppliers": [], "recommendation": None}
    
    # Group by supplier
    supplier_data = defaultdict(lambda: {"prices": [], "quantities": [], "dates": []})
    
    for record in history:
        supplier = record["supplier"]
        supplier_data[supplier]["prices"].append(record["unit_price"])
        supplier_data[supplier]["quantities"].append(record["quantity"])
        date_val = record.get("invoice_date")
        if isinstance(date_val, datetime):
            supplier_data[supplier]["dates"].append(date_val)
    
    # Calculate stats per supplier
    suppliers = []
    for supplier, data in supplier_data.items():
        prices = data["prices"]
        avg = sum(prices) / len(prices) if prices else 0
        last_date = max(data["dates"]) if data["dates"] else None
        
        suppliers.append({
            "supplier": supplier,
            "avg_price": round(avg, 2),
            "min_price": round(min(prices), 2) if prices else 0,
            "max_price": round(max(prices), 2) if prices else 0,
            "last_price": round(prices[-1], 2) if prices else 0,
            "purchase_count": len(prices),
            "total_quantity": round(sum(data["quantities"]), 2),
            "last_purchase": last_date.strftime("%Y-%m-%d") if last_date else None
        })
    
    # Sort by average price (cheapest first)
    suppliers.sort(key=lambda x: x["avg_price"])
    
    # Recommendation
    recommendation = None
    if len(suppliers) >= 2:
        cheapest = suppliers[0]
        most_expensive = suppliers[-1]
        if cheapest["avg_price"] > 0:
            savings_percent = ((most_expensive["avg_price"] - cheapest["avg_price"]) / most_expensive["avg_price"] * 100)
            if savings_percent > 5:
                recommendation = {
                    "best_supplier": cheapest["supplier"],
                    "avg_price": cheapest["avg_price"],
                    "potential_savings_percent": round(savings_percent, 1)
                }
    
    return {
        "item_name": item_name,
        "suppliers": suppliers,
        "recommendation": recommendation
    }

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

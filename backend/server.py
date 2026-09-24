from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Response, Request, BackgroundTasks
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
from enum import Enum
import uuid
from datetime import datetime, timezone, timedelta
import base64
import httpx
import io
import re
import json
import difflib
from passlib.context import CryptContext
import certifi
from anthropic import AsyncAnthropic
import anthropic as anthropic_sdk

# The anthropic SDK's HTTP client (httpx2) verifies TLS against the
# operating system's native certificate store by default. That store isn't
# reliably populated on minimal container hosts (Render's included), which
# surfaces as a generic httpx2 "Connection error" on every request with no
# other symptom. Pointing it at certifi's bundled CA file (what every other
# HTTP client in this app already relies on) sidesteps the OS store entirely.
os.environ.setdefault('SSL_CERT_FILE', certifi.where())

# Rate limiting
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Environment
IS_PRODUCTION = os.environ.get('ENVIRONMENT', 'development') == 'production'

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'test_database')]

# AI features (OCR scanning, AI item merge, AI ROI insights) run on the
# Anthropic API directly. Disabled automatically when no key is configured
# (e.g. a fresh deploy before the Render env var is set), so the rest of the
# app keeps working without them.
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
AI_FEATURES_ENABLED = bool(ANTHROPIC_API_KEY)
anthropic_client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY) if AI_FEATURES_ENABLED else None

# Create the main app
app = FastAPI(
    title="Invoice Manager API",
    version="1.0.0",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc"
)

# Add rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
    permissions: List[str] = Field(default_factory=list)  # Конкретните права за тази фирма - виж ROLE_PERMISSIONS
    password_hash: Optional[str] = None  # За email/password auth
    auth_provider: str = "email"  # "google" or "email"
    has_password: bool = False  # Дали акаунтът има парола (за да предложим "задай парола" на Google потребители)
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

class ChangePassword(BaseModel):
    current_password: Optional[str] = None  # Не се изисква, ако акаунтът все още няма парола (напр. Google вход)
    new_password: str

# Invitation model for user invitations
class Invitation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    invited_by: str  # user_id на изпращача
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str = "staff"  # Роля за поканения
    permissions: List[str] = Field(default_factory=list)  # Конкретните права, избрани от титуляря при поканата
    code: str = Field(default_factory=lambda: uuid.uuid4().hex[:8].upper())  # 8-символен код
    status: str = "pending"  # "pending", "accepted", "cancelled", "expired"
    expires_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc) + timedelta(days=7))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class InvitationCreate(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str = "staff"
    permissions: Optional[List[str]] = None  # None = ролята по подразбиране

class CompanyMembership(BaseModel):
    """Проследява ВСИЧКИ фирми, до които потребител има достъп - не само
    текущата активна (users.company_id/role). За обикновен owner/manager/
    staff си остава един-единствен запис. За счетоводител с достъп до
    няколко фирми клиенти, това е списъкът, от който се "превключва"
    активната фирма (виж /companies/switch)."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: str
    role: str
    permissions: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class VatTreatment(str, Enum):
    STANDARD_20 = "standard_20"        # Стандартна ставка 20%
    REDUCED_9 = "reduced_9"            # Намалена ставка 9% (хотели, книги...)
    ZERO_RATE = "zero_rate"            # Нулева ставка (износ / ВОД)
    EXEMPT = "exempt"                  # Освободена доставка
    REVERSE_CHARGE = "reverse_charge"  # Обратно начисляване / ВОП (протокол чл.117/чл.84)
    OUTSIDE_SCOPE = "outside_scope"    # Извън обхвата на ЗДДС

class Invoice(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None  # Връзка към фирмата
    supplier: str
    supplier_eik: Optional[str] = None  # ЕИК/Булстат на доставчика
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    vat_treatment: Optional[VatTreatment] = None  # ДДС третиране за дневника на покупки
    protocol_number: Optional[str] = None  # Номер на протокол по чл.117 ЗДДС (само за reverse_charge)
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
    supplier_eik: Optional[str] = None
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    vat_treatment: Optional[VatTreatment] = None
    date: str
    image_base64: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[InvoiceItemCreate]] = None  # Артикули

class InvoiceUpdate(BaseModel):
    supplier: Optional[str] = None
    supplier_eik: Optional[str] = None
    invoice_number: Optional[str] = None
    amount_without_vat: Optional[float] = None
    vat_amount: Optional[float] = None
    total_amount: Optional[float] = None
    vat_treatment: Optional[VatTreatment] = None
    protocol_number: Optional[str] = None
    date: Optional[str] = None
    notes: Optional[str] = None

class DailyRevenue(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None
    date: str
    fiscal_revenue: float = 0
    pocket_money: float = 0  # "джобче" - не влиза в ДДС
    vat_rate_percent: float = 20.0  # Ставката на фискализирания оборот (20% стандартна, 9% намалена, 0%)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DailyRevenueCreate(BaseModel):
    date: str
    fiscal_revenue: float = 0
    pocket_money: float = 0
    vat_rate_percent: float = 20.0

class NonInvoiceExpense(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None
    description: str
    amount: float
    date: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class NonInvoiceExpenseCreate(BaseModel):
    description: str
    amount: float
    date: str

# ===================== PERSONAL EXPENSES & ROI MODELS =====================

class PersonalExpenseType(str, Enum):
    INVESTMENT = "investment"  # Инвестиция
    RECURRING = "recurring"    # Текущ разход
    ONE_TIME = "one_time"      # Еднократен

class PersonalExpenseCategory(str, Enum):
    GOODS = "goods"            # Стока
    SERVICE = "service"        # Услуга
    PERSONNEL = "personnel"    # Персонал
    RENT = "rent"              # Наем
    EXTRAORDINARY = "extraordinary"  # Извънреден
    OTHER = "other"            # Друго

class PersonalExpense(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: str
    amount: float
    description: str
    expense_type: PersonalExpenseType = PersonalExpenseType.RECURRING
    category: PersonalExpenseCategory = PersonalExpenseCategory.OTHER
    period_month: int  # 1-12
    period_year: int
    supplier_id: Optional[str] = None  # Връзка с доставчик (ако има)
    project_name: Optional[str] = None  # Връзка с проект (ако има)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PersonalExpenseCreate(BaseModel):
    amount: float
    description: str
    expense_type: str = "recurring"
    category: str = "other"
    period_month: int
    period_year: int
    supplier_id: Optional[str] = None
    project_name: Optional[str] = None
    notes: Optional[str] = None

class ROIAnalysis(BaseModel):
    period_start: str
    period_end: str
    total_personal_investment: float
    total_revenue: float
    total_profit: float
    roi_percent: float
    is_profitable: bool
    investment_covered: bool
    ai_insights: List[str]

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

class OCRItemResult(BaseModel):
    name: str
    quantity: float = 1
    unit: str = "бр."
    unit_price: float
    total_price: float

class OCRResult(BaseModel):
    supplier: str
    supplier_eik: Optional[str] = None  # ЕИК на доставчика, ако е видим на фактурата
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    invoice_date: Optional[str] = None  # Дата на издаване от фактурата
    items: List[OCRItemResult] = []  # Разпознати продукти от таблицата с артикули
    corrections: Optional[List[str]] = None  # Списък с направени корекции
    confidence: Optional[float] = None  # Увереност в резултата (0-1)

class SessionDataResponse(BaseModel):
    id: str
    email: str
    name: str
    picture: Optional[str] = None
    session_token: str

# ===================== AUTH HELPERS =====================

VALID_ROLES = {"owner", "manager", "staff", "accountant"}

async def repair_invalid_role(user_doc: dict) -> dict:
    """Поправя легаси/невалидни стойности на role (напр. от стари версии на схемата).

    Ако фирмата на потребителя няма нито един owner, той/тя става owner
    (най-вероятно е основателят на фирмата и просто данните му са останали
    с остаряла стойност). В противен случай, за да не ескалираме права без
    основание, се връща към най-ниската роля - staff.
    """
    company_id = user_doc.get("company_id")
    fixed_role = "staff"
    if company_id:
        has_owner = await db.users.count_documents({"company_id": company_id, "role": "owner"})
        if not has_owner:
            fixed_role = "owner"
    await db.users.update_one({"user_id": user_doc["user_id"]}, {"$set": {"role": fixed_role}})
    user_doc["role"] = fixed_role
    return user_doc

def sanitize_user(user_doc: dict) -> dict:
    """Премахва password_hash от документа на потребителя и добавя has_password флаг.

    Also backfills permissions for any account from before per-user
    permissions existed, so every response that returns a user (login,
    register, /auth/me, company switch...) always carries a real list -
    never an empty one that would silently strip a legacy owner's access."""
    user_doc = dict(user_doc)
    user_doc["has_password"] = bool(user_doc.get("password_hash"))
    user_doc.pop("password_hash", None)
    if not user_doc.get("permissions"):
        user_doc["permissions"] = resolve_permissions(user_doc.get("role", "staff"), None)
    return user_doc

async def get_company_scope(current_user: User) -> tuple:
    """Resolves the current user's company_id and a MongoDB query filter
    that scopes a read to the WHOLE company's records (every teammate),
    not just the ones the current user personally entered.

    Also matches records that predate a collection's company_id field (or
    were created by a solo user before they had a company) - identified by
    company_id being null/missing - as long as they belong to a CURRENT
    member of this company, so this fix doesn't hide pre-existing history.
    Returns (company_id, query_filter_dict).
    """
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    if not company_id:
        return None, {"user_id": current_user.user_id}

    member_docs = await db.users.find({"company_id": company_id}, {"_id": 0, "user_id": 1}).to_list(1000)
    member_ids = [m["user_id"] for m in member_docs]
    return company_id, {
        "$or": [
            {"company_id": company_id},
            {"user_id": {"$in": member_ids}, "company_id": None},
        ]
    }

# Mirrors the role-permission matrix in frontend/src/utils/permissions.ts.
# That copy decides what a role can SEE (which menu links/screens render);
# this one is what actually protects the data - keep both in sync whenever
# a role or a gated feature changes here.
#
# ROLE_PERMISSIONS is the DEFAULT set a role starts with (used the moment
# someone is invited or switched to that role, before any fine-tuning).
# ROLE_CONFIGURABLE_PERMISSIONS is the ceiling of what the owner may tick
# on or off for that role via the permissions checklist - manage_users and
# manage_company never appear there for anyone but the owner, since those
# concern the company's legal data and who else gets access to it, not a
# day-to-day work permission.
ROLE_PERMISSIONS = {
    "owner": {
        "manage_users", "manage_company", "view_audit_log", "manage_budget",
        "export_data", "view_statistics", "manage_invoices", "add_revenue", "add_expenses",
    },
    "manager": {
        "manage_budget", "export_data", "view_statistics", "manage_invoices",
        "add_revenue", "add_expenses",
    },
    "staff": {"manage_invoices", "add_revenue", "add_expenses"},
    "accountant": {
        "view_audit_log", "manage_budget", "export_data", "view_statistics", "manage_invoices",
    },
}

_STAFF_LIKE_CONFIGURABLE = {
    "view_audit_log", "manage_budget", "export_data", "view_statistics",
    "manage_invoices", "add_revenue", "add_expenses",
}

ROLE_CONFIGURABLE_PERMISSIONS = {
    "manager": _STAFF_LIKE_CONFIGURABLE,
    "staff": _STAFF_LIKE_CONFIGURABLE,
    # Deliberately narrow - see the accountant note in ROLE_PERMISSIONS above.
    "accountant": {"view_audit_log", "manage_budget", "export_data", "view_statistics", "manage_invoices"},
}

def resolve_permissions(role: str, requested: Optional[List[str]]) -> List[str]:
    """Turns whatever permission list a client sent (possibly None, possibly
    tampered with) into the actual list to store for a member with this role.

    None (no explicit choice made) -> the role's default set. Otherwise,
    filtered down to that role's configurable ceiling, so a request can
    never grant a permission the role isn't allowed to hold - owner's set
    is fixed and never came from a request in the first place."""
    if requested is None:
        return sorted(ROLE_PERMISSIONS.get(role, set()))
    ceiling = ROLE_CONFIGURABLE_PERMISSIONS.get(role, set())
    return sorted(set(requested) & ceiling)

def require_permission(current_user: User, permission: str):
    if permission not in set(current_user.permissions or []):
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")

async def ensure_membership(user_id: str, company_id: str, role: str, permissions: Optional[List[str]] = None):
    """Записва (или обновява) връзката потребител-фирма в company_memberships.

    users.company_id/role показват само коя фирма е АКТИВНА в момента за
    потребителя - именно затова всеки съществуващ endpoint в приложението
    automatически "проглежда" правилната фирма веднага щом /companies/switch
    ги смени. company_memberships пази пълния списък, от който се превключва."""
    resolved_permissions = permissions if permissions is not None else resolve_permissions(role, None)
    await db.company_memberships.update_one(
        {"user_id": user_id, "company_id": company_id},
        {
            "$set": {"role": role, "permissions": resolved_permissions},
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "company_id": company_id,
                "created_at": datetime.now(timezone.utc),
            },
        },
        upsert=True
    )

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
    if user_doc.get("role") not in VALID_ROLES:
        user_doc = await repair_invalid_role(user_doc)
    user_doc = sanitize_user(user_doc)

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
            "permissions": resolve_permissions("owner", None),
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
    return {"user": sanitize_user(user_doc), "session_token": session_data.session_token}

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

# ===================== BULGARIAN TAX ID (EIK/BULSTAT) VALIDATION =====================

def _eik_check_digit(digits: List[int], weights1: List[int], weights2: List[int]) -> int:
    """Shared mod-11 check-digit step used by both the 9-digit and the
    branch (13-digit) EIK/Bulstat algorithms: try the primary weights,
    fall back to the secondary weights on a remainder of 10, and use 0
    if even that comes out to 10."""
    total = sum(d * w for d, w in zip(digits, weights1))
    remainder = total % 11
    if remainder < 10:
        return remainder
    total = sum(d * w for d, w in zip(digits, weights2))
    remainder = total % 11
    return 0 if remainder == 10 else remainder

def validate_eik(raw: str) -> dict:
    """Validate a Bulgarian unified identification code (ЕИК/Булстат).

    Accepts the plain 9-digit form, the 13-digit branch/VAT-registration
    form, and a "BG" VAT-number prefix. Returns whether the format and
    checksum are correct, since a wrong digit is the most common way an
    OCR read or a manual entry ends up with an unusable tax ID.
    """
    if not raw:
        return {"valid": False, "normalized": "", "reason": "empty"}

    normalized = raw.strip().upper()
    if normalized.startswith("BG"):
        normalized = normalized[2:]

    if not normalized.isdigit() or len(normalized) not in (9, 13):
        return {"valid": False, "normalized": normalized, "reason": "format"}

    digits = [int(c) for c in normalized]

    check9 = _eik_check_digit(digits[:8], [1, 2, 3, 4, 5, 6, 7, 8], [3, 4, 5, 6, 7, 8, 9, 10])
    if check9 != digits[8]:
        return {"valid": False, "normalized": normalized, "reason": "checksum"}

    if len(normalized) == 9:
        return {"valid": True, "normalized": normalized, "reason": None}

    check13 = _eik_check_digit(digits[8:12], [2, 7, 3, 5], [4, 9, 5, 7])
    if check13 != digits[12]:
        return {"valid": False, "normalized": normalized, "reason": "checksum"}

    return {"valid": True, "normalized": normalized, "reason": None}

@api_router.get("/utils/validate-eik")
async def check_eik(eik: str, current_user: User = Depends(get_current_user)):
    """Format + checksum check for a Bulgarian ЕИК/Булстат, used by the UI
    for live feedback while entering or reviewing a supplier's tax ID."""
    return validate_eik(eik)

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
@limiter.limit("5/minute")
async def register_user(request: Request, user_data: UserRegister, response: Response):
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
        "permissions": resolve_permissions("owner", None),
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
    
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": sanitize_user(user_doc), "session_token": session_token}

@api_router.post("/auth/login")
@limiter.limit("10/minute")
async def login_user(request: Request, user_data: UserLogin, response: Response):
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
    
    user_doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": sanitize_user(user_doc), "session_token": session_token}

@api_router.put("/auth/change-password")
async def change_password(data: ChangePassword, current_user: User = Depends(get_current_user)):
    """Смяна на парола. Ако акаунтът (напр. Google вход) все още няма парола, я задава за пръв път."""
    user = await db.users.find_one({"user_id": current_user.user_id})
    if not user:
        raise HTTPException(status_code=401, detail="Потребителят не е намерен")

    existing_hash = user.get("password_hash")
    if existing_hash:
        if not data.current_password:
            raise HTTPException(status_code=400, detail="Въведете текущата парола")
        if not pwd_context.verify(data.current_password, existing_hash):
            raise HTTPException(status_code=401, detail="Грешна текуща парола")

    is_valid, error_msg = validate_password(data.new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    new_hash = pwd_context.hash(data.new_password)
    await db.users.update_one(
        {"user_id": current_user.user_id},
        {"$set": {"password_hash": new_hash}}
    )
    return {"message": "Паролата е сменена успешно"}

@api_router.put("/auth/role/{user_id}")
async def update_user_role(user_id: str, request: Request, current_user: User = Depends(get_current_user)):
    body = await request.json()
    role = body.get("role")
    # None here means "no explicit checklist edit" - resolve_permissions
    # then falls back to the role's default set, same as at invite time.
    requested_permissions = body.get("permissions")

    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да променя роли")

    if role not in ["owner", "manager", "staff", "accountant"]:
        raise HTTPException(status_code=400, detail="Невалидна роля. Допустими: owner, manager, staff, accountant")

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

    permissions = resolve_permissions(role, requested_permissions)

    result = await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"role": role, "permissions": permissions}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Потребителят не е намерен")

    # Keep the membership record (used by the accountant company switcher)
    # in sync, in case this user held accountant-level access here.
    await ensure_membership(user_id, current_user.company_id, role, permissions)

    return {"message": "Ролята е обновена"}

@api_router.get("/auth/users")
async def get_all_users(current_user: User = Depends(get_current_user)):
    if current_user.role not in ["owner", "manager"]:
        raise HTTPException(status_code=403, detail="Нямате права за тази операция")
    
    if not current_user.company_id:
        return []
    
    users = await db.users.find(
        {"company_id": current_user.company_id},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "role": 1, "permissions": 1, "picture": 1, "created_at": 1}
    ).to_list(1000)
    for u in users:
        if not u.get("permissions"):
            u["permissions"] = resolve_permissions(u.get("role", "staff"), None)

    # An accountant with access to this company might currently be
    # switched into a DIFFERENT client's data, so their live users.company_id
    # (and users.permissions, which follows the ACTIVE company) won't match
    # here - pull them in separately via their membership record, which
    # holds the role/permissions specific to THIS company.
    existing_ids = {u["user_id"] for u in users}
    accountant_memberships = await db.company_memberships.find(
        {"company_id": current_user.company_id, "role": "accountant"},
        {"_id": 0, "user_id": 1, "permissions": 1}
    ).to_list(1000)
    membership_permissions = {
        m["user_id"]: m.get("permissions") or resolve_permissions("accountant", None)
        for m in accountant_memberships
    }
    extra_ids = [uid for uid in membership_permissions if uid not in existing_ids]
    if extra_ids:
        extra_users = await db.users.find(
            {"user_id": {"$in": extra_ids}},
            {"_id": 0, "user_id": 1, "email": 1, "name": 1, "picture": 1, "created_at": 1}
        ).to_list(1000)
        for u in extra_users:
            u["role"] = "accountant"  # overrides whatever company they're currently active in
            u["permissions"] = membership_permissions[u["user_id"]]
        users.extend(extra_users)

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

    # An accountant's membership may exist here even while they're
    # currently switched into a different client's data, so check
    # company_memberships first rather than requiring an exact
    # company_id match.
    accountant_membership = await db.company_memberships.find_one({
        "user_id": user_id,
        "company_id": current_user.company_id,
        "role": "accountant",
    })
    if accountant_membership:
        await db.company_memberships.delete_one({
            "user_id": user_id,
            "company_id": current_user.company_id,
        })
        # If they're currently looking at this exact company, switch them
        # back to another membership of theirs (or clear it entirely).
        if target_user.get("company_id") == current_user.company_id:
            fallback = await db.company_memberships.find_one({"user_id": user_id}, {"_id": 0})
            if fallback:
                await db.users.update_one(
                    {"user_id": user_id},
                    {"$set": {"company_id": fallback["company_id"], "role": fallback["role"]}}
                )
            else:
                await db.users.update_one(
                    {"user_id": user_id},
                    {"$unset": {"company_id": ""}, "$set": {"role": "staff"}}
                )
        return {"message": "Достъпът на счетоводителя е премахнат"}

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
    
    if invitation_data.role not in ["manager", "staff", "accountant"]:
        raise HTTPException(status_code=400, detail="Невалидна роля за покана")
    
    # Check if user with this email already exists in the company
    if invitation_data.email:
        existing_user = await db.users.find_one({
            "email": invitation_data.email,
            "company_id": current_user.company_id
        })
        if existing_user:
            raise HTTPException(status_code=400, detail="Потребител с този имейл вече е член на фирмата")
    
    # Check for pending invitation - only match on whichever contact method
    # was actually provided; a bare {"phone": None}/{"email": None} clause
    # for the one NOT provided would otherwise match every other pending
    # invitation that also omitted it, flagging unrelated invites as
    # duplicates.
    contact_clauses = []
    if invitation_data.email:
        contact_clauses.append({"email": invitation_data.email})
    if invitation_data.phone:
        contact_clauses.append({"phone": invitation_data.phone})

    pending = await db.invitations.find_one({
        "company_id": current_user.company_id,
        "$or": contact_clauses,
        "status": "pending"
    })
    if pending:
        raise HTTPException(status_code=400, detail="Вече има активна покана за този контакт")
    
    invitation = Invitation(
        company_id=current_user.company_id,
        invited_by=current_user.user_id,
        email=invitation_data.email,
        phone=invitation_data.phone,
        role=invitation_data.role,
        permissions=resolve_permissions(invitation_data.role, invitation_data.permissions),
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
@limiter.limit("10/minute")
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

    # If the invitation was issued to a specific email, only that account may accept it
    if invitation.get("email") and invitation["email"].lower() != current_user.email.lower():
        raise HTTPException(status_code=403, detail="Тази покана е издадена за друг имейл адрес")

    # Accountant invitations are the one case that doesn't require leaving
    # your current company first - a счетоводител can hold access to
    # several client companies at once and switch between them (see
    # /companies/switch). Every other role keeps the original one-company
    # rule, unchanged.
    if invitation["role"] != "accountant" and current_user.company_id:
        raise HTTPException(status_code=400, detail="Вече сте член на фирма. Първо напуснете текущата фирма.")

    invitation_permissions = invitation.get("permissions") or resolve_permissions(invitation["role"], None)

    # Preserve whatever company/role the user is switching away from as a
    # membership, so they can switch back to it later.
    if current_user.company_id:
        await ensure_membership(current_user.user_id, current_user.company_id, current_user.role, current_user.permissions)
    await ensure_membership(current_user.user_id, invitation["company_id"], invitation["role"], invitation_permissions)

    # Accept invitation - link user to company (this becomes their new
    # active company/role; for a счетоводител accepting a 2nd+ invitation
    # this switches them into the newly-joined company)
    await db.users.update_one(
        {"user_id": current_user.user_id},
        {"$set": {
            "company_id": invitation["company_id"],
            "role": invitation["role"],
            "permissions": invitation_permissions,
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

# ===================== MULTI-COMPANY ACCESS (ACCOUNTANT SWITCHER) =====================

@api_router.get("/companies/memberships")
async def get_company_memberships(current_user: User = Depends(get_current_user)):
    """Списък с всички фирми, до които потребителят има достъп (за
    счетоводители с достъп до няколко фирми клиенти) - използва се за
    менюто за превключване на активната фирма."""
    memberships = await db.company_memberships.find(
        {"user_id": current_user.user_id}, {"_id": 0}
    ).to_list(100)

    # Backfill: make sure the currently-active company is always
    # represented, even for users who never went through /companies/switch
    if current_user.company_id and not any(m["company_id"] == current_user.company_id for m in memberships):
        await ensure_membership(current_user.user_id, current_user.company_id, current_user.role, current_user.permissions)
        memberships.append({"company_id": current_user.company_id, "role": current_user.role})

    company_ids = [m["company_id"] for m in memberships]
    companies = await db.companies.find(
        {"id": {"$in": company_ids}}, {"_id": 0, "id": 1, "name": 1}
    ).to_list(1000)
    company_names = {c["id"]: c["name"] for c in companies}

    result = []
    for m in memberships:
        result.append({
            "company_id": m["company_id"],
            "company_name": company_names.get(m["company_id"], "—"),
            "role": m["role"],
            "is_active": m["company_id"] == current_user.company_id,
        })

    result.sort(key=lambda m: (not m["is_active"], m["company_name"]))
    return result

@api_router.post("/companies/switch")
async def switch_active_company(request: Request, current_user: User = Depends(get_current_user)):
    """Превключва коя фирма е активна за потребителя. Работи само за фирми,
    за които вече има запис в company_memberships (собствена фирма или
    приета покана като счетоводител)."""
    body = await request.json()
    target_company_id = body.get("company_id")
    if not target_company_id:
        raise HTTPException(status_code=400, detail="Липсва company_id")

    if target_company_id == current_user.company_id:
        user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
        return sanitize_user(user_doc)

    membership = await db.company_memberships.find_one({
        "user_id": current_user.user_id,
        "company_id": target_company_id,
    })
    if not membership:
        raise HTTPException(status_code=403, detail="Нямате достъп до тази фирма")

    # Preserve the company/role we're switching away from as a membership
    if current_user.company_id:
        await ensure_membership(current_user.user_id, current_user.company_id, current_user.role, current_user.permissions)

    target_permissions = membership.get("permissions") or resolve_permissions(membership["role"], None)
    await db.users.update_one(
        {"user_id": current_user.user_id},
        {"$set": {"company_id": target_company_id, "role": membership["role"], "permissions": target_permissions}}
    )

    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})
    return sanitize_user(user_doc)

@api_router.post("/company/leave")
async def leave_company(current_user: User = Depends(get_current_user)):
    """Напускане на фирма (не може Owner)"""
    if not current_user.company_id:
        raise HTTPException(status_code=400, detail="Не сте член на фирма")

    if current_user.role == "accountant":
        # Just drop this one client relationship - switch back to another
        # membership (typically their own home company) if they have one.
        await db.company_memberships.delete_one({
            "user_id": current_user.user_id,
            "company_id": current_user.company_id,
        })
        fallback = await db.company_memberships.find_one({"user_id": current_user.user_id}, {"_id": 0})
        if fallback:
            fallback_permissions = fallback.get("permissions") or resolve_permissions(fallback["role"], None)
            await db.users.update_one(
                {"user_id": current_user.user_id},
                {"$set": {"company_id": fallback["company_id"], "role": fallback["role"], "permissions": fallback_permissions}}
            )
        else:
            await db.users.update_one(
                {"user_id": current_user.user_id},
                {"$unset": {"company_id": ""}, "$set": {"role": "staff", "permissions": resolve_permissions("staff", None)}}
            )
        return {"message": "Успешно напуснахте фирмата"}

    if current_user.role == "owner":
        raise HTTPException(status_code=400, detail="Титулярят не може да напусне фирмата. Прехвърлете собствеността първо.")

    await db.users.update_one(
        {"user_id": current_user.user_id},
        {"$unset": {"company_id": ""}, "$set": {"role": "staff", "permissions": resolve_permissions("staff", None)}}
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
            {"$set": {"company_id": company.id, "role": "owner", "permissions": resolve_permissions("owner", None)}}
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
    """Обновява фирмата на текущия потребител (само Owner)"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0})

    if not user_doc or not user_doc.get("company_id"):
        raise HTTPException(status_code=404, detail="Нямате свързана фирма. Първо създайте фирма.")

    if user_doc.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да редактира данните на фирмата")

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

# (/company/users used to duplicate /auth/users here - removed; /auth/users
# is the one the frontend actually calls, and it also merges in accountant
# memberships, which this one never did.)

# ===================== AI DATA CORRECTION MODULE =====================

class DataCorrectionResult(BaseModel):
    original: dict
    corrected: dict
    corrections_made: List[str] = []
    confidence: float = 1.0

def _compare_key(value: str) -> str:
    """Uppercases and strips everything but letters/digits, so two names
    that only differ by punctuation, spacing or letter case compare equal
    (e.g. 'Иванов О.О.Д.', 'ИВАНОВ-ООД' and 'иванов оод' all normalize to
    the same key)."""
    return re.sub(r'[^\w]', '', value.upper())

def _similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()

async def normalize_supplier_name(supplier: str, company_id: Optional[str] = None) -> tuple[str, bool]:
    """Нормализира име на доставчик/контрагент и го съпоставя с вече познати
    доставчици на фирмата, независимо от препинателни знаци, интервали и
    регистър на буквите (главни/малки)."""
    if not supplier:
        return supplier, False

    supplier = supplier.strip()

    # Нормализиране на правните форми
    legal_forms = [
        (r'\bЕООД\b', 'ЕООД'),
        (r'\bООД\b', 'ООД'),
        (r'\bАД\b', 'АД'),
        (r'\bЕАД\b', 'ЕАД'),
        (r'\bЕТ\b', 'ЕТ'),
        (r'\bСД\b', 'СД'),
        (r'\bКД\b', 'КД'),
        (r'\bКДА\b', 'КДА'),
    ]

    normalized = supplier.upper()
    for pattern, replacement in legal_forms:
        normalized = re.sub(pattern, replacement, normalized, flags=re.IGNORECASE)

    supplier_key = _compare_key(normalized)

    # Ако има company_id, търсим съществуващ подобен доставчик
    if company_id and supplier_key:
        existing_suppliers = await db.invoices.distinct("supplier", {"company_id": company_id})

        best_match = None
        best_score = 0.0

        for existing in existing_suppliers:
            existing_key = _compare_key(existing)
            if not existing_key:
                continue

            # Точно съвпадение с игнориране на пунктуация/регистър
            if existing_key == supplier_key:
                return existing, True

            # По-кратко име, съдържащо се изцяло в по-дългото (напр. "ИВАНОВ"
            # в "ИВАНОВ ЕООД"), почти винаги е същият контрагент, изписан
            # с/без правната форма.
            if existing_key in supplier_key or supplier_key in existing_key:
                containment = len(min(existing_key, supplier_key, key=len)) / len(max(existing_key, supplier_key, key=len))
            else:
                containment = 0.0

            score = max(containment, _similarity(existing_key, supplier_key))
            if score > best_score:
                best_score = score
                best_match = existing

        if best_match and best_score >= 0.82:
            return best_match, True

    # Форматиране - първа буква главна
    words = normalized.split()
    formatted_words = []
    for word in words:
        if word in ['ЕООД', 'ООД', 'АД', 'ЕАД', 'ЕТ', 'СД', 'КД', 'КДА', 'LIDL', 'BILLA', 'KAUFLAND']:
            formatted_words.append(word)
        else:
            formatted_words.append(word.capitalize())

    return ' '.join(formatted_words), False

async def normalize_item_name(item_name: str, company_id: Optional[str] = None) -> tuple[str, bool]:
    """Нормализира име на продукт/артикул и го обединява с вече записан
    артикул на фирмата (като суровина), независимо от препинателни знаци,
    интервали и регистър на буквите - автоматичният, безплатен вариант на
    /items/ai-merge, приложен веднага при запис, вместо да се чака
    периодичното AI сравнение."""
    if not item_name:
        return item_name, False

    cleaned = re.sub(r'\s+', ' ', item_name.strip().lower())
    if not company_id or not cleaned:
        return cleaned, False

    compare_key = _compare_key(cleaned)
    if not compare_key:
        return cleaned, False

    # 1. Прилагаме вече запазено AI групиране (/items/ai-merge), ако има.
    mapping = await db.item_merge_mappings.find_one(
        {"company_id": company_id, "variants": cleaned},
        {"_id": 0, "canonical_name": 1}
    )
    if mapping:
        return mapping["canonical_name"], True

    # 2. Иначе - fuzzy съпоставяне с вече записани артикули на фирмата, за
    # да се слеят очевидни варианти (правопис, регистър, пунктуация) веднага,
    # без да се чака периодичния AI анализ.
    existing_names = await db.item_price_history.distinct("item_name", {"company_id": company_id})

    best_match = None
    best_score = 0.0
    for existing in existing_names:
        existing_key = _compare_key(existing)
        if not existing_key:
            continue
        if existing_key == compare_key:
            return existing, existing != cleaned

        score = _similarity(existing_key, compare_key)
        if score > best_score:
            best_score = score
            best_match = existing

    if best_match and best_score >= 0.88:
        return best_match, True

    return cleaned, False

def fix_ocr_number_errors(value: str) -> str:
    """Поправя типични OCR грешки в числа"""
    if not value:
        return value
    
    # Типични OCR грешки при числа
    fixes = {
        'O': '0',
        'o': '0',
        'О': '0',  # Кирилица О
        'о': '0',  # Кирилица о
        'l': '1',
        'I': '1',
        'І': '1',  # Кирилица І
        '|': '1',
        'S': '5',
        's': '5',
        'B': '8',
        'Z': '2',
        'z': '2',
        ',': '.',  # Запетая към точка за десетични
    }
    
    result = value
    for wrong, correct in fixes.items():
        result = result.replace(wrong, correct)
    
    # Премахване на всичко освен цифри и точка
    result = re.sub(r'[^\d.]', '', result)
    
    return result

def parse_amount(value) -> float:
    """Парсва сума от различни формати"""
    if value is None:
        return 0.0
    
    if isinstance(value, (int, float)):
        return float(value)
    
    if isinstance(value, str):
        # Почистване
        cleaned = fix_ocr_number_errors(value)
        
        # Обработка на европейски формат (1.234,56 -> 1234.56)
        if ',' in value and '.' in value:
            if value.rfind(',') > value.rfind('.'):
                # Европейски формат: 1.234,56
                cleaned = value.replace('.', '').replace(',', '.')
        elif ',' in value:
            # Може да е десетична запетая
            cleaned = value.replace(',', '.')
        
        cleaned = re.sub(r'[^\d.]', '', cleaned)
        
        try:
            return float(cleaned) if cleaned else 0.0
        except ValueError:
            return 0.0
    
    return 0.0

def normalize_invoice_number(invoice_number: str) -> str:
    """Нормализира номер на фактура"""
    if not invoice_number:
        return invoice_number
    
    # Почистване от OCR грешки
    cleaned = invoice_number.strip()
    
    # Поправка на типични грешки
    ocr_fixes = {
        'O': '0',
        'o': '0',
        'l': '1',
        'I': '1',
    }
    
    # За номера на фактури, само в числовите части
    parts = re.split(r'(\D+)', cleaned)
    result_parts = []
    
    for part in parts:
        if part.isdigit() or re.match(r'^[\dOoIl]+$', part):
            # Числова част - поправяме OCR грешки
            fixed = part
            for wrong, correct in ocr_fixes.items():
                fixed = fixed.replace(wrong, correct)
            result_parts.append(fixed)
        else:
            result_parts.append(part.upper())
    
    return ''.join(result_parts)

def normalize_date(date_str: str) -> Optional[str]:
    """Нормализира дата в ISO формат YYYY-MM-DD"""
    if not date_str:
        return None
    
    # Почистване
    date_str = date_str.strip()
    
    # Поправка на OCR грешки в числата
    date_str = fix_ocr_number_errors(date_str)
    
    # Различни формати
    patterns = [
        (r'(\d{4})-(\d{1,2})-(\d{1,2})', '%Y-%m-%d'),  # 2024-01-15
        (r'(\d{1,2})\.(\d{1,2})\.(\d{4})', '%d.%m.%Y'),  # 15.01.2024
        (r'(\d{1,2})/(\d{1,2})/(\d{4})', '%d/%m/%Y'),  # 15/01/2024
        (r'(\d{1,2})-(\d{1,2})-(\d{4})', '%d-%m-%Y'),  # 15-01-2024
    ]
    
    for pattern, fmt in patterns:
        match = re.search(pattern, date_str)
        if match:
            try:
                parsed = datetime.strptime(match.group(), fmt)
                return parsed.strftime('%Y-%m-%d')
            except ValueError:
                continue
    
    return None

async def correct_ocr_data(
    data: dict,
    company_id: Optional[str] = None
) -> DataCorrectionResult:
    """
    AI-powered корекция на OCR данни
    """
    original = data.copy()
    corrected = data.copy()
    corrections = []
    
    # 1. Корекция на доставчик
    if data.get("supplier"):
        normalized_supplier, was_matched = await normalize_supplier_name(
            data["supplier"], 
            company_id
        )
        if normalized_supplier != data["supplier"]:
            corrected["supplier"] = normalized_supplier
            if was_matched:
                corrections.append(f"Доставчик съпоставен: '{data['supplier']}' → '{normalized_supplier}'")
            else:
                corrections.append(f"Доставчик нормализиран: '{data['supplier']}' → '{normalized_supplier}'")
    
    # 2. Корекция на номер на фактура
    if data.get("invoice_number"):
        normalized_number = normalize_invoice_number(data["invoice_number"])
        if normalized_number != data["invoice_number"]:
            corrected["invoice_number"] = normalized_number
            corrections.append(f"Номер на фактура коригиран: '{data['invoice_number']}' → '{normalized_number}'")
    
    # 3. Корекция на дата
    if data.get("invoice_date"):
        normalized_date = normalize_date(str(data["invoice_date"]))
        if normalized_date and normalized_date != data.get("invoice_date"):
            corrected["invoice_date"] = normalized_date
            corrections.append(f"Дата нормализирана: '{data['invoice_date']}' → '{normalized_date}'")
    
    # 4. Корекция на суми
    amount_fields = ["amount_without_vat", "vat_amount", "total_amount"]
    for field in amount_fields:
        if field in data:
            parsed = parse_amount(data[field])
            if parsed != data.get(field):
                corrected[field] = parsed
                corrections.append(f"{field} коригирано: '{data[field]}' → {parsed}")
    
    # 5. Валидация на ДДС изчисления
    amount_without_vat = corrected.get("amount_without_vat", 0)
    vat_amount = corrected.get("vat_amount", 0)
    total_amount = corrected.get("total_amount", 0)
    
    # Проверка за консистентност
    if amount_without_vat > 0 and total_amount > 0:
        expected_vat = amount_without_vat * 0.20
        expected_total = amount_without_vat + expected_vat
        
        # Ако ДДС е грешно, коригираме
        if vat_amount == 0 and total_amount > amount_without_vat:
            corrected["vat_amount"] = round(total_amount - amount_without_vat, 2)
            corrections.append(f"ДДС изчислено: {corrected['vat_amount']}")
        
        # Ако общата сума е грешна, коригираме
        elif abs(total_amount - (amount_without_vat + vat_amount)) > 0.02:
            corrected["total_amount"] = round(amount_without_vat + vat_amount, 2)
            corrections.append(f"Обща сума коригирана: {corrected['total_amount']}")
        
        # Ако само ДДС липсва
        elif vat_amount == 0 and total_amount == amount_without_vat:
            corrected["vat_amount"] = round(amount_without_vat * 0.20, 2)
            corrected["total_amount"] = round(amount_without_vat * 1.20, 2)
            corrections.append(f"ДДС добавено (20%): {corrected['vat_amount']}")

    # 6. Корекция на редовете с продукти - нормализиране на имена (за да се
    # обединят със същия артикул, записан преди по друг начин) и на числата.
    raw_items = data.get("items")
    if isinstance(raw_items, list) and raw_items:
        corrected_items = []
        item_corrections = 0
        for raw_item in raw_items:
            if not isinstance(raw_item, dict) or not raw_item.get("name"):
                continue
            item = dict(raw_item)
            original_name = str(item["name"]).strip()
            normalized_name, was_matched = await normalize_item_name(original_name, company_id)
            if normalized_name != original_name:
                item_corrections += 1
            item["name"] = normalized_name
            item["quantity"] = parse_amount(item.get("quantity", 1)) or 1
            item["unit_price"] = parse_amount(item.get("unit_price", 0))
            item["total_price"] = parse_amount(item.get("total_price")) or round(item["quantity"] * item["unit_price"], 2)
            if not item.get("unit"):
                item["unit"] = "бр."
            corrected_items.append(item)
        corrected["items"] = corrected_items
        if item_corrections:
            corrections.append(f"Продукти нормализирани/обединени: {item_corrections}")

    # Изчисляване на confidence
    confidence = 1.0 - (len(corrections) * 0.05)  # Намаляме увереността с всяка корекция
    confidence = max(0.5, confidence)  # Минимум 50%
    
    return DataCorrectionResult(
        original=original,
        corrected=corrected,
        corrections_made=corrections,
        confidence=confidence
    )

# ===================== OCR ENDPOINT =====================

class ClaudeInvoiceItem(BaseModel):
    name: str = Field(description="Българското описание на продукта, без водещ числов код и без английския превод след '/' (виж примера в системния промпт)")
    quantity: float = Field(description="Количество")
    unit: str = Field(description="Мерна единица: бр., кг, л, м, опаковка и т.н.")
    unit_price: float = Field(description="Единична цена без ДДС")
    total_price: float = Field(description="Обща цена за реда без ДДС")

class ClaudeInvoiceExtraction(BaseModel):
    supplier: str = Field(description="Пълното име на доставчика (издателя), НЕ на получателя/купувача")
    supplier_eik: Optional[str] = Field(default=None, description="ЕИК/Булстат на доставчика, ако е видим на фактурата")
    invoice_number: str = Field(description="Номер на фактурата")
    invoice_date: Optional[str] = Field(default=None, description="Дата на издаване, формат YYYY-MM-DD")
    amount_without_vat: float = Field(description="Данъчна основа / обща сума без ДДС")
    vat_amount: float = Field(description="ДДС (обикновено 20%)")
    total_amount: float = Field(description="Обща сума за плащане с ДДС")
    items: List[ClaudeInvoiceItem] = Field(default_factory=list, description="Всички редове от таблицата с артикули/продукти/услуги на фактурата")

OCR_SYSTEM_PROMPT = """Ти си експертен AI асистент за автоматично разпознаване на данни от български фактури.

ЗАДАЧА: Прегледай ЦЯЛОТО изображение внимателно - всеки сегмент от снимката: заглавна част, таблицата с продукти/услуги, обобщението със сумите, бележки, печати и подписи. Не пропускай части от фактурата само защото не са в центъра на кадъра.

РАЗГРАНИЧАВАНЕ НА ДОСТАВЧИК ОТ ПОЛУЧАТЕЛ (изключително важно):
Всяка фактура има ДВЕ фирми - ИЗДАТЕЛ (доставчик/продавач) и ПОЛУЧАТЕЛ (купувач). В полето "supplier" трябва да върнеш ИМЕННО ИЗДАТЕЛЯ - фирмата, която ПРОДАВА и ИЗДАВА фактурата. Обикновено тя е:
- показана в горната част/логото/заглавката на документа, или до печат
- до текст като "Доставчик", "Продавач", "Издател", "ИЗПЪЛНИТЕЛ"
НИКОГА не връщай фирмата до "Получател", "Купувач", "ВЪЗЛОЖИТЕЛ" - това е клиентът, комуто е издадена фактурата. Ако разположението е нестандартно, разчитай на контекст и логика (логото/печатът обикновено е на доставчика), а не само на буквално най-близкия текст.

АКО СЕ ВИЖДАТ ДВА РАЗЛИЧНИ ДОКУМЕНТА В ЕДНА СНИМКА:
Понякога в кадъра има едновременно касова бележка (фискален бон от ЕКАФП) И официална фактура ("ФАКТУРА - ОРИГИНАЛ"), защото двете обикновено се печатат заедно. Те съдържат почти същите данни, но ФАКТУРАТА е официалният счетоводен документ. Когато и двата се виждат, извличай данните ОТ ФАКТУРАТА (тя има ясно видимо заглавие "ФАКТУРА", номер на фактура, ЕИК на клиента и таблица "Описание на артикула"), а не от касовата бележка. Ако се вижда само касова бележка, използвай нея.

ЗА ПРОДУКТИТЕ/АРТИКУЛИТЕ:
Извлечи ВСЕКИ ред от таблицата с артикули - име на продукта, количество, мерна единица, единична цена и обща цена на реда. Не пропускай редове, дори ако таблицата е дълга, частично замъглена или пресечена в кадъра - извлечи всичко, което успееш да разчетеш логично, включително чрез съпоставка със съседни редове и типичния формат на таблицата. Не измисляй артикули, които не съществуват на фактурата.

Имената на артикулите в българските фактури често са във формат "КОД БЪЛГАРСКО ИМЕ/ANGLISH NAME" (напр. "258 ЛУКАНКОВ САЛАМ ЧОРИЗ/LUKANKA SALAMI CHORIZO 20"). За полето "name" връщай САМО българското описание, без водещия числов код и без английския превод след "/" (в примера: "Луканков салам чориз"). Ако артикулът има само едно име (без "/"), използвай него директно.

ОБЩИ ПРАВИЛА:
- Всички суми в полетата на артикулите и amount_without_vat са БЕЗ ДДС.
- ДДС в България обикновено е 20%.
- Датата винаги във формат YYYY-MM-DD.
- Ако дадена стойност наистина не може да се прочете - остави я празна ("" за текст, 0 за число, null за дата), но НЕ измисляй данни, които не се виждат на изображението.
- Разпознавай възможно най-много от вариациите в изписването (главни/малки букви, съкращения на правни форми, различно разположение на текста)."""

@api_router.post("/ocr/scan", response_model=OCRResult)
@limiter.limit("20/minute")
async def scan_invoice(request: Request, image_base64: str = None, current_user: User = Depends(get_current_user)):
    if not AI_FEATURES_ENABLED:
        raise HTTPException(status_code=503, detail="AI разпознаването временно не е налично. Моля, въведете данните ръчно.")

    body = await request.json()
    image_data = body.get("image_base64", "")

    if not image_data:
        raise HTTPException(status_code=400, detail="Липсва изображение")

    # Извличане на media type от data URL префикса (ако има), преди да го махнем
    media_type = "image/jpeg"
    if image_data.startswith("data:") and "," in image_data:
        header, image_data = image_data.split(",", 1)
        header_match = re.match(r"data:([^;]+);base64", header)
        if header_match:
            media_type = header_match.group(1)
    elif "," in image_data:
        image_data = image_data.split(",")[1]

    # Get company_id for supplier matching
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None

    try:
        response = await anthropic_client.messages.parse(
            model="claude-opus-5",
            max_tokens=8000,
            system=OCR_SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": image_data}
                    },
                    {
                        "type": "text",
                        "text": "Извлечи всички данни от тази фактура: доставчика (не получателя!), ЕИК ако е видим, номер, дата, суми и ВСИЧКИ редове от таблицата с артикули."
                    }
                ]
            }],
            output_format=ClaudeInvoiceExtraction,
        )

        extracted = response.parsed_output
        if extracted is None:
            raise HTTPException(status_code=500, detail="Не можах да разпозная фактурата")

        raw_result = extracted.model_dump()

        # Apply AI correction module (доставчик/продукти нормализиране и сливане)
        correction_result = await correct_ocr_data(raw_result, company_id)
        corrected = correction_result.corrected

        if correction_result.corrections_made:
            logger.info(f"OCR Corrections: {correction_result.corrections_made}")

        return OCRResult(
            supplier=corrected.get("supplier", ""),
            supplier_eik=corrected.get("supplier_eik"),
            invoice_number=corrected.get("invoice_number", ""),
            amount_without_vat=float(corrected.get("amount_without_vat", 0)),
            vat_amount=float(corrected.get("vat_amount", 0)),
            total_amount=float(corrected.get("total_amount", 0)),
            invoice_date=corrected.get("invoice_date"),
            items=[OCRItemResult(**item) for item in corrected.get("items", [])],
            corrections=correction_result.corrections_made,
            confidence=correction_result.confidence
        )

    except HTTPException:
        raise
    except anthropic_sdk.AuthenticationError:
        logger.error("OCR Error: invalid or missing Anthropic API key")
        raise HTTPException(status_code=503, detail="AI разпознаването не е конфигурирано правилно на сървъра. Моля, въведете данните ръчно.")
    except anthropic_sdk.RateLimitError:
        raise HTTPException(status_code=503, detail="AI услугата за разпознаване е временно претоварена. Моля, опитайте отново след малко.")
    except anthropic_sdk.APIConnectionError:
        logger.exception("OCR Error: could not reach the Anthropic API (network/TLS)")
        raise HTTPException(status_code=502, detail="Сървърът не успя да се свърже с AI услугата (мрежов проблем). Моля, опитайте отново след малко.")
    except anthropic_sdk.APIStatusError as e:
        logger.error(f"OCR Error (API status): {e}")
        raise HTTPException(status_code=502, detail="Грешка при връзка с AI услугата за разпознаване.")
    except Exception as e:
        logger.exception("OCR Error")
        raise HTTPException(status_code=500, detail=f"Грешка при сканиране: {str(e)}")

def ai_exception_to_http(e: Exception, log_context: str) -> HTTPException:
    """Maps a raised Anthropic SDK exception to the same kind of clear,
    Bulgarian, status-coded error /ocr/scan already returns - for AI
    features where a failure means "the feature didn't work" rather than
    "here's an empty/legitimate result" (see run_ai_item_merge)."""
    if isinstance(e, anthropic_sdk.AuthenticationError):
        logger.error(f"{log_context}: invalid or missing Anthropic API key")
        return HTTPException(status_code=503, detail="AI функцията не е конфигурирана правилно на сървъра.")
    if isinstance(e, anthropic_sdk.RateLimitError):
        return HTTPException(status_code=503, detail="AI услугата е временно претоварена. Моля, опитайте отново след малко.")
    if isinstance(e, anthropic_sdk.APIConnectionError):
        logger.exception(f"{log_context}: could not reach the Anthropic API (network/TLS)")
        return HTTPException(status_code=502, detail="Сървърът не успя да се свърже с AI услугата (мрежов проблем).")
    if isinstance(e, anthropic_sdk.APIStatusError):
        logger.error(f"{log_context} (API status): {e}")
        return HTTPException(status_code=502, detail="Грешка при връзка с AI услугата.")
    logger.exception(log_context)
    return HTTPException(status_code=500, detail=f"Грешка: {str(e)}")

# ===================== PROTOCOL BY чл.117 ЗДДС NUMBERING =====================

async def next_protocol_number(company_id: Optional[str], user_id: str, year: int) -> str:
    """Atomically issue the next sequential протокол number for a
    reverse-charge self-billing document (чл.117 ЗДДС), scoped per
    company (or per user without one) and reset each calendar year -
    matches how these protocols are numbered in practice."""
    scope = company_id or f"user:{user_id}"
    counter_id = f"protocol_{scope}_{year}"
    result = await db.counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return f"{result['seq']}/{year}"

# ===================== INVOICE ENDPOINTS =====================

@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice: InvoiceCreate, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    # Get user's company_id
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None

    # Merge with an already-known counterparty regardless of punctuation or
    # letter case, so this also applies to manually-typed/edited invoices,
    # not just ones that came straight out of OCR.
    normalized_supplier, _ = await normalize_supplier_name(invoice.supplier, company_id)
    invoice.supplier = normalized_supplier

    # Check for duplicate invoice
    if company_id:
        # If user has a company, check across all company users
        company_users = await db.users.find({"company_id": company_id}, {"user_id": 1}).to_list(1000)
        company_user_ids = [u["user_id"] for u in company_users]
        
        existing_invoice = await db.invoices.find_one({
            "user_id": {"$in": company_user_ids},
            "invoice_number": invoice.invoice_number,
            "supplier": {"$regex": f"^{re.escape(invoice.supplier)}$", "$options": "i"}
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
            "supplier": {"$regex": f"^{re.escape(invoice.supplier)}$", "$options": "i"}
        }, {"_id": 0, "id": 1, "date": 1})
        
        if existing_invoice:
            raise HTTPException(
                status_code=409,
                detail=f"Фактура с номер {invoice.invoice_number} от {invoice.supplier} вече съществува в системата!"
            )
    
    invoice_dict = invoice.dict()
    invoice_date = datetime.fromisoformat(invoice_dict["date"].replace("Z", "+00:00"))

    # Suggest a VAT treatment when the caller didn't set one, based on the
    # VAT-to-base ratio - saves the common case (standard 20%) a manual pick,
    # while leaving anything unusual (0%, reverse charge...) for the user to
    # classify correctly themselves.
    if invoice_dict.get("vat_treatment") is None and invoice_dict.get("amount_without_vat"):
        vat_ratio = invoice_dict["vat_amount"] / invoice_dict["amount_without_vat"]
        if abs(vat_ratio - 0.20) < 0.01:
            invoice_dict["vat_treatment"] = VatTreatment.STANDARD_20
        elif abs(vat_ratio - 0.09) < 0.01:
            invoice_dict["vat_treatment"] = VatTreatment.REDUCED_9

    # Reverse-charge purchases (services from abroad, ВОП...) need a
    # self-billing протокол по чл.117 ЗДДС, issued within 15 days of the
    # tax point - assign the next sequential number automatically so
    # nobody has to track this by hand.
    if invoice_dict.get("vat_treatment") == VatTreatment.REVERSE_CHARGE:
        invoice_dict["protocol_number"] = await next_protocol_number(company_id, current_user.user_id, invoice_date.year)

    # Process items and convert to dict format
    items_list = None
    price_alerts = []
    item_normalized_names = {}  # item_dict["id"] -> normalized_name, reused below when backfilling invoice_id

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
                normalized_name, _ = await normalize_item_name(item.name, company_id)
                item_normalized_names[item_dict["id"]] = normalized_name

                # Find last price for this item from same supplier
                last_price_record = await db.item_price_history.find_one(
                    {
                        "company_id": company_id,
                        "supplier": {"$regex": f"^{re.escape(invoice.supplier)}$", "$options": "i"},
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
        for item_dict in items_list:
            normalized_name = item_normalized_names.get(item_dict["id"], item_dict["name"].strip().lower())
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

        # Keep raw-material grouping fresh automatically, without the user
        # having to trigger it - throttled inside the task itself.
        background_tasks.add_task(maybe_schedule_ai_item_merge, company_id)

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="create",
        entity_type="invoice",
        entity_id=invoice_obj.id,
        company_id=company_id,
        details={"supplier": invoice_obj.supplier, "invoice_number": invoice_obj.invoice_number, "total_amount": invoice_obj.total_amount}
    )

    return invoice_obj

@api_router.get("/invoices", response_model=List[Invoice])
async def get_invoices(
    supplier: Optional[str] = None,
    invoice_number: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    _, query = await get_company_scope(current_user)

    if supplier:
        query["supplier"] = {"$regex": re.escape(supplier), "$options": "i"}
    if invoice_number:
        query["invoice_number"] = {"$regex": re.escape(invoice_number), "$options": "i"}
    if start_date:
        query["date"] = {"$gte": datetime.fromisoformat(start_date.replace("Z", "+00:00"))}
    if end_date:
        if "date" in query:
            query["date"]["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        else:
            query["date"] = {"$lte": datetime.fromisoformat(end_date.replace("Z", "+00:00"))}

    invoices = await db.invoices.find(query, {"_id": 0, "image_base64": 0}).sort("date", -1).to_list(1000)
    return [Invoice(**inv) for inv in invoices]

@api_router.get("/invoices/protocols/reverse-charge")
async def get_reverse_charge_protocols(current_user: User = Depends(get_current_user)):
    """List all reverse-charge purchases (self-billing протокол по чл.117
    ЗДДС) across the whole company, newest first - lets the owner or
    accountant see every protocol's number and check none has slipped
    past its 15-day filing deadline."""
    require_permission(current_user, "view_statistics")
    _, query = await get_company_scope(current_user)
    query["vat_treatment"] = VatTreatment.REVERSE_CHARGE

    invoices = await db.invoices.find(query, {"_id": 0, "image_base64": 0}).sort("date", -1).to_list(1000)
    return [Invoice(**inv) for inv in invoices]

@api_router.get("/invoices/{invoice_id}", response_model=Invoice)
async def get_invoice(invoice_id: str, current_user: User = Depends(get_current_user)):
    _, scope = await get_company_scope(current_user)
    invoice = await db.invoices.find_one({"id": invoice_id, **scope}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")
    return Invoice(**invoice)

@api_router.put("/invoices/{invoice_id}", response_model=Invoice)
async def update_invoice(invoice_id: str, invoice_update: InvoiceUpdate, current_user: User = Depends(get_current_user)):
    update_data = {k: v for k, v in invoice_update.dict().items() if v is not None}
    if "date" in update_data:
        update_data["date"] = datetime.fromisoformat(update_data["date"].replace("Z", "+00:00"))

    company_id, scope = await get_company_scope(current_user)
    existing = await db.invoices.find_one({"id": invoice_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")

    # Newly switched to reverse charge and no протокол yet - assign one,
    # same as on create.
    if update_data.get("vat_treatment") == VatTreatment.REVERSE_CHARGE and not existing.get("protocol_number"):
        protocol_year = update_data.get("date", existing["date"]).year
        update_data["protocol_number"] = await next_protocol_number(
            company_id, current_user.user_id, protocol_year
        )

    result = await db.invoices.update_one(
        {"id": invoice_id, **scope},
        {"$set": update_data}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")

    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="update",
        entity_type="invoice",
        entity_id=invoice_id,
        company_id=company_id,
        details={k: v for k, v in update_data.items() if k != "date"}
    )

    return Invoice(**invoice)

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: User = Depends(get_current_user)):
    company_id, scope = await get_company_scope(current_user)
    invoice = await db.invoices.find_one({"id": invoice_id, **scope}, {"_id": 0})
    result = await db.invoices.delete_one({"id": invoice_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Фактурата не е намерена")

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="delete",
        entity_type="invoice",
        entity_id=invoice_id,
        company_id=company_id,
        details={"supplier": invoice.get("supplier"), "invoice_number": invoice.get("invoice_number"), "total_amount": invoice.get("total_amount")} if invoice else None
    )

    return {"message": "Фактурата е изтрита"}

# ===================== DAILY REVENUE ENDPOINTS =====================

@api_router.post("/daily-revenue", response_model=DailyRevenue)
async def create_daily_revenue(revenue: DailyRevenueCreate, current_user: User = Depends(get_current_user)):
    """Записва оборота за деня - ЗАМЕСТВА предишната стойност, не я
    добавя към нея (фронтендът зарежда текущите стойности в полетата
    при отваряне, точно за да могат да се коригират директно)."""
    company_id, scope = await get_company_scope(current_user)

    # Check if ANY teammate already logged revenue for this date - the
    # fiscal till total for a given day belongs to the whole company, not
    # to whoever happened to type it in.
    existing = await db.daily_revenue.find_one({**scope, "date": revenue.date}, {"_id": 0})

    if existing:
        await db.daily_revenue.update_one(
            {"id": existing["id"]},
            {"$set": {
                "fiscal_revenue": revenue.fiscal_revenue,
                "pocket_money": revenue.pocket_money,
                "vat_rate_percent": revenue.vat_rate_percent,
            }}
        )
        existing["fiscal_revenue"] = revenue.fiscal_revenue
        existing["pocket_money"] = revenue.pocket_money
        existing["vat_rate_percent"] = revenue.vat_rate_percent
        existing.setdefault("company_id", company_id)
        return DailyRevenue(**existing)

    revenue_obj = DailyRevenue(
        user_id=current_user.user_id,
        company_id=company_id,
        date=revenue.date,
        fiscal_revenue=revenue.fiscal_revenue,
        pocket_money=revenue.pocket_money,
        vat_rate_percent=revenue.vat_rate_percent
    )
    await db.daily_revenue.insert_one(revenue_obj.dict())
    return revenue_obj

@api_router.get("/daily-revenue/today")
async def get_today_revenue(current_user: User = Depends(get_current_user)):
    """Get today's revenue totals for the whole company"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    _, scope = await get_company_scope(current_user)
    existing = await db.daily_revenue.find_one({**scope, "date": today}, {"_id": 0})

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
    """Get revenue for a specific date, for the whole company"""
    _, scope = await get_company_scope(current_user)
    existing = await db.daily_revenue.find_one({**scope, "date": date}, {"_id": 0})

    if existing:
        return {
            "date": date,
            "fiscal_revenue": existing.get("fiscal_revenue", 0),
            "pocket_money": existing.get("pocket_money", 0),
            "vat_rate_percent": existing.get("vat_rate_percent", 20.0)
        }
    return {
        "date": date,
        "fiscal_revenue": 0,
        "pocket_money": 0,
        "vat_rate_percent": 20.0
    }

@api_router.get("/daily-revenue", response_model=List[DailyRevenue])
async def get_daily_revenues(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    _, query = await get_company_scope(current_user)

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
    company_id, _ = await get_company_scope(current_user)
    expense_obj = NonInvoiceExpense(
        user_id=current_user.user_id,
        company_id=company_id,
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
    _, query = await get_company_scope(current_user)

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
    _, scope = await get_company_scope(current_user)
    result = await db.expenses.delete_one({"id": expense_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Разходът не е намерен")
    return {"message": "Разходът е изтрит"}

# ===================== PERSONAL EXPENSES & ROI ENDPOINTS =====================

@api_router.post("/personal-expenses")
async def create_personal_expense(
    expense: PersonalExpenseCreate,
    current_user: User = Depends(get_current_user)
):
    """Създава личен разход/инвестиция (само за собственик)"""
    # Check if user is owner
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярът може да управлява лични разходи")
    
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        raise HTTPException(status_code=400, detail="Няма свързана фирма")
    
    expense_obj = PersonalExpense(
        user_id=current_user.user_id,
        company_id=company_id,
        amount=expense.amount,
        description=expense.description,
        expense_type=PersonalExpenseType(expense.expense_type),
        category=PersonalExpenseCategory(expense.category),
        period_month=expense.period_month,
        period_year=expense.period_year,
        supplier_id=expense.supplier_id,
        project_name=expense.project_name,
        notes=expense.notes
    )
    
    await db.personal_expenses.insert_one(expense_obj.dict())
    return {"message": "Личният разход е записан", "id": expense_obj.id}

@api_router.get("/personal-expenses")
async def get_personal_expenses(
    month: Optional[int] = None,
    year: Optional[int] = None,
    expense_type: Optional[str] = None,
    category: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Връща личните разходи (само за собственик)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярът може да вижда лични разходи")
    
    query = {"user_id": current_user.user_id}
    
    if month:
        query["period_month"] = month
    if year:
        query["period_year"] = year
    if expense_type:
        query["expense_type"] = expense_type
    if category:
        query["category"] = category
    
    expenses = await db.personal_expenses.find(query, {"_id": 0}).sort([("period_year", -1), ("period_month", -1)]).to_list(1000)
    return {"personal_expenses": expenses}

@api_router.delete("/personal-expenses/{expense_id}")
async def delete_personal_expense(
    expense_id: str,
    current_user: User = Depends(get_current_user)
):
    """Изтрива личен разход (само за собственик)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярът може да управлява лични разходи")
    
    result = await db.personal_expenses.delete_one({
        "id": expense_id,
        "user_id": current_user.user_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Разходът не е намерен")
    
    return {"message": "Личният разход е изтрит"}

@api_router.get("/roi/analysis")
@limiter.limit("20/minute")
async def get_roi_analysis(
    request: Request,
    month: Optional[int] = None,
    year: Optional[int] = None,
    current_user: User = Depends(get_current_user)
):
    """
    ROI анализ - изчислява възвръщаемост на личната инвестиция.
    Само за собственик.
    """
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярът има достъп до ROI анализ")
    
    # Default to current month/year
    now = datetime.now(timezone.utc)
    target_month = month or now.month
    target_year = year or now.year
    
    # Build period dates
    period_start = f"{target_year}-{target_month:02d}-01"
    if target_month == 12:
        period_end = f"{target_year + 1}-01-01"
    else:
        period_end = f"{target_year}-{target_month + 1:02d}-01"
    
    # Get personal expenses for period
    personal_expenses = await db.personal_expenses.find({
        "user_id": current_user.user_id,
        "period_month": target_month,
        "period_year": target_year
    }, {"_id": 0, "amount": 1, "expense_type": 1}).to_list(1000)
    
    total_personal = sum(e.get("amount", 0) for e in personal_expenses)
    total_investment = sum(e.get("amount", 0) for e in personal_expenses if e.get("expense_type") == "investment")

    # Business performance is company-wide (the whole team's entries), even
    # though the ROI/investment side above is the owner's personal ledger.
    _, scope = await get_company_scope(current_user)

    # Get business revenue for period
    revenues = await db.daily_revenue.find({
        **scope,
        "date": {"$gte": period_start, "$lt": period_end}
    }, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1}).to_list(1000)

    total_revenue = sum(r.get("fiscal_revenue", 0) + r.get("pocket_money", 0) for r in revenues)

    # Get business expenses (invoices + non-invoice expenses)
    invoices = await db.invoices.find({
        **scope,
        "date": {
            "$gte": datetime.fromisoformat(period_start + "T00:00:00+00:00"),
            "$lt": datetime.fromisoformat(period_end + "T00:00:00+00:00")
        }
    }, {"_id": 0, "total_amount": 1}).to_list(1000)

    business_expenses = await db.expenses.find({
        **scope,
        "date": {"$gte": period_start, "$lt": period_end}
    }, {"_id": 0, "amount": 1}).to_list(1000)
    
    total_business_expense = sum(i.get("total_amount", 0) for i in invoices) + sum(e.get("amount", 0) for e in business_expenses)
    
    # Calculate profit and ROI
    total_profit = total_revenue - total_business_expense
    
    # ROI = (Печалба / Лична инвестиция) * 100
    if total_personal > 0:
        roi_percent = (total_profit / total_personal) * 100
    else:
        roi_percent = 0 if total_profit <= 0 else 100
    
    is_profitable = total_profit > 0
    investment_covered = total_profit >= total_personal
    
    # Generate AI insights
    ai_insights = await generate_roi_insights(
        total_personal=total_personal,
        total_investment=total_investment,
        total_revenue=total_revenue,
        total_profit=total_profit,
        roi_percent=roi_percent,
        is_profitable=is_profitable,
        investment_covered=investment_covered
    )
    
    return {
        "period": {"month": target_month, "year": target_year},
        "period_start": period_start,
        "period_end": period_end,
        "total_personal_investment": round(total_personal, 2),
        "total_investment_only": round(total_investment, 2),
        "total_revenue": round(total_revenue, 2),
        "total_business_expense": round(total_business_expense, 2),
        "total_profit": round(total_profit, 2),
        "roi_percent": round(roi_percent, 1),
        "is_profitable": is_profitable,
        "investment_covered": investment_covered,
        "ai_insights": ai_insights
    }

async def generate_roi_insights(
    total_personal: float,
    total_investment: float,
    total_revenue: float,
    total_profit: float,
    roi_percent: float,
    is_profitable: bool,
    investment_covered: bool
) -> List[str]:
    """Генерира AI управленски предложения за ROI"""
    insights = []
    
    # Basic insights без AI (винаги налични)
    if total_personal == 0:
        insights.append("📊 Няма въведени лични разходи за периода")
        return insights
    
    if investment_covered:
        insights.append("✅ Бизнесът покрива личната инвестиция за периода")
    elif is_profitable:
        diff = total_personal - total_profit
        insights.append(f"⚠️ Печалбата не покрива напълно личната инвестиция (остават {diff:.2f} лв)")
    else:
        insights.append("❌ Работиш повече за бизнеса, отколкото бизнесът за теб")
    
    if roi_percent > 100:
        insights.append(f"🚀 Отличен ROI: {roi_percent:.1f}% - инвестицията се изплаща многократно")
    elif roi_percent > 50:
        insights.append(f"📈 Добър ROI: {roi_percent:.1f}%")
    elif roi_percent > 0:
        insights.append(f"📉 Нисък ROI: {roi_percent:.1f}% - има място за подобрение")
    elif roi_percent < -50:
        insights.append(f"🔴 Отрицателен ROI: {roi_percent:.1f}% - необходим е анализ на разходите")
    
    # Personal contribution ratio
    if total_revenue > 0:
        personal_ratio = (total_personal / total_revenue) * 100
        if personal_ratio > 50:
            insights.append(f"⚠️ Личната контрибуция ({personal_ratio:.1f}%) е висока спрямо оборота")
        elif personal_ratio > 30:
            insights.append(f"📊 Личната контрибуция е {personal_ratio:.1f}% от оборота")
    
    # Try to get AI enhanced insights
    try:
        if not AI_FEATURES_ENABLED:
            raise RuntimeError("AI features disabled")

        prompt = f"""Анализирай тези финансови показатели за малък бизнес:
- Лична инвестиция на собственика: {total_personal:.2f} лв
- Общ оборот: {total_revenue:.2f} лв
- Печалба: {total_profit:.2f} лв
- ROI: {roi_percent:.1f}%

Дай ЕДНА кратка препоръка (до 15 думи) какво може да направи собственикът за подобрение.
Отговори директно с препоръката, без въвеждащ текст."""

        response = await anthropic_client.messages.create(
            model="claude-opus-5",
            max_tokens=200,
            system="Ти си финансов съветник за малък бизнес. Давай кратки, ясни и практични съвети на български.",
            messages=[{"role": "user", "content": prompt}],
        )
        ai_recommendation = next((b.text for b in response.content if b.type == "text"), "").strip()

        if ai_recommendation and len(ai_recommendation) < 200:
            insights.append(f"💡 AI препоръка: {ai_recommendation}")
    except Exception as e:
        logger.warning(f"AI insights generation failed: {str(e)}")
    
    return insights

@api_router.get("/roi/trend")
async def get_roi_trend(
    months: int = 6,
    current_user: User = Depends(get_current_user)
):
    """Връща ROI тренд за последните N месеца (само за собственик)"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярът има достъп до ROI тренд")

    _, scope = await get_company_scope(current_user)
    now = datetime.now(timezone.utc)
    trend_data = []
    
    for i in range(months - 1, -1, -1):
        # Calculate target month
        target_month = now.month - i
        target_year = now.year
        
        while target_month <= 0:
            target_month += 12
            target_year -= 1
        
        # Get ROI for this month
        period_start = f"{target_year}-{target_month:02d}-01"
        if target_month == 12:
            period_end = f"{target_year + 1}-01-01"
        else:
            period_end = f"{target_year}-{target_month + 1:02d}-01"
        
        # Personal expenses
        personal = await db.personal_expenses.find({
            "user_id": current_user.user_id,
            "period_month": target_month,
            "period_year": target_year
        }, {"_id": 0, "amount": 1}).to_list(1000)
        total_personal = sum(p.get("amount", 0) for p in personal)
        
        # Revenue
        revenues = await db.daily_revenue.find({
            **scope,
            "date": {"$gte": period_start, "$lt": period_end}
        }, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1}).to_list(1000)
        total_revenue = sum(r.get("fiscal_revenue", 0) + r.get("pocket_money", 0) for r in revenues)

        # Business expenses
        invoices = await db.invoices.find({
            **scope,
            "date": {
                "$gte": datetime.fromisoformat(period_start + "T00:00:00+00:00"),
                "$lt": datetime.fromisoformat(period_end + "T00:00:00+00:00")
            }
        }, {"_id": 0, "total_amount": 1}).to_list(1000)

        expenses = await db.expenses.find({
            **scope,
            "date": {"$gte": period_start, "$lt": period_end}
        }, {"_id": 0, "amount": 1}).to_list(1000)
        
        total_expense = sum(i.get("total_amount", 0) for i in invoices) + sum(e.get("amount", 0) for e in expenses)
        total_profit = total_revenue - total_expense
        
        roi = (total_profit / total_personal * 100) if total_personal > 0 else (0 if total_profit <= 0 else 100)
        
        trend_data.append({
            "month": target_month,
            "year": target_year,
            "label": f"{target_month:02d}/{target_year}",
            "personal_investment": round(total_personal, 2),
            "revenue": round(total_revenue, 2),
            "profit": round(total_profit, 2),
            "roi_percent": round(roi, 1)
        })
    
    return {"trend": trend_data, "months": months}

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
    
    company_id, scope = await get_company_scope(current_user)

    # Get invoices
    inv_query = dict(scope)
    if start_date or end_date:
        inv_query["date"] = {}
        if start_date:
            inv_query["date"]["$gte"] = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        if end_date:
            inv_query["date"]["$lte"] = datetime.fromisoformat(end_date.replace("Z", "+00:00"))

    invoices = await db.invoices.find(inv_query, {"_id": 0, "total_amount": 1, "vat_amount": 1}).to_list(1000)

    # Get daily revenues
    rev_query = dict(scope)
    if date_query:
        rev_query["date"] = date_query
    revenues = await db.daily_revenue.find(rev_query, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1, "vat_rate_percent": 1}).to_list(1000)

    # Get expenses
    exp_query = dict(scope)
    if date_query:
        exp_query["date"] = date_query
    expenses = await db.expenses.find(exp_query, {"_id": 0, "amount": 1}).to_list(1000)

    # Get payroll cost (real employer cost: gross + employer contributions +
    # benefits), for the same period
    total_payroll_cost = await get_payroll_cost_for_period(company_id, current_user.user_id, start_date, end_date)

    # Get depreciation expense (ДМА) for the same period
    total_depreciation_expense = await get_depreciation_cost_for_period(company_id, current_user.user_id, start_date, end_date)

    # Calculate totals
    total_invoice_amount = sum(inv.get("total_amount", 0) for inv in invoices)
    total_invoice_vat = sum(inv.get("vat_amount", 0) for inv in invoices)
    total_fiscal_revenue = sum(r.get("fiscal_revenue", 0) for r in revenues)
    total_pocket_money = sum(r.get("pocket_money", 0) for r in revenues)
    total_expenses = sum(e.get("amount", 0) for e in expenses)

    # ДДС от фискализиран оборот - изчислено по действителната ставка на
    # всеки запис (20% стандартна, 9% намалена, 0% и т.н.), а не с фиксирано
    # предположение за 20% - важно за хотели/ресторанти/хлебарници и др.
    fiscal_vat = sum(
        r.get("fiscal_revenue", 0) * r.get("vat_rate_percent", 20.0) / (100 + r.get("vat_rate_percent", 20.0))
        for r in revenues
        if r.get("vat_rate_percent", 20.0) > 0
    )

    # Общ ДДС за плащане = ДДС от продажби - ДДС от покупки (фактури)
    vat_to_pay = fiscal_vat - total_invoice_vat

    # Общ приход (фискализиран + джобче)
    total_income = total_fiscal_revenue + total_pocket_money

    # Общ разход (фактури + разходи без фактури + разход за персонал + амортизации)
    total_expense = total_invoice_amount + total_expenses + total_payroll_cost + total_depreciation_expense

    return {
        "total_invoice_amount": round(total_invoice_amount, 2),
        "total_invoice_vat": round(total_invoice_vat, 2),
        "total_fiscal_revenue": round(total_fiscal_revenue, 2),
        "total_pocket_money": round(total_pocket_money, 2),
        "fiscal_vat": round(fiscal_vat, 2),
        "vat_to_pay": round(vat_to_pay, 2),
        "total_non_invoice_expenses": round(total_expenses, 2),
        "total_payroll_cost": round(total_payroll_cost, 2),
        "total_depreciation_expense": round(total_depreciation_expense, 2),
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

    _, scope = await get_company_scope(current_user)

    # Get data
    inv_query = {**scope, "date": {"$gte": start}}
    invoices = await db.invoices.find(inv_query, {"_id": 0, "date": 1, "total_amount": 1, "vat_amount": 1}).to_list(1000)

    rev_query = {**scope, "date": {"$gte": start_str}}
    revenues = await db.daily_revenue.find(rev_query, {"_id": 0, "date": 1, "fiscal_revenue": 1, "pocket_money": 1, "vat_rate_percent": 1}).to_list(1000)

    exp_query = {**scope, "date": {"$gte": start_str}}
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
        rate = rev.get("vat_rate_percent", 20.0)
        if rate > 0:
            daily_data[date_str]["vat"] += rev.get("fiscal_revenue", 0) * rate / (100 + rate)  # ДДС от продажби
    
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
    _, query = await get_company_scope(current_user)
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
    _, query = await get_company_scope(current_user)
    query["supplier"] = {"$regex": f"^{re.escape(supplier_name)}$", "$options": "i"}

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
    _, base_scope = await get_company_scope(current_user)

    for supplier_name in supplier_names:
        query = {**base_scope, "supplier": {"$regex": f"^{re.escape(supplier_name)}$", "$options": "i"}}
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
    _, query = await get_company_scope(current_user)
    query["supplier"] = {"$regex": f"^{re.escape(supplier_name)}$", "$options": "i"}

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
# (Simple whole-list Excel/PDF export lives at /export/invoices/excel and
# /export/invoices/pdf further below, via ExportService - correctly
# company-scoped and Cyrillic-safe. An older, buggier, ASCII-only inline
# duplicate of both used to live here and has been removed.)

@api_router.get("/export/statistics/pdf")
async def export_statistics_pdf(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Export a one-page financial report (summary + top suppliers/items) as PDF"""
    require_permission(current_user, "export_data")
    stats = await get_summary(start_date=start_date, end_date=end_date, current_month_only=not (start_date or end_date), current_user=current_user)
    suppliers_data = await get_supplier_statistics(start_date=start_date, end_date=end_date, current_user=current_user)
    items_data = await get_item_statistics(start_date=start_date, end_date=end_date, top_n=10, current_user=current_user)

    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    company_name = ""
    if company_id:
        company = await db.companies.find_one({"id": company_id})
        company_name = company.get("name", "") if company else ""

    period_label = ""
    if start_date and end_date:
        period_label = f"Период: {start_date[:10]} - {end_date[:10]}"

    try:
        pdf_data = ExportService.generate_statistics_pdf(
            stats=stats,
            top_suppliers=suppliers_data.get("top_by_amount", []),
            top_items=items_data.get("top_by_value", []),
            company_name=company_name,
            period_label=period_label
        )

        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="export",
            entity_type="statistics",
            company_id=company_id,
            details={"format": "pdf"}
        )

        filename = f"statistics_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        return Response(
            content=pdf_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF export not available")

@api_router.get("/export/vat-ledger/excel")
async def export_vat_ledger_excel(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Export a working ДДС purchases/sales ledger (Дневник на покупки и
    продажби) for the given period, grouped by VAT-rate category - meant
    as the accountant's source data for filing, not a byte-exact copy of
    NRA's own file layout."""
    require_permission(current_user, "export_data")
    now = datetime.now(timezone.utc)
    if not start_date and not end_date:
        start_date = now.replace(day=1).strftime("%Y-%m-%d")
        if now.month == 12:
            end_date = now.replace(year=now.year + 1, month=1, day=1).strftime("%Y-%m-%d")
        else:
            end_date = now.replace(month=now.month + 1, day=1).strftime("%Y-%m-%d")

    company_id, scope = await get_company_scope(current_user)

    inv_query = dict(scope)
    inv_query["date"] = {
        "$gte": datetime.fromisoformat(start_date + "T00:00:00+00:00"),
        "$lte": datetime.fromisoformat(end_date + "T23:59:59+00:00"),
    }
    purchases = await db.invoices.find(inv_query, {"_id": 0, "image_base64": 0}).sort("date", 1).to_list(10000)

    rev_query = dict(scope)
    rev_query["date"] = {"$gte": start_date, "$lte": end_date}
    sales = await db.daily_revenue.find(rev_query, {"_id": 0}).sort("date", 1).to_list(10000)

    company_name = ""
    if company_id:
        company = await db.companies.find_one({"id": company_id})
        company_name = company.get("name", "") if company else ""

    period_label = f"Период: {start_date} - {end_date}"

    try:
        excel_data = ExportService.generate_vat_ledger_excel(
            purchases=purchases,
            sales=sales,
            company_name=company_name,
            period_label=period_label
        )

        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="export",
            entity_type="vat_ledger",
            company_id=company_id,
            details={"format": "excel", "start_date": start_date, "end_date": end_date}
        )

        filename = f"dnevnik_pokupki_prodajbi_{start_date}_{end_date}.xlsx"
        return Response(
            content=excel_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel export not available")

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

# Restore-only input models: validated shapes for what /backup/restore will
# accept, matching what /backup/create produces. company_id/user_id are
# deliberately NOT accepted here - they're always overwritten server-side
# from the caller's own session, so a restore can never inject records
# into (or spoof ownership from) a different company.
class RestoreInvoice(BaseModel):
    id: str
    supplier: str
    supplier_eik: Optional[str] = None
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    vat_treatment: Optional[str] = None
    protocol_number: Optional[str] = None
    date: str
    image_base64: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[dict]] = None
    created_at: Optional[str] = None

class RestoreDailyRevenue(BaseModel):
    id: str
    date: str
    fiscal_revenue: float = 0
    pocket_money: float = 0
    vat_rate_percent: float = 20.0
    created_at: Optional[str] = None

class RestoreExpense(BaseModel):
    id: str
    description: str
    amount: float
    date: str
    created_at: Optional[str] = None

class BackupRestoreRequest(BaseModel):
    invoices: List[RestoreInvoice] = []
    daily_revenues: List[RestoreDailyRevenue] = []
    expenses: List[RestoreExpense] = []

@api_router.post("/backup/create")
async def create_backup(current_user: User = Depends(get_current_user)):
    """Създава backup на всички данни на ЦЯЛАТА фирма (не само тези,
    въведени лично от текущия потребител), за да е реален backup на
    книгите на компанията."""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да прави резервно копие")

    import json

    company_id, scope = await get_company_scope(current_user)

    # Събиране на фактури
    invoices = await db.invoices.find(scope, {"_id": 0}).to_list(10000)

    # Конвертиране на datetime обекти
    for inv in invoices:
        if isinstance(inv.get("date"), datetime):
            inv["date"] = inv["date"].isoformat()
        if isinstance(inv.get("created_at"), datetime):
            inv["created_at"] = inv["created_at"].isoformat()

    # Събиране на дневни обороти
    revenues = await db.daily_revenue.find(scope, {"_id": 0}).to_list(10000)

    for rev in revenues:
        if isinstance(rev.get("date"), datetime):
            rev["date"] = rev["date"].isoformat()
        if isinstance(rev.get("created_at"), datetime):
            rev["created_at"] = rev["created_at"].isoformat()

    # Събиране на разходи
    expenses = await db.expenses.find(scope, {"_id": 0}).to_list(10000)

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
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да вижда резервните копия")

    backups = await db.backup_metadata.find(
        {"user_id": current_user.user_id},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    
    return {"backups": backups}

@api_router.post("/backup/restore")
async def restore_backup(backup_data: BackupRestoreRequest, current_user: User = Depends(get_current_user)):
    """Възстановява данни от backup - само Owner, само в собствената му
    фирма (company_id винаги се презаписва от сесията, никога от подадените
    данни). Всеки запис се обработва поотделно, за да не провали един
    невалиден ред цялото възстановяване."""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да възстановява резервно копие")

    company_id, _ = await get_company_scope(current_user)

    restored_counts = {"invoices": 0, "revenues": 0, "expenses": 0}
    skipped_counts = {"invoices": 0, "revenues": 0, "expenses": 0}

    # One existence-check query per collection instead of one per record -
    # a backup can hold thousands of rows, and this was previously an
    # N+1 (a find_one per item) on top of the N inserts already needed.
    existing_invoice_ids = {
        d["id"] for d in await db.invoices.find(
            {"id": {"$in": [inv.id for inv in backup_data.invoices]}}, {"id": 1}
        ).to_list(len(backup_data.invoices) or 1)
    }
    existing_revenue_ids = {
        d["id"] for d in await db.daily_revenue.find(
            {"id": {"$in": [r.id for r in backup_data.daily_revenues]}}, {"id": 1}
        ).to_list(len(backup_data.daily_revenues) or 1)
    }
    existing_expense_ids = {
        d["id"] for d in await db.expenses.find(
            {"id": {"$in": [e.id for e in backup_data.expenses]}}, {"id": 1}
        ).to_list(len(backup_data.expenses) or 1)
    }

    # Възстановяване на фактури
    for invoice in backup_data.invoices:
        try:
            if invoice.id in existing_invoice_ids:
                continue
            doc = invoice.dict()
            doc["user_id"] = current_user.user_id
            doc["company_id"] = company_id
            doc["date"] = datetime.fromisoformat(doc["date"].replace("Z", "+00:00"))
            doc["created_at"] = (
                datetime.fromisoformat(doc["created_at"].replace("Z", "+00:00"))
                if doc.get("created_at") else datetime.now(timezone.utc)
            )
            await db.invoices.insert_one(doc)
            restored_counts["invoices"] += 1
        except Exception as e:
            logger.warning(f"Backup restore: skipped invalid invoice {invoice.id}: {e}")
            skipped_counts["invoices"] += 1

    # Възстановяване на дневни обороти (date си остава низ "YYYY-MM-DD",
    # както при нормално създаване - НЕ datetime обект)
    for revenue in backup_data.daily_revenues:
        try:
            if revenue.id in existing_revenue_ids:
                continue
            doc = revenue.dict()
            doc["user_id"] = current_user.user_id
            doc["company_id"] = company_id
            doc["date"] = doc["date"][:10]
            doc["created_at"] = (
                datetime.fromisoformat(doc["created_at"].replace("Z", "+00:00"))
                if doc.get("created_at") else datetime.now(timezone.utc)
            )
            await db.daily_revenue.insert_one(doc)
            restored_counts["revenues"] += 1
        except Exception as e:
            logger.warning(f"Backup restore: skipped invalid daily revenue {revenue.id}: {e}")
            skipped_counts["revenues"] += 1

    # Възстановяване на разходи (date също остава низ)
    for expense in backup_data.expenses:
        try:
            if expense.id in existing_expense_ids:
                continue
            doc = expense.dict()
            doc["user_id"] = current_user.user_id
            doc["company_id"] = company_id
            doc["date"] = doc["date"][:10]
            doc["created_at"] = (
                datetime.fromisoformat(doc["created_at"].replace("Z", "+00:00"))
                if doc.get("created_at") else datetime.now(timezone.utc)
            )
            await db.expenses.insert_one(doc)
            restored_counts["expenses"] += 1
        except Exception as e:
            logger.warning(f"Backup restore: skipped invalid expense {expense.id}: {e}")
            skipped_counts["expenses"] += 1
    
    return {
        "success": True,
        "message": "Данните са възстановени успешно",
        "restored": restored_counts,
        "skipped": skipped_counts
    }

@api_router.get("/backup/status")
async def get_backup_status(current_user: User = Depends(get_current_user)):
    """Връща статус на последния backup"""
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Само титулярят може да вижда статуса на резервните копия")

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
        query["supplier"] = {"$regex": f"^{re.escape(unquote(supplier))}$", "$options": "i"}
    
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

# ===================== AI ITEM MERGING =====================

class ItemMergeGroup(BaseModel):
    canonical_name: str = Field(description="Каноничното (най-ясно четимото) име на продукта/суровината")
    variants: List[str] = Field(description="Всички изписвания от списъка, които обозначават същия продукт")

class ItemMergeResult(BaseModel):
    groups: List[ItemMergeGroup] = Field(default_factory=list, description="Групи от сходни продукти; празен списък, ако няма такива")

async def run_ai_item_merge(company_id: str) -> dict:
    """
    AI модул за автоматично сливане на сходни продукти (като суровина),
    отвъд простото fuzzy съпоставяне при запис - разпознава и варианти,
    които разчитат на контекст/смисъл (съкращения, синоними, правописни
    грешки), не само на близост в изписването. Извиква се както директно
    от /items/ai-merge, така и автоматично на заден план след запис на
    фактура (виж maybe_schedule_ai_item_merge).
    """
    if not AI_FEATURES_ENABLED:
        return {"merged_groups": [], "total_merged": 0, "message": "AI функцията временно не е налична"}

    # Get all unique item names
    history = await db.item_price_history.find(
        {"company_id": company_id},
        {"_id": 0, "item_name": 1}
    ).to_list(10000)

    unique_items = list(set(h["item_name"] for h in history))

    if len(unique_items) < 2:
        return {"merged_groups": [], "total_merged": 0, "message": "Недостатъчно артикули за анализ"}

    try:
        items_text = "\n".join(unique_items[:200])

        prompt = f"""Анализирай следния списък с имена на продукти/суровини и групирай сходните продукти.
Търси продукти, които са едни и същи, но са записани по различен начин: различен регистър на буквите, пунктуация, съкращения, правописни грешки, синоними, различен словоред или разфасовка на един и същ артикул.

Списък с продукти:
{items_text}

Не групирай продукти, които са наистина различни (например "Олио" и "Оцет" са РАЗЛИЧНИ продукти).
Групирай САМО ако очевидно става дума за същия продукт/суровина с различно изписване.
Върни само групи с 2 или повече варианта - пропусни продукти без дубликат."""

        response = await anthropic_client.messages.parse(
            model="claude-opus-5",
            max_tokens=8000,
            system="Ти си експертен асистент за анализ и групиране на продукти/суровини за малък бизнес в България.",
            messages=[{"role": "user", "content": prompt}],
            output_format=ItemMergeResult,
        )

        parsed = response.parsed_output
        groups = parsed.groups if parsed else []
        merged_groups = [g.model_dump() for g in groups if g.canonical_name and g.variants]

        # Save merge mappings to database
        for group in merged_groups:
            canonical = group["canonical_name"]
            variants = group["variants"]
            variant_keys = sorted({v.lower() for v in variants} | {canonical.lower()})

            await db.item_merge_mappings.update_one(
                {"company_id": company_id, "canonical_name": canonical.lower()},
                {
                    "$set": {
                        "canonical_name": canonical.lower(),
                        "display_name": canonical,
                        "variants": variant_keys,
                        "company_id": company_id,
                        "updated_at": datetime.now(timezone.utc)
                    }
                },
                upsert=True
            )

        total_merged = sum(len(g["variants"]) for g in merged_groups)

        return {
            "merged_groups": merged_groups,
            "total_merged": total_merged,
            "message": f"Намерени {len(merged_groups)} групи сходни продукти"
        }

    except Exception as e:
        logger.error(f"AI merge error: {str(e)}")
        # Unlike generate_roi_insights (where the AI call is an optional
        # bonus on top of already-useful non-AI results), this IS the whole
        # feature - swallowing the error here would make a real AI outage
        # look identical to "no similar items found". Re-raise so the
        # direct-call endpoint can surface a proper error; the background
        # auto-merge path already wraps this call in its own try/except.
        raise

# Ready-run-immediately gate for the background auto-merge: at most once
# per company per cooldown window, so an active user saving many invoices
# in a row doesn't trigger a paid AI call on every single one.
AI_ITEM_MERGE_COOLDOWN = timedelta(hours=6)

async def maybe_schedule_ai_item_merge(company_id: Optional[str]):
    """Fire-and-forget background task: runs the AI item merge for a company
    if it hasn't run recently, so raw-material grouping stays up to date
    automatically as invoices come in, without the user having to ask for it."""
    if not company_id or not AI_FEATURES_ENABLED:
        return
    try:
        run_doc = await db.item_merge_runs.find_one({"company_id": company_id}, {"_id": 0, "last_run_at": 1})
        now = datetime.now(timezone.utc)
        if run_doc and run_doc.get("last_run_at"):
            last_run_at = run_doc["last_run_at"]
            if last_run_at.tzinfo is None:
                last_run_at = last_run_at.replace(tzinfo=timezone.utc)
            if now - last_run_at < AI_ITEM_MERGE_COOLDOWN:
                return
        await db.item_merge_runs.update_one(
            {"company_id": company_id},
            {"$set": {"company_id": company_id, "last_run_at": now}},
            upsert=True
        )
        await run_ai_item_merge(company_id)
    except Exception as e:
        logger.error(f"Background AI item merge error: {str(e)}")

@api_router.post("/items/ai-merge")
@limiter.limit("10/minute")
async def ai_merge_similar_items(
    request: Request,
    current_user: User = Depends(get_current_user)
):
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None

    if not company_id:
        return {"merged_groups": [], "total_merged": 0}

    try:
        return await run_ai_item_merge(company_id)
    except Exception as e:
        raise ai_exception_to_http(e, "AI item merge error")

@api_router.get("/items/merge-mappings")
async def get_merge_mappings(current_user: User = Depends(get_current_user)):
    """Връща текущите сливания на продукти"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"mappings": []}
    
    mappings = await db.item_merge_mappings.find(
        {"company_id": company_id},
        {"_id": 0}
    ).to_list(1000)
    
    return {"mappings": mappings}

@api_router.delete("/items/merge-mappings/{canonical_name}")
async def delete_merge_mapping(
    canonical_name: str,
    current_user: User = Depends(get_current_user)
):
    """Изтрива сливане на продукти"""
    from urllib.parse import unquote
    
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        raise HTTPException(status_code=404, detail="Фирмата не е намерена")
    
    result = await db.item_merge_mappings.delete_one({
        "company_id": company_id,
        "canonical_name": unquote(canonical_name).lower()
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Сливането не е намерено")
    
    return {"message": "Сливането е изтрито"}

@api_router.get("/statistics/items/merged")
async def get_merged_item_statistics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    top_n: int = 10,
    current_user: User = Depends(get_current_user)
):
    """
    Връща статистика за артикули с приложени AI сливания.
    Сходните продукти са обединени в една позиция.
    """
    from collections import defaultdict
    
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {
            "totals": {"total_items": 0, "total_value": 0, "unique_items": 0, "merged_items": 0},
            "top_by_quantity": [],
            "top_by_value": [],
            "merge_applied": False
        }
    
    # Get merge mappings
    mappings = await db.item_merge_mappings.find(
        {"company_id": company_id},
        {"_id": 0}
    ).to_list(1000)
    
    # Create variant to canonical mapping
    variant_to_canonical = {}
    canonical_display = {}
    for m in mappings:
        canonical = m["canonical_name"]
        canonical_display[canonical] = m.get("display_name", canonical)
        for variant in m.get("variants", []):
            variant_to_canonical[variant.lower()] = canonical
    
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
            "totals": {"total_items": 0, "total_value": 0, "unique_items": 0, "merged_items": 0},
            "top_by_quantity": [],
            "top_by_value": [],
            "merge_applied": bool(mappings)
        }
    
    # Aggregate with merging
    item_stats = defaultdict(lambda: {
        "display_name": "",
        "quantity": 0,
        "total_value": 0,
        "frequency": 0,
        "prices": [],
        "suppliers": set(),
        "original_names": set()
    })
    
    merged_count = 0
    for record in history:
        original_name = record["item_name"]
        name_lower = original_name.lower()
        
        # Apply merge mapping
        if name_lower in variant_to_canonical:
            canonical = variant_to_canonical[name_lower]
            display = canonical_display.get(canonical, canonical.title())
            merged_count += 1
        else:
            canonical = name_lower
            display = original_name
        
        price = record["unit_price"]
        qty = record["quantity"]
        
        item_stats[canonical]["display_name"] = display
        item_stats[canonical]["quantity"] += qty
        item_stats[canonical]["total_value"] += price * qty
        item_stats[canonical]["frequency"] += 1
        item_stats[canonical]["prices"].append(price)
        item_stats[canonical]["suppliers"].add(record["supplier"])
        item_stats[canonical]["original_names"].add(original_name)
    
    # Calculate totals
    total_items = sum(s["frequency"] for s in item_stats.values())
    total_value = sum(s["total_value"] for s in item_stats.values())
    unique_items = len(item_stats)
    
    # Build top lists
    items_list = []
    for canonical, stats in item_stats.items():
        prices = stats["prices"]
        avg_price = sum(prices) / len(prices) if prices else 0
        
        items_list.append({
            "name": stats["display_name"],
            "canonical_name": canonical,
            "total_quantity": round(stats["quantity"], 2),
            "total_value": round(stats["total_value"], 2),
            "frequency": stats["frequency"],
            "avg_price": round(avg_price, 2),
            "supplier_count": len(stats["suppliers"]),
            "original_names": list(stats["original_names"])[:5]  # Show max 5 variants
        })
    
    # Sort for top lists
    top_by_quantity = sorted(items_list, key=lambda x: x["total_quantity"], reverse=True)[:top_n]
    top_by_value = sorted(items_list, key=lambda x: x["total_value"], reverse=True)[:top_n]
    
    return {
        "totals": {
            "total_items": total_items,
            "total_value": round(total_value, 2),
            "unique_items": unique_items,
            "merged_items": merged_count
        },
        "top_by_quantity": top_by_quantity,
        "top_by_value": top_by_value,
        "merge_applied": bool(mappings),
        "merge_groups_count": len(mappings)
    }

# ===================== EXPORT ENDPOINTS =====================

from services.export_service import ExportService
from services.audit_service import AuditService
from services.forecast_service import ForecastService

# Initialize services
audit_service = AuditService(db)
forecast_service = ForecastService(db)

@api_router.get("/export/invoices/excel")
async def export_invoices_excel(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Export invoices to Excel"""
    require_permission(current_user, "export_data")
    company_id, query = await get_company_scope(current_user)

    if start_date:
        query["date"] = {"$gte": datetime.fromisoformat(start_date + "T00:00:00+00:00")}
    if end_date:
        if "date" not in query:
            query["date"] = {}
        query["date"]["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    invoices = await db.invoices.find(query, {"_id": 0, "image_base64": 0}).sort("date", -1).to_list(10000)
    
    # Get company name
    company_name = ""
    if company_id:
        company = await db.companies.find_one({"id": company_id})
        company_name = company.get("name", "") if company else ""
    
    try:
        excel_data = ExportService.generate_invoices_excel(invoices, company_name)
        
        # Log export
        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="export",
            entity_type="invoices",
            company_id=company_id,
            details={"format": "excel", "count": len(invoices)}
        )
        
        filename = f"invoices_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
        return Response(
            content=excel_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="Excel export not available")

@api_router.get("/export/invoices/pdf")
async def export_invoices_pdf(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Export invoices to PDF"""
    require_permission(current_user, "export_data")
    company_id, query = await get_company_scope(current_user)

    if start_date:
        query["date"] = {"$gte": datetime.fromisoformat(start_date + "T00:00:00+00:00")}
    if end_date:
        if "date" not in query:
            query["date"] = {}
        query["date"]["$lte"] = datetime.fromisoformat(end_date + "T23:59:59+00:00")
    
    invoices = await db.invoices.find(query, {"_id": 0, "image_base64": 0}).sort("date", -1).to_list(10000)
    
    company_name = ""
    if company_id:
        company = await db.companies.find_one({"id": company_id})
        company_name = company.get("name", "") if company else ""
    
    try:
        pdf_data = ExportService.generate_invoices_pdf(invoices, company_name)
        
        await audit_service.log_action(
            user_id=current_user.user_id,
            user_name=current_user.name,
            action="export",
            entity_type="invoices",
            company_id=company_id,
            details={"format": "pdf", "count": len(invoices)}
        )
        
        filename = f"invoices_{datetime.now().strftime('%Y%m%d_%H%M')}.pdf"
        return Response(
            content=pdf_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except ImportError:
        raise HTTPException(status_code=500, detail="PDF export not available")

# ===================== BUDGET ENDPOINTS =====================

class BudgetCreate(BaseModel):
    month: str  # YYYY-MM
    expense_limit: float
    alert_threshold: float = 80.0

@api_router.get("/budget")
async def get_budgets(current_user: User = Depends(get_current_user)):
    """Get all budgets for company"""
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"budgets": []}
    
    budgets = await db.budgets.find({"company_id": company_id}, {"_id": 0}).sort("month", -1).to_list(24)
    return {"budgets": budgets}

@api_router.post("/budget")
async def create_budget(budget: BudgetCreate, current_user: User = Depends(get_current_user)):
    """Create or update budget for a month"""
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        raise HTTPException(status_code=400, detail="No company associated")
    
    # Check if budget exists for this month
    existing = await db.budgets.find_one({"company_id": company_id, "month": budget.month})
    
    if existing:
        await db.budgets.update_one(
            {"company_id": company_id, "month": budget.month},
            {"$set": {"expense_limit": budget.expense_limit, "alert_threshold": budget.alert_threshold}}
        )
    else:
        budget_doc = {
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "month": budget.month,
            "expense_limit": budget.expense_limit,
            "alert_threshold": budget.alert_threshold,
            "created_at": datetime.now(timezone.utc)
        }
        await db.budgets.insert_one(budget_doc)
    
    return {"message": "Budget saved"}

@api_router.get("/budget/status")
async def get_budget_status(current_user: User = Depends(get_current_user)):
    """Get current month budget status"""
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"has_budget": False}
    
    current_month = datetime.now().strftime("%Y-%m")
    budget = await db.budgets.find_one({"company_id": company_id, "month": current_month}, {"_id": 0})
    
    if not budget:
        return {"has_budget": False}
    
    # Calculate current expenses
    month_start = datetime.fromisoformat(f"{current_month}-01T00:00:00+00:00")
    _, scope = await get_company_scope(current_user)

    invoices = await db.invoices.find(
        {**scope, "date": {"$gte": month_start}},
        {"total_amount": 1}
    ).to_list(10000)

    expenses = await db.expenses.find(
        {**scope, "date": {"$gte": current_month + "-01"}},
        {"amount": 1}
    ).to_list(10000)
    
    total_spent = sum(inv.get("total_amount", 0) for inv in invoices)
    total_spent += sum(exp.get("amount", 0) for exp in expenses)
    
    limit = budget.get("expense_limit", 0)
    threshold = budget.get("alert_threshold", 80)
    
    percent_used = (total_spent / limit * 100) if limit > 0 else 0
    is_alert = percent_used >= threshold
    is_exceeded = percent_used >= 100
    
    return {
        "has_budget": True,
        "month": current_month,
        "expense_limit": limit,
        "total_spent": round(total_spent, 2),
        "remaining": round(max(0, limit - total_spent), 2),
        "percent_used": round(percent_used, 1),
        "alert_threshold": threshold,
        "is_alert": is_alert,
        "is_exceeded": is_exceeded
    }

# ===================== RECURRING EXPENSES =====================

class RecurringExpenseCreate(BaseModel):
    description: str
    amount: float
    day_of_month: int  # 1-28
    category: Optional[str] = None

@api_router.get("/recurring-expenses")
async def get_recurring_expenses(current_user: User = Depends(get_current_user)):
    """Get recurring expenses"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"recurring_expenses": []}
    
    expenses = await db.recurring_expenses.find(
        {"company_id": company_id},
        {"_id": 0}
    ).to_list(100)
    
    return {"recurring_expenses": expenses}

@api_router.post("/recurring-expenses")
async def create_recurring_expense(
    expense: RecurringExpenseCreate,
    current_user: User = Depends(get_current_user)
):
    """Create recurring expense"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        raise HTTPException(status_code=400, detail="No company associated")
    
    if expense.day_of_month < 1 or expense.day_of_month > 28:
        raise HTTPException(status_code=400, detail="Day must be between 1 and 28")
    
    expense_doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "user_id": current_user.user_id,
        "description": expense.description,
        "amount": expense.amount,
        "day_of_month": expense.day_of_month,
        "category": expense.category,
        "is_active": True,
        "last_generated": None,
        "created_at": datetime.now(timezone.utc)
    }
    
    await db.recurring_expenses.insert_one(expense_doc)
    return {"message": "Recurring expense created", "id": expense_doc["id"]}

@api_router.delete("/recurring-expenses/{expense_id}")
async def delete_recurring_expense(expense_id: str, current_user: User = Depends(get_current_user)):
    """Delete recurring expense"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    result = await db.recurring_expenses.delete_one({"id": expense_id, "company_id": company_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    return {"message": "Deleted"}

# ===================== FORECAST ENDPOINTS =====================

@api_router.get("/forecast/expenses")
async def get_expense_forecast(
    months_ahead: int = 3,
    current_user: User = Depends(get_current_user)
):
    """Get expense forecast"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"error": "No company"}
    
    return await forecast_service.get_expense_forecast(company_id, months_ahead)

@api_router.get("/forecast/revenue")
async def get_revenue_forecast(
    months_ahead: int = 3,
    current_user: User = Depends(get_current_user)
):
    """Get revenue forecast"""
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    if not company_id:
        return {"error": "No company"}
    
    return await forecast_service.get_revenue_forecast(company_id, months_ahead)

# ===================== PAYROLL / ВЕДОМОСТ ЗА ЗАПЛАТИ =====================

class PayrollAgreementType(str, Enum):
    GROSS = "gross"  # договорено е брутното - служителят носи стандартната си част
    NET = "net"      # договорено е нетното "на ръка" - работодателят поема разликата

class Employee(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None
    name: str
    position: Optional[str] = None
    hire_date: Optional[str] = None
    base_salary: float  # тълкува се според agreement_type
    agreement_type: PayrollAgreementType = PayrollAgreementType.GROSS
    food_vouchers: float = 0  # ваучери за храна, месечно
    additional_insurance: float = 0  # ДДЗО, месечно
    active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class EmployeeCreate(BaseModel):
    name: str
    position: Optional[str] = None
    hire_date: Optional[str] = None
    base_salary: float
    agreement_type: PayrollAgreementType = PayrollAgreementType.GROSS
    food_vouchers: float = 0
    additional_insurance: float = 0

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    hire_date: Optional[str] = None
    base_salary: Optional[float] = None
    agreement_type: Optional[PayrollAgreementType] = None
    food_vouchers: Optional[float] = None
    additional_insurance: Optional[float] = None
    active: Optional[bool] = None

class PayrollRates(BaseModel):
    company_id: str
    employee_rate_percent: float = 13.78  # осигуровки за сметка на осигурения
    employer_rate_percent: float = 18.92  # осигуровки за сметка на работодателя
    income_tax_percent: float = 10.0      # данък общ доход (плосък данък)
    min_insurance_income: float = 550.71  # минимален осигурителен доход (EUR)
    max_insurance_income: float = 1917.56  # максимален осигурителен доход (EUR)

DEFAULT_PAYROLL_RATES = {
    "employee_rate_percent": 13.78,
    "employer_rate_percent": 18.92,
    "income_tax_percent": 10.0,
    "min_insurance_income": 550.71,
    "max_insurance_income": 1917.56,
}

class PayrollEntryCreate(BaseModel):
    employee_id: str
    period_month: int  # 1-12
    period_year: int
    gross_amount: Optional[float] = None  # подадено ако agreement_type=gross (или ръчна корекция)
    net_target: Optional[float] = None    # подадено ако agreement_type=net
    bonus_amount: float = 0
    notes: Optional[str] = None
    image_base64: Optional[str] = None

def calculate_payroll(
    base_amount: float,
    agreement_type: str,
    rates: dict,
    bonus_amount: float = 0,
    food_vouchers: float = 0,
    additional_insurance: float = 0,
) -> dict:
    """Изчислява разбивка на трудово възнаграждение.

    Опростен модел: осигуровки върху ограничен (мин/макс) осигурителен доход,
    данък общ доход върху (бруто - осигуровки на осигурения). Не отчита данъчни
    облекчения (деца, инвалидност), втори трудов договор или други частни
    случаи - реалната ведомост на счетоводителя е меродавна, това е работна
    оценка за статистиката на приложението.
    """
    employee_rate = rates["employee_rate_percent"] / 100
    employer_rate = rates["employer_rate_percent"] / 100
    tax_rate = rates["income_tax_percent"] / 100
    min_income = rates["min_insurance_income"]
    max_income = rates["max_insurance_income"]

    if agreement_type == PayrollAgreementType.NET or agreement_type == "net":
        # Gross-up: намери брутното, което след удръжки дава точно това нето.
        # Формулата долу приема, че осигурителният доход = брутото - вярно е
        # само докато резултатът попада в диапазона мин/макс осигурителен
        # доход. Извън него удръжките се таксуват върху ограничения праг, не
        # върху нарастващото бруто, затова без тази проверка изплатеното
        # нето тихо се разминава с договореното при по-високи (или много
        # ниски) заплати - виж съответната клауза долу.
        net_target = base_amount
        gross_amount = net_target / ((1 - employee_rate) * (1 - tax_rate))
        if gross_amount > max_income:
            gross_amount = net_target / (1 - tax_rate) + max_income * employee_rate
        elif gross_amount < min_income:
            gross_amount = net_target / (1 - tax_rate) + min_income * employee_rate
    else:
        gross_amount = base_amount

    gross_amount += bonus_amount

    insurance_base = max(min_income, min(gross_amount, max_income))
    employee_contributions = insurance_base * employee_rate
    employer_contributions = insurance_base * employer_rate
    taxable_base = max(0, gross_amount - employee_contributions)
    income_tax = taxable_base * tax_rate
    net_amount = gross_amount - employee_contributions - income_tax
    total_employer_cost = gross_amount + employer_contributions + food_vouchers + additional_insurance

    return {
        "gross_amount": round(gross_amount, 2),
        "insurance_base": round(insurance_base, 2),
        "employee_contributions": round(employee_contributions, 2),
        "employer_contributions": round(employer_contributions, 2),
        "income_tax": round(income_tax, 2),
        "net_amount": round(net_amount, 2),
        "food_vouchers": round(food_vouchers, 2),
        "additional_insurance": round(additional_insurance, 2),
        "total_employer_cost": round(total_employer_cost, 2),
    }

async def get_payroll_rates_dict(company_id: Optional[str]) -> dict:
    if not company_id:
        return dict(DEFAULT_PAYROLL_RATES)
    rates = await db.payroll_rates.find_one({"company_id": company_id}, {"_id": 0})
    if not rates:
        return dict(DEFAULT_PAYROLL_RATES)
    return {**DEFAULT_PAYROLL_RATES, **rates}

@api_router.get("/payroll/rates")
async def get_payroll_rates(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    return await get_payroll_rates_dict(company_id)

@api_router.put("/payroll/rates")
async def update_payroll_rates(request: Request, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    if not company_id:
        raise HTTPException(status_code=400, detail="Нямате фирма")

    body = await request.json()
    update_data = {k: float(v) for k, v in body.items() if k in DEFAULT_PAYROLL_RATES}

    existing = await db.payroll_rates.find_one({"company_id": company_id})
    if existing:
        await db.payroll_rates.update_one({"company_id": company_id}, {"$set": update_data})
    else:
        rates = PayrollRates(company_id=company_id, **{**DEFAULT_PAYROLL_RATES, **update_data})
        await db.payroll_rates.insert_one(rates.dict())

    return await get_payroll_rates_dict(company_id)

@api_router.post("/employees", response_model=Employee)
async def create_employee(employee: EmployeeCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None

    employee_obj = Employee(user_id=current_user.user_id, company_id=company_id, **employee.dict())
    await db.employees.insert_one(employee_obj.dict())
    return employee_obj

@api_router.get("/employees", response_model=List[Employee])
async def get_employees(active_only: bool = False, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None

    query = {"company_id": company_id} if company_id else {"user_id": current_user.user_id}
    if active_only:
        query["active"] = True

    employees = await db.employees.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return [Employee(**e) for e in employees]

@api_router.put("/employees/{employee_id}", response_model=Employee)
async def update_employee(employee_id: str, update: EmployeeUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    _, scope = await get_company_scope(current_user)
    result = await db.employees.update_one({"id": employee_id, **scope}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")
    employee = await db.employees.find_one({"id": employee_id}, {"_id": 0})
    return Employee(**employee)

@api_router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    result = await db.employees.delete_one({"id": employee_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")
    return {"message": "Служителят е изтрит"}

@api_router.post("/payroll/preview")
async def preview_payroll(entry: PayrollEntryCreate, current_user: User = Depends(get_current_user)):
    """Изчислява разбивка без да записва - за преглед преди потвърждение."""
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    employee = await db.employees.find_one({"id": entry.employee_id, **scope}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")

    rates = await get_payroll_rates_dict(company_id)

    base_amount = entry.net_target if employee["agreement_type"] == "net" and entry.net_target is not None else (entry.gross_amount if entry.gross_amount is not None else employee["base_salary"])

    return calculate_payroll(
        base_amount=base_amount,
        agreement_type=employee["agreement_type"],
        rates=rates,
        bonus_amount=entry.bonus_amount,
        food_vouchers=employee.get("food_vouchers", 0),
        additional_insurance=employee.get("additional_insurance", 0),
    )

@api_router.post("/payroll")
async def create_payroll_entry(entry: PayrollEntryCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    employee = await db.employees.find_one({"id": entry.employee_id, **scope}, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")

    rates = await get_payroll_rates_dict(company_id)

    base_amount = entry.net_target if employee["agreement_type"] == "net" and entry.net_target is not None else (entry.gross_amount if entry.gross_amount is not None else employee["base_salary"])

    breakdown = calculate_payroll(
        base_amount=base_amount,
        agreement_type=employee["agreement_type"],
        rates=rates,
        bonus_amount=entry.bonus_amount,
        food_vouchers=employee.get("food_vouchers", 0),
        additional_insurance=employee.get("additional_insurance", 0),
    )

    existing = await db.payroll_entries.find_one({
        "employee_id": entry.employee_id,
        "period_month": entry.period_month,
        "period_year": entry.period_year,
    })
    if existing:
        raise HTTPException(status_code=409, detail="Вече има ведомост за този служител за този месец")

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": current_user.user_id,
        "company_id": company_id,
        "employee_id": entry.employee_id,
        "employee_name": employee["name"],
        "period_month": entry.period_month,
        "period_year": entry.period_year,
        "bonus_amount": round(entry.bonus_amount, 2),
        "notes": entry.notes,
        "image_base64": entry.image_base64,
        "created_at": datetime.now(timezone.utc),
        **breakdown,
    }
    await db.payroll_entries.insert_one(doc)

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="create",
        entity_type="payroll",
        entity_id=doc["id"],
        company_id=company_id,
        details={"employee": employee["name"], "period": f"{entry.period_month}/{entry.period_year}", "total_employer_cost": breakdown["total_employer_cost"]}
    )

    doc.pop("_id", None)
    doc.pop("image_base64", None)
    return doc

@api_router.get("/payroll")
async def get_payroll_entries(
    year: Optional[int] = None,
    month: Optional[int] = None,
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None

    query = {"company_id": company_id} if company_id else {"user_id": current_user.user_id}
    if year:
        query["period_year"] = year
    if month:
        query["period_month"] = month

    entries = await db.payroll_entries.find(query, {"_id": 0, "image_base64": 0}).sort([("period_year", -1), ("period_month", -1)]).to_list(1000)
    return entries

@api_router.delete("/payroll/{entry_id}")
async def delete_payroll_entry(entry_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    result = await db.payroll_entries.delete_one({"id": entry_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Записът не е намерен")
    return {"message": "Записът е изтрит"}

async def get_payroll_cost_for_period(company_id: Optional[str], user_id: str, start_date: Optional[str], end_date: Optional[str]) -> float:
    """Сумира total_employer_cost на всички ведомостни записи, чийто месец
    попада в зададения период - използвано в /statistics/summary и в
    прогнозата за разходи, за да включат реалния разход за персонал."""
    query = {"company_id": company_id} if company_id else {"user_id": user_id}
    entries = await db.payroll_entries.find(query, {"_id": 0, "period_month": 1, "period_year": 1, "total_employer_cost": 1}).to_list(10000)

    total = 0.0
    for e in entries:
        period_date = f"{e['period_year']}-{e['period_month']:02d}-01"
        if start_date and period_date < start_date[:10]:
            continue
        if end_date and period_date > end_date[:10]:
            continue
        total += e.get("total_employer_cost", 0)
    return total

# ===================== FIXED ASSETS / ДЪЛГОТРАЙНИ АКТИВИ (ДМА) =====================

class AssetCategory(str, Enum):
    CAT_I = "cat_i"       # Сгради, съоръжения, предавателни устройства
    CAT_II = "cat_ii"     # Машини, производствено оборудване, апаратура
    CAT_III = "cat_iii"   # Превозни средства (без леки автомобили), пътни настилки
    CAT_IV = "cat_iv"     # Компютри, периферни устройства, софтуер
    CAT_V = "cat_v"       # Леки автомобили
    CAT_VI = "cat_vi"     # Активи с ограничен срок на ползване по договор/закон
    CAT_VII = "cat_vii"   # Други амортизируеми активи

# Максимални годишни данъчни амортизационни норми по чл. 55 ЗКПО
ASSET_CATEGORY_INFO = {
    "cat_i": {"label": "Категория I – Сгради, съоръжения, предавателни устройства", "max_rate": 4.0},
    "cat_ii": {"label": "Категория II – Машини, производствено оборудване, апаратура", "max_rate": 30.0},
    "cat_iii": {"label": "Категория III – Превозни средства (без леки автомобили), пътни настилки", "max_rate": 10.0},
    "cat_iv": {"label": "Категория IV – Компютри, периферни устройства, софтуер", "max_rate": 50.0},
    "cat_v": {"label": "Категория V – Леки автомобили", "max_rate": 25.0},
    # Category VI's real legal cap is 100% / срока по договор или закон в
    # години - различен за всеки конкретен актив (напр. 2-годишен лиценз ->
    # 50%, 10-годишна концесия -> 10%), затова 33.33% тук е само предложен
    # ориентир (приема се 3-годишен срок), не наложен таван - виж validation
    # в create_asset/update_asset, което нарочно не го налага за тази категория.
    "cat_vi": {"label": "Категория VI – Активи с ограничен срок на ползване по договор/закон (нормата = 100% / срока в години)", "max_rate": 33.33},
    "cat_vii": {"label": "Категория VII – Други амортизируеми активи", "max_rate": 15.0},
}

# Праг на същественост за данъчен дълготраен материален актив по чл. 50 ЗКПО
# (700 лв., конвертирани към еврото по фиксирания курс 1.95583)
ASSET_LOW_VALUE_THRESHOLD_EUR = 357.93

class AssetStatus(str, Enum):
    ACTIVE = "active"
    FULLY_DEPRECIATED = "fully_depreciated"
    DISPOSED = "disposed"

class FixedAsset(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None
    inventory_number: str
    name: str
    category: AssetCategory
    acquisition_date: str   # YYYY-MM-DD, дата на придобиване
    in_service_date: str    # YYYY-MM-DD, дата на въвеждане в експлоатация
    acquisition_value: float
    annual_depreciation_rate_percent: float
    responsible_person: Optional[str] = None  # материално отговорно лице
    image_base64: Optional[str] = None
    notes: Optional[str] = None
    status: AssetStatus = AssetStatus.ACTIVE
    disposal_date: Optional[str] = None
    disposal_reason: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    monthly_depreciation: float = 0
    accumulated_depreciation: float = 0
    net_book_value: float = 0

class FixedAssetCreate(BaseModel):
    name: str
    category: AssetCategory
    acquisition_date: str
    in_service_date: str
    acquisition_value: float
    annual_depreciation_rate_percent: Optional[float] = None  # ако липсва, взима се максималната норма за категорията
    responsible_person: Optional[str] = None
    image_base64: Optional[str] = None
    notes: Optional[str] = None

class FixedAssetUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[AssetCategory] = None
    acquisition_date: Optional[str] = None
    in_service_date: Optional[str] = None
    acquisition_value: Optional[float] = None
    annual_depreciation_rate_percent: Optional[float] = None
    responsible_person: Optional[str] = None
    image_base64: Optional[str] = None
    notes: Optional[str] = None

class AssetDisposeRequest(BaseModel):
    disposal_date: str
    disposal_reason: Optional[str] = None

def _ym_add(year: int, month: int, delta: int) -> tuple:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1

def _ym_diff(y1: int, m1: int, y2: int, m2: int) -> int:
    return (y2 * 12 + m2) - (y1 * 12 + m1)

def get_asset_depreciation_start_ym(in_service_date: str) -> tuple:
    """Данъчната/счетоводната амортизация започва от началото на месеца,
    следващ месеца на въвеждане в експлоатация (чл. 58 ЗКПО)."""
    d = datetime.fromisoformat(in_service_date[:10])
    return _ym_add(d.year, d.month, 1)

def compute_asset_monthly_depreciation(acquisition_value: float, annual_rate_percent: float) -> float:
    return acquisition_value * (annual_rate_percent / 100) / 12

def get_asset_depreciation_for_month(asset: dict, year: int, month: int) -> float:
    """Линейна (равномерна) амортизация за конкретен месец, автоматично
    спряна при достигане на пълната стойност на актива или при бракуване."""
    start_y, start_m = get_asset_depreciation_start_ym(asset["in_service_date"])
    if (year, month) < (start_y, start_m):
        return 0.0
    if asset.get("status") == "disposed" and asset.get("disposal_date"):
        dd = datetime.fromisoformat(asset["disposal_date"][:10])
        if (year, month) > (dd.year, dd.month):
            return 0.0
    monthly = compute_asset_monthly_depreciation(asset["acquisition_value"], asset["annual_depreciation_rate_percent"])
    if monthly <= 0:
        return 0.0
    elapsed = _ym_diff(start_y, start_m, year, month) + 1
    accumulated_before = monthly * (elapsed - 1)
    if accumulated_before >= asset["acquisition_value"]:
        return 0.0
    remaining = asset["acquisition_value"] - accumulated_before
    return round(min(monthly, remaining), 2)

def get_asset_accumulated_depreciation(asset: dict, as_of_year: int, as_of_month: int) -> float:
    start_y, start_m = get_asset_depreciation_start_ym(asset["in_service_date"])
    if (as_of_year, as_of_month) < (start_y, start_m):
        return 0.0
    monthly = compute_asset_monthly_depreciation(asset["acquisition_value"], asset["annual_depreciation_rate_percent"])
    end_y, end_m = as_of_year, as_of_month
    if asset.get("status") == "disposed" and asset.get("disposal_date"):
        dd = datetime.fromisoformat(asset["disposal_date"][:10])
        if (dd.year, dd.month) < (end_y, end_m):
            end_y, end_m = dd.year, dd.month
    elapsed = max(0, _ym_diff(start_y, start_m, end_y, end_m) + 1)
    accumulated = monthly * elapsed
    return round(min(accumulated, asset["acquisition_value"]), 2)

def enrich_asset_with_depreciation(asset: dict) -> dict:
    now = datetime.now(timezone.utc)
    accumulated = get_asset_accumulated_depreciation(asset, now.year, now.month)
    net_book_value = round(asset["acquisition_value"] - accumulated, 2)
    asset["monthly_depreciation"] = round(compute_asset_monthly_depreciation(asset["acquisition_value"], asset["annual_depreciation_rate_percent"]), 2)
    asset["accumulated_depreciation"] = accumulated
    asset["net_book_value"] = net_book_value
    if asset.get("status") != "disposed" and net_book_value <= 0.005:
        asset["status"] = "fully_depreciated"
    return asset

async def next_asset_inventory_number(company_id: Optional[str], user_id: str) -> str:
    scope = company_id or f"user:{user_id}"
    counter_id = f"asset_{scope}"
    result = await db.counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return f"ДМА-{result['seq']:04d}"

@api_router.get("/assets/categories")
async def get_asset_categories(current_user: User = Depends(get_current_user)):
    return {
        "categories": [{"value": k, **v} for k, v in ASSET_CATEGORY_INFO.items()],
        "low_value_threshold": ASSET_LOW_VALUE_THRESHOLD_EUR,
    }

@api_router.post("/assets", response_model=FixedAsset)
async def create_asset(asset: FixedAssetCreate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None

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
        **asset.dict(exclude={"annual_depreciation_rate_percent"})
    )
    await db.assets.insert_one(asset_obj.dict())

    await audit_service.log_action(
        user_id=current_user.user_id,
        user_name=current_user.name,
        action="create",
        entity_type="asset",
        entity_id=asset_obj.id,
        company_id=company_id,
        details={"name": asset_obj.name, "inventory_number": inventory_number, "acquisition_value": asset_obj.acquisition_value}
    )

    return enrich_asset_with_depreciation(asset_obj.dict())

@api_router.get("/assets")
async def get_assets(status: Optional[str] = None, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None

    query = {"company_id": company_id} if company_id else {"user_id": current_user.user_id}
    assets = await db.assets.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    enriched = [enrich_asset_with_depreciation(a) for a in assets]
    if status:
        enriched = [a for a in enriched if a["status"] == status]
    return enriched

@api_router.get("/assets/summary")
async def get_assets_summary(current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1})
    company_id = user_doc.get("company_id") if user_doc else None

    query = {"company_id": company_id} if company_id else {"user_id": current_user.user_id}
    assets = await db.assets.find(query, {"_id": 0}).to_list(1000)
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

@api_router.put("/assets/{asset_id}", response_model=FixedAsset)
async def update_asset(asset_id: str, update: FixedAssetUpdate, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    existing = await db.assets.find_one({"id": asset_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Активът не е намерен")

    update_data = {k: v for k, v in update.dict().items() if v is not None}

    category = update_data.get("category", existing["category"])
    if "annual_depreciation_rate_percent" in update_data:
        category_info = ASSET_CATEGORY_INFO[category]
        if update_data["annual_depreciation_rate_percent"] > category_info["max_rate"] and category != "cat_vi":
            raise HTTPException(status_code=400, detail=f"Нормата не може да надвишава {category_info['max_rate']}% за {category_info['label']}")

    await db.assets.update_one({"id": asset_id, **scope}, {"$set": update_data})
    asset = await db.assets.find_one({"id": asset_id}, {"_id": 0})
    return enrich_asset_with_depreciation(asset)

@api_router.post("/assets/{asset_id}/dispose", response_model=FixedAsset)
async def dispose_asset(asset_id: str, request: AssetDisposeRequest, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    company_id, scope = await get_company_scope(current_user)
    existing = await db.assets.find_one({"id": asset_id, **scope}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Активът не е намерен")

    await db.assets.update_one(
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

    asset = await db.assets.find_one({"id": asset_id}, {"_id": 0})
    return enrich_asset_with_depreciation(asset)

@api_router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, current_user: User = Depends(get_current_user)):
    require_permission(current_user, "manage_budget")
    _, scope = await get_company_scope(current_user)
    result = await db.assets.delete_one({"id": asset_id, **scope})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Активът не е намерен")
    return {"message": "Активът е изтрит"}

async def get_depreciation_cost_for_period(company_id: Optional[str], user_id: str, start_date: Optional[str], end_date: Optional[str]) -> float:
    """Сумира амортизацията за всички активи, чиито месечни начисления
    попадат в зададения период - използвано в /statistics/summary и в
    прогнозата за разходи, аналогично на get_payroll_cost_for_period."""
    query = {"company_id": company_id} if company_id else {"user_id": user_id}
    assets = await db.assets.find(query, {"_id": 0}).to_list(10000)
    if not assets:
        return 0.0

    now = datetime.now(timezone.utc)
    total = 0.0
    for asset in assets:
        start_y, start_m = get_asset_depreciation_start_ym(asset["in_service_date"])
        if asset.get("status") == "disposed" and asset.get("disposal_date"):
            dd = datetime.fromisoformat(asset["disposal_date"][:10])
            end_y, end_m = dd.year, dd.month
        else:
            end_y, end_m = now.year, now.month

        y, m = start_y, start_m
        while (y, m) <= (end_y, end_m):
            month_key = f"{y}-{m:02d}-01"
            if start_date and month_key < start_date[:10]:
                y, m = _ym_add(y, m, 1)
                continue
            if end_date and month_key > end_date[:10]:
                break
            total += get_asset_depreciation_for_month(asset, y, m)
            y, m = _ym_add(y, m, 1)

    return round(total, 2)

# ===================== AUDIT LOG =====================

@api_router.get("/audit-logs")
async def get_audit_logs(
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user)
):
    """Get audit logs (Owner/Accountant only - see ROLE_PERMISSIONS)"""
    require_permission(current_user, "view_audit_log")
    user_doc = await db.users.find_one({"user_id": current_user.user_id}, {"_id": 0, "company_id": 1, "role": 1})
    company_id = user_doc.get("company_id") if user_doc else None
    
    logs = await audit_service.get_logs(
        company_id=company_id,
        action=action,
        entity_type=entity_type,
        limit=limit
    )
    
    return {"logs": logs}

# ===================== DATABASE INDEXES =====================

@app.on_event("startup")
async def create_indexes():
    """Create database indexes for performance"""
    try:
        # Invoices indexes
        await db.invoices.create_index([("company_id", 1), ("date", -1)])
        await db.invoices.create_index([("company_id", 1), ("supplier", 1)])
        await db.invoices.create_index([("user_id", 1), ("date", -1)])
        
        # Revenues indexes
        await db.daily_revenue.create_index([("company_id", 1), ("date", -1)])
        await db.daily_revenue.create_index([("user_id", 1), ("date", -1)])

        # Expenses indexes
        await db.expenses.create_index([("company_id", 1), ("date", -1)])
        await db.expenses.create_index([("user_id", 1), ("date", -1)])
        
        # Price history indexes
        await db.item_price_history.create_index([("company_id", 1), ("item_name", 1)])
        await db.item_price_history.create_index([("company_id", 1), ("supplier", 1)])
        
        # Users indexes
        await db.users.create_index([("email", 1)], unique=True, sparse=True)
        await db.users.create_index([("company_id", 1)])
        
        # Audit log index
        await db.audit_logs.create_index([("company_id", 1), ("created_at", -1)])
        
        logger.info("Database indexes created successfully")
    except Exception as e:
        logger.error(f"Error creating indexes: {e}")

# ===================== HEALTH CHECK =====================

@api_router.get("/")
async def root():
    return {"message": "Invoice Manager API", "status": "running"}

@api_router.get("/health")
async def health():
    return {"status": "healthy"}

# Include the router
app.include_router(api_router)

_cors_origins_env = os.environ.get("CORS_ORIGINS", "")
if _cors_origins_env:
    _cors_origins = [origin.strip() for origin in _cors_origins_env.split(",") if origin.strip()]
else:
    # Credentialed requests (cookies) can't use a wildcard origin per the CORS
    # spec - browsers silently reject the response. List explicit origins here,
    # or set CORS_ORIGINS (comma-separated) to override without a code change.
    _cors_origins = [
        "https://fakturaplus-frontend.onrender.com",
        "http://localhost:3000",
        "http://localhost:8081",
        "http://localhost:19006",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

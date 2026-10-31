from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Response, Request, BackgroundTasks
from fastapi.responses import StreamingResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, ValidationError
from typing import List, Optional, Dict, Any, Literal
from enum import Enum
import uuid
from datetime import datetime, timezone, timedelta, date
import base64
import httpx
import io
import re
import statistics
import json
import difflib
from passlib.context import CryptContext
import certifi
from anthropic import AsyncAnthropic
import anthropic as anthropic_sdk
import stripe

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

# Imported at module scope (not down with the other services/* imports
# further below) because PurchaseCustomRequest's Field(...) bounds, defined
# early in this file, need its constants to exist already at class-body
# evaluation time - unlike a plain function body, that isn't deferred to
# first call.
import services.scan_credit_service as scan_credit_service_module
from services.scan_credit_service import ScanCreditService

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Environment
IS_PRODUCTION = os.environ.get('ENVIRONMENT', 'development') == 'production'

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

# MongoDB connection. serverSelectionTimeoutMS caps how long any single
# operation waits to find a usable server - without it, the driver's
# 30s-per-attempt default means the ~12 sequential index-creation calls in
# create_indexes() below can take minutes to fail if the database is
# unreachable at startup, which blocks the port binding that Render (and
# any other host) waits on to consider the deploy alive.
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
# Explicit generic parameter (as a STRING annotation - the installed
# motor version's AsyncIOMotorClient isn't actually subscriptable at
# runtime despite its .pyi stub declaring it generic, so a real
# `AsyncIOMotorClient[Dict[str, Any]]` expression here would raise
# TypeError on import; a string annotation is read by mypy but never
# evaluated by Python). Without this, mypy can't infer _DocumentType
# from this call and silently falls back to treating every
# db.<collection>.find_one/find/etc. result as None - the single
# largest source of noise in this file's type-check output.
client: "AsyncIOMotorClient[Dict[str, Any]]" = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=5000)
db = client[os.environ.get('DB_NAME', 'test_database')]

# AI features (OCR scanning, AI item merge, AI ROI insights) run on the
# Anthropic API directly. Disabled automatically when no key is configured
# (e.g. a fresh deploy before the Render env var is set), so the rest of the
# app keeps working without them.
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
AI_FEATURES_ENABLED = bool(ANTHROPIC_API_KEY)
anthropic_client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY) if AI_FEATURES_ENABLED else None

# Outgoing email (password-reset codes) via Resend's REST API. Same
# disabled-until-configured pattern as the AI features above - the rest of
# the app, including registration/login, works without it.
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
RESEND_FROM_EMAIL = os.environ.get('RESEND_FROM_EMAIL', 'Фактура+ <onboarding@resend.dev>')
EMAIL_FEATURES_ENABLED = bool(RESEND_API_KEY)

# Developer/product-owner account - not a per-company role, this is who can
# read the in-app feedback inbox (see /feedback below) before the app has
# its own support domain/inbox to forward it to instead.
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'mitkosml@gmail.com')

# Stripe (scan-credit purchases, see SCAN CREDITS below). Same
# disabled-until-configured pattern as the AI/email features above - the
# purchase/auto-reload endpoints return a clear 503 instead of crashing
# until both keys are set on the deploy. STRIPE_WEBHOOK_SECRET is what lets
# /webhooks/stripe cryptographically verify that a request claiming "this
# payment succeeded" really came from Stripe and wasn't forged by a client -
# without it, balance credits would be impossible to secure.
STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '')
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET', '')
BILLING_ENABLED = bool(STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET)
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

# Temporary pause switch for the scan-credit paywall, set via a Render env
# var - not a per-company setting, since this is meant for "I'm between
# billing setups, let everyone scan for free for now" rather than an
# ongoing per-customer discount. While off, /ocr/scan neither blocks on an
# empty balance nor deducts a scan, so turning it back on later resumes
# exactly where the balance was left, instead of having silently drained it
# to a large negative number the whole time it was off.
SCAN_CREDITS_ENFORCED = os.environ.get('SCAN_CREDITS_ENFORCED', 'true').strip().lower() != 'false'

async def send_email(to_email: str, subject: str, html_body: str) -> bool:
    if not EMAIL_FEATURES_ENABLED:
        return False
    try:
        async with httpx.AsyncClient() as client_http:
            resp = await client_http.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                json={"from": RESEND_FROM_EMAIL, "to": [to_email], "subject": subject, "html": html_body},
                timeout=10.0,
            )
            if resp.status_code >= 300:
                logger.error(f"Resend API error {resp.status_code}: {resp.text}")
                return False
            return True
    except Exception as e:
        logger.error(f"Failed to send email via Resend: {e}")
        return False

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup - calls resolved at runtime (the module finishes executing,
    # defining each of these, well before the ASGI server ever fires this
    # event), in the same order the old @app.on_event("startup") handlers
    # below used to register in.
    await start_proactive_digest_loop()
    await start_calendar_reminder_loop()
    await start_budget_alert_loop()
    await start_notification_settings_loop()
    await start_scan_credit_depletion_loop()
    await create_indexes()
    yield
    # Shutdown
    await shutdown_db_client()

# Create the main app
app = FastAPI(
    title="Invoice Manager API",
    version="1.0.0",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    lifespan=lifespan,
)

# Add rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]  # slowapi's documented handler; Starlette's stub wants Callable[[Request, Exception], ...]

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
    # Дни от седмицата, в които фирмата обичайно е затворена (0=понеделник
    # ... 6=неделя, Python date.weekday() конвенция) - изключват се от
    # статистиките за среден дневен оборот вместо да се броят за дни с
    # нулев оборот. None/липсващо поле = не е конфигурирано (нищо не се
    # изключва), за да не променя поведението на вече съществуващи фирми.
    closed_weekdays: Optional[List[int]] = None
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
    closed_weekdays: Optional[List[int]] = None

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
    closed_weekdays: Optional[List[int]] = None

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
    invitation_code: Optional[str] = None

class UserLogin(BaseModel):
    email: str
    password: str

class ChangePassword(BaseModel):
    current_password: Optional[str] = None  # Не се изисква, ако акаунтът все още няма парола (напр. Google вход)
    new_password: str

class UpdatePictureRequest(BaseModel):
    picture: Optional[str] = None  # data: URI base64, same convention as invoice/asset/payroll images - null clears it

class PasswordResetCode(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    code: str = Field(default_factory=lambda: uuid.uuid4().hex[:8].upper())
    used: bool = False
    expires_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc) + timedelta(minutes=30))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    email: str
    code: str
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
    image_base64: Optional[str] = None  # Legacy - фактури, сканирани преди многостраничната поддръжка
    image_base64s: Optional[List[str]] = None  # Всички страници на сканираната фактура, по ред
    notes: Optional[str] = None
    items: Optional[List[dict]] = None  # Списък с артикули
    # Плащане към доставчика - незададено (None) означава "не се следи",
    # за да не се третират стари фактури (преди тази функционалност) като
    # неплатени по подразбиране.
    payment_method: Optional[str] = None  # cash | bank_transfer
    is_paid: bool = False
    # Кумулативна платена сума към момента - "напълно платена" означава
    # paid_amount >= total_amount (is_paid се извежда от това, не обратното).
    # Позволява частично плащане на едра фактура на няколко вноски.
    paid_amount: float = 0.0
    payment_due_date: Optional[datetime] = None  # само при bank_transfer
    paid_at: Optional[datetime] = None
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
    quantity: float = Field(default=1, gt=0)
    unit: str = "бр."
    # Negative is legitimate here - a discount/rebate line ("отстъпка")
    # printed as its own row on the invoice is a real, common pattern, not
    # a bad OCR read; total_price/vat_amount below follow the same sign
    # when computed from it (quantity * a negative unit_price).
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
    # A %-only threshold fires the same for a 0.10 lv item as for a 500 lv
    # one - this absolute floor (in the invoice's currency) filters out
    # changes that cross the % threshold but are financially noise.
    min_absolute_change: float = 2.0
    # Price *drops* are also useful (renegotiate elsewhere, switch item) -
    # off by default so existing companies' alert volume doesn't change
    # until they opt in.
    alert_on_decrease: bool = False
    enabled: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class PriceAlert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    item_name: str
    supplier: str
    old_price: float  # Базова цена (медиана/средно от последните покупки) - виж baseline_purchase_count
    new_price: float
    change_percent: float
    direction: str = "increase"  # increase | decrease
    # How many prior purchases the baseline (old_price) was computed from -
    # shown to the user so a one-off anomaly isn't silently treated as "the
    # real price" without any indication of where the number came from.
    baseline_purchase_count: int = 1
    invoice_id: str
    invoice_number: str
    status: str = "unread"  # unread, read, dismissed
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Lets a company say "stop alerting me about this item from this supplier"
# permanently, for items whose price is known to fluctuate normally (fuel,
# produce) instead of being forced to re-dismiss the same noisy alert
# forever.
class PriceAlertMute(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    item_name: str  # Нормализирано име (както се пази в item_price_history)
    supplier: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class InvoiceCreate(BaseModel):
    supplier: str
    supplier_eik: Optional[str] = None
    invoice_number: str
    amount_without_vat: float = Field(ge=0)
    vat_amount: float = Field(ge=0)
    total_amount: float = Field(ge=0)
    vat_treatment: Optional[VatTreatment] = None
    date: str
    image_base64: Optional[str] = None  # Legacy - едностранично сканиране
    image_base64s: Optional[List[str]] = None  # Всички страници на сканираната фактура, по ред
    notes: Optional[str] = None
    items: Optional[List[InvoiceItemCreate]] = None  # Артикули
    payment_method: Optional[str] = None  # cash | bank_transfer
    payment_due_date: Optional[str] = None  # само при bank_transfer; ако липсва се изчислява

class InvoiceUpdate(BaseModel):
    supplier: Optional[str] = None
    supplier_eik: Optional[str] = None
    invoice_number: Optional[str] = None
    amount_without_vat: Optional[float] = Field(default=None, ge=0)
    vat_amount: Optional[float] = Field(default=None, ge=0)
    total_amount: Optional[float] = Field(default=None, ge=0)
    vat_treatment: Optional[VatTreatment] = None
    protocol_number: Optional[str] = None
    date: Optional[str] = None
    notes: Optional[str] = None
    payment_method: Optional[str] = None
    payment_due_date: Optional[str] = None
    is_paid: Optional[bool] = None
    paid_amount: Optional[float] = Field(default=None, ge=0)

class DailyRevenue(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None
    date: str
    fiscal_revenue: float = 0
    pocket_money: float = 0  # "джобче" - не влиза в ДДС
    card_revenue: float = 0  # Частта от fiscal_revenue, платена с карта (остатъкът се приема за в брой)
    vat_rate_percent: float = 20.0  # Ставката на фискализирания оборот (20% стандартна, 9% намалена, 0%)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DailyRevenueCreate(BaseModel):
    date: str
    fiscal_revenue: float = Field(default=0, ge=0)
    pocket_money: float = Field(default=0, ge=0)
    card_revenue: float = Field(default=0, ge=0)
    vat_rate_percent: float = Field(default=20.0, ge=0, le=100)

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
    amount: float = Field(gt=0)
    date: str

class NonInvoiceExpenseUpdate(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = Field(default=None, gt=0)
    date: Optional[str] = None

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
    amount: float = Field(gt=0)
    description: str
    expense_type: str = "recurring"
    category: str = "other"
    period_month: int = Field(ge=1, le=12)
    period_year: int
    supplier_id: Optional[str] = None
    project_name: Optional[str] = None
    notes: Optional[str] = None

class PersonalWalletCategory(str, Enum):
    LOAN = "loan"                  # Кредит
    LEASE = "lease"                # Лизинг
    UTILITY = "utility"            # Комунални
    INSURANCE = "insurance"        # Застраховка
    SUBSCRIPTION = "subscription"  # Абонамент
    DAILY = "daily"                # Ежедневни
    ONE_OFF = "one_off"            # Еднократно

class PersonalWalletEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: str
    category: PersonalWalletCategory
    description: str
    amount: float
    date: str
    is_recurring: bool = False
    next_due_date: Optional[str] = None
    # Term end for a recurring obligation (lease/contract/subscription expiry) -
    # once past, the entry stops being surfaced as an upcoming due payment
    # (see /personal-wallet/summary) instead of nagging forever after the
    # underlying contract has actually ended.
    recurring_until: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None

class PersonalWalletEntryCreate(BaseModel):
    category: PersonalWalletCategory
    description: str
    amount: float = Field(gt=0)
    date: str
    is_recurring: bool = False
    next_due_date: Optional[str] = None
    recurring_until: Optional[str] = None
    notes: Optional[str] = None

class PersonalWalletEntryUpdate(BaseModel):
    category: Optional[PersonalWalletCategory] = None
    description: Optional[str] = None
    amount: Optional[float] = Field(default=None, gt=0)
    date: Optional[str] = None
    is_recurring: Optional[bool] = None
    next_due_date: Optional[str] = None
    recurring_until: Optional[str] = None
    notes: Optional[str] = None

class PersonalWalletSettingsUpdate(BaseModel):
    alert_threshold_percent: float = Field(gt=0, le=200)

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
    # Dedup state for the background checks below - never set by the
    # client, only by _notification_settings_tick (and reset by
    # update_notification_settings when the threshold itself changes).
    vat_threshold_sent_at: Optional[datetime] = None
    periodic_last_sent_date: Optional[str] = None  # "YYYY-MM-DD"
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
    payment_due_date: Optional[str] = None  # Срок за плащане, ако е отпечатан на фактурата
    items: List[OCRItemResult] = []  # Разпознати продукти от таблицата с артикули
    corrections: Optional[List[str]] = None  # Списък с направени корекции
    confidence: Optional[float] = None  # Увереност в резултата (0-1)

# ===================== AUTH HELPERS =====================

VALID_ROLES = {"owner", "manager", "staff", "accountant"}

CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "x-csrf-token"
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

def set_session_cookies(response: Response, session_token: str) -> str:
    """Sets both halves of the session: the httponly session_token cookie
    (as before) plus a second, JS-readable csrf_token cookie the web
    frontend echoes back as a header on state-changing requests - a
    double-submit CSRF defense, needed specifically because samesite="none"
    (required for the cross-origin frontend/backend split) gives up the
    browser's own default CSRF protection. Returns the csrf token so a
    caller that also needs it (none today) can reuse it without re-reading
    the cookie."""
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=SESSION_MAX_AGE_SECONDS,
        path="/"
    )
    csrf_token = uuid.uuid4().hex
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        httponly=False,  # the frontend must be able to read this one
        secure=True,
        samesite="none",
        max_age=SESSION_MAX_AGE_SECONDS,
        path="/"
    )
    return csrf_token

def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(key="session_token", path="/")
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/")

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
    never an empty one that would silently strip a legacy owner's access.

    Two backfill rules on top of the "empty -> role default" one above:
    - The owner's permission set is never partially configurable (see
      ROLE_PERMISSIONS/ROLE_CONFIGURABLE_PERMISSIONS above), so an owner
      document always gets the FULL current owner set force-unioned in -
      this is what makes newly added permission strings (like the four
      view_* sensitive-data ones) reach every owner account automatically,
      including ones created long before those strings existed.
    - A non-owner's stored permissions are trusted completely once their
      permissions_schema_version reaches PERMISSIONS_SCHEMA_VERSION - which
      update_user_role stamps on every explicit checklist save. Below that
      version, this account's permissions predate whatever was added at a
      later version (see _PERMISSIONS_ADDED_AT_VERSION), so this role's
      default set for each version this account hasn't reached yet is
      unioned in (read-time only, never persisted) until the owner's next
      real edit stamps the current version. This can't be told apart from
      "an explicit save that deliberately unticked those permissions" by
      inspecting the stored list alone - so the version stamp, not the
      list's content, is what carries that distinction."""
    user_doc = dict(user_doc)
    user_doc["has_password"] = bool(user_doc.get("password_hash"))
    user_doc.pop("password_hash", None)
    role = user_doc.get("role", "staff")
    if not user_doc.get("permissions"):
        user_doc["permissions"] = resolve_permissions(role, None)
    elif role == "owner":
        user_doc["permissions"] = sorted(set(user_doc["permissions"]) | ROLE_PERMISSIONS.get("owner", set()))
    else:
        stamped_version = user_doc.get("permissions_schema_version", 1)
        if stamped_version < PERMISSIONS_SCHEMA_VERSION:
            defaults = set()
            for version, added in _PERMISSIONS_ADDED_AT_VERSION.items():
                if stamped_version < version:
                    defaults |= ROLE_PERMISSIONS.get(role, set()) & added
            user_doc["permissions"] = sorted(set(user_doc["permissions"]) | defaults)
    return user_doc

def simple_scope_query(company_id: Optional[str], user_id: str, **extra) -> dict:
    """Shared shape for the budget/employees/assets/items endpoints: scope
    to the whole company when there is one, else fall back to just this
    user's own records. Unlike get_company_scope(), this doesn't also
    pull in legacy null-company_id records from other teammates - these
    collections were all added after company_id scoping already existed,
    so there's no such legacy data for them to miss."""
    query = {"company_id": company_id} if company_id else {"user_id": user_id}
    query.update(extra)
    return query

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

    return company_id, await company_data_scope(company_id)

async def company_data_scope(company_id: str) -> dict:
    """The company-wide half of get_company_scope's filter, usable from
    background tasks that only have a company_id (no logged-in User) - the
    budget-alert tick below is the first such caller."""
    member_docs = await db.users.find({"company_id": company_id}, {"_id": 0, "user_id": 1}).to_list(1000)
    member_ids = [m["user_id"] for m in member_docs]
    return {
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
# The four view_* entries below are a second, orthogonal layer: they don't
# gate a feature/screen, they gate individual SENSITIVE DATA FIELDS inside
# the statistics a role already has view_statistics for (pocket money,
# no-invoice/off-book expenses, profit, personal investments/ROI). Hiding
# one of these from a member doesn't just blank a line in the UI - every
# aggregate that would otherwise include it (total income, total expense,
# profit, the daily charts...) is recomputed server-side as if that field
# were zero, so the member sees a fully coherent analytical picture that
# matches exactly what they're allowed to see. See get_financial_visibility.
ROLE_PERMISSIONS = {
    "owner": {
        "manage_users", "manage_company", "view_audit_log", "manage_budget",
        "export_data", "view_statistics", "manage_invoices", "add_revenue", "add_expenses",
        "view_pocket_money", "view_off_book_expenses", "view_profit", "view_personal_investments",
        "team_collaboration", "manage_billing", "restore_deleted_data",
        "view_personal_wallet", "add_personal_wallet_entries", "manage_personal_wallet",
    },
    "manager": {
        "manage_budget", "export_data", "view_statistics", "manage_invoices",
        "add_revenue", "add_expenses",
        # Not view_personal_investments - a manager enters revenue/expenses
        # themselves but has no stake in the owner's personal investments.
        "view_pocket_money", "view_off_book_expenses", "view_profit",
        "team_collaboration",
    },
    "staff": {
        "manage_invoices", "add_revenue", "add_expenses",
        "view_pocket_money", "view_off_book_expenses",
        # Deliberately no team_collaboration by default - the shared
        # calendar/messages feature is meant for owner/manager/accountant
        # coordination, not day-to-day staff use. Still grantable per-user
        # via the configurable ceiling below, same as every other permission.
    },
    "accountant": {
        "view_audit_log", "manage_budget", "export_data", "view_statistics", "manage_invoices",
        # Profit only: an accountant's typical job is exactly this figure,
        # computed correctly, without needing the pocket-money/off-book
        # line items themselves or the owner's personal investments.
        "view_profit",
        "team_collaboration",
    },
}

_STAFF_LIKE_CONFIGURABLE = {
    "view_audit_log", "manage_budget", "export_data", "view_statistics",
    "manage_invoices", "add_revenue", "add_expenses",
    "view_pocket_money", "view_off_book_expenses", "view_profit", "view_personal_investments",
    "team_collaboration", "restore_deleted_data",
    "view_personal_wallet", "add_personal_wallet_entries", "manage_personal_wallet",
}

# The four sensitive-data-field permissions, used by sanitize_user's
# migration heuristic (see its docstring) to compute a legacy account's
# read-time backfill defaults.
_SENSITIVE_FIELD_PERMISSIONS = {
    "view_pocket_money", "view_off_book_expenses", "view_profit", "view_personal_investments",
}

# Bumped whenever ROLE_PERMISSIONS gains a new configurable entry that needs
# a read-time migration for pre-existing accounts. A user doc's own
# permissions_schema_version (stamped by update_user_role on every explicit
# checklist save, see sanitize_user's docstring for why a stamp - not just
# inspecting the stored list - is the only way to tell "never touched since
# this version" apart from "deliberately configured to have none of the new
# permissions").
PERMISSIONS_SCHEMA_VERSION = 5

# Permissions introduced after PERMISSIONS_SCHEMA_VERSION 1, keyed by the
# version that added them - see sanitize_user's migration branch below,
# which unions in every entry whose key exceeds a legacy account's stamped
# version. Kept separate from _SENSITIVE_FIELD_PERMISSIONS since that set
# has its own, unrelated (field-visibility) meaning.
_PERMISSIONS_ADDED_AT_VERSION = {
    2: _SENSITIVE_FIELD_PERMISSIONS,
    3: {"team_collaboration"},
    4: {"restore_deleted_data"},
    5: {"view_personal_wallet", "add_personal_wallet_entries", "manage_personal_wallet"},
}

ROLE_CONFIGURABLE_PERMISSIONS = {
    "manager": _STAFF_LIKE_CONFIGURABLE,
    "staff": _STAFF_LIKE_CONFIGURABLE,
    # Deliberately narrow - see the accountant note in ROLE_PERMISSIONS above.
    "accountant": {
        "view_audit_log", "manage_budget", "export_data", "view_statistics", "manage_invoices",
        "view_pocket_money", "view_off_book_expenses", "view_profit", "view_personal_investments",
        "team_collaboration", "restore_deleted_data",
        "view_personal_wallet", "add_personal_wallet_entries", "manage_personal_wallet",
    },
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

def get_financial_visibility(current_user: User) -> dict:
    """Which of the four sensitive financial data fields this viewer may
    see. Used both to decide what get_summary/get_chart_data return raw AND
    to decide what to fold into their derived totals (income, expense,
    profit, the daily charts) - a hidden field is zeroed out of every
    aggregate that would otherwise include it, not just blanked in the UI,
    so the viewer gets a fully coherent analytical picture for the data
    they're actually allowed to see."""
    granted = set(current_user.permissions or [])
    return {
        "pocket_money": "view_pocket_money" in granted,
        "off_book_expenses": "view_off_book_expenses" in granted,
        "profit": "view_profit" in granted,
        "personal_investments": "view_personal_investments" in granted,
    }

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

async def company_has_other_members(company_id: str, excluding_user_id: str) -> bool:
    """Whether anyone besides excluding_user_id currently has this company
    as their active one. Used to let a solo owner (e.g. of the throwaway
    company auto-created on registration, before they ever invited or were
    invited by anyone) leave it or switch away freely - the "transfer
    ownership first" rule only matters when leaving would actually strand
    someone else in a company with no owner."""
    other = await db.users.find_one(
        {"company_id": company_id, "user_id": {"$ne": excluding_user_id}}, {"_id": 0, "user_id": 1}
    )
    return other is not None

# A ООД (multi-owner company) support: stripping someone's owner status -
# whether by removing them outright or demoting their role - is never a
# single owner's unilateral call. It always goes through owner_actions
# below, which requires every OTHER current owner (never the target, never
# just the requester alone) to approve before it takes effect. This is the
# most protective rule that still lets a company actually function: with 3+
# owners, a bad-faith owner can't be outvoted by just one accomplice, but
# can't block their own removal either since they're excluded from the
# approver set; with exactly 2 owners there IS no independent third
# approver, so the request is refused outright rather than silently
# auto-approving on the requester's own say-so - a two-partner disagreement
# has to be resolved between the two of them (one leaving voluntarily, or
# bringing in a third owner first), not settled by whoever clicks first.
async def get_company_owners(company_id: str) -> List[dict]:
    return await db.users.find(
        {"company_id": company_id, "role": "owner"}, {"_id": 0, "user_id": 1, "name": 1}
    ).to_list(100)

async def request_owner_status_change(company_id: str, target_user: dict, requested_by: User, action: str) -> dict:
    """Queues removing/demoting an owner for the other owners' approval.
    `action` is "remove" or the role string being demoted to. Only call
    this when target_user's role is currently "owner". Raises HTTPException
    if there aren't enough independent owners to authorize it at all."""
    owners = await get_company_owners(company_id)
    target_id = target_user["user_id"]

    if len(owners) <= 1:
        raise HTTPException(status_code=400, detail="Не можете да премахнете единствения собственик на фирмата.")

    required_approver_ids = [o["user_id"] for o in owners if o["user_id"] not in (target_id, requested_by.user_id)]
    if not required_approver_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                f"При двама собственици премахването на съдружник изисква взаимно съгласие - "
                f"{target_user.get('name', 'другият собственик')} трябва сам да напусне доброволно, "
                f"или добавете трети собственик, чието независимо одобрение да разреши въпроса."
            ),
        )

    action_doc = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "target_user_id": target_id,
        "target_name": target_user.get("name", ""),
        "action": action,
        "requested_by": requested_by.user_id,
        "requested_by_name": requested_by.name,
        "required_approver_ids": required_approver_ids,
        "approved_by": [requested_by.user_id],
        "status": "pending",
        "created_at": datetime.now(timezone.utc),
        "resolved_at": None,
    }
    await db.owner_actions.insert_one(dict(action_doc))
    action_doc.pop("_id", None)
    return action_doc

async def execute_owner_action(action: dict, executed_by: Optional[User] = None):
    target_before: Optional[Dict[str, Any]] = await db.users.find_one({"user_id": action["target_user_id"]}, {"_id": 0})

    if action["action"] == "remove":
        new_role = "staff"
        permissions = resolve_permissions("staff", None)
        await db.users.update_one(
            {"user_id": action["target_user_id"]},
            {"$unset": {"company_id": ""}, "$set": {"role": new_role, "permissions": permissions}}
        )
    else:
        new_role = action["action"]
        permissions = resolve_permissions(new_role, None)
        await db.users.update_one(
            {"user_id": action["target_user_id"]},
            {"$set": {"role": new_role, "permissions": permissions, "permissions_schema_version": PERMISSIONS_SCHEMA_VERSION}}
        )
        await ensure_membership(action["target_user_id"], action["company_id"], new_role, permissions)

    # This is a multi-owner-approved change to another owner's role/access -
    # exactly the kind of action the audit log must never be silent about.
    # The acting identity is whichever owner's approval completed the
    # required sign-off; the full approval chain goes in details.
    await audit_service.log_action(
        user_id=executed_by.user_id if executed_by else action["requested_by"],
        user_name=executed_by.name if executed_by else action.get("requested_by_name", ""),
        action="update_role",
        entity_type="user",
        entity_id=action["target_user_id"],
        company_id=action["company_id"],
        details={
            "target_name": action.get("target_name") or (target_before or {}).get("name"),
            "old_role": (target_before or {}).get("role"),
            "new_role": new_role,
            "via": "owner_action_approval",
            "requested_by_name": action.get("requested_by_name"),
            "approved_by": action.get("approved_by", []),
        },
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









# ===================== OWNER ACTIONS (multi-owner removal safeguard) =====================




# ===================== INVITATION ENDPOINTS =====================





# ===================== MULTI-COMPANY ACCESS (ACCOUNTANT SWITCHER) =====================




# ===================== NOTIFICATION SETTINGS ENDPOINTS =====================



# ===================== COMPANY ENDPOINTS =====================





# (/company/users used to duplicate /auth/users here - removed; /auth/users
# is the one the frontend actually calls, and it also merges in accountant
# memberships, which this one never did.)

# ===================== CLOSED DAYS (weekly pattern + one-off exceptions) =====================
# Company.closed_weekdays above holds the RECURRING pattern (e.g. "always
# closed on Sunday"). This section adds per-date OVERRIDES on top of it: an
# extra one-off closure (a holiday, an unplanned closure) with closed=True,
# or a reopening of an otherwise-closed weekday (e.g. open this one Sunday
# before a holiday rush) with closed=False. An exception always wins over
# the weekly pattern for its own date.

class ClosedDateException(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    date: str  # YYYY-MM-DD
    closed: bool
    label: Optional[str] = None  # напр. "Великден", "Ремонт"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ClosedDateExceptionUpsert(BaseModel):
    date: str
    closed: bool
    label: Optional[str] = None

def is_date_closed(date_str: str, closed_weekdays: set, exceptions_map: dict) -> bool:
    """date_str is YYYY-MM-DD. An exception for this exact date always wins;
    otherwise falls back to the recurring weekly pattern."""
    if date_str in exceptions_map:
        return exceptions_map[date_str]
    weekday = datetime.strptime(date_str, "%Y-%m-%d").weekday()
    return weekday in closed_weekdays

async def get_closed_days_lookup(company_id: Optional[str]) -> tuple:
    """Returns (closed_weekdays set, {date_str: closed bool} exceptions map)
    for a company, ready to pass into is_date_closed for every date in a
    range without re-querying per date."""
    if not company_id:
        return set(), {}
    company = await db.companies.find_one({"id": company_id}, {"_id": 0, "closed_weekdays": 1})
    closed_weekdays: set[int] = set(company.get("closed_weekdays") or []) if company else set()
    exceptions = await db.closed_date_exceptions.find(
        {"company_id": company_id}, {"_id": 0, "date": 1, "closed": 1}
    ).to_list(2000)
    exceptions_map = {e["date"]: e["closed"] for e in exceptions}
    return closed_weekdays, exceptions_map





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

def fix_ocr_letter_errors(value: str) -> str:
    """Замества букви, лесно объркваеми с цифри при OCR (без да маха
    останалите символи - ползва се и за дати, където разделителите
    -./ трябва да оцелеят)."""
    if not value:
        return value

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
    return result

def fix_ocr_number_errors(value: str) -> str:
    """Поправя типични OCR грешки в числа и маха всичко освен цифри и
    точка - само за суми, НЕ за дати (виж normalize_date, който ползва
    fix_ocr_letter_errors директно, за да запази разделителите -./)."""
    if not value:
        return value
    result = fix_ocr_letter_errors(value)
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

    # Поправка на OCR грешки в числата (само буква->цифра, БЕЗ да маха
    # разделителите -./, за разлика от fix_ocr_number_errors)
    date_str = fix_ocr_letter_errors(date_str)

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

    # 3б. Корекция на срок за плащане (ако е разпознат на фактурата)
    if data.get("payment_due_date"):
        normalized_due_date = normalize_date(str(data["payment_due_date"]))
        if normalized_due_date and normalized_due_date != data.get("payment_due_date"):
            corrected["payment_due_date"] = normalized_due_date
            corrections.append(f"Срок за плащане нормализиран: '{data['payment_due_date']}' → '{normalized_due_date}'")

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

        # НЕ приемаме vat_amount == 0 и total_amount == amount_without_vat за
        # грешка на OCR - това е точно вярното четене за фактура с 0%
        # ставка, освободена доставка или обратно начисляване. Добавянето
        # на фалшиво 20% ДДС тук би подвело потребителя за легитимно
        # освободена покупка.

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
    payment_due_date: Optional[str] = Field(default=None, description="Срок/падеж за плащане, формат YYYY-MM-DD, само ако е изрично отпечатан на фактурата")
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

СРОК ЗА ПЛАЩАНЕ (payment_due_date):
Много фактури печатат изрично срока/падежа за плащане - текст като "Срок за плащане", "Падеж", "Платимо до", "Дата на падеж", "Due date". Ако видиш такава изрична дата, върни я в payment_due_date (YYYY-MM-DD). Ако вместо дата е отпечатан само брой дни (напр. "Срок за плащане: 14 дни от датата на издаване"), изчисли конкретната дата спрямо датата на издаване на фактурата. Ако на фактурата изобщо няма отпечатан срок или брой дни за плащане, остави payment_due_date празно (null) - НЕ гадай и НЕ прилагай стандартен срок по подразбиране, това ще бъде направено от приложението само ако полето остане празно.

ОБЩИ ПРАВИЛА:
- Всички суми в полетата на артикулите и amount_without_vat са БЕЗ ДДС.
- ДДС в България обикновено е 20%.
- Датата винаги във формат YYYY-MM-DD.
- Ако дадена стойност наистина не може да се прочете - остави я празна ("" за текст, 0 за число, null за дата), но НЕ измисляй данни, които не се виждат на изображението.
- Разпознавай възможно най-много от вариациите в изписването (главни/малки букви, съкращения на правни форми, различно разположение на текста).

МНОГОСТРАНИЧНИ ФАКТУРИ:
Понякога ще получиш НЯКОЛКО изображения една след друга (в реда, в който са заснети) - това са СТРАНИЦИ НА ЕДНА И СЪЩА ФАКТУРА, а не отделни документи. Заглавната част (доставчик, ЕИК, номер, дата) обикновено е само на първата страница - вземи я оттам. Таблицата с артикули може да продължава през няколко страници - извлечи РЕДОВЕТЕ ОТ ВСИЧКИ СТРАНИЦИ ПОРЕД, като ги обединиш в един общ списък, без да пропускаш или дублираш редове (внимавай ако последният ред на една страница и първият на следващата съвпадат - това е една и съща позиция, не я брой два пъти). Общите суми (данъчна основа, ДДС, обща сума за плащане) обикновено са отпечатани само на ПОСЛЕДНАТА страница - вземи ги оттам, а не сумирай ръчно от отделните страници."""

async def log_ai_usage(company_id: Optional[str], endpoint: str, response, extra: Optional[dict] = None):
    """Records the real per-call token usage Anthropic's own response
    reports, so "how much is AI actually costing us" can be answered from
    real data instead of estimated from the code and published rates - see
    the cost-optimization pass this was built from (no Admin API key was
    available to pull historical numbers, so this is the measurement
    channel going forward). Never raises - a logging failure must not break
    the AI response it's piggybacking on."""
    try:
        usage = response.usage
        await db.ai_usage_log.insert_one({
            "id": str(uuid.uuid4()),
            "company_id": company_id,
            "endpoint": endpoint,
            "model": response.model,
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cache_creation_input_tokens": getattr(usage, "cache_creation_input_tokens", 0) or 0,
            "cache_read_input_tokens": getattr(usage, "cache_read_input_tokens", 0) or 0,
            **(extra or {}),
            "created_at": datetime.now(timezone.utc),
        })
    except Exception as e:
        logger.warning(f"Failed to log AI usage for {endpoint}: {e}")



def ai_exception_to_http(e: Exception, log_context: str) -> HTTPException:
    """Maps a raised Anthropic SDK exception to the same kind of clear,
    Bulgarian, status-coded error /ocr/scan already returns - for AI
    features where a failure means "the feature didn't work" rather than
    "here's an empty/legitimate result" (see run_ai_item_merge)."""
    if isinstance(e, anthropic_sdk.AuthenticationError):
        logger.error(f"{log_context}: invalid or missing Anthropic API key")
        return HTTPException(status_code=503, detail="AI функцията не е конфигурирана правилно на сървъра.")
    if isinstance(e, (anthropic_sdk.RateLimitError, anthropic_sdk.OverloadedError)):
        return HTTPException(status_code=503, detail="AI услугата е временно претоварена. Моля, опитайте отново след малко.")
    if isinstance(e, anthropic_sdk.PermissionDeniedError):
        # See the matching comment in /ocr/scan - a 403 here almost always
        # means a depleted/too-low credit balance, not a real permission issue.
        logger.error(f"{log_context}: Anthropic API permission denied - likely a depleted/too-low credit balance")
        return HTTPException(status_code=503, detail="AI акаунтът на приложението няма достатъчен баланс в момента. Моля, свържете се със системния администратор.")
    if isinstance(e, anthropic_sdk.RequestTooLargeError):
        return HTTPException(status_code=413, detail="Заявката е твърде голяма за AI услугата.")
    if isinstance(e, anthropic_sdk.APIConnectionError):
        logger.exception(f"{log_context}: could not reach the Anthropic API (network/TLS)")
        return HTTPException(status_code=502, detail="Сървърът не успя да се свърже с AI услугата (мрежов проблем).")
    if isinstance(e, anthropic_sdk.APIStatusError):
        logger.error(f"{log_context} (API status): {e}")
        # See the matching comment in /ocr/scan - a depleted credit balance
        # comes back as a plain 400 invalid_request_error, not a 403.
        if "credit balance" in str(e).lower():
            return HTTPException(status_code=503, detail="AI акаунтът на приложението няма достатъчен баланс в момента. Моля, свържете се със системния администратор.")
        return HTTPException(status_code=502, detail="Грешка при връзка с AI услугата.")
    logger.exception(log_context)
    return HTTPException(status_code=500, detail=f"Грешка: {str(e)}")

# ===================== SCAN CREDITS =====================
# The app's entire monetization surface - see ScanCreditService's module
# docstring for the reasoning. Everything else in Фактура+ stays free;
# only AI invoice scanning (the one feature with a real per-use cost) is
# metered, via a shared per-company credit balance. Purchases never
# directly increment a balance from a client-authenticated request - only
# a verified Stripe webhook event does that (see /webhooks/stripe), so a
# forged or replayed client request can never mint free credits.

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://fakturaplus-frontend.onrender.com")

class ScanBalanceOut(BaseModel):
    free_remaining: int
    free_quota: int
    free_reset_at: datetime
    purchased_balance: int
    total_remaining: int
    auto_reload_enabled: bool
    auto_reload_package_id: Optional[str] = None

class ScanTransactionOut(BaseModel):
    id: str
    type: str
    delta: int
    description: str
    price_eur: Optional[float] = None
    created_at: datetime

class ScanPackageOut(BaseModel):
    id: str
    name: str
    total_scans: int
    bonus_scans: int
    price_eur: float
    price_per_scan: float

class PurchasePackageRequest(BaseModel):
    package_id: str

class PurchaseCustomRequest(BaseModel):
    quantity: int = Field(ge=scan_credit_service_module.CUSTOM_MIN_SCANS, le=scan_credit_service_module.CUSTOM_MAX_SCANS)

class AutoReloadRequest(BaseModel):
    enabled: bool
    package_id: Optional[str] = None

def _scan_packages_catalogue() -> List[ScanPackageOut]:
    out = []
    for pkg_id in scan_credit_service_module.SCAN_PACKAGE_ORDER:
        pkg = scan_credit_service_module.SCAN_PACKAGES[pkg_id]
        total = pkg["paid_scans"] + pkg["bonus_scans"]
        out.append(ScanPackageOut(
            id=pkg_id, name=pkg["name"], total_scans=total, bonus_scans=pkg["bonus_scans"],
            price_eur=pkg["price_eur"], price_per_scan=round(pkg["price_eur"] / total, 4),
        ))
    return out






def _require_billing_enabled():
    if not BILLING_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="Покупката на сканирания временно не е налична. Моля, опитайте по-късно.",
        )





# ===================== PROTOCOL BY чл.117 ЗДДС NUMBERING =====================

async def next_protocol_number(company_id: Optional[str], user_id: str, year: int) -> str:
    """Atomically issue the next sequential протокол number for a
    reverse-charge self-billing document (чл.117 ЗДДС), scoped per
    company (or per user without one) and reset each calendar year -
    matches how these protocols are numbered in practice."""
    scope = company_id or f"user:{user_id}"
    counter_id = f"protocol_{scope}_{year}"
    result: Dict[str, Any] = await db.counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return f"{result['seq']}/{year}"

# ===================== INVOICE ENDPOINTS =====================








# ===================== DAILY REVENUE ENDPOINTS =====================





# ===================== CUSTOMERS & RECEIVABLES (Module 7 Finding #2) =====

class Customer(BaseModel):
    """Deliberately lightweight - a name and a way to reach them, never a
    CRM. Exists only so a receivable can say "this customer" without
    re-typing their contact details every time; see the Module 7 audit
    decision this was built from."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: Optional[str] = None
    user_id: str
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None

class Receivable(BaseModel):
    """The mirror image of an unpaid bank-transfer invoice (what the
    business owes suppliers) - what a customer owes the business.
    customer_name is always present and denormalized (typed freely or
    copied from a Customer) so recording one never requires creating a
    Customer record first."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: Optional[str] = None
    user_id: str
    customer_id: Optional[str] = None
    customer_name: str
    description: Optional[str] = None
    amount: float
    due_date: Optional[str] = None  # "YYYY-MM-DD"
    is_paid: bool = False
    paid_amount: float = 0
    paid_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ReceivableCreate(BaseModel):
    customer_id: Optional[str] = None
    customer_name: str
    description: Optional[str] = None
    amount: float = Field(gt=0)
    due_date: Optional[str] = None

class ReceivableUpdate(BaseModel):
    customer_name: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = Field(default=None, gt=0)
    due_date: Optional[str] = None
    is_paid: Optional[bool] = None
    paid_amount: Optional[float] = Field(default=None, ge=0)










# ===================== BILLING DOCUMENTS (non-fiscal bill/quote) =========
# Module 7, Finding #3 (decided: build the non-fiscal version). A simple
# document a craftsman or service business can hand a customer for a job -
# explicitly NOT a sequentially-numbered VAT invoice, no fiscal metadata,
# no NAP-declaration implications. Issuing a "bill" automatically creates
# a Receivable (Module 11's "full non-fiscal loop": quote -> job -> bill
# -> paid), so the owner doesn't have to record the same amount twice.

class BillingDocumentType(str, Enum):
    QUOTE = "quote"
    BILL = "bill"

class BillingDocumentItem(BaseModel):
    name: str
    quantity: float = Field(default=1, gt=0)
    unit: str = "бр."
    unit_price: float = Field(ge=0)

class BillingDocument(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: Optional[str] = None
    user_id: str
    doc_type: BillingDocumentType = BillingDocumentType.BILL
    customer_id: Optional[str] = None
    customer_name: str
    items: List[BillingDocumentItem] = []
    notes: Optional[str] = None
    issue_date: str  # "YYYY-MM-DD"
    total_amount: float = 0
    receivable_id: Optional[str] = None  # set when this doc created a receivable (bills only)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class BillingDocumentCreate(BaseModel):
    doc_type: BillingDocumentType = BillingDocumentType.BILL
    customer_id: Optional[str] = None
    customer_name: str
    items: List[BillingDocumentItem] = Field(min_length=1)
    notes: Optional[str] = None
    issue_date: Optional[str] = None






# ===================== NON-INVOICE EXPENSE ENDPOINTS =====================





# ===================== PERSONAL EXPENSES & ROI ENDPOINTS =====================





async def generate_roi_insights(
    total_personal: float,
    total_investment: float,
    total_revenue: float,
    total_profit: float,
    roi_percent: float,
    is_profitable: bool,
    investment_covered: bool,
    days_with_data: int = 0,
) -> List[str]:
    """Генерира AI управленски предложения за ROI"""
    insights = []

    # Basic insights без AI (винаги налични)
    if total_personal == 0:
        insights.append("📊 Няма въведени лични вложения за периода")
        return insights

    # ROI/profit swing wildly on a handful of days (one big invoice, one
    # slow week) - flag that explicitly so the owner doesn't read a strong
    # scaling/reinvestment suggestion into what's still a noisy sample.
    # MIN_RELIABLE_DAYS is a judgment call, not a measured threshold - about
    # a month and a half is the point where day-to-day noise usually stops
    # dominating the trend for a small shop. days_with_data is the
    # company's TOTAL logged history (see caller), so this warning clears
    # once, permanently, rather than resetting every time a new calendar
    # month starts - a single month could never reach 45 days on its own.
    MIN_RELIABLE_DAYS = 45
    data_is_sparse = days_with_data < MIN_RELIABLE_DAYS
    if data_is_sparse:
        day_word = "ден" if days_with_data == 1 else "дни"
        insights.append(
            f"📅 Фирмата има общо {days_with_data} {day_word} с въведен оборот - "
            f"изчакайте поне {MIN_RELIABLE_DAYS}-60 дни натрупани данни, преди да вземате "
            "решения за мащабиране на база тези цифри"
        )

    if investment_covered:
        insights.append("✅ Бизнесът покрива личната инвестиция за периода")
    elif is_profitable:
        diff = total_personal - total_profit
        insights.append(f"⚠️ Печалбата не покрива напълно личната инвестиция (остават {diff:.2f} €)")
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

        if data_is_sparse:
            guidance = (
                f"Периодът има само {days_with_data} дни с въведени данни - твърде малко за "
                "надежден дългосрочен извод. НЕ предлагай конкретна сума за реинвестиране или "
                "мащабиране на база тези цифри. Вместо това посъветвай собственика да изчака "
                f"поне {MIN_RELIABLE_DAYS}-60 дни натрупани данни, евентуално с кратко наблюдение "
                "върху засегашната тенденция."
            )
        else:
            guidance = "Дай конкретна препоръка какво може да направи собственикът за подобрение."

        prompt = f"""Анализирай тези финансови показатели за малък бизнес (период с {days_with_data} дни данни):
- Лична инвестиция на собственика: {total_personal:.2f} €
- Общ оборот: {total_revenue:.2f} €
- Печалба: {total_profit:.2f} €
- ROI: {roi_percent:.1f}%

{guidance}
Дай ЕДНА кратка препоръка (до 15 думи). Отговори директно с препоръката, без въвеждащ текст,
и посочвай сумите винаги в евро (€), никога в лева."""

        response = await anthropic_client.messages.create(  # type: ignore[union-attr]  # guarded by the AI_FEATURES_ENABLED check above; anthropic_client is non-None whenever that is true
            model="claude-opus-5-5",
            max_tokens=200,
            system="Ти си финансов съветник за малък бизнес. Давай кратки, ясни и практични съвети на български, като посочваш всички суми в евро (€), никога в лева.",
            messages=[{"role": "user", "content": prompt}],
        )
        await log_ai_usage(None, "roi_insights", response)
        ai_recommendation = next((b.text for b in response.content if b.type == "text"), "").strip()  # type: ignore[union-attr]  # b.type == "text" guards this at runtime; mypy cannot narrow a discriminated union inside a generator expression

        if ai_recommendation and len(ai_recommendation) < 200:
            insights.append(f"💡 AI препоръка: {ai_recommendation}")
    except Exception as e:
        logger.warning(f"AI insights generation failed: {str(e)}")
    
    return insights


# ===================== PERSONAL WALLET (Лично тефтерче) =====================
# A household-finance ledger for money the owner withdraws FROM the company
# for personal spending (loans, leasing, utilities, subscriptions, daily
# life...) - the mirror image of PersonalExpense above, which tracks money
# the owner puts INTO the company. Company-scoped like every other
# collection here, gated by its own three-tier permission (view/add/manage)
# so the owner can delegate exactly as much trust as they choose - e.g. a
# spouse who may log spending but not edit the history.

WALLET_NEEDS_CATEGORIES = {
    PersonalWalletCategory.LOAN, PersonalWalletCategory.LEASE,
    PersonalWalletCategory.UTILITY, PersonalWalletCategory.INSURANCE,
}
WALLET_WANTS_CATEGORIES = {
    PersonalWalletCategory.SUBSCRIPTION, PersonalWalletCategory.DAILY, PersonalWalletCategory.ONE_OFF,
}

def _month_bounds(dt: datetime) -> tuple:
    """Same inclusive-end-of-month convention as get_summary, reused here
    so 'this month' means the same thing across the whole app."""
    start = dt.replace(day=1).strftime("%Y-%m-%d")
    if dt.month == 12:
        last_day = dt.replace(year=dt.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        last_day = dt.replace(month=dt.month + 1, day=1) - timedelta(days=1)
    return start, last_day.strftime("%Y-%m-%d")

def _profit_formula(
    fiscal_revenue: float, pocket_money: float, invoice_total: float,
    off_book_expenses: float, payroll_cost: float, depreciation_cost: float,
) -> tuple:
    """The one income/expense formula get_summary (routers/statistics.py)
    and _compute_month_profit below both must stay in sync on: income =
    fiscal revenue + pocket money; expense = supplier invoices + off-book
    expenses + payroll + depreciation. Pulled out as its own function so
    there is exactly one formula to get right, not two hand-maintained
    copies that could silently drift apart - each caller still decides
    separately whether pocket_money/off_book_expenses is the real value
    or zeroed out for a viewer who can't see it (or, for
    _compute_month_profit, always the real value - see its own docstring).
    Returns (total_income, total_expense), not the subtraction, since
    get_summary also reports each side on its own."""
    total_income = fiscal_revenue + pocket_money
    total_expense = invoice_total + off_book_expenses + payroll_cost + depreciation_cost
    return total_income, total_expense

async def _compute_month_profit(company_id: Optional[str], scope: dict, user_id: str, start_date: str, end_date: str) -> float:
    """Reuses _profit_formula (see its docstring) so this never computes
    profit a second, independently-maintained way - this module just
    skips get_summary's permission-redaction machinery, using the real
    pocket_money/off-book-expense totals unconditionally. Used so this
    module doesn't need that machinery - whoever reaches these endpoints
    already holds a personal-wallet permission, which implies the owner
    trusts them with exactly this level of financial detail."""
    date_query = {"$gte": start_date, "$lte": end_date}
    revenues = await db.daily_revenue.find(
        {**scope, "date": date_query}, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1}
    ).to_list(1000)
    invoices = await db.invoices.find(
        {**scope, "date": {
            "$gte": datetime.fromisoformat(start_date + "T00:00:00+00:00"),
            "$lte": datetime.fromisoformat(end_date + "T23:59:59+00:00"),
        }}, {"_id": 0, "total_amount": 1}
    ).to_list(1000)
    expenses = await db.expenses.find(
        {**scope, "date": date_query}, {"_id": 0, "amount": 1}
    ).to_list(1000)
    payroll_cost = await get_payroll_cost_for_period(company_id, user_id, start_date, end_date)
    depreciation_cost = await get_depreciation_cost_for_period(company_id, user_id, start_date, end_date)

    total_income, total_expense = _profit_formula(
        fiscal_revenue=sum(r.get("fiscal_revenue", 0) for r in revenues),
        pocket_money=sum(r.get("pocket_money", 0) for r in revenues),
        invoice_total=sum(i.get("total_amount", 0) for i in invoices),
        off_book_expenses=sum(e.get("amount", 0) for e in expenses),
        payroll_cost=payroll_cost, depreciation_cost=depreciation_cost,
    )
    return total_income - total_expense

def generate_wallet_advice(
    total_spent: float,
    needs_total: float,
    wants_total: float,
    category_totals: dict,
    last_month_category_totals: dict,
    profit_this_month: float,
    safe_to_spend: float,
    threshold_percent: float,
    spent_percent_of_profit: Optional[float],
    upcoming: list,
) -> List[str]:
    """Deterministic personal-finance advice - no AI call, so it's free and
    instant. Each rule is a standard piece of household-finance guidance
    (the 50/30 needs/wants split, a fixed-obligations ceiling, a reserve
    reminder...) applied to this company's own numbers."""
    advice: List[str] = []

    if total_spent == 0:
        advice.append("📊 Няма въведени лични разходи за този месец все още")
        return advice

    # The main alert - mirrors Home's existing PriceAlertPopup threshold pattern.
    if spent_percent_of_profit is not None:
        if spent_percent_of_profit >= threshold_percent:
            advice.append(
                f"🔴 Личните тегления вече са {spent_percent_of_profit:.0f}% от печалбата за месеца "
                f"(праг {threshold_percent:.0f}%) - рискувате да вкарате фирмата в преразход"
            )
        elif spent_percent_of_profit >= threshold_percent * 0.6:
            advice.append(
                f"🟡 Личните тегления достигнаха {spent_percent_of_profit:.0f}% от печалбата - "
                "следете внимателно до края на месеца"
            )
        else:
            advice.append(f"✅ Личните тегления са {spent_percent_of_profit:.0f}% от печалбата - в норма")

    # 50/30 needs-vs-wants split (standard 50/30/20 framework, minus the
    # savings leg - this ledger doesn't track savings separately).
    if total_spent > 0:
        needs_pct = needs_total / total_spent * 100
        wants_pct = wants_total / total_spent * 100
        if needs_pct > 65:
            advice.append(
                f"⚠️ Фиксираните задължения (кредити, лизинг, комунални) са {needs_pct:.0f}% от "
                "личните разходи - при повечето бюджети здравословният дял е около 50%"
            )
        if wants_pct > 40:
            advice.append(
                f"📊 Променливите/необвързващи разходи са {wants_pct:.0f}% от тефтерчето - "
                "има пространство за съкращаване, ако месецът натежи"
            )

    # Category trend spikes vs last month.
    for category, amount in category_totals.items():
        prev = last_month_category_totals.get(category, 0)
        if prev > 20 and amount > prev * 1.2:
            growth = (amount - prev) / prev * 100
            advice.append(f"📈 Разходите за „{category}“ са нараснали с {growth:.0f}% спрямо миналия месец")

    # Reserve reminder - only when things look healthy, so it doesn't pile
    # onto someone already in the red.
    if spent_percent_of_profit is not None and spent_percent_of_profit < threshold_percent * 0.6:
        advice.append("💡 Обмислете да заделяте поне 10% от личните средства като резерв, преди да похарчите останалото")

    # Upcoming recurring obligations that would eat into what's still safe to spend.
    for item in upcoming:
        note = f"📅 Предстои плащане „{item['description']}“ ({item['amount']:.2f} €) на {item['next_due_date']}"
        if safe_to_spend - item["amount"] < 0:
            note += " - текущото „безопасно за теглене“ не го покрива"
        advice.append(note)

    return advice








# ===================== STATISTICS ENDPOINTS =====================


# ===================== "ASK YOUR OWN NUMBERS" AI CHAT (Module 4, Finding #3) =====================
# Explicitly NOT a general chatbot and never talks to NAP or any outside
# system - it answers only from the company's own stored invoices/
# expenses/revenue. The model never queries the database itself: this
# module computes a small, company-scoped digest of real numbers FIRST
# (the exact same visibility rules as /statistics/summary above), then
# asks the model only to phrase an answer FROM that digest. That's what
# keeps the hard part - scoping/safety - in this Python code instead of
# in anything the model decides to do, and it's also why the API always
# hands the digest back alongside the answer: the frontend shows the real
# numbers behind the answer, never a bare verdict.

async def _business_digest_period(
    company_id: Optional[str], scope: dict, user_id: str, start_date: str, end_date: str, visibility: dict
) -> dict:
    """One period's totals for the chat digest - same figures and the same
    visibility redaction as /statistics/summary, computed directly so a
    viewer without view_profit/view_off_book_expenses etc. gets exactly the
    same redaction here as everywhere else in the app."""
    inv_start = datetime.fromisoformat(f"{start_date}T00:00:00+00:00")
    inv_end = datetime.fromisoformat(f"{end_date}T23:59:59+00:00")

    invoices = await db.invoices.find(
        {**scope, "date": {"$gte": inv_start, "$lte": inv_end}}, {"_id": 0, "total_amount": 1}
    ).to_list(10000)
    revenues = await db.daily_revenue.find(
        {**scope, "date": {"$gte": start_date, "$lte": end_date}}, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1}
    ).to_list(10000)
    expenses = await db.expenses.find(
        {**scope, "date": {"$gte": start_date, "$lte": end_date}}, {"_id": 0, "amount": 1}
    ).to_list(10000)

    total_payroll_cost = await get_payroll_cost_for_period(company_id, user_id, start_date, end_date)
    total_depreciation_expense = await get_depreciation_cost_for_period(company_id, user_id, start_date, end_date)

    total_invoice_amount = sum(i.get("total_amount", 0) for i in invoices)
    total_fiscal_revenue = sum(r.get("fiscal_revenue", 0) for r in revenues)
    total_pocket_money = sum(r.get("pocket_money", 0) for r in revenues) if visibility["pocket_money"] else 0
    total_off_book_expenses = sum(e.get("amount", 0) for e in expenses) if visibility["off_book_expenses"] else 0

    total_income = total_fiscal_revenue + total_pocket_money
    total_expense = total_invoice_amount + total_off_book_expenses + total_payroll_cost + total_depreciation_expense
    profit = round(total_income - total_expense, 2) if visibility["profit"] else None

    return {
        "revenue": round(total_income, 2),
        "expenses": round(total_expense, 2),
        "profit": profit,
        "invoice_count": len(invoices),
    }

async def _business_digest_top_expenses(scope: dict, start_date: str, end_date: str, visibility: dict, limit: int = 8) -> List[dict]:
    """Top suppliers (invoices) and, only if this viewer may see them, top
    off-book expense descriptions - for 'what are my biggest expenses'
    style questions."""
    from collections import defaultdict

    inv_start = datetime.fromisoformat(f"{start_date}T00:00:00+00:00")
    inv_end = datetime.fromisoformat(f"{end_date}T23:59:59+00:00")
    invoices = await db.invoices.find(
        {**scope, "date": {"$gte": inv_start, "$lte": inv_end}}, {"_id": 0, "total_amount": 1, "supplier": 1}
    ).to_list(10000)

    by_name: Dict[str, float] = defaultdict(float)
    for inv in invoices:
        by_name[inv.get("supplier") or "—"] += inv.get("total_amount", 0)
    items: List[Dict[str, Any]] = [{"name": name, "amount": round(amount, 2), "source": "invoice"} for name, amount in by_name.items()]

    if visibility["off_book_expenses"]:
        expenses = await db.expenses.find(
            {**scope, "date": {"$gte": start_date, "$lte": end_date}}, {"_id": 0, "amount": 1, "description": 1}
        ).to_list(10000)
        by_desc: Dict[str, float] = defaultdict(float)
        for exp in expenses:
            by_desc[exp.get("description") or "—"] += exp.get("amount", 0)
        items += [{"name": name, "amount": round(amount, 2), "source": "off_book"} for name, amount in by_desc.items()]

    items.sort(key=lambda x: x["amount"], reverse=True)
    return items[:limit]

async def _business_digest_receivables(scope: dict) -> dict:
    """What customers owe the business - the mirror image of
    unpaid_invoices above, and a glaring gap in the original digest: a
    question like 'кой ми дължи пари?' had no data to answer from at all.
    Same aggregation as GET /receivables/summary, kept in sync by hand
    since that endpoint lives in routers/receivables.py (star-imported
    from here, not the other way around)."""
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    unpaid = await db.receivables.find({**scope, "is_paid": False}, {"_id": 0, "amount": 1, "due_date": 1}).to_list(10000)
    total_owed = sum(r.get("amount", 0) for r in unpaid)
    overdue = [r for r in unpaid if r.get("due_date") and r["due_date"] < now_str]
    total_overdue = sum(r.get("amount", 0) for r in overdue)
    return {
        "total_owed": round(total_owed, 2),
        "unpaid_count": len(unpaid),
        "total_overdue": round(total_overdue, 2),
        "overdue_count": len(overdue),
    }

async def _business_digest_vat_due(scope: dict, start_date: str, end_date: str) -> float:
    """VAT owed to NAP for this period (sales VAT minus purchase VAT) -
    same math as GET /statistics/summary's vat_to_pay. Role-invariant:
    neither pocket_money nor off-book expenses feed into VAT, so this
    needs no extra permission gate beyond the whole endpoint's own
    view_statistics - a question like 'колко ДДС да платя?' had no field
    to answer from at all before this."""
    inv_start = datetime.fromisoformat(f"{start_date}T00:00:00+00:00")
    inv_end = datetime.fromisoformat(f"{end_date}T23:59:59+00:00")
    invoices = await db.invoices.find(
        {**scope, "date": {"$gte": inv_start, "$lte": inv_end}}, {"_id": 0, "vat_amount": 1}
    ).to_list(10000)
    revenues = await db.daily_revenue.find(
        {**scope, "date": {"$gte": start_date, "$lte": end_date}}, {"_id": 0, "fiscal_revenue": 1, "vat_rate_percent": 1}
    ).to_list(10000)
    total_invoice_vat = sum(i.get("vat_amount", 0) for i in invoices)
    fiscal_vat = sum(
        r.get("fiscal_revenue", 0) * r.get("vat_rate_percent", 20.0) / (100 + r.get("vat_rate_percent", 20.0))
        for r in revenues
        if r.get("vat_rate_percent", 20.0) > 0
    )
    return round(fiscal_vat - total_invoice_vat, 2)

async def _business_digest_roi(company_id: Optional[str], scope: dict, now: datetime, visibility: dict) -> dict:
    """Current month's ROI snapshot - same math as GET /roi/analysis,
    duplicated here rather than called directly since that endpoint takes
    a Request for its own rate limiter (ask_my_numbers already has its
    own, separate one). Gated by view_personal_investments at the call
    site, same as the real endpoint; profit/roi_percent/investment_covered
    are independently null-able by view_profit within that, also matching
    the real endpoint's own redaction."""
    target_month, target_year = now.month, now.year
    period_start = f"{target_year}-{target_month:02d}-01"
    period_end = f"{target_year + 1}-01-01" if target_month == 12 else f"{target_year}-{target_month + 1:02d}-01"

    personal_expenses = await db.personal_expenses.find({
        "company_id": company_id, "period_month": target_month, "period_year": target_year
    }, {"_id": 0, "amount": 1}).to_list(1000) if company_id else []
    total_personal = sum(e.get("amount", 0) for e in personal_expenses)

    revenues = await db.daily_revenue.find({
        **scope, "date": {"$gte": period_start, "$lt": period_end}
    }, {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1}).to_list(1000)
    effective_pocket_money = sum(r.get("pocket_money", 0) for r in revenues) if visibility["pocket_money"] else 0
    total_revenue = sum(r.get("fiscal_revenue", 0) for r in revenues) + effective_pocket_money

    invoices = await db.invoices.find({
        **scope, "date": {
            "$gte": datetime.fromisoformat(period_start + "T00:00:00+00:00"),
            "$lt": datetime.fromisoformat(period_end + "T00:00:00+00:00"),
        }
    }, {"_id": 0, "total_amount": 1}).to_list(1000)
    expenses = await db.expenses.find({
        **scope, "date": {"$gte": period_start, "$lt": period_end}
    }, {"_id": 0, "amount": 1}).to_list(1000)
    effective_off_book_expense = sum(e.get("amount", 0) for e in expenses) if visibility["off_book_expenses"] else 0
    total_expense = sum(i.get("total_amount", 0) for i in invoices) + effective_off_book_expense
    total_profit = total_revenue - total_expense
    roi_percent = (total_profit / total_personal * 100) if total_personal > 0 else (0 if total_profit <= 0 else 100)

    return {
        "total_personal_investment": round(total_personal, 2),
        "total_profit": round(total_profit, 2) if visibility["profit"] else None,
        "roi_percent": round(roi_percent, 1) if visibility["profit"] else None,
        "investment_covered": (total_profit >= total_personal) if visibility["profit"] else None,
    }

async def _business_digest_assets(scope: dict) -> dict:
    """Same aggregation as GET /assets/summary."""
    assets = await db.assets.find(scope, {"_id": 0}).to_list(1000)
    enriched = [enrich_asset_with_depreciation(a) for a in assets]
    active = [a for a in enriched if a["status"] != "disposed"]
    return {
        "active_count": len(active),
        "total_net_book_value": round(sum(a["net_book_value"] for a in active), 2),
        "monthly_depreciation_total": round(sum(a["monthly_depreciation"] for a in active if a["status"] == "active"), 2),
    }

async def _business_digest_payroll(company_id: Optional[str], user_id: str, scope: dict, start_date: str, end_date: str) -> dict:
    """This period's payroll cost (already folded into expenses above) plus
    a headcount, for 'колко служители имам'/'колко ми струват заплатите'
    style questions."""
    total_cost = await get_payroll_cost_for_period(company_id, user_id, start_date, end_date)
    employee_count = await db.employees.count_documents({**scope, "active": True})
    return {"total_employer_cost": round(total_cost, 2), "employee_count": employee_count}

async def _business_digest_schedule(company_id: Optional[str], start_date: str, end_date: str) -> dict:
    """Work Schedule's hours/pay for this period, what's not yet marked
    paid, and who's on leave today - the schedule-side mirror of
    _business_digest_payroll above, for "колко часа отработи екипът"/"кой
    е в отпуск" style questions that payroll's own numbers can't answer."""
    if not company_id:
        return {"total_hours": 0, "estimated_pay": 0, "unpaid_amount": 0, "on_leave_today": []}
    # Deferred import - routers/schedule.py itself does `from server import
    # *`, so a top-level import here would cycle; safe by request time.
    from routers.schedule import _resolve_occurrences
    shifts = await db.work_shifts.find({"company_id": company_id}, {"_id": 0}).to_list(5000)
    occurrences = await _resolve_occurrences(shifts, company_id, start_date, end_date) if shifts else []
    total_hours = round(sum(o["hours"] for o in occurrences), 2)
    total_pay = round(sum(o["hours"] * (o["hourly_rate"] or 0) for o in occurrences), 2)
    payments = await db.schedule_payments.find(
        {"company_id": company_id, "period_start": {"$lte": end_date}, "period_end": {"$gte": start_date}},
        {"_id": 0, "amount": 1},
    ).to_list(1000)
    unpaid = round(max(total_pay - sum(p.get("amount", 0) for p in payments), 0), 2)

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    on_leave = await db.employee_leave.find(
        {"company_id": company_id, "start_date": {"$lte": today_str}, "end_date": {"$gte": today_str}},
        {"_id": 0, "employee_name": 1},
    ).to_list(100)
    return {
        "total_hours": total_hours, "estimated_pay": total_pay, "unpaid_amount": unpaid,
        "on_leave_today": [e["employee_name"] for e in on_leave],
    }

async def _business_digest_scan_credits(company_id: Optional[str], user_id: str) -> dict:
    """No extra permission gate - same as GET /scan-credits, visible to
    any authenticated team member since it's a shared company resource,
    not private financial data."""
    summary = await scan_credit_service.get_balance_summary(company_id, user_id)
    return {
        "total_remaining": summary["free_remaining"] + summary["purchased_balance"],
        "auto_reload_enabled": summary.get("auto_reload_enabled", False),
    }

class ChatHistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str

class BusinessChatQuery(BaseModel):
    question: str
    # Prior turns of THIS chat session, oldest first - the client resends
    # them on every call since this endpoint is otherwise fully stateless.
    # Without this, every message was its own context-free request and the
    # model had no idea what a follow-up question ("сравни с него", "ами
    # миналата седмица?") was even referring to - a real bug, not just a
    # narrow-data limitation. Capped server-side regardless of what the
    # client sends (see ask_my_numbers).
    history: List[ChatHistoryTurn] = []
    # The app's current UI language - the answer used to be hardcoded to
    # Bulgarian regardless of this, so a viewer with the UI set to English
    # got an English screen around a Bulgarian answer. Defaults to "bg"
    # for an older client that doesn't send it yet.
    language: Literal["bg", "en"] = "bg"

class BusinessChatResponse(BaseModel):
    answer: str
    digest: dict


# ===================== PROACTIVE SECOND BRAIN ENGINE (Module 11, Finding #1) =====================
# Every piece of intelligence this audit found - the forecast engine,
# price alerts, scan-credit runway, budget thresholds, reorder nudges,
# receivables due dates - already existed as its own separate signal,
# each bolted onto the push pipeline independently. This is the one
# ranking layer over all of them: it recomputes each signal fresh, scores
# how urgent it is, and returns one ordered "here's what matters today"
# list - the single source both GET /proactive/signals (the Home
# morning-briefing card) and the once-daily digest push below read from,
# so a sixth or seventh signal later is one more builder in the list, not
# a new push pipeline bolted on separately.
#
# This deliberately does NOT replace any of the existing dedicated push
# triggers (budget alert, VAT threshold, scan-credit depletion, calendar
# reminders) - those already have their own proven per-signal dedup and
# are still the right way to fire the instant something genuinely urgent
# crosses a line. This engine is the layer above them.

# Below this priority, a signal is real but not worth interrupting anyone
# with a push - it still shows in GET /proactive/signals for whenever
# they next open the app. Tuned deliberately high: a once-daily digest
# that fires on every minor thing is exactly the notification-fatigue
# failure mode this engine exists to avoid.
PROACTIVE_PUSH_WORTHY_PRIORITY = 70

async def _signal_unpaid_invoices(company_id, scope, current_user, visibility) -> Optional[dict]:
    unpaid_invoices = await db.invoices.find(
        {**scope, "payment_method": "bank_transfer", "is_paid": False},
        {"_id": 0, "total_amount": 1, "paid_amount": 1, "payment_due_date": 1},
    ).to_list(1000)
    if not unpaid_invoices:
        return None
    now_ts = datetime.now(timezone.utc)

    def _is_overdue(inv):
        due = inv.get("payment_due_date")
        if not due:
            return False
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        return due < now_ts

    overdue = [inv for inv in unpaid_invoices if _is_overdue(inv)]
    total_unpaid = sum(inv.get("total_amount", 0) - inv.get("paid_amount", 0) for inv in unpaid_invoices)
    if overdue:
        return {
            "key": "unpaid_invoices", "severity": "critical", "priority": 90,
            "title": "Просрочени фактури към доставчици",
            "detail": f"{len(overdue)} от {len(unpaid_invoices)} неплатени фактури са просрочени - общо {total_unpaid:.2f} €.",
            "route": "/(tabs)/invoices",
        }
    return {
        "key": "unpaid_invoices", "severity": "warning", "priority": 45,
        "title": "Неплатени фактури към доставчици",
        "detail": f"{len(unpaid_invoices)} неплатени фактури на обща стойност {total_unpaid:.2f} €.",
        "route": "/(tabs)/invoices",
    }

async def _signal_receivables(company_id, scope, current_user, visibility) -> Optional[dict]:
    if "add_revenue" not in set(current_user.permissions or []):
        return None
    summary = await get_receivables_summary(current_user)
    if summary["unpaid_count"] == 0:
        return None
    if summary["overdue_count"] > 0:
        return {
            "key": "receivables", "severity": "critical", "priority": 85,
            "title": "Просрочени вземания от клиенти",
            "detail": f"{summary['overdue_count']} клиенти дължат просрочено общо {summary['total_overdue']:.2f} €.",
            "route": "/receivables",
        }
    return {
        "key": "receivables", "severity": "info", "priority": 35,
        "title": "Чакащи плащания от клиенти",
        "detail": f"{summary['unpaid_count']} неплатени вземания на стойност {summary['total_owed']:.2f} €.",
        "route": "/receivables",
    }

async def _signal_scan_credits(company_id, scope, current_user, visibility) -> Optional[dict]:
    if "manage_invoices" not in set(current_user.permissions or []):
        return None
    forecast = await scan_credit_service.get_depletion_forecast(current_user.company_id, current_user.user_id)
    if forecast["insufficient_data"] or forecast["days_remaining"] is None:
        return None
    days = forecast["days_remaining"]
    if days > 7:
        return None
    severity = "critical" if days <= 1 else "warning"
    priority = 92 if days <= 1 else (75 if days <= 3 else 55)
    body = (
        "Кредитите ти за сканиране вече са на привършване." if days <= 0 else
        f"При текущия темп кредитите ти за сканиране ще свършат за около {days} {'ден' if days == 1 else 'дни'}."
    )
    return {"key": "scan_credits", "severity": severity, "priority": priority,
            "title": "Кредитите за сканиране свършват", "detail": body, "route": "/scan-credits"}

async def _signal_budget(company_id, scope, current_user, visibility) -> Optional[dict]:
    if not company_id or "manage_budget" not in set(current_user.permissions or []):
        return None
    status = await compute_budget_status(company_id, datetime.now(timezone.utc).strftime("%Y-%m"))
    if not status:
        return None
    if status["is_exceeded"]:
        return {
            "key": "budget", "severity": "critical", "priority": 88,
            "title": "Бюджетът е надхвърлен",
            "detail": f"Разходите вече са {status['total_spent']:.2f} € при лимит {status['expense_limit']:.2f} €.",
            "route": "/budget",
        }
    if status["is_alert"]:
        return {
            "key": "budget", "severity": "warning", "priority": 65,
            "title": "Приближаваш бюджетния лимит",
            "detail": f"Разходите са на {status['percent_used']:.0f}% от лимита от {status['expense_limit']:.2f} €.",
            "route": "/budget",
        }
    return None

async def _signal_price_alerts(company_id, scope, current_user, visibility) -> Optional[dict]:
    if "view_statistics" not in set(current_user.permissions or []):
        return None
    unread_count = await db.price_alerts.count_documents({**scope, "status": "unread"})
    if unread_count == 0:
        return None
    return {
        "key": "price_alerts", "severity": "warning" if unread_count >= 3 else "info",
        "priority": min(72, 40 + unread_count * 6),
        "title": "Промени в цените на доставчици",
        "detail": f"{unread_count} непрочетени известия за промяна в цените.",
        "route": "/(tabs)/stats",
    }

async def _signal_reorder(company_id, scope, current_user, visibility) -> Optional[dict]:
    if "view_statistics" not in set(current_user.permissions or []):
        return None
    data = await get_reorder_nudges(current_user)
    nudges = data.get("nudges") or []
    if not nudges:
        return None
    # get_reorder_nudges already ranks by business impact (how overdue
    # relative to its own cadence, weighted by what reordering it is
    # usually worth) - nudges[0] is the single most worth surfacing, not
    # just whichever item happens to have the largest raw day gap.
    top = nudges[0]
    overdue_ratio = top["days_since_last"] / top["median_days_between"] if top["median_days_between"] else 1.5
    # Kept well below every financial-risk signal's priority range
    # (scan_credits/budget/unpaid go up to 90+) - this is a soft,
    # pattern-based suggestion, never urgent enough to rank above an
    # actual money problem, however overdue the pattern looks.
    priority = min(50, round(30 + (overdue_ratio - 1.5) * 10))
    value_note = f" (обичайно за ~{top['avg_order_value']:.0f} €)" if top.get("avg_order_value") else ""
    return {
        "key": "reorder", "severity": "info", "priority": priority,
        "title": "Време е за нова поръчка",
        "detail": f"\"{top['item_name']}\" обикновено се поръчва на всеки {top['median_days_between']} дни{value_note} - вече мина {top['days_since_last']}.",
        "route": "/(tabs)/stats",
    }

async def _signal_forecast(company_id, scope, current_user, visibility) -> Optional[dict]:
    if not company_id or "view_statistics" not in set(current_user.permissions or []):
        return None
    revenue_forecast = await forecast_service.get_revenue_forecast(company_id, months_ahead=1)
    if (
        revenue_forecast["trend"] == "decreasing"
        and revenue_forecast["confidence"] >= 0.5
        and abs(revenue_forecast["trend_percent"]) >= 15
    ):
        return {
            "key": "forecast_revenue", "severity": "warning", "priority": 60,
            "title": "Оборотът показва низходяща тенденция",
            "detail": f"Оборотът ти намалява с около {abs(revenue_forecast['trend_percent']):.0f}% спрямо предходния период.",
            "route": "/(tabs)/stats",
        }
    expense_forecast = await forecast_service.get_expense_forecast(
        company_id, months_ahead=1, include_off_book_expenses=visibility["off_book_expenses"]
    )
    if (
        expense_forecast["trend"] == "increasing"
        and expense_forecast["confidence"] >= 0.5
        and abs(expense_forecast["trend_percent"]) >= 15
    ):
        return {
            "key": "forecast_expense", "severity": "warning", "priority": 58,
            "title": "Разходите показват възходяща тенденция",
            "detail": f"Разходите ти нарастват с около {abs(expense_forecast['trend_percent']):.0f}% спрямо предходния период.",
            "route": "/(tabs)/stats",
        }
    return None

async def _signal_schedule_unpaid(company_id, scope, current_user, visibility) -> Optional[dict]:
    """Work Schedule's hours*rate estimate for this month, minus whatever's
    already been marked paid via schedule payments - the schedule-side
    mirror of _signal_unpaid_invoices, so a mounting pile of unpaid hourly
    pay shows up here the same way an unpaid supplier invoice does, instead
    of only being visible to someone who happens to open Pay-run."""
    if not company_id or "manage_budget" not in set(current_user.permissions or []):
        return None
    # Deferred import: routers/schedule.py itself does `from server import
    # *`, so importing it at server.py's own module level would cycle -
    # safe here because every router is already fully loaded by the time
    # any request (and so this function) actually runs.
    from routers.schedule import _resolve_occurrences
    month_start, month_end = _month_bounds(datetime.now(timezone.utc))
    shifts = await db.work_shifts.find({"company_id": company_id}, {"_id": 0}).to_list(5000)
    if not shifts:
        return None
    occurrences = await _resolve_occurrences(shifts, company_id, month_start, month_end)
    total_pay = sum(o["hours"] * (o["hourly_rate"] or 0) for o in occurrences)
    if total_pay <= 0:
        return None
    payments = await db.schedule_payments.find(
        {"company_id": company_id, "period_start": {"$lte": month_end}, "period_end": {"$gte": month_start}},
        {"_id": 0, "amount": 1},
    ).to_list(1000)
    unpaid = round(total_pay - sum(p.get("amount", 0) for p in payments), 2)
    if unpaid <= 0:
        return None
    return {
        "key": "schedule_unpaid", "severity": "info", "priority": 38,
        "title": "Неплатени часове по график",
        "detail": f"Екипът е отработил часове на стойност {unpaid:.2f} € този месец, които още не са маркирани като платени.",
        "route": "/pay-run",
    }

async def _signal_team_on_leave(company_id, scope, current_user, visibility) -> Optional[dict]:
    """A quiet, low-priority reminder of who's away today - cheap context
    for a manager about to plan shifts or wonder why someone's not around,
    not an alert about anything going wrong."""
    if not company_id or "manage_budget" not in set(current_user.permissions or []):
        return None
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    entries = await db.employee_leave.find(
        {"company_id": company_id, "start_date": {"$lte": today}, "end_date": {"$gte": today}},
        {"_id": 0, "employee_name": 1},
    ).to_list(100)
    if not entries:
        return None
    names = ", ".join(e["employee_name"] for e in entries[:3])
    more = f" и още {len(entries) - 3}" if len(entries) > 3 else ""
    verb = "е в отпуск" if len(entries) == 1 and not more else "са в отпуск"
    return {
        "key": "team_on_leave", "severity": "info", "priority": 25,
        "title": "Екипът днес",
        "detail": f"{names}{more} {verb} днес.",
        "route": "/work-schedule",
    }

async def _signal_personal_wallet(company_id, scope, current_user, visibility) -> Optional[dict]:
    """personal-wallet spending already computes its own status/advice
    (generate_wallet_advice above) for the dashboard teaser, but that
    never reached this ranked list - a "danger" personal-spending status
    was invisible everywhere _signal_budget's business-side equivalent is
    visible. Reuses get_personal_wallet_summary's own computation rather
    than re-deriving it."""
    if not company_id or "view_personal_wallet" not in set(current_user.permissions or []):
        return None
    # Deferred import - see _signal_schedule_unpaid's comment above.
    from routers.roi_wallet import get_personal_wallet_summary
    summary = await get_personal_wallet_summary(current_user=current_user)
    if summary["status"] == "ok" or not summary.get("advice"):
        return None
    severity = "critical" if summary["status"] == "danger" else "warning"
    return {
        "key": "personal_wallet", "severity": severity, "priority": 80 if severity == "critical" else 55,
        "title": "Личните тегления надхвърлят безопасния лимит" if severity == "critical" else "Личните тегления се доближават до лимита",
        "detail": summary["advice"][0],
        "route": "/personal-expenses",
    }

_PROACTIVE_SIGNAL_BUILDERS = [
    _signal_unpaid_invoices, _signal_receivables, _signal_scan_credits,
    _signal_budget, _signal_price_alerts, _signal_reorder, _signal_forecast,
    _signal_schedule_unpaid, _signal_team_on_leave, _signal_personal_wallet,
]

async def get_proactive_signals(current_user: User) -> List[dict]:
    """Computes and ranks every signal this viewer is allowed to see - shared
    by GET /proactive/signals (the Home card) and the daily digest push
    tick below. Each builder softly skips itself (returns None) when the
    viewer lacks the relevant permission or the underlying endpoint it
    reuses has nothing to report - a missing permission for one signal
    never fails the whole list, and a crash in one builder (logged, never
    raised) never hides every other signal."""
    company_id, scope = await get_company_scope(current_user)
    visibility = get_financial_visibility(current_user)
    signals = []
    for builder in _PROACTIVE_SIGNAL_BUILDERS:
        try:
            signal = await builder(company_id, scope, current_user, visibility)
            if signal:
                signals.append(signal)
        except Exception:
            logger.exception(f"Proactive engine: {builder.__name__} failed")
    signals.sort(key=lambda s: s["priority"], reverse=True)
    return signals


# At most once per company per this cooldown, regardless of how many
# signals are push-worthy or how often the hourly tick below runs -
# mirrors the existing loops' "check often, fire rarely" dedup pattern,
# via a dedicated state doc rather than a per-signal flag, since this
# push is about the ranked TOP signal across all of them, not any single one.
PROACTIVE_DIGEST_COOLDOWN = timedelta(hours=20)

async def _proactive_digest_tick():
    """Once-daily ranked digest push: for every company, recomputes the
    same ranked signals GET /proactive/signals returns (using the owner's
    own permissions - the most-privileged view available, so a signal
    gated on manage_budget/add_revenue etc. is still considered) and,
    only if the single highest-ranked signal clears
    PROACTIVE_PUSH_WORTHY_PRIORITY, sends ONE push naming it plus how many
    other things are also waiting. Recipients are everyone with
    view_statistics, same selection as the existing price-alert push."""
    owners = await db.users.find(
        {"role": "owner", "company_id": {"$ne": None}}, {"_id": 0}
    ).to_list(10000)
    now = datetime.now(timezone.utc)

    for owner_doc in owners:
        company_id = owner_doc.get("company_id")
        if not company_id:
            continue

        state = await db.proactive_digest_state.find_one({"company_id": company_id}, {"_id": 0, "last_sent_at": 1})
        if state and state.get("last_sent_at"):
            last_sent_at = state["last_sent_at"]
            if last_sent_at.tzinfo is None:
                last_sent_at = last_sent_at.replace(tzinfo=timezone.utc)
            if now - last_sent_at < PROACTIVE_DIGEST_COOLDOWN:
                continue

        try:
            owner_user = User(**sanitize_user(dict(owner_doc)))
        except Exception:
            logger.exception(f"Proactive digest: could not construct owner user for company {company_id}")
            continue

        signals = await get_proactive_signals(owner_user)
        if not signals or signals[0]["priority"] < PROACTIVE_PUSH_WORTHY_PRIORITY:
            continue

        top = signals[0]
        others = len(signals) - 1
        body = top["detail"] if others <= 0 else f"{top['detail']} (+{others} друго изискващо внимание)"

        recipients = await db.users.find(
            {"company_id": company_id, "permissions": "view_statistics"}, {"_id": 0, "user_id": 1}
        ).to_list(100)
        recipient_ids = [r["user_id"] for r in recipients]
        if not recipient_ids:
            continue

        await push_service.send_to_users(
            db, recipient_ids, title=f"Днешен преглед: {top['title']}", body=body,
            data={"type": "proactive_digest", "signal_key": top["key"]},
        )
        await db.proactive_digest_state.update_one(
            {"company_id": company_id},
            {"$set": {"company_id": company_id, "last_sent_at": now, "last_signal_key": top["key"]}},
            upsert=True,
        )

async def _proactive_digest_loop():
    while True:
        try:
            await _proactive_digest_tick()
        except Exception as e:
            logger.error(f"Proactive digest loop error: {e}")
        # Hourly check, daily send (PROACTIVE_DIGEST_COOLDOWN) - same
        # reasoning as the budget/notification-settings loops above.
        await asyncio.sleep(3600)

async def start_proactive_digest_loop():
    asyncio.create_task(_proactive_digest_loop())






# ===================== EXPORT ENDPOINTS =====================
# (Simple whole-list Excel/PDF export lives at /export/invoices/excel and
# /export/invoices/pdf further below, via ExportService - correctly
# company-scoped and Cyrillic-safe. An older, buggier, ASCII-only inline
# duplicate of both used to live here and has been removed.)




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





# ===================== ITEM PRICE TRACKING =====================






class PriceAlertMuteCreate(BaseModel):
    item_name: str
    supplier: str








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

        response = await anthropic_client.messages.parse(  # type: ignore[union-attr]  # guarded by the AI_FEATURES_ENABLED check above; anthropic_client is non-None whenever that is true
            model="claude-opus-5-5",
            max_tokens=8000,
            system="Ти си експертен асистент за анализ и групиране на продукти/суровини за малък бизнес в България.",
            messages=[{"role": "user", "content": prompt}],
            output_format=ItemMergeResult,
        )
        await log_ai_usage(company_id, "item_merge", response)

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





# ===================== EXPORT ENDPOINTS =====================

from services.export_service import ExportService
from services.audit_service import AuditService
from services.forecast_service import ForecastService
from services import import_service
from services import push_service

# Initialize services
audit_service = AuditService(db)
forecast_service = ForecastService(db)
scan_credit_service = ScanCreditService(db)

async def send_price_alert_pushes(company_id: str, alerts: List["PriceAlert"]):
    """Fire-and-forget background task: pushes a real phone notification for
    price alerts raised by the invoice just scanned, mirroring
    _budget_alert_tick's push pattern below. Alerts reaching this point are
    already filtered by price_alert_settings/price_alert_mutes (see
    create_invoice), so every alert here is one the push should fire for -
    no further muting check is needed."""
    if not alerts:
        return
    recipients = await db.users.find(
        {"company_id": company_id, "permissions": "manage_invoices"}, {"_id": 0, "user_id": 1}
    ).to_list(100)
    recipient_ids = [r["user_id"] for r in recipients]
    if not recipient_ids:
        return

    if len(alerts) == 1:
        a = alerts[0]
        title = "Промяна в цена"
        body = f"{a.item_name} при {a.supplier}: {a.old_price:.2f} → {a.new_price:.2f} € ({a.change_percent:+.1f}%)"
    else:
        title = "Промени в цени"
        body = f"{len(alerts)} артикула с променена цена в последната сканирана фактура."

    await push_service.send_to_users(
        db, recipient_ids, title=title, body=body,
        data={"type": "price_alert"},
    )



# ===================== BUDGET ENDPOINTS =====================

class BudgetCreate(BaseModel):
    month: str  # YYYY-MM
    expense_limit: float
    alert_threshold: float = 80.0



async def compute_budget_status(company_id: str, month: str) -> Optional[dict]:
    """Shared by the live /budget/status endpoint and the background
    threshold-alert tick below, so both agree exactly on what "percent
    used" means (invoices + off-book expenses + payroll + depreciation).
    Returns None if the company has no budget set for that month."""
    budget = await db.budgets.find_one({"company_id": company_id, "month": month}, {"_id": 0})
    if not budget:
        return None

    # Calculate current expenses. Bounded at both ends - an unbounded $gte
    # alone would also pull in any future-dated invoice/expense (a
    # pre-scheduled invoice, a typo'd date) into THIS month's budget check.
    year, mon = int(month[:4]), int(month[5:7])
    month_start_str = f"{month}-01"
    month_start = datetime.fromisoformat(f"{month_start_str}T00:00:00+00:00")
    if mon == 12:
        month_end_date = datetime(year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
    else:
        month_end_date = datetime(year, mon + 1, 1, tzinfo=timezone.utc) - timedelta(days=1)
    month_end_str = month_end_date.strftime("%Y-%m-%d")
    month_end = datetime.fromisoformat(f"{month_end_str}T00:00:00+00:00")
    scope = await company_data_scope(company_id)

    invoices = await db.invoices.find(
        {**scope, "date": {"$gte": month_start, "$lte": month_end}},
        {"total_amount": 1}
    ).to_list(10000)

    expenses = await db.expenses.find(
        {**scope, "date": {"$gte": month_start_str, "$lte": month_end_str}},
        {"amount": 1}
    ).to_list(10000)

    # Payroll and depreciation are real, recurring costs of running the
    # business - a budget cap that only tracked invoices and off-book
    # expenses would silently ignore the two costs guaranteed to happen
    # every month, and understate how close the company actually is to its
    # limit. Same helpers and period bounds as /statistics/summary.
    # user_id is unused by these helpers whenever company_id is set (see
    # simple_scope_query) - safe to pass a placeholder here.
    total_payroll_cost = await get_payroll_cost_for_period(company_id, "", month_start_str, month_end_str)
    total_depreciation_expense = await get_depreciation_cost_for_period(company_id, "", month_start_str, month_end_str)

    total_spent = sum(inv.get("total_amount", 0) for inv in invoices)
    total_spent += sum(exp.get("amount", 0) for exp in expenses)
    total_spent += total_payroll_cost
    total_spent += total_depreciation_expense

    limit = budget.get("expense_limit", 0)
    threshold = budget.get("alert_threshold", 80)

    percent_used = (total_spent / limit * 100) if limit > 0 else 0
    is_alert = percent_used >= threshold
    is_exceeded = percent_used >= 100

    return {
        "has_budget": True,
        "month": month,
        "expense_limit": limit,
        "total_spent": round(total_spent, 2),
        "total_invoice_amount": round(sum(inv.get("total_amount", 0) for inv in invoices), 2),
        "total_non_invoice_expenses": round(sum(exp.get("amount", 0) for exp in expenses), 2),
        "total_payroll_cost": round(total_payroll_cost, 2),
        "total_depreciation_expense": round(total_depreciation_expense, 2),
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




# ===================== FORECAST ENDPOINTS =====================



# ===================== PAYROLL / ВЕДОМОСТ ЗА ЗАПЛАТИ =====================

class PayrollAgreementType(str, Enum):
    GROSS = "gross"  # договорено е брутното - служителят носи стандартната си част
    NET = "net"      # договорено е нетното "на ръка" - работодателят поема разликата

class Employee(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str  # who CREATED/owns this payroll record (scope field, see simple_scope_query) - not the employee's own login
    company_id: Optional[str] = None
    name: str
    position: Optional[str] = None
    hire_date: Optional[str] = None
    base_salary: float  # тълкува се според agreement_type
    agreement_type: PayrollAgreementType = PayrollAgreementType.GROSS
    food_vouchers: float = 0  # ваучери за храна, месечно
    additional_insurance: float = 0  # ДДЗО, месечно
    active: bool = True
    # Optional link to this SAME person's actual app account (a company
    # member with their own login), distinct from the `user_id` field
    # above. Lets the work-schedule feature cross-check a shift against
    # this employee's already-recorded leave - an Employee payroll record
    # doesn't require a login at all (e.g. kitchen staff who never use the
    # app), so this stays optional rather than merging the two identities.
    linked_user_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class EmployeeCreate(BaseModel):
    name: str
    position: Optional[str] = None
    hire_date: Optional[str] = None
    base_salary: float
    agreement_type: PayrollAgreementType = PayrollAgreementType.GROSS
    food_vouchers: float = 0
    additional_insurance: float = 0
    linked_user_id: Optional[str] = None

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    hire_date: Optional[str] = None
    base_salary: Optional[float] = None
    agreement_type: Optional[PayrollAgreementType] = None
    food_vouchers: Optional[float] = None
    additional_insurance: Optional[float] = None
    active: Optional[bool] = None
    linked_user_id: Optional[str] = None

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
    period_month: int = Field(ge=1, le=12)  # 1-12
    period_year: int
    gross_amount: Optional[float] = Field(default=None, gt=0)  # подадено ако agreement_type=gross (или ръчна корекция)
    net_target: Optional[float] = Field(default=None, gt=0)    # подадено ако agreement_type=net
    bonus_amount: float = Field(default=0, ge=0)
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











async def get_payroll_cost_for_period(company_id: Optional[str], user_id: str, start_date: Optional[str], end_date: Optional[str]) -> float:
    """Сумира total_employer_cost на всички ведомостни записи, чийто месец
    попада в зададения период - използвано в /statistics/summary и в
    прогнозата за разходи, за да включат реалния разход за персонал.
    Пропуска записи с counted_in_expenses=False - собственикът/
    счетоводителят може изрично да изключи конкретна ведомост от общите
    разходи (напр. дублиран или все още невярен запис), без да я трие."""
    query = simple_scope_query(company_id, user_id)
    entries = await db.payroll_entries.find(
        query, {"_id": 0, "period_month": 1, "period_year": 1, "total_employer_cost": 1, "counted_in_expenses": 1}
    ).to_list(10000)

    total = 0.0
    for e in entries:
        if e.get("counted_in_expenses") is False:
            continue
        period_date = f"{e['period_year']}-{e['period_month']:02d}-01"
        if start_date and period_date < start_date[:10]:
            continue
        if end_date and period_date > end_date[:10]:
            continue
        total += e.get("total_employer_cost", 0)
    return total

# ===================== OFFICIAL HOLIDAYS / РАБОТА НА ПРАЗНИЦИ И ОТПУСКИ =====================
# Tracks which employees worked on an official Bulgarian public holiday
# (extra-pay entitlement under Чл. 262 КТ) and employee leave (paid/unpaid/
# sick), so an accountant can pull a list for a period to attach to the
# required company documents. The holiday calendar itself isn't stored -
# it's computed on demand from the fixed statutory dates plus the movable
# Orthodox Easter ones, so it never goes stale across years.

# The 9 fixed dates eligible for the Чл. 154, ал. 2 КТ weekend-shift rule
# (Гергьовден/6 май is a public holiday but is NOT on this list in the
# Labor Code, so it never shifts).
_BG_FIXED_HOLIDAYS = [
    (1, 1, "Нова година"),
    (3, 3, "Ден на Освобождението на България"),
    (5, 1, "Ден на труда и на международната работническа солидарност"),
    (5, 6, "Гергьовден, Ден на храбростта и на Българската армия"),
    (5, 24, "Ден на българската просвета и култура и на славянската писменост"),
    (9, 6, "Ден на Съединението"),
    (9, 22, "Ден на Независимостта на България"),
    (12, 24, "Бъдни вечер"),
    (12, 25, "Рождество Христово"),
    (12, 26, "Втори ден на Коледа"),
]
_BG_SHIFT_ELIGIBLE = {(m, d) for (m, d, _) in _BG_FIXED_HOLIDAYS if (m, d) != (5, 6)}

def _orthodox_easter(year: int) -> date:
    """Orthodox (Julian-calendar) Easter Sunday, converted to the Gregorian
    date - Meeus' Julian algorithm plus the +13 day Julian/Gregorian offset
    (valid 1900-2099, comfortably covering this app's lifetime)."""
    a = year % 4
    b = year % 7
    c = year % 19
    d = (19 * c + 15) % 30
    e = (2 * a + 4 * b - d + 34) % 7
    month = (d + e + 114) // 31
    day = (d + e + 114) % 31 + 1
    julian_easter = date(year, month, day)
    return julian_easter + timedelta(days=13)

def get_bulgarian_public_holidays(year: int) -> List[dict]:
    """Official non-working days for a civil year: the fixed statutory
    dates, the 4 Orthodox-Easter-based ones, and the Чл. 154, ал. 2 КТ
    weekend-shift day for any eligible fixed date that lands on a weekend.
    This is a best-effort calculation, not a substitute for the accountant
    checking the official government-published list for edge cases."""
    holidays = []
    for month, day, name in _BG_FIXED_HOLIDAYS:
        d = date(year, month, day)
        holidays.append({"date": d.isoformat(), "name": name})
        if (month, day) in _BG_SHIFT_ELIGIBLE and d.weekday() in (5, 6):  # Sat=5, Sun=6
            shift_days = 2 if d.weekday() == 5 else 1
            shift_date = d + timedelta(days=shift_days)
            holidays.append({
                "date": shift_date.isoformat(),
                "name": f"{name} (почивен ден по чл. 154, ал. 2 КТ)"
            })

    easter = _orthodox_easter(year)
    for offset, name in [(-2, "Велики петък"), (-1, "Велика събота"), (0, "Великден"), (1, "Велики понеделник")]:
        d = easter + timedelta(days=offset)
        holidays.append({"date": d.isoformat(), "name": name})

    # Two adjacent statutory dates (e.g. 25/26 December) can both fall on a
    # weekend and independently shift to the SAME following weekday - merge
    # those into one entry instead of listing the same date twice.
    merged: dict = {}
    for h in holidays:
        if h["date"] in merged:
            merged[h["date"]] = merged[h["date"]] + " / " + h["name"]
        else:
            merged[h["date"]] = h["name"]
    result = [{"date": d, "name": n} for d, n in merged.items()]
    result.sort(key=lambda h: h["date"])
    return result

def _holiday_name_for_date(date_str: str) -> Optional[str]:
    year = int(date_str[:4])
    for h in get_bulgarian_public_holidays(year):
        if h["date"] == date_str:
            return h["name"]
    return None


class EmployeeHolidayWork(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    employee_id: str
    employee_name: str  # snapshot - survives the employee being renamed/deactivated later
    date: str  # YYYY-MM-DD, must be an official holiday
    holiday_name: str  # snapshot of which holiday this was, at creation time
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class EmployeeHolidayWorkCreate(BaseModel):
    employee_id: str
    date: str
    note: Optional[str] = None

class LeaveType(str, Enum):
    PAID = "paid"        # Платена
    UNPAID = "unpaid"    # Неплатена
    SICK = "sick"         # Болнична

class EmployeeLeave(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    employee_id: str
    employee_name: str
    leave_type: LeaveType
    start_date: str
    end_date: str
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class EmployeeLeaveCreate(BaseModel):
    employee_id: str
    leave_type: LeaveType
    start_date: str
    end_date: str
    note: Optional[str] = None

async def _get_employee_for_company(employee_id: str, company_id: Optional[str], current_user: User) -> dict:
    query = simple_scope_query(company_id, current_user.user_id, id=employee_id)
    employee = await db.employees.find_one(query, {"_id": 0})
    if not employee:
        raise HTTPException(status_code=404, detail="Служителят не е намерен")
    return employee


# ===================== WORK SCHEDULE / РАБОТЕН ГРАФИК =====================
# A shift is assigned to a real team-member account (user_id - someone who
# can log in and see "their own shifts"), not to the separate payroll-only
# Employee record above, which doesn't require a login at all. The two are
# cross-referenced only for the leave-conflict check, via Employee's
# optional linked_user_id.

WORK_SHIFT_REPEAT_PATTERNS = ("none", "daily", "weekly", "monthly")
# A recurring series must still end somewhere - "repeat every Monday
# forever" has no natural stopping point to show a manager, and an
# unbounded series would make every future query scan further back in
# time for no benefit. Capped well past repeat_until so a reasonable
# multi-month schedule is never silently truncated.
WORK_SHIFT_MAX_HORIZON_DAYS = 400

class WorkShiftCreate(BaseModel):
    user_id: str
    date: str  # "YYYY-MM-DD" - the anchor date (first/only occurrence)
    start_time: str  # "HH:MM"
    end_time: str  # "HH:MM" - may be earlier than start_time for an overnight shift
    repeat_pattern: str = "none"  # "none" | "daily" | "weekly" | "monthly"
    repeat_until: Optional[str] = None  # required when repeat_pattern != "none"
    hourly_rate: Optional[float] = None
    note: Optional[str] = None

class WorkShiftUpdate(BaseModel):
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    repeat_pattern: Optional[str] = None
    repeat_until: Optional[str] = None
    hourly_rate: Optional[float] = None
    note: Optional[str] = None

class WorkShift(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    user_id: str
    created_by: str
    date: str
    start_time: str
    end_time: str
    repeat_pattern: str = "none"
    repeat_until: Optional[str] = None
    hourly_rate: Optional[float] = None
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

def _shift_hours(start_time: str, end_time: str) -> float:
    """Duration of one occurrence in hours. end_time < start_time means an
    overnight shift (e.g. 22:00-06:00), not a negative-length mistake."""
    sh, sm = (int(x) for x in start_time.split(":"))
    eh, em = (int(x) for x in end_time.split(":"))
    minutes = (eh * 60 + em) - (sh * 60 + sm)
    if minutes <= 0:
        minutes += 24 * 60
    return round(minutes / 60, 2)

def _expand_shift_occurrences(shift: dict, range_start: str, range_end: str) -> List[str]:
    """Concrete calendar dates (within [range_start, range_end]) this shift
    template actually falls on. A 'none' shift occurs exactly once, on its
    own date. A recurring one repeats daily/weekly/monthly from that date
    up to repeat_until (or the query window's end, whichever is sooner -
    and never past WORK_SHIFT_MAX_HORIZON_DAYS out, regardless of
    repeat_until, so one series can't make a single list call scan years
    of dates)."""
    anchor = date.fromisoformat(shift["date"])
    window_start = date.fromisoformat(range_start)
    window_end = date.fromisoformat(range_end)
    series_end = min(window_end, anchor + timedelta(days=WORK_SHIFT_MAX_HORIZON_DAYS))
    if shift.get("repeat_until"):
        series_end = min(series_end, date.fromisoformat(shift["repeat_until"]))

    pattern = shift.get("repeat_pattern", "none")
    if pattern == "none":
        return [anchor.isoformat()] if window_start <= anchor <= window_end else []

    occurrences = []
    cursor = anchor
    while cursor <= series_end:
        if cursor >= window_start:
            occurrences.append(cursor.isoformat())
        if pattern == "daily":
            cursor = cursor + timedelta(days=1)
        elif pattern == "weekly":
            cursor = cursor + timedelta(days=7)
        elif pattern == "monthly":
            y, m = _ym_add(cursor.year, cursor.month, 1)
            # Same 1-28 simplification RecurringExpense's day_of_month
            # already relies on, to sidestep "Feb 30th" overflow.
            cursor = date(y, m, min(anchor.day, 28))
        else:
            break
    return occurrences

async def _leave_conflict_for(company_id: Optional[str], user_id: str, occ_date: str) -> Optional[dict]:
    """Whether this team member already has recorded leave covering
    occ_date, by way of an Employee payroll record explicitly linked to
    their account (linked_user_id) - returns None (no conflict data, not
    "no conflict") when no such link exists, same soft-skip the proactive
    signals engine uses elsewhere for a permission/data gap."""
    if not company_id:
        return None
    employee = await db.employees.find_one(
        {"company_id": company_id, "linked_user_id": user_id}, {"_id": 0, "id": 1}
    )
    if not employee:
        return None
    return await db.employee_leave.find_one(
        {"company_id": company_id, "employee_id": employee["id"], "start_date": {"$lte": occ_date}, "end_date": {"$gte": occ_date}},
        {"_id": 0},
    )

# A correction to ONE occurrence's hours/pay - e.g. the employee actually
# left early, or the manager and employee disagree on the scheduled time
# and settle on a different figure. Deliberately separate from WorkShift
# itself: editing the shift template changes the PLAN (and every future
# occurrence with it), while an adjustment corrects what actually
# happened on one specific date, without touching the plan or any other
# occurrence of a recurring series. At most one per (shift_id, date) -
# re-adjusting the same date replaces the previous correction rather than
# stacking a second one.
class ShiftAdjustmentCreate(BaseModel):
    actual_hours: float
    actual_hourly_rate: Optional[float] = None  # None keeps the shift's own rate
    reason: str  # required - this exists for disputes, so every correction must say why

class ShiftAdjustment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    shift_id: str
    user_id: str
    date: str
    actual_hours: float
    actual_hourly_rate: Optional[float] = None
    reason: str
    adjusted_by: str
    adjusted_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Work Schedule's hours*rate estimate is deliberately NOT counted in
# business expenses automatically (unlike the formal payroll entries
# above) - the owner/manager decides WHEN that money has actually gone
# out, by explicitly marking a period as paid. That action creates a
# real off-book expense (same `expenses` collection /statistics/summary
# already totals) and records this marker so the same period can't be
# paid twice and the UI can show what's already been settled.
class SchedulePaymentCreate(BaseModel):
    user_id: str
    period_start: str  # "YYYY-MM-DD"
    period_end: str

class SchedulePayment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    user_id: str
    user_name: str
    period_start: str
    period_end: str
    total_hours: float
    amount: float
    expense_id: str  # the resulting db.expenses record - deleting the payment removes this too
    paid_by: str
    paid_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Private, manager-only performance notes on a team member - never shown to
# the team member themselves (unlike everything else in the app, which is
# either self-facing or openly shared across the team). Any manager
# (manage_budget) can add one; only the person who wrote a note can delete
# it, so one manager's assessment can't be silently erased by another.
TEAM_NOTE_TYPES = ("positive", "negative")

class TeamNoteCreate(BaseModel):
    user_id: str
    note_type: str  # "positive" | "negative"
    text: str

class TeamNote(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    user_id: str
    note_type: str
    text: str
    created_by: str
    created_by_name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))





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
ASSET_CATEGORY_INFO: Dict[str, Dict[str, Any]] = {
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
    acquisition_value: float = Field(gt=0)
    annual_depreciation_rate_percent: Optional[float] = Field(default=None, gt=0, le=100)  # ако липсва, взима се максималната норма за категорията
    responsible_person: Optional[str] = None
    image_base64: Optional[str] = None
    notes: Optional[str] = None

class FixedAssetUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[AssetCategory] = None
    acquisition_date: Optional[str] = None
    in_service_date: Optional[str] = None
    acquisition_value: Optional[float] = Field(default=None, gt=0)
    annual_depreciation_rate_percent: Optional[float] = Field(default=None, gt=0, le=100)
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
    result: Dict[str, Any] = await db.counters.find_one_and_update(
        {"_id": counter_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True
    )
    return f"ДМА-{result['seq']:04d}"








async def get_depreciation_cost_for_period(company_id: Optional[str], user_id: str, start_date: Optional[str], end_date: Optional[str]) -> float:
    """Сумира амортизацията за всички активи, чиито месечни начисления
    попадат в зададения период - използвано в /statistics/summary и в
    прогнозата за разходи, аналогично на get_payroll_cost_for_period."""
    query = simple_scope_query(company_id, user_id)
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

# ===================== TEAM COLLABORATION (CALENDAR + MESSAGES + PUSH) =====================
# A shared calendar and messaging system for the owner/manager/accountant
# trio to coordinate (see the "team_collaboration" permission above) - a
# personal+shared calendar, one company-wide chat channel plus 1:1 direct
# messages, and Web Push so a new message/reminder shows up in the phone's
# own notification tray even with the app closed. Everything here is plain
# REST + polling (no websockets) to match the rest of this codebase and
# avoid a persistent-connection auth story of its own - see push_service.py
# for the actual browser-push delivery.

async def get_team_members(company_id: str) -> List[dict]:
    """Company members who currently hold team_collaboration - same
    active-company + accountant-membership union as GET /auth/users, since
    an accountant's ACTIVE company (and thus their live permissions) can be
    a different client than this one."""
    users = await db.users.find(
        {"company_id": company_id},
        {"_id": 0, "user_id": 1, "name": 1, "picture": 1, "role": 1, "permissions": 1}
    ).to_list(1000)
    members = []
    existing_ids = set()
    for u in users:
        existing_ids.add(u["user_id"])
        perms = u.get("permissions") or resolve_permissions(u.get("role", "staff"), None)
        if "team_collaboration" in perms:
            members.append({"user_id": u["user_id"], "name": u["name"], "picture": u.get("picture"), "role": u.get("role")})

    accountant_memberships = await db.company_memberships.find(
        {"company_id": company_id, "role": "accountant"},
        {"_id": 0, "user_id": 1, "permissions": 1}
    ).to_list(1000)
    membership_permissions = {
        m["user_id"]: (m.get("permissions") or resolve_permissions("accountant", None))
        for m in accountant_memberships
    }
    extra_ids = [uid for uid in membership_permissions if uid not in existing_ids]
    if extra_ids:
        extra_users = await db.users.find(
            {"user_id": {"$in": extra_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "picture": 1}
        ).to_list(1000)
        for u in extra_users:
            if "team_collaboration" in membership_permissions.get(u["user_id"], []):
                members.append({"user_id": u["user_id"], "name": u["name"], "picture": u.get("picture"), "role": "accountant"})
    return members

def _team_channel_id(company_id: str) -> str:
    return f"team:{company_id}"

async def get_conversation_recipients(current_user: User, conversation_id: str) -> List[str]:
    """Authorizes current_user's access to conversation_id and returns the
    OTHER participants' user_ids (i.e. who to notify on a new message).
    Raises 404 if the conversation doesn't exist / isn't this company's,
    403 if it exists but current_user isn't a participant."""
    if conversation_id == _team_channel_id(current_user.company_id or ""):
        members = await get_team_members(current_user.company_id or "")
        return [m["user_id"] for m in members if m["user_id"] != current_user.user_id]

    conversation = await db.dm_conversations.find_one(
        {"id": conversation_id, "company_id": current_user.company_id}, {"_id": 0}
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Разговорът не е намерен")
    if current_user.user_id not in conversation["participant_ids"]:
        raise HTTPException(status_code=403, detail="Нямате достъп до този разговор")
    return [uid for uid in conversation["participant_ids"] if uid != current_user.user_id]

async def get_or_create_dm_conversation(company_id: str, user_a: str, user_b: str) -> str:
    participant_ids = sorted([user_a, user_b])
    existing = await db.dm_conversations.find_one(
        {"company_id": company_id, "participant_ids": participant_ids}, {"_id": 0, "id": 1}
    )
    if existing:
        return existing["id"]
    conversation_id = str(uuid.uuid4())
    await db.dm_conversations.insert_one({
        "id": conversation_id,
        "company_id": company_id,
        "participant_ids": participant_ids,
        "created_at": datetime.now(timezone.utc),
    })
    return conversation_id

async def notify_new_message(conversation_id: str, sender: User, text: str, recipient_ids: List[str]):
    if conversation_id == _team_channel_id(sender.company_id or ""):
        title = "Екипен чат"
    else:
        title = sender.name
    body = f"{sender.name}: {text[:120]}" if title == "Екипен чат" else text[:120]
    await push_service.send_to_users(
        db, recipient_ids, title=title, body=body,
        data={"type": "message", "conversation_id": conversation_id},
    )

class CalendarEventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    event_date: str  # "YYYY-MM-DD"
    event_time: Optional[str] = None  # "HH:MM"
    visibility: str = "personal"  # "personal" | "shared"
    reminder_minutes_before: Optional[int] = None

class CalendarEventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[str] = None
    event_time: Optional[str] = None
    visibility: Optional[str] = None
    reminder_minutes_before: Optional[int] = None

class CalendarEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    creator_id: str
    creator_name: str
    title: str
    description: Optional[str] = None
    event_date: str
    event_time: Optional[str] = None
    visibility: str = "personal"
    reminder_minutes_before: Optional[int] = None
    reminder_sent: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))











class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: Dict[str, str]



# ===================== IN-APP FEEDBACK =====================

class FeedbackCreate(BaseModel):
    message: str = Field(..., min_length=3, max_length=2000)
    is_anonymous: bool = False



async def _calendar_reminder_tick():
    """One pass over due-and-unsent calendar reminders. Split out from the
    loop below so a test can call it directly without sleeping."""
    now = datetime.now(timezone.utc)
    candidates = await db.calendar_events.find(
        {"reminder_minutes_before": {"$ne": None}, "reminder_sent": {"$ne": True}}, {"_id": 0}
    ).to_list(500)
    for ev in candidates:
        try:
            event_dt = datetime.fromisoformat(f"{ev['event_date']}T{ev.get('event_time') or '09:00'}:00").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        remind_at = event_dt - timedelta(minutes=ev["reminder_minutes_before"])
        if remind_at <= now:
            when = ev["event_date"] + (f" {ev['event_time']}" if ev.get("event_time") else "")
            await push_service.send_to_user(
                db, ev["creator_id"],
                title=f"Напомняне: {ev['title']}",
                body=when,
                data={"type": "calendar", "event_id": ev["id"]},
            )
            await db.calendar_events.update_one({"id": ev["id"]}, {"$set": {"reminder_sent": True}})

async def _calendar_reminder_loop():
    while True:
        try:
            await _calendar_reminder_tick()
        except Exception as e:
            logger.error(f"Calendar reminder loop error: {e}")
        await asyncio.sleep(180)

async def start_calendar_reminder_loop():
    # In-process only - if this dyno is asleep (free-tier idle scale-down) a
    # reminder simply fires on the next request that wakes it instead of
    # exactly on time. Acceptable for a first release; a dedicated cron
    # hitting a small internal endpoint would be the fix if exact timing
    # ever matters more than "eventually, once the app is open again".
    asyncio.create_task(_calendar_reminder_loop())

async def _budget_alert_tick():
    """Pushes a real phone notification the moment a company crosses its
    monthly budget's alert threshold (and again, separately, if it goes on
    to exceed the budget entirely) - unlike the in-app price-change alerts,
    nobody has to have the app open to find out. Each of the two crossings
    fires at most once per month per company: alert_sent/exceeded_sent on
    the budget document (reset whenever the limit/threshold itself changes,
    see create_budget) is the dedupe, exactly like calendar's reminder_sent.

    Exposed as its own tick function (called from the loop below) so a test
    can call it directly without sleeping."""
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    pending = await db.budgets.find(
        {
            "month": current_month,
            "$or": [{"alert_sent": {"$ne": True}}, {"exceeded_sent": {"$ne": True}}],
        },
        {"_id": 0},
    ).to_list(1000)

    for budget in pending:
        company_id = budget["company_id"]
        status = await compute_budget_status(company_id, current_month)
        if not status:
            continue

        recipients = await db.users.find(
            {"company_id": company_id, "permissions": "manage_budget"}, {"_id": 0, "user_id": 1}
        ).to_list(100)
        recipient_ids = [r["user_id"] for r in recipients]
        if not recipient_ids:
            continue

        if status["is_exceeded"] and not budget.get("exceeded_sent"):
            await push_service.send_to_users(
                db, recipient_ids,
                title="Бюджетът е надхвърлен",
                body=(
                    f"Разходите за {current_month} вече са {status['total_spent']:.2f} € - "
                    f"над лимита от {status['expense_limit']:.2f} €."
                ),
                data={"type": "budget", "month": current_month},
            )
            await db.budgets.update_one(
                {"company_id": company_id, "month": current_month},
                {"$set": {"exceeded_sent": True, "alert_sent": True}},
            )
        elif status["is_alert"] and not budget.get("alert_sent"):
            await push_service.send_to_users(
                db, recipient_ids,
                title="Приближаваш бюджетния лимит",
                body=(
                    f"Разходите за {current_month} достигнаха {status['percent_used']:.0f}% "
                    f"от лимита от {status['expense_limit']:.2f} €."
                ),
                data={"type": "budget", "month": current_month},
            )
            await db.budgets.update_one(
                {"company_id": company_id, "month": current_month},
                {"$set": {"alert_sent": True}},
            )

async def _budget_alert_loop():
    while True:
        try:
            await _budget_alert_tick()
        except Exception as e:
            logger.error(f"Budget alert loop error: {e}")
        # Hourly is plenty for a monthly threshold - unlike a calendar
        # reminder, there's no "exact minute" to hit.
        await asyncio.sleep(3600)

async def start_budget_alert_loop():
    asyncio.create_task(_budget_alert_loop())

async def _notification_settings_tick():
    """One pass over NotificationSettings with either check enabled: a
    VAT-threshold crossing (an approximate trailing-12-month revenue figure
    against the user's own threshold) or a periodic reminder on today's
    date. Mirrors _budget_alert_tick's push-and-dedupe pattern above -
    these two toggles existed in the UI and database with nothing reading
    them until now (Module 7 audit finding).

    The VAT-threshold figure is a rough approximation (trailing 365 days
    from today, not a precise any-12-consecutive-months legal calculation)
    and is explicitly worded as such - this is a heads-up nudge, never a
    compliance determination, consistent with the app never talking to NAP
    directly."""
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    year_ago_str = (now - timedelta(days=365)).strftime("%Y-%m-%d")

    settings_docs = await db.notification_settings.find(
        {"$or": [{"vat_threshold_enabled": True}, {"periodic_enabled": True}]},
        {"_id": 0},
    ).to_list(1000)

    for settings in settings_docs:
        user_id = settings["user_id"]

        if (
            settings.get("vat_threshold_enabled")
            and settings.get("vat_threshold_amount", 0) > 0
            and not settings.get("vat_threshold_sent_at")
        ):
            revenues = await db.daily_revenue.find(
                {"user_id": user_id, "date": {"$gte": year_ago_str}},
                {"_id": 0, "fiscal_revenue": 1, "pocket_money": 1},
            ).to_list(10000)
            trailing_12mo_revenue = sum(r.get("fiscal_revenue", 0) + r.get("pocket_money", 0) for r in revenues)

            if trailing_12mo_revenue >= settings["vat_threshold_amount"]:
                await push_service.send_to_user(
                    db, user_id,
                    title="ДДС прагът е надхвърлен",
                    body=(
                        f"Оборотът ти за последните 12 месеца е ориентировъчно {trailing_12mo_revenue:.2f} € - "
                        f"над зададения праг от {settings['vat_threshold_amount']:.2f} €. "
                        f"Това е насочващо изчисление, провери точния праг с НАП или счетоводител."
                    ),
                    data={"type": "vat_threshold"},
                )
                await db.notification_settings.update_one(
                    {"user_id": user_id},
                    {"$set": {"vat_threshold_sent_at": now}},
                )

        periodic_dates = settings.get("periodic_dates") or []
        if (
            settings.get("periodic_enabled")
            and now.day in periodic_dates
            and settings.get("periodic_last_sent_date") != today_str
        ):
            await push_service.send_to_user(
                db, user_id,
                title="Напомняне",
                body="Днес е една от датите, на които си поискал периодично напомняне от Фактура+.",
                data={"type": "periodic_reminder"},
            )
            await db.notification_settings.update_one(
                {"user_id": user_id},
                {"$set": {"periodic_last_sent_date": today_str}},
            )

async def _notification_settings_loop():
    while True:
        try:
            await _notification_settings_tick()
        except Exception as e:
            logger.error(f"Notification settings loop error: {e}")
        # Hourly is plenty - a day-granularity date check and a slow-moving
        # revenue threshold, same reasoning as the budget loop above.
        await asyncio.sleep(3600)

async def start_notification_settings_loop():
    asyncio.create_task(_notification_settings_loop())

async def _scan_credit_depletion_tick():
    """Module 5 audit finding: the scan-credit ledger can already predict
    a depletion date (ScanCreditService.get_depletion_forecast), but
    nothing used it to warn anyone before the balance actually hit zero.
    One pass over every balance not yet alerted this cycle; pushes once
    when 3 days or fewer remain at the current pace, then stays quiet
    until a purchase or the next monthly reset clears the flag (see
    get_or_create_balance/credit_purchase)."""
    DEPLETION_ALERT_THRESHOLD_DAYS = 3
    balances = await scan_credit_service.list_balances_needing_depletion_check()

    for balance in balances:
        scope = balance["_id"]
        company_id = balance.get("company_id")
        # A company-scoped balance ignores the user_id argument entirely
        # (see ScanCreditService.scope_id) - only a solo ("user:<id>")
        # scope actually needs it, parsed back out of the scope string.
        probe_user_id = scope.split("user:", 1)[1] if scope.startswith("user:") else "_"

        forecast = await scan_credit_service.get_depletion_forecast(company_id, probe_user_id)
        if forecast["insufficient_data"] or forecast["days_remaining"] is None:
            continue
        if forecast["days_remaining"] > DEPLETION_ALERT_THRESHOLD_DAYS:
            continue

        if company_id:
            recipients = await db.users.find(
                {"company_id": company_id, "permissions": "manage_invoices"}, {"_id": 0, "user_id": 1}
            ).to_list(100)
            recipient_ids = [r["user_id"] for r in recipients]
        else:
            recipient_ids = [probe_user_id]
        if not recipient_ids:
            continue

        days = forecast["days_remaining"]
        body = (
            "Кредитите ти за сканиране вече са на привършване."
            if days <= 0 else
            f"При текущия темп кредитите ти за сканиране ще свършат за около {days} {'ден' if days == 1 else 'дни'}."
        )
        await push_service.send_to_users(
            db, recipient_ids, title="Кредитите ти свършват", body=body,
            data={"type": "scan_credit_depletion", "days_remaining": days},
        )
        await scan_credit_service.mark_depletion_alert_sent(scope)

async def _scan_credit_depletion_loop():
    while True:
        try:
            await _scan_credit_depletion_tick()
        except Exception as e:
            logger.error(f"Scan credit depletion loop error: {e}")
        await asyncio.sleep(3600)

async def start_scan_credit_depletion_loop():
    asyncio.create_task(_scan_credit_depletion_loop())

# ===================== BULK IMPORT (CSV/EXCEL) =====================
# Each entity's commit step calls the EXISTING create_* route function per
# row instead of re-implementing its business logic (duplicate detection,
# depreciation defaults, payroll gross-up math, budget upsert...) - see
# services/import_service.py's module docstring for why.

_IMPORT_PERMISSIONS = {
    "invoices": "manage_invoices",
    "assets": "manage_budget",
    "budget": "manage_budget",
    "daily_revenue": "add_revenue",
    "expenses": "add_expenses",
    "payroll": "manage_budget",
}

class ImportCommitRequest(BaseModel):
    rows: List[dict]




# ===================== AUDIT LOG =====================


# ===================== DATABASE INDEXES =====================

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

        # Price alerts - read on every app open via GET /items/price-alerts
        # (mounted in app/_layout.tsx), so this one matters more than its
        # small row size suggests.
        await db.price_alerts.create_index([("company_id", 1), ("status", 1), ("created_at", -1)])

        # Customers & receivables
        await db.customers.create_index([("company_id", 1), ("name", 1)])
        await db.receivables.create_index([("company_id", 1), ("is_paid", 1), ("due_date", 1)])
        await db.billing_documents.create_index([("company_id", 1), ("created_at", -1)])

        # Proactive engine digest push dedup (one state doc per company)
        await db.proactive_digest_state.create_index([("company_id", 1)], unique=True)

        # Users indexes
        await db.users.create_index([("email", 1)], unique=True, sparse=True)
        await db.users.create_index([("company_id", 1)])
        
        # Audit log index
        await db.audit_logs.create_index([("company_id", 1), ("created_at", -1)])

        # Personal wallet indexes
        await db.personal_wallet_entries.create_index([("company_id", 1), ("date", -1)])
        await db.personal_wallet_entries.create_index([("company_id", 1), ("is_recurring", 1), ("next_due_date", 1)])
        await db.personal_wallet_settings.create_index([("company_id", 1)], unique=True)

        # Team collaboration indexes (calendar, messages, push)
        await db.calendar_events.create_index([("company_id", 1), ("event_date", 1)])
        await db.calendar_events.create_index([("reminder_minutes_before", 1), ("reminder_sent", 1)])
        await db.messages.create_index([("conversation_id", 1), ("created_at", -1)])
        await db.dm_conversations.create_index([("company_id", 1), ("participant_ids", 1)])
        await db.conversation_reads.create_index([("conversation_id", 1), ("user_id", 1)], unique=True)
        await db.push_subscriptions.create_index([("endpoint", 1)], unique=True)
        await db.feedback_submissions.create_index([("created_at", -1)])
        await db.push_subscriptions.create_index([("user_id", 1)])
        await db.ai_usage_log.create_index([("company_id", 1), ("created_at", -1)])

        # Multi-owner removal-approval requests
        await db.owner_actions.create_index([("company_id", 1), ("status", 1)])

        # Closed-day exceptions (one override per company per date)
        await db.closed_date_exceptions.create_index([("company_id", 1), ("date", 1)], unique=True)

        # Employee holiday-work / leave tracking
        await db.employee_holiday_work.create_index([("company_id", 1), ("date", 1)])
        await db.employee_leave.create_index([("company_id", 1), ("start_date", 1), ("end_date", 1)])
        await db.employees.create_index([("company_id", 1), ("linked_user_id", 1)], sparse=True)

        # Work schedule
        await db.work_shifts.create_index([("company_id", 1), ("user_id", 1)])
        await db.shift_adjustments.create_index([("shift_id", 1), ("date", 1)], unique=True)
        await db.schedule_payments.create_index([("company_id", 1), ("user_id", 1), ("period_start", 1)])
        await db.team_notes.create_index([("company_id", 1), ("user_id", 1), ("created_at", -1)])

        # Scan credits (balance doc is keyed by its own scope _id already;
        # auto_reload_subscription_id is looked up by the Stripe webhook)
        await db.scan_balances.create_index([("auto_reload_subscription_id", 1)], sparse=True)
        await db.scan_transactions.create_index([("scope_id", 1), ("created_at", -1)])

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

from routers import collaboration
app.include_router(collaboration.router)
from routers import import_data
app.include_router(import_data.router)
from routers import audit
app.include_router(audit.router)

from routers import budget
app.include_router(budget.router)
from routers import payroll
app.include_router(payroll.router)
from routers import schedule
app.include_router(schedule.router)
from routers import pay_run
app.include_router(pay_run.router)
from routers import assets
app.include_router(assets.router)
from routers import team_profile
app.include_router(team_profile.router)

# Cross-router dependencies for code that stays in server.py itself (the
# proactive-engine signal builders) or hasn't been extracted yet (the bulk
# import commit handler) but calls another domain's route-handler function
# directly, the same reuse pattern already used elsewhere in this codebase
# (see import_service's own module docstring). These two are genuinely
# cross-domain, not duplication: _signal_receivables/_signal_reorder reuse
# receivables/price_tracking's own logic instead of re-querying the same
# data a second way.
from routers.receivables import get_receivables_summary
from routers.price_tracking import get_reorder_nudges
from routers.invoices import create_invoice
from routers.revenue_expenses import create_daily_revenue, create_expense
from routers.budget import create_budget
from routers.assets import create_asset
from routers.payroll import create_payroll_entry

from routers import scan_credits
app.include_router(scan_credits.router)
from routers import price_tracking
app.include_router(price_tracking.router)
from routers import forecast
app.include_router(forecast.router)
from routers import ai_insights
app.include_router(ai_insights.router)
from routers import statistics as statistics_router
app.include_router(statistics_router.router)

from routers import invoices
app.include_router(invoices.router)
from routers import revenue_expenses
app.include_router(revenue_expenses.router)
from routers import receivables
app.include_router(receivables.router)
from routers import roi_wallet
app.include_router(roi_wallet.router)

from routers import auth
app.include_router(auth.router)
from routers import company
app.include_router(company.router)
from routers import backup
app.include_router(backup.router)
from routers import exports
app.include_router(exports.router)

from routers import admin
app.include_router(admin.router)

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

@app.middleware("http")
async def csrf_protection_middleware(request: Request, call_next):
    """Double-submit CSRF check for cookie-authenticated, state-changing
    requests. samesite="none" on the session cookie (required because the
    frontend and backend sit on different origins) gives up the browser's
    own default CSRF protection, so this fills that gap explicitly.

    Only applies when a session_token COOKIE is present - the mobile
    client's Authorization-header path isn't vulnerable the way a
    browser-attached cookie is (a browser never auto-attaches a custom
    header cross-site), so it's untouched by this check.

    Also skipped whenever a (non-empty) Authorization header is present,
    on either platform: every client - the native app via its stored
    token, and the web app too, since it calls api.setToken() right after
    login the same way - already sends one on every authenticated
    request, and an attacker's forged cross-site request can never
    include a legitimate-looking one (reading it to forge the header
    would require reading something only same-origin JS can read, exactly
    like the csrf_token cookie below; and setting a custom Authorization
    header cross-origin forces the same CORS-preflight-against-the-
    allowlist rejection as a custom CSRF header would). This keeps the
    check from ever firing on normal traffic while still closing the real
    gap: a request authenticated purely by an auto-attached cookie, with
    no Authorization header at all - which is exactly what an attacker's
    forged request looks like, and also exactly the one path this
    double-submit check exists to cover.

    Rollout note: for the requests this does apply to, a header is
    required outright (blocks both a plain cross-site form, which cannot
    set custom headers at all, and a cross-origin fetch(), which the
    existing CORS allowlist already turns away at the preflight before
    any custom header matters) but a MISSING csrf_token cookie does not
    itself fail the request - only a cookie that's present and doesn't
    match the header does. This grandfathers in sessions created before
    this check existed (no csrf_token cookie yet) instead of locking out
    every already-logged-in browser tab the moment this deploys; they get
    the real cookie-matched check on their next login, same as everyone
    else."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        session_cookie = request.cookies.get("session_token")
        auth_header = request.headers.get("Authorization")
        if session_cookie and not auth_header:
            csrf_header = request.headers.get(CSRF_HEADER_NAME)
            if not csrf_header:
                return JSONResponse(status_code=403, content={"detail": "Невалиден CSRF токен"})
            csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
            if csrf_cookie and csrf_header != csrf_cookie:
                return JSONResponse(status_code=403, content={"detail": "Невалиден CSRF токен"})
    return await call_next(request)

async def shutdown_db_client():
    client.close()

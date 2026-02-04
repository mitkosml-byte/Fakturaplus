from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone
import uuid

# User Models
class User(BaseModel):
    user_id: str
    google_id: Optional[str] = None
    email: str
    name: str
    picture: Optional[str] = None
    company_id: Optional[str] = None
    role: str = "staff"
    auth_provider: str = "google"
    hashed_password: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserCreate(BaseModel):
    email: str
    password: str
    name: str

class UserLogin(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    session_token: str

# Company Models
class Company(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    eik: str = ""
    vat_number: Optional[str] = None
    mol: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    bank_name: Optional[str] = None
    bank_iban: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CompanyCreate(BaseModel):
    name: str
    eik: str = ""
    vat_number: Optional[str] = None
    mol: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None

class Invitation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    invited_by: str
    role: str = "staff"
    code: str
    expires_at: datetime
    used: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Invoice Models
class InvoiceItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    quantity: float = 1
    unit: str = "бр."
    unit_price: float
    total_price: float
    vat_amount: float = 0

class InvoiceItemCreate(BaseModel):
    name: str
    quantity: float = 1
    unit: str = "бр."
    unit_price: float
    total_price: Optional[float] = None
    vat_amount: Optional[float] = None

class Invoice(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None
    supplier: str
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    date: datetime
    image_base64: Optional[str] = None
    notes: Optional[str] = None
    items: Optional[List[dict]] = None
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
    items: Optional[List[InvoiceItemCreate]] = None

# Revenue & Expense Models
class DailyRevenue(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None
    date: datetime
    fiscal_revenue: float
    pocket_money: float
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class DailyRevenueCreate(BaseModel):
    date: str
    fiscal_revenue: float
    pocket_money: float
    notes: Optional[str] = None

class NonInvoiceExpense(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    company_id: Optional[str] = None
    description: str
    amount: float
    date: datetime
    category: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class NonInvoiceExpenseCreate(BaseModel):
    description: str
    amount: float
    date: str
    category: Optional[str] = None
    notes: Optional[str] = None

# OCR Models
class OCRResult(BaseModel):
    supplier: str
    invoice_number: str
    amount_without_vat: float
    vat_amount: float
    total_amount: float
    invoice_date: Optional[str] = None
    corrections: Optional[List[str]] = None
    confidence: Optional[float] = None

# Price Alert Models
class PriceAlertSettings(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    threshold_percent: float = 10.0
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
    status: str = "unread"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ItemPriceHistory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    supplier: str
    item_name: str
    unit_price: float
    quantity: float
    unit: str
    invoice_id: str
    invoice_number: str
    invoice_date: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Budget Models
class Budget(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    month: str  # YYYY-MM format
    expense_limit: float
    alert_threshold: float = 80.0  # Alert when 80% reached
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class RecurringExpense(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    user_id: str
    description: str
    amount: float
    day_of_month: int  # 1-28
    category: Optional[str] = None
    is_active: bool = True
    last_generated: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Audit Log
class AuditLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: Optional[str] = None
    user_id: str
    user_name: str
    action: str  # create, update, delete, login, logout
    entity_type: str  # invoice, expense, revenue, user
    entity_id: Optional[str] = None
    details: Optional[dict] = None
    ip_address: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

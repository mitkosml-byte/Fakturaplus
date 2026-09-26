export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  role: 'owner' | 'manager' | 'staff' | 'accountant';
  company_id?: string;
  permissions?: string[];
  has_password?: boolean;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  eik: string;
  vat_number?: string;
  mol?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  bank_name?: string;
  bank_iban?: string;
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  company_id: string;
  invited_by: string;
  email?: string;
  phone?: string;
  role: 'manager' | 'staff' | 'accountant';
  permissions?: string[];
  code: string;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  expires_at: string;
  created_at: string;
}

export interface CompanyMembership {
  company_id: string;
  company_name: string;
  role: 'owner' | 'manager' | 'staff' | 'accountant';
  is_active: boolean;
}

export type VatTreatment =
  | 'standard_20'
  | 'reduced_9'
  | 'zero_rate'
  | 'exempt'
  | 'reverse_charge'
  | 'outside_scope';

export type PaymentMethod = 'cash' | 'bank_transfer';

export interface Invoice {
  id: string;
  user_id: string;
  company_id?: string;
  supplier: string;
  supplier_eik?: string;
  invoice_number: string;
  amount_without_vat: number;
  vat_amount: number;
  total_amount: number;
  vat_treatment?: VatTreatment;
  protocol_number?: string;
  date: string;
  image_base64?: string;
  notes?: string;
  items?: InvoiceItemCreate[];
  payment_method?: PaymentMethod;
  is_paid: boolean;
  // Cumulative amount paid so far - "fully paid" means paid_amount >=
  // total_amount (is_paid is derived from this server-side). Lets a large
  // invoice be paid off in installments instead of all at once.
  paid_amount: number;
  payment_due_date?: string;
  paid_at?: string;
  created_at: string;
}

export interface DailyRevenue {
  id: string;
  user_id: string;
  company_id?: string;
  date: string;
  fiscal_revenue: number;
  pocket_money: number;
  card_revenue: number;
  vat_rate_percent: number;
  created_at: string;
}

export interface NonInvoiceExpense {
  id: string;
  user_id: string;
  description: string;
  amount: number;
  date: string;
  created_at: string;
}

export interface OCRItemResult {
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
}

export interface OCRResult {
  supplier: string;
  supplier_eik?: string;  // ЕИК на доставчика, ако е разпознат
  invoice_number: string;
  amount_without_vat: number;
  vat_amount: number;
  total_amount: number;
  invoice_date?: string;  // Дата на издаване от фактурата
  payment_due_date?: string;  // Срок за плащане, ако е отпечатан на фактурата
  items?: OCRItemResult[];  // Разпознати продукти от таблицата с артикули
  corrections?: string[];  // AI корекции
  confidence?: number;  // Увереност в резултата
}

export interface FinancialVisibility {
  pocket_money: boolean;
  off_book_expenses: boolean;
  profit: boolean;
  personal_investments: boolean;
}

export interface Summary {
  total_invoice_amount: number;
  total_invoice_vat: number;
  total_fiscal_revenue: number;
  // null (not 0) when this viewer's permissions hide the field - every
  // total below is already recomputed as if it were zero in that case.
  total_pocket_money: number | null;
  fiscal_vat: number;
  vat_to_pay: number;
  total_non_invoice_expenses: number | null;
  total_payroll_cost: number;
  total_depreciation_expense: number;
  total_income: number;
  total_expense: number;
  profit: number | null;
  invoice_count: number;
  total_cash_revenue: number;
  total_card_revenue: number;
  total_unpaid_amount: number;
  unpaid_invoice_count: number;
  total_overdue_amount: number;
  overdue_invoice_count: number;
  financial_visibility: FinancialVisibility;
}

export interface ChartDataPoint {
  date: string;
  label: string;
  income: number;
  expense: number;
  vat: number;
}

export interface NotificationSettings {
  id: string;
  user_id: string;
  vat_threshold_enabled: boolean;
  vat_threshold_amount: number;
  periodic_enabled: boolean;
  periodic_dates: number[];
  created_at: string;
  updated_at: string;
}

// Advanced Supplier Statistics Types
export interface SupplierStats {
  supplier: string;
  total_amount: number;
  total_vat: number;
  total_net: number;
  invoice_count: number;
  avg_invoice: number;
  first_delivery?: string;
  last_delivery?: string;
  is_active: boolean;
  days_inactive: number;
  dependency_percent: number;
  std_dev: number;
}

export interface SupplierOverviewResponse {
  period: {
    start_date: string;
    end_date: string;
  };
  executive_summary: {
    top_3_concentration: number;
    top_5_concentration: number;
    total_suppliers: number;
    active_suppliers: number;
    inactive_suppliers: number;
    high_dependency_count: number;
    largest_supplier: string | null;
    largest_amount: number;
  };
  totals: {
    total_amount: number;
    total_vat: number;
    total_net: number;
    supplier_count: number;
    invoice_count: number;
  };
  top_by_amount: SupplierStats[];
  top_by_frequency: SupplierStats[];
  top_by_avg: SupplierStats[];
  inactive_suppliers: SupplierStats[];
  high_dependency_alerts: SupplierStats[];
  all_suppliers: SupplierStats[];
}

export interface SupplierDetailedResponse {
  supplier: string;
  found: boolean;
  overview?: {
    total_amount: number;
    total_vat: number;
    total_net: number;
    invoice_count: number;
    avg_invoice: number;
    first_delivery?: string;
    last_delivery?: string;
    is_active: boolean;
    days_inactive: number;
  };
  monthly_trend?: {
    month: string;
    amount: number;
    count: number;
    growth_percent: number;
  }[];
  anomalies?: {
    date: string;
    amount: number;
    invoice_number: string;
    deviation_percent: number;
  }[];
  recent_invoices?: {
    id: string;
    invoice_number: string;
    date: string;
    total_amount: number;
    vat_amount: number;
  }[];
}

export type ChartType = 'pie' | 'bar' | 'line';

// Invoice Item types
export interface InvoiceItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  vat_amount: number;
}

export interface InvoiceItemCreate {
  name: string;
  quantity?: number;
  unit?: string;
  unit_price: number;
  total_price?: number;
  vat_amount?: number;
}

// Price Alert types
export interface PriceAlert {
  id: string;
  company_id: string;
  item_name: string;
  supplier: string;
  old_price: number;
  new_price: number;
  change_percent: number;
  invoice_id: string;
  invoice_number: string;
  status: 'unread' | 'read' | 'dismissed';
  created_at: string;
}

export interface PriceAlertSettings {
  threshold_percent: number;
  enabled: boolean;
}

export interface ItemPriceHistory {
  date: string;
  supplier: string;
  unit_price: number;
  quantity: number;
  unit: string;
  invoice_number: string;
}

export interface ItemStatistics {
  item_name: string;
  quantity: number;
  total_value: number;
  frequency: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  price_variance: number;
  trend_percent: number;
  supplier_count: number;
}

export interface ItemStatsResponse {
  totals: {
    total_items: number;
    total_value: number;
    unique_items: number;
  };
  top_by_quantity: ItemStatistics[];
  top_by_value: ItemStatistics[];
  top_by_frequency: ItemStatistics[];
  price_trends: ItemStatistics[];
}

// Payroll / Ведомост за заплати
export type PayrollAgreementType = 'gross' | 'net';

export interface Employee {
  id: string;
  user_id: string;
  company_id?: string;
  name: string;
  position?: string;
  hire_date?: string;
  base_salary: number;
  agreement_type: PayrollAgreementType;
  food_vouchers: number;
  additional_insurance: number;
  active: boolean;
  created_at: string;
}

export interface EmployeeCreate {
  name: string;
  position?: string;
  hire_date?: string;
  base_salary: number;
  agreement_type: PayrollAgreementType;
  food_vouchers?: number;
  additional_insurance?: number;
}

export interface PayrollRates {
  employee_rate_percent: number;
  employer_rate_percent: number;
  income_tax_percent: number;
  min_insurance_income: number;
  max_insurance_income: number;
}

export interface PayrollBreakdown {
  gross_amount: number;
  insurance_base: number;
  employee_contributions: number;
  employer_contributions: number;
  income_tax: number;
  net_amount: number;
  food_vouchers: number;
  additional_insurance: number;
  total_employer_cost: number;
}

export interface PayrollEntry extends PayrollBreakdown {
  id: string;
  user_id: string;
  company_id?: string;
  employee_id: string;
  employee_name: string;
  period_month: number;
  period_year: number;
  bonus_amount: number;
  notes?: string;
  created_at: string;
}

// Fixed Assets / Дълготрайни активи (ДМА)
export type AssetCategory = 'cat_i' | 'cat_ii' | 'cat_iii' | 'cat_iv' | 'cat_v' | 'cat_vi' | 'cat_vii';
export type AssetStatus = 'active' | 'fully_depreciated' | 'disposed';

export interface AssetCategoryInfo {
  value: AssetCategory;
  label: string;
  max_rate: number;
}

export interface AssetCategoriesResponse {
  categories: AssetCategoryInfo[];
  low_value_threshold: number;
}

export interface FixedAsset {
  id: string;
  user_id: string;
  company_id?: string;
  inventory_number: string;
  name: string;
  category: AssetCategory;
  acquisition_date: string;
  in_service_date: string;
  acquisition_value: number;
  annual_depreciation_rate_percent: number;
  responsible_person?: string;
  image_base64?: string;
  notes?: string;
  status: AssetStatus;
  disposal_date?: string;
  disposal_reason?: string;
  created_at: string;
  monthly_depreciation: number;
  accumulated_depreciation: number;
  net_book_value: number;
}

export interface FixedAssetCreate {
  name: string;
  category: AssetCategory;
  acquisition_date: string;
  in_service_date: string;
  acquisition_value: number;
  annual_depreciation_rate_percent?: number;
  responsible_person?: string;
  image_base64?: string;
  notes?: string;
}

export interface AssetsSummary {
  total_acquisition_value: number;
  total_accumulated_depreciation: number;
  total_net_book_value: number;
  monthly_depreciation_total: number;
  active_count: number;
  disposed_count: number;
}

// Bulk CSV/Excel import ("Импортирай от Excel")
export type ImportEntity = 'invoices' | 'assets' | 'budget' | 'daily_revenue' | 'expenses' | 'payroll';

export interface ImportRowResult {
  row_number: number;
  status: 'ok' | 'error';
  data: Record<string, any> | null;
  errors: string[];
  warnings: string[];
}

export interface ImportPreviewResult {
  total_rows: number;
  valid_count: number;
  error_count: number;
  rows: ImportRowResult[];
}

export interface ImportCommitResult {
  imported: number;
  failed: { index: number; message: string }[];
  total: number;
}

// Team collaboration: shared calendar + messages (owner/manager/accountant)
export interface CalendarEvent {
  id: string;
  company_id: string;
  creator_id: string;
  creator_name: string;
  title: string;
  description?: string | null;
  event_date: string; // "YYYY-MM-DD"
  event_time?: string | null; // "HH:MM"
  visibility: 'personal' | 'shared';
  reminder_minutes_before?: number | null;
  reminder_sent: boolean;
  created_at: string;
}

export interface CalendarEventInput {
  title: string;
  description?: string;
  event_date: string;
  event_time?: string | null;
  visibility: 'personal' | 'shared';
  reminder_minutes_before?: number | null;
}

export interface CollabMember {
  user_id: string;
  name: string;
  picture?: string | null;
  role: string;
}

export interface ConversationSummary {
  conversation_id: string;
  name: string;
  picture?: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface Message {
  id: string;
  company_id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  created_at: string;
}

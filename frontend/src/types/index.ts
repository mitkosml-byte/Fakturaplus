export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  role: 'owner' | 'manager' | 'staff' | 'accountant';
  company_id?: string;
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
  created_at: string;
}

export interface DailyRevenue {
  id: string;
  user_id: string;
  date: string;
  fiscal_revenue: number;
  pocket_money: number;
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
  items?: OCRItemResult[];  // Разпознати продукти от таблицата с артикули
  corrections?: string[];  // AI корекции
  confidence?: number;  // Увереност в резултата
}

export interface Summary {
  total_invoice_amount: number;
  total_invoice_vat: number;
  total_fiscal_revenue: number;
  total_pocket_money: number;
  fiscal_vat: number;
  vat_to_pay: number;
  total_non_invoice_expenses: number;
  total_payroll_cost: number;
  total_depreciation_expense: number;
  total_income: number;
  total_expense: number;
  profit: number;
  invoice_count: number;
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

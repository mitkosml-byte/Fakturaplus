export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  role: 'owner' | 'manager' | 'staff';
  company_id?: string;
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
  role: 'manager' | 'accountant' | 'staff' | 'viewer';
  code: string;
  invite_token: string;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  expires_at: string;
  created_at: string;
}

export interface Role {
  id: string;
  name_bg: string;
  name_en: string;
  description_bg: string;
  description_en: string;
}

export interface Invoice {
  id: string;
  user_id: string;
  company_id?: string;
  supplier: string;
  invoice_number: string;
  amount_without_vat: number;
  vat_amount: number;
  total_amount: number;
  date: string;
  image_base64?: string;
  notes?: string;
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

export interface OCRResult {
  supplier: string;
  invoice_number: string;
  amount_without_vat: number;
  vat_amount: number;
  total_amount: number;
  invoice_date?: string;  // Дата на издаване от фактурата
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

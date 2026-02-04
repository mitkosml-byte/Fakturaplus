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
  role: 'manager' | 'staff';
  code: string;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  expires_at: string;
  created_at: string;
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

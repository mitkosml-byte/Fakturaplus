import { Invoice, DailyRevenue, NonInvoiceExpense, OCRResult, Summary, ChartDataPoint, User, NotificationSettings, Company, Invitation } from '../types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

class ApiService {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (this.token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_URL}/api${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Грешка в заявката' }));
      throw new Error(error.detail || 'Грешка в заявката');
    }

    return response.json();
  }

  // Auth
  async createSession(sessionId: string): Promise<{ user: User; session_token: string }> {
    return this.fetch('/auth/session', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    });
  }

  async register(email: string, password: string, name: string): Promise<{ user: User; session_token: string }> {
    return this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });
  }

  async login(email: string, password: string): Promise<{ user: User; session_token: string }> {
    return this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async getMe(): Promise<User> {
    return this.fetch('/auth/me');
  }

  async logout(): Promise<void> {
    await this.fetch('/auth/logout', { method: 'POST' });
  }
  
  // User Management
  async getCompanyUsers(): Promise<User[]> {
    return this.fetch('/auth/users');
  }
  
  async updateUserRole(userId: string, role: string): Promise<{ message: string }> {
    return this.fetch(`/auth/role/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  }
  
  async removeUserFromCompany(userId: string): Promise<{ message: string }> {
    return this.fetch(`/auth/users/${userId}`, { method: 'DELETE' });
  }
  
  // Invitations
  async createInvitation(data: { email?: string; phone?: string; role: string }): Promise<{
    message: string;
    invitation: { id: string; code: string; expires_at: string; company_name: string };
  }> {
    return this.fetch('/invitations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
  
  async getInvitations(): Promise<Invitation[]> {
    return this.fetch('/invitations');
  }
  
  async cancelInvitation(invitationId: string): Promise<{ message: string }> {
    return this.fetch(`/invitations/${invitationId}`, { method: 'DELETE' });
  }
  
  async acceptInvitation(code: string): Promise<{ message: string; company: Company }> {
    return this.fetch('/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }
  
  async leaveCompany(): Promise<{ message: string }> {
    return this.fetch('/company/leave', { method: 'POST' });
  }

  // OCR
  async scanInvoice(imageBase64: string): Promise<OCRResult> {
    return this.fetch('/ocr/scan', {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64 }),
    });
  }

  // Invoices
  async getInvoices(params?: {
    supplier?: string;
    invoice_number?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<Invoice[]> {
    const queryParams = new URLSearchParams();
    if (params?.supplier) queryParams.set('supplier', params.supplier);
    if (params?.invoice_number) queryParams.set('invoice_number', params.invoice_number);
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return this.fetch(`/invoices${query ? `?${query}` : ''}`);
  }

  async createInvoice(invoice: Omit<Invoice, 'id' | 'user_id' | 'created_at'>): Promise<Invoice> {
    return this.fetch('/invoices', {
      method: 'POST',
      body: JSON.stringify(invoice),
    });
  }

  async updateInvoice(id: string, invoice: Partial<Invoice>): Promise<Invoice> {
    return this.fetch(`/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(invoice),
    });
  }

  async deleteInvoice(id: string): Promise<void> {
    await this.fetch(`/invoices/${id}`, { method: 'DELETE' });
  }

  // Daily Revenue
  async getDailyRevenues(params?: { start_date?: string; end_date?: string }): Promise<DailyRevenue[]> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return this.fetch(`/daily-revenue${query ? `?${query}` : ''}`);
  }

  async createDailyRevenue(revenue: { date: string; fiscal_revenue: number; pocket_money: number }): Promise<DailyRevenue> {
    return this.fetch('/daily-revenue', {
      method: 'POST',
      body: JSON.stringify(revenue),
    });
  }

  // Expenses
  async getExpenses(params?: { start_date?: string; end_date?: string }): Promise<NonInvoiceExpense[]> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return this.fetch(`/expenses${query ? `?${query}` : ''}`);
  }

  async createExpense(expense: { description: string; amount: number; date: string }): Promise<NonInvoiceExpense> {
    return this.fetch('/expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    });
  }

  async deleteExpense(id: string): Promise<void> {
    await this.fetch(`/expenses/${id}`, { method: 'DELETE' });
  }

  // Statistics
  async getSummary(params?: { start_date?: string; end_date?: string }): Promise<Summary> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return this.fetch(`/statistics/summary${query ? `?${query}` : ''}`);
  }

  async getChartData(period: 'week' | 'month' | 'year' = 'week'): Promise<ChartDataPoint[]> {
    return this.fetch(`/statistics/chart-data?period=${period}`);
  }

  // Export
  getExportExcelUrl(params?: { start_date?: string; end_date?: string }): string {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return `${API_URL}/api/export/excel${query ? `?${query}` : ''}`;
  }

  getExportPdfUrl(params?: { start_date?: string; end_date?: string }): string {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return `${API_URL}/api/export/pdf${query ? `?${query}` : ''}`;
  }

  // Notification Settings
  async getNotificationSettings(): Promise<NotificationSettings> {
    return this.fetch('/notifications/settings');
  }

  async updateNotificationSettings(settings: {
    vat_threshold_enabled?: boolean;
    vat_threshold_amount?: number;
    periodic_enabled?: boolean;
    periodic_dates?: number[];
  }): Promise<NotificationSettings> {
    return this.fetch('/notifications/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Company
  async getCompany(): Promise<Company | null> {
    return this.fetch('/company');
  }

  async createOrUpdateCompany(company: {
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
  }): Promise<Company> {
    return this.fetch('/company', {
      method: 'POST',
      body: JSON.stringify(company),
    });
  }

  async updateCompany(company: Partial<Company>): Promise<Company> {
    return this.fetch('/company', {
      method: 'PUT',
      body: JSON.stringify(company),
    });
  }

  async joinCompanyByEik(eik: string): Promise<{ message: string; company: Company }> {
    return this.fetch(`/company/join/${eik}`, {
      method: 'POST',
    });
  }

  // Backup
  async createBackup(): Promise<any> {
    return this.fetch('/backup/create', {
      method: 'POST',
    });
  }

  async getBackupStatus(): Promise<{
    has_backup: boolean;
    last_backup_date: string | null;
    file_name?: string;
    statistics?: { invoices: number; revenues: number; expenses: number };
  }> {
    return this.fetch('/backup/status');
  }

  async listBackups(): Promise<{ backups: any[] }> {
    return this.fetch('/backup/list');
  }

  async restoreBackup(backupData: any): Promise<{
    success: boolean;
    message: string;
    restored: { invoices: number; revenues: number; expenses: number };
  }> {
    return this.fetch('/backup/restore', {
      method: 'POST',
      body: JSON.stringify(backupData),
    });
  }

  // Revenue by date
  async getRevenueByDate(date: string): Promise<{
    date: string;
    fiscal_revenue: number;
    pocket_money: number;
  }> {
    return this.fetch(`/daily-revenue/by-date/${date}`);
  }

  async getTodayRevenue(): Promise<{
    date: string;
    fiscal_revenue: number;
    pocket_money: number;
  }> {
    return this.fetch('/daily-revenue/today');
  }

  // Supplier statistics
  async getSupplierStatistics(params?: {
    start_date?: string;
    end_date?: string;
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return this.fetch(`/statistics/suppliers${query ? `?${query}` : ''}`);
  }

  async getSingleSupplierStats(supplierName: string, params?: {
    start_date?: string;
    end_date?: string;
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return this.fetch(`/statistics/supplier/${encodeURIComponent(supplierName)}${query ? `?${query}` : ''}`);
  }

  // Advanced Supplier Statistics
  async getSupplierOverview(params?: {
    start_date?: string;
    end_date?: string;
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return this.fetch(`/statistics/suppliers${query ? `?${query}` : ''}`);
  }

  async getSupplierDetailed(supplierName: string): Promise<any> {
    return this.fetch(`/statistics/supplier/${encodeURIComponent(supplierName)}/detailed`);
  }

  async compareSuppliers(supplierNames: string[], params?: {
    start_date?: string;
    end_date?: string;
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    queryParams.set('suppliers', supplierNames.join(','));
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    return this.fetch(`/statistics/suppliers/compare?${queryParams.toString()}`);
  }

  // Item Price Tracking
  async getPriceAlerts(status?: string): Promise<{
    alerts: any[];
    total: number;
    unread_count: number;
  }> {
    const query = status ? `?status=${status}` : '';
    return this.fetch(`/items/price-alerts${query}`);
  }

  async updatePriceAlert(alertId: string, status: 'read' | 'dismissed'): Promise<{ message: string }> {
    return this.fetch(`/items/price-alerts/${alertId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  async getPriceAlertSettings(): Promise<{ threshold_percent: number; enabled: boolean }> {
    return this.fetch('/items/price-alert-settings');
  }

  async updatePriceAlertSettings(settings: { threshold_percent?: number; enabled?: boolean }): Promise<{ message: string }> {
    return this.fetch('/items/price-alert-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async getItemPriceHistory(itemName: string, supplier?: string): Promise<{
    item_name: string;
    history: any[];
    statistics: {
      avg_price: number;
      min_price: number;
      max_price: number;
      std_dev: number;
      trend_percent: number;
      total_records: number;
    };
  }> {
    const query = supplier ? `?supplier=${encodeURIComponent(supplier)}` : '';
    return this.fetch(`/items/price-history/${encodeURIComponent(itemName)}${query}`);
  }

  async getItemStatistics(params?: {
    start_date?: string;
    end_date?: string;
    top_n?: number;
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    if (params?.top_n) queryParams.set('top_n', params.top_n.toString());
    const query = queryParams.toString();
    return this.fetch(`/statistics/items${query ? `?${query}` : ''}`);
  }

  async getItemBySupplier(itemName: string): Promise<{
    item_name: string;
    suppliers: any[];
    recommendation: { best_supplier: string; avg_price: number; potential_savings_percent: number } | null;
  }> {
    return this.fetch(`/statistics/items/${encodeURIComponent(itemName)}/by-supplier`);
  }

  // AI Item Merging
  async triggerAiMerge(): Promise<{
    merged_groups: Array<{ canonical_name: string; variants: string[] }>;
    total_merged: number;
    message: string;
  }> {
    return this.fetch('/items/ai-merge', { method: 'POST' });
  }

  async getMergeMappings(): Promise<{
    mappings: Array<{
      canonical_name: string;
      display_name: string;
      variants: string[];
    }>;
  }> {
    return this.fetch('/items/merge-mappings');
  }

  async deleteMergeMapping(canonicalName: string): Promise<{ message: string }> {
    return this.fetch(`/items/merge-mappings/${encodeURIComponent(canonicalName)}`, { method: 'DELETE' });
  }

  async getMergedItemStatistics(params?: { start_date?: string; end_date?: string; top_n?: number }): Promise<{
    totals: { total_items: number; total_value: number; unique_items: number; merged_items: number };
    top_by_quantity: any[];
    top_by_value: any[];
    merge_applied: boolean;
    merge_groups_count: number;
  }> {
    const queryParams = new URLSearchParams();
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    if (params?.top_n) queryParams.set('top_n', params.top_n.toString());
    const query = queryParams.toString();
    return this.fetch(`/statistics/items/merged${query ? `?${query}` : ''}`);
  }

  // Budget API
  async getBudgetStatus(): Promise<any> {
    return this.fetch('/budget/status');
  }

  async getBudgets(): Promise<{ budgets: any[] }> {
    return this.fetch('/budget');
  }

  async createBudget(budget: { month: string; expense_limit: number; alert_threshold: number }): Promise<{ message: string }> {
    return this.fetch('/budget', {
      method: 'POST',
      body: JSON.stringify(budget),
    });
  }

  // Recurring Expenses
  async getRecurringExpenses(): Promise<{ recurring_expenses: any[] }> {
    return this.fetch('/recurring-expenses');
  }

  async createRecurringExpense(expense: { description: string; amount: number; day_of_month: number; category?: string }): Promise<{ message: string; id: string }> {
    return this.fetch('/recurring-expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    });
  }

  async deleteRecurringExpense(id: string): Promise<{ message: string }> {
    return this.fetch(`/recurring-expenses/${id}`, { method: 'DELETE' });
  }

  // Forecast API
  async getExpenseForecast(monthsAhead: number = 3): Promise<any> {
    return this.fetch(`/forecast/expenses?months_ahead=${monthsAhead}`);
  }

  async getRevenueForecast(monthsAhead: number = 3): Promise<any> {
    return this.fetch(`/forecast/revenue?months_ahead=${monthsAhead}`);
  }

  // Audit Logs
  async getAuditLogs(params?: { action?: string; entity_type?: string; limit?: number }): Promise<{ logs: any[] }> {
    const queryParams = new URLSearchParams();
    if (params?.action) queryParams.set('action', params.action);
    if (params?.entity_type) queryParams.set('entity_type', params.entity_type);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    const query = queryParams.toString();
    return this.fetch(`/audit-logs${query ? `?${query}` : ''}`);
  }
}

export const api = new ApiService();

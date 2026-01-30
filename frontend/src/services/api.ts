import { Invoice, DailyRevenue, NonInvoiceExpense, OCRResult, Summary, ChartDataPoint, User, NotificationSettings } from '../types';

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

  async getMe(): Promise<User> {
    return this.fetch('/auth/me');
  }

  async logout(): Promise<void> {
    await this.fetch('/auth/logout', { method: 'POST' });
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
}

export const api = new ApiService();

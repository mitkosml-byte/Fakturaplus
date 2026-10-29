import { Platform } from 'react-native';
import { Invoice, DailyRevenue, NonInvoiceExpense, OCRResult, Summary, ChartDataPoint, User, NotificationSettings, Company, Invitation, Employee, EmployeeCreate, PayrollRates, PayrollBreakdown, PayrollEntry, FixedAsset, FixedAssetCreate, AssetCategoriesResponse, AssetsSummary, CompanyMembership, ImportEntity, ImportPreviewResult, ImportCommitResult, CalendarEvent, CalendarEventInput, CollabMember, ConversationSummary, Message, OwnerAction, UserActionResult, PersonalExpense, PersonalWalletEntry, PersonalWalletSummary, PersonalWalletCategory, ClosedDateException, PublicHoliday, HolidayWorkEntry, LeaveEntry, LeaveType, ScanBalance, ScanTransaction, ScanPackage } from '../types';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Reads the csrf_token cookie the backend sets alongside the (httponly)
// session cookie - see server.py's set_session_cookies. Only meaningful on
// web: native builds authenticate via the Bearer token below, never a
// cookie, so the backend's CSRF check never triggers for them and this
// always returns null there (document doesn't exist on native anyway).
function readCsrfTokenCookie(): string | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Matches ForecastService's _resolve_window: either a lookback preset
// (in days - 30/90/180/365 for roughly 1/3/6/12 months) or an explicit
// custom start/end, never both at once.
export type ForecastRange =
  | { lookbackDays: number; startDate?: undefined; endDate?: undefined }
  | { lookbackDays?: undefined; startDate: string; endDate: string };

function forecastRangeQuery(range?: ForecastRange): string {
  if (!range) return '';
  if (range.startDate && range.endDate) {
    return `&start_date=${range.startDate}&end_date=${range.endDate}`;
  }
  if (range.lookbackDays) {
    return `&lookback_days=${range.lookbackDays}`;
  }
  return '';
}

// Bulgarian labels for the field names that actually show up in
// validation errors across invoices/expenses/items, so a rejected save
// names the field the way the user sees it on screen, not its Python
// attribute name. Unlisted fields just fall back to their raw name.
const FIELD_LABELS: Record<string, string> = {
  quantity: 'количество', unit_price: 'единична цена', total_price: 'обща цена',
  vat_amount: 'ДДС', amount_without_vat: 'сума без ДДС', total_amount: 'обща сума',
  amount: 'сума', name: 'име', date: 'дата', supplier: 'доставчик',
  invoice_number: 'номер на фактура', description: 'описание',
};

// Pydantic's error `type` is a stable machine-readable code, independent of
// the (English) `msg` text - map the couple of constraint kinds that
// actually occur in this app's models (every numeric Field here uses only
// gt=0 or ge=0) to a short Bulgarian phrase instead of passing through
// "Input should be greater than or equal to 0".
function friendlyReason(type: unknown, msg: string): string {
  if (type === 'greater_than') return 'трябва да е по-голямо от 0';
  if (type === 'greater_than_equal') return 'не може да бъде отрицателно число';
  if (type === 'missing') return 'е задължително поле';
  return msg;
}

// FastAPI's own validation-error shape puts `detail` as an ARRAY of
// {loc, msg, type} objects (one per invalid field), not a string - passing
// that straight to `new Error(detail)` coerces it via Array.prototype.join,
// which stringifies each plain object as the literal text "[object Object]"
// instead of anything a user can act on. Pull out each item's own field +
// reason instead, translated where this app has a known label for them.
function formatApiErrorDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (item && typeof item === 'object' && 'msg' in item) {
        const loc = Array.isArray((item as any).loc) ? (item as any).loc : [];
        const field = loc[loc.length - 1];
        const reason = friendlyReason((item as any).type, (item as any).msg);
        if (typeof field !== 'string') return reason;
        const label = FIELD_LABELS[field] || field;
        // A validation error nested inside an item list (loc includes a
        // numeric index, e.g. ["body","items",0,"unit_price"]) names which
        // item row it's about, not just the field - "артикул 1" (1-based,
        // matching what the UI shows) rather than a bare field name that
        // could mean any of several rows.
        const itemIndex = loc.length >= 2 && typeof loc[loc.length - 2] === 'number' ? loc[loc.length - 2] + 1 : null;
        return itemIndex !== null ? `артикул ${itemIndex} - ${label}: ${reason}` : `${label}: ${reason}`;
      }
      return typeof item === 'string' ? item : JSON.stringify(item);
    });
    return messages.join('; ') || 'Грешка в заявката';
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail);
  return 'Грешка в заявката';
}

class ApiService {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (this.token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.token}`;
    }

    const method = (options.method || 'GET').toUpperCase();
    if (MUTATING_METHODS.has(method)) {
      const csrfToken = readCsrfTokenCookie();
      if (csrfToken) {
        (headers as Record<string, string>)['X-CSRF-Token'] = csrfToken;
      }
    }

    const response = await fetch(`${API_URL}/api${endpoint}`, {
      ...options,
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Грешка в заявката' }));
      const err = new Error(formatApiErrorDetail(error.detail)) as Error & { status?: number };
      // Attached so callers that need to branch on it (e.g. 402 = no scan
      // credits remaining, show the purchase screen instead of a plain
      // error alert) can do so without parsing the message text.
      err.status = response.status;
      throw err;
    }

    return response.json();
  }

  // Auth
  async register(email: string, password: string, name: string, invitationCode?: string): Promise<{ user: User; session_token: string; invite_error?: string | null }> {
    return this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, invitation_code: invitationCode || undefined }),
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

  async forgotPassword(email: string): Promise<{ message: string }> {
    return this.fetch('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<{ message: string }> {
    return this.fetch('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, new_password: newPassword }),
    });
  }

  async changePassword(newPassword: string, currentPassword?: string): Promise<{ message: string }> {
    return this.fetch('/auth/change-password', {
      method: 'PUT',
      body: JSON.stringify({ new_password: newPassword, current_password: currentPassword }),
    });
  }

  async logout(): Promise<void> {
    await this.fetch('/auth/logout', { method: 'POST' });
  }
  
  // User Management
  async getCompanyUsers(): Promise<User[]> {
    return this.fetch('/auth/users');
  }
  
  async updateUserRole(userId: string, role: string, permissions?: string[]): Promise<UserActionResult> {
    return this.fetch(`/auth/role/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role, permissions }),
    });
  }

  async removeUserFromCompany(userId: string): Promise<UserActionResult> {
    return this.fetch(`/auth/users/${userId}`, { method: 'DELETE' });
  }

  // Multi-owner removal-approval requests
  async getOwnerActions(): Promise<OwnerAction[]> {
    return this.fetch('/company/owner-actions');
  }

  async approveOwnerAction(actionId: string): Promise<{ message: string; status: string }> {
    return this.fetch(`/company/owner-actions/${actionId}/approve`, { method: 'POST' });
  }

  async rejectOwnerAction(actionId: string): Promise<{ message: string }> {
    return this.fetch(`/company/owner-actions/${actionId}/reject`, { method: 'POST' });
  }
  
  // Invitations
  async createInvitation(data: { email?: string; phone?: string; role: string; permissions?: string[] }): Promise<{
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

  // Multi-company access (accountant switcher)
  async getCompanyMemberships(): Promise<CompanyMembership[]> {
    return this.fetch('/companies/memberships');
  }

  async switchCompany(companyId: string): Promise<User> {
    return this.fetch('/companies/switch', {
      method: 'POST',
      body: JSON.stringify({ company_id: companyId }),
    });
  }

  // OCR - accepts one or several photographed pages of the same invoice;
  // the backend merges them into a single set of extracted fields.
  async scanInvoice(images: string[]): Promise<OCRResult> {
    return this.fetch('/ocr/scan', {
      method: 'POST',
      body: JSON.stringify({ image_base64s: images }),
    });
  }

  // Scan credits - the app's only metered feature, see
  // backend/services/scan_credit_service.py. A scanInvoice() call above
  // that fails with a 402 means this balance is at zero; the caller checks
  // error.status (see fetch<T>) to route to the purchase screen instead of
  // a generic error alert.
  async getScanBalance(): Promise<ScanBalance> {
    return this.fetch('/scan-credits');
  }

  async getScanCreditsForecast(): Promise<{
    insufficient_data: boolean;
    scans_used_in_window: number;
    lookback_days: number;
    total_remaining: number;
    daily_rate: number | null;
    days_remaining: number | null;
    estimated_depletion_date: string | null;
  }> {
    return this.fetch('/scan-credits/forecast');
  }

  async getScanPackages(): Promise<ScanPackage[]> {
    return this.fetch('/scan-credits/packages');
  }

  async getScanCreditsHistory(): Promise<ScanTransaction[]> {
    return this.fetch('/scan-credits/history');
  }

  getScanCreditsHistoryExportUrl(): string {
    return '/api/scan-credits/history/export';
  }

  async purchaseScanPackage(packageId: string): Promise<{ checkout_url: string }> {
    return this.fetch('/scan-credits/purchase/package', {
      method: 'POST',
      body: JSON.stringify({ package_id: packageId }),
    });
  }

  async purchaseScanCustom(quantity: number): Promise<{ checkout_url: string }> {
    return this.fetch('/scan-credits/purchase/custom', {
      method: 'POST',
      body: JSON.stringify({ quantity }),
    });
  }

  async setScanAutoReload(enabled: boolean, packageId?: string): Promise<{ checkout_url?: string; auto_reload_enabled?: boolean }> {
    return this.fetch('/scan-credits/auto-reload', {
      method: 'POST',
      body: JSON.stringify({ enabled, package_id: packageId }),
    });
  }

  // Bulk import (CSV/Excel) - template download URL is a plain GET, handed
  // to downloadAndShareFile by the caller like every other export link.
  getImportTemplateUrl(entity: ImportEntity): string {
    return `/api/import/template/${entity}`;
  }

  async previewImport(entity: ImportEntity, asset: { uri: string; name: string; mimeType?: string; file?: any }): Promise<ImportPreviewResult> {
    const formData = new FormData();
    if (Platform.OS === 'web' && asset.file) {
      formData.append('file', asset.file, asset.name);
    } else {
      // React Native's fetch recognizes this {uri, name, type} shape and
      // streams the file from disk - there is no Blob to construct here.
      formData.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType || 'application/octet-stream' } as any);
    }

    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const response = await fetch(`${API_URL}/api/import/${entity}/preview`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Грешка в заявката' }));
      throw new Error(formatApiErrorDetail(error.detail));
    }
    return response.json();
  }

  async commitImport(entity: ImportEntity, rows: Record<string, any>[]): Promise<ImportCommitResult> {
    return this.fetch(`/import/${entity}/commit`, {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
  }

  // Invoices
  async getInvoices(params?: {
    supplier?: string;
    invoice_number?: string;
    search?: string;
    start_date?: string;
    end_date?: string;
    payment_status?: 'paid' | 'unpaid' | 'partial' | 'overdue';
  }): Promise<Invoice[]> {
    const queryParams = new URLSearchParams();
    if (params?.supplier) queryParams.set('supplier', params.supplier);
    if (params?.invoice_number) queryParams.set('invoice_number', params.invoice_number);
    if (params?.search) queryParams.set('search', params.search);
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    if (params?.payment_status) queryParams.set('payment_status', params.payment_status);
    const query = queryParams.toString();
    return this.fetch(`/invoices${query ? `?${query}` : ''}`);
  }

  // Same filters as getInvoices, plus limit/offset, and also returns the
  // true total match count (X-Total-Count) so a caller can tell whether
  // the returned page is everything or there's more to load - the backend
  // used to cap silently at 1000 with no way to know invoices were missing.
  async getInvoicesPage(params?: {
    supplier?: string;
    invoice_number?: string;
    search?: string;
    start_date?: string;
    end_date?: string;
    payment_status?: 'paid' | 'unpaid' | 'partial' | 'overdue';
    limit?: number;
    offset?: number;
  }): Promise<{ invoices: Invoice[]; totalCount: number }> {
    const queryParams = new URLSearchParams();
    if (params?.supplier) queryParams.set('supplier', params.supplier);
    if (params?.invoice_number) queryParams.set('invoice_number', params.invoice_number);
    if (params?.search) queryParams.set('search', params.search);
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    if (params?.payment_status) queryParams.set('payment_status', params.payment_status);
    if (params?.limit != null) queryParams.set('limit', String(params.limit));
    if (params?.offset != null) queryParams.set('offset', String(params.offset));
    const query = queryParams.toString();

    const response = await fetch(`${API_URL}/api/invoices${query ? `?${query}` : ''}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Грешка в заявката' }));
      const err = new Error(formatApiErrorDetail(error.detail)) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }
    const invoices: Invoice[] = await response.json();
    const totalHeader = response.headers.get('X-Total-Count');
    const totalCount = totalHeader ? parseInt(totalHeader, 10) : invoices.length;
    return { invoices, totalCount };
  }

  async createInvoice(invoice: Omit<Invoice, 'id' | 'user_id' | 'created_at' | 'is_paid' | 'paid_amount' | 'paid_at'>): Promise<Invoice> {
    return this.fetch('/invoices', {
      method: 'POST',
      body: JSON.stringify(invoice),
    });
  }

  // Fetches the full invoice record including its scanned page image(s) -
  // the list endpoints above omit those to keep list payloads small.
  async getInvoice(id: string): Promise<Invoice> {
    return this.fetch(`/invoices/${id}`);
  }

  async updateInvoice(id: string, invoice: Partial<Invoice>): Promise<Invoice> {
    return this.fetch(`/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(invoice),
    });
  }

  async validateEik(eik: string): Promise<{ valid: boolean; normalized: string; reason: string | null }> {
    return this.fetch(`/utils/validate-eik?eik=${encodeURIComponent(eik)}`);
  }

  async getReverseChargeProtocols(): Promise<Invoice[]> {
    return this.fetch('/invoices/protocols/reverse-charge');
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

  async createDailyRevenue(revenue: { date: string; fiscal_revenue: number; pocket_money: number; card_revenue?: number; vat_rate_percent?: number }): Promise<DailyRevenue> {
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

  async updateExpense(id: string, update: Partial<{ description: string; amount: number; date: string }>): Promise<NonInvoiceExpense> {
    return this.fetch(`/expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(update),
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

  // Creates a brand new company owned by the current user, in addition to
  // whichever one(s) they already have - unlike createOrUpdateCompany,
  // which only ever edits the current one. Switches the user into it.
  async createAdditionalCompany(company: { name: string; eik: string }): Promise<Company> {
    return this.fetch('/companies', {
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

  // Closed days - the weekly pattern itself lives on Company.closed_weekdays
  // (set via updateCompany), these cover the one-off calendar exceptions.
  async getClosedDateExceptions(): Promise<ClosedDateException[]> {
    return this.fetch('/company/closed-date-exceptions');
  }

  async upsertClosedDateException(params: { date: string; closed: boolean; label?: string }): Promise<ClosedDateException> {
    return this.fetch('/company/closed-date-exceptions', {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  }

  async deleteClosedDateException(date: string): Promise<{ message: string }> {
    return this.fetch(`/company/closed-date-exceptions/${date}`, {
      method: 'DELETE',
    });
  }

  async getOpenDaysCount(startDate: string, endDate: string): Promise<{ open_days: number; closed_days: number; total_days: number }> {
    return this.fetch(`/company/open-days-count?start_date=${startDate}&end_date=${endDate}`);
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
    skipped?: { invoices: number; revenues: number; expenses: number };
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
    card_revenue: number;
    vat_rate_percent: number;
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
  async getPriceAlerts(status?: string, invoiceId?: string): Promise<{
    alerts: any[];
    total: number;
    unread_count: number;
  }> {
    const queryParams = new URLSearchParams();
    if (status) queryParams.set('status', status);
    if (invoiceId) queryParams.set('invoice_id', invoiceId);
    const query = queryParams.toString();
    return this.fetch(`/items/price-alerts${query ? `?${query}` : ''}`);
  }

  async updatePriceAlert(alertId: string, status: 'read' | 'dismissed'): Promise<{ message: string }> {
    return this.fetch(`/items/price-alerts/${alertId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  async getPriceAlertSettings(): Promise<{
    threshold_percent: number;
    min_absolute_change: number;
    alert_on_decrease: boolean;
    enabled: boolean;
  }> {
    return this.fetch('/items/price-alert-settings');
  }

  async updatePriceAlertSettings(settings: {
    threshold_percent?: number;
    min_absolute_change?: number;
    alert_on_decrease?: boolean;
    enabled?: boolean;
  }): Promise<{ message: string }> {
    return this.fetch('/items/price-alert-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async getPriceAlertMutes(): Promise<{ mutes: { id: string; item_name: string; supplier: string }[] }> {
    return this.fetch('/items/price-alert-mutes');
  }

  async createPriceAlertMute(itemName: string, supplier: string): Promise<{ mute: { id: string } }> {
    return this.fetch('/items/price-alert-mutes', {
      method: 'POST',
      body: JSON.stringify({ item_name: itemName, supplier }),
    });
  }

  async deletePriceAlertMute(muteId: string): Promise<{ message: string }> {
    return this.fetch(`/items/price-alert-mutes/${muteId}`, { method: 'DELETE' });
  }

  async getPriceInflation(startDate: string, endDate: string): Promise<{
    period: { start_date: string; end_date: string };
    overall_change_percent: number;
    items_compared: number;
    total_weighted_spend: number;
    items: any[];
  }> {
    const queryParams = new URLSearchParams({ start_date: startDate, end_date: endDate });
    return this.fetch(`/items/price-inflation?${queryParams.toString()}`);
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

  async getReorderNudges(): Promise<{
    nudges: { item_name: string; supplier: string; median_days_between: number; days_since_last: number; last_purchase_date: string }[];
  }> {
    return this.fetch('/items/reorder-nudges');
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
  async getExpenseForecast(monthsAhead: number = 3, range?: ForecastRange): Promise<any> {
    return this.fetch(`/forecast/expenses?months_ahead=${monthsAhead}${forecastRangeQuery(range)}`);
  }

  async getRevenueForecast(monthsAhead: number = 3, range?: ForecastRange): Promise<any> {
    return this.fetch(`/forecast/revenue?months_ahead=${monthsAhead}${forecastRangeQuery(range)}`);
  }

  // Audit Logs
  async getAuditLogs(params?: { action?: string; entity_type?: string; search?: string; limit?: number }): Promise<{ logs: any[] }> {
    const queryParams = new URLSearchParams();
    if (params?.action) queryParams.set('action', params.action);
    if (params?.entity_type) queryParams.set('entity_type', params.entity_type);
    if (params?.search) queryParams.set('search', params.search);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    const query = queryParams.toString();
    return this.fetch(`/audit-logs${query ? `?${query}` : ''}`);
  }

  async restoreAuditLogEntry(logId: string): Promise<{ message: string }> {
    return this.fetch(`/audit-logs/${logId}/restore`, { method: 'POST' });
  }

  // Personal Expenses (Owner only)
  async getPersonalExpenses(params?: { month?: number; year?: number; expense_type?: string; category?: string }): Promise<{ personal_expenses: PersonalExpense[] }> {
    const queryParams = new URLSearchParams();
    if (params?.month) queryParams.set('month', params.month.toString());
    if (params?.year) queryParams.set('year', params.year.toString());
    if (params?.expense_type) queryParams.set('expense_type', params.expense_type);
    if (params?.category) queryParams.set('category', params.category);
    const query = queryParams.toString();
    return this.fetch(`/personal-expenses${query ? `?${query}` : ''}`);
  }

  async createPersonalExpense(expense: {
    amount: number;
    description: string;
    expense_type: string;
    category: string;
    period_month: number;
    period_year: number;
    supplier_id?: string;
    project_name?: string;
    notes?: string;
  }): Promise<{ message: string; id: string }> {
    return this.fetch('/personal-expenses', {
      method: 'POST',
      body: JSON.stringify(expense),
    });
  }

  async deletePersonalExpense(id: string): Promise<{ message: string }> {
    return this.fetch(`/personal-expenses/${id}`, { method: 'DELETE' });
  }

  // Personal Wallet (Лично тефтерче) - gated on its own 3-tier permission,
  // separate from the business-investment tracking above.
  async getPersonalWalletEntries(params?: { category?: string; start_date?: string; end_date?: string }): Promise<{ entries: PersonalWalletEntry[] }> {
    const queryParams = new URLSearchParams();
    if (params?.category) queryParams.set('category', params.category);
    if (params?.start_date) queryParams.set('start_date', params.start_date);
    if (params?.end_date) queryParams.set('end_date', params.end_date);
    const query = queryParams.toString();
    return this.fetch(`/personal-wallet/entries${query ? `?${query}` : ''}`);
  }

  async createPersonalWalletEntry(entry: {
    category: PersonalWalletCategory;
    description: string;
    amount: number;
    date: string;
    is_recurring?: boolean;
    next_due_date?: string;
    recurring_until?: string | null;
    notes?: string;
  }): Promise<{ message: string; id: string }> {
    return this.fetch('/personal-wallet/entries', { method: 'POST', body: JSON.stringify(entry) });
  }

  async updatePersonalWalletEntry(id: string, update: Partial<{
    category: PersonalWalletCategory;
    description: string;
    amount: number;
    date: string;
    is_recurring: boolean;
    next_due_date: string | null;
    recurring_until: string | null;
    notes: string;
  }>): Promise<PersonalWalletEntry> {
    return this.fetch(`/personal-wallet/entries/${id}`, { method: 'PUT', body: JSON.stringify(update) });
  }

  async deletePersonalWalletEntry(id: string): Promise<{ message: string }> {
    return this.fetch(`/personal-wallet/entries/${id}`, { method: 'DELETE' });
  }

  async getPersonalWalletSummary(): Promise<PersonalWalletSummary> {
    return this.fetch('/personal-wallet/summary');
  }

  async getPersonalWalletSettings(): Promise<{ alert_threshold_percent: number }> {
    return this.fetch('/personal-wallet/settings');
  }

  async updatePersonalWalletSettings(alert_threshold_percent: number): Promise<{ alert_threshold_percent: number }> {
    return this.fetch('/personal-wallet/settings', { method: 'PUT', body: JSON.stringify({ alert_threshold_percent }) });
  }

  // ROI Analysis (Owner only)
  async getROIAnalysis(params?: { month?: number; year?: number }): Promise<{
    period: { month: number; year: number };
    total_personal_investment: number;
    total_revenue: number;
    total_profit: number;
    roi_percent: number;
    is_profitable: boolean;
    investment_covered: boolean;
    ai_insights: string[];
  }> {
    const queryParams = new URLSearchParams();
    if (params?.month) queryParams.set('month', params.month.toString());
    if (params?.year) queryParams.set('year', params.year.toString());
    const query = queryParams.toString();
    return this.fetch(`/roi/analysis${query ? `?${query}` : ''}`);
  }

  async getROITrend(months: number = 6): Promise<{ trend: any[]; months: number }> {
    return this.fetch(`/roi/trend?months=${months}`);
  }

  // Payroll / Ведомост за заплати
  async getEmployees(activeOnly?: boolean): Promise<Employee[]> {
    const query = activeOnly ? '?active_only=true' : '';
    return this.fetch(`/employees${query}`);
  }

  async createEmployee(employee: EmployeeCreate): Promise<Employee> {
    return this.fetch('/employees', { method: 'POST', body: JSON.stringify(employee) });
  }

  async updateEmployee(id: string, update: Partial<EmployeeCreate & { active: boolean }>): Promise<Employee> {
    return this.fetch(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(update) });
  }

  async deleteEmployee(id: string): Promise<void> {
    await this.fetch(`/employees/${id}`, { method: 'DELETE' });
  }

  async getPayrollRates(): Promise<PayrollRates> {
    return this.fetch('/payroll/rates');
  }

  async updatePayrollRates(rates: Partial<PayrollRates>): Promise<PayrollRates> {
    return this.fetch('/payroll/rates', { method: 'PUT', body: JSON.stringify(rates) });
  }

  async previewPayroll(params: { employee_id: string; period_month: number; period_year: number; gross_amount?: number; net_target?: number; bonus_amount?: number }): Promise<PayrollBreakdown> {
    return this.fetch('/payroll/preview', { method: 'POST', body: JSON.stringify(params) });
  }

  async createPayrollEntry(params: { employee_id: string; period_month: number; period_year: number; gross_amount?: number; net_target?: number; bonus_amount?: number; notes?: string; image_base64?: string }): Promise<PayrollEntry> {
    return this.fetch('/payroll', { method: 'POST', body: JSON.stringify(params) });
  }

  async getPayrollEntries(params?: { year?: number; month?: number }): Promise<PayrollEntry[]> {
    const queryParams = new URLSearchParams();
    if (params?.year) queryParams.set('year', params.year.toString());
    if (params?.month) queryParams.set('month', params.month.toString());
    const query = queryParams.toString();
    return this.fetch(`/payroll${query ? `?${query}` : ''}`);
  }

  async deletePayrollEntry(id: string): Promise<void> {
    await this.fetch(`/payroll/${id}`, { method: 'DELETE' });
  }

  // Official holidays (computed, public) + employee holiday-work / leave
  // tracking - lets an accountant pull a compliance list for a period.
  async getPublicHolidays(year: number): Promise<PublicHoliday[]> {
    return this.fetch(`/holidays?year=${year}`);
  }

  async getHolidayWorkEntries(params?: { start_date?: string; end_date?: string }): Promise<HolidayWorkEntry[]> {
    const query = new URLSearchParams();
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    const qs = query.toString();
    return this.fetch(`/employees/holiday-work${qs ? `?${qs}` : ''}`);
  }

  async createHolidayWorkEntry(params: { employee_id: string; date: string; note?: string }): Promise<HolidayWorkEntry> {
    return this.fetch('/employees/holiday-work', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async deleteHolidayWorkEntry(id: string): Promise<void> {
    await this.fetch(`/employees/holiday-work/${id}`, { method: 'DELETE' });
  }

  async getLeaveEntries(params?: { start_date?: string; end_date?: string }): Promise<LeaveEntry[]> {
    const query = new URLSearchParams();
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    const qs = query.toString();
    return this.fetch(`/employees/leave${qs ? `?${qs}` : ''}`);
  }

  async createLeaveEntry(params: { employee_id: string; leave_type: LeaveType; start_date: string; end_date: string; note?: string }): Promise<LeaveEntry> {
    return this.fetch('/employees/leave', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async deleteLeaveEntry(id: string): Promise<void> {
    await this.fetch(`/employees/leave/${id}`, { method: 'DELETE' });
  }

  // Fixed Assets / Дълготрайни активи (ДМА)
  async getAssetCategories(): Promise<AssetCategoriesResponse> {
    return this.fetch('/assets/categories');
  }

  async getAssets(status?: string): Promise<FixedAsset[]> {
    const query = status ? `?status=${status}` : '';
    return this.fetch(`/assets${query}`);
  }

  async createAsset(asset: FixedAssetCreate): Promise<FixedAsset> {
    return this.fetch('/assets', { method: 'POST', body: JSON.stringify(asset) });
  }

  async updateAsset(id: string, update: Partial<FixedAssetCreate>): Promise<FixedAsset> {
    return this.fetch(`/assets/${id}`, { method: 'PUT', body: JSON.stringify(update) });
  }

  async disposeAsset(id: string, params: { disposal_date: string; disposal_reason?: string }): Promise<FixedAsset> {
    return this.fetch(`/assets/${id}/dispose`, { method: 'POST', body: JSON.stringify(params) });
  }

  async deleteAsset(id: string): Promise<void> {
    await this.fetch(`/assets/${id}`, { method: 'DELETE' });
  }

  async getAssetsSummary(): Promise<AssetsSummary> {
    return this.fetch('/assets/summary');
  }

  // Team collaboration: calendar
  async getCalendarEvents(start?: string, end?: string): Promise<CalendarEvent[]> {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.fetch(`/calendar/events${query}`);
  }

  async createCalendarEvent(event: CalendarEventInput): Promise<CalendarEvent> {
    return this.fetch('/calendar/events', { method: 'POST', body: JSON.stringify(event) });
  }

  async updateCalendarEvent(id: string, update: Partial<CalendarEventInput>): Promise<CalendarEvent> {
    return this.fetch(`/calendar/events/${id}`, { method: 'PUT', body: JSON.stringify(update) });
  }

  async deleteCalendarEvent(id: string): Promise<void> {
    await this.fetch(`/calendar/events/${id}`, { method: 'DELETE' });
  }

  // Team collaboration: messages
  async getCollabMembers(): Promise<CollabMember[]> {
    return this.fetch('/collab/members');
  }

  async getConversations(): Promise<ConversationSummary[]> {
    return this.fetch('/messages/conversations');
  }

  async startDirectMessage(userId: string): Promise<{ conversation_id: string }> {
    return this.fetch('/messages/dm/start', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
  }

  async getMessages(conversationId: string, before?: string): Promise<Message[]> {
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    return this.fetch(`/messages/${encodeURIComponent(conversationId)}${query}`);
  }

  async sendMessage(conversationId: string, text: string): Promise<Message> {
    return this.fetch(`/messages/${encodeURIComponent(conversationId)}`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  async markConversationRead(conversationId: string): Promise<void> {
    await this.fetch(`/messages/${encodeURIComponent(conversationId)}/read`, { method: 'POST' });
  }

  // Web Push
  async subscribePush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
    await this.fetch('/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) });
  }

  async unsubscribePush(endpoint: string): Promise<void> {
    await this.fetch('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
  }

  // Feedback
  async submitFeedback(message: string, isAnonymous: boolean): Promise<{ message: string }> {
    return this.fetch('/feedback', {
      method: 'POST',
      body: JSON.stringify({ message, is_anonymous: isAnonymous }),
    });
  }
}

export const api = new ApiService();

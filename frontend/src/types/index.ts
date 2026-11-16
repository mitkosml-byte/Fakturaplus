export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  role: 'owner' | 'manager' | 'staff' | 'accountant';
  company_id?: string;
  permissions?: string[];
  has_password?: boolean;
  // A second step at login (a code from an authenticator app or by email).
  two_factor_enabled?: boolean;
  two_factor_method?: TwoFactorMethod | null;
  created_at: string;
}

// The parts of the program a business uses (the owner chooses): the till
// and pocket money, invoices issued to customers, the team and its
// schedule, payroll, fixed assets, the owner's personal wallet.
export type BusinessModule = 'till' | 'billing' | 'team' | 'payroll' | 'assets' | 'wallet';
export type BusinessModules = Record<BusinessModule, boolean>;

// Cash flow for the days ahead (Н1).
export interface CashFlowEvent {
  date: string;
  amount: number; // money in above zero, out below
  kind: 'receivable' | 'revenue' | 'invoice' | 'recurring' | 'payroll' | 'vat';
  label: string;
  overdue: boolean;
}

export interface CashFlowDay {
  date: string;
  in: number;
  out: number;
  revenue: number;
  balance: number;
}

export interface CashFlow {
  from: string;
  to: string;
  days: number;
  start_balance: number;
  end_balance: number;
  lowest: { date: string; balance: number };
  first_negative: string | null;
  total_in: number;
  total_out: number;
  usual_revenue_total: number;
  series: CashFlowDay[];
  events: CashFlowEvent[];
  position: { cash: number; bank: number; date: string; age_days: number } | null;
  overdue_receivables: number;
  receivables_without_due_date: number;
  usual_revenue_by_weekday: Record<string, number>;
  pay_day: number;
  notes: string[];
}

// Home's cards for a business that invoices.
export interface BillingOverview {
  issued_count: number;
  issued_total: number;
  total_owed: number;
  unpaid_count: number;
  total_overdue: number;
  overdue_count: number;
}

export type TwoFactorMethod = 'totp' | 'email';

// The password was right; the login waits for the code (or a recovery code).
export interface LoginChallenge {
  two_factor_required: true;
  challenge_token: string;
  method: TwoFactorMethod;
  // Email method only: false when the email could not be sent.
  code_sent?: boolean;
}

export interface LoginSession {
  user: User;
  session_token: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  method: TwoFactorMethod | null;
  recovery_codes_left: number;
  email_available: boolean;
  recommended: boolean;
}

export interface TwoFactorSetup {
  method: TwoFactorMethod;
  secret?: string;
  otpauth_uri?: string;
  sent_to?: string;
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
  // Registered for VAT, as the owner set it; null/absent = not answered
  // yet (the app then behaves as registered and asks once).
  vat_registered?: boolean | null;
  // Weekdays the business is normally closed (0=Monday..6=Sunday) - excluded
  // from "average per day" statistics instead of counting as zero-revenue.
  closed_weekdays?: number[];
  modules?: Partial<BusinessModules> | null;
  created_at: string;
  updated_at: string;
}

export interface ClosedDateException {
  id: string;
  company_id: string;
  date: string; // YYYY-MM-DD
  closed: boolean; // true = extra closure, false = reopens an otherwise-closed weekday
  label?: string;
  created_at: string;
}

export interface Invitation {
  id: string;
  company_id: string;
  invited_by: string;
  email?: string;
  phone?: string;
  role: 'owner' | 'manager' | 'staff' | 'accountant';
  permissions?: string[];
  code: string;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  expires_at: string;
  created_at: string;
}

// Multi-owner (ООД) protection: removing or demoting a co-owner is never
// unilateral - it becomes a pending request that the OTHER current owners
// must unanimously approve (see backend/server.py's request_owner_status_change).
export interface OwnerAction {
  id: string;
  company_id: string;
  target_user_id: string;
  target_name: string;
  action: 'remove' | 'manager' | 'staff' | 'accountant';
  requested_by: string;
  requested_by_name: string;
  required_approver_ids: string[];
  approved_by: string[];
  status: 'pending' | 'executed' | 'rejected';
  created_at: string;
  resolved_at?: string | null;
}

export interface UserActionResult {
  status: 'executed' | 'pending_approval';
  message: string;
  action?: OwnerAction;
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

// Cash and card are paid at the till; a bank transfer is owed until paid.
export type PaymentMethod = 'cash' | 'bank_transfer' | 'card';

// A supplier's credit note (goods returned, a discount on an earlier
// invoice) is kept with the invoices, its amounts stored below zero so it
// takes purchases and the VAT credit down; nothing is owed on it.
export type InvoiceDocumentType = 'invoice' | 'credit_note';

export interface Invoice {
  id: string;
  user_id: string;
  company_id?: string;
  supplier: string;
  supplier_eik?: string;
  invoice_number: string;
  // null/absent (invoices from before credit notes) or 'invoice' is an invoice.
  document_type?: InvoiceDocumentType | null;
  amount_without_vat: number;
  vat_amount: number;
  total_amount: number;
  vat_treatment?: VatTreatment;
  protocol_number?: string;
  date: string;
  image_base64?: string; // Legacy - едностранично сканиране
  image_base64s?: string[]; // Всички страници на сканираната фактура, по ред
  notes?: string;
  // What the backend actually stores/returns - full items, each with its
  // own id (needed to target one line item for correction) and computed
  // total_price/vat_amount. createInvoice overrides this back to
  // InvoiceItemCreate[] for the one call site building a NEW invoice,
  // where items don't have ids yet.
  items?: InvoiceItem[];
  payment_method?: PaymentMethod;
  is_paid: boolean;
  // Cumulative amount paid so far - "fully paid" means paid_amount >=
  // total_amount (is_paid is derived from this server-side). Lets a large
  // invoice be paid off in installments instead of all at once.
  paid_amount: number;
  payment_due_date?: string;
  paid_at?: string;
  // Each payment to the supplier on an invoice by bank, on its own day.
  payments?: ReceivablePayment[];
  created_at: string;
  // Set when this is a fixed asset's purchase invoice (not an expense of its day).
  asset_id?: string | null;
  // Credit note: the invoice it corrects ("към фактура №"), linked once entered.
  credited_invoice_number?: string | null;
  credited_invoice_id?: string | null;
  // Invoice: what credit notes to it took off - no longer owed; past what is
  // left to pay, the supplier's to refund or offset.
  credited_amount?: number;
}

// One VAT group of the till's daily report: its rate and its sales (with VAT).
export interface VatGroupAmount {
  rate_percent: number;
  amount: number;
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
  // The day by VAT rate (adding up to fiscal_revenue); empty when the
  // whole day is at vat_rate_percent.
  vat_groups?: VatGroupAmount[];
  created_at: string;
}

export interface NonInvoiceExpense {
  id: string;
  user_id: string;
  description: string;
  amount: number;
  date: string;
  created_at: string;
  // A recurring expense's payment for a month (recorded from Budget)
  recurring_id?: string | null;
  recurring_month?: string | null;
}

export interface Customer {
  id: string;
  company_id: string | null;
  user_id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  // What an invoice to them names.
  eik?: string | null;
  vat_number?: string | null;
  address?: string | null;
  created_at: string;
}

export interface CustomerInput {
  name: string;
  eik?: string | null;
  vat_number?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

// One customer at a glance: invoiced, owed and overdue now, their last
// documents and open debts.
export interface CustomerCard {
  customer: Customer;
  totals: {
    invoiced: number;
    invoice_count: number;
    last_invoice_date: string | null;
    owed: number;
    overdue: number;
    paid: number;
  };
  documents: {
    id: string;
    doc_type: BillingDocumentType;
    invoice_number?: string | null;
    issue_date: string;
    total_amount: number;
    cancelled?: boolean;
    external?: boolean;
    in_till?: boolean;
  }[];
  open_receivables: {
    id: string;
    description?: string | null;
    amount: number;
    left: number;
    due_date?: string | null;
    overdue: boolean;
  }[];
}

export interface Receivable {
  id: string;
  company_id: string | null;
  user_id: string;
  customer_id?: string | null;
  customer_name: string;
  description?: string | null;
  amount: number;
  due_date?: string | null;
  is_paid: boolean;
  paid_amount: number;
  paid_at?: string | null;
  // Each payment received (in part or in full), on its day and by its method.
  payments?: ReceivablePayment[];
  // Owed on an invoice the business issued - already revenue on its date,
  // so a payment on it is never offered as new revenue.
  billing_document_id?: string | null;
  revenue_counted?: boolean;
  // Taken off by credit notes to its invoice.
  credited_amount?: number;
  // Its document was cancelled after money came in: nothing is owed, what
  // was paid is the customer's to get back.
  cancelled?: boolean;
  // As shown: still owed, and to give back.
  left_amount?: number;
  refund_due?: number;
  created_at: string;
}

export interface ReceivablePayment {
  id: string;
  amount: number;
  date: string;
  method?: 'cash' | 'bank_transfer' | 'card' | null;
}

export interface BillingDocumentItem {
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;  // on an invoice: without VAT
  vat_rate?: number;   // an invoice's line only (20, 9, 0...)
}

// quote / bill: non-fiscal; invoice: issued to a customer - numbered in
// sequence, with VAT, revenue and VAT on its issue date, owed until paid.
// credit_note: a credit note to a customer on an invoice issued to them -
// numbered with the invoices, its amounts below zero.
export type BillingDocumentType = 'quote' | 'bill' | 'invoice' | 'credit_note';

export interface BillingDocument {
  id: string;
  company_id: string | null;
  user_id: string;
  doc_type: BillingDocumentType;
  customer_id?: string | null;
  customer_name: string;
  items: BillingDocumentItem[];
  notes?: string | null;
  issue_date: string;
  due_date?: string | null;
  total_amount: number;  // an invoice's is with VAT
  receivable_id?: string | null;
  invoice_number?: string | null;
  customer_eik?: string | null;
  customer_address?: string | null;
  payment_method?: 'cash' | 'bank_transfer' | 'card' | null;
  amount_without_vat?: number;
  vat_amount?: number;
  vat_by_rate?: { rate: number; base: number; vat: number }[];
  // Not registered for VAT: the invoice carries none and says why.
  vat_exempt_basis?: string | null;
  // A cancelled invoice keeps its number and counts for nothing.
  cancelled?: boolean;
  // Issued in another program and entered here with its own number.
  external?: boolean;
  // Paid in cash or by card through the till: its money is in that day's
  // till revenue already - not counted again as income or VAT.
  in_till?: boolean;
  // A credit note: the invoice it is to.
  credited_document_id?: string | null;
  credited_invoice_number?: string | null;
  credited_issue_date?: string | null;
  // An invoice: what its credit notes took off (above zero).
  credited_amount?: number;
  // A quote: valid until, its answer, and the bill or invoice made of it.
  valid_until?: string | null;
  quote_status?: 'open' | 'accepted' | 'declined' | null;
  converted_document_id?: string | null;
  // A bill or an invoice made of a quote.
  source_quote_id?: string | null;
  // Where a bill's or an invoice's money stands (as listed).
  payment_status?: 'paid' | 'partly_paid' | 'owed' | 'overdue' | 'credited' | null;
  paid_amount?: number | null;
  amount_left?: number | null;
  refund_due?: number | null;
  created_at: string;
}

// Proactive Second Brain engine (Module 11 Finding #1) - one ranked
// signal list over every other piece of intelligence the app computes.
// What the viewer can say about a Home signal. Money-at-risk signals offer
// only "snooze"; "dismiss" hides a signal until its situation changes
// (fingerprint); the reorder question offers still_buying/discontinue.
export type ProactiveSignalAction =
  | 'snooze' | 'dismiss' | 'still_buying' | 'discontinue' | 'mark_paid'
  // A recurring expense's month: paid - record it / skip it / is this it?
  | 'recurring_record' | 'recurring_skip' | 'recurring_yes' | 'recurring_no';

export interface ProactiveSignal {
  key: string;
  severity: 'critical' | 'warning' | 'info';
  priority: number;
  title: string;
  detail: string;
  route: string;
  fingerprint: string;
  actions: ProactiveSignalAction[];
  item_key?: string;
  // invoices_likely_paid only: the invoices "mark paid" applies to
  invoice_ids?: string[];
  // Recurring expense signals: which expense and month, and the record asked about
  recurring_id?: string;
  recurring_month?: string;
  match_source?: 'expense' | 'invoice';
  match_id?: string;
  // First shown to this viewer within the last day (or back after a while away)
  is_new?: boolean;
}

// Recurring expenses: "invoice" - its invoice is the expense, awaited each
// month; "no_invoice" - recorded as an off-book expense (asked, or on its day).
export type RecurringKind = 'invoice' | 'no_invoice';

export type RecurringState =
  | 'paid_by_invoice' | 'paid_by_expense' | 'skipped' | 'probable'
  | 'upcoming' | 'awaiting_invoice' | 'invoice_missing' | 'due';

export interface RecurringRecord {
  id: string;
  amount: number;
  date: string | null;
  number?: string | null;
  supplier?: string | null;
  description?: string | null;
  source?: 'expense' | 'invoice';
}

export interface RecurringOccurrence {
  recurring_id: string;
  month: string;
  due_date: string;
  expected_amount: number;
  kind: RecurringKind;
  state: RecurringState;
  paid_amount: number | null;
  invoices: RecurringRecord[];
  expenses: RecurringRecord[];
  // A record that looks like this month's payment - the owner says
  match: RecurringRecord | null;
  // Paid by an invoice and also recorded without one
  duplicate?: boolean;
  replace_automatically?: boolean;
  // Recorded without an invoice, and an invoice that looks the same came
  duplicate_suspected?: boolean;
}

export interface RecurringExpense {
  id: string;
  description: string;
  amount: number;
  day_of_month: number;
  category?: string | null;
  kind: RecurringKind;
  supplier_name?: string | null;
  supplier_eik?: string | null;
  auto_record: boolean;
  is_active: boolean;
  start_month: string;
  current: RecurringOccurrence | null;
  previous: RecurringOccurrence | null;
}

export interface RecurringExpenseInput {
  description: string;
  amount: number;
  day_of_month: number;
  kind: RecurringKind;
  supplier_name?: string | null;
  supplier_eik?: string | null;
  auto_record?: boolean;
  is_active?: boolean;
}

export interface RecurringOverview {
  recurring_expenses: RecurringExpense[];
  month: string | null;
  outlook: { paid_so_far: number; month_total: number; still_expected: number } | null;
}

// "Ask your own numbers" chat (Module 4 Finding #3)
export interface BusinessChatDigestPeriod {
  label: string;
  revenue: number;
  expenses: number;
  profit: number | null;
  invoice_count: number;
}

export interface BusinessChatDigestExpenseItem {
  name: string;
  amount: number;
  source: 'invoice' | 'off_book';
}

export interface BusinessChatDigest {
  this_month: BusinessChatDigestPeriod;
  last_month: BusinessChatDigestPeriod;
  top_expenses_this_month: BusinessChatDigestExpenseItem[];
  unpaid_invoices: {
    count: number;
    overdue_count: number;
    total_unpaid_amount: number;
  };
  budget: {
    expense_limit: number;
    total_spent: number;
    percent_used: number;
  } | null;
  receivables: {
    total_owed: number;
    unpaid_count: number;
    total_overdue: number;
    overdue_count: number;
  } | null;
  // null when the business is not registered for VAT (vat_registered false).
  vat_registered?: boolean;
  vat_due_this_month: number | null;
  forecast: {
    revenue: BusinessChatForecastSummary | null;
    expenses: BusinessChatForecastSummary | null;
  };
  roi: {
    total_personal_investment: number;
    total_profit: number | null;
    roi_percent: number | null;
    investment_covered: boolean | null;
  } | null;
  assets: {
    active_count: number;
    total_net_book_value: number;
    monthly_depreciation_total: number;
  } | null;
  payroll: {
    total_employer_cost: number;
    employee_count: number;
  } | null;
  schedule: {
    total_hours: number;
    estimated_pay: number;
    unpaid_amount: number;
    on_leave_today: string[];
  } | null;
  personal_wallet: {
    total_spent: number;
    status: 'ok' | 'warning' | 'danger';
    spent_percent_of_profit: number | null;
  } | null;
  scan_credits: {
    total_remaining: number;
    auto_reload_enabled: boolean;
  };
  price_alerts_unread_count: number;
  reorder_nudges: {
    item_name: string;
    days_since_last: number;
    median_days_between: number;
    avg_order_value: number;
    recommended_quantity: number;
    unit: string;
  }[];
  item_purchases: BusinessChatItemPurchase[];
}

export interface BusinessChatItemPurchase {
  name: string;
  quantity: number;
  unit: string;
  purchases_count: number;
  total_spent: number;
}

export interface BusinessChatForecastSummary {
  next_month_predicted: number;
  trend: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';
  months_of_history: number;
}

export interface BusinessChatHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface BusinessChatResponse {
  answer: string;
  digest: BusinessChatDigest;
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
  document_type?: InvoiceDocumentType | null;  // credit_note, ако е озаглавен "КРЕДИТНО ИЗВЕСТИЕ" (сумите са без минус)
  credited_invoice_number?: string | null;  // при кредитно известие: "към фактура №"
  buyer?: string | null;  // получателят - за фактура, издадена от самата фирма
  buyer_eik?: string | null;
  amount_without_vat: number;
  vat_amount: number;
  total_amount: number;
  invoice_date?: string;  // Дата на издаване от фактурата
  payment_due_date?: string;  // Срок за плащане, ако е отпечатан на фактурата
  payment_method?: PaymentMethod | null;  // Начин на плащане, ако е отпечатан на фактурата
  items?: OCRItemResult[];  // Разпознати продукти от таблицата с артикули
  corrections?: string[];  // AI корекции
  confidence?: number;  // Увереност в резултата
}

export interface FinancialVisibility {
  // The overarching gate - without view_statistics, every field below that
  // is typed `number | null` comes back null regardless of the other three
  // flags (a newly invited staff member has none of these by default).
  statistics: boolean;
  pocket_money: boolean;
  off_book_expenses: boolean;
  profit: boolean;
  personal_investments: boolean;
}

export interface Summary {
  // null (not 0) when this viewer's permissions hide the field - every
  // total below is already recomputed as if it were zero in that case.
  total_invoice_amount: number | null;
  total_invoice_vat: number | null;
  total_fiscal_revenue: number | null;
  // Invoices issued to customers in the period (with VAT) - part of income.
  total_issued_invoices?: number | null;
  // false: the business is not registered for VAT - no VAT cards.
  vat_registered?: boolean;
  issued_invoice_count?: number | null;
  issued_invoice_vat?: number | null;
  total_pocket_money: number | null;
  fiscal_vat: number | null;
  vat_to_pay: number | null;
  total_non_invoice_expenses: number | null;
  total_payroll_cost: number | null;
  total_depreciation_expense: number | null;
  total_income: number | null;
  total_expense: number | null;
  profit: number | null;
  invoice_count: number | null;
  total_cash_revenue: number | null;
  total_card_revenue: number | null;
  // Invoices issued and paid by bank: with cash and card, the whole income.
  total_bank_revenue?: number | null;
  total_unpaid_amount: number | null;
  unpaid_invoice_count: number | null;
  total_overdue_amount: number | null;
  overdue_invoice_count: number | null;
  financial_visibility: FinancialVisibility;
  // The days these totals cover: a period still running is counted through
  // today (through_date), the rest of it hasn't happened yet.
  period?: { start_date: string; end_date: string; days: number; through_date: string };
  revenue_day_count?: number;
  pace?: SummaryPace | null;
}

// How a period is going, day by day (backend server.period_pace).
export interface SummaryPace {
  is_current: boolean;
  open_days: number;
  open_days_so_far: number;
  // Days revenue was entered on - the divisor of the average; a day
  // nobody entered is unknown, never a zero day.
  revenue_days: number;
  avg_per_revenue_day: number | null;
  // Average per day x every open day of the period - only while it runs.
  expected_income: number | null;
}

export interface ReorderItem {
  item_name: string;
  supplier: string;
  unit: string;
  median_days_between: number;
  days_since_last: number;
  last_purchase_date: string;
  avg_order_value: number;
  // Trend-adjusted suggested order size for this item's next cycle - this
  // item's own trailing per-day purchase rate, scaled by how the
  // company's overall revenue has trended lately. 0 whenever not enough
  // revenue data exists on either side to say anything about a trend.
  recommended_quantity: number;
  trend_ratio: number;
}

export interface WeekdayRevenueStat {
  weekday: number; // 0=Monday..6=Sunday, matches date.weekday()
  avg_revenue: number;
  days_observed: number;
}

export interface WeakDaySuggestion {
  weekday: number;
  avg_revenue: number;
  overall_avg_revenue: number;
  percent_below_average: number;
}

export interface StaffingEfficiencyStat {
  weekday: number;
  avg_revenue: number;
  avg_scheduled_hours: number;
  revenue_per_labor_hour: number;
}

export interface StaffingRebalanceSuggestion {
  overstaffed_weekday: number;
  understaffed_weekday: number;
  overstaffed_hours: number;
  understaffed_hours: number;
  overstaffed_percent_of_average: number;
  understaffed_percent_of_average: number;
  suggested_hours_to_move: number;
}

export interface ChartDataPoint {
  date: string;
  label: string;
  income: number;
  // Includes the bucket's share of the month's payroll and depreciation
  // (fixed_costs), so the buckets add up to the summary's total expense.
  expense: number;
  fixed_costs?: number;
  vat: number;
  is_closed: boolean;
  has_revenue?: boolean;
  bucket?: 'day' | 'month';
  revenue_days?: number;
  open_days?: number;
}

export interface NotificationSettings {
  id: string;
  user_id: string;
  daily_push_enabled: boolean;
  daily_push_hour: number;
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
  // Null ends when no period was asked for: the whole history.
  period: {
    start_date: string | null;
    end_date: string | null;
  };
  // What "active" means: bought from in the chosen period, or - for the
  // whole history - a delivery in the last 30 days.
  activity_basis?: 'period' | 'last_30_days';
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
    // Fixed-asset purchases in the total (not the day's expense).
    assets_total?: number;
  };
  top_by_amount: SupplierStats[];
  top_by_frequency: SupplierStats[];
  top_by_avg: SupplierStats[];
  inactive_suppliers: SupplierStats[];
  high_dependency_alerts: SupplierStats[];
  all_suppliers: SupplierStats[];
}

export type SupplierGroupBy = 'day' | 'week' | 'month' | 'year';

// One calendar day, week (Monday-Sunday), month or year of a supplier's
// purchases - present even when nothing was bought (amount 0).
export interface SupplierSeriesPoint {
  key: string;
  label: string;
  start: string;
  end: string;
  amount: number;
  count: number;
  // Reaches past the chosen period (a week cut by its first day) or is
  // still running - not a whole one, so never compared with one.
  is_partial: boolean;
  // Against the whole bucket before it - only between two whole ones.
  growth_percent: number | null;
}

export interface SupplierDetailedResponse {
  supplier: string;
  found: boolean;
  // The days the totals and the series cover (up to today).
  period?: { start_date: string; end_date: string } | null;
  group_by?: SupplierGroupBy;
  series?: SupplierSeriesPoint[];
  overview?: {
    total_amount: number;
    total_vat: number;
    total_net: number;
    invoice_count: number;
    // Credit notes apart (they take their amount off the total), and the
    // fixed-asset purchases included in it (depreciated, not a day's expense).
    credit_note_count?: number;
    credit_note_total?: number;
    assets_total?: number;
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
    is_partial?: boolean;
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
    document_type?: 'invoice' | 'credit_note';
    is_asset?: boolean;
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
  // Scan review only (never stored on the line): this line was re-read as
  // k pieces per invoice unit - remembered for the supplier + item - or a
  // remembered pack size the app applied was undone (forgotten).
  pack_multiple_applied?: number;
  pack_rule_rejected?: boolean;
}

// Corrects one already-saved line item on an existing invoice (e.g. OCR
// read "1 бр." for what was actually a 6-pack) - id identifies which item,
// every other field is optional and only sent when it actually changed.
// total_price/vat_amount are recomputed server-side, not sent here.
export interface InvoiceItemUpdate {
  id: string;
  name?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
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
  direction: 'increase' | 'decrease';
  baseline_purchase_count: number;
  invoice_id: string;
  invoice_number: string;
  status: 'unread' | 'read' | 'dismissed';
  created_at: string;
  // "pack_suspect": the new unit price is exactly a pack multiple of the
  // usual one - a question about a likely misread, not a price rise.
  kind?: 'price_change' | 'pack_suspect';
  // (new - old) x usual monthly quantity, EUR per month
  monthly_impact?: number | null;
  pack_multiple?: number | null;
  unit?: string | null;
  line_item_id?: string | null;
}

// Scan-review preview of what a recognized line would raise once saved
// (POST /items/price-check) - index points into the request's items.
export interface ItemPriceHint {
  index: number;
  // pack_rule: a pack size learned from an earlier correction, applied
  // automatically in scan review (with undo)
  kind: 'price_change' | 'pack_suspect' | 'pack_rule';
  auto_apply?: boolean;
  old_price: number | null;
  new_price: number;
  change_percent: number | null;
  direction: 'increase' | 'decrease';
  pack_multiple: number | null;
  monthly_impact: number | null;
  unit: string | null;
}

// The ROI card ("Лични вложения", GET /roi/analysis): does the business pay
// back what the owner put in, what moved profit, what can be done - each
// part with its own plain-language line.
export interface RoiMover {
  kind: 'revenue' | 'supplier' | 'off_book';
  label: string;
  current: number;
  usual: number;
  delta: number;
  // + helps profit, - hurts it (a supplier's rise is a negative effect)
  profit_effect: number;
  text: string;
}

export interface RoiAction {
  kind: 'price_increases' | 'cheaper_supplier' | 'missing_revenue';
  monthly_eur: number | null;
  route: string;
  text: string;
}

export interface RoiAnalysisDetail {
  payback: { invested: number; profit: number; coverage: number; months: number; text: string } | null;
  month: { personal: number; profit: number; partial: boolean; through_day: number | null; text: string } | null;
  movers: RoiMover[];
  actions: RoiAction[];
  notes: string[];
  profit_visible: boolean;
}

// AI advice on the ROI facts (GET /roi/advice) - kept until the numbers change.
export interface RoiAdviceResponse {
  available: boolean;
  advice: { headline: string; points: string[] } | null;
  cached?: boolean;
}

// Scan review, before saving (POST /invoices/draft-check): do the amounts
// add up, and which line is most likely wrong if not. Indexes point into
// the request's items.
export interface InvoiceDraftFix {
  index: number;
  unit_price: number;
}

export type InvoiceDraftCause =
  | 'ok'
  | 'line_values'
  | 'vat_included'
  | 'duplicate_line'
  | 'decimal_slip'
  | 'missing_line'
  | 'extra';

export interface InvoiceDraftCheck {
  header: { expected_total: number; total_amount: number; difference: number } | null;
  lines: {
    sum: number;
    base: number;
    difference: number;
    ok: boolean;
    cause: InvoiceDraftCause | null;
    fixes: InvoiceDraftFix[];
    remove_index: number | null;
    index: number | null;
    factor: number | null;
  } | null;
  // quantity x price differs from the line's printed value; the price and
  // (when plausible) the quantity that would match it.
  line_flags: {
    index: number;
    kind: 'line_value_mismatch';
    computed: number;
    printed: number;
    unit_price?: number;
    quantity?: number;
  }[];
}

export interface PriceAlertMute {
  id: string;
  item_name: string;
  supplier: string;
}

export interface PriceAlertSettings {
  threshold_percent: number;
  min_monthly_impact: number;
  alert_on_decrease: boolean;
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
  // The line unit the quantity is counted in ("кг", "бр."), or the base
  // unit when all purchases convert to one; null when they mix units.
  unit?: string | null;
  // Price per kg / l / piece, when every purchase converts to the same one.
  base_unit?: string | null;
  avg_base_price?: number | null;
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
  // Quantity is only ranked within one unit: 40 kg and 400 pieces are not
  // "more" than each other. Keyed by the unit label, most common unit first.
  top_by_quantity_by_unit?: Record<string, ItemStatistics[]>;
  top_by_value: ItemStatistics[];
  top_by_frequency: ItemStatistics[];
  price_trends: ItemStatistics[];
}

// The same product in another pack size, compared per kg / l / piece.
export interface ItemOtherSize {
  item_name: string;
  avg_base_price: number;
  base_unit: string;
  purchase_count: number;
  difference_percent: number | null;
}

// The owner's own catalog: names joined with an item, look-alikes not yet
// joined, and names the owner said are a different product.
export interface RelatedItems {
  item_name: string;
  merged_with: string[];
  similar: { item_name: string; similarity: number }[];
  different_from: string[];
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
  // Optional link to this same person's own app account (a team member
  // with their own login) - distinct from `user_id` above, which is who
  // CREATED this payroll record. Used by the work-schedule feature to
  // cross-check a shift against this employee's already-recorded leave.
  linked_user_id?: string | null;
  // Paid annual leave in working days a year, and the unused days carried
  // into a year (entered once).
  annual_leave_days?: number;
  leave_carryover?: { year: number; days: number } | null;
  created_at: string;
}

// An employee's paid leave in a year, in working days.
export interface LeaveBalance {
  employee_id: string;
  employee_name: string;
  year: number;
  annual_leave_days: number;
  carried_over: number;
  entitlement: number;
  used: number;
  planned: number;
  remaining: number;
}

export interface EmployeeCreate {
  name: string;
  position?: string;
  hire_date?: string;
  base_salary: number;
  agreement_type: PayrollAgreementType;
  food_vouchers?: number;
  additional_insurance?: number;
  linked_user_id?: string | null;
}

export type ShiftRepeatPattern = 'none' | 'daily' | 'weekly' | 'monthly';

export interface WorkShift {
  id: string;
  company_id: string;
  user_id: string;
  created_by: string;
  date: string; // "YYYY-MM-DD" - anchor/first occurrence
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM" - may be before start_time (overnight shift)
  repeat_pattern: ShiftRepeatPattern;
  repeat_until?: string | null;
  hourly_rate?: number | null;
  note?: string | null;
  created_at: string;
}

export interface WorkShiftCreate {
  user_id: string;
  date: string;
  start_time: string;
  end_time: string;
  repeat_pattern?: ShiftRepeatPattern;
  repeat_until?: string | null;
  hourly_rate?: number | null;
  note?: string | null;
}

export interface ShiftOccurrence {
  shift_id: string;
  user_id: string;
  user_name: string;
  date: string;
  start_time: string;
  end_time: string;
  // The planned duration from start_time/end_time - stays fixed even
  // once `hours` below is overridden by a correction.
  scheduled_hours: number;
  // The duration to actually use (hours worked + pay) - the scheduled
  // duration, or the corrected one when `adjusted` is true.
  hours: number;
  hourly_rate?: number | null;
  note?: string | null;
  repeat_pattern: ShiftRepeatPattern;
  repeat_until?: string | null;
  leave_conflict: boolean;
  // Counted in pay: not a day of the person's leave, unless a manager
  // recorded the hours actually worked that day (an adjustment).
  payable: boolean;
  adjusted: boolean;
  adjustment_reason?: string | null;
  adjusted_by_name?: string | null;
}

export interface ShiftAdjustmentCreate {
  actual_hours: number;
  actual_hourly_rate?: number | null;
  reason: string;
}

export interface ScheduleSummary {
  total_hours: number;
  estimated_pay: number;
  shift_count: number;
  // Shifts on a day of the person's leave - not counted in hours or pay.
  leave_days_excluded?: number;
}

export interface SchedulePaymentCreate {
  user_id: string;
  period_start: string;
  period_end: string;
  // The person's formal payroll already covers the month: pay anyway.
  confirm_double_pay?: boolean;
}

export interface SchedulePayment {
  id: string;
  company_id: string;
  user_id: string;
  user_name: string;
  period_start: string;
  period_end: string;
  total_hours: number;
  amount: number;
  expense_id: string;
  paid_by: string;
  paid_by_name: string;
  created_at: string;
}

// Pays several team members in one action - some on a fixed monthly
// salary (formal payroll), others hourly (Work Schedule) - see pay-run.tsx.
export interface BatchPayrollItem {
  employee_id: string;
  period_month: number;
  period_year: number;
  confirm_double_pay?: boolean;
}

export interface BatchPayRequest {
  payroll_entries: BatchPayrollItem[];
  schedule_payments: SchedulePaymentCreate[];
}

export interface BatchPayResultItem {
  kind: 'payroll' | 'schedule';
  label: string;
  success: boolean;
  error?: string | null;
  amount?: number | null;
  // Already paid for the month the other way - pay only after a yes.
  needs_confirmation?: boolean;
  ref?: string | null;
}

// Manager-only team member profile (opened from an avatar tap, e.g. the
// work-schedule grid) + private positive/negative performance notes.
export type TeamNoteType = 'positive' | 'negative';

export interface TeamNoteCreate {
  user_id: string;
  note_type: TeamNoteType;
  text: string;
}

export interface TeamNote {
  id: string;
  company_id: string;
  user_id: string;
  note_type: TeamNoteType;
  text: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
}

export interface TeamNotesResponse {
  notes: TeamNote[];
  positive_count: number;
  negative_count: number;
  net_score: number;
}

export interface TeamMemberIdentity {
  user_id: string;
  name: string;
  email: string;
  picture?: string | null;
  role: 'owner' | 'manager' | 'staff' | 'accountant';
  permissions: string[];
  created_at: string;
}

// Deliberately narrower than the full Employee type - no salary/agreement
// here, that stays in the Payroll screen where it already lives.
export interface TeamMemberEmployeeInfo {
  id: string;
  name: string;
  position?: string | null;
  hire_date?: string | null;
  active: boolean;
}

export interface TeamMemberProfile {
  member: TeamMemberIdentity;
  employee: TeamMemberEmployeeInfo | null;
  schedule_summary: ScheduleSummary;
  leave_entries: LeaveEntry[];
  holiday_work_entries: HolidayWorkEntry[];
  notes: TeamNotesResponse;
}

// A leave entry resolved to the SAME person's real login (user_id) rather
// than the payroll-only employee_id - what the work-schedule grid needs
// to show "on leave" blocks keyed the same way it already keys shifts.
export interface ScheduleLeaveEntry {
  id: string;
  user_id: string;
  employee_name: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  note?: string | null;
}

export interface PayrollRateValues {
  employee_rate_percent: number;
  employer_rate_percent: number;
  income_tax_percent: number;
  min_insurance_income: number;
  max_insurance_income: number;
}

// The rates in effect in a month, and every dated version ("в сила от").
export interface PayrollRates extends PayrollRateValues {
  effective_from?: string | null;  // "YYYY-MM" of the version in effect
  versions?: (PayrollRateValues & { effective_from: string })[];
}

export interface PayrollBreakdown {
  gross_amount: number;
  insurance_base: number;
  employee_contributions: number;
  employer_contributions: number;
  income_tax: number;
  // Advance/garnishment/other withholding distinct from social
  // contributions and income tax - only ever non-zero for an entry
  // imported from the accountant's own ведомост PDF.
  other_deductions: number;
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
  // Whether this entry counts toward total business expenses - absent
  // on entries created before this field existed, which means "yes"
  // (the same default new entries get), not "unknown".
  counted_in_expenses?: boolean;
  // Absent for a manually-entered/estimated entry - "accountant_import"
  // for one created from a parsed ведомост PDF (see PayrollImportEntry).
  source?: 'accountant_import';
  created_at: string;
}

// One parsed person from the accountant's own ведомост PDF
// (POST /payroll/import/preview), before the user has confirmed/adjusted
// the employee match - egn is shown only for the user to visually confirm
// identity, never sent back on commit or persisted anywhere.
export interface PayrollImportEntry {
  name: string;
  egn?: string | null;
  position?: string | null;
  gross_amount: number;
  insurance_base: number;
  employee_contributions: number;
  employer_contributions: number;
  income_tax: number;
  other_deductions: number;
  net_amount: number;
  matched_employee_id: string | null;
  matched_employee_name: string | null;
  match_confidence: number;
  already_imported: boolean;
}

export interface PayrollImportPreviewResponse {
  period_month: number;
  period_year: number;
  entries: PayrollImportEntry[];
}

export interface PayrollImportCommitEntry {
  employee_id: string;
  period_month: number;
  period_year: number;
  gross_amount: number;
  insurance_base: number;
  employee_contributions: number;
  employer_contributions: number;
  income_tax: number;
  other_deductions: number;
  net_amount: number;
}

export interface PayrollImportCommitResult {
  imported: number;
  skipped: { employee_id: string; message: string }[];
  total: number;
}

// Official Bulgarian public holidays (computed, not stored) and
// per-employee holiday-work / leave tracking for accountant compliance.
export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface HolidayWorkEntry {
  id: string;
  company_id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  holiday_name: string;
  note?: string;
  created_at: string;
}

export type LeaveType = 'paid' | 'unpaid' | 'sick';

export interface LeaveEntry {
  id: string;
  company_id: string;
  employee_id: string;
  employee_name: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  note?: string;
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
  // Its purchase invoice: while linked, that invoice is not an expense of
  // its day - the depreciation is - and its VAT is still a credit.
  invoice_id?: string | null;
  invoice_label?: string | null;
}

export interface LinkableInvoice {
  id: string;
  supplier: string;
  invoice_number: string;
  date: string | null;
  total_amount: number;
  amount_without_vat: number;
  first_item?: string | null;
  asset_id?: string | null;
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
  // "" removes the link (on an update).
  invoice_id?: string;
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
  // Expenses already held (same day, description and amount) - not imported again.
  already_present?: number;
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

export type PersonalExpenseType = 'investment' | 'recurring' | 'one_time';
export type PersonalExpenseCategory = 'goods' | 'service' | 'personnel' | 'rent' | 'extraordinary' | 'other';

export interface PersonalExpense {
  id: string;
  user_id: string;
  company_id: string;
  amount: number;
  description: string;
  expense_type: PersonalExpenseType;
  category: PersonalExpenseCategory;
  period_month: number;
  period_year: number;
  supplier_id?: string | null;
  project_name?: string | null;
  notes?: string | null;
  created_at: string;
}

export type PersonalWalletCategory =
  | 'loan' | 'lease' | 'utility' | 'insurance' | 'subscription' | 'daily' | 'one_off';

export interface PersonalWalletEntry {
  id: string;
  user_id: string;
  company_id: string;
  category: PersonalWalletCategory;
  description: string;
  amount: number;
  date: string;
  is_recurring: boolean;
  next_due_date?: string | null;
  recurring_until?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface PersonalWalletUpcoming {
  description: string;
  amount: number;
  next_due_date: string;
  recurring_until?: string | null;
  category: PersonalWalletCategory;
}

export interface PersonalWalletSummary {
  period: { start: string; end: string };
  total_spent: number;
  prev_month_total_spent: number;
  category_totals: Partial<Record<PersonalWalletCategory, number>>;
  needs_total: number;
  wants_total: number;
  profit_this_month: number;
  safe_to_spend: number;
  threshold_percent: number;
  spent_percent_of_profit: number | null;
  status: 'ok' | 'warning' | 'danger';
  upcoming: PersonalWalletUpcoming[];
  advice: string[];
}

// Scan credits - see ScanCreditService on the backend. The app's only
// metered feature: everything else stays free, AI invoice scanning is
// paid for beyond a small free monthly quota, shared company-wide.
export interface ScanBalance {
  free_remaining: number;
  free_quota: number;
  free_reset_at: string;
  purchased_balance: number;
  total_remaining: number;
  auto_reload_enabled: boolean;
  auto_reload_package_id?: string | null;
}

export type ScanTransactionType = 'scan_used' | 'purchase';

export interface ScanTransaction {
  id: string;
  type: ScanTransactionType;
  delta: number;
  description: string;
  price_eur?: number | null;
  created_at: string;
}

export interface ScanPackage {
  id: string;
  name: string;
  total_scans: number;
  bonus_scans: number;
  price_eur: number;
  price_per_scan: number;
}

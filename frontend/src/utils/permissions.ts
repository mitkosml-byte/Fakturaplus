import type { Language } from '../i18n';

export type Permission =
  | 'manage_users'
  | 'manage_company'
  | 'view_audit_log'
  | 'manage_budget'
  | 'export_data'
  | 'view_statistics'
  | 'manage_invoices'
  | 'add_revenue'
  | 'add_expenses';

export type ConfigurableRole = 'manager' | 'staff' | 'accountant';

// Mirrors backend/server.py's ROLE_PERMISSIONS - the set a role starts with
// the moment someone is invited or switched to it, before any fine-tuning
// via the permissions checklist.
export const ROLE_DEFAULT_PERMISSIONS: Record<ConfigurableRole, Permission[]> = {
  manager: ['manage_budget', 'export_data', 'view_statistics', 'manage_invoices', 'add_revenue', 'add_expenses'],
  staff: ['manage_invoices', 'add_revenue', 'add_expenses'],
  accountant: ['view_audit_log', 'manage_budget', 'export_data', 'view_statistics', 'manage_invoices'],
};

// Mirrors backend/server.py's ROLE_CONFIGURABLE_PERMISSIONS - the checkboxes
// the owner is allowed to see and tick for that role. manage_users and
// manage_company never appear here for anyone but the owner.
const STAFF_LIKE_CONFIGURABLE: Permission[] = [
  'view_audit_log', 'manage_budget', 'export_data', 'view_statistics',
  'manage_invoices', 'add_revenue', 'add_expenses',
];

export const ROLE_CONFIGURABLE_PERMISSIONS: Record<ConfigurableRole, Permission[]> = {
  manager: STAFF_LIKE_CONFIGURABLE,
  staff: STAFF_LIKE_CONFIGURABLE,
  // Deliberately narrow - an accountant's checklist only ever shows what an
  // accountant actually needs, per explicit product decision: no operational
  // (add_revenue/add_expenses) or organizational (manage_users/manage_company)
  // permissions on offer, so the owner is never asked to think about those
  // for this role.
  accountant: ['view_audit_log', 'manage_budget', 'export_data', 'view_statistics', 'manage_invoices'],
};

export const PERMISSION_LABELS: Record<Permission, { bg: string; en: string }> = {
  manage_users: { bg: 'Управление на потребители', en: 'Manage users' },
  manage_company: { bg: 'Настройки на фирмата', en: 'Company settings' },
  view_audit_log: { bg: 'Одит лог', en: 'Audit log' },
  manage_budget: { bg: 'Бюджет, ведомости, ДМА', en: 'Budget, payroll, fixed assets' },
  export_data: { bg: 'Износ на данни (Excel/PDF)', en: 'Export data (Excel/PDF)' },
  view_statistics: { bg: 'Разширена статистика', en: 'Advanced statistics' },
  manage_invoices: { bg: 'Фактури', en: 'Invoices' },
  add_revenue: { bg: 'Въвеждане на оборот', en: 'Enter revenue' },
  add_expenses: { bg: 'Въвеждане на разходи', en: 'Enter expenses' },
};

export function getPermissionLabel(permission: Permission, language: Language): string {
  return PERMISSION_LABELS[permission]?.[language] || permission;
}

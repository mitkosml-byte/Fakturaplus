import type { Language } from '../i18n';

const ROLE_NAMES: Record<string, { bg: string; en: string }> = {
  owner: { bg: 'Титуляр', en: 'Owner' },
  manager: { bg: 'Мениджър', en: 'Manager' },
  staff: { bg: 'Служител', en: 'Staff' },
  accountant: { bg: 'Счетоводител', en: 'Accountant' },
};

const ROLE_COLORS: Record<string, string> = {
  owner: '#8B5CF6',
  manager: '#3B82F6',
  staff: '#64748B',
  accountant: '#F59E0B',
};

export function getRoleName(role: string, language: Language): string {
  return ROLE_NAMES[role]?.[language] || role;
}

export function getRoleColor(role: string): string {
  return ROLE_COLORS[role] || '#64748B';
}

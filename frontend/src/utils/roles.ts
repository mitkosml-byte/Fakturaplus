import type { Language } from '../i18n';
import { COLORS } from '../theme/colors';

const ROLE_NAMES: Record<string, { bg: string; en: string }> = {
  owner: { bg: 'Титуляр', en: 'Owner' },
  manager: { bg: 'Мениджър', en: 'Manager' },
  staff: { bg: 'Служител', en: 'Staff' },
  accountant: { bg: 'Счетоводител', en: 'Accountant' },
};

const ROLE_COLORS: Record<string, string> = {
  owner: COLORS.primary,
  manager: COLORS.info,
  staff: COLORS.textMuted,
  accountant: COLORS.warning,
};

export function getRoleName(role: string, language: Language): string {
  return ROLE_NAMES[role]?.[language] || role;
}

export function getRoleColor(role: string): string {
  return ROLE_COLORS[role] || COLORS.textMuted;
}

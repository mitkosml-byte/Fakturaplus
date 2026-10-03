/**
 * Shared color palette for Фактура+.
 *
 * Every screen previously wrote these same hex values directly inside its
 * own StyleSheet.create({...}) - #8B5CF6 alone appeared 47 times in just
 * stats.tsx. That made a rebrand or a light/dark toggle mean touching
 * dozens of files instead of one. Import COLORS and reference the named
 * constant instead of a raw hex literal.
 */
export const COLORS = {
  // Brand accent - primary buttons, active tabs/chips, links.
  primary: '#8B5CF6',
  // Lighter tint of the brand accent - headings/labels on a dark card
  // that still need to read as "on-brand" without full button contrast.
  primaryLight: '#C4B5FD',

  // Surfaces, darkest to lightest.
  background: '#0F172A',
  surface: '#1E293B',
  border: '#334155',
  borderLight: '#475569',

  // Text, darkest/most muted to lightest.
  textMuted: '#64748B',
  textSecondary: '#94A3B8',
  textSubtle: '#CBD5E1',
  textLight: '#E2E8F0',

  // Status colors.
  success: '#10B981',
  successLight: '#6EE7B7',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  warningDark: '#D97706',
  danger: '#EF4444',
  info: '#3B82F6',

  // Rare accents (chart palette, rank badges).
  pink: '#EC4899',
  indigo: '#6366F1',
  teal: '#14B8A6',
  orange: '#F97316',
  lime: '#84CC16',
  bronze: '#CD7F32',
} as const;

// Cycling palette for multi-series charts (stats.tsx) - one place to
// reorder/extend instead of a hex array duplicating names above.
export const CHART_PALETTE: string[] = [
  COLORS.primary,
  COLORS.success,
  COLORS.warning,
  COLORS.danger,
  COLORS.info,
  COLORS.pink,
  COLORS.teal,
  COLORS.orange,
  COLORS.indigo,
  COLORS.lime,
];

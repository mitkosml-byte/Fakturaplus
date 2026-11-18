import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import type { Summary } from '../../types';

type Props = { summary: Summary; usesTill: boolean };

// How the period's income came in: in cash, by card, by bank (invoices paid
// by transfer). Cash and card are the till's - shown without a till only
// when money came so. Moved here from Home (Л4).
export function PaymentKindsCard({ summary, usesTill }: Props) {
  const { t } = useTranslation();
  const rows: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; value: number | null | undefined }[] = [];
  if (usesTill || (summary.total_cash_revenue || 0) > 0 || (summary.total_card_revenue || 0) > 0) {
    rows.push({ key: 'cash', label: t('home.cashRevenue'), icon: 'cash-outline', color: COLORS.success, value: summary.total_cash_revenue });
    rows.push({ key: 'card', label: t('home.cardRevenue'), icon: 'card-outline', color: COLORS.info, value: summary.total_card_revenue });
  }
  if ((summary.total_bank_revenue || 0) > 0) {
    rows.push({ key: 'bank', label: t('home.bankRevenue'), icon: 'business-outline', color: COLORS.primary, value: summary.total_bank_revenue });
  }
  if (rows.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('stats.paymentKinds')}</Text>
      {rows.map((row, index) => (
        <View key={row.key} style={[styles.row, index > 0 && styles.rowDivider]}>
          <Ionicons name={row.icon} size={18} color={row.color} />
          <Text style={styles.label}>{row.label}</Text>
          {row.value === null ? (
            <Ionicons name="lock-closed" size={14} color={COLORS.textMuted} />
          ) : (
            <Text style={[styles.value, { color: row.color }]}>{(row.value || 0).toFixed(2)} €</Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  title: { color: 'white', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  label: { flex: 1, color: COLORS.textSecondary, fontSize: 13 },
  value: { fontSize: 15, fontWeight: '700' },
});

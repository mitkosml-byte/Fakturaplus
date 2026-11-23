import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useTranslation } from '../../i18n';
import type { VatOutlook } from '../../types';
import { COLORS } from '../../theme/colors';
import { formatMoney } from '../../utils/money';

// The VAT the business owes (backend routers/vat.py): the period's VAT to
// pay, the day it is paid by, where a running month is heading, and last
// month's VAT while its 14th has not passed - right under Home's numbers.
// Only for a business registered for VAT and whoever sees the totals.
export function VatCard({ vat }: { vat: VatOutlook | null | undefined }) {
  const { t, dateLocale } = useTranslation();
  if (!vat?.registered || vat.due === undefined || !vat.period) return null;

  const monthName = (key: string) => format(parseISO(`${key}-01`), 'LLLL', { locale: dateLocale });
  const day = (text: string) => format(parseISO(text), 'd MMMM', { locale: dateLocale });
  const reclaim = vat.due < 0;
  const when = vat.month
    ? `${(vat.running ? t('vat.monthSoFar') : t('vat.forMonth')).replace('{month}', monthName(vat.month))}${
      vat.pay_by ? ` · ${t('vat.payBy').replace('{date}', day(vat.pay_by))}` : ''}`
    : t('vat.forPeriod');

  return (
    <View style={styles.card}>
      {vat.previous && vat.previous.due !== 0 && (
        <View style={styles.previous}>
          <Ionicons name="alarm-outline" size={16} color={COLORS.warning} />
          <Text style={styles.previousText}>
            {(vat.previous.due > 0 ? t('vat.previous') : t('vat.previousReclaim'))
              .replace('{month}', monthName(vat.previous.month))
              .replace('{amount}', formatMoney(Math.abs(vat.previous.due)))
              .replace('{date}', day(vat.previous.pay_by))}
          </Text>
        </View>
      )}

      <View style={styles.header}>
        <Ionicons name="receipt-outline" size={20} color={COLORS.primaryLight} />
        <Text style={styles.title} numberOfLines={1}>{reclaim ? t('vat.reclaimTitle') : t('vat.title')}</Text>
      </View>
      <Text style={[styles.amount, { color: reclaim ? COLORS.success : COLORS.danger }]} numberOfLines={1}>
        {formatMoney(Math.abs(vat.due))}
      </Text>
      <Text style={styles.when}>{when}</Text>

      {vat.expected_due != null && (
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('vat.expected')}</Text>
          <Text style={[styles.rowValue, vat.expected_due < 0 && { color: COLORS.success }]}>
            ≈{formatMoney(Math.abs(vat.expected_due))}
            {vat.expected_due < 0 ? ` ${t('vat.toReclaim')}` : ''}
          </Text>
        </View>
      )}
      <Text style={styles.parts}>
        {t('vat.parts')
          .replace('{sales}', formatMoney(vat.sales_vat || 0))
          .replace('{purchases}', formatMoney(vat.purchase_vat || 0))}
        {vat.expected_due != null ? ` · ${t('vat.expectedHint')}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  previous: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  previousText: { flex: 1, fontSize: 13, color: COLORS.warningLight, lineHeight: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: 'white' },
  amount: { fontSize: 28, fontWeight: 'bold', marginTop: 8 },
  when: { fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  rowLabel: { flexShrink: 1, fontSize: 13, color: COLORS.textSecondary },
  rowValue: { fontSize: 15, fontWeight: '700', color: 'white' },
  parts: { fontSize: 12, color: COLORS.textMuted, marginTop: 8, lineHeight: 17 },
});

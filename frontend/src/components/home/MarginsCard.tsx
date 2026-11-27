import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { useTranslation } from '../../i18n';
import type { Margin, PeriodMargins } from '../../types';
import { COLORS } from '../../theme/colors';
import { formatMoney } from '../../utils/money';

type Props = {
  margins: PeriodMargins | null | undefined;
  // May the viewer set up recurring expenses? Then the hint leads there.
  canManageBudget: boolean;
};

// The period's gross, operating and net margin (backend routers/margins.py):
// how much of every euro of sales is left after the goods, after running
// the business and after the profit tax - three numbers and how each moved
// since the period before; a tap shows where they come from.
export function MarginsCard({ margins, canManageBudget }: Props) {
  const { t, language, dateLocale } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!margins?.available || !margins.gross || !margins.operating || !margins.net || !margins.costs) return null;

  const english = language === 'en';
  const percent = (value: number) => {
    const text = Math.abs(value).toFixed(1);
    return `${value < 0 ? '−' : ''}${english ? text : text.replace('.', ',')}%`;
  };
  const day = (text: string) => format(parseISO(text), 'd MMM', { locale: dateLocale });
  const range = (period: { start_date: string; end_date: string }) =>
    period.start_date === period.end_date ? day(period.start_date) : `${day(period.start_date)} – ${day(period.end_date)}`;

  const costs = margins.costs;
  // Without payroll, rent or depreciation in the period the operating
  // margin is the gross one: shown once, with a word on why.
  const runningCosts = costs.payroll + costs.recurring + costs.depreciation > 0;
  const columns: { key: string; label: string; margin: Margin; color: string; approx?: boolean }[] = [
    { key: 'gross', label: t('margins.gross'), margin: margins.gross, color: COLORS.primary },
    ...(runningCosts ? [{ key: 'operating', label: t('margins.operating'), margin: margins.operating, color: COLORS.info }] : []),
    { key: 'net', label: t('margins.net'), margin: margins.net, color: COLORS.success, approx: true },
  ];
  const tax = String(margins.profit_tax_percent).replace('.', english ? '.' : ',');
  // Over a short stretch the goods are whatever deliveries fell in it (no
  // stock is kept): a week's margin moves with the day the big delivery came.
  const shortPeriod = !!margins.period
    && differenceInCalendarDays(parseISO(margins.period.end_date), parseISO(margins.period.start_date)) + 1 < 14;
  const sales = margins.sales || 0;
  const ofSales = (margins.vat_excluded ? t('margins.ofSalesNoVat') : t('margins.ofSales')).replace('{amount}', formatMoney(sales));

  // The way down from the sales to what is left: each cost, and each margin's profit after it.
  const steps: { key: string; label: string; amount: number; total?: boolean }[] = [
    { key: 'sales', label: margins.vat_excluded ? t('margins.salesNoVat') : t('margins.sales'), amount: sales, total: true },
    { key: 'goods', label: t('margins.goods'), amount: -costs.goods },
    { key: 'gross', label: t('margins.grossProfit'), amount: margins.gross.profit, total: true },
    ...(costs.payroll > 0 ? [{ key: 'payroll', label: t('margins.payroll'), amount: -costs.payroll }] : []),
    ...(costs.recurring > 0 ? [{ key: 'recurring', label: t('margins.recurring'), amount: -costs.recurring }] : []),
    ...(costs.depreciation > 0 ? [{ key: 'depreciation', label: t('margins.depreciation'), amount: -costs.depreciation }] : []),
    ...(runningCosts ? [{ key: 'operating', label: t('margins.operatingProfit'), amount: margins.operating.profit, total: true }] : []),
    ...(costs.profit_tax > 0 ? [{ key: 'tax', label: t('margins.tax').replace('{rate}', tax), amount: -costs.profit_tax }] : []),
    { key: 'net', label: t('margins.netProfit'), amount: margins.net.profit, total: true },
  ];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => setOpen(!open)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${t('margins.title')}: ${columns.map((c) => `${c.label} ${percent(c.margin.percent)}`).join(', ')}`}
    >
      {/* One row on Home (P1-5): the margins in a line, the rest on a tap. */}
      <View style={[styles.header, open && { marginBottom: 12 }]}>
        <Ionicons name="pie-chart-outline" size={20} color={COLORS.primaryLight} />
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{t('margins.title')}</Text>
          {!open && (
            <Text style={styles.summary} numberOfLines={2}>
              {columns.map((c) => `${c.label} ${c.approx ? '≈' : ''}${percent(c.margin.percent)}`).join(' · ')}
            </Text>
          )}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
      </View>

      {open && (
      <>
      <View style={styles.columns}>
        {columns.map((column) => {
          const value = column.margin.percent;
          const change = column.margin.change;
          return (
            <View key={column.key} style={styles.column}>
              <Text style={styles.label} numberOfLines={1}>{column.label}</Text>
              <Text style={[styles.value, value < 0 && { color: COLORS.danger }]} numberOfLines={1}>
                {column.approx ? '≈' : ''}{percent(value)}
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: column.color }]} />
              </View>
              {change !== null && (
                <View style={styles.changeRow}>
                  <Ionicons
                    name={change > 0 ? 'caret-up' : change < 0 ? 'caret-down' : 'remove'}
                    size={11}
                    color={change > 0 ? COLORS.success : change < 0 ? COLORS.danger : COLORS.textMuted}
                  />
                  <Text
                    style={[styles.change, { color: change > 0 ? COLORS.success : change < 0 ? COLORS.danger : COLORS.textMuted }]}
                    numberOfLines={1}
                  >
                    {percent(Math.abs(change)).replace('%', '')} {t('margins.pp')}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <Text style={styles.line}>
        {ofSales}
        {margins.previous_period && columns.some((c) => c.margin.change !== null)
          ? ` · ${t('margins.versus').replace('{range}', range(margins.previous_period))}`
          : ''}
      </Text>
      {!runningCosts && <Text style={styles.line}>{t('margins.noRunningCosts')}</Text>}
      {shortPeriod && <Text style={styles.line}>{t('margins.shortPeriod')}</Text>}

        <View style={styles.details}>
          {steps.map((step) => (
            <View key={step.key} style={[styles.row, step.total && step.key !== 'sales' && styles.rowTotal]}>
              <Text style={[styles.rowLabel, step.total && styles.bold]} numberOfLines={2}>{step.label}</Text>
              <Text style={[styles.rowValue, step.total && styles.bold, step.total && step.amount < 0 && { color: COLORS.danger }]}>
                {step.amount < 0 && !step.total ? '−' : ''}{formatMoney(step.total ? step.amount : Math.abs(step.amount))}
              </Text>
            </View>
          ))}
          <Text style={styles.note}>{t('margins.grossHint')}</Text>
          {runningCosts && <Text style={styles.note}>{t('margins.operatingHint')}</Text>}
          <Text style={styles.note}>{t('margins.netHint').replace('{rate}', tax)}</Text>
          {margins.vat_excluded && <Text style={styles.note}>{t('margins.vatNote')}</Text>}
          {costs.recurring > 0 && <Text style={styles.note}>{t('margins.recurringNote')}</Text>}
          {(costs.payroll_expected || 0) > 0 && (
            <Text style={styles.note}>{t('margins.payrollExpected').replace('{amount}', formatMoney(costs.payroll_expected))}</Text>
          )}
          {margins.payroll_left_out && <Text style={styles.note}>{t('breakEven.payrollHidden')}</Text>}
          {margins.no_recurring_costs && (
            <TouchableOpacity
              style={styles.hint}
              onPress={() => router.push('/budget')}
              disabled={!canManageBudget}
              accessibilityRole={canManageBudget ? 'button' : undefined}
            >
              <Ionicons name="information-circle-outline" size={16} color={COLORS.warning} />
              <Text style={styles.hintText}>{t('margins.noRecurring')}</Text>
              {canManageBudget && <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />}
            </TouchableOpacity>
          )}
        </View>
      </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600', color: 'white' },
  summary: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  columns: { flexDirection: 'row', gap: 12 },
  column: { flex: 1, minWidth: 0 },
  label: { fontSize: 12, color: COLORS.textSecondary },
  value: { fontSize: 20, fontWeight: 'bold', color: 'white', marginTop: 2 },
  track: { height: 6, borderRadius: 3, backgroundColor: COLORS.background, marginTop: 6, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6 },
  change: { fontSize: 12, fontWeight: '600' },
  line: { fontSize: 12, color: COLORS.textMuted, marginTop: 12 },
  details: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 3 },
  rowTotal: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, marginTop: 2, paddingTop: 5 },
  rowLabel: { flexShrink: 1, fontSize: 13, color: COLORS.textSecondary },
  rowValue: { fontSize: 13, color: COLORS.textLight },
  bold: { fontWeight: '700', color: 'white' },
  note: { fontSize: 12, color: COLORS.textMuted, lineHeight: 17, marginTop: 6 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  hintText: { flex: 1, fontSize: 12, color: COLORS.textSecondary, lineHeight: 17 },
});

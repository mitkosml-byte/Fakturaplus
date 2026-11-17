import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from '../../i18n';
import { api } from '../../services/api';
import type { BreakEven } from '../../types';
import { COLORS } from '../../theme/colors';

type Props = {
  // May the viewer set up recurring expenses? Then the hint leads there.
  canManageBudget: boolean;
  // Changes whenever Home reloads, so the card follows.
  refreshSignal?: unknown;
};

const money = (n: number) => `${n.toFixed(2)} €`;

// The day's target (Н5): what the month has to sell to end at zero - its
// fixed costs over the usual margin - and what that asks of today. One
// number for the day instead of a page of statistics; a tap shows where it
// comes from.
export function BreakEvenCard({ canManageBudget, refreshSignal }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [data, setData] = useState<BreakEven | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getBreakEven()
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [refreshSignal]);

  if (!data) return null;

  if (!data.available) {
    // Only what the person can do something about is worth a line on Home.
    if (data.reason !== 'no_fixed_costs' || !canManageBudget) return null;
    return (
      <TouchableOpacity style={styles.hint} onPress={() => router.push('/budget')} accessibilityRole="button">
        <Ionicons name="flag-outline" size={18} color={COLORS.textSecondary} />
        <Text style={styles.hintText}>{t('breakEven.addFixedCosts')}</Text>
        <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
      </TouchableOpacity>
    );
  }

  const reached = !!data.reached;
  const fixed = data.fixed_costs!;
  const daysLeft = data.open_days_left || 0;
  const accent = reached ? COLORS.success : COLORS.primary;

  return (
    <TouchableOpacity
      style={[styles.card, { borderColor: accent }]}
      onPress={() => setOpen(!open)}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <View style={styles.header}>
        <Ionicons name={reached ? 'trophy' : 'flag'} size={22} color={accent} />
        <Text style={styles.title} numberOfLines={1}>
          {reached ? t('breakEven.reachedTitle') : t('breakEven.title')}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
      </View>

      {reached ? (
        <>
          <Text style={[styles.big, { color: COLORS.success }]}>+{money(data.above || 0)}</Text>
          <Text style={styles.sub}>{t('breakEven.reachedText')}</Text>
        </>
      ) : daysLeft > 0 ? (
        <>
          <Text style={styles.big}>{money(data.daily_target || 0)}</Text>
          <Text style={styles.sub}>
            {data.today_is_open
              ? t('breakEven.todayTarget').replace('{amount}', money(data.income_today || 0))
              : t('breakEven.nextDaysTarget')}
          </Text>
        </>
      ) : (
        <>
          <Text style={[styles.big, { color: COLORS.warning }]}>−{money(data.missing || 0)}</Text>
          <Text style={styles.sub}>{t('breakEven.missingAtEnd')}</Text>
        </>
      )}

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round((data.progress || 0) * 100)}%`, backgroundColor: accent }]} />
      </View>
      <Text style={styles.line}>
        {t('breakEven.monthLine')
          .replace('{soFar}', money(data.income_so_far || 0))
          .replace('{target}', money(data.break_even_income || 0))}
        {!reached && daysLeft > 0 ? ` · ${t('breakEven.daysLeft').replace('{days}', String(daysLeft))}` : ''}
      </Text>

      {open && (
        <View style={styles.details}>
          <Text style={styles.detailsTitle}>{t('breakEven.howTitle')}</Text>
          {fixed.payroll > 0 && (
            <View style={styles.row}><Text style={styles.rowLabel}>{t('breakEven.payroll')}</Text><Text style={styles.rowValue}>{money(fixed.payroll)}</Text></View>
          )}
          {fixed.recurring > 0 && (
            <View style={styles.row}><Text style={styles.rowLabel}>{t('breakEven.recurring')}</Text><Text style={styles.rowValue}>{money(fixed.recurring)}</Text></View>
          )}
          {fixed.depreciation > 0 && (
            <View style={styles.row}><Text style={styles.rowLabel}>{t('breakEven.depreciation')}</Text><Text style={styles.rowValue}>{money(fixed.depreciation)}</Text></View>
          )}
          <View style={[styles.row, styles.rowTotal]}>
            <Text style={[styles.rowLabel, styles.bold]}>{t('breakEven.fixedTotal')}</Text>
            <Text style={[styles.rowValue, styles.bold]}>{money(fixed.total)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('breakEven.margin')}</Text>
            <Text style={styles.rowValue}>{(data.margin_percent || 0).toFixed(1)}%</Text>
          </View>
          <Text style={styles.note}>
            {data.margin_basis?.kind === 'this_month' ? t('breakEven.marginThisMonth') : t('breakEven.marginLastMonths')}
          </Text>
          <Text style={styles.note}>{t('breakEven.formula')}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: 'white' },
  big: { fontSize: 32, fontWeight: 'bold', color: 'white' },
  sub: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  track: { height: 8, borderRadius: 4, backgroundColor: COLORS.background, marginTop: 14, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  line: { fontSize: 13, color: COLORS.textSecondary, marginTop: 8 },
  details: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  detailsTitle: { fontSize: 13, fontWeight: '600', color: COLORS.textSubtle, marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  rowTotal: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4, paddingTop: 6 },
  rowLabel: { fontSize: 13, color: COLORS.textSecondary },
  rowValue: { fontSize: 13, color: COLORS.textLight },
  bold: { fontWeight: '700', color: 'white' },
  note: { fontSize: 12, color: COLORS.textMuted, lineHeight: 17, marginTop: 6 },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  hintText: { flex: 1, fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },
});

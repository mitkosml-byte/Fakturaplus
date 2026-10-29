import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from '../i18n';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { Summary } from '../types';
import { COLORS } from '../theme/colors';

// Module 4 audit finding: FACTURA+ already computes everything needed for
// a daily "how is my business doing" check - unpaid invoices, today's
// price alerts, today's revenue vs. the usual pattern, budget status -
// but each one only ever surfaced on its own separate tab. This card pulls
// them into one glanceable place at the top of Home, reusing data Home
// already computes (summary, avgDailyTurnover) plus the existing
// price-alert/budget endpoints - no new backend logic, just one
// aggregated view.
type Props = {
  summary: Summary | null;
  avgDailyTurnover: number;
  // Any value that changes whenever Home's own data reloads (its `summary`
  // object works) - adding revenue/an expense right on Home should refresh
  // this card's own figures too, not just on the next screen focus.
  refreshSignal?: unknown;
};

type Row = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  text: string;
  onPress: () => void;
};

// A revenue swing has to be a real gap either way to be worth a row - a
// few percent either side of normal isn't news, it's just how retail days
// naturally vary.
const REVENUE_GAP_THRESHOLD_PERCENT = 15;

export function MorningBriefingCard({ summary, avgDailyTurnover, refreshSignal }: Props) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [todayRevenue, setTodayRevenue] = useState<number | null>(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [budgetStatus, setBudgetStatus] = useState<any>(null);

  const canSeeAlerts = hasPermission('view_statistics');
  const canSeeBudget = hasPermission('manage_budget');

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.getTodayRevenue().then((d) => d.fiscal_revenue).catch(() => null),
      canSeeAlerts ? api.getPriceAlerts('unread').then((d) => d.unread_count).catch(() => 0) : Promise.resolve(0),
      canSeeBudget ? api.getBudgetStatus().catch(() => null) : Promise.resolve(null),
    ]).then(([revenue, alertCount, budget]) => {
      setTodayRevenue(revenue);
      setUnreadAlerts(alertCount);
      setBudgetStatus(budget && budget.has_budget ? budget : null);
    }).finally(() => setLoading(false));
  }, [canSeeAlerts, canSeeBudget]);

  useFocusEffect(refresh);
  // t()/refresh() are recreated every render - only refreshSignal should retrigger this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [refreshSignal]);

  const rows: Row[] = [];

  if ((summary?.unpaid_invoice_count || 0) > 0) {
    const overdue = summary?.overdue_invoice_count || 0;
    rows.push({
      key: 'unpaid',
      icon: overdue > 0 ? 'alert-circle' : 'time-outline',
      color: overdue > 0 ? COLORS.danger : COLORS.warning,
      text: overdue > 0
        ? t('briefing.unpaidOverdue')
            .replace('{count}', String(summary!.unpaid_invoice_count))
            .replace('{overdue}', String(overdue))
        : t('briefing.unpaid').replace('{count}', String(summary!.unpaid_invoice_count)),
      onPress: () => router.push({ pathname: '/(tabs)/invoices', params: { paymentFilter: 'unpaid' } }),
    });
  }

  if (unreadAlerts > 0) {
    rows.push({
      key: 'alerts',
      icon: 'pricetag',
      color: COLORS.warning,
      text: t('briefing.priceAlerts').replace('{count}', String(unreadAlerts)),
      onPress: () => router.push('/(tabs)/stats'),
    });
  }

  if (budgetStatus && (budgetStatus.is_exceeded || budgetStatus.is_alert)) {
    rows.push({
      key: 'budget',
      icon: 'wallet',
      color: budgetStatus.is_exceeded ? COLORS.danger : COLORS.warning,
      text: t('briefing.budget').replace('{percent}', String(budgetStatus.percent_used)),
      onPress: () => router.push('/budget'),
    });
  }

  if (todayRevenue !== null && avgDailyTurnover > 0) {
    const diffPercent = ((todayRevenue - avgDailyTurnover) / avgDailyTurnover) * 100;
    if (Math.abs(diffPercent) >= REVENUE_GAP_THRESHOLD_PERCENT) {
      const isUp = diffPercent >= 0;
      rows.push({
        key: 'revenue',
        icon: isUp ? 'trending-up' : 'trending-down',
        color: isUp ? COLORS.success : COLORS.danger,
        text: (isUp ? t('briefing.revenueUp') : t('briefing.revenueDown')).replace(
          '{percent}',
          String(Math.round(Math.abs(diffPercent)))
        ),
        onPress: () => router.push('/(tabs)/stats'),
      });
    }
  }

  if (loading && rows.length === 0) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="small" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="sunny" size={20} color={COLORS.primary} />
        <Text style={styles.title}>{t('briefing.title')}</Text>
      </View>

      {rows.length === 0 ? (
        <View style={styles.allClearRow}>
          <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
          <Text style={styles.allClearText}>{t('briefing.allClear')}</Text>
        </View>
      ) : (
        rows.map((row) => (
          <TouchableOpacity key={row.key} style={styles.row} onPress={row.onPress}>
            <View style={[styles.rowIcon, { backgroundColor: `${row.color}26` }]}>
              <Ionicons name={row.icon} size={16} color={row.color} />
            </View>
            <Text style={styles.rowText}>{row.text}</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
  },
  allClearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  allClearText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    fontSize: 13,
    color: 'white',
  },
});

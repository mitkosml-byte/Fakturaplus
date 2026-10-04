import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from '../i18n';
import { api } from '../services/api';
import { PersonalWalletSummary } from '../types';
import { Expandable } from './Expandable';
import { CountUp } from './CountUp';
import { Skeleton } from './Skeleton';
import { COLORS } from '../theme/colors';

const STATUS_COLORS: Record<string, string> = {
  ok: COLORS.success,
  warning: COLORS.warning,
  danger: COLORS.danger,
};

const STATUS_KEYS: Record<string, string> = {
  ok: 'wallet.statusOk',
  warning: 'wallet.statusWarning',
  danger: 'wallet.statusDanger',
};

// Home's teaser into the full "Лично тефтерче" screen - collapsed by
// default (same collapsible-header pattern as ClosedDaysCalendar) so it
// doesn't permanently eat space on the dashboard, but the one number that
// matters (safe-to-spend) is visible the moment it's opened.
type Props = {
  // Any value that changes whenever the Home screen's own data reloads
  // (its `summary` object is a convenient one) - a revenue/expense added
  // right on Home changes this month's profit, which this teaser's own
  // safe-to-spend figure depends on, so it needs to refresh on that same
  // trigger instead of only on the next screen focus.
  refreshSignal?: unknown;
};

export function PersonalWalletTeaser({ refreshSignal }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<PersonalWalletSummary | null>(null);

  const refresh = useCallback(() => {
    api.getPersonalWalletSummary()
      .then(setSummary)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(refresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { refresh(); }, [refreshSignal]);

  const statusColor = summary ? STATUS_COLORS[summary.status] : COLORS.textMuted;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded((p) => !p)}>
        <Ionicons name="wallet-outline" size={20} color={COLORS.primary} />
        <Text style={styles.headerTitle}>{t('wallet.homeTeaserTitle')}</Text>
        {summary && !loading && (
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        )}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.primary} />
      </TouchableOpacity>

      <Expandable expanded={expanded}>
        <View style={styles.body}>
          {loading ? (
            <Skeleton height={48} borderRadius={10} />
          ) : summary ? (
            <>
              <Text style={styles.label}>{t('wallet.safeToSpend')}</Text>
              <CountUp
                value={summary.safe_to_spend}
                formatter={(n) => `${n.toFixed(2)} €`}
                style={[styles.value, { color: statusColor }]}
              />
              <Text style={[styles.statusText, { color: statusColor }]}>
                {t(STATUS_KEYS[summary.status])}
              </Text>
              <TouchableOpacity style={styles.openButton} onPress={() => router.push('/personal-expenses')}>
                <Text style={styles.openButtonText}>{t('wallet.homeTeaserOpen')}</Text>
                <Ionicons name="arrow-forward" size={16} color={COLORS.primary} />
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      </Expandable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: 'white' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  label: { fontSize: 12, color: COLORS.textMuted },
  value: { fontSize: 24, fontWeight: 'bold', marginTop: 2 },
  statusText: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingVertical: 10,
  },
  openButtonText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
});

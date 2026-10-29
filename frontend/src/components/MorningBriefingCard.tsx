import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from '../i18n';
import { api } from '../services/api';
import { ProactiveSignal } from '../types';
import { COLORS } from '../theme/colors';

// Module 4 Finding #3 (Home card) + Module 11 Finding #1 (the engine
// behind it): this card used to compute its own ad-hoc mix of unpaid
// invoices/price alerts/budget/today's-revenue-vs-average locally. It now
// simply renders whatever the backend's unified Proactive Second Brain
// engine (GET /proactive/signals) ranks highest - the same ranked list
// that engine's once-daily digest push reads from - so a new signal added
// there (a sixth or seventh source) shows up here automatically, with no
// change needed in this component.
type Props = {
  // Any value that changes whenever Home's own data reloads (its `summary`
  // object works) - adding revenue/an expense right on Home should refresh
  // this card's own signals too, not just on the next screen focus.
  refreshSignal?: unknown;
};

const SEVERITY_ICON: Record<ProactiveSignal['severity'], keyof typeof Ionicons.glyphMap> = {
  critical: 'alert-circle',
  warning: 'time-outline',
  info: 'information-circle-outline',
};

const SEVERITY_COLOR: Record<ProactiveSignal['severity'], string> = {
  critical: COLORS.danger,
  warning: COLORS.warning,
  info: COLORS.info,
};

export function MorningBriefingCard({ refreshSignal }: Props) {
  const { t } = useTranslation();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState<ProactiveSignal[]>([]);

  const refresh = useCallback(() => {
    setLoading(true);
    api.getProactiveSignals()
      .then((data) => setSignals(data.signals || []))
      .catch(() => setSignals([]))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(refresh);
  // refresh() is recreated every render - only refreshSignal should retrigger this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [refreshSignal]);

  if (loading && signals.length === 0) {
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

      {signals.length === 0 ? (
        <View style={styles.allClearRow}>
          <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
          <Text style={styles.allClearText}>{t('briefing.allClear')}</Text>
        </View>
      ) : (
        signals.map((signal) => (
          <TouchableOpacity
            key={signal.key}
            style={styles.row}
            onPress={() => router.push(signal.route as any)}
          >
            <View style={[styles.rowIcon, { backgroundColor: `${SEVERITY_COLOR[signal.severity]}26` }]}>
              <Ionicons name={SEVERITY_ICON[signal.severity]} size={16} color={SEVERITY_COLOR[signal.severity]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{signal.title}</Text>
              <Text style={styles.rowDetail}>{signal.detail}</Text>
            </View>
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
  rowTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
  },
  rowDetail: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
});

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from '../i18n';
import { api } from '../services/api';
import { ProactiveSignal, ProactiveSignalAction } from '../types';
import { COLORS } from '../theme/colors';
import { Toast } from '../utils/toast';
import { Alert } from '../utils/alert';

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

// Pure observations - nothing to "do", so "dismiss" reads as "Hide" there
// and as "Done" on everything else.
const INSIGHT_KEYS = new Set([
  'weak_weekday', 'staffing_mismatch', 'forecast_revenue', 'forecast_expense', 'team_on_leave', 'personal_wallet',
]);

function actionLabelKey(signal: ProactiveSignal, action: ProactiveSignalAction): string {
  switch (action) {
    case 'snooze':
      return 'briefing.snooze';
    case 'dismiss':
      return INSIGHT_KEYS.has(signal.key) ? 'briefing.hide' : 'briefing.done';
    case 'still_buying':
      return 'briefing.stillBuying';
    case 'discontinue':
      return 'briefing.discontinue';
  }
}

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

  // Home's own useFocusEffect(loadData) already fires on every focus and
  // always ends in a fresh `summary` object (its new refreshSignal), so a
  // second, independent useFocusEffect here used to fire the identical
  // request again on that same focus event - this component's own data
  // changing only ever needs the refreshSignal effect, not both. The null
  // check skips the very first render, where refreshSignal is still
  // Home's initial `null` summary - firing then just means this exact same
  // request fires again moments later once Home's own load resolves.
  // refresh() is recreated every render - only refreshSignal should retrigger this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (refreshSignal != null) refresh(); }, [refreshSignal]);

  // The answer is remembered server-side, so the signal doesn't come back
  // tomorrow unchanged; it leaves the list at once and returns if saving fails.
  const act = async (signal: ProactiveSignal, action: ProactiveSignalAction) => {
    setSignals((prev) => prev.filter((s) => s !== signal));
    try {
      await api.updateSignalState({
        key: signal.key, fingerprint: signal.fingerprint, action, item_key: signal.item_key,
      });
      if (action === 'snooze') Toast.success(t('briefing.snoozed'));
      if (action === 'discontinue') Toast.success(t('briefing.discontinued'));
    } catch (error: any) {
      setSignals((prev) => [...prev, signal].sort((a, b) => b.priority - a.priority));
      Alert.alert(t('common.error'), error?.message || '');
    }
  };

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
          <View key={`${signal.key}-${signal.fingerprint}`} style={styles.row}>
            <TouchableOpacity style={styles.rowMain} onPress={() => router.push(signal.route as any)}>
              <View style={[styles.rowIcon, { backgroundColor: `${SEVERITY_COLOR[signal.severity]}26` }]}>
                <Ionicons name={SEVERITY_ICON[signal.severity]} size={16} color={SEVERITY_COLOR[signal.severity]} />
              </View>
              <View style={{ flex: 1 }}>
                {/* "info" signals are soft, pattern-based suggestions (e.g.
                    a reorder nudge), never an actual problem - the Daily
                    Review used to give them the exact same bold title as a
                    genuine critical/warning alert, making a minor restocking
                    hint LOOK as urgent as overdue invoices or depleted scan
                    credits. Only critical/warning get the bold treatment. */}
                <Text style={signal.severity === 'info' ? styles.rowTitleSoft : styles.rowTitle}>{signal.title}</Text>
                <Text style={styles.rowDetail}>{signal.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
            {(signal.actions || []).length > 0 && (
              <View style={styles.actionsRow}>
                {signal.actions.map((action) => (
                  <TouchableOpacity
                    key={action}
                    style={[styles.actionBtn, action === 'discontinue' && styles.actionBtnStrong]}
                    onPress={() => act(signal, action)}
                  >
                    <Text style={[styles.actionText, action === 'discontinue' && styles.actionTextStrong]}>
                      {t(actionLabelKey(signal, action))}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
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
    paddingVertical: 8,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    marginLeft: 38,
  },
  actionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnStrong: {
    borderColor: COLORS.primary,
  },
  actionText: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  actionTextStrong: {
    color: COLORS.primary,
    fontWeight: '600',
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
  rowTitleSoft: {
    fontSize: 13,
    fontWeight: '400',
    color: COLORS.textSecondary,
  },
  rowDetail: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
});

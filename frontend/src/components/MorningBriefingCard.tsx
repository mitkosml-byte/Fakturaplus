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
  'weak_weekday', 'staffing_mismatch', 'forecast_revenue', 'forecast_expense', 'year_back_revenue', 'year_back_expense',
  'team_on_leave', 'personal_wallet', 'recurring_replaced',
]);

// The review shows the few most important things first; the rest wait
// behind "show more".
const VISIBLE_SIGNALS = 3;

// The one thing to do about each kind of signal - its button opens the
// exact place (the signal's own route: the right tab, filter or day).
// Signals answered by an action itself (mark paid, still buying / stopped
// buying) have none: their action buttons are the thing to do.
const CTA_LABEL: Record<string, string> = {
  unpaid_invoices: 'briefing.cta.unpaid_invoices',
  receivables: 'briefing.cta.receivables',
  scan_credits: 'briefing.cta.scan_credits',
  budget: 'briefing.cta.budget',
  price_alerts: 'briefing.cta.price_alerts',
  reorder: 'briefing.cta.reorder',
  forecast_revenue: 'briefing.cta.forecast',
  forecast_expense: 'briefing.cta.forecast',
  year_back_revenue: 'briefing.cta.forecast',
  year_back_expense: 'briefing.cta.forecast',
  schedule_unpaid: 'briefing.cta.schedule_unpaid',
  team_on_leave: 'briefing.cta.team_on_leave',
  personal_wallet: 'briefing.cta.personal_wallet',
  weak_weekday: 'briefing.cta.weak_weekday',
  staffing_mismatch: 'briefing.cta.staffing_mismatch',
  missing_revenue: 'briefing.cta.missing_revenue',
  recurring_invoice_missing: 'briefing.cta.recurring_invoice_missing',
  recurring_replaced: 'briefing.cta.recurring',
  payroll_rates_year: 'briefing.cta.payroll_rates_year',
  payments_this_week: 'briefing.cta.payments_this_week',
  backup: 'briefing.cta.backup',
  two_factor: 'briefing.cta.two_factor',
  cash_flow: 'briefing.cta.cash_flow',
  accountant_pack: 'briefing.cta.accountant_pack',
  payment_reminders: 'briefing.cta.payment_reminders',
  recurring_invoices: 'briefing.cta.recurring_invoices',
};

// Answers that settle a recurring expense's month right here.
const RECURRING_ACTIONS = new Set<ProactiveSignalAction>(['recurring_record', 'recurring_skip', 'recurring_yes', 'recurring_no']);
const STRONG_ACTIONS = new Set<ProactiveSignalAction>(['discontinue', 'mark_paid', 'recurring_record', 'recurring_yes']);

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
    case 'mark_paid':
      return 'briefing.markPaid';
    case 'recurring_record':
      return 'briefing.recurringRecord';
    case 'recurring_skip':
      return 'briefing.recurringSkip';
    case 'recurring_yes':
      return 'briefing.recurringYes';
    case 'recurring_no':
      return 'briefing.recurringNo';
  }
}

export function MorningBriefingCard({ refreshSignal }: Props) {
  const { t } = useTranslation();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [signals, setSignals] = useState<ProactiveSignal[]>([]);
  const [expanded, setExpanded] = useState(false);

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
  // A bulk change to invoices - confirmed first, then applied.
  const markPaid = (signal: ProactiveSignal) => {
    const ids = signal.invoice_ids || [];
    if (ids.length === 0) return;
    Alert.alert(
      t('briefing.markPaidConfirmTitle'),
      t('briefing.markPaidConfirmBody').replace('{count}', String(ids.length)),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('briefing.markPaid'),
          onPress: async () => {
            setSignals((prev) => prev.filter((s) => s !== signal));
            try {
              const { updated } = await api.markInvoicesPaid(ids);
              Toast.success(t('briefing.markedPaid').replace('{count}', String(updated)));
              refresh();
            } catch (error: any) {
              setSignals((prev) => [...prev, signal].sort((a, b) => b.priority - a.priority));
              Alert.alert(t('common.error'), error?.message || '');
            }
          },
        },
      ],
    );
  };

  // A recurring expense's month: recorded, skipped, or the look-alike record
  // confirmed or not - the signal leaves at once and returns if saving fails.
  const answerRecurring = async (signal: ProactiveSignal, action: ProactiveSignalAction) => {
    const { recurring_id: id, recurring_month: month } = signal;
    if (!id || !month) return;
    setSignals((prev) => prev.filter((s) => s !== signal));
    try {
      if (action === 'recurring_record') {
        await api.recordRecurringMonth(id, month);
        Toast.success(t('recurring.recorded'));
      } else if (action === 'recurring_skip') {
        await api.skipRecurringMonth(id, month, true);
      } else if (signal.match_id && signal.match_source) {
        await api.answerRecurringMatch(id, month, {
          source: signal.match_source, id: signal.match_id, same: action === 'recurring_yes',
        });
      }
      refresh();
    } catch (error: any) {
      setSignals((prev) => [...prev, signal].sort((a, b) => b.priority - a.priority));
      Alert.alert(t('common.error'), error?.message || '');
    }
  };

  const act = async (signal: ProactiveSignal, action: ProactiveSignalAction) => {
    if (action === 'mark_paid') {
      markPaid(signal);
      return;
    }
    if (RECURRING_ACTIONS.has(action)) {
      await answerRecurring(signal, action);
      return;
    }
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

  const visible = expanded ? signals : signals.slice(0, VISIBLE_SIGNALS);
  const hiddenCount = signals.length - visible.length;
  const newCount = signals.filter((signal) => signal.is_new).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="sunny" size={20} color={COLORS.primary} />
        <Text style={styles.title}>{t('briefing.title')}</Text>
        {newCount > 0 && (
          <View style={styles.newCountPill}>
            <Text style={styles.newCountText}>{t('briefing.newCount').replace('{n}', String(newCount))}</Text>
          </View>
        )}
      </View>

      {signals.length === 0 ? (
        <View style={styles.allClearRow}>
          <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
          <Text style={styles.allClearText}>{t('briefing.allClear')}</Text>
        </View>
      ) : (
        visible.map((signal) => (
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
                <View style={styles.titleRow}>
                  <Text style={[signal.severity === 'info' ? styles.rowTitleSoft : styles.rowTitle, styles.titleText]}>
                    {signal.title}
                  </Text>
                  {signal.is_new && (
                    <View style={styles.newPill}>
                      <Text style={styles.newPillText}>{t('briefing.new')}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.rowDetail}>{signal.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
            {(!!CTA_LABEL[signal.key] || (signal.actions || []).length > 0) && (
              <View style={styles.actionsRow}>
                {CTA_LABEL[signal.key] && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnPrimary]}
                    onPress={() => router.push(signal.route as any)}
                  >
                    <Text style={[styles.actionText, styles.actionTextPrimary]}>{t(CTA_LABEL[signal.key])}</Text>
                    <Ionicons name="arrow-forward" size={12} color="white" />
                  </TouchableOpacity>
                )}
                {(signal.actions || []).map((action) => (
                  <TouchableOpacity
                    key={action}
                    style={[styles.actionBtn, STRONG_ACTIONS.has(action) && styles.actionBtnStrong]}
                    onPress={() => act(signal, action)}
                  >
                    <Text style={[styles.actionText, STRONG_ACTIONS.has(action) && styles.actionTextStrong]}>
                      {t(actionLabelKey(signal, action))}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ))
      )}

      {signals.length > VISIBLE_SIGNALS && (
        <TouchableOpacity style={styles.moreBtn} onPress={() => setExpanded((value) => !value)}>
          <Text style={styles.moreText}>
            {expanded ? t('briefing.showLess') : t('briefing.showMore').replace('{n}', String(hiddenCount))}
          </Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.primary} />
        </TouchableOpacity>
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
  actionBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  actionTextPrimary: {
    color: 'white',
    fontWeight: '600',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  titleText: {
    flexShrink: 1,
  },
  newPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: `${COLORS.primary}33`,
  },
  newPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  newCountPill: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: `${COLORS.primary}26`,
  },
  newCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 10,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  moreText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
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

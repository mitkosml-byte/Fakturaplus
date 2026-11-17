import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  ImageBackground,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import type { CashFlow, CashFlowEvent } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const KIND_ICON: Record<CashFlowEvent['kind'], keyof typeof Ionicons.glyphMap> = {
  receivable: 'arrow-down-circle-outline',
  revenue: 'cash-outline',
  invoice: 'document-text-outline',
  recurring: 'repeat-outline',
  payroll: 'people-outline',
  vat: 'calculator-outline',
  subscription: 'repeat-outline',
};

// Whose label already says what it is (payroll, VAT) goes without the kind.
const PREFIXED_KINDS: CashFlowEvent['kind'][] = ['invoice', 'receivable', 'recurring', 'subscription'];

const money = (n: number) => `${n.toFixed(2)} €`;
const dayLabel = (iso: string) => format(parseISO(iso), 'dd.MM');

// Will the money last (Н1)? From the money the business has now, the days
// ahead: what customers owe and the usual revenue coming in; supplier
// invoices, recurring expenses, payroll and VAT going out. The lowest point
// and the first day below zero, weeks before they come.
export default function CashFlowScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const allowed = hasPermission('view_statistics') && hasPermission('view_profit');
  const canReadStatement = hasPermission('manage_invoices') || hasPermission('add_revenue');

  const [days, setDays] = useState<30 | 60>(30);
  const [flow, setFlow] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cash, setCash] = useState('');
  const [bank, setBank] = useState('');
  const [payDay, setPayDay] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.getCashFlow(days);
      setFlow(data);
      setPayDay(String(data.pay_day));
      if (data.position) {
        setCash((current) => current || String(data.position!.cash));
        setBank((current) => current || String(data.position!.bank));
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [allowed, days, t]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const savePosition = async () => {
    const cashValue = parseFloat(cash.replace(',', '.') || '0');
    const bankValue = parseFloat(bank.replace(',', '.') || '0');
    if (!Number.isFinite(cashValue) || !Number.isFinite(bankValue)) {
      Alert.alert(t('common.error'), t('cashFlow.enterAmounts'));
      return;
    }
    setSaving(true);
    try {
      await api.setCashPosition(cashValue, bankValue);
      Haptics.success();
      Toast.success(t('cashFlow.positionSaved'));
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const savePayDay = async () => {
    const value = parseInt(payDay, 10);
    if (!Number.isInteger(value) || value < 1 || value > 31) {
      Alert.alert(t('common.error'), t('cashFlow.payDayInvalid'));
      return;
    }
    try {
      await api.setCashFlowSettings(value);
      Toast.success(t('cashFlow.payDaySaved'));
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  // The money at each day's end, as bars around zero.
  const bars = useMemo(() => {
    if (!flow) return { items: [] as { date: string; balance: number }[], max: 1 };
    const max = Math.max(1, ...flow.series.map((row) => Math.abs(row.balance)));
    return { items: flow.series.map((row) => ({ date: row.date, balance: row.balance })), max };
  }, [flow]);
  const hasNegative = bars.items.some((b) => b.balance < 0);

  // What comes and goes, by day.
  const eventsByDay = useMemo(() => {
    const groups: { date: string; events: CashFlowEvent[] }[] = [];
    for (const event of flow?.events || []) {
      const last = groups[groups.length - 1];
      if (last && last.date === event.date) last.events.push(event);
      else groups.push({ date: event.date, events: [event] });
    }
    return groups;
  }, [flow]);

  const usualPerDay = useMemo(() => {
    const values = Object.values(flow?.usual_revenue_by_weekday || {});
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }, [flow]);

  if (!allowed) return <AccessDenied />;

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('cashFlow.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          >
            {/* The money now - where the days ahead start. */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('cashFlow.moneyNow')}</Text>
              <Text style={styles.hint}>
                {flow?.position
                  ? t('cashFlow.enteredOn').replace('{date}', dayLabel(flow.position.date))
                  : t('cashFlow.enterMoneyNow')}
              </Text>
              <View style={styles.amountRow}>
                <View style={styles.amountField}>
                  <Text style={styles.label}>{t('cashFlow.cash')}</Text>
                  <TextInput
                    style={styles.input}
                    value={cash}
                    onChangeText={setCash}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>
                <View style={styles.amountField}>
                  <Text style={styles.label}>{t('cashFlow.bank')}</Text>
                  <TextInput
                    style={styles.input}
                    value={bank}
                    onChangeText={setBank}
                    keyboardType="numbers-and-punctuation"
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>
              </View>
              <TouchableOpacity style={[styles.primaryButton, saving && { opacity: 0.6 }]} onPress={savePosition} disabled={saving}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>{t('cashFlow.saveMoneyNow')}</Text>}
              </TouchableOpacity>
              {canReadStatement && (
                <TouchableOpacity style={styles.statementLink} onPress={() => router.push('/bank-statement')}>
                  <Ionicons name="business-outline" size={15} color={COLORS.primary} />
                  <Text style={styles.statementLinkText}>{t('cashFlow.fromStatement')}</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.segment}>
              {([30, 60] as const).map((value) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.segmentOption, days === value && styles.segmentOptionActive]}
                  onPress={() => setDays(value)}
                >
                  <Text style={[styles.segmentText, days === value && styles.segmentTextActive]}>
                    {t('cashFlow.days').replace('{days}', String(value))}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {loading || !flow ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
            ) : (
              <>
                {flow.first_negative && (
                  <View style={styles.warning}>
                    <Ionicons name="warning" size={20} color={COLORS.danger} />
                    <Text style={styles.warningText}>
                      {t('cashFlow.runsShort')
                        .replace('{date}', dayLabel(flow.first_negative))
                        .replace('{amount}', money(flow.lowest.balance))
                        .replace('{lowest}', dayLabel(flow.lowest.date))}
                    </Text>
                  </View>
                )}

                <View style={styles.card}>
                  <View style={styles.summaryRow}>
                    <View style={styles.summaryCell}>
                      <Text style={styles.label}>{t('cashFlow.inDays').replace('{days}', String(flow.days))}</Text>
                      <Text style={[styles.big, { color: flow.end_balance < 0 ? COLORS.danger : COLORS.success }]}>{money(flow.end_balance)}</Text>
                    </View>
                    <View style={styles.summaryCell}>
                      <Text style={styles.label}>{t('cashFlow.lowest').replace('{date}', dayLabel(flow.lowest.date))}</Text>
                      <Text style={[styles.big, { color: flow.lowest.balance < 0 ? COLORS.danger : 'white' }]}>{money(flow.lowest.balance)}</Text>
                    </View>
                  </View>

                  <View style={styles.chart}>
                    {bars.items.map((bar) => {
                      const height = Math.max(2, (Math.abs(bar.balance) / bars.max) * (hasNegative ? 50 : 100));
                      return (
                        <View key={bar.date} style={styles.barSlot}>
                          <View style={[styles.barHalf, { justifyContent: 'flex-end' }, !hasNegative && { height: 100 }]}>
                            {bar.balance >= 0 && <View style={[styles.bar, { height, backgroundColor: COLORS.success }]} />}
                          </View>
                          {hasNegative && (
                            <View style={styles.barHalf}>
                              {bar.balance < 0 && <View style={[styles.bar, { height, backgroundColor: COLORS.danger }]} />}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.chartLabels}>
                    <Text style={styles.chartLabel}>{dayLabel(flow.from)}</Text>
                    <Text style={styles.chartLabel}>{dayLabel(flow.to)}</Text>
                  </View>

                  <View style={styles.totalsRow}>
                    <Text style={[styles.total, { color: COLORS.success }]}>{t('cashFlow.comesIn')} +{money(flow.total_in)}</Text>
                    <Text style={[styles.total, { color: COLORS.danger }]}>{t('cashFlow.goesOut')} −{money(flow.total_out)}</Text>
                  </View>
                  {usualPerDay > 0 && (
                    <Text style={styles.hint}>
                      {t('cashFlow.usualRevenue').replace('{amount}', money(usualPerDay)).replace('{total}', money(flow.usual_revenue_total))}
                    </Text>
                  )}
                  {flow.overdue_receivables > 0 && (
                    <Text style={styles.hint}>{t('cashFlow.overdueReceivables').replace('{amount}', money(flow.overdue_receivables))}</Text>
                  )}
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('cashFlow.whatComesAndGoes')}</Text>
                  {eventsByDay.length === 0 && <Text style={styles.hint}>{t('cashFlow.nothingAhead')}</Text>}
                  {eventsByDay.map((group) => (
                    <View key={group.date} style={styles.dayGroup}>
                      <Text style={styles.dayTitle}>{dayLabel(group.date)}</Text>
                      {group.events.map((event, index) => (
                        <View key={`${group.date}-${index}`} style={styles.eventRow}>
                          <Ionicons name={KIND_ICON[event.kind]} size={18} color={event.amount >= 0 ? COLORS.success : COLORS.textSecondary} />
                          <View style={styles.eventText}>
                            <Text style={styles.eventLabel} numberOfLines={1}>
                              {PREFIXED_KINDS.includes(event.kind) ? `${t(`cashFlow.kind.${event.kind}`)}: ` : ''}{event.label}
                            </Text>
                            {event.overdue && <Text style={styles.eventOverdue}>{t('cashFlow.overdue')}</Text>}
                          </View>
                          <Text style={[styles.eventAmount, { color: event.amount >= 0 ? COLORS.success : COLORS.danger }]}>
                            {event.amount >= 0 ? '+' : '−'}{money(Math.abs(event.amount))}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('cashFlow.payDay')}</Text>
                  <Text style={styles.hint}>{t('cashFlow.payDayHint')}</Text>
                  <View style={styles.payDayRow}>
                    <TextInput
                      style={[styles.input, { width: 80, textAlign: 'center' }]}
                      value={payDay}
                      onChangeText={(v) => setPayDay(v.replace(/\D/g, ''))}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                    <TouchableOpacity style={styles.secondaryButton} onPress={savePayDay}>
                      <Text style={styles.secondaryButtonText}>{t('common.save')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {flow.notes.map((note) => (
                  <View key={note} style={styles.note}>
                    <Ionicons name="information-circle-outline" size={16} color={COLORS.textSecondary} />
                    <Text style={styles.noteText}>{note}</Text>
                  </View>
                ))}
                <View style={{ height: 32 }} />
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  content: { flex: 1, padding: 16 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: 'white', marginBottom: 4 },
  hint: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 17, marginTop: 4 },
  label: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 },
  amountRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  amountField: { flex: 1 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: 'white',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryButton: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12 },
  primaryButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
  secondaryButton: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1, borderColor: COLORS.primary },
  statementLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 },
  statementLinkText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  secondaryButtonText: { color: COLORS.primary, fontWeight: '600' },
  segment: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 12, padding: 4, marginBottom: 16 },
  segmentOption: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segmentOptionActive: { backgroundColor: COLORS.primary },
  segmentText: { color: COLORS.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: 'white' },
  warning: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: COLORS.danger,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  warningText: { flex: 1, color: COLORS.textLight, fontSize: 14, lineHeight: 20 },
  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryCell: { flex: 1 },
  big: { fontSize: 22, fontWeight: '700' },
  chart: { flexDirection: 'row', alignItems: 'stretch', height: 100, marginTop: 16, gap: 1 },
  barSlot: { flex: 1 },
  barHalf: { height: 50 },
  bar: { width: '100%', borderRadius: 1 },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  chartLabel: { fontSize: 10, color: COLORS.textMuted },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  total: { fontSize: 14, fontWeight: '600' },
  dayGroup: { marginTop: 12 },
  dayTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textSubtle, marginBottom: 4 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  eventText: { flex: 1 },
  eventLabel: { color: COLORS.textLight, fontSize: 13 },
  eventOverdue: { color: COLORS.danger, fontSize: 11, marginTop: 1 },
  eventAmount: { fontSize: 14, fontWeight: '600' },
  payDayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 8, paddingHorizontal: 4 },
  noteText: { flex: 1, fontSize: 12, color: COLORS.textSecondary, lineHeight: 17 },
});

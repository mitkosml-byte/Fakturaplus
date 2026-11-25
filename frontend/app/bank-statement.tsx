import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  ImageBackground,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { format, parseISO } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import type {
  BankMatchStatus,
  BankStatementApplyResult,
  BankStatementPreview,
  BankStatementRow,
  BankTarget,
} from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';
import { formatMoney } from '../src/utils/money';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

type Step = 'pick' | 'loading' | 'review' | 'saving' | 'done';
type Target = { kind: BankTarget['kind']; id: string; amount: number };
// One way to record a movement: the program's proposal (one or more
// documents) or one of the other documents it could be.
type Option = { key: string; label: string; targets: Target[] };

const SECTIONS: BankMatchStatus[] = ['sure', 'ask', 'entered', 'none', 'applied'];
const money = (n: number) => `${formatMoney(n)}`;
const dayLabel = (iso: string) => format(parseISO(iso), 'dd.MM.yyyy');
const round2 = (n: number) => Math.round(n * 100) / 100;

function optionsFor(row: BankStatementRow): Option[] {
  const options: Option[] = [];
  if (row.targets.length > 0 && row.status !== 'applied') {
    options.push({
      key: 'proposal',
      label: row.targets.map((target) => `${target.label} · ${money(target.amount || 0)}`).join('\n'),
      targets: row.targets.map((target) => ({ kind: target.kind, id: target.id, amount: target.amount || 0 })),
    });
  }
  for (const other of row.alternatives) {
    const amount = round2(Math.min(other.left, Math.abs(row.amount)));
    if (amount <= 0) continue;
    options.push({ key: other.id, label: `${other.label} · ${money(amount)}`, targets: [{ kind: other.kind, id: other.id, amount }] });
  }
  return options;
}

// A bank statement (Н2): the file from online banking, its movements
// matched to the supplier invoices they pay and the customer debts they
// settle. The certain ones come ticked, the likely ones are asked, the ones
// already in the program are shown as such and never recorded twice, and
// the ones without a document are only listed - no expense is made up.
export default function BankStatementScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const allowed = hasPermission('manage_invoices') || hasPermission('add_revenue');

  const [step, setStep] = useState<Step>('pick');
  const [preview, setPreview] = useState<BankStatementPreview | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  // Which option each movement is recorded with (its index in optionsFor).
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [setBalance, setSetBalance] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({ sure: true, ask: true, entered: false, none: false, applied: false });
  const [result, setResult] = useState<BankStatementApplyResult | null>(null);

  const reset = () => {
    setStep('pick');
    setPreview(null);
    setTicked({});
    setPicked({});
    setResult(null);
  };

  const pickFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    setStep('loading');
    try {
      const data = await api.previewBankStatement({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: (asset as any).file });
      const firstTicks: Record<string, boolean> = {};
      const firstPicks: Record<string, number> = {};
      for (const row of data.transactions) {
        firstTicks[row.id] = row.status === 'sure';
        firstPicks[row.id] = row.targets.length > 0 ? 0 : -1;
      }
      setPreview(data);
      setTicked(firstTicks);
      setPicked(firstPicks);
      setSetBalance(data.can_set_balance);
      setStep('review');
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
      setStep('pick');
    }
  };

  const grouped = useMemo(() => {
    const groups: Record<BankMatchStatus, BankStatementRow[]> = { sure: [], ask: [], entered: [], none: [], applied: [] };
    for (const row of preview?.transactions || []) groups[row.status].push(row);
    return groups;
  }, [preview]);

  // What will be sent: the ticked movements with the option chosen for each.
  const payments = useMemo(() => {
    const list: { row: BankStatementRow; targets: Target[] }[] = [];
    for (const row of preview?.transactions || []) {
      if (!ticked[row.id] || row.status === 'applied') continue;
      const option = optionsFor(row)[picked[row.id] ?? -1];
      if (option) list.push({ row, targets: option.targets });
    }
    return list;
  }, [preview, ticked, picked]);

  const totals = useMemo(() => {
    let suppliers = 0;
    let customers = 0;
    let count = 0;
    for (const payment of payments) {
      for (const target of payment.targets) {
        count += 1;
        if (target.kind === 'invoice') suppliers += target.amount;
        else customers += target.amount;
      }
    }
    return { suppliers: round2(suppliers), customers: round2(customers), count };
  }, [payments]);

  const choose = (row: BankStatementRow, index: number) => {
    Haptics.selection();
    setPicked((current) => ({ ...current, [row.id]: index }));
    setTicked((current) => ({ ...current, [row.id]: true }));
  };

  const toggle = (row: BankStatementRow) => {
    Haptics.selection();
    const next = !ticked[row.id];
    if (next && (picked[row.id] ?? -1) < 0) {
      // Nothing chosen yet: the first document it could be.
      if (optionsFor(row).length === 0) return;
      setPicked((current) => ({ ...current, [row.id]: 0 }));
    }
    setTicked((current) => ({ ...current, [row.id]: next }));
  };

  const apply = async () => {
    if (!preview) return;
    const balance = preview.can_set_balance && setBalance && preview.closing_balance !== null;
    if (payments.length === 0 && !balance) {
      Alert.alert(t('bankStatement.title'), t('bankStatement.nothingChosen'));
      return;
    }
    setStep('saving');
    try {
      const done = await api.applyBankStatement({
        payments: payments.map(({ row, targets }) => ({ transaction_id: row.id, date: row.date, amount: row.amount, targets })),
        closing_balance: balance ? preview.closing_balance : null,
        closing_date: balance ? preview.closing_date : null,
      });
      Haptics.success();
      setResult(done);
      setStep('done');
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
      setStep('review');
    }
  };

  if (!allowed) return <AccessDenied />;

  const reasonText = (row: BankStatementRow) => {
    if (row.reason === 'by_hand' && row.entered) {
      return t('bankStatement.reason.by_hand').replace('{date}', dayLabel(row.entered.date)).replace('{amount}', money(row.entered.amount));
    }
    if (row.status === 'applied') return null;
    return t(`bankStatement.reason.${row.reason}`);
  };

  const renderRow = (row: BankStatementRow) => {
    const options = optionsFor(row);
    const isTicked = !!ticked[row.id];
    const choice = picked[row.id] ?? -1;
    const canTick = row.status !== 'applied' && options.length > 0 && !(row.status === 'entered' && row.reason !== 'by_hand');
    const incoming = row.amount > 0;
    const reason = reasonText(row);
    return (
      <View key={row.id} style={[styles.row, isTicked && styles.rowTicked]}>
        <View style={styles.rowTop}>
          {canTick ? (
            <TouchableOpacity onPress={() => toggle(row)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: isTicked }}>
              <Ionicons name={isTicked ? 'checkbox' : 'square-outline'} size={24} color={isTicked ? COLORS.primary : COLORS.textMuted} />
            </TouchableOpacity>
          ) : (
            <Ionicons
              name={row.status === 'applied' || row.status === 'entered' ? 'checkmark-done' : 'remove'}
              size={22}
              color={row.status === 'applied' || row.status === 'entered' ? COLORS.success : COLORS.textMuted}
            />
          )}
          <View style={styles.rowText}>
            <Text style={styles.rowParty} numberOfLines={1}>{row.counterparty || row.description || '—'}</Text>
            {!!row.counterparty && !!row.description && <Text style={styles.rowDescription} numberOfLines={2}>{row.description}</Text>}
            <Text style={styles.rowDate}>{dayLabel(row.date)}</Text>
          </View>
          <Text style={[styles.rowAmount, { color: incoming ? COLORS.success : COLORS.textLight }]}>
            {incoming ? '+' : '−'}{money(Math.abs(row.amount))}
          </Text>
        </View>

        {!!reason && <Text style={styles.reason}>{reason}</Text>}

        {row.status === 'applied' && row.targets.map((target) => (
          <Text key={`${target.kind}-${target.id}`} style={styles.recorded} numberOfLines={2}>
            {target.label} · {money(target.amount || 0)}
          </Text>
        ))}

        {row.status === 'entered' && row.reason === 'by_hand' && options.length > 0 && (
          <TouchableOpacity style={styles.anyway} onPress={() => toggle(row)}>
            <Ionicons name={isTicked ? 'checkbox' : 'square-outline'} size={18} color={isTicked ? COLORS.primary : COLORS.textMuted} />
            <Text style={styles.anywayText}>{t('bankStatement.recordAnyway')}</Text>
          </TouchableOpacity>
        )}

        {row.status !== 'applied' && row.status !== 'entered' && options.length > 0 && (
          <View style={styles.options}>
            {row.status === 'none' && <Text style={styles.optionsTitle}>{t('bankStatement.payFor')}</Text>}
            {row.status !== 'none' && options.length > 1 && <Text style={styles.optionsTitle}>{t('bankStatement.orChoose')}</Text>}
            {options.length === 1 && row.status !== 'none' ? (
              // The one document it is: shown, nothing to choose.
              <View style={[styles.option, isTicked && styles.optionSelected]}>
                <Ionicons name="document-text-outline" size={16} color={isTicked ? COLORS.primary : COLORS.textMuted} />
                <Text style={[styles.optionText, isTicked && styles.optionTextSelected]}>{options[0].label}</Text>
              </View>
            ) : options.map((option, index) => {
              const selected = choice === index;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => choose(row, index)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={16} color={selected ? COLORS.primary : COLORS.textMuted} />
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('bankStatement.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          {(step === 'pick' || step === 'loading') && (
            <ScrollView style={styles.content}>
              <View style={styles.card}>
                <Ionicons name="business-outline" size={32} color={COLORS.primary} />
                <Text style={styles.intro}>{t('bankStatement.intro')}</Text>
                <TouchableOpacity style={[styles.primaryButton, step === 'loading' && { opacity: 0.6 }]} onPress={pickFile} disabled={step === 'loading'}>
                  {step === 'loading' ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator color="white" />
                      <Text style={styles.primaryButtonText}>{t('bankStatement.reading')}</Text>
                    </View>
                  ) : (
                    <Text style={styles.primaryButtonText}>{t('bankStatement.pick')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {(step === 'review' || step === 'saving') && preview && (
            <>
              <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>
                    {t('bankStatement.period')
                      .replace('{count}', String(preview.count))
                      .replace('{from}', dayLabel(preview.from))
                      .replace('{to}', dayLabel(preview.to))}
                  </Text>
                  <View style={styles.totalsRow}>
                    <Text style={[styles.total, { color: COLORS.success }]}>{t('bankStatement.moneyIn')} +{money(preview.money_in)}</Text>
                    <Text style={[styles.total, { color: COLORS.textLight }]}>{t('bankStatement.moneyOut')} −{money(preview.money_out)}</Text>
                  </View>
                  {preview.skipped_rows > 0 && (
                    <Text style={styles.notice}>{t('bankStatement.skipped').replace('{count}', String(preview.skipped_rows))}</Text>
                  )}
                  {preview.other_currency_rows > 0 && (
                    <Text style={styles.notice}>{t('bankStatement.otherCurrency').replace('{count}', String(preview.other_currency_rows))}</Text>
                  )}
                  {!preview.can_pay_invoices && <Text style={styles.hint}>{t('bankStatement.onlyReceivables')}</Text>}
                  {!preview.can_receive && <Text style={styles.hint}>{t('bankStatement.onlyInvoices')}</Text>}
                  <TouchableOpacity onPress={reset} style={styles.linkRow}>
                    <Ionicons name="swap-horizontal" size={15} color={COLORS.primary} />
                    <Text style={styles.link}>{t('bankStatement.another')}</Text>
                  </TouchableOpacity>
                </View>

                {SECTIONS.map((status) => {
                  const rows = grouped[status];
                  if (rows.length === 0) return null;
                  const isOpen = !!open[status];
                  return (
                    <View key={status} style={styles.section}>
                      <TouchableOpacity
                        style={styles.sectionHeader}
                        onPress={() => setOpen((current) => ({ ...current, [status]: !isOpen }))}
                      >
                        <Text style={styles.sectionTitle}>{t(`bankStatement.section.${status}`)} ({rows.length})</Text>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
                      </TouchableOpacity>
                      {isOpen && status !== 'applied' && <Text style={styles.sectionHint}>{t(`bankStatement.section.${status}Hint`)}</Text>}
                      {isOpen && rows.map(renderRow)}
                    </View>
                  );
                })}

                {(preview.can_set_balance || preview.balance_is_newer) && preview.closing_balance !== null && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{t('bankStatement.balanceTitle')}</Text>
                    {preview.can_set_balance ? (
                      <>
                        <View style={styles.switchRow}>
                          <Text style={styles.switchText}>
                            {t('bankStatement.balanceSet')
                              .replace('{amount}', money(preview.closing_balance))
                              .replace('{date}', dayLabel(preview.closing_date))}
                          </Text>
                          <Switch
                            value={setBalance}
                            onValueChange={setSetBalance}
                            trackColor={{ false: COLORS.border, true: COLORS.primary }}
                            thumbColor="white"
                          />
                        </View>
                        {preview.current_bank_balance !== null && preview.current_balance_date && (
                          <Text style={styles.hint}>
                            {t('bankStatement.balanceNow')
                              .replace('{amount}', money(preview.current_bank_balance))
                              .replace('{date}', dayLabel(preview.current_balance_date))}
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text style={styles.hint}>
                        {t('bankStatement.balanceNewer')
                          .replace('{amount}', money(preview.current_bank_balance || 0))
                          .replace('{date}', preview.current_balance_date ? dayLabel(preview.current_balance_date) : '')}
                      </Text>
                    )}
                  </View>
                )}
                <View style={{ height: 120 }} />
              </ScrollView>

              <View style={styles.footer}>
                <Text style={styles.footerTitle}>{t('bankStatement.toRecord').replace('{count}', String(totals.count))}</Text>
                <Text style={styles.footerLine}>
                  {[
                    totals.suppliers > 0 ? t('bankStatement.toSuppliers').replace('{amount}', money(totals.suppliers)) : null,
                    totals.customers > 0 ? t('bankStatement.fromCustomers').replace('{amount}', money(totals.customers)) : null,
                  ].filter(Boolean).join(' · ')}
                </Text>
                <TouchableOpacity style={[styles.primaryButton, step === 'saving' && { opacity: 0.6 }]} onPress={apply} disabled={step === 'saving'}>
                  {step === 'saving' ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>{t('bankStatement.apply')}</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 'done' && result && (
            <ScrollView style={styles.content}>
              <View style={styles.card}>
                <Ionicons name="checkmark-circle" size={36} color={COLORS.success} />
                <Text style={styles.cardTitle}>{t('bankStatement.doneTitle')}</Text>
                <Text style={styles.doneLine}>{t('bankStatement.doneApplied').replace('{count}', String(result.applied))}</Text>
                {result.paid_to_suppliers > 0 && (
                  <Text style={styles.doneLine}>{t('bankStatement.toSuppliers').replace('{amount}', money(result.paid_to_suppliers))}</Text>
                )}
                {result.received_from_customers > 0 && (
                  <Text style={styles.doneLine}>{t('bankStatement.fromCustomers').replace('{amount}', money(result.received_from_customers))}</Text>
                )}
                {result.already_recorded > 0 && (
                  <Text style={styles.hint}>{t('bankStatement.doneAlready').replace('{count}', String(result.already_recorded))}</Text>
                )}
                {result.balance_set && <Text style={styles.hint}>{t('bankStatement.doneBalance')}</Text>}
                {result.failed.length > 0 && (
                  <View style={styles.failed}>
                    <Text style={styles.failedTitle}>{t('bankStatement.doneFailed')}</Text>
                    {result.failed.map((failure, index) => (
                      <Text key={`${failure.transaction_id}-${index}`} style={styles.failedLine}>• {failure.message}</Text>
                    ))}
                  </View>
                )}
                <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()}>
                  <Text style={styles.primaryButtonText}>{t('bankStatement.close')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={reset}>
                  <Text style={styles.secondaryButtonText}>{t('bankStatement.another')}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
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
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 16, gap: 6 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: 'white' },
  intro: { fontSize: 14, color: COLORS.textLight, lineHeight: 21, marginTop: 6 },
  hint: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 17 },
  notice: { fontSize: 12, color: COLORS.warning, lineHeight: 17 },
  primaryButton: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 10 },
  primaryButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
  secondaryButton: { borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary, marginTop: 8 },
  secondaryButtonText: { color: COLORS.primary, fontWeight: '600' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  total: { fontSize: 14, fontWeight: '600' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  link: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  section: { marginBottom: 12 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: 'white' },
  sectionHint: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 17, paddingHorizontal: 4, marginBottom: 8 },
  row: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowTicked: { borderColor: COLORS.primary },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowText: { flex: 1 },
  rowParty: { color: 'white', fontSize: 14, fontWeight: '600' },
  rowDescription: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rowDate: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700' },
  reason: { color: COLORS.textSubtle, fontSize: 12, marginTop: 8, marginLeft: 34 },
  recorded: { color: COLORS.textLight, fontSize: 12, marginTop: 4, marginLeft: 34 },
  anyway: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginLeft: 34 },
  anywayText: { color: COLORS.textSecondary, fontSize: 12 },
  options: { marginTop: 8, marginLeft: 34, gap: 6 },
  optionsTitle: { color: COLORS.textMuted, fontSize: 12 },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: COLORS.background,
  },
  optionSelected: { borderWidth: 1, borderColor: COLORS.primary },
  optionText: { flex: 1, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  optionTextSelected: { color: 'white' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchText: { flex: 1, color: COLORS.textLight, fontSize: 13, lineHeight: 19 },
  footer: {
    padding: 16,
    paddingBottom: 24,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  footerTitle: { color: 'white', fontSize: 14, fontWeight: '600' },
  footerLine: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  doneLine: { color: COLORS.textLight, fontSize: 14 },
  failed: { marginTop: 8, gap: 4 },
  failedTitle: { color: COLORS.warning, fontSize: 13, fontWeight: '600' },
  failedLine: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
});

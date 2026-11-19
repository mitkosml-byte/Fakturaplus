import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ActivityIndicator, Switch, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addMonths, format, parseISO } from 'date-fns';
import { api } from '../services/api';
import { useTranslation } from '../i18n';
import { useAuth } from '../contexts/AuthContext';
import { Alert } from '../utils/alert';
import { Toast } from '../utils/toast';
import { Haptics } from '../utils/haptics';
import { COLORS } from '../theme/colors';
import { PressableScale } from './PressableScale';
import type {
  RecurringExpense, RecurringKind, RecurringOccurrence, RecurringOverview, RecurringRecord,
} from '../types';
import { formatMoney } from '../utils/money';

type Props = {
  overview: RecurringOverview | null;
  onChanged: () => void;
};

type Answer = 'record' | 'skip' | 'unskip' | 'yes' | 'no';

// How often it is paid: the usual choices, and any other number of months.
const INTERVAL_CHOICES = [1, 3, 6, 12] as const;
const MAX_INTERVAL_MONTHS = 36;
const MAX_PAYMENTS = 600;
// How far ahead the first payment can be put.
const START_MONTHS_AHEAD = 36;

const shiftMonth = (key: string, months: number) => format(addMonths(parseISO(`${key}-01`), months), 'yyyy-MM');

// What a business pays regularly (rent, subscriptions, insurance, utilities,
// installments) - every month or every few months, with an end when it has
// a number of payments. Each says whether an invoice comes for it. With one,
// the invoice is the expense - awaited at each payment, never recorded
// twice; without one, the payment is recorded as an off-book expense (when
// the owner says it is paid, or on its day). The backend decides each
// payment's state; this shows it and the one or two answers it needs.
export function RecurringExpensesSection({ overview, onChanged }: Props) {
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();
  const canRecord = hasPermission('add_expenses');

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('1');
  const [kind, setKind] = useState<RecurringKind>('invoice');
  const [supplierName, setSupplierName] = useState('');
  const [supplierEik, setSupplierEik] = useState('');
  const [autoRecord, setAutoRecord] = useState(false);
  const [intervalChoice, setIntervalChoice] = useState<number | 'other'>(1);
  const [otherInterval, setOtherInterval] = useState('');
  const [startMonth, setStartMonth] = useState('');
  const [startTouched, setStartTouched] = useState(false);
  const [paymentsCount, setPaymentsCount] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [knownSuppliers, setKnownSuppliers] = useState<string[]>([]);

  // Suppliers invoiced most often - a recurring one is usually among them.
  useEffect(() => {
    if (!modalVisible || knownSuppliers.length > 0) return;
    api.getSupplierOverview()
      .then((data) => setKnownSuppliers((data?.top_by_frequency || []).map((s: any) => s.supplier).filter(Boolean).slice(0, 6)))
      .catch(() => setKnownSuppliers([]));
  }, [modalVisible, knownSuppliers.length]);

  const items = overview?.recurring_expenses || [];
  const monthOutlook = overview?.outlook;
  // This month on the business's clock (the server's), else the phone's.
  const thisMonth = overview?.month || format(new Date(), 'yyyy-MM');

  // A new one starts with the first month its day comes in from today on -
  // as the server would set it (an earlier one can still be chosen).
  const defaultStart = (dayText: string) => {
    const dayNumber = parseInt(dayText, 10);
    return dayNumber >= 1 && new Date().getDate() > dayNumber ? shiftMonth(thisMonth, 1) : thisMonth;
  };

  useEffect(() => {
    if (modalVisible && !editing && !startTouched) setStartMonth(defaultStart(day));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalVisible, editing, startTouched, day, thisMonth]);

  // The first payment: this month or later - or, for one already saved,
  // where it already is.
  const startOptions = useMemo(() => {
    const options: string[] = [];
    if (editing && editing.start_month < thisMonth) options.push(editing.start_month);
    for (let ahead = 0; ahead <= START_MONTHS_AHEAD; ahead += 1) options.push(shiftMonth(thisMonth, ahead));
    if (startMonth && !options.includes(startMonth)) options.push(startMonth);
    return options.sort();
  }, [editing, thisMonth, startMonth]);
  const startIndex = startOptions.indexOf(startMonth);
  const moveStart = (step: number) => {
    const next = startOptions[startIndex + step];
    if (!next) return;
    setStartMonth(next);
    setStartTouched(true);
  };

  const intervalValue = intervalChoice === 'other' ? parseInt(otherInterval, 10) : intervalChoice;
  const countValue = paymentsCount.trim() ? Number(paymentsCount.trim()) : null;
  const lastPayment = startMonth && intervalValue >= 1 && countValue && Number.isInteger(countValue) && countValue >= 1
    ? shiftMonth(startMonth, (countValue - 1) * intervalValue)
    : null;

  const openForm = (item: RecurringExpense | null) => {
    setEditing(item);
    setDescription(item?.description || '');
    setAmount(item ? String(item.amount) : '');
    setDay(item ? String(item.day_of_month) : '1');
    setKind(item?.kind || 'invoice');
    setSupplierName(item?.supplier_name || '');
    setSupplierEik(item?.supplier_eik || '');
    setAutoRecord(!!item?.auto_record);
    const interval = item?.interval_months || 1;
    const usual = (INTERVAL_CHOICES as readonly number[]).includes(interval);
    setIntervalChoice(usual ? interval : 'other');
    setOtherInterval(usual ? '' : String(interval));
    setStartMonth(item ? item.start_month : defaultStart('1'));
    setStartTouched(false);
    setPaymentsCount(item?.payments_count ? String(item.payments_count) : '');
    setModalVisible(true);
  };

  const save = async () => {
    const value = parseFloat(amount.replace(',', '.'));
    const dayNumber = parseInt(day, 10);
    if (!description.trim() || !(value > 0)) {
      Alert.alert(t('common.error'), t('budget.invalidData'));
      return;
    }
    if (!(dayNumber >= 1 && dayNumber <= 28)) {
      Alert.alert(t('common.error'), t('recurring.dayRange'));
      return;
    }
    if (!(Number.isInteger(intervalValue) && intervalValue >= 1 && intervalValue <= MAX_INTERVAL_MONTHS)) {
      Alert.alert(t('common.error'), t('recurring.intervalRange').replace('{max}', String(MAX_INTERVAL_MONTHS)));
      return;
    }
    if (countValue !== null && !(Number.isInteger(countValue) && countValue >= 1 && countValue <= MAX_PAYMENTS)) {
      Alert.alert(t('common.error'), t('recurring.countRange'));
      return;
    }
    if (kind === 'invoice' && !supplierName.trim() && !supplierEik.trim()) {
      Alert.alert(t('common.error'), t('recurring.supplierRequired'));
      return;
    }
    const payload = {
      description: description.trim(), amount: value, day_of_month: dayNumber, kind,
      supplier_name: supplierName.trim() || null, supplier_eik: supplierEik.trim() || null,
      auto_record: kind === 'no_invoice' && autoRecord,
      interval_months: intervalValue,
      payments_count: countValue,
      // Left to the server unless chosen: the first month its day comes in.
      ...(startTouched ? { start_month: startMonth } : {}),
    };
    setSaving(true);
    try {
      if (editing) await api.updateRecurringExpense(editing.id, payload);
      else await api.createRecurringExpense(payload);
      Haptics.success();
      Toast.success(editing ? t('recurring.updated') : t('budget.recurringCreated'));
      setModalVisible(false);
      onChanged();
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || t('budget.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const remove = (item: RecurringExpense) => {
    Alert.alert(t('common.confirm'), t('recurring.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteRecurringExpense(item.id);
            onChanged();
          } catch {
            Alert.alert(t('common.error'), t('budget.deleteError'));
          }
        },
      },
    ]);
  };

  const toggleActive = async (item: RecurringExpense) => {
    try {
      await api.updateRecurringExpense(item.id, { is_active: !item.is_active });
      onChanged();
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || '');
    }
  };

  const answer = async (occurrence: RecurringOccurrence, action: Answer, record?: RecurringRecord | null) => {
    setBusy(`${occurrence.recurring_id}:${occurrence.month}`);
    try {
      if (action === 'record') {
        await api.recordRecurringMonth(occurrence.recurring_id, occurrence.month);
        Toast.success(t('recurring.recorded'));
      } else if (action === 'skip' || action === 'unskip') {
        await api.skipRecurringMonth(occurrence.recurring_id, occurrence.month, action === 'skip');
      } else if (record) {
        await api.answerRecurringMatch(occurrence.recurring_id, occurrence.month, {
          source: record.source || 'invoice', id: record.id, same: action === 'yes',
        });
      }
      Haptics.success();
      onChanged();
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || '');
    } finally {
      setBusy(null);
    }
  };

  const monthName = (month: string) => {
    const name = format(parseISO(`${month}-01`), 'LLLL', { locale: dateLocale });
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
  const shortDay = (iso?: string | null) => (iso ? format(parseISO(iso), 'd MMM', { locale: dateLocale }) : '');
  const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const monthYear = (key: string) => format(parseISO(`${key}-01`), 'LLLL yyyy', { locale: dateLocale });
  // "10 February", with the year when it is not this one.
  const longDay = (iso: string) => {
    const when = parseISO(iso);
    const sameYear = when.getFullYear() === parseISO(`${thisMonth}-01`).getFullYear();
    return format(when, sameYear ? 'd MMMM' : 'd MMMM yyyy', { locale: dateLocale });
  };

  // "every month on day 5", "every 3 months on day 10", "every year on 10 January".
  const scheduleText = (item: RecurringExpense) => {
    const interval = item.interval_months || 1;
    if (interval === 1) return t('recurring.everyMonthOn').replace('{day}', String(item.day_of_month));
    if (interval === 12) {
      const day = String(item.day_of_month).padStart(2, '0');
      return t('recurring.yearlyOn').replace('{date}', format(parseISO(`${item.start_month}-${day}`), 'd MMMM', { locale: dateLocale }));
    }
    return t('recurring.everyNMonthsOn').replace('{n}', String(interval)).replace('{day}', String(item.day_of_month));
  };

  // Where it stands after this month's line: the next payment, how many are
  // left, or that they are over. Monthly without an end needs none of it.
  const nextPaymentText = (item: RecurringExpense): string | null => {
    const next = item.next_payment;
    const scheduled = (item.interval_months || 1) > 1 || item.payments_count != null;
    if (!next) return t('recurring.paymentsOver');
    if (!scheduled) return item.current ? null : t('recurring.startsIn').replace('{month}', monthName(item.start_month));
    const parts: string[] = [];
    if (!item.current || item.current.month !== next.month) {
      const first = next.month === item.start_month && item.start_month > thisMonth;
      parts.push((first ? t('recurring.firstPaymentOn') : t('recurring.nextPayment')).replace('{date}', longDay(next.due_date)));
    }
    if (item.payments_left === 1) parts.push(t('recurring.lastPayment'));
    else if (item.payments_left && item.last_month) {
      parts.push(t('recurring.paymentsLeft').replace('{left}', String(item.payments_left)).replace('{month}', monthYear(item.last_month)));
    }
    return parts.length ? capitalized(parts.join(' · ')) : null;
  };
  const money = (value: number) => `${formatMoney(value)}`;
  const recordLabel = (record: RecurringRecord) =>
    record.source === 'expense' || (!record.number && record.description)
      ? t('recurring.expenseLabel')
          .replace('{description}', record.description || '')
          .replace('{amount}', money(record.amount))
          .replace('{date}', shortDay(record.date))
      : t('recurring.invoiceLabel')
          .replace('{number}', record.number || '')
          .replace('{supplier}', record.supplier || '')
          .replace('{amount}', money(record.amount))
          .replace('{date}', shortDay(record.date));

  const Buttons = ({ occurrence, buttons }: {
    occurrence: RecurringOccurrence;
    buttons: { action: Answer; label: string; strong?: boolean; record?: RecurringRecord | null }[];
  }) => {
    if (busy === `${occurrence.recurring_id}:${occurrence.month}`) {
      return <ActivityIndicator size="small" color={COLORS.primary} style={{ alignSelf: 'flex-start', marginTop: 6 }} />;
    }
    return (
      <View style={styles.answerRow}>
        {buttons.map((button) => (
          <TouchableOpacity
            key={button.action}
            style={[styles.answerBtn, button.strong && styles.answerBtnStrong]}
            onPress={() => answer(occurrence, button.action, button.record)}
          >
            <Text style={[styles.answerText, button.strong && styles.answerTextStrong]}>{button.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const MonthLine = ({ occurrence }: { occurrence: RecurringOccurrence }) => {
    const month = monthName(occurrence.month);
    const due = shortDay(occurrence.due_date);
    const paidIcon = <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />;
    switch (occurrence.state) {
      case 'paid_by_invoice': {
        const invoice = occurrence.invoices[0];
        const twice = occurrence.duplicate && !occurrence.replace_automatically;
        return (
          <View style={styles.monthBlock}>
            <View style={styles.monthRow}>
              {paidIcon}
              <Text style={styles.monthText}>
                {t('recurring.paidByInvoice')
                  .replace('{month}', month)
                  .replace('{number}', invoice?.number || '')
                  .replace('{amount}', money(occurrence.paid_amount || 0))}
              </Text>
            </View>
            {twice && (
              <>
                <Text style={styles.questionText}>
                  {t('recurring.recordedTwice').replace('{amount}', money(occurrence.expenses.reduce((s, e) => s + e.amount, 0)))}
                </Text>
                <Buttons occurrence={occurrence} buttons={[
                  { action: 'yes', label: t('recurring.sameKeepInvoice'), strong: true, record: { ...invoice, source: 'invoice' } },
                  { action: 'no', label: t('recurring.different'), record: { ...invoice, source: 'invoice' } },
                ]} />
              </>
            )}
          </View>
        );
      }
      case 'paid_by_expense':
        return (
          <View style={styles.monthBlock}>
            <View style={styles.monthRow}>
              {paidIcon}
              <Text style={styles.monthText}>
                {t('recurring.paidByExpense')
                  .replace('{month}', month)
                  .replace('{date}', shortDay(occurrence.expenses[0]?.date))
                  .replace('{amount}', money(occurrence.paid_amount || 0))}
              </Text>
            </View>
            {occurrence.duplicate_suspected && occurrence.match && (
              <>
                <Text style={styles.questionText}>
                  {t('recurring.invoiceCameToo').replace('{record}', recordLabel(occurrence.match))}
                </Text>
                <Buttons occurrence={occurrence} buttons={[
                  { action: 'yes', label: t('recurring.sameKeepInvoice'), strong: true, record: occurrence.match },
                  { action: 'no', label: t('recurring.different'), record: occurrence.match },
                ]} />
              </>
            )}
          </View>
        );
      case 'skipped':
        return (
          <View style={styles.monthBlock}>
            <Text style={styles.monthMuted}>{t('recurring.skipped').replace('{month}', month)}</Text>
            <Buttons occurrence={occurrence} buttons={[{ action: 'unskip', label: t('recurring.unskip') }]} />
          </View>
        );
      case 'probable':
        return (
          <View style={styles.monthBlock}>
            <Text style={styles.questionText}>
              {t('recurring.isThisIt').replace('{month}', month).replace('{record}', occurrence.match ? recordLabel(occurrence.match) : '')}
            </Text>
            <Buttons occurrence={occurrence} buttons={[
              { action: 'yes', label: t('recurring.yesThatIsIt'), strong: true, record: occurrence.match },
              { action: 'no', label: t('recurring.different'), record: occurrence.match },
            ]} />
          </View>
        );
      case 'upcoming':
        return (
          <Text style={styles.monthMuted}>
            {(occurrence.kind === 'invoice' ? t('recurring.upcomingInvoice') : t('recurring.upcoming'))
              .replace('{month}', month).replace('{date}', due)}
          </Text>
        );
      case 'awaiting_invoice':
        return <Text style={styles.monthMuted}>{t('recurring.awaitingInvoice').replace('{month}', month).replace('{date}', due)}</Text>;
      case 'invoice_missing':
        return (
          <View style={styles.monthBlock}>
            <Text style={[styles.questionText, { color: COLORS.warning }]}>
              {t('recurring.invoiceMissing').replace('{month}', month).replace('{date}', due)}
            </Text>
            <Buttons occurrence={occurrence} buttons={[{ action: 'skip', label: t('recurring.skipMonth') }]} />
          </View>
        );
      case 'due':
        return (
          <View style={styles.monthBlock}>
            <Text style={styles.questionText}>
              {t('recurring.duePaid').replace('{month}', month).replace('{date}', due)}
            </Text>
            <Buttons occurrence={occurrence} buttons={[
              ...(canRecord ? [{ action: 'record' as Answer, label: t('recurring.paidRecord'), strong: true }] : []),
              { action: 'skip', label: t('recurring.skipMonth') },
            ]} />
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name="repeat" size={24} color={COLORS.success} />
        <Text style={styles.sectionTitle}>{t('budget.recurring')}</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => openForm(null)} accessibilityLabel={t('budget.addRecurring')}>
          <Ionicons name="add" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Only when something is paid or expected this month - an expense paid
          every few months may have nothing in it. */}
      {monthOutlook && monthOutlook.month_total > 0 && items.some((item) => item.is_active) && (
        <Text style={styles.outlookText}>
          {t('recurring.outlook')
            .replace('{total}', money(monthOutlook.month_total))
            .replace('{paid}', money(monthOutlook.paid_so_far))
            .replace('{left}', money(monthOutlook.still_expected))}
        </Text>
      )}

      {items.length === 0 ? (
        <View style={styles.emptyRecurring}>
          <Text style={styles.emptyText}>{t('budget.noRecurring')}</Text>
          <Text style={styles.emptyHint}>{t('recurring.emptyHint')}</Text>
        </View>
      ) : (
        items.map((item) => (
          <View key={item.id} style={[styles.item, !item.is_active && { opacity: 0.55 }]}>
            <View style={styles.itemHeader}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => openForm(item)}>
                <Text style={styles.itemTitle}>{item.description}</Text>
                <Text style={styles.itemMeta}>
                  {scheduleText(item)}
                  {' · '}
                  {item.kind === 'invoice'
                    ? t('recurring.withInvoiceFrom').replace('{supplier}', item.supplier_name || item.supplier_eik || '')
                    : item.auto_record ? t('recurring.noInvoiceAuto') : t('recurring.noInvoiceAsk')}
                </Text>
              </TouchableOpacity>
              <Text style={styles.itemAmount}>{money(item.amount)}</Text>
              <TouchableOpacity onPress={() => toggleActive(item)} accessibilityLabel={item.is_active ? t('recurring.pause') : t('recurring.resume')}>
                <Ionicons name={item.is_active ? 'pause-circle-outline' : 'play-circle-outline'} size={22} color={COLORS.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => remove(item)} accessibilityLabel={t('common.delete')}>
                <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
            {item.is_active && item.previous && <MonthLine occurrence={item.previous} />}
            {item.is_active && item.current && <MonthLine occurrence={item.current} />}
            {item.is_active && nextPaymentText(item) && (
              <Text style={styles.monthMuted}>{nextPaymentText(item)}</Text>
            )}
          </View>
        ))
      )}

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* The fields scroll inside their own margin - the scroll bar
                runs along the card's edge, clear of them - and Save stays
                in sight below. */}
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalBody}>
              <Text style={styles.modalTitle}>{editing ? t('recurring.edit') : t('budget.addRecurring')}</Text>

              <Text style={styles.inputLabel}>{t('budget.description')}</Text>
              <TextInput
                style={styles.input} value={description} onChangeText={setDescription}
                placeholder={t('budget.descPlaceholder')} placeholderTextColor={COLORS.textMuted}
              />

              <View style={styles.fieldRow}>
                <View style={styles.fieldWide}>
                  <Text style={styles.inputLabel} numberOfLines={1}>{t('recurring.usualAmount')}</Text>
                  <TextInput
                    style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad"
                    placeholder="0,00" placeholderTextColor={COLORS.textMuted}
                  />
                </View>
                <View style={styles.fieldNarrow}>
                  <Text style={styles.inputLabel} numberOfLines={1}>{t('budget.dayOfMonth')}</Text>
                  <TextInput
                    style={styles.input} value={day} onChangeText={setDay} keyboardType="number-pad"
                    placeholder="1–28" placeholderTextColor={COLORS.textMuted} maxLength={2}
                  />
                </View>
              </View>

              <Text style={styles.inputLabel}>{t('recurring.howOften')}</Text>
              <View style={styles.choiceRow}>
                {[...INTERVAL_CHOICES, 'other' as const].map((value) => {
                  const active = intervalChoice === value;
                  const label = value === 'other' ? t('recurring.otherInterval')
                    : value === 1 ? t('recurring.everyMonth')
                      : value === 12 ? t('recurring.yearly')
                        : t('recurring.everyNMonths').replace('{n}', String(value));
                  return (
                    <TouchableOpacity
                      key={String(value)}
                      style={[styles.choiceChip, active && styles.kindChipActive]}
                      onPress={() => setIntervalChoice(value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.kindChipText, active && { color: 'white' }]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {intervalChoice === 'other' && (
                <View style={styles.otherRow}>
                  <Text style={styles.otherText}>{t('recurring.everyPrefix')}</Text>
                  <TextInput
                    style={[styles.input, styles.otherInput]} value={otherInterval} onChangeText={setOtherInterval}
                    keyboardType="number-pad" placeholder="4" placeholderTextColor={COLORS.textMuted} maxLength={2} autoFocus
                  />
                  <Text style={styles.otherText}>{t('recurring.monthsSuffix')}</Text>
                </View>
              )}

              <View style={styles.fieldRow}>
                <View style={styles.fieldGrow}>
                  <Text style={styles.inputLabel} numberOfLines={1}>{t('recurring.firstPayment')}</Text>
                  <View style={styles.monthStepper}>
                    <TouchableOpacity
                      style={styles.stepButton} onPress={() => moveStart(-1)} disabled={startIndex <= 0}
                      accessibilityLabel={t('recurring.earlierMonth')}
                    >
                      <Ionicons name="chevron-back" size={18} color={startIndex <= 0 ? COLORS.border : COLORS.textSecondary} />
                    </TouchableOpacity>
                    <Text style={styles.stepText} numberOfLines={1}>{startMonth ? capitalized(monthYear(startMonth)) : ''}</Text>
                    <TouchableOpacity
                      style={styles.stepButton} onPress={() => moveStart(1)} disabled={startIndex >= startOptions.length - 1}
                      accessibilityLabel={t('recurring.laterMonth')}
                    >
                      <Ionicons
                        name="chevron-forward" size={18}
                        color={startIndex >= startOptions.length - 1 ? COLORS.border : COLORS.textSecondary}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.fieldCount}>
                  <Text style={styles.inputLabel} numberOfLines={1}>{t('recurring.paymentsCount')}</Text>
                  <TextInput
                    style={styles.input} value={paymentsCount} onChangeText={setPaymentsCount} keyboardType="number-pad"
                    placeholder={t('recurring.noEnd')} placeholderTextColor={COLORS.textMuted} maxLength={3}
                  />
                </View>
              </View>
              {lastPayment && (
                <Text style={[styles.kindHint, styles.scheduleHint, lastPayment < thisMonth && { color: COLORS.warning }]}>
                  {(lastPayment < thisMonth ? t('recurring.paymentsAlreadyOver') : t('recurring.lastPaymentHint'))
                    .replace('{month}', monthYear(lastPayment))}
                </Text>
              )}

              <Text style={styles.inputLabel}>{t('recurring.invoiceComes')}</Text>
              <View style={styles.kindRow}>
                {(['invoice', 'no_invoice'] as RecurringKind[]).map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.kindChip, kind === value && styles.kindChipActive]}
                    onPress={() => setKind(value)}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.kindChipText, kind === value && { color: 'white' }]}>
                      {value === 'invoice' ? t('recurring.withInvoice') : t('recurring.withoutInvoice')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.kindHint}>
                {kind === 'invoice' ? t('recurring.withInvoiceHint') : t('recurring.withoutInvoiceHint')}
              </Text>

              <Text style={styles.inputLabel}>
                {kind === 'invoice' ? t('recurring.supplier') : t('recurring.supplierOptional')}
              </Text>
              <TextInput
                style={styles.input} value={supplierName} onChangeText={setSupplierName}
                placeholder={t('recurring.supplierPlaceholder')} placeholderTextColor={COLORS.textMuted}
              />
              {knownSuppliers.length > 0 && !supplierName && (
                <View style={styles.supplierChips}>
                  {knownSuppliers.map((name) => (
                    <TouchableOpacity key={name} style={styles.supplierChip} onPress={() => setSupplierName(name)}>
                      <Text style={styles.supplierChipText} numberOfLines={1}>{name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={styles.inputLabel}>{t('recurring.supplierEik')}</Text>
              <TextInput
                style={styles.input} value={supplierEik} onChangeText={setSupplierEik}
                placeholder="123456789" placeholderTextColor={COLORS.textMuted} keyboardType="number-pad"
              />

              {kind === 'no_invoice' && (
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchLabel}>{t('recurring.autoRecord')}</Text>
                    <Text style={styles.kindHint}>{t('recurring.autoRecordHint')}</Text>
                  </View>
                  <Switch value={autoRecord} onValueChange={setAutoRecord} />
                </View>
              )}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <PressableScale style={styles.modalSaveBtn} onPress={save} disabled={saving}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.modalSaveText}>{t('common.save')}</Text>}
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  sectionTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: 'white' },
  addButton: { backgroundColor: COLORS.primary, borderRadius: 20, padding: 6 },
  outlookText: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 12, lineHeight: 18 },
  emptyRecurring: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 20, alignItems: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 14 },
  emptyHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center', lineHeight: 17 },
  item: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: 'white' },
  itemMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  itemAmount: { fontSize: 15, fontWeight: '700', color: 'white' },
  monthBlock: { marginTop: 8 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  monthText: { fontSize: 13, color: COLORS.textSecondary, flex: 1 },
  monthMuted: { fontSize: 13, color: COLORS.textMuted, marginTop: 8 },
  questionText: { fontSize: 13, color: 'white', marginTop: 6, lineHeight: 18 },
  answerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  answerBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background,
  },
  answerBtnStrong: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  answerText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  answerTextStrong: { color: 'white' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 12 },
  modalContent: {
    backgroundColor: COLORS.surface, borderRadius: 16, maxHeight: '92%', width: '100%', maxWidth: 520,
    alignSelf: 'center', overflow: 'hidden',
  },
  modalBody: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: 'white', marginBottom: 12 },
  inputLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, marginTop: 6 },
  input: {
    backgroundColor: COLORS.background, borderRadius: 10, padding: 12, color: 'white',
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 8, minWidth: 0,
  },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldWide: { flex: 3, minWidth: 0 },
  fieldNarrow: { flex: 2, minWidth: 0 },
  fieldGrow: { flex: 1, minWidth: 0 },
  fieldCount: { width: 108 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  choiceChip: {
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  otherText: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 8 },
  otherInput: { width: 64, textAlign: 'center' },
  monthStepper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.background, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 8, minHeight: 46,
  },
  stepButton: { paddingHorizontal: 6, alignSelf: 'stretch', justifyContent: 'center' },
  stepText: { flex: 1, minWidth: 0, textAlign: 'center', color: 'white', fontSize: 14 },
  scheduleHint: { marginTop: 0, marginBottom: 4 },
  kindRow: { flexDirection: 'row', gap: 8 },
  kindChip: {
    flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center',
  },
  kindChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  kindChipText: { color: COLORS.textSecondary, fontWeight: '600', fontSize: 13 },
  kindHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 6, lineHeight: 17 },
  supplierChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  supplierChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: COLORS.background, maxWidth: 160,
  },
  supplierChipText: { fontSize: 12, color: COLORS.textSecondary },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  switchLabel: { fontSize: 14, color: 'white', fontWeight: '600' },
  modalButtons: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 18, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  modalCancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  modalCancelText: { color: COLORS.textSecondary, fontWeight: '600' },
  modalSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: COLORS.primary },
  modalSaveText: { color: 'white', fontWeight: '700' },
});

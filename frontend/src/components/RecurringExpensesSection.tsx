import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ActivityIndicator, Switch, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
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

// What a business pays every month (rent, subscriptions, utilities): each
// says whether an invoice comes for it. With one, the invoice is the
// expense - awaited every month, never recorded twice; without one, the
// month is recorded as an off-book expense (when the owner says it is paid,
// or on its day). The backend decides each month's state; this shows it
// and the one or two answers it needs.
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

  const openForm = (item: RecurringExpense | null) => {
    setEditing(item);
    setDescription(item?.description || '');
    setAmount(item ? String(item.amount) : '');
    setDay(item ? String(item.day_of_month) : '1');
    setKind(item?.kind || 'invoice');
    setSupplierName(item?.supplier_name || '');
    setSupplierEik(item?.supplier_eik || '');
    setAutoRecord(!!item?.auto_record);
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
    if (kind === 'invoice' && !supplierName.trim() && !supplierEik.trim()) {
      Alert.alert(t('common.error'), t('recurring.supplierRequired'));
      return;
    }
    const payload = {
      description: description.trim(), amount: value, day_of_month: dayNumber, kind,
      supplier_name: supplierName.trim() || null, supplier_eik: supplierEik.trim() || null,
      auto_record: kind === 'no_invoice' && autoRecord,
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

      {monthOutlook && items.some((item) => item.is_active) && (
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
                  {t('recurring.everyMonthOn').replace('{day}', String(item.day_of_month))}
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
            {item.is_active && !item.current && (
              <Text style={styles.monthMuted}>
                {t('recurring.startsIn').replace('{month}', monthName(item.start_month))}
              </Text>
            )}
          </View>
        ))
      )}

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{editing ? t('recurring.edit') : t('budget.addRecurring')}</Text>

              <Text style={styles.inputLabel}>{t('budget.description')}</Text>
              <TextInput
                style={styles.input} value={description} onChangeText={setDescription}
                placeholder={t('budget.descPlaceholder')} placeholderTextColor={COLORS.textMuted}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>{t('recurring.usualAmount')}</Text>
                  <TextInput
                    style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad"
                    placeholder="0.00" placeholderTextColor={COLORS.textMuted}
                  />
                </View>
                <View style={{ width: 110 }}>
                  <Text style={styles.inputLabel}>{t('budget.dayOfMonth')}</Text>
                  <TextInput
                    style={styles.input} value={day} onChangeText={setDay} keyboardType="number-pad"
                    placeholder="1-28" placeholderTextColor={COLORS.textMuted}
                  />
                </View>
              </View>

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

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setModalVisible(false)}>
                  <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <PressableScale style={styles.modalSaveBtn} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.modalSaveText}>{t('common.save')}</Text>}
                </PressableScale>
              </View>
            </ScrollView>
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, maxHeight: '90%' },
  modalTitle: { fontSize: 18, fontWeight: '700', color: 'white', marginBottom: 16 },
  inputLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, marginTop: 6 },
  input: {
    backgroundColor: COLORS.background, borderRadius: 10, padding: 12, color: 'white',
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 8,
  },
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
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 18 },
  modalCancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  modalCancelText: { color: COLORS.textSecondary, fontWeight: '600' },
  modalSaveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: COLORS.primary },
  modalSaveText: { color: 'white', fontWeight: '700' },
});

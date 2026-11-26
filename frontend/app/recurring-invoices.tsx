import React, { useCallback, useEffect, useState } from 'react';
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
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import type { BillingDocument, BillingDocumentItem, RecurringInvoice } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet } from '../src/components';
import { COLORS } from '../src/theme/colors';
import { formatMoney, readAmount } from '../src/utils/money';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const money = (n: number) => `${formatMoney(n)}`;
const dayLabel = (iso: string) => format(parseISO(iso), 'dd.MM.yyyy');

type LineDraft = { name: string; quantity: string; unit: string; unit_price: string; vat_rate: string };
type EditDraft = { day: string; dueDays: string; endMonth: string; active: boolean; notes: string; lines: LineDraft[] };

const toLine = (item: BillingDocumentItem): LineDraft => ({
  name: item.name,
  quantity: String(item.quantity),
  unit: item.unit || 'бр.',
  unit_price: String(item.unit_price),
  vat_rate: String(item.vat_rate ?? 20),
});
const num = (text: string) => readAmount(text);

// Invoices that repeat (Н7): a subscription, a rent, a monthly service. On
// its day the month's invoice is ready - looked at and issued with one tap,
// through the same code as any invoice. A month is never issued twice.
export default function RecurringInvoicesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const allowed = hasPermission('issue_invoices');

  const [templates, setTemplates] = useState<RecurringInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [invoices, setInvoices] = useState<BillingDocument[]>([]);
  const [editing, setEditing] = useState<RecurringInvoice | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    try {
      setTemplates(await api.getRecurringInvoices());
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [allowed, t]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!allowed) return <AccessDenied />;

  const issue = (template: RecurringInvoice) => {
    const due = template.payment_method === 'bank_transfer'
      ? t('recurringInvoices.confirmDue').replace('{days}', String(template.due_days))
      : '';
    Alert.alert(
      t('recurringInvoices.confirmTitle'),
      t('recurringInvoices.confirmText')
        .replace('{customer}', template.customer_name)
        .replace('{amount}', money(template.total_amount))
        .replace('{due}', due),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('recurringInvoices.issue').replace('{month}', template.month_label),
          onPress: async () => {
            setIssuing(template.id);
            try {
              const result = await api.issueRecurringInvoice(template.id);
              Haptics.success();
              Toast.success(t('recurringInvoices.issued').replace('{number}', result.document.invoice_number || ''));
              await load();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
              await load();
            } finally {
              setIssuing(null);
            }
          },
        },
      ],
    );
  };

  const openPicker = async () => {
    setPickerOpen(true);
    try {
      const documents = await api.getBillingDocuments();
      setInvoices(documents.filter((d) => d.doc_type === 'invoice' && !d.cancelled && !d.recurring_invoice_id).slice(0, 30));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  const makeFrom = async (invoice: BillingDocument) => {
    setPickerOpen(false);
    try {
      await api.createRecurringInvoice({ from_document_id: invoice.id });
      Haptics.success();
      Toast.success(t('recurringInvoices.created'));
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  const openEdit = (template: RecurringInvoice) => {
    setEditing(template);
    setDraft({
      day: String(template.day_of_month),
      dueDays: String(template.due_days),
      endMonth: template.end_month || '',
      active: template.is_active,
      notes: template.notes || '',
      lines: template.items.map(toLine),
    });
  };

  const setLine = (index: number, change: Partial<LineDraft>) => {
    setDraft((current) => current && { ...current, lines: current.lines.map((line, i) => (i === index ? { ...line, ...change } : line)) });
  };

  const save = async () => {
    if (!editing || !draft) return;
    const day = parseInt(draft.day, 10);
    const dueDays = parseInt(draft.dueDays, 10);
    const items = draft.lines
      .filter((line) => line.name.trim())
      .map((line) => ({
        name: line.name.trim(),
        quantity: num(line.quantity),
        unit: line.unit.trim() || 'бр.',
        unit_price: num(line.unit_price),
        vat_rate: num(line.vat_rate),
      }));
    const valid = day >= 1 && day <= 31 && dueDays >= 0 && dueDays <= 180 && items.length > 0
      && items.every((item) => item.quantity > 0 && item.unit_price >= 0 && item.vat_rate >= 0 && item.vat_rate <= 100)
      && (!draft.endMonth.trim() || /^\d{4}-(0[1-9]|1[0-2])$/.test(draft.endMonth.trim()));
    if (!valid) {
      Alert.alert(t('common.error'), t('recurringInvoices.invalid'));
      return;
    }
    setSaving(true);
    try {
      await api.updateRecurringInvoice(editing.id, {
        day_of_month: day, due_days: dueDays, end_month: draft.endMonth.trim(), is_active: draft.active,
        notes: draft.notes.trim() || null, items,
      });
      Toast.success(t('recurringInvoices.saved'));
      setEditing(null);
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!editing) return;
    Alert.alert(t('recurringInvoices.edit'), t('recurringInvoices.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteRecurringInvoice(editing.id);
            setEditing(null);
            await load();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  const stateLine = (template: RecurringInvoice) => {
    switch (template.state) {
      case 'ready':
        return t('recurringInvoices.state.ready').replace('{month}', template.month_label);
      case 'upcoming':
        return t('recurringInvoices.state.upcoming').replace('{date}', dayLabel(template.issue_day));
      case 'issued':
        return t('recurringInvoices.state.issued').replace('{number}', template.issued_document?.invoice_number || '');
      default:
        return t(`recurringInvoices.state.${template.state}`);
    }
  };

  const stateColor = (template: RecurringInvoice) =>
    template.state === 'ready' ? COLORS.primary : template.state === 'issued' ? COLORS.success : COLORS.textMuted;

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('recurringInvoices.title')}</Text>
            <TouchableOpacity onPress={openPicker} style={styles.backButton} accessibilityLabel={t('recurringInvoices.fromInvoice')}>
              <Ionicons name="add" size={24} color="white" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          >
            <Text style={styles.intro}>{t('recurringInvoices.intro')}</Text>
            {loading ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
            ) : templates.length === 0 ? (
              <Text style={styles.empty}>{t('recurringInvoices.empty')}</Text>
            ) : (
              templates.map((template) => (
                <TouchableOpacity key={template.id} style={styles.card} onPress={() => openEdit(template)} activeOpacity={0.85}>
                  <View style={styles.cardTop}>
                    <Text style={styles.customer} numberOfLines={1}>{template.customer_name}</Text>
                    <Text style={styles.amount}>{t('recurringInvoices.perMonth').replace('{amount}', money(template.total_amount))}</Text>
                  </View>
                  <Text style={styles.sub} numberOfLines={1}>
                    {template.items.map((item) => item.name.replace('{месец}', template.month_label).replace('{month}', template.month_label)).join(', ')}
                  </Text>
                  <Text style={styles.sub}>
                    {template.day_of_month >= 31
                      ? t('recurringInvoices.lastDay')
                      : t('recurringInvoices.everyDay').replace('{day}', String(template.day_of_month))}
                  </Text>
                  <View style={styles.stateRow}>
                    <Ionicons
                      name={template.state === 'issued' ? 'checkmark-circle' : template.state === 'ready' ? 'time' : 'ellipse-outline'}
                      size={16}
                      color={stateColor(template)}
                    />
                    <Text style={[styles.stateText, { color: stateColor(template) }]}>{stateLine(template)}</Text>
                  </View>
                  {(template.state === 'ready' || template.state === 'upcoming') && (
                    <TouchableOpacity
                      style={[template.state === 'ready' ? styles.primaryButton : styles.secondaryButton, issuing === template.id && { opacity: 0.6 }]}
                      onPress={() => issue(template)}
                      disabled={issuing === template.id}
                    >
                      {issuing === template.id ? (
                        <ActivityIndicator color={template.state === 'ready' ? 'white' : COLORS.primary} />
                      ) : (
                        <Text style={template.state === 'ready' ? styles.primaryButtonText : styles.secondaryButtonText}>
                          {template.state === 'ready'
                            ? t('recurringInvoices.issue').replace('{month}', template.month_label)
                            : t('recurringInvoices.issueNow')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                  {template.history.length > 0 && (
                    <Text style={styles.history} numberOfLines={1}>
                      {t('recurringInvoices.history').replace(
                        '{list}',
                        template.history.slice(0, 4).map((entry) => `${entry.month.slice(5)}.${entry.month.slice(0, 4)} № ${entry.invoice_number}`).join(' · '),
                      )}
                    </Text>
                  )}
                </TouchableOpacity>
              ))
            )}
            <View style={{ height: 32 }} />
          </ScrollView>

          {/* A new one: made from an invoice already issued. */}
          <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>{t('recurringInvoices.pickInvoice')}</Text>
              <ScrollView style={{ maxHeight: 420 }}>
                {invoices.length === 0 && <Text style={styles.empty}>{t('recurringInvoices.noInvoices')}</Text>}
                {invoices.map((invoice) => (
                  <TouchableOpacity key={invoice.id} style={styles.pickRow} onPress={() => makeFrom(invoice)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.customer} numberOfLines={1}>{invoice.customer_name}</Text>
                      <Text style={styles.sub}>№ {invoice.invoice_number} · {dayLabel(invoice.issue_date)}</Text>
                    </View>
                    <Text style={styles.amount}>{money(invoice.total_amount)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </BottomSheet>

          <BottomSheet visible={!!editing} onClose={() => setEditing(null)}>
            {editing && draft && (
              <View style={styles.sheet}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={styles.sheetTitle}>{editing.customer_name}</Text>
                  <View style={styles.switchRow}>
                    <Text style={styles.fieldLabel}>{t('recurringInvoices.active')}</Text>
                    <Switch
                      value={draft.active}
                      onValueChange={(active) => setDraft({ ...draft, active })}
                      trackColor={{ false: COLORS.border, true: COLORS.primary }}
                      thumbColor="white"
                    />
                  </View>
                  <View style={styles.fieldRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{t('recurringInvoices.day')}</Text>
                      <TextInput style={styles.input} value={draft.day} keyboardType="number-pad" maxLength={2}
                        onChangeText={(day) => setDraft({ ...draft, day: day.replace(/\D/g, '') })} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>{t('recurringInvoices.dueDays')}</Text>
                      <TextInput style={styles.input} value={draft.dueDays} keyboardType="number-pad" maxLength={3}
                        onChangeText={(dueDays) => setDraft({ ...draft, dueDays: dueDays.replace(/\D/g, '') })} />
                    </View>
                  </View>
                  <Text style={styles.fieldLabel}>{t('recurringInvoices.endMonth')}</Text>
                  <TextInput style={styles.input} value={draft.endMonth} placeholder="2027-06" placeholderTextColor={COLORS.textMuted}
                    onChangeText={(endMonth) => setDraft({ ...draft, endMonth })} />

                  <Text style={[styles.fieldLabel, { marginTop: 14 }]}>{t('recurringInvoices.lines')}</Text>
                  {draft.lines.map((line, index) => (
                    <View key={index} style={styles.line}>
                      <TextInput style={styles.input} value={line.name} onChangeText={(name) => setLine(index, { name })} />
                      <View style={styles.fieldRow}>
                        <TextInput style={[styles.input, { flex: 1 }]} value={line.quantity} keyboardType="decimal-pad"
                          onChangeText={(quantity) => setLine(index, { quantity })} />
                        <TextInput style={[styles.input, { flex: 1 }]} value={line.unit} onChangeText={(unit) => setLine(index, { unit })} />
                        <TextInput style={[styles.input, { flex: 1.4 }]} value={line.unit_price} keyboardType="decimal-pad"
                          onChangeText={(unit_price) => setLine(index, { unit_price })} />
                        <TextInput style={[styles.input, { flex: 0.9 }]} value={line.vat_rate} keyboardType="decimal-pad"
                          onChangeText={(vat_rate) => setLine(index, { vat_rate })} />
                        {draft.lines.length > 1 && (
                          <TouchableOpacity onPress={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })} hitSlop={8}>
                            <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={styles.addLine}
                    onPress={() => setDraft({ ...draft, lines: [...draft.lines, { name: '', quantity: '1', unit: 'бр.', unit_price: '0', vat_rate: '20' }] })}
                  >
                    <Ionicons name="add" size={16} color={COLORS.primary} />
                    <Text style={styles.secondaryButtonText}>{t('recurringInvoices.addLine')}</Text>
                  </TouchableOpacity>
                  <Text style={styles.hint}>{t('recurringInvoices.monthHint')}</Text>
                  <Text style={styles.fieldLabel}>{t('recurringInvoices.notes')}</Text>
                  <TextInput style={[styles.input, { minHeight: 60 }]} value={draft.notes} multiline
                    onChangeText={(notes) => setDraft({ ...draft, notes })} />

                </ScrollView>
                <TouchableOpacity style={[styles.primaryButton, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>{t('common.save')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteButton} onPress={remove}>
                  <Text style={styles.deleteText}>{t('common.delete')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </BottomSheet>
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
  intro: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19, marginBottom: 12 },
  empty: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 24, lineHeight: 20 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customer: { flex: 1, color: 'white', fontSize: 15, fontWeight: '600' },
  amount: { color: 'white', fontSize: 14, fontWeight: '700' },
  sub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  stateText: { fontSize: 13, fontWeight: '600' },
  history: { color: COLORS.textMuted, fontSize: 12, marginTop: 8 },
  primaryButton: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 10 },
  primaryButtonText: { color: 'white', fontSize: 14, fontWeight: '600' },
  secondaryButton: { borderRadius: 12, padding: 11, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary, marginTop: 10 },
  secondaryButtonText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  sheet: { padding: 16, flexShrink: 1 },
  sheetTitle: { color: 'white', fontSize: 17, fontWeight: '700', marginBottom: 12 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 8, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: 'white',
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  line: { marginBottom: 10 },
  addLine: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  hint: { color: COLORS.textMuted, fontSize: 12, lineHeight: 16, marginTop: 4 },
  deleteButton: { alignItems: 'center', padding: 12, marginTop: 6 },
  deleteText: { color: COLORS.danger, fontWeight: '600' },
});

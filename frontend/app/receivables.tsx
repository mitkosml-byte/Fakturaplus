import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ImageBackground,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import { Receivable } from '../src/types';
import { useTranslation, useLanguageStore } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet, Expandable, AnimatedEmptyIcon, SkeletonRow } from '../src/components';
import DateTimePickerModal from '../src/components/AppDateTimePicker';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

type StatusFilter = 'all' | 'unpaid' | 'overdue' | 'paid';

// Deliberately the mirror image of the already-existing unpaid-invoice
// (payables) screen - "who owes me" instead of "who do I owe" - see
// Module 7, Finding #2 of the audit this was built from. Receivables
// don't require a saved Customer record; customer_name alone is enough,
// so this stays a lightweight ledger, never a CRM.
export default function ReceivablesScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { hasPermission } = useAuth();

  const canManage = hasPermission('add_revenue');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [summary, setSummary] = useState<{ total_owed: number; overdue_count: number } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formCustomerName, setFormCustomerName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDueDate, setFormDueDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customerNameError, setCustomerNameError] = useState(false);
  const [amountError, setAmountError] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      const [receivablesData, summaryData] = await Promise.all([
        api.getReceivables(statusFilter === 'all' ? undefined : statusFilter),
        api.getReceivablesSummary(),
      ]);
      setReceivables(receivablesData);
      setSummary(summaryData);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [canManage, statusFilter, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const isOverdue = useCallback((r: Receivable) => {
    if (r.is_paid || !r.due_date) return false;
    return r.due_date < format(new Date(), 'yyyy-MM-dd');
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setFormCustomerName('');
    setFormDescription('');
    setFormAmount('');
    setFormDueDate(null);
    setCustomerNameError(false);
    setAmountError(false);
  };

  const openEdit = (r: Receivable) => {
    setEditingId(r.id);
    setFormCustomerName(r.customer_name);
    setFormDescription(r.description || '');
    setFormAmount(String(r.amount));
    setFormDueDate(r.due_date ? new Date(r.due_date) : null);
    setCustomerNameError(false);
    setAmountError(false);
    setModalVisible(true);
  };

  const handleSave = async () => {
    const missingName = !formCustomerName.trim();
    const parsedAmount = parseFloat(formAmount);
    const invalidAmount = isNaN(parsedAmount) || parsedAmount <= 0;
    setCustomerNameError(missingName);
    setAmountError(invalidAmount);
    if (missingName || invalidAmount) return;

    setSaving(true);
    try {
      const payload = {
        customer_name: formCustomerName.trim(),
        description: formDescription.trim() || undefined,
        amount: parsedAmount,
        due_date: formDueDate ? format(formDueDate, 'yyyy-MM-dd') : undefined,
      };
      if (editingId) {
        await api.updateReceivable(editingId, payload);
        Toast.success(t('receivables.updated'));
      } else {
        await api.createReceivable(payload);
        Toast.success(t('receivables.saved'));
      }
      Haptics.success();
      setModalVisible(false);
      resetForm();
      loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (r: Receivable) => {
    try {
      await api.updateReceivable(r.id, { is_paid: true });
      Haptics.success();
      Toast.success(t('receivables.markedPaid'));
      loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  const handleDelete = (r: Receivable) => {
    Alert.alert(t('common.delete'), t('receivables.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteReceivable(r.id);
            Toast.success(t('receivables.deleted'));
            loadData();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  const total = useMemo(() => receivables.reduce((sum, r) => sum + r.amount, 0), [receivables]);

  if (!canManage) {
    return <AccessDenied />;
  }

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('receivables.title')}</Text>
            <TouchableOpacity
              onPress={() => { resetForm(); setModalVisible(true); }}
              style={styles.backButton}
              accessibilityLabel={t('receivables.add')}
            >
              <Ionicons name="add" size={24} color="white" />
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsRow}
            contentContainerStyle={styles.chipsContent}
          >
            {([
              { key: 'all', label: t('receivables.filterAll') },
              { key: 'unpaid', label: t('receivables.filterUnpaid') },
              { key: 'overdue', label: t('receivables.filterOverdue') },
              { key: 'paid', label: t('receivables.filterPaid') },
            ] as const).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, statusFilter === opt.key && styles.chipActive]}
                onPress={() => setStatusFilter(opt.key)}
              >
                <Text style={[styles.chipText, statusFilter === opt.key && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {summary && (
            <View style={styles.summaryBar}>
              <Text style={styles.summaryLabel}>{t('receivables.totalOwed')}: <Text style={[styles.summaryValue, { color: COLORS.warning }]}>{summary.total_owed.toFixed(2)} €</Text></Text>
              {summary.overdue_count > 0 && (
                <Text style={styles.summaryLabel}>{t('receivables.overdueCount')}: <Text style={[styles.summaryValue, { color: COLORS.danger }]}>{summary.overdue_count}</Text></Text>
              )}
            </View>
          )}

          {loading ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <SkeletonRow /><SkeletonRow /><SkeletonRow />
            </View>
          ) : (
            <ScrollView
              style={styles.content}
              contentContainerStyle={{ paddingBottom: 32 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
            >
              {receivables.length === 0 && (
                <View style={styles.emptyContainer}>
                  <AnimatedEmptyIcon name="cash-outline" size={64} color={COLORS.border} />
                  <Text style={styles.emptyText}>{t('receivables.empty')}</Text>
                </View>
              )}
              {receivables.map((r) => {
                const overdue = isOverdue(r);
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.card, overdue && styles.cardOverdue]}
                    onPress={() => openEdit(r)}
                  >
                    <View style={styles.rowTop}>
                      <Text style={styles.customerName} numberOfLines={1}>{r.customer_name}</Text>
                      <Text style={[styles.amount, r.is_paid && styles.amountPaid]}>{r.amount.toFixed(2)} €</Text>
                    </View>
                    {r.description ? <Text style={styles.description} numberOfLines={1}>{r.description}</Text> : null}
                    <View style={styles.rowBottom}>
                      <Text style={[styles.dueDate, overdue && styles.dueDateOverdue]}>
                        {r.is_paid
                          ? t('receivables.paidLabel')
                          : r.due_date
                            ? `${t('receivables.dueLabel')}: ${format(new Date(r.due_date), 'd MMM yyyy', { locale: dateLocale })}`
                            : t('receivables.noDueDate')}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                        {!r.is_paid && (
                          <TouchableOpacity onPress={() => handleMarkPaid(r)} hitSlop={8}>
                            <Ionicons name="checkmark-circle-outline" size={18} color={COLORS.success} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => handleDelete(r)} hitSlop={8}>
                          <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <BottomSheet visible={modalVisible} onClose={() => { setModalVisible(false); resetForm(); }}>
            <View style={styles.modalContent}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{editingId ? t('receivables.editTitle') : t('receivables.addNew')}</Text>

                <Text style={styles.inputLabel}>{t('receivables.customerName')}</Text>
                <TextInput
                  style={[styles.input, customerNameError && styles.inputErrorBorder]}
                  value={formCustomerName}
                  onChangeText={(v) => { setFormCustomerName(v); setCustomerNameError(false); }}
                  placeholder={t('receivables.customerNamePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                />
                <Expandable expanded={customerNameError}>
                  <Text style={styles.fieldErrorText}>{t('common.required')}</Text>
                </Expandable>

                <Text style={styles.inputLabel}>{t('receivables.amount')} (€)</Text>
                <TextInput
                  style={[styles.input, amountError && styles.inputErrorBorder]}
                  value={formAmount}
                  onChangeText={(v) => { setFormAmount(v); setAmountError(false); }}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={COLORS.textMuted}
                />
                <Expandable expanded={amountError}>
                  <Text style={styles.fieldErrorText}>{t('budget.invalidAmount')}</Text>
                </Expandable>

                <Text style={styles.inputLabel}>{t('receivables.description')}</Text>
                <TextInput
                  style={styles.input}
                  value={formDescription}
                  onChangeText={setFormDescription}
                  placeholder={t('receivables.descriptionPlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                />

                <Text style={styles.inputLabel}>{t('receivables.dueDate')}</Text>
                <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
                  <Text style={{ color: formDueDate ? 'white' : COLORS.textMuted }}>
                    {formDueDate ? format(formDueDate, 'd MMMM yyyy', { locale: dateLocale }) : t('receivables.noDueDate')}
                  </Text>
                </TouchableOpacity>
                <DateTimePickerModal
                  isVisible={showDatePicker}
                  mode="date"
                  date={formDueDate || new Date()}
                  onConfirm={(d) => { setFormDueDate(d); setShowDatePicker(false); }}
                  onCancel={() => setShowDatePicker(false)}
                  confirmTextIOS={t('common.select')}
                  cancelTextIOS={t('common.cancel')}
                  locale={language}
                />

                <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={() => { setModalVisible(false); resetForm(); }}>
                  <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </BottomSheet>
        </SafeAreaView>
      </View>
    </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(10, 15, 28, 0.88)' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white', flex: 1, textAlign: 'center' },
  chipsRow: { maxHeight: 44, marginBottom: 8 },
  chipsContent: { paddingHorizontal: 16, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: 'white' },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  summaryLabel: { fontSize: 13, color: COLORS.textSecondary },
  summaryValue: { fontWeight: 'bold' },
  content: { flex: 1, paddingHorizontal: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: COLORS.textMuted, fontSize: 14, marginTop: 12 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  cardOverdue: { borderWidth: 1, borderColor: COLORS.danger },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  customerName: { fontSize: 14, fontWeight: '600', color: 'white', flex: 1, marginRight: 8 },
  amount: { fontSize: 15, fontWeight: 'bold', color: COLORS.warning },
  amountPaid: { color: COLORS.success },
  description: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 },
  rowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dueDate: { fontSize: 12, color: COLORS.textMuted },
  dueDateOverdue: { color: COLORS.danger, fontWeight: '600' },
  modalContent: { padding: 20, paddingBottom: 30 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: 'white', marginBottom: 16 },
  inputLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    color: 'white',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputErrorBorder: { borderColor: COLORS.danger },
  fieldErrorText: { color: COLORS.danger, fontSize: 12, marginTop: 4 },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveButtonText: { color: 'white', fontWeight: 'bold', fontSize: 15 },
  cancelButton: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  cancelButtonText: { color: COLORS.textSecondary, fontSize: 14 },
});

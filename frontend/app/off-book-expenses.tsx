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
import { NonInvoiceExpense } from '../src/types';
import { useTranslation, useLanguageStore } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet, Expandable, AnimatedEmptyIcon, SkeletonRow, SuggestionChips, SwipeableRow } from '../src/components';
import DateTimePickerModal from '../src/components/AppDateTimePicker';
import { getDescriptionSuggestions } from '../src/utils/expenseSuggestions';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const MONTH_NAMES_BG = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type PeriodPreset = 'all' | 'thisMonth' | 'lastMonth';

export default function OffBookExpensesHistoryScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { hasPermission } = useAuth();
  const monthNames = language === 'bg' ? MONTH_NAMES_BG : MONTH_NAMES_EN;

  const canView = hasPermission('view_off_book_expenses');
  const canManage = hasPermission('add_expenses');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expenses, setExpenses] = useState<NonInvoiceExpense[]>([]);
  // Unfiltered, loaded once regardless of the period chips above - the
  // "Recent" quick-fill suggestions should always rank across this
  // business's full history, not just whatever period is on screen.
  const [suggestionSource, setSuggestionSource] = useState<NonInvoiceExpense[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDate, setFormDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [descriptionError, setDescriptionError] = useState(false);
  const [amountError, setAmountError] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadExpenses = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      const now = new Date();
      const params: { start_date?: string; end_date?: string } = {};
      if (periodPreset === 'thisMonth') {
        params.start_date = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
        params.end_date = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'yyyy-MM-dd');
      } else if (periodPreset === 'lastMonth') {
        params.start_date = format(new Date(now.getFullYear(), now.getMonth() - 1, 1), 'yyyy-MM-dd');
        params.end_date = format(new Date(now.getFullYear(), now.getMonth(), 0), 'yyyy-MM-dd');
      }
      const data = await api.getExpenses(params);
      setExpenses(data);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [canView, periodPreset, t]);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  useEffect(() => {
    if (!canView) return;
    api.getExpenses({}).then(setSuggestionSource).catch(() => {});
  }, [canView]);

  const suggestions = useMemo(() => getDescriptionSuggestions(suggestionSource), [suggestionSource]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadExpenses();
    setRefreshing(false);
  };

  // Search is client-side (no backend search param on /expenses, and this
  // list is realistically small enough - a small business's off-book
  // entries, not thousands of rows) rather than round-tripping per
  // keystroke like the audit log's server-side search does.
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((e) => e.description.toLowerCase().includes(q));
  }, [expenses, searchQuery]);

  const grouped = useMemo(() => {
    const groups: Record<string, NonInvoiceExpense[]> = {};
    filtered.forEach((e) => {
      const key = e.date.slice(0, 7); // YYYY-MM
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });
    return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const total = useMemo(() => filtered.reduce((sum, e) => sum + e.amount, 0), [filtered]);

  const resetForm = () => {
    setEditingId(null);
    setFormDescription('');
    setFormAmount('');
    setFormDate(new Date());
    setDescriptionError(false);
    setAmountError(false);
  };

  const openEdit = (expense: NonInvoiceExpense) => {
    setEditingId(expense.id);
    setFormDescription(expense.description);
    setFormAmount(String(expense.amount));
    setFormDate(new Date(expense.date));
    setDescriptionError(false);
    setAmountError(false);
    setModalVisible(true);
  };

  const handleSave = async () => {
    const missingDescription = !formDescription.trim();
    const parsedAmount = parseFloat(formAmount);
    const invalidAmount = isNaN(parsedAmount) || parsedAmount <= 0;
    setDescriptionError(missingDescription);
    setAmountError(invalidAmount);
    if (missingDescription || invalidAmount) return;

    setSaving(true);
    try {
      const payload = {
        description: formDescription.trim(),
        amount: parsedAmount,
        date: format(formDate, 'yyyy-MM-dd'),
      };
      if (editingId) {
        await api.updateExpense(editingId, payload);
        Toast.success(t('expenses.expenseUpdated'));
      } else {
        await api.createExpense(payload);
        Toast.success(t('msg.expenseSaved'));
      }
      Haptics.success();
      setModalVisible(false);
      resetForm();
      loadExpenses();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (expense: NonInvoiceExpense) => {
    Alert.alert(t('common.delete'), t('msg.deleteConfirmExpense'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteExpense(expense.id);
            Toast.success(t('expenses.expenseDeleted'));
            loadExpenses();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  if (!canView) {
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
            <Text style={styles.title}>{t('expenses.historyTitle')}</Text>
            {canManage ? (
              <TouchableOpacity
                onPress={() => { resetForm(); setModalVisible(true); }}
                style={styles.backButton}
                accessibilityLabel={t('expenses.add')}
              >
                <Ionicons name="add" size={24} color="white" />
              </TouchableOpacity>
            ) : <View style={styles.backButton} />}
          </View>

          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('expenses.searchPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsRow}
            contentContainerStyle={styles.chipsContent}
          >
            {([
              { key: 'all', label: t('expenses.periodAll') },
              { key: 'thisMonth', label: t('expenses.periodThisMonth') },
              { key: 'lastMonth', label: t('expenses.periodLastMonth') },
            ] as const).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, periodPreset === opt.key && styles.chipActive]}
                onPress={() => setPeriodPreset(opt.key)}
              >
                <Text style={[styles.chipText, periodPreset === opt.key && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.summaryBar}>
            <Text style={styles.summaryLabel}>{t('invoices.count')}: <Text style={styles.summaryValue}>{filtered.length}</Text></Text>
            <Text style={styles.summaryLabel}>{t('expenses.totalLabel')}: <Text style={[styles.summaryValue, { color: COLORS.warning }]}>{total.toFixed(2)} €</Text></Text>
          </View>

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
              {grouped.length === 0 && (
                <View style={styles.emptyContainer}>
                  <AnimatedEmptyIcon name="receipt-outline" size={64} color={COLORS.border} />
                  <Text style={styles.emptyText}>{t('expenses.empty')}</Text>
                </View>
              )}
              {grouped.map(([key, monthExpenses]) => {
                const [yearStr, monthStr] = key.split('-');
                const monthTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
                return (
                  <View key={key} style={styles.monthGroup}>
                    <View style={styles.monthHeader}>
                      <Text style={styles.monthHeaderTitle}>
                        {monthNames[parseInt(monthStr, 10) - 1]} {yearStr}
                      </Text>
                      <Text style={styles.monthHeaderStats}>
                        {monthExpenses.length} · {monthTotal.toFixed(2)} €
                      </Text>
                    </View>
                    {monthExpenses.map((expense) => (
                      <SwipeableRow
                        key={expense.id}
                        leftAction={canManage ? { label: t('common.edit'), icon: 'create-outline', color: COLORS.primary, onPress: () => openEdit(expense) } : undefined}
                        rightAction={canManage ? { label: t('common.delete'), icon: 'trash-outline', color: COLORS.danger, onPress: () => handleDelete(expense) } : undefined}
                      >
                      <TouchableOpacity
                        style={styles.expenseCard}
                        disabled={!canManage}
                        onPress={() => canManage && openEdit(expense)}
                      >
                        <View style={styles.expenseRowTop}>
                          <Text style={styles.expenseDescription} numberOfLines={1}>{expense.description}</Text>
                          <Text style={styles.expenseAmount}>{expense.amount.toFixed(2)} €</Text>
                        </View>
                        <View style={styles.expenseRowBottom}>
                          <Text style={styles.expenseDate}>{format(new Date(expense.date), 'd MMM yyyy', { locale: dateLocale })}</Text>
                          {canManage && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                              <Ionicons name="create-outline" size={16} color={COLORS.textMuted} />
                              <TouchableOpacity onPress={() => handleDelete(expense)} hitSlop={8}>
                                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                      </SwipeableRow>
                    ))}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <BottomSheet visible={modalVisible} onClose={() => { setModalVisible(false); resetForm(); }}>
            <View style={styles.modalContent}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{editingId ? t('expenses.editExpense') : t('expenses.addNew')}</Text>

                <SuggestionChips
                  suggestions={suggestions}
                  label={t('expenses.recentDescriptions')}
                  onPick={(s) => {
                    setFormDescription(s.description);
                    setFormAmount(String(s.amount));
                    setDescriptionError(false);
                    setAmountError(false);
                  }}
                />

                <Text style={styles.inputLabel}>{t('expenses.description')}</Text>
                <TextInput
                  style={[styles.input, descriptionError && styles.inputErrorBorder]}
                  value={formDescription}
                  onChangeText={(v) => { setFormDescription(v); setDescriptionError(false); }}
                  placeholder={t('expenses.placeholder')}
                  placeholderTextColor={COLORS.textMuted}
                />
                <Expandable expanded={descriptionError}>
                  <Text style={styles.fieldErrorText}>{t('common.required')}</Text>
                </Expandable>

                <Text style={styles.inputLabel}>{t('expenses.amount')} (€)</Text>
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

                <Text style={styles.inputLabel}>{t('home.date')}</Text>
                <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
                  <Text style={{ color: 'white' }}>{format(formDate, 'd MMMM yyyy', { locale: dateLocale })}</Text>
                </TouchableOpacity>
                <DateTimePickerModal
                  isVisible={showDatePicker}
                  mode="date"
                  date={formDate}
                  onConfirm={(d) => { setFormDate(d); setShowDatePicker(false); }}
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    gap: 8,
  },
  searchInput: { flex: 1, color: 'white', paddingVertical: 10, fontSize: 14 },
  chipsRow: { maxHeight: 44, marginBottom: 8 },
  chipsContent: { paddingHorizontal: 16, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    marginRight: 0,
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
  summaryValue: { fontWeight: 'bold', color: 'white' },
  content: { flex: 1, paddingHorizontal: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: COLORS.textMuted, fontSize: 14, marginTop: 12 },
  monthGroup: { marginBottom: 20 },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  monthHeaderTitle: { fontSize: 15, fontWeight: 'bold', color: 'white' },
  monthHeaderStats: { fontSize: 12, color: COLORS.textMuted },
  expenseCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  expenseRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  expenseDescription: { fontSize: 14, fontWeight: '600', color: 'white', flex: 1, marginRight: 8 },
  expenseAmount: { fontSize: 15, fontWeight: 'bold', color: COLORS.warning },
  expenseRowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  expenseDate: { fontSize: 12, color: COLORS.textMuted },
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

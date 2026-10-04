import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { PersonalExpense, PersonalExpenseType, PersonalExpenseCategory } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const MONTH_NAMES_BG = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type PeriodPreset = 'all' | 'thisYear' | 'thisMonth' | 'lastMonth';

const TYPE_COLORS: Record<PersonalExpenseType, string> = {
  investment: COLORS.danger,
  recurring: COLORS.primary,
  one_time: COLORS.warning,
};

const CATEGORY_KEYS: Record<PersonalExpenseCategory, string> = {
  goods: 'personal.categoryGoods',
  service: 'personal.categoryService',
  personnel: 'personal.categoryPersonnel',
  rent: 'personal.categoryRent',
  extraordinary: 'personal.categoryExtraordinary',
  other: 'personal.categoryOther',
};

const TYPE_KEYS: Record<PersonalExpenseType, string> = {
  investment: 'personal.typeInvestment',
  recurring: 'personal.typeRecurring',
  one_time: 'personal.typeOneTime',
};

export default function PersonalExpensesHistoryScreen() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const { isOwner, hasPermission } = useAuth();
  const monthNames = language === 'bg' ? MONTH_NAMES_BG : MONTH_NAMES_EN;

  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<PersonalExpense[]>([]);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [typeFilter, setTypeFilter] = useState<PersonalExpenseType | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<PersonalExpenseCategory | 'all'>('all');

  const [modalVisible, setModalVisible] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [expenseType, setExpenseType] = useState<PersonalExpenseType>('recurring');
  const [category, setCategory] = useState<PersonalExpenseCategory>('other');
  const [saving, setSaving] = useState(false);

  const loadExpenses = useCallback(async () => {
    try {
      const now = new Date();
      const params: { month?: number; year?: number } = {};
      if (periodPreset === 'thisYear') {
        params.year = now.getFullYear();
      } else if (periodPreset === 'thisMonth') {
        params.month = now.getMonth() + 1;
        params.year = now.getFullYear();
      } else if (periodPreset === 'lastMonth') {
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        params.month = lastMonth.getMonth() + 1;
        params.year = lastMonth.getFullYear();
      }
      const data = await api.getPersonalExpenses(params);
      setExpenses(data.personal_expenses);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [periodPreset, t]);

  useFocusEffect(
    useCallback(() => {
      loadExpenses();
    }, [loadExpenses])
  );

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (typeFilter !== 'all' && e.expense_type !== typeFilter) return false;
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      return true;
    });
  }, [expenses, typeFilter, categoryFilter]);

  const total = filtered.reduce((sum, e) => sum + e.amount, 0);

  const grouped = useMemo(() => {
    const byMonth = new Map<string, PersonalExpense[]>();
    for (const e of filtered) {
      const key = `${e.period_year}-${String(e.period_month).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(e);
    }
    return Array.from(byMonth.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const resetForm = () => {
    setAmount('');
    setDescription('');
    setExpenseType('recurring');
    setCategory('other');
  };

  const handleSave = async () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert(t('common.error'), t('budget.invalidAmount'));
      return;
    }
    if (!description.trim()) {
      Alert.alert(t('common.error'), t('msg.fillAllFields'));
      return;
    }
    setSaving(true);
    try {
      const now = new Date();
      await api.createPersonalExpense({
        amount: parsedAmount,
        description: description.trim(),
        expense_type: expenseType,
        category,
        period_month: now.getMonth() + 1,
        period_year: now.getFullYear(),
      });
      setModalVisible(false);
      resetForm();
      await loadExpenses();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (expense: PersonalExpense) => {
    Alert.alert(t('common.delete'), t('personal.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deletePersonalExpense(expense.id);
            await loadExpenses();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  if (!hasPermission('view_personal_investments')) {
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
            <Text style={styles.title}>{t('personal.title')}</Text>
            {isOwner ? (
              <TouchableOpacity
                onPress={() => { resetForm(); setModalVisible(true); }}
                style={styles.backButton}
                accessibilityLabel={t('personal.addExpense')}
              >
                <Ionicons name="add" size={24} color="white" />
              </TouchableOpacity>
            ) : (
              <View style={styles.backButton} />
            )}
          </View>

          <TouchableOpacity
            style={styles.filtersToggle}
            onPress={() => setFiltersExpanded((prev) => !prev)}
          >
            <Ionicons name="options-outline" size={16} color={COLORS.primary} />
            <Text style={styles.filtersToggleText}>{t('invoices.filtersButton')}</Text>
            <Ionicons name={filtersExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.primary} />
          </TouchableOpacity>

          {filtersExpanded && (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chipsContent}>
                {([
                  { key: 'all', label: t('invoices.periodAll') },
                  { key: 'thisMonth', label: t('invoices.periodThisMonth') },
                  { key: 'lastMonth', label: t('invoices.periodLastMonth') },
                  { key: 'thisYear', label: t('invoices.periodThisYear') },
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

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chipsContent}>
                <TouchableOpacity
                  style={[styles.chip, typeFilter === 'all' && styles.chipActive]}
                  onPress={() => setTypeFilter('all')}
                >
                  <Text style={[styles.chipText, typeFilter === 'all' && styles.chipTextActive]}>{t('invoices.periodAll')}</Text>
                </TouchableOpacity>
                {(Object.keys(TYPE_KEYS) as PersonalExpenseType[]).map((tKey) => (
                  <TouchableOpacity
                    key={tKey}
                    style={[styles.chip, typeFilter === tKey && styles.chipActive]}
                    onPress={() => setTypeFilter(tKey)}
                  >
                    <Text style={[styles.chipText, typeFilter === tKey && styles.chipTextActive]}>{t(TYPE_KEYS[tKey])}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chipsContent}>
                <TouchableOpacity
                  style={[styles.chip, categoryFilter === 'all' && styles.chipActive]}
                  onPress={() => setCategoryFilter('all')}
                >
                  <Text style={[styles.chipText, categoryFilter === 'all' && styles.chipTextActive]}>{t('invoices.periodAll')}</Text>
                </TouchableOpacity>
                {(Object.keys(CATEGORY_KEYS) as PersonalExpenseCategory[]).map((cKey) => (
                  <TouchableOpacity
                    key={cKey}
                    style={[styles.chip, categoryFilter === cKey && styles.chipActive]}
                    onPress={() => setCategoryFilter(cKey)}
                  >
                    <Text style={[styles.chipText, categoryFilter === cKey && styles.chipTextActive]}>{t(CATEGORY_KEYS[cKey])}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <View style={styles.summaryBar}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('invoices.count')}:</Text>
              <Text style={styles.summaryValue}>{filtered.length}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('roi.totalInvestment')}:</Text>
              <Text style={[styles.summaryValue, { color: COLORS.danger }]}>{total.toFixed(2)} €</Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 32 }}>
              {grouped.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Ionicons name="wallet-outline" size={64} color={COLORS.border} />
                  <Text style={styles.emptyText}>{t('personal.noExpenses')}</Text>
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
                      <View key={expense.id} style={styles.expenseCard}>
                        <View style={styles.expenseRowTop}>
                          <Text style={styles.expenseDescription} numberOfLines={1}>{expense.description}</Text>
                          <Text style={[styles.expenseAmount, { color: TYPE_COLORS[expense.expense_type] }]}>
                            {expense.amount.toFixed(2)} €
                          </Text>
                        </View>
                        <View style={styles.expenseRowBottom}>
                          <View style={styles.badgeRow}>
                            <View style={[styles.badge, { backgroundColor: `${TYPE_COLORS[expense.expense_type]}20` }]}>
                              <Text style={[styles.badgeText, { color: TYPE_COLORS[expense.expense_type] }]}>
                                {t(TYPE_KEYS[expense.expense_type])}
                              </Text>
                            </View>
                            <View style={styles.badge}>
                              <Text style={styles.badgeTextNeutral}>{t(CATEGORY_KEYS[expense.category])}</Text>
                            </View>
                          </View>
                          {isOwner && (
                            <TouchableOpacity onPress={() => handleDelete(expense)} hitSlop={8}>
                              <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                            </TouchableOpacity>
                          )}
                        </View>
                        {(expense.project_name || expense.notes) && (
                          <Text style={styles.expenseMeta} numberOfLines={1}>
                            {[expense.project_name && `${t('personal.project')}: ${expense.project_name}`, expense.notes]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <BottomSheet visible={modalVisible} onClose={() => setModalVisible(false)}>
              <View style={styles.modalContent}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={styles.modalTitle}>{t('personal.addExpense')}</Text>

                  <Text style={styles.inputLabel}>{t('personal.amount')}</Text>
                  <TextInput
                    style={styles.input}
                    value={amount}
                    onChangeText={setAmount}
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="decimal-pad"
                  />

                  <Text style={styles.inputLabel}>{t('personal.description')}</Text>
                  <TextInput
                    style={styles.input}
                    value={description}
                    onChangeText={setDescription}
                    placeholder={t('personal.descriptionPlaceholder')}
                    placeholderTextColor={COLORS.textMuted}
                  />

                  <Text style={styles.inputLabel}>{t('personal.type')}</Text>
                  <View style={styles.chipRowWrap}>
                    {(Object.keys(TYPE_KEYS) as PersonalExpenseType[]).map((tKey) => (
                      <TouchableOpacity
                        key={tKey}
                        style={[styles.chip, expenseType === tKey && styles.chipActive]}
                        onPress={() => setExpenseType(tKey)}
                      >
                        <Text style={[styles.chipText, expenseType === tKey && styles.chipTextActive]}>{t(TYPE_KEYS[tKey])}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.inputLabel}>{t('personal.category')}</Text>
                  <View style={styles.chipRowWrap}>
                    {(Object.keys(CATEGORY_KEYS) as PersonalExpenseCategory[]).map((cKey) => (
                      <TouchableOpacity
                        key={cKey}
                        style={[styles.chip, category === cKey && styles.chipActive]}
                        onPress={() => setCategory(cKey)}
                      >
                        <Text style={[styles.chipText, category === cKey && styles.chipTextActive]}>{t(CATEGORY_KEYS[cKey])}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                    {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelButton} onPress={() => setModalVisible(false)}>
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
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  filtersToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filtersToggleText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },
  chipsRow: { marginTop: 10, height: 40, flexGrow: 0, flexShrink: 0 },
  chipsContent: { paddingHorizontal: 16, alignItems: 'center' },
  chipRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.background,
    marginRight: 8,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '500' },
  chipTextActive: { color: 'white' },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: COLORS.surface,
    margin: 16,
    borderRadius: 12,
    padding: 12,
  },
  summaryItem: { alignItems: 'center' },
  summaryLabel: { fontSize: 12, color: COLORS.textMuted },
  summaryValue: { fontSize: 16, fontWeight: 'bold', color: 'white', marginTop: 2 },
  content: { flex: 1, paddingHorizontal: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, color: COLORS.textMuted, marginTop: 16 },
  monthGroup: { marginBottom: 18 },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  monthHeaderTitle: { fontSize: 15, fontWeight: '700', color: COLORS.primaryLight },
  monthHeaderStats: { fontSize: 12, color: COLORS.textSecondary },
  expenseCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
  },
  expenseRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expenseDescription: { fontSize: 15, fontWeight: '600', color: 'white', flex: 1, marginRight: 8 },
  expenseAmount: { fontSize: 15, fontWeight: 'bold' },
  expenseRowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  badgeRow: { flexDirection: 'row', gap: 6 },
  badge: { backgroundColor: COLORS.background, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  badgeTextNeutral: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary },
  expenseMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: 'white', marginBottom: 16 },
  inputLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: 'white',
    fontSize: 15,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  cancelButton: { alignItems: 'center', paddingVertical: 14 },
  cancelButtonText: { color: COLORS.textSecondary, fontSize: 14 },
});

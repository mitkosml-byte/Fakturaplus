import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { api } from '../src/services/api';
import { PersonalExpense, PersonalExpenseType, PersonalExpenseCategory, PersonalWalletEntry, PersonalWalletSummary, PersonalWalletCategory } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet, Expandable, AnimatedEmptyIcon, ChipTabs, CountUp, SkeletonRow } from '../src/components';
import DateTimePickerModal from '../src/components/AppDateTimePicker';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const MONTH_NAMES_BG = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type PeriodPreset = 'all' | 'thisYear' | 'thisMonth' | 'lastMonth';
type MainTab = 'investments' | 'wallet';

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

const WALLET_CATEGORY_KEYS: Record<PersonalWalletCategory, string> = {
  loan: 'wallet.categoryLoan',
  lease: 'wallet.categoryLease',
  utility: 'wallet.categoryUtility',
  insurance: 'wallet.categoryInsurance',
  subscription: 'wallet.categorySubscription',
  daily: 'wallet.categoryDaily',
  one_off: 'wallet.categoryOneOff',
};

const WALLET_CATEGORY_ICONS: Record<PersonalWalletCategory, keyof typeof Ionicons.glyphMap> = {
  loan: 'card-outline',
  lease: 'car-outline',
  utility: 'flash-outline',
  insurance: 'shield-checkmark-outline',
  subscription: 'repeat-outline',
  daily: 'basket-outline',
  one_off: 'pricetag-outline',
};

const WALLET_CATEGORY_COLORS: Record<PersonalWalletCategory, string> = {
  loan: COLORS.danger,
  lease: COLORS.warning,
  utility: COLORS.info,
  insurance: COLORS.indigo,
  subscription: COLORS.pink,
  daily: COLORS.success,
  one_off: COLORS.textMuted,
};

const WALLET_STATUS_COLORS: Record<string, string> = {
  ok: COLORS.success,
  warning: COLORS.warning,
  danger: COLORS.danger,
};

const WALLET_STATUS_KEYS: Record<string, string> = {
  ok: 'wallet.statusOk',
  warning: 'wallet.statusWarning',
  danger: 'wallet.statusDanger',
};

export default function PersonalExpensesHistoryScreen() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const { isOwner, hasPermission } = useAuth();
  const monthNames = language === 'bg' ? MONTH_NAMES_BG : MONTH_NAMES_EN;

  const canViewWallet = hasPermission('view_personal_wallet');
  const canAddWallet = hasPermission('add_personal_wallet_entries');
  const canManageWallet = hasPermission('manage_personal_wallet');

  const [activeMainTab, setActiveMainTab] = useState<MainTab>('investments');

  // ===================== Investments (business ROI) - unchanged =====================
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<PersonalExpense[]>([]);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [typeFilter, setTypeFilter] = useState<PersonalExpenseType | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<PersonalExpenseCategory | 'all'>('all');

  const [modalVisible, setModalVisible] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [amountError, setAmountError] = useState(false);
  const [descriptionError, setDescriptionError] = useState(false);
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

  // ===================== Personal Wallet (Лично тефтерче) =====================
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletEntries, setWalletEntries] = useState<PersonalWalletEntry[]>([]);
  const [walletSummary, setWalletSummary] = useState<PersonalWalletSummary | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [thresholdInput, setThresholdInput] = useState('80');
  const [thresholdSaving, setThresholdSaving] = useState(false);

  const [walletModalVisible, setWalletModalVisible] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [walletCategory, setWalletCategory] = useState<PersonalWalletCategory>('daily');
  const [walletAmount, setWalletAmount] = useState('');
  const [walletDescription, setWalletDescription] = useState('');
  const [walletDate, setWalletDate] = useState(new Date());
  const [walletIsRecurring, setWalletIsRecurring] = useState(false);
  const [walletNextDueDate, setWalletNextDueDate] = useState(new Date());
  const [walletHasRecurringUntil, setWalletHasRecurringUntil] = useState(false);
  const [walletRecurringUntil, setWalletRecurringUntil] = useState(new Date());
  const [walletNotes, setWalletNotes] = useState('');
  const [walletAmountError, setWalletAmountError] = useState(false);
  const [walletDescriptionError, setWalletDescriptionError] = useState(false);
  const [walletSaving, setWalletSaving] = useState(false);
  const [showWalletDatePicker, setShowWalletDatePicker] = useState(false);
  const [showWalletDueDatePicker, setShowWalletDueDatePicker] = useState(false);
  const [showWalletRecurringUntilPicker, setShowWalletRecurringUntilPicker] = useState(false);

  const loadWallet = useCallback(async () => {
    if (!canViewWallet) {
      setWalletLoading(false);
      return;
    }
    try {
      const [entriesRes, summaryRes] = await Promise.all([
        api.getPersonalWalletEntries(),
        api.getPersonalWalletSummary(),
      ]);
      setWalletEntries(entriesRes.entries);
      setWalletSummary(summaryRes);
      setThresholdInput(String(summaryRes.threshold_percent));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setWalletLoading(false);
    }
  }, [canViewWallet, t]);

  useFocusEffect(
    useCallback(() => {
      loadExpenses();
      loadWallet();
    }, [loadExpenses, loadWallet])
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

  const walletGrouped = useMemo(() => {
    const byMonth = new Map<string, PersonalWalletEntry[]>();
    for (const e of walletEntries) {
      const key = e.date.slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(e);
    }
    return Array.from(byMonth.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [walletEntries]);

  const resetForm = () => {
    setAmount('');
    setDescription('');
    setExpenseType('recurring');
    setCategory('other');
  };

  const handleSave = async () => {
    const parsedAmount = parseFloat(amount);
    const invalidAmount = isNaN(parsedAmount) || parsedAmount <= 0;
    const missingDescription = !description.trim();
    setAmountError(invalidAmount);
    setDescriptionError(missingDescription);
    if (invalidAmount || missingDescription) return;
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

  const resetWalletForm = () => {
    setEditingEntryId(null);
    setWalletCategory('daily');
    setWalletAmount('');
    setWalletDescription('');
    setWalletDate(new Date());
    setWalletIsRecurring(false);
    setWalletNextDueDate(new Date());
    setWalletHasRecurringUntil(false);
    setWalletRecurringUntil(new Date());
    setWalletNotes('');
    setWalletAmountError(false);
    setWalletDescriptionError(false);
  };

  const openEditWalletEntry = (entry: PersonalWalletEntry) => {
    setEditingEntryId(entry.id);
    setWalletCategory(entry.category);
    setWalletAmount(String(entry.amount));
    setWalletDescription(entry.description);
    setWalletDate(new Date(entry.date));
    setWalletIsRecurring(entry.is_recurring);
    setWalletNextDueDate(entry.next_due_date ? new Date(entry.next_due_date) : new Date());
    setWalletHasRecurringUntil(!!entry.recurring_until);
    setWalletRecurringUntil(entry.recurring_until ? new Date(entry.recurring_until) : new Date());
    setWalletNotes(entry.notes || '');
    setWalletAmountError(false);
    setWalletDescriptionError(false);
    setWalletModalVisible(true);
  };

  const handleSaveWalletEntry = async () => {
    const parsedAmount = parseFloat(walletAmount);
    const invalidAmount = isNaN(parsedAmount) || parsedAmount <= 0;
    const missingDescription = !walletDescription.trim();
    setWalletAmountError(invalidAmount);
    setWalletDescriptionError(missingDescription);
    if (invalidAmount || missingDescription) return;
    setWalletSaving(true);
    try {
      const payload = {
        category: walletCategory,
        description: walletDescription.trim(),
        amount: parsedAmount,
        date: walletDate.toISOString().slice(0, 10),
        is_recurring: walletIsRecurring,
        next_due_date: walletIsRecurring ? walletNextDueDate.toISOString().slice(0, 10) : undefined,
        recurring_until: walletIsRecurring && walletHasRecurringUntil
          ? walletRecurringUntil.toISOString().slice(0, 10)
          : null,
        notes: walletNotes.trim() || undefined,
      };
      if (editingEntryId) {
        await api.updatePersonalWalletEntry(editingEntryId, payload);
      } else {
        await api.createPersonalWalletEntry(payload);
      }
      setWalletModalVisible(false);
      resetWalletForm();
      Toast.success(t('wallet.entrySaved'));
      await loadWallet();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setWalletSaving(false);
    }
  };

  const handleDeleteWalletEntry = (entry: PersonalWalletEntry) => {
    Alert.alert(t('common.delete'), t('wallet.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deletePersonalWalletEntry(entry.id);
            Toast.success(t('wallet.entryDeleted'));
            await loadWallet();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  const handleSaveThreshold = async () => {
    const parsed = parseFloat(thresholdInput);
    if (isNaN(parsed) || parsed <= 0) return;
    setThresholdSaving(true);
    try {
      await api.updatePersonalWalletSettings(parsed);
      Toast.success(t('wallet.thresholdSaved'));
      await loadWallet();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setThresholdSaving(false);
    }
  };

  if (!hasPermission('view_personal_investments') && !canViewWallet) {
    return <AccessDenied />;
  }

  // A viewer with only wallet access (no business-investment visibility)
  // never sees the Investments tab at all, and lands straight on Wallet.
  const showTabs = hasPermission('view_personal_investments') && canViewWallet;
  const effectiveTab: MainTab = hasPermission('view_personal_investments') ? activeMainTab : 'wallet';

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{effectiveTab === 'wallet' ? t('wallet.title') : t('personal.title')}</Text>
            {effectiveTab === 'wallet' ? (
              canAddWallet ? (
                <TouchableOpacity
                  onPress={() => { resetWalletForm(); setWalletModalVisible(true); }}
                  style={styles.backButton}
                  accessibilityLabel={t('wallet.addEntry')}
                >
                  <Ionicons name="add" size={24} color="white" />
                </TouchableOpacity>
              ) : <View style={styles.backButton} />
            ) : isOwner ? (
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

          {showTabs && (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <ChipTabs<MainTab>
                active={activeMainTab}
                onChange={setActiveMainTab}
                options={[
                  { key: 'investments', label: t('wallet.tabInvestments'), icon: 'trending-up' },
                  { key: 'wallet', label: t('wallet.tabWallet'), icon: 'wallet' },
                ]}
              />
            </View>
          )}

          {effectiveTab === 'investments' ? (
          <>
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
                  <AnimatedEmptyIcon name="wallet-outline" size={64} color={COLORS.border} />
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
          </>
          ) : (
          <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 32, paddingTop: 12 }}>
            {walletLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : walletSummary ? (
              <>
                {/* Safe-to-spend - the headline number this whole feature exists for */}
                <View style={[styles.safeCard, { borderColor: WALLET_STATUS_COLORS[walletSummary.status] }]}>
                  <View style={styles.safeCardHeader}>
                    <Text style={styles.safeCardLabel}>{t('wallet.safeToSpend')}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: `${WALLET_STATUS_COLORS[walletSummary.status]}20` }]}>
                      <Text style={[styles.statusBadgeText, { color: WALLET_STATUS_COLORS[walletSummary.status] }]}>
                        {t(WALLET_STATUS_KEYS[walletSummary.status])}
                      </Text>
                    </View>
                  </View>
                  <CountUp
                    value={walletSummary.safe_to_spend}
                    formatter={(n) => `${n.toFixed(2)} €`}
                    style={[styles.safeCardValue, { color: WALLET_STATUS_COLORS[walletSummary.status] }]}
                  />
                  <Text style={styles.safeCardHint}>{t('wallet.safeToSpendHint')}</Text>
                  {walletSummary.spent_percent_of_profit !== null && (
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min(walletSummary.spent_percent_of_profit, 100)}%`,
                            backgroundColor: WALLET_STATUS_COLORS[walletSummary.status],
                          },
                        ]}
                      />
                    </View>
                  )}
                  <View style={styles.safeCardFooter}>
                    <Text style={styles.safeCardFooterText}>
                      {t('wallet.spentThisMonth')}: {walletSummary.total_spent.toFixed(2)} €
                    </Text>
                    {walletSummary.spent_percent_of_profit !== null && (
                      <Text style={styles.safeCardFooterText}>
                        {walletSummary.spent_percent_of_profit.toFixed(0)}% {t('wallet.ofProfit')}
                      </Text>
                    )}
                  </View>
                </View>

                {/* Needs vs wants */}
                {walletSummary.total_spent > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('wallet.needsVsWants')}</Text>
                    <View style={styles.needsWantsRow}>
                      <View style={styles.needsWantsItem}>
                        <Text style={styles.needsWantsLabel}>{t('wallet.needs')}</Text>
                        <Text style={[styles.needsWantsValue, { color: COLORS.danger }]}>{walletSummary.needs_total.toFixed(2)} €</Text>
                      </View>
                      <View style={styles.needsWantsItem}>
                        <Text style={styles.needsWantsLabel}>{t('wallet.wants')}</Text>
                        <Text style={[styles.needsWantsValue, { color: COLORS.warning }]}>{walletSummary.wants_total.toFixed(2)} €</Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* Category breakdown */}
                {Object.keys(walletSummary.category_totals).length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('wallet.byCategory')}</Text>
                    {(Object.entries(walletSummary.category_totals) as [PersonalWalletCategory, number][])
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, amt]) => (
                        <View key={cat} style={styles.categoryRow}>
                          <View style={[styles.categoryIconWrap, { backgroundColor: `${WALLET_CATEGORY_COLORS[cat]}20` }]}>
                            <Ionicons name={WALLET_CATEGORY_ICONS[cat]} size={16} color={WALLET_CATEGORY_COLORS[cat]} />
                          </View>
                          <Text style={styles.categoryRowLabel}>{t(WALLET_CATEGORY_KEYS[cat])}</Text>
                          <Text style={styles.categoryRowValue}>{amt.toFixed(2)} €</Text>
                        </View>
                      ))}
                  </View>
                )}

                {/* Upcoming recurring payments */}
                {walletSummary.upcoming.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('wallet.upcoming')}</Text>
                    {walletSummary.upcoming.map((u, idx) => (
                      <View key={idx} style={styles.upcomingRow}>
                        <Ionicons name="calendar-outline" size={16} color={COLORS.textMuted} />
                        <Text style={styles.upcomingText} numberOfLines={1}>{u.description}</Text>
                        <Text style={styles.upcomingDate}>{u.next_due_date}</Text>
                        <Text style={styles.upcomingAmount}>{u.amount.toFixed(2)} €</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Advice - the "financial advisor" element */}
                {walletSummary.advice.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>{t('wallet.advice')}</Text>
                    {walletSummary.advice.map((line, idx) => (
                      <View key={idx} style={styles.adviceRow}>
                        <Text style={styles.adviceText}>{line}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Settings */}
                {canManageWallet && (
                  <View style={styles.section}>
                    <TouchableOpacity style={styles.settingsToggle} onPress={() => setSettingsExpanded((p) => !p)}>
                      <Text style={styles.sectionTitle}>{t('wallet.settings')}</Text>
                      <Ionicons name={settingsExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                    <Expandable expanded={settingsExpanded}>
                      <View style={{ paddingTop: 8 }}>
                        <Text style={styles.inputLabel}>{t('wallet.alertThreshold')}</Text>
                        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                          <TextInput
                            style={[styles.input, { flex: 1 }]}
                            value={thresholdInput}
                            onChangeText={setThresholdInput}
                            keyboardType="decimal-pad"
                            placeholderTextColor={COLORS.textMuted}
                          />
                          <TouchableOpacity
                            style={[styles.saveButtonSmall, thresholdSaving && { opacity: 0.6 }]}
                            onPress={handleSaveThreshold}
                            disabled={thresholdSaving}
                          >
                            {thresholdSaving ? <ActivityIndicator color="white" size="small" /> : (
                              <Text style={styles.saveButtonSmallText}>{t('wallet.saveThreshold')}</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    </Expandable>
                  </View>
                )}

                {/* Entries list */}
                <View style={styles.section}>
                  {walletGrouped.length === 0 && (
                    <View style={styles.emptyContainer}>
                      <AnimatedEmptyIcon name="wallet-outline" size={64} color={COLORS.border} />
                      <Text style={styles.emptyText}>{t('wallet.noEntries')}</Text>
                      <Text style={styles.emptyHint}>{t('wallet.noEntriesHint')}</Text>
                    </View>
                  )}
                  {walletGrouped.map(([key, monthEntries]) => {
                    const [yearStr, monthStr] = key.split('-');
                    const monthTotal = monthEntries.reduce((sum, e) => sum + e.amount, 0);
                    return (
                      <View key={key} style={styles.monthGroup}>
                        <View style={styles.monthHeader}>
                          <Text style={styles.monthHeaderTitle}>
                            {monthNames[parseInt(monthStr, 10) - 1]} {yearStr}
                          </Text>
                          <Text style={styles.monthHeaderStats}>
                            {monthEntries.length} · {monthTotal.toFixed(2)} €
                          </Text>
                        </View>
                        {monthEntries.map((entry) => (
                          <TouchableOpacity
                            key={entry.id}
                            style={styles.expenseCard}
                            disabled={!canManageWallet}
                            onPress={() => canManageWallet && openEditWalletEntry(entry)}
                          >
                            <View style={styles.expenseRowTop}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 }}>
                                <Ionicons name={WALLET_CATEGORY_ICONS[entry.category]} size={16} color={WALLET_CATEGORY_COLORS[entry.category]} />
                                <Text style={styles.expenseDescription} numberOfLines={1}>{entry.description}</Text>
                              </View>
                              <Text style={[styles.expenseAmount, { color: WALLET_CATEGORY_COLORS[entry.category] }]}>
                                {entry.amount.toFixed(2)} €
                              </Text>
                            </View>
                            <View style={styles.expenseRowBottom}>
                              <View style={styles.badgeRow}>
                                <View style={[styles.badge, { backgroundColor: `${WALLET_CATEGORY_COLORS[entry.category]}20` }]}>
                                  <Text style={[styles.badgeText, { color: WALLET_CATEGORY_COLORS[entry.category] }]}>
                                    {t(WALLET_CATEGORY_KEYS[entry.category])}
                                  </Text>
                                </View>
                                {entry.is_recurring && (
                                  <View style={styles.badge}>
                                    <Text style={styles.badgeTextNeutral}>
                                      ↻ {entry.next_due_date}{entry.recurring_until ? ` → ${entry.recurring_until}` : ''}
                                    </Text>
                                  </View>
                                )}
                              </View>
                              {canManageWallet && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                                  <Ionicons name="create-outline" size={16} color={COLORS.textMuted} />
                                  <TouchableOpacity onPress={() => handleDeleteWalletEntry(entry)} hitSlop={8}>
                                    <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                                  </TouchableOpacity>
                                </View>
                              )}
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    );
                  })}
                </View>
              </>
            ) : null}
          </ScrollView>
          )}

          <BottomSheet visible={modalVisible} onClose={() => setModalVisible(false)}>
              <View style={styles.modalContent}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={styles.modalTitle}>{t('personal.addExpense')}</Text>

                  <Text style={styles.inputLabel}>{t('personal.amount')}</Text>
                  <TextInput
                    style={[styles.input, amountError && styles.inputErrorBorder]}
                    value={amount}
                    onChangeText={(v) => { setAmount(v); setAmountError(false); }}
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <Expandable expanded={amountError}>
                    <Text style={styles.fieldErrorText}>{t('budget.invalidAmount')}</Text>
                  </Expandable>

                  <Text style={styles.inputLabel}>{t('personal.description')}</Text>
                  <TextInput
                    style={[styles.input, descriptionError && styles.inputErrorBorder]}
                    value={description}
                    onChangeText={(v) => { setDescription(v); setDescriptionError(false); }}
                    placeholder={t('personal.descriptionPlaceholder')}
                    placeholderTextColor={COLORS.textMuted}
                  />
                  <Expandable expanded={descriptionError}>
                    <Text style={styles.fieldErrorText}>{t('common.required')}</Text>
                  </Expandable>

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

          <BottomSheet visible={walletModalVisible} onClose={() => setWalletModalVisible(false)}>
              <View style={styles.modalContent}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={styles.modalTitle}>{editingEntryId ? t('wallet.editEntry') : t('wallet.addEntry')}</Text>

                  <Text style={styles.inputLabel}>{t('wallet.category')}</Text>
                  <View style={styles.chipRowWrap}>
                    {(Object.keys(WALLET_CATEGORY_KEYS) as PersonalWalletCategory[]).map((cKey) => (
                      <TouchableOpacity
                        key={cKey}
                        style={[styles.chip, walletCategory === cKey && styles.chipActive]}
                        onPress={() => setWalletCategory(cKey)}
                      >
                        <Text style={[styles.chipText, walletCategory === cKey && styles.chipTextActive]}>{t(WALLET_CATEGORY_KEYS[cKey])}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.inputLabel}>{t('personal.amount')}</Text>
                  <TextInput
                    style={[styles.input, walletAmountError && styles.inputErrorBorder]}
                    value={walletAmount}
                    onChangeText={(v) => { setWalletAmount(v); setWalletAmountError(false); }}
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="decimal-pad"
                  />
                  <Expandable expanded={walletAmountError}>
                    <Text style={styles.fieldErrorText}>{t('budget.invalidAmount')}</Text>
                  </Expandable>

                  <Text style={styles.inputLabel}>{t('personal.description')}</Text>
                  <TextInput
                    style={[styles.input, walletDescriptionError && styles.inputErrorBorder]}
                    value={walletDescription}
                    onChangeText={(v) => { setWalletDescription(v); setWalletDescriptionError(false); }}
                    placeholder={t('personal.descriptionPlaceholder')}
                    placeholderTextColor={COLORS.textMuted}
                  />
                  <Expandable expanded={walletDescriptionError}>
                    <Text style={styles.fieldErrorText}>{t('common.required')}</Text>
                  </Expandable>

                  <Text style={styles.inputLabel}>{t('personal.period')}</Text>
                  <TouchableOpacity style={styles.input} onPress={() => setShowWalletDatePicker(true)}>
                    <Text style={{ color: 'white' }}>{walletDate.toISOString().slice(0, 10)}</Text>
                  </TouchableOpacity>
                  <DateTimePickerModal
                    isVisible={showWalletDatePicker}
                    mode="date"
                    date={walletDate}
                    onConfirm={(d) => { setWalletDate(d); setShowWalletDatePicker(false); }}
                    onCancel={() => setShowWalletDatePicker(false)}
                    confirmTextIOS={t('common.select')}
                    cancelTextIOS={t('common.cancel')}
                    locale={language}
                  />

                  <View style={styles.switchRow}>
                    <Text style={styles.inputLabel}>{t('wallet.isRecurring')}</Text>
                    <Switch
                      value={walletIsRecurring}
                      onValueChange={setWalletIsRecurring}
                      trackColor={{ false: COLORS.border, true: COLORS.primary }}
                      thumbColor="white"
                    />
                  </View>

                  <Expandable expanded={walletIsRecurring}>
                    <View>
                      <Text style={styles.inputLabel}>{t('wallet.nextDueDate')}</Text>
                      <TouchableOpacity style={styles.input} onPress={() => setShowWalletDueDatePicker(true)}>
                        <Text style={{ color: 'white' }}>{walletNextDueDate.toISOString().slice(0, 10)}</Text>
                      </TouchableOpacity>
                      <DateTimePickerModal
                        isVisible={showWalletDueDatePicker}
                        mode="date"
                        date={walletNextDueDate}
                        onConfirm={(d) => { setWalletNextDueDate(d); setShowWalletDueDatePicker(false); }}
                        onCancel={() => setShowWalletDueDatePicker(false)}
                        confirmTextIOS={t('common.select')}
                        cancelTextIOS={t('common.cancel')}
                        locale={language}
                      />

                      <View style={styles.switchRow}>
                        <Text style={styles.inputLabel}>{t('wallet.hasEndDate')}</Text>
                        <Switch
                          value={walletHasRecurringUntil}
                          onValueChange={setWalletHasRecurringUntil}
                          trackColor={{ false: COLORS.border, true: COLORS.primary }}
                          thumbColor="white"
                        />
                      </View>
                      <Text style={styles.fieldHintText}>{t('wallet.hasEndDateHint')}</Text>

                      <Expandable expanded={walletHasRecurringUntil}>
                        <View>
                          <Text style={styles.inputLabel}>{t('wallet.recurringUntil')}</Text>
                          <TouchableOpacity style={styles.input} onPress={() => setShowWalletRecurringUntilPicker(true)}>
                            <Text style={{ color: 'white' }}>{walletRecurringUntil.toISOString().slice(0, 10)}</Text>
                          </TouchableOpacity>
                          <DateTimePickerModal
                            isVisible={showWalletRecurringUntilPicker}
                            mode="date"
                            date={walletRecurringUntil}
                            onConfirm={(d) => { setWalletRecurringUntil(d); setShowWalletRecurringUntilPicker(false); }}
                            onCancel={() => setShowWalletRecurringUntilPicker(false)}
                            confirmTextIOS={t('common.select')}
                            cancelTextIOS={t('common.cancel')}
                            locale={language}
                          />
                        </View>
                      </Expandable>
                    </View>
                  </Expandable>

                  <Text style={styles.inputLabel}>{t('personal.notes')}</Text>
                  <TextInput
                    style={styles.input}
                    value={walletNotes}
                    onChangeText={setWalletNotes}
                    placeholderTextColor={COLORS.textMuted}
                  />

                  <TouchableOpacity style={[styles.saveButton, walletSaving && { opacity: 0.6 }]} onPress={handleSaveWalletEntry} disabled={walletSaving}>
                    {walletSaving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelButton} onPress={() => setWalletModalVisible(false)}>
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
  emptyHint: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
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
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
  },
  inputErrorBorder: {
    borderColor: COLORS.danger,
  },
  fieldErrorText: {
    color: COLORS.danger,
    fontSize: 12,
    marginTop: 4,
  },
  fieldHintText: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: -4,
    marginBottom: 8,
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
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  saveButtonSmall: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  saveButtonSmallText: { color: 'white', fontWeight: '600', fontSize: 14 },
  safeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 18,
    marginBottom: 16,
  },
  safeCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  safeCardLabel: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '600' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  safeCardValue: { fontSize: 34, fontWeight: 'bold', marginTop: 6 },
  safeCardHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 4 },
  progressTrack: { height: 6, backgroundColor: COLORS.background, borderRadius: 3, marginTop: 14, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  safeCardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  safeCardFooterText: { fontSize: 12, color: COLORS.textSecondary },
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: 'white', marginBottom: 10 },
  needsWantsRow: { flexDirection: 'row', gap: 12 },
  needsWantsItem: { flex: 1, backgroundColor: COLORS.background, borderRadius: 10, padding: 12, alignItems: 'center' },
  needsWantsLabel: { fontSize: 11, color: COLORS.textMuted, textAlign: 'center' },
  needsWantsValue: { fontSize: 16, fontWeight: 'bold', marginTop: 4 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  categoryIconWrap: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  categoryRowLabel: { flex: 1, fontSize: 14, color: COLORS.textLight },
  categoryRowValue: { fontSize: 14, fontWeight: '700', color: 'white' },
  upcomingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  upcomingText: { flex: 1, fontSize: 13, color: COLORS.textLight },
  upcomingDate: { fontSize: 12, color: COLORS.textMuted },
  upcomingAmount: { fontSize: 13, fontWeight: '700', color: 'white' },
  adviceRow: { paddingVertical: 6 },
  adviceText: { fontSize: 13, color: COLORS.textLight, lineHeight: 19 },
  settingsToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});

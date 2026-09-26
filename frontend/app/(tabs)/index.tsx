import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ImageBackground,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { Alert } from '../../src/utils/alert';
import { api } from '../../src/services/api';
import { Summary, DailyRevenue, NonInvoiceExpense } from '../../src/types';
import { format, addDays, subDays } from 'date-fns';
import { bg } from 'date-fns/locale';
import { useTranslation, useLanguageStore } from '../../src/i18n';
import { useAuth } from '../../src/contexts/AuthContext';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function HomeScreen() {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { isOwner, hasPermission } = useAuth();
  const router = useRouter();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [revenueModalVisible, setRevenueModalVisible] = useState(false);
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  const [personalExpenseModalVisible, setPersonalExpenseModalVisible] = useState(false);
  
  // ROI state (owner only)
  const [roiData, setRoiData] = useState<any>(null);
  const [loadingRoi, setLoadingRoi] = useState(false);
  
  // Personal expense form
  const [personalAmount, setPersonalAmount] = useState('');
  const [personalDescription, setPersonalDescription] = useState('');
  const [personalType, setPersonalType] = useState('recurring');
  const [personalCategory, setPersonalCategory] = useState('other');
  
  // Revenue form
  const [fiscalRevenue, setFiscalRevenue] = useState('');
  const [pocketMoney, setPocketMoney] = useState('');
  const [cardRevenue, setCardRevenue] = useState('');
  const [revenueVatRate, setRevenueVatRate] = useState(20);
  const [revenueDate, setRevenueDate] = useState(new Date());
  // Shared across the revenue/expense/personal-expense modals below - only
  // one is ever open at a time, and this guards against a rapid double-tap
  // on Save creating a duplicate record.
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);

  // Expense form
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date());
  const [dayExpenses, setDayExpenses] = useState<Array<{id: string; description: string; amount: number; date: string}>>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(false);
  
  // Date picker states
  const [isRevenueDatePickerVisible, setRevenueDatePickerVisible] = useState(false);
  const [isExpenseDatePickerVisible, setExpenseDatePickerVisible] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const summaryData = await api.getSummary();
      setSummary(summaryData);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }, []);

  // Pre-fills the form with whatever is already logged for this date, so
  // saving corrects that value directly instead of adding a delta to it -
  // opening the form for a date with nothing logged yet leaves it at 0.
  const loadCurrentDayRevenue = useCallback(async (date: Date) => {
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const data = await api.getRevenueByDate(dateStr);
      setFiscalRevenue(data.fiscal_revenue > 0 ? data.fiscal_revenue.toString() : '');
      setPocketMoney(data.pocket_money > 0 ? data.pocket_money.toString() : '');
      setCardRevenue(data.card_revenue > 0 ? data.card_revenue.toString() : '');
      setRevenueVatRate(data.vat_rate_percent || 20);
    } catch (error) {
      setFiscalRevenue('');
      setPocketMoney('');
      setCardRevenue('');
      setRevenueVatRate(20);
    }
  }, []);

  // Tab screens stay mounted, so returning here (e.g. after scanning and
  // saving a new invoice) doesn't remount the screen - only re-fetching on
  // focus picks up the change without needing a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Load current day revenue when revenue modal opens or date changes
  useEffect(() => {
    if (revenueModalVisible) {
      loadCurrentDayRevenue(revenueDate);
    }
  }, [revenueModalVisible, revenueDate, loadCurrentDayRevenue]);

  // Load expenses for selected date when expense modal opens or date changes
  const loadDayExpenses = useCallback(async (date: Date) => {
    setLoadingExpenses(true);
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const expenses = await api.getExpenses({
        start_date: dateStr,
        end_date: dateStr
      });
      setDayExpenses(expenses);
    } catch (error) {
      setDayExpenses([]);
    } finally {
      setLoadingExpenses(false);
    }
  }, []);

  useEffect(() => {
    if (expenseModalVisible) {
      loadDayExpenses(expenseDate);
    }
  }, [expenseModalVisible, expenseDate, loadDayExpenses]);

  // Load ROI data for owner
  const loadRoiData = useCallback(async () => {
    if (!isOwner) return;
    
    setLoadingRoi(true);
    try {
      const data = await api.getROIAnalysis();
      setRoiData(data);
    } catch (error) {
      console.error('Error loading ROI:', error);
      setRoiData(null);
    } finally {
      setLoadingRoi(false);
    }
  }, [isOwner]);

  useFocusEffect(
    useCallback(() => {
      if (isOwner) {
        loadRoiData();
      }
    }, [isOwner, loadRoiData])
  );

  // Create personal expense
  const handleCreatePersonalExpense = async () => {
    const amount = parseFloat(personalAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert(t('common.error'), t('budget.invalidAmount'));
      return;
    }
    if (!personalDescription.trim()) {
      Alert.alert(t('common.error'), t('common.fillAllFields'));
      return;
    }
    if (isSubmittingForm) return;

    const now = new Date();
    setIsSubmittingForm(true);
    try {
      await api.createPersonalExpense({
        amount,
        description: personalDescription.trim(),
        expense_type: personalType,
        category: personalCategory,
        period_month: now.getMonth() + 1,
        period_year: now.getFullYear(),
      });

      Alert.alert(t('common.success'), t('personal.created'));
      setPersonalAmount('');
      setPersonalDescription('');
      setPersonalType('recurring');
      setPersonalCategory('other');
      setPersonalExpenseModalVisible(false);
      loadRoiData();
    } catch (error) {
      Alert.alert(t('common.error'), t('common.operationFailed'));
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleDeleteExpense = async (expenseId: string) => {
    Alert.alert(
      t('common.delete'),
      t('msg.deleteConfirmExpense'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteExpense(expenseId);
              loadDayExpenses(expenseDate);
              loadData();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            }
          }
        }
      ]
    );
  };

  const handleAddRevenue = async () => {
    if (!fiscalRevenue && !pocketMoney) {
      Alert.alert(t('common.error'), t('msg.enterAtLeastOne'));
      return;
    }
    if (isSubmittingForm) return;

    setIsSubmittingForm(true);
    try {
      await api.createDailyRevenue({
        date: format(revenueDate, 'yyyy-MM-dd'),
        fiscal_revenue: parseFloat(fiscalRevenue) || 0,
        pocket_money: parseFloat(pocketMoney) || 0,
        card_revenue: parseFloat(cardRevenue) || 0,
        vat_rate_percent: revenueVatRate,
      });
      setRevenueModalVisible(false);
      setFiscalRevenue('');
      setPocketMoney('');
      setCardRevenue('');
      setRevenueVatRate(20);
      setRevenueDate(new Date());
      loadData();
      Alert.alert(t('common.success'), t('msg.revenueSaved'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const handleAddExpense = async () => {
    if (!expenseDescription || !expenseAmount) {
      Alert.alert(t('common.error'), t('msg.fillAllFields'));
      return;
    }
    if (isSubmittingForm) return;

    setIsSubmittingForm(true);
    try {
      await api.createExpense({
        description: expenseDescription,
        amount: parseFloat(expenseAmount),
        date: format(expenseDate, 'yyyy-MM-dd'),
      });
      // Don't close modal, just clear fields and refresh list
      setExpenseDescription('');
      setExpenseAmount('');
      loadDayExpenses(expenseDate);
      loadData();
      Alert.alert(t('common.success'), t('msg.expenseSaved'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const today = format(new Date(), "d MMMM yyyy 'г.'" , { locale: bg });

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <ScrollView
            style={styles.scrollView}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
          >
            {/* Header */}
            <View style={styles.header}>
              <View>
                <Text style={styles.greeting}>{t('home.welcome')}</Text>
                <Text style={styles.date}>{today}</Text>
              </View>
              <View style={styles.headerIcon}>
                <Ionicons name="receipt" size={28} color="#8B5CF6" />
              </View>
            </View>

            {/* Summary Cards */}
            <View style={styles.summaryContainer}>
              <View style={[styles.summaryCard, styles.incomeCard]}>
                <View style={styles.cardIcon}>
                  <Ionicons name="trending-up" size={24} color="#10B981" />
                </View>
                <Text style={styles.cardLabel}>{t('home.totalIncome')}</Text>
                <Text style={[styles.cardValue, { color: '#10B981' }]}>
                  {summary?.total_income.toFixed(2) || '0.00'} €
                </Text>
              </View>

              <View style={[styles.summaryCard, styles.expenseCard]}>
                <View style={styles.cardIcon}>
                  <Ionicons name="trending-down" size={24} color="#EF4444" />
            </View>
            <Text style={styles.cardLabel}>{t('home.totalExpenses')}</Text>
            <Text style={[styles.cardValue, { color: '#EF4444' }]}>
              {summary?.total_expense.toFixed(2) || '0.00'} €
            </Text>
          </View>
        </View>

        {/* Cash vs Card breakdown of the fiscalized revenue */}
        <View style={styles.summaryContainer}>
          <View style={[styles.summaryCard, styles.cashCard]}>
            <View style={styles.cardIcon}>
              <Ionicons name="cash-outline" size={24} color="#10B981" />
            </View>
            <Text style={styles.cardLabel}>{t('home.cashRevenue')}</Text>
            <Text style={[styles.cardValue, { color: '#10B981' }]}>
              {(summary?.total_cash_revenue || 0).toFixed(2)} €
            </Text>
          </View>

          <View style={[styles.summaryCard, styles.cardCard]}>
            <View style={styles.cardIcon}>
              <Ionicons name="card-outline" size={24} color="#3B82F6" />
            </View>
            <Text style={styles.cardLabel}>{t('home.cardRevenue')}</Text>
            <Text style={[styles.cardValue, { color: '#3B82F6' }]}>
              {(summary?.total_card_revenue || 0).toFixed(2)} €
            </Text>
          </View>
        </View>

        {/* VAT Card */}
        <View style={styles.vatCard}>
          <View style={styles.vatHeader}>
            <Ionicons name="calculator" size={24} color="#8B5CF6" />
            <Text style={styles.vatTitle}>{t('home.vatToPay')}</Text>
          </View>
          <Text style={[styles.vatValue, { color: (summary?.vat_to_pay || 0) >= 0 ? '#EF4444' : '#10B981' }]}>
            {(summary?.vat_to_pay || 0).toFixed(2)} €
          </Text>
          <View style={styles.vatDetails}>
            <View style={styles.vatDetailRow}>
              <Text style={styles.vatDetailLabel}>{t('stats.vatFromSales')}:</Text>
              <Text style={styles.vatDetailValue}>{summary?.fiscal_vat.toFixed(2) || '0.00'} €</Text>
            </View>
            <View style={styles.vatDetailRow}>
              <Text style={styles.vatDetailLabel}>{t('stats.vatCredit')}:</Text>
              <Text style={styles.vatDetailValue}>-{summary?.total_invoice_vat.toFixed(2) || '0.00'} €</Text>
            </View>
          </View>
        </View>

        {/* Unpaid supplier invoices reminder - company-wide, not scoped to
            this month, since money owed from any past period is still owed */}
        {(summary?.unpaid_invoice_count || 0) > 0 && (
          <TouchableOpacity
            style={[styles.unpaidCard, (summary?.overdue_invoice_count || 0) > 0 && styles.unpaidCardOverdue]}
            onPress={() => router.push({ pathname: '/(tabs)/invoices', params: { paymentFilter: 'unpaid' } })}
            activeOpacity={0.8}
          >
            <View style={styles.unpaidHeader}>
              <Ionicons
                name={(summary?.overdue_invoice_count || 0) > 0 ? 'alert-circle' : 'time-outline'}
                size={24}
                color={(summary?.overdue_invoice_count || 0) > 0 ? '#EF4444' : '#F59E0B'}
              />
              <Text style={styles.unpaidTitle}>{t('home.unpaidInvoices')}</Text>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </View>
            <Text style={[styles.unpaidValue, { color: (summary?.overdue_invoice_count || 0) > 0 ? '#EF4444' : '#F59E0B' }]}>
              {(summary?.total_unpaid_amount || 0).toFixed(2)} €
            </Text>
            <Text style={styles.unpaidSubtitle}>
              {summary?.unpaid_invoice_count} {t('home.unpaidInvoicesCount')}
              {(summary?.overdue_invoice_count || 0) > 0
                ? ` · ${summary?.overdue_invoice_count} ${t('home.overdueInvoicesCount')}`
                : ''}
            </Text>
          </TouchableOpacity>
        )}

        {/* Average Daily Turnover - taps through to the same stat in Statistics,
            broken down by period, for deeper business analysis */}
        <TouchableOpacity
          style={styles.avgTurnoverCard}
          onPress={() => router.push({ pathname: '/(tabs)/stats', params: { period: 'month' } })}
          activeOpacity={0.8}
        >
          <View style={styles.avgTurnoverHeader}>
            <Ionicons name="speedometer" size={24} color="#3B82F6" />
            <Text style={styles.avgTurnoverTitle}>{t('home.avgDailyTurnover')}</Text>
            <Ionicons name="chevron-forward" size={20} color="#64748B" />
          </View>
          <Text style={styles.avgTurnoverValue}>
            {(((summary?.total_income || 0)) / new Date().getDate()).toFixed(2)} €
          </Text>
          <Text style={styles.avgTurnoverSubtitle}>
            {t('home.avgDailyTurnoverSubtitle').replace('{days}', String(new Date().getDate()))}
          </Text>
        </TouchableOpacity>

        {/* Stats Overview */}
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{summary?.invoice_count || 0}</Text>
            <Text style={styles.statLabel}>{t('home.invoices')}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{summary?.total_fiscal_revenue.toFixed(0) || 0}</Text>
            <Text style={styles.statLabel}>{t('home.fiscalRevenue')}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{summary?.total_pocket_money.toFixed(0) || 0}</Text>
            <Text style={styles.statLabel}>{t('home.pocket')}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: (summary?.profit || 0) >= 0 ? '#10B981' : '#EF4444' }]}>
              {summary?.profit.toFixed(0) || 0}
            </Text>
            <Text style={styles.statLabel}>{t('home.profit')}</Text>
          </View>
        </View>

        {/* Action Buttons - each gated on its own permission (an owner can
            fine-tune these independently per member via the permissions
            checklist), rather than showing a button whose only possible
            outcome is a permission-denied error from the backend. */}
        {(hasPermission('add_revenue') || hasPermission('add_expenses')) && (
          <View style={styles.actionsContainer}>
            {hasPermission('add_revenue') && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#10B981' }]}
                onPress={() => setRevenueModalVisible(true)}
              >
                <Ionicons name="cash" size={24} color="white" />
                <Text style={styles.actionButtonText}>{t('home.dailyRevenue')}</Text>
              </TouchableOpacity>
            )}

            {hasPermission('add_expenses') && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#F59E0B' }]}
                onPress={() => setExpenseModalVisible(true)}
              >
                <Ionicons name="remove-circle" size={24} color="white" />
                <Text style={styles.actionButtonText}>{t('home.expenses')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Personal Expenses & ROI Section (Owner Only) */}
        {isOwner && (
          <View style={styles.roiSection}>
            <View style={styles.roiHeader}>
              <View style={styles.roiTitleRow}>
                <Ionicons name="person-circle" size={24} color="#8B5CF6" />
                <Text style={styles.roiTitle}>{t('personal.title')}</Text>
              </View>
              <TouchableOpacity
                style={styles.addPersonalButton}
                onPress={() => setPersonalExpenseModalVisible(true)}
              >
                <Ionicons name="add-circle" size={20} color="#8B5CF6" />
                <Text style={styles.addPersonalText}>{t('personal.addExpense')}</Text>
              </TouchableOpacity>
            </View>

            {loadingRoi ? (
              <ActivityIndicator size="small" color="#8B5CF6" style={{ marginVertical: 20 }} />
            ) : roiData ? (
              <>
                {/* ROI Stats */}
                <View style={styles.roiStats}>
                  <View style={styles.roiStatItem}>
                    <Text style={styles.roiStatLabel}>{t('roi.totalInvestment')}</Text>
                    <Text style={[styles.roiStatValue, { color: '#EF4444' }]}>
                      {roiData.total_personal_investment.toFixed(2)} €
                    </Text>
                  </View>
                  <View style={styles.roiStatItem}>
                    <Text style={styles.roiStatLabel}>{t('roi.totalProfit')}</Text>
                    <Text style={[styles.roiStatValue, { color: roiData.total_profit >= 0 ? '#10B981' : '#EF4444' }]}>
                      {roiData.total_profit.toFixed(2)} €
                    </Text>
                  </View>
                  <View style={styles.roiStatItem}>
                    <Text style={styles.roiStatLabel}>{t('roi.roiPercent')}</Text>
                    <Text style={[styles.roiStatValue, { color: roiData.roi_percent >= 0 ? '#10B981' : '#EF4444' }]}>
                      {roiData.roi_percent.toFixed(1)}%
                    </Text>
                  </View>
                </View>

                {/* ROI Status Indicator */}
                <View style={[
                  styles.roiStatus,
                  { backgroundColor: roiData.investment_covered ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)' }
                ]}>
                  <Ionicons 
                    name={roiData.investment_covered ? "checkmark-circle" : "alert-circle"} 
                    size={20} 
                    color={roiData.investment_covered ? '#10B981' : '#EF4444'} 
                  />
                  <Text style={[
                    styles.roiStatusText,
                    { color: roiData.investment_covered ? '#10B981' : '#EF4444' }
                  ]}>
                    {roiData.investment_covered ? t('roi.investmentCovered') : t('roi.investmentNotCovered')}
                  </Text>
                </View>

                {/* AI Insights */}
                {roiData.ai_insights && roiData.ai_insights.length > 0 && (
                  <View style={styles.aiInsights}>
                    <Text style={styles.aiInsightsTitle}>{t('roi.aiInsights')}</Text>
                    {roiData.ai_insights.map((insight: string, index: number) => (
                      <Text key={index} style={styles.aiInsightText}>{insight}</Text>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={styles.noRoiData}>
                <Text style={styles.noRoiDataText}>{t('roi.noData')}</Text>
                <Text style={styles.noRoiDataSubtext}>{t('personal.subtitle')}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Personal Expense Modal (Owner Only) */}
      {isOwner && (
        <Modal visible={personalExpenseModalVisible} animationType="slide" transparent>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('personal.addExpense')}</Text>
                <TouchableOpacity onPress={() => setPersonalExpenseModalVisible(false)}>
                  <Ionicons name="close" size={28} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('personal.amount')}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="0.00"
                  placeholderTextColor="#64748B"
                  keyboardType="decimal-pad"
                  value={personalAmount}
                  onChangeText={setPersonalAmount}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('personal.description')}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={language === 'bg' ? 'напр. Наем, Заплати...' : 'e.g. Rent, Salaries...'}
                  placeholderTextColor="#64748B"
                  value={personalDescription}
                  onChangeText={setPersonalDescription}
                />
              </View>

              {/* Expense Type Selector */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{language === 'bg' ? 'Тип' : 'Type'}</Text>
                <View style={styles.typeSelector}>
                  <TouchableOpacity
                    style={[styles.typeButton, personalType === 'investment' && styles.typeButtonActive]}
                    onPress={() => setPersonalType('investment')}
                  >
                    <Text style={[styles.typeButtonText, personalType === 'investment' && styles.typeButtonTextActive]}>
                      {t('personal.typeInvestment')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.typeButton, personalType === 'recurring' && styles.typeButtonActive]}
                    onPress={() => setPersonalType('recurring')}
                  >
                    <Text style={[styles.typeButtonText, personalType === 'recurring' && styles.typeButtonTextActive]}>
                      {t('personal.typeRecurring')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.typeButton, personalType === 'one_time' && styles.typeButtonActive]}
                    onPress={() => setPersonalType('one_time')}
                  >
                    <Text style={[styles.typeButtonText, personalType === 'one_time' && styles.typeButtonTextActive]}>
                      {t('personal.typeOneTime')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Category Selector */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{language === 'bg' ? 'Категория' : 'Category'}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
                  {[
                    { key: 'goods', label: t('personal.categoryGoods') },
                    { key: 'service', label: t('personal.categoryService') },
                    { key: 'personnel', label: t('personal.categoryPersonnel') },
                    { key: 'rent', label: t('personal.categoryRent') },
                    { key: 'extraordinary', label: t('personal.categoryExtraordinary') },
                    { key: 'other', label: t('personal.categoryOther') },
                  ].map((cat) => (
                    <TouchableOpacity
                      key={cat.key}
                      style={[styles.categoryChip, personalCategory === cat.key && styles.categoryChipActive]}
                      onPress={() => setPersonalCategory(cat.key)}
                    >
                      <Text style={[styles.categoryChipText, personalCategory === cat.key && styles.categoryChipTextActive]}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <TouchableOpacity style={styles.submitButton} onPress={handleCreatePersonalExpense} disabled={isSubmittingForm}>
                {isSubmittingForm ? <ActivityIndicator color="white" /> : <Text style={styles.submitButtonText}>{t('common.save')}</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}

      {/* Revenue Modal */}
      <Modal visible={revenueModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('home.dailyRevenue')}</Text>
              <TouchableOpacity onPress={() => setRevenueModalVisible(false)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Date Picker */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('home.date')}</Text>
              <View style={styles.datePickerContainer}>
                <TouchableOpacity 
                  style={styles.dateButton} 
                  onPress={() => setRevenueDate(subDays(revenueDate, 1))}
                >
                  <Ionicons name="chevron-back" size={24} color="#8B5CF6" />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.dateDisplay}
                  onPress={() => setRevenueDatePickerVisible(true)}
                >
                  <Ionicons name="calendar" size={20} color="#8B5CF6" />
                  <Text style={styles.dateText}>
                    {format(revenueDate, 'd MMMM yyyy', { locale: dateLocale })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.dateButton} 
                  onPress={() => setRevenueDate(addDays(revenueDate, 1))}
                >
                  <Ionicons name="chevron-forward" size={24} color="#8B5CF6" />
                </TouchableOpacity>
              </View>
            </View>
            
            {/* Calendar Date Picker Modal */}
            <DateTimePickerModal
              isVisible={isRevenueDatePickerVisible}
              mode="date"
              date={revenueDate}
              onConfirm={(date) => {
                setRevenueDate(date);
                setRevenueDatePickerVisible(false);
              }}
              onCancel={() => setRevenueDatePickerVisible(false)}
              confirmTextIOS={t('common.select')}
              cancelTextIOS={t('common.cancel')}
              locale={language}
            />

            {/* Explains the edit-in-place semantics up front, since it's not
                the obvious default for a "add revenue" form. */}
            <View style={styles.editNoticeBanner}>
              <Ionicons name="information-circle" size={18} color="#8B5CF6" />
              <Text style={styles.editNoticeText}>{t('home.editInPlaceNotice')}</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('home.fiscalRevenueLabel')} (€)</Text>
              <TextInput
                style={styles.input}
                value={fiscalRevenue}
                onChangeText={setFiscalRevenue}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />
              <Text style={styles.inputHint}>{t('home.includesVAT')}</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('home.cardRevenueLabel')} (€)</Text>
              <TextInput
                style={styles.input}
                value={cardRevenue}
                onChangeText={setCardRevenue}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />
              <Text style={styles.inputHint}>{t('home.cardRevenueHint')}</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('home.vatRate')}</Text>
              <View style={styles.vatRateRow}>
                {[20, 9, 0].map((rate) => (
                  <TouchableOpacity
                    key={rate}
                    style={[styles.vatRateChip, revenueVatRate === rate && styles.vatRateChipActive]}
                    onPress={() => setRevenueVatRate(rate)}
                  >
                    <Text style={[styles.vatRateChipText, revenueVatRate === rate && styles.vatRateChipTextActive]}>
                      {rate}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.inputHint}>{t('home.vatRateHint')}</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('home.pocketLabel')} (€)</Text>
              <TextInput
                style={styles.input}
                value={pocketMoney}
                onChangeText={setPocketMoney}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />
              <Text style={styles.inputHint}>{t('home.excludesVAT')}</Text>
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={handleAddRevenue} disabled={isSubmittingForm}>
              {isSubmittingForm ? <ActivityIndicator color="white" /> : <Text style={styles.submitButtonText}>{t('home.save')}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Expense Modal */}
      <Modal visible={expenseModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('expenses.title')}</Text>
              <TouchableOpacity onPress={() => {
                setExpenseModalVisible(false);
                setExpenseDate(new Date());
              }}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Date Picker */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('home.date')}</Text>
                <View style={styles.datePickerContainer}>
                  <TouchableOpacity 
                    style={styles.dateButton} 
                    onPress={() => setExpenseDate(subDays(expenseDate, 1))}
                  >
                    <Ionicons name="chevron-back" size={24} color="#8B5CF6" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.dateDisplay}
                    onPress={() => setExpenseDatePickerVisible(true)}
                  >
                    <Ionicons name="calendar" size={20} color="#8B5CF6" />
                    <Text style={styles.dateText}>
                      {format(expenseDate, 'd MMMM yyyy', { locale: dateLocale })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.dateButton} 
                    onPress={() => setExpenseDate(addDays(expenseDate, 1))}
                  >
                    <Ionicons name="chevron-forward" size={24} color="#8B5CF6" />
                  </TouchableOpacity>
                </View>
              </View>
              
              {/* Calendar Date Picker Modal */}
              <DateTimePickerModal
                isVisible={isExpenseDatePickerVisible}
                mode="date"
                date={expenseDate}
                onConfirm={(date) => {
                  setExpenseDate(date);
                  setExpenseDatePickerVisible(false);
                }}
                onCancel={() => setExpenseDatePickerVisible(false)}
                confirmTextIOS={t('common.select')}
                cancelTextIOS={t('common.cancel')}
                locale={language}
              />

              {/* Daily Expenses List */}
              <View style={styles.dayExpensesSection}>
                <Text style={styles.dayExpensesTitle}>
                  {t('expenses.forDate')} {format(expenseDate, 'd MMM', { locale: dateLocale })}:
                </Text>
                
                {loadingExpenses ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator color="#F59E0B" />
                  </View>
                ) : dayExpenses.length > 0 ? (
                  <>
                    {dayExpenses.map((expense, index) => (
                      <View key={expense.id} style={styles.expenseItem}>
                        <View style={styles.expenseItemLeft}>
                          <Text style={styles.expenseItemIndex}>{index + 1}.</Text>
                          <Text style={styles.expenseItemDescription}>{expense.description}</Text>
                        </View>
                        <View style={styles.expenseItemRight}>
                          <Text style={styles.expenseItemAmount}>{expense.amount.toFixed(2)} €</Text>
                          <TouchableOpacity 
                            style={styles.expenseDeleteButton}
                            onPress={() => handleDeleteExpense(expense.id)}
                          >
                            <Ionicons name="trash-outline" size={18} color="#EF4444" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                    <View style={styles.expensesTotalRow}>
                      <Text style={styles.expensesTotalLabel}>{t('expenses.totalForDay')}:</Text>
                      <Text style={styles.expensesTotalValue}>
                        {dayExpenses.reduce((sum, e) => sum + e.amount, 0).toFixed(2)} €
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text style={styles.noExpensesText}>{t('expenses.noExpenses')}</Text>
                )}
              </View>

              {/* Add New Expense Form */}
              <View style={styles.addExpenseSection}>
                <Text style={styles.addExpenseTitle}>{t('expenses.addNew')}:</Text>
                
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('expenses.description')}</Text>
                  <TextInput
                    style={styles.input}
                    value={expenseDescription}
                    onChangeText={setExpenseDescription}
                    placeholder={t('expenses.placeholder')}
                    placeholderTextColor="#64748B"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('expenses.amount')} (€)</Text>
                  <TextInput
                    style={styles.input}
                    value={expenseAmount}
                    onChangeText={setExpenseAmount}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#64748B"
                  />
                </View>

                <TouchableOpacity style={[styles.submitButton, { backgroundColor: '#F59E0B' }]} onPress={handleAddExpense} disabled={isSubmittingForm}>
                  {isSubmittingForm ? <ActivityIndicator color="white" /> : (
                    <>
                      <Ionicons name="add-circle" size={20} color="white" />
                      <Text style={styles.submitButtonText}>{t('expenses.add')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
        </SafeAreaView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  date: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 4,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
  },
  incomeCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  expenseCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
  },
  cashCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
  },
  cardCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#3B82F6',
  },
  unpaidCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  unpaidCardOverdue: {
    borderColor: '#EF4444',
  },
  unpaidHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  unpaidTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginLeft: 12,
    flex: 1,
  },
  unpaidValue: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  unpaidSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  vatCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#8B5CF6',
  },
  vatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  vatTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginLeft: 12,
  },
  vatValue: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  vatDetails: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 12,
  },
  vatDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  vatDetailLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  vatDetailValue: {
    fontSize: 13,
    color: '#E2E8F0',
    fontWeight: '500',
  },
  avgTurnoverCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  avgTurnoverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avgTurnoverTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginLeft: 12,
    flex: 1,
  },
  avgTurnoverValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#3B82F6',
    marginBottom: 4,
  },
  avgTurnoverSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statItem: {
    width: '47%',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  statLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputHint: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 6,
  },
  vatRateRow: {
    flexDirection: 'row',
    gap: 10,
  },
  vatRateChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  vatRateChipActive: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  vatRateChipText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  vatRateChipTextActive: {
    color: 'white',
  },
  editNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  editNoticeText: {
    flex: 1,
    fontSize: 12,
    color: '#C4B5FD',
    lineHeight: 17,
  },
  submitButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  datePickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  dateButton: {
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateDisplay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 8,
  },
  dateText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  dayExpensesSection: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  dayExpensesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F59E0B',
    marginBottom: 12,
  },
  expenseItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  expenseItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  expenseItemIndex: {
    fontSize: 12,
    color: '#64748B',
    width: 20,
  },
  expenseItemDescription: {
    fontSize: 14,
    color: 'white',
    flex: 1,
  },
  expenseItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  expenseItemAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F59E0B',
  },
  expenseDeleteButton: {
    padding: 4,
  },
  expensesTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(245, 158, 11, 0.3)',
  },
  expensesTotalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  expensesTotalValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F59E0B',
  },
  noExpensesText: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    paddingVertical: 8,
  },
  addExpenseSection: {
    marginTop: 8,
  },
  addExpenseTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
  },
  // Personal Expenses & ROI Styles
  roiSection: {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  roiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  roiTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roiTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  addPersonalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 8,
  },
  addPersonalText: {
    fontSize: 12,
    color: '#8B5CF6',
    fontWeight: '600',
  },
  roiStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  roiStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  roiStatLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 4,
  },
  roiStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  roiStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  roiStatusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  aiInsights: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 10,
    padding: 14,
  },
  aiInsightsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8B5CF6',
    marginBottom: 10,
  },
  aiInsightText: {
    fontSize: 13,
    color: '#CBD5E1',
    lineHeight: 20,
    marginBottom: 6,
  },
  noRoiData: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noRoiDataText: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 4,
  },
  noRoiDataSubtext: {
    fontSize: 12,
    color: '#64748B',
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  typeButtonText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  typeButtonTextActive: {
    color: 'white',
  },
  categoryScroll: {
    flexGrow: 0,
  },
  categoryChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#0F172A',
    marginRight: 8,
  },
  categoryChipActive: {
    backgroundColor: '#8B5CF6',
  },
  categoryChipText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  categoryChipTextActive: {
    color: 'white',
  },
});

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
  Alert,
  KeyboardAvoidingView,
  Platform,
  ImageBackground,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { api } from '../../src/services/api';
import { Summary, DailyRevenue, NonInvoiceExpense } from '../../src/types';
import { format, addDays, subDays } from 'date-fns';
import { bg, enUS } from 'date-fns/locale';
import { useTranslation, useLanguageStore } from '../../src/i18n';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function HomeScreen() {
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  const dateLocale = language === 'bg' ? bg : enUS;
  
  const [summary, setSummary] = useState<Summary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [revenueModalVisible, setRevenueModalVisible] = useState(false);
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  
  // Revenue form
  const [fiscalRevenue, setFiscalRevenue] = useState('');
  const [pocketMoney, setPocketMoney] = useState('');
  const [revenueDate, setRevenueDate] = useState(new Date());
  const [currentDayRevenue, setCurrentDayRevenue] = useState({ fiscal_revenue: 0, pocket_money: 0 });
  
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

  const loadCurrentDayRevenue = useCallback(async (date: Date) => {
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const data = await api.getRevenueByDate(dateStr);
      setCurrentDayRevenue(data);
    } catch (error) {
      setCurrentDayRevenue({ fiscal_revenue: 0, pocket_money: 0 });
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleDeleteExpense = async (expenseId: string) => {
    Alert.alert(
      'Изтриване',
      'Сигурни ли сте, че искате да изтриете този разход?',
      [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Изтрий',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteExpense(expenseId);
              loadDayExpenses(expenseDate);
              loadData();
            } catch (error: any) {
              Alert.alert('Грешка', error.message);
            }
          }
        }
      ]
    );
  };

  const handleAddRevenue = async () => {
    if (!fiscalRevenue && !pocketMoney) {
      Alert.alert('Грешка', 'Въведете поне една стойност');
      return;
    }

    try {
      await api.createDailyRevenue({
        date: format(revenueDate, 'yyyy-MM-dd'),
        fiscal_revenue: parseFloat(fiscalRevenue) || 0,
        pocket_money: parseFloat(pocketMoney) || 0,
      });
      setRevenueModalVisible(false);
      setFiscalRevenue('');
      setPocketMoney('');
      setRevenueDate(new Date());
      loadData();
      Alert.alert('Успех', 'Дневният оборот е записан');
    } catch (error: any) {
      Alert.alert('Грешка', error.message);
    }
  };

  const handleAddExpense = async () => {
    if (!expenseDescription || !expenseAmount) {
      Alert.alert('Грешка', 'Попълнете всички полета');
      return;
    }

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
      Alert.alert('Успех', 'Разходът е записан');
    } catch (error: any) {
      Alert.alert('Грешка', error.message);
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

        {/* Stats Overview */}
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{summary?.invoice_count || 0}</Text>
            <Text style={styles.statLabel}>Фактури</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{summary?.total_fiscal_revenue.toFixed(0) || 0}</Text>
            <Text style={styles.statLabel}>Фискален оборот</Text>
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

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#10B981' }]}
            onPress={() => setRevenueModalVisible(true)}
          >
            <Ionicons name="cash" size={24} color="white" />
            <Text style={styles.actionButtonText}>{t('home.dailyRevenue')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#F59E0B' }]}
            onPress={() => setExpenseModalVisible(true)}
          >
            <Ionicons name="remove-circle" size={24} color="white" />
            <Text style={styles.actionButtonText}>{t('home.expenses')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

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

            {/* Current totals display */}
            {(currentDayRevenue.fiscal_revenue > 0 || currentDayRevenue.pocket_money > 0) && (
              <View style={styles.currentTotalsCard}>
                <Text style={styles.currentTotalsTitle}>{t('home.accumulatedFor')} {format(revenueDate, 'd MMM', { locale: dateLocale })}:</Text>
                <View style={styles.currentTotalsRow}>
                  <View style={styles.currentTotalItem}>
                    <Text style={styles.currentTotalValue}>{currentDayRevenue.fiscal_revenue.toFixed(2)} €</Text>
                    <Text style={styles.currentTotalLabel}>{t('home.fiscal')}</Text>
                  </View>
                  <View style={styles.currentTotalItem}>
                    <Text style={styles.currentTotalValue}>{currentDayRevenue.pocket_money.toFixed(2)} €</Text>
                    <Text style={styles.currentTotalLabel}>{t('home.pocket')}</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('home.addFiscalRevenue')} (€)</Text>
              <TextInput
                style={styles.input}
                value={fiscalRevenue}
                onChangeText={setFiscalRevenue}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />
              <Text style={styles.inputHint}>{t('home.willBeAdded')} • {t('home.includesVAT')}</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('home.addToPocket')} (€)</Text>
              <TextInput
                style={styles.input}
                value={pocketMoney}
                onChangeText={setPocketMoney}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />
              <Text style={styles.inputHint}>{t('home.willBeAdded')} • {t('home.excludesVAT')}</Text>
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={handleAddRevenue}>
              <Text style={styles.submitButtonText}>{t('home.save')}</Text>
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
                )}}
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

                <TouchableOpacity style={[styles.submitButton, { backgroundColor: '#F59E0B' }]} onPress={handleAddExpense}>
                  <Ionicons name="add-circle" size={20} color="white" />
                  <Text style={styles.submitButtonText}>{t('expenses.add')}</Text>
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
  currentTotalsCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  currentTotalsTitle: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '600',
    marginBottom: 12,
  },
  currentTotalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  currentTotalItem: {
    alignItems: 'center',
  },
  currentTotalValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#10B981',
  },
  currentTotalLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
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
});

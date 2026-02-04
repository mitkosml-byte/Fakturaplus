import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  RefreshControl,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../src/services/api';
import { useTranslation } from '../src/i18n';

export default function BudgetScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [budgetStatus, setBudgetStatus] = useState<any>(null);
  const [recurringExpenses, setRecurringExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  
  // Budget form
  const [budgetLimit, setBudgetLimit] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('80');
  
  // Recurring expense form
  const [recurringDesc, setRecurringDesc] = useState('');
  const [recurringAmount, setRecurringAmount] = useState('');
  const [recurringDay, setRecurringDay] = useState('1');

  const loadData = useCallback(async () => {
    try {
      const [status, recurring] = await Promise.all([
        api.getBudgetStatus(),
        api.getRecurringExpenses()
      ]);
      setBudgetStatus(status);
      setRecurringExpenses(recurring.recurring_expenses || []);
    } catch (error) {
      console.error('Error loading budget data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const saveBudget = async () => {
    if (!budgetLimit || parseFloat(budgetLimit) <= 0) {
      Alert.alert(t('common.error'), t('budget.invalidAmount'));
      return;
    }
    
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      await api.createBudget({
        month: currentMonth,
        expense_limit: parseFloat(budgetLimit),
        alert_threshold: parseFloat(alertThreshold)
      });
      Alert.alert(t('common.success'), t('budget.saved'));
      setShowBudgetModal(false);
      loadData();
    } catch (error) {
      Alert.alert(t('common.error'), t('budget.saveError'));
    }
  };

  const saveRecurringExpense = async () => {
    if (!recurringDesc || !recurringAmount || parseFloat(recurringAmount) <= 0) {
      Alert.alert(t('common.error'), t('budget.invalidData'));
      return;
    }
    
    try {
      await api.createRecurringExpense({
        description: recurringDesc,
        amount: parseFloat(recurringAmount),
        day_of_month: parseInt(recurringDay)
      });
      Alert.alert(t('common.success'), t('budget.recurringCreated'));
      setShowRecurringModal(false);
      setRecurringDesc('');
      setRecurringAmount('');
      setRecurringDay('1');
      loadData();
    } catch (error) {
      Alert.alert(t('common.error'), t('budget.saveError'));
    }
  };

  const deleteRecurring = async (id: string) => {
    Alert.alert(
      t('common.confirm'),
      t('budget.deleteRecurringConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteRecurringExpense(id);
              loadData();
            } catch (error) {
              Alert.alert(t('common.error'), t('budget.deleteError'));
            }
          }
        }
      ]
    );
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 100) return '#EF4444';
    if (percent >= 80) return '#F59E0B';
    return '#10B981';
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{t('common.loading')}...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('budget.title')}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        >
          {/* Current Month Budget */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="wallet" size={24} color="#8B5CF6" />
              <Text style={styles.sectionTitle}>{t('budget.monthlyBudget')}</Text>
            </View>

            {budgetStatus?.has_budget ? (
              <View style={styles.budgetCard}>
                <View style={styles.budgetHeader}>
                  <Text style={styles.budgetMonth}>
                    {new Date().toLocaleDateString('bg-BG', { month: 'long', year: 'numeric' })}
                  </Text>
                  <TouchableOpacity onPress={() => setShowBudgetModal(true)}>
                    <Ionicons name="settings-outline" size={20} color="#64748B" />
                  </TouchableOpacity>
                </View>
                
                <View style={styles.progressContainer}>
                  <View style={styles.progressBar}>
                    <View 
                      style={[
                        styles.progressFill, 
                        { 
                          width: `${Math.min(budgetStatus.percent_used, 100)}%`,
                          backgroundColor: getProgressColor(budgetStatus.percent_used)
                        }
                      ]} 
                    />
                  </View>
                  <Text style={[styles.percentText, { color: getProgressColor(budgetStatus.percent_used) }]}>
                    {budgetStatus.percent_used.toFixed(0)}%
                  </Text>
                </View>
                
                <View style={styles.budgetStats}>
                  <View style={styles.budgetStat}>
                    <Text style={styles.budgetStatLabel}>{t('budget.spent')}</Text>
                    <Text style={[styles.budgetStatValue, { color: '#EF4444' }]}>
                      {budgetStatus.total_spent.toFixed(2)} €
                    </Text>
                  </View>
                  <View style={styles.budgetStat}>
                    <Text style={styles.budgetStatLabel}>{t('budget.remaining')}</Text>
                    <Text style={[styles.budgetStatValue, { color: '#10B981' }]}>
                      {budgetStatus.remaining.toFixed(2)} €
                    </Text>
                  </View>
                  <View style={styles.budgetStat}>
                    <Text style={styles.budgetStatLabel}>{t('budget.limit')}</Text>
                    <Text style={styles.budgetStatValue}>
                      {budgetStatus.expense_limit.toFixed(2)} €
                    </Text>
                  </View>
                </View>
                
                {budgetStatus.is_exceeded && (
                  <View style={styles.alertBanner}>
                    <Ionicons name="warning" size={20} color="#EF4444" />
                    <Text style={styles.alertText}>{t('budget.exceeded')}</Text>
                  </View>
                )}
                
                {budgetStatus.is_alert && !budgetStatus.is_exceeded && (
                  <View style={[styles.alertBanner, { backgroundColor: '#F59E0B20' }]}>
                    <Ionicons name="alert-circle" size={20} color="#F59E0B" />
                    <Text style={[styles.alertText, { color: '#F59E0B' }]}>{t('budget.nearLimit')}</Text>
                  </View>
                )}
              </View>
            ) : (
              <TouchableOpacity style={styles.noBudgetCard} onPress={() => setShowBudgetModal(true)}>
                <Ionicons name="add-circle-outline" size={48} color="#64748B" />
                <Text style={styles.noBudgetText}>{t('budget.noBudget')}</Text>
                <Text style={styles.noBudgetHint}>{t('budget.tapToCreate')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Recurring Expenses */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="repeat" size={24} color="#10B981" />
              <Text style={styles.sectionTitle}>{t('budget.recurring')}</Text>
              <TouchableOpacity 
                style={styles.addButton}
                onPress={() => setShowRecurringModal(true)}
              >
                <Ionicons name="add" size={24} color="white" />
              </TouchableOpacity>
            </View>

            {recurringExpenses.length > 0 ? (
              recurringExpenses.map((expense) => (
                <View key={expense.id} style={styles.recurringItem}>
                  <View style={styles.recurringInfo}>
                    <Text style={styles.recurringDesc}>{expense.description}</Text>
                    <Text style={styles.recurringDay}>
                      {t('budget.everyMonth')} {expense.day_of_month}
                    </Text>
                  </View>
                  <Text style={styles.recurringAmount}>{expense.amount.toFixed(2)} €</Text>
                  <TouchableOpacity onPress={() => deleteRecurring(expense.id)}>
                    <Ionicons name="trash-outline" size={20} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ))
            ) : (
              <View style={styles.emptyRecurring}>
                <Text style={styles.emptyText}>{t('budget.noRecurring')}</Text>
              </View>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Budget Modal */}
      <Modal visible={showBudgetModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('budget.setBudget')}</Text>
            
            <Text style={styles.inputLabel}>{t('budget.monthlyLimit')}</Text>
            <TextInput
              style={styles.input}
              value={budgetLimit}
              onChangeText={setBudgetLimit}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#64748B"
            />
            
            <Text style={styles.inputLabel}>{t('budget.alertAt')}</Text>
            <TextInput
              style={styles.input}
              value={alertThreshold}
              onChangeText={setAlertThreshold}
              keyboardType="number-pad"
              placeholder="80"
              placeholderTextColor="#64748B"
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancelBtn}
                onPress={() => setShowBudgetModal(false)}
              >
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={saveBudget}>
                <Text style={styles.modalSaveText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Recurring Expense Modal */}
      <Modal visible={showRecurringModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('budget.addRecurring')}</Text>
            
            <Text style={styles.inputLabel}>{t('budget.description')}</Text>
            <TextInput
              style={styles.input}
              value={recurringDesc}
              onChangeText={setRecurringDesc}
              placeholder={t('budget.descPlaceholder')}
              placeholderTextColor="#64748B"
            />
            
            <Text style={styles.inputLabel}>{t('budget.amount')}</Text>
            <TextInput
              style={styles.input}
              value={recurringAmount}
              onChangeText={setRecurringAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#64748B"
            />
            
            <Text style={styles.inputLabel}>{t('budget.dayOfMonth')}</Text>
            <TextInput
              style={styles.input}
              value={recurringDay}
              onChangeText={setRecurringDay}
              keyboardType="number-pad"
              placeholder="1-28"
              placeholderTextColor="#64748B"
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.modalCancelBtn}
                onPress={() => setShowRecurringModal(false)}
              >
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={saveRecurringExpense}>
                <Text style={styles.modalSaveText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#64748B',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
  },
  addButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 20,
    padding: 6,
  },
  budgetCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
  },
  budgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  budgetMonth: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    textTransform: 'capitalize',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  progressBar: {
    flex: 1,
    height: 12,
    backgroundColor: '#0F172A',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 6,
  },
  percentText: {
    fontSize: 16,
    fontWeight: 'bold',
    width: 50,
    textAlign: 'right',
  },
  budgetStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  budgetStat: {
    alignItems: 'center',
  },
  budgetStatLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  budgetStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EF444420',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  alertText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '500',
  },
  noBudgetCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#334155',
    borderStyle: 'dashed',
  },
  noBudgetText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  noBudgetHint: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 4,
  },
  recurringItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  recurringInfo: {
    flex: 1,
  },
  recurringDesc: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  recurringDay: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
  },
  recurringAmount: {
    color: '#F59E0B',
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 12,
  },
  emptyRecurring: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 340,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 20,
  },
  inputLabel: {
    color: '#94A3B8',
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 14,
    color: 'white',
    fontSize: 16,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  modalCancelBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#334155',
    alignItems: 'center',
  },
  modalCancelText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  modalSaveBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
  },
  modalSaveText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

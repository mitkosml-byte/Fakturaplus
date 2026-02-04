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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { api } from '../../src/services/api';
import { Summary, DailyRevenue, NonInvoiceExpense } from '../../src/types';
import { format, addDays, subDays } from 'date-fns';
import { bg } from 'date-fns/locale';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function HomeScreen() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [revenueModalVisible, setRevenueModalVisible] = useState(false);
  const [expenseModalVisible, setExpenseModalVisible] = useState(false);
  
  // Revenue form
  const [fiscalRevenue, setFiscalRevenue] = useState('');
  const [pocketMoney, setPocketMoney] = useState('');
  const [revenueDate, setRevenueDate] = useState(new Date());
  
  // Expense form
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date());
  
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

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

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
      setExpenseModalVisible(false);
      setExpenseDescription('');
      setExpenseAmount('');
      setExpenseDate(new Date());
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
                <Text style={styles.greeting}>Добре дошли!</Text>
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
                <Text style={styles.cardLabel}>Общ приход</Text>
                <Text style={[styles.cardValue, { color: '#10B981' }]}>
                  {summary?.total_income.toFixed(2) || '0.00'} €
                </Text>
              </View>

              <View style={[styles.summaryCard, styles.expenseCard]}>
                <View style={styles.cardIcon}>
                  <Ionicons name="trending-down" size={24} color="#EF4444" />
            </View>
            <Text style={styles.cardLabel}>Общ разход</Text>
            <Text style={[styles.cardValue, { color: '#EF4444' }]}>
              {summary?.total_expense.toFixed(2) || '0.00'} €
            </Text>
          </View>
        </View>

        {/* VAT Card */}
        <View style={styles.vatCard}>
          <View style={styles.vatHeader}>
            <Ionicons name="calculator" size={24} color="#8B5CF6" />
            <Text style={styles.vatTitle}>ДДС за плащане</Text>
          </View>
          <Text style={[styles.vatValue, { color: (summary?.vat_to_pay || 0) >= 0 ? '#EF4444' : '#10B981' }]}>
            {(summary?.vat_to_pay || 0).toFixed(2)} €
          </Text>
          <View style={styles.vatDetails}>
            <View style={styles.vatDetailRow}>
              <Text style={styles.vatDetailLabel}>ДДС от продажби:</Text>
              <Text style={styles.vatDetailValue}>{summary?.fiscal_vat.toFixed(2) || '0.00'} €</Text>
            </View>
            <View style={styles.vatDetailRow}>
              <Text style={styles.vatDetailLabel}>ДДС кредит (фактури):</Text>
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
            <Text style={styles.statLabel}>Джобче</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: (summary?.profit || 0) >= 0 ? '#10B981' : '#EF4444' }]}>
              {summary?.profit.toFixed(0) || 0}
            </Text>
            <Text style={styles.statLabel}>Печалба</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#10B981' }]}
            onPress={() => setRevenueModalVisible(true)}
          >
            <Ionicons name="cash" size={24} color="white" />
            <Text style={styles.actionButtonText}>Дневен оборот</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#F59E0B' }]}
            onPress={() => setExpenseModalVisible(true)}
          >
            <Ionicons name="remove-circle" size={24} color="white" />
            <Text style={styles.actionButtonText}>В канала</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Revenue Modal */}
      <Modal visible={revenueModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Дневен оборот</Text>
              <TouchableOpacity onPress={() => setRevenueModalVisible(false)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Date Picker */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Дата</Text>
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
                    {format(revenueDate, 'd MMMM yyyy', { locale: bg })}
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
              confirmTextIOS="Избери"
              cancelTextIOS="Отказ"
              locale="bg"
            />

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Фискализиран оборот (€)</Text>
              <TextInput
                style={styles.input}
                value={fiscalRevenue}
                onChangeText={setFiscalRevenue}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />
              <Text style={styles.inputHint}>Влиза в ДДС изчислението</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Джобче (€)</Text>
              <TextInput
                style={styles.input}
                value={pocketMoney}
                onChangeText={setPocketMoney}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />
              <Text style={styles.inputHint}>НЕ влиза в ДДС, само в статистиката</Text>
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={handleAddRevenue}>
              <Text style={styles.submitButtonText}>Запиши</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Expense Modal */}
      <Modal visible={expenseModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Разход без фактура</Text>
              <TouchableOpacity onPress={() => setExpenseModalVisible(false)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* Date Picker */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Дата</Text>
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
                    {format(expenseDate, 'd MMMM yyyy', { locale: bg })}
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
              confirmTextIOS="Избери"
              cancelTextIOS="Отказ"
              locale="bg"
            />

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Описание</Text>
              <TextInput
                style={styles.input}
                value={expenseDescription}
                onChangeText={setExpenseDescription}
                placeholder="Напр. гориво, материали..."
                placeholderTextColor="#64748B"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Сума (€)</Text>
              <TextInput
                style={styles.input}
                value={expenseAmount}
                onChangeText={setExpenseAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={handleAddExpense}>
              <Text style={styles.submitButtonText}>Запиши</Text>
            </TouchableOpacity>
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
});

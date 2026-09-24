import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  RefreshControl,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { Employee, PayrollAgreementType, PayrollRates, PayrollBreakdown, PayrollEntry } from '../src/types';
import { format } from 'date-fns';
import { bg, enUS } from 'date-fns/locale';
import { useTranslation, useLanguageStore } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied } from '../src/components';

const emptyEmployeeForm = () => ({
  name: '',
  position: '',
  base_salary: '',
  agreement_type: 'gross' as PayrollAgreementType,
  food_vouchers: '',
  additional_insurance: '',
});

export default function PayrollScreen() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const { language } = useLanguageStore();
  const dateLocale = language === 'bg' ? bg : enUS;
  const router = useRouter();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<PayrollEntry[]>([]);
  const [rates, setRates] = useState<PayrollRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const [employeeModalVisible, setEmployeeModalVisible] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm());

  const [payrollModalVisible, setPayrollModalVisible] = useState(false);
  const [payrollEmployee, setPayrollEmployee] = useState<Employee | null>(null);
  const [overrideAmount, setOverrideAmount] = useState('');
  const [bonusAmount, setBonusAmount] = useState('0');
  const [payrollNotes, setPayrollNotes] = useState('');
  const [payrollImage, setPayrollImage] = useState<string | null>(null);
  const [preview, setPreview] = useState<PayrollBreakdown | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [ratesModalVisible, setRatesModalVisible] = useState(false);
  const [ratesForm, setRatesForm] = useState({
    employee_rate_percent: '',
    employer_rate_percent: '',
    income_tax_percent: '',
    min_insurance_income: '',
    max_insurance_income: '',
  });

  const periodMonth = selectedMonth.getMonth() + 1;
  const periodYear = selectedMonth.getFullYear();

  const loadData = useCallback(async () => {
    try {
      const [employeesData, entriesData, ratesData] = await Promise.all([
        api.getEmployees(),
        api.getPayrollEntries({ month: periodMonth, year: periodYear }),
        api.getPayrollRates(),
      ]);
      setEmployees(employeesData);
      setEntries(entriesData);
      setRates(ratesData);
    } catch (error) {
      console.error('Error loading payroll data:', error);
    } finally {
      setLoading(false);
    }
  }, [periodMonth, periodYear]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const changeMonth = (delta: number) => {
    setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const entryForEmployee = (employeeId: string) => entries.find((e) => e.employee_id === employeeId);
  const totalCostThisMonth = entries.reduce((sum, e) => sum + e.total_employer_cost, 0);

  // ---- Employee CRUD ----
  const openNewEmployee = () => {
    setEditingEmployee(null);
    setEmployeeForm(emptyEmployeeForm());
    setEmployeeModalVisible(true);
  };

  const openEditEmployee = (emp: Employee) => {
    setEditingEmployee(emp);
    setEmployeeForm({
      name: emp.name,
      position: emp.position || '',
      base_salary: String(emp.base_salary),
      agreement_type: emp.agreement_type,
      food_vouchers: emp.food_vouchers ? String(emp.food_vouchers) : '',
      additional_insurance: emp.additional_insurance ? String(emp.additional_insurance) : '',
    });
    setEmployeeModalVisible(true);
  };

  const saveEmployee = async () => {
    if (!employeeForm.name.trim() || !employeeForm.base_salary) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }
    const payload = {
      name: employeeForm.name.trim(),
      position: employeeForm.position.trim() || undefined,
      base_salary: parseFloat(employeeForm.base_salary) || 0,
      agreement_type: employeeForm.agreement_type,
      food_vouchers: parseFloat(employeeForm.food_vouchers) || 0,
      additional_insurance: parseFloat(employeeForm.additional_insurance) || 0,
    };
    try {
      if (editingEmployee) {
        await api.updateEmployee(editingEmployee.id, payload);
      } else {
        await api.createEmployee(payload);
      }
      setEmployeeModalVisible(false);
      await loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  const deleteEmployee = (emp: Employee) => {
    Alert.alert(
      t('payroll.deleteEmployee'),
      t('payroll.deleteEmployeeConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteEmployee(emp.id);
              setEmployeeModalVisible(false);
              await loadData();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            }
          },
        },
      ]
    );
  };

  // ---- Payroll entry ----
  const openPayrollEntry = (emp: Employee) => {
    setPayrollEmployee(emp);
    setOverrideAmount(String(emp.base_salary));
    setBonusAmount('0');
    setPayrollNotes('');
    setPayrollImage(null);
    setPreview(null);
    setPayrollModalVisible(true);
  };

  const runPreview = useCallback(async () => {
    if (!payrollEmployee) return;
    setPreviewLoading(true);
    try {
      const amount = parseFloat(overrideAmount) || payrollEmployee.base_salary;
      const params: any = {
        employee_id: payrollEmployee.id,
        period_month: periodMonth,
        period_year: periodYear,
        bonus_amount: parseFloat(bonusAmount) || 0,
      };
      if (payrollEmployee.agreement_type === 'net') {
        params.net_target = amount;
      } else {
        params.gross_amount = amount;
      }
      const result = await api.previewPayroll(params);
      setPreview(result);
    } catch (error: any) {
      console.error('Preview error:', error);
    } finally {
      setPreviewLoading(false);
    }
  }, [payrollEmployee, overrideAmount, bonusAmount, periodMonth, periodYear]);

  useEffect(() => {
    if (payrollModalVisible && payrollEmployee) {
      const timeout = setTimeout(runPreview, 400);
      return () => clearTimeout(timeout);
    }
  }, [payrollModalVisible, payrollEmployee, overrideAmount, bonusAmount, runPreview]);

  const pickPayrollImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0].base64) {
      setPayrollImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const savePayrollEntry = async () => {
    if (!payrollEmployee) return;
    setSaving(true);
    try {
      const amount = parseFloat(overrideAmount) || payrollEmployee.base_salary;
      const params: any = {
        employee_id: payrollEmployee.id,
        period_month: periodMonth,
        period_year: periodYear,
        bonus_amount: parseFloat(bonusAmount) || 0,
        notes: payrollNotes || undefined,
        image_base64: payrollImage || undefined,
      };
      if (payrollEmployee.agreement_type === 'net') {
        params.net_target = amount;
      } else {
        params.gross_amount = amount;
      }
      await api.createPayrollEntry(params);
      setPayrollModalVisible(false);
      await loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const deletePayrollEntry = (entry: PayrollEntry) => {
    Alert.alert(
      t('common.confirm'),
      t('payroll.deleteEntryConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deletePayrollEntry(entry.id);
              await loadData();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            }
          },
        },
      ]
    );
  };

  // ---- Rates ----
  const openRates = () => {
    if (!rates) return;
    setRatesForm({
      employee_rate_percent: String(rates.employee_rate_percent),
      employer_rate_percent: String(rates.employer_rate_percent),
      income_tax_percent: String(rates.income_tax_percent),
      min_insurance_income: String(rates.min_insurance_income),
      max_insurance_income: String(rates.max_insurance_income),
    });
    setRatesModalVisible(true);
  };

  const saveRates = async () => {
    try {
      const updated = await api.updatePayrollRates({
        employee_rate_percent: parseFloat(ratesForm.employee_rate_percent),
        employer_rate_percent: parseFloat(ratesForm.employer_rate_percent),
        income_tax_percent: parseFloat(ratesForm.income_tax_percent),
        min_insurance_income: parseFloat(ratesForm.min_insurance_income),
        max_insurance_income: parseFloat(ratesForm.max_insurance_income),
      });
      setRates(updated);
      setRatesModalVisible(false);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  if (!hasPermission('manage_budget')) {
    return <AccessDenied />;
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('payroll.title')}</Text>
          <TouchableOpacity onPress={openRates} style={styles.backButton}>
            <Ionicons name="settings-outline" size={22} color="white" />
          </TouchableOpacity>
        </View>

        <View style={styles.monthSelector}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.monthArrow}>
            <Ionicons name="chevron-back" size={22} color="#8B5CF6" />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>
            {format(selectedMonth, 'LLLL yyyy', { locale: dateLocale })}
          </Text>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.monthArrow}>
            <Ionicons name="chevron-forward" size={22} color="#8B5CF6" />
          </TouchableOpacity>
        </View>

        <View style={styles.totalCostCard}>
          <Text style={styles.totalCostLabel}>{t('payroll.totalCostThisMonth')}</Text>
          <Text style={styles.totalCostValue}>{totalCostThisMonth.toFixed(2)} €</Text>
        </View>

        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('payroll.employees')}</Text>
            <TouchableOpacity style={styles.addButton} onPress={openNewEmployee}>
              <Ionicons name="add" size={22} color="white" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#8B5CF6" />
            </View>
          ) : employees.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={56} color="#334155" />
              <Text style={styles.emptyText}>{t('payroll.noEmployees')}</Text>
              <Text style={styles.emptyHint}>{t('payroll.noEmployeesHint')}</Text>
            </View>
          ) : (
            employees.map((emp) => {
              const entry = entryForEmployee(emp.id);
              return (
                <View key={emp.id} style={styles.employeeCard}>
                  <TouchableOpacity style={styles.employeeCardMain} onPress={() => openEditEmployee(emp)}>
                    <View style={styles.employeeAvatar}>
                      <Ionicons name="person" size={20} color="#8B5CF6" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.employeeName}>{emp.name}</Text>
                      <Text style={styles.employeePosition}>
                        {emp.position || t('payroll.noPosition')} · {emp.base_salary.toFixed(0)} €
                        {emp.agreement_type === 'net' ? ` ${t('payroll.netShort')}` : ` ${t('payroll.grossShort')}`}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {entry ? (
                    <View style={styles.entrySummary}>
                      <View style={styles.entrySummaryRow}>
                        <Text style={styles.entrySummaryLabel}>{t('payroll.netAmount')}</Text>
                        <Text style={styles.entrySummaryValue}>{entry.net_amount.toFixed(2)} €</Text>
                      </View>
                      <View style={styles.entrySummaryRow}>
                        <Text style={styles.entrySummaryLabel}>{t('payroll.totalEmployerCost')}</Text>
                        <Text style={[styles.entrySummaryValue, { color: '#8B5CF6' }]}>{entry.total_employer_cost.toFixed(2)} €</Text>
                      </View>
                      <TouchableOpacity style={styles.deleteEntryButton} onPress={() => deletePayrollEntry(entry)}>
                        <Ionicons name="trash-outline" size={14} color="#EF4444" />
                        <Text style={styles.deleteEntryText}>{t('payroll.removeEntry')}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.processButton} onPress={() => openPayrollEntry(emp)}>
                      <Ionicons name="calculator-outline" size={16} color="white" />
                      <Text style={styles.processButtonText}>{t('payroll.process')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Employee Modal */}
      <Modal visible={employeeModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} style={{ width: '100%' }}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{editingEmployee ? t('payroll.editEmployee') : t('payroll.newEmployee')}</Text>

              <Text style={styles.inputLabel}>{t('payroll.name')} *</Text>
              <TextInput
                style={styles.input}
                value={employeeForm.name}
                onChangeText={(v) => setEmployeeForm((p) => ({ ...p, name: v }))}
                placeholder={t('payroll.namePlaceholder')}
                placeholderTextColor="#64748B"
              />

              <Text style={styles.inputLabel}>{t('payroll.position')}</Text>
              <TextInput
                style={styles.input}
                value={employeeForm.position}
                onChangeText={(v) => setEmployeeForm((p) => ({ ...p, position: v }))}
                placeholder={t('payroll.positionPlaceholder')}
                placeholderTextColor="#64748B"
              />

              <Text style={styles.inputLabel}>{t('payroll.agreementType')}</Text>
              <View style={styles.agreementRow}>
                <TouchableOpacity
                  style={[styles.agreementChip, employeeForm.agreement_type === 'gross' && styles.agreementChipActive]}
                  onPress={() => setEmployeeForm((p) => ({ ...p, agreement_type: 'gross' }))}
                >
                  <Text style={[styles.agreementChipText, employeeForm.agreement_type === 'gross' && styles.agreementChipTextActive]}>
                    {t('payroll.grossAgreement')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.agreementChip, employeeForm.agreement_type === 'net' && styles.agreementChipActive]}
                  onPress={() => setEmployeeForm((p) => ({ ...p, agreement_type: 'net' }))}
                >
                  <Text style={[styles.agreementChipText, employeeForm.agreement_type === 'net' && styles.agreementChipTextActive]}>
                    {t('payroll.netAgreement')}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>
                {employeeForm.agreement_type === 'net' ? t('payroll.netSalary') : t('payroll.grossSalary')} *
              </Text>
              <TextInput
                style={styles.input}
                value={employeeForm.base_salary}
                onChangeText={(v) => setEmployeeForm((p) => ({ ...p, base_salary: v }))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>{t('payroll.foodVouchers')}</Text>
                  <TextInput
                    style={styles.input}
                    value={employeeForm.food_vouchers}
                    onChangeText={(v) => setEmployeeForm((p) => ({ ...p, food_vouchers: v }))}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#64748B"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>{t('payroll.additionalInsurance')}</Text>
                  <TextInput
                    style={styles.input}
                    value={employeeForm.additional_insurance}
                    onChangeText={(v) => setEmployeeForm((p) => ({ ...p, additional_insurance: v }))}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#64748B"
                  />
                </View>
              </View>

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setEmployeeModalVisible(false)}>
                  <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveBtn} onPress={saveEmployee}>
                  <Text style={styles.modalSaveText}>{t('common.save')}</Text>
                </TouchableOpacity>
              </View>

              {editingEmployee && (
                <TouchableOpacity style={styles.deleteEmployeeButton} onPress={() => deleteEmployee(editingEmployee)}>
                  <Ionicons name="trash" size={16} color="#EF4444" />
                  <Text style={styles.deleteEmployeeText}>{t('payroll.deleteEmployee')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Payroll Entry Modal */}
      <Modal visible={payrollModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} style={{ width: '100%' }}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{payrollEmployee?.name}</Text>
              <Text style={styles.modalSubtitle}>{format(selectedMonth, 'LLLL yyyy', { locale: dateLocale })}</Text>

              <Text style={styles.inputLabel}>
                {payrollEmployee?.agreement_type === 'net' ? t('payroll.netSalary') : t('payroll.grossSalary')}
              </Text>
              <TextInput
                style={styles.input}
                value={overrideAmount}
                onChangeText={setOverrideAmount}
                keyboardType="decimal-pad"
                placeholderTextColor="#64748B"
              />

              <Text style={styles.inputLabel}>{t('payroll.bonus')}</Text>
              <TextInput
                style={styles.input}
                value={bonusAmount}
                onChangeText={setBonusAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#64748B"
              />

              <TouchableOpacity style={styles.attachButton} onPress={pickPayrollImage}>
                <Ionicons name="image-outline" size={18} color="#8B5CF6" />
                <Text style={styles.attachButtonText}>
                  {payrollImage ? t('payroll.photoAttached') : t('payroll.attachPhoto')}
                </Text>
              </TouchableOpacity>

              <View style={styles.previewCard}>
                {previewLoading ? (
                  <ActivityIndicator color="#8B5CF6" />
                ) : preview ? (
                  <>
                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>{t('payroll.grossAmount')}</Text>
                      <Text style={styles.previewValue}>{preview.gross_amount.toFixed(2)} €</Text>
                    </View>
                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>{t('payroll.employeeContributions')}</Text>
                      <Text style={[styles.previewValue, { color: '#EF4444' }]}>-{preview.employee_contributions.toFixed(2)} €</Text>
                    </View>
                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>{t('payroll.incomeTax')}</Text>
                      <Text style={[styles.previewValue, { color: '#EF4444' }]}>-{preview.income_tax.toFixed(2)} €</Text>
                    </View>
                    <View style={[styles.previewRow, styles.previewRowHighlight]}>
                      <Text style={styles.previewLabelBold}>{t('payroll.netAmount')}</Text>
                      <Text style={styles.previewValueBold}>{preview.net_amount.toFixed(2)} €</Text>
                    </View>
                    <View style={styles.previewDivider} />
                    <View style={styles.previewRow}>
                      <Text style={styles.previewLabel}>{t('payroll.employerContributions')}</Text>
                      <Text style={styles.previewValue}>+{preview.employer_contributions.toFixed(2)} €</Text>
                    </View>
                    <View style={[styles.previewRow, styles.previewRowHighlight]}>
                      <Text style={styles.previewLabelBold}>{t('payroll.totalEmployerCost')}</Text>
                      <Text style={[styles.previewValueBold, { color: '#8B5CF6' }]}>{preview.total_employer_cost.toFixed(2)} €</Text>
                    </View>
                  </>
                ) : null}
              </View>

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setPayrollModalVisible(false)}>
                  <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveBtn} onPress={savePayrollEntry} disabled={saving}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.modalSaveText}>{t('common.save')}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Rates Modal */}
      <Modal visible={ratesModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('payroll.rates')}</Text>
            <Text style={styles.ratesDisclaimer}>{t('payroll.ratesDisclaimer')}</Text>

            <Text style={styles.inputLabel}>{t('payroll.employeeRate')}</Text>
            <TextInput
              style={styles.input}
              value={ratesForm.employee_rate_percent}
              onChangeText={(v) => setRatesForm((p) => ({ ...p, employee_rate_percent: v }))}
              keyboardType="decimal-pad"
              placeholderTextColor="#64748B"
            />

            <Text style={styles.inputLabel}>{t('payroll.employerRate')}</Text>
            <TextInput
              style={styles.input}
              value={ratesForm.employer_rate_percent}
              onChangeText={(v) => setRatesForm((p) => ({ ...p, employer_rate_percent: v }))}
              keyboardType="decimal-pad"
              placeholderTextColor="#64748B"
            />

            <Text style={styles.inputLabel}>{t('payroll.incomeTaxRate')}</Text>
            <TextInput
              style={styles.input}
              value={ratesForm.income_tax_percent}
              onChangeText={(v) => setRatesForm((p) => ({ ...p, income_tax_percent: v }))}
              keyboardType="decimal-pad"
              placeholderTextColor="#64748B"
            />

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>{t('payroll.minInsuranceIncome')}</Text>
                <TextInput
                  style={styles.input}
                  value={ratesForm.min_insurance_income}
                  onChangeText={(v) => setRatesForm((p) => ({ ...p, min_insurance_income: v }))}
                  keyboardType="decimal-pad"
                  placeholderTextColor="#64748B"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>{t('payroll.maxInsuranceIncome')}</Text>
                <TextInput
                  style={styles.input}
                  value={ratesForm.max_insurance_income}
                  onChangeText={(v) => setRatesForm((p) => ({ ...p, max_insurance_income: v }))}
                  keyboardType="decimal-pad"
                  placeholderTextColor="#64748B"
                />
              </View>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setRatesModalVisible(false)}>
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={saveRates}>
                <Text style={styles.modalSaveText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  monthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 12,
  },
  monthArrow: { padding: 8 },
  monthLabel: { fontSize: 16, fontWeight: '600', color: 'white', textTransform: 'capitalize', minWidth: 140, textAlign: 'center' },
  totalCostCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  totalCostLabel: { fontSize: 12, color: '#94A3B8' },
  totalCostValue: { fontSize: 24, fontWeight: 'bold', color: '#8B5CF6', marginTop: 4 },
  content: { flex: 1, paddingHorizontal: 16 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: 'white' },
  addButton: { backgroundColor: '#8B5CF6', borderRadius: 20, padding: 6 },
  loadingContainer: { paddingVertical: 40, alignItems: 'center' },
  emptyContainer: { alignItems: 'center', paddingVertical: 50 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 14 },
  emptyHint: { fontSize: 13, color: '#475569', marginTop: 6, textAlign: 'center', paddingHorizontal: 24 },
  employeeCard: { backgroundColor: '#1E293B', borderRadius: 14, padding: 14, marginBottom: 12 },
  employeeCardMain: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  employeeAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  employeeName: { fontSize: 16, fontWeight: '600', color: 'white' },
  employeePosition: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  processButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#8B5CF6', borderRadius: 10, paddingVertical: 10,
  },
  processButtonText: { color: 'white', fontSize: 13, fontWeight: '600' },
  entrySummary: { backgroundColor: '#0F172A', borderRadius: 10, padding: 12 },
  entrySummaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  entrySummaryLabel: { fontSize: 12, color: '#94A3B8' },
  entrySummaryValue: { fontSize: 13, fontWeight: '600', color: 'white' },
  deleteEntryButton: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start' },
  deleteEntryText: { fontSize: 11, color: '#EF4444' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#1E293B', borderRadius: 20, padding: 22 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: 'white', textAlign: 'center' },
  modalSubtitle: { fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 2, marginBottom: 12, textTransform: 'capitalize' },
  inputLabel: { fontSize: 13, color: '#94A3B8', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#0F172A', borderRadius: 10, padding: 12, color: 'white', fontSize: 15 },
  row2: { flexDirection: 'row', gap: 12 },
  agreementRow: { flexDirection: 'row', gap: 10 },
  agreementChip: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  agreementChipActive: { backgroundColor: '#8B5CF6' },
  agreementChipText: { fontSize: 13, color: '#94A3B8', fontWeight: '500' },
  agreementChipTextActive: { color: 'white' },
  attachButton: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, alignSelf: 'flex-start' },
  attachButtonText: { fontSize: 13, color: '#8B5CF6', fontWeight: '500' },
  previewCard: { backgroundColor: '#0F172A', borderRadius: 12, padding: 14, marginTop: 16, minHeight: 60 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  previewRowHighlight: { borderTopWidth: 1, borderTopColor: '#334155', paddingTop: 8, marginTop: 4 },
  previewLabel: { fontSize: 12, color: '#94A3B8' },
  previewValue: { fontSize: 13, color: 'white', fontWeight: '500' },
  previewLabelBold: { fontSize: 13, color: 'white', fontWeight: '700' },
  previewValueBold: { fontSize: 15, color: 'white', fontWeight: '700' },
  previewDivider: { height: 10 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#334155', alignItems: 'center' },
  modalCancelText: { color: 'white', fontSize: 15, fontWeight: '500' },
  modalSaveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#8B5CF6', alignItems: 'center' },
  modalSaveText: { color: 'white', fontSize: 15, fontWeight: '600' },
  deleteEmployeeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, padding: 10 },
  deleteEmployeeText: { color: '#EF4444', fontSize: 13, fontWeight: '500' },
  ratesDisclaimer: { fontSize: 12, color: '#F59E0B', textAlign: 'center', marginTop: 8, lineHeight: 17 },
});

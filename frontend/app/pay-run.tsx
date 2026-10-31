import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { format } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import { Employee, BatchPayResultItem } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, Avatar } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

type PendingMember = { user_id: string; name: string; picture: string | null; total_hours: number; estimated_pay: number };

export default function PayRunScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manage_budget');

  const [selectedMonth, setSelectedMonth] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [loading, setLoading] = useState(true);
  const [pendingEmployees, setPendingEmployees] = useState<Employee[]>([]);
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<BatchPayResultItem[] | null>(null);

  const periodMonth = selectedMonth.getMonth() + 1;
  const periodYear = selectedMonth.getFullYear();
  const monthStart = toDateStr(new Date(periodYear, periodMonth - 1, 1));
  const monthEnd = toDateStr(new Date(periodYear, periodMonth, 0));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [employees, entries, occData, paymentsData, directory] = await Promise.all([
        api.getEmployees(true),
        api.getPayrollEntries({ month: periodMonth, year: periodYear }),
        api.getShiftOccurrences(monthStart, monthEnd),
        api.getSchedulePayments(monthStart, monthEnd),
        api.getCompanyDirectory(),
      ]);

      const paidEmployeeIds = new Set(entries.map((e) => e.employee_id));
      setPendingEmployees(employees.filter((e) => !paidEmployeeIds.has(e.id)));

      const totalsByUser: Record<string, { hours: number; pay: number }> = {};
      occData.occurrences.forEach((o) => {
        const cur = totalsByUser[o.user_id] || { hours: 0, pay: 0 };
        cur.hours += o.hours;
        cur.pay += o.hours * (o.hourly_rate || 0);
        totalsByUser[o.user_id] = cur;
      });
      const paidUserIds = new Set(paymentsData.payments.map((p) => p.user_id));
      const members: PendingMember[] = Object.entries(totalsByUser)
        .filter(([userId, totals]) => totals.pay > 0 && !paidUserIds.has(userId))
        .map(([userId, totals]) => {
          const dirEntry = directory.find((d) => d.user_id === userId);
          return {
            user_id: userId,
            name: dirEntry?.name || '?',
            picture: dirEntry?.picture || null,
            total_hours: Math.round(totals.hours * 100) / 100,
            estimated_pay: Math.round(totals.pay * 100) / 100,
          };
        });
      setPendingMembers(members);

      // Selections from a previous period aren't meaningful once the
      // underlying pending list changes.
      setSelectedEmployeeIds(new Set());
      setSelectedMemberIds(new Set());
      setResults(null);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodMonth, periodYear]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const changeMonth = (delta: number) => {
    setSelectedMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const toggleEmployee = (id: string) => {
    setSelectedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleMember = (id: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleProcess = async () => {
    if (selectedEmployeeIds.size === 0 && selectedMemberIds.size === 0) {
      Alert.alert(t('common.error'), t('payRun.pickAtLeastOne'));
      return;
    }
    setProcessing(true);
    try {
      const response = await api.batchPay({
        payroll_entries: Array.from(selectedEmployeeIds).map((employee_id) => ({
          employee_id, period_month: periodMonth, period_year: periodYear,
        })),
        schedule_payments: Array.from(selectedMemberIds).map((user_id) => ({
          user_id, period_start: monthStart, period_end: monthEnd,
        })),
      });
      setResults(response.results);
      if (response.results.every((r) => r.success)) Haptics.success();
      await loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('payRun.processError'));
    } finally {
      setProcessing(false);
    }
  };

  if (!canManage) return <AccessDenied />;

  const totalSelectedAmount =
    pendingEmployees.filter((e) => selectedEmployeeIds.has(e.id)).reduce((sum, e) => sum + e.base_salary, 0) +
    pendingMembers.filter((m) => selectedMemberIds.has(m.user_id)).reduce((sum, m) => sum + m.estimated_pay, 0);

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('payRun.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <View style={styles.monthSelector}>
            <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.monthArrow}>
              <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{format(selectedMonth, 'LLLL yyyy', { locale: dateLocale })}</Text>
            <TouchableOpacity onPress={() => changeMonth(1)} style={styles.monthArrow}>
              <Ionicons name="chevron-forward" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 32 }}>
              {results && (
                <View style={styles.resultsCard}>
                  <Text style={styles.resultsTitle}>{t('payRun.resultsTitle')}</Text>
                  {results.map((r, i) => (
                    <View key={i} style={styles.resultRow}>
                      <Ionicons
                        name={r.success ? 'checkmark-circle' : 'close-circle'}
                        size={18}
                        color={r.success ? COLORS.success : COLORS.danger}
                      />
                      <Text style={styles.resultLabel}>{r.label}</Text>
                      {r.success ? (
                        <Text style={styles.resultAmount}>{(r.amount || 0).toFixed(2)} €</Text>
                      ) : (
                        <Text style={styles.resultError}>{r.error}</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {pendingEmployees.length === 0 && pendingMembers.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="checkmark-done-circle-outline" size={64} color={COLORS.border} />
                  <Text style={styles.emptyText}>{t('payRun.allPaid')}</Text>
                </View>
              ) : (
                <>
                  {pendingEmployees.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>{t('payRun.fixedSalary')}</Text>
                      {pendingEmployees.map((emp) => (
                        <TouchableOpacity key={emp.id} style={styles.row} onPress={() => toggleEmployee(emp.id)}>
                          <Ionicons
                            name={selectedEmployeeIds.has(emp.id) ? 'checkbox' : 'square-outline'}
                            size={22}
                            color={COLORS.primary}
                          />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.rowName}>{emp.name}</Text>
                            <Text style={styles.rowMeta}>
                              {emp.base_salary.toFixed(2)} € {emp.agreement_type === 'net' ? t('payroll.netShort') : t('payroll.grossShort')}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {pendingMembers.length > 0 && (
                    <View style={styles.section}>
                      <Text style={styles.sectionTitle}>{t('payRun.hourly')}</Text>
                      {pendingMembers.map((m) => (
                        <TouchableOpacity key={m.user_id} style={styles.row} onPress={() => toggleMember(m.user_id)}>
                          <Ionicons
                            name={selectedMemberIds.has(m.user_id) ? 'checkbox' : 'square-outline'}
                            size={22}
                            color={COLORS.primary}
                          />
                          <Avatar uri={m.picture} name={m.name} size={28} />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.rowName}>{m.name}</Text>
                            <Text style={styles.rowMeta}>
                              {m.total_hours}ч · {m.estimated_pay.toFixed(2)} €
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          )}

          {(selectedEmployeeIds.size > 0 || selectedMemberIds.size > 0) && (
            <View style={styles.footer}>
              <TouchableOpacity style={[styles.processButton, processing && { opacity: 0.6 }]} onPress={handleProcess} disabled={processing}>
                {processing ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.processButtonText}>
                    {t('payRun.processSelected').replace('{count}', String(selectedEmployeeIds.size + selectedMemberIds.size)).replace('{amount}', totalSelectedAmount.toFixed(2))}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
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
  monthSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 12 },
  monthArrow: { padding: 6 },
  monthLabel: { fontSize: 16, fontWeight: '600', color: 'white', textTransform: 'capitalize', minWidth: 140, textAlign: 'center' },
  content: { flex: 1, padding: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, color: COLORS.textMuted, marginTop: 16, textAlign: 'center' },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.primaryLight, marginBottom: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  rowName: { fontSize: 14, fontWeight: '600', color: 'white' },
  rowMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  resultsCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 16 },
  resultsTitle: { fontSize: 14, fontWeight: '700', color: 'white', marginBottom: 10 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  resultLabel: { flex: 1, fontSize: 13, color: 'white' },
  resultAmount: { fontSize: 13, color: COLORS.success, fontWeight: '600' },
  resultError: { fontSize: 11, color: COLORS.danger, flexShrink: 1, textAlign: 'right' },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: COLORS.surface },
  processButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  processButtonText: { color: 'white', fontWeight: 'bold', fontSize: 15 },
});

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import DateTimePickerModal from '../src/components/AppDateTimePicker';
import { format } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { api } from '../src/services/api';
import { downloadAndShareFile, NotLoggedInError } from '../src/utils/downloadFile';
import { Employee, PublicHoliday, HolidayWorkEntry, LeaveEntry, LeaveType } from '../src/types';
import { useTranslation, useLanguageStore } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'paid', label: 'Платена' },
  { value: 'unpaid', label: 'Неплатена' },
  { value: 'sick', label: 'Болнична' },
];

const toDateStr = (d: Date) => format(d, 'yyyy-MM-dd');

export default function EmployeeAbsencesScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { hasPermission } = useAuth();

  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'holiday' | 'leave'>('holiday');
  const [year, setYear] = useState(new Date().getFullYear());

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [holidayWork, setHolidayWork] = useState<HolidayWorkEntry[]>([]);
  const [leave, setLeave] = useState<LeaveEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const [employeesList, holidaysList, holidayWorkList, leaveList] = await Promise.all([
        api.getEmployees(true),
        api.getPublicHolidays(year),
        api.getHolidayWorkEntries({ start_date: yearStart, end_date: yearEnd }),
        api.getLeaveEntries({ start_date: yearStart, end_date: yearEnd }),
      ]);
      setEmployees(employeesList);
      setHolidays(holidaysList);
      setHolidayWork(holidayWorkList);
      setLeave(leaveList);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [year, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // ---- Add holiday-work entry ----
  const [holidayModalVisible, setHolidayModalVisible] = useState(false);
  const [holidayEmployeeId, setHolidayEmployeeId] = useState<string | null>(null);
  const [holidayDate, setHolidayDate] = useState<string | null>(null);
  const [holidayNote, setHolidayNote] = useState('');
  const [savingHoliday, setSavingHoliday] = useState(false);

  const openHolidayModal = () => {
    setHolidayEmployeeId(employees[0]?.id || null);
    setHolidayDate(holidays[0]?.date || null);
    setHolidayNote('');
    setHolidayModalVisible(true);
  };

  const saveHolidayWork = async () => {
    if (!holidayEmployeeId || !holidayDate) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }
    setSavingHoliday(true);
    try {
      await api.createHolidayWorkEntry({ employee_id: holidayEmployeeId, date: holidayDate, note: holidayNote.trim() || undefined });
      setHolidayModalVisible(false);
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSavingHoliday(false);
    }
  };

  const deleteHolidayWork = (entry: HolidayWorkEntry) => {
    Alert.alert(t('common.delete'), t('absences.deleteHolidayWorkConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteHolidayWorkEntry(entry.id);
            await load();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  // ---- Add leave entry ----
  const [leaveModalVisible, setLeaveModalVisible] = useState(false);
  const [leaveEmployeeId, setLeaveEmployeeId] = useState<string | null>(null);
  const [leaveType, setLeaveType] = useState<LeaveType>('paid');
  const [leaveStart, setLeaveStart] = useState(new Date());
  const [leaveEnd, setLeaveEnd] = useState(new Date());
  const [leaveNote, setLeaveNote] = useState('');
  const [leaveStartPickerVisible, setLeaveStartPickerVisible] = useState(false);
  const [leaveEndPickerVisible, setLeaveEndPickerVisible] = useState(false);
  const [savingLeave, setSavingLeave] = useState(false);

  const openLeaveModal = () => {
    setLeaveEmployeeId(employees[0]?.id || null);
    setLeaveType('paid');
    setLeaveStart(new Date());
    setLeaveEnd(new Date());
    setLeaveNote('');
    setLeaveModalVisible(true);
  };

  const saveLeave = async () => {
    if (!leaveEmployeeId) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }
    const startStr = toDateStr(leaveStart);
    const endStr = toDateStr(leaveEnd);
    if (endStr < startStr) {
      Alert.alert(t('common.error'), t('absences.endBeforeStart'));
      return;
    }
    setSavingLeave(true);
    try {
      await api.createLeaveEntry({ employee_id: leaveEmployeeId, leave_type: leaveType, start_date: startStr, end_date: endStr, note: leaveNote.trim() || undefined });
      setLeaveModalVisible(false);
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSavingLeave(false);
    }
  };

  const deleteLeave = (entry: LeaveEntry) => {
    Alert.alert(t('common.delete'), t('absences.deleteLeaveConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteLeaveEntry(entry.id);
            await load();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  // ---- Export ----
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportStart, setExportStart] = useState(new Date(new Date().getFullYear(), 0, 1));
  const [exportEnd, setExportEnd] = useState(new Date());
  const [exportStartPickerVisible, setExportStartPickerVisible] = useState(false);
  const [exportEndPickerVisible, setExportEndPickerVisible] = useState(false);
  const [exporting, setExporting] = useState(false);

  const runExport = async () => {
    setExporting(true);
    try {
      const startStr = toDateStr(exportStart);
      const endStr = toDateStr(exportEnd);
      const endpoint = `/api/export/employee-compliance/excel?start_date=${startStr}&end_date=${endStr}`;
      const filename = `praznici_otpuski_${startStr}_${endStr}.xlsx`;
      const { shared } = await downloadAndShareFile(endpoint, filename);
      if (!shared) {
        Toast.success(t('export.fileSaved'));
      }
      setExportModalVisible(false);
    } catch (error) {
      if (error instanceof NotLoggedInError) {
        Alert.alert(t('common.error'), t('export.notLoggedIn'));
      } else {
        Alert.alert(t('common.error'), t('export.failed'));
      }
    } finally {
      setExporting(false);
    }
  };

  const employeeName = (id: string | null) => employees.find((e) => e.id === id)?.name || '';

  if (!hasPermission('manage_budget')) {
    return <AccessDenied />;
  }

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('absences.title')}</Text>
            {hasPermission('export_data') ? (
              <TouchableOpacity onPress={() => setExportModalVisible(true)} style={styles.iconButton} accessibilityLabel={t('absences.export')}>
                <Ionicons name="download-outline" size={22} color="white" />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 40 }} />
            )}
          </View>

          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeButton, viewMode === 'holiday' && styles.modeButtonActive]}
              onPress={() => setViewMode('holiday')}
            >
              <Text style={[styles.modeButtonText, viewMode === 'holiday' && styles.modeButtonTextActive]}>{t('absences.holidayWorkTab')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeButton, viewMode === 'leave' && styles.modeButtonActive]}
              onPress={() => setViewMode('leave')}
            >
              <Text style={[styles.modeButtonText, viewMode === 'leave' && styles.modeButtonTextActive]}>{t('absences.leaveTab')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.yearRow}>
            <TouchableOpacity onPress={() => setYear((y) => y - 1)} style={styles.yearArrow}>
              <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
            </TouchableOpacity>
            <Text style={styles.yearText}>{year}</Text>
            <TouchableOpacity onPress={() => setYear((y) => y + 1)} style={styles.yearArrow}>
              <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 100 }}>
              {viewMode === 'holiday' ? (
                holidayWork.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons name="sunny-outline" size={48} color={COLORS.border} />
                    <Text style={styles.emptyText}>{t('absences.noHolidayWork')}</Text>
                  </View>
                ) : (
                  holidayWork.map((entry) => (
                    <TouchableOpacity key={entry.id} style={styles.entryCard} onPress={() => deleteHolidayWork(entry)}>
                      <View style={styles.entryRow}>
                        <Text style={styles.entryEmployee}>{entry.employee_name}</Text>
                        <Text style={styles.entryDate}>{format(new Date(`${entry.date}T00:00:00`), 'd MMM yyyy', { locale: dateLocale })}</Text>
                      </View>
                      <Text style={styles.entryHolidayName}>{entry.holiday_name}</Text>
                      {!!entry.note && <Text style={styles.entryNote}>{entry.note}</Text>}
                    </TouchableOpacity>
                  ))
                )
              ) : leave.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="airplane-outline" size={48} color={COLORS.border} />
                  <Text style={styles.emptyText}>{t('absences.noLeave')}</Text>
                </View>
              ) : (
                leave.map((entry) => (
                  <TouchableOpacity key={entry.id} style={styles.entryCard} onPress={() => deleteLeave(entry)}>
                    <View style={styles.entryRow}>
                      <Text style={styles.entryEmployee}>{entry.employee_name}</Text>
                      <View style={[styles.leaveTypeBadge, entry.leave_type === 'sick' && styles.leaveTypeBadgeSick, entry.leave_type === 'unpaid' && styles.leaveTypeBadgeUnpaid]}>
                        <Text style={styles.leaveTypeBadgeText}>{LEAVE_TYPES.find((l) => l.value === entry.leave_type)?.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.entryHolidayName}>
                      {format(new Date(`${entry.start_date}T00:00:00`), 'd MMM yyyy', { locale: dateLocale })}
                      {entry.start_date !== entry.end_date ? ` - ${format(new Date(`${entry.end_date}T00:00:00`), 'd MMM yyyy', { locale: dateLocale })}` : ''}
                    </Text>
                    {!!entry.note && <Text style={styles.entryNote}>{entry.note}</Text>}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          )}

          <TouchableOpacity
            style={styles.fab}
            onPress={viewMode === 'holiday' ? openHolidayModal : openLeaveModal}
            accessibilityLabel={t('absences.addEntry')}
          >
            <Ionicons name="add" size={28} color="white" />
          </TouchableOpacity>
        </SafeAreaView>
      </View>

      {/* Add holiday-work modal */}
      <Modal visible={holidayModalVisible} animationType="fade" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('absences.addHolidayWork')}</Text>
              <TouchableOpacity onPress={() => setHolidayModalVisible(false)}>
                <Ionicons name="close" size={26} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.fieldLabel}>{t('absences.employee')}</Text>
              <View style={styles.chipWrap}>
                {employees.map((emp) => (
                  <TouchableOpacity
                    key={emp.id}
                    style={[styles.chip, holidayEmployeeId === emp.id && styles.chipActive]}
                    onPress={() => setHolidayEmployeeId(emp.id)}
                  >
                    <Text style={[styles.chipText, holidayEmployeeId === emp.id && styles.chipTextActive]}>{emp.name}</Text>
                  </TouchableOpacity>
                ))}
                {employees.length === 0 && <Text style={styles.emptyHint}>{t('absences.noEmployees')}</Text>}
              </View>

              <Text style={styles.fieldLabel}>{t('absences.holiday')}</Text>
              <View style={styles.holidayList}>
                {holidays.map((h) => (
                  <TouchableOpacity
                    key={h.date}
                    style={[styles.holidayRow, holidayDate === h.date && styles.holidayRowActive]}
                    onPress={() => setHolidayDate(h.date)}
                  >
                    <Text style={[styles.holidayRowDate, holidayDate === h.date && styles.holidayRowTextActive]}>
                      {format(new Date(`${h.date}T00:00:00`), 'd MMM', { locale: dateLocale })}
                    </Text>
                    <Text style={[styles.holidayRowName, holidayDate === h.date && styles.holidayRowTextActive]} numberOfLines={2}>{h.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>{t('absences.note')}</Text>
              <TextInput
                style={styles.textInput}
                placeholder={t('absences.notePlaceholder')}
                placeholderTextColor={COLORS.textMuted}
                value={holidayNote}
                onChangeText={setHolidayNote}
              />
            </ScrollView>
            <TouchableOpacity style={styles.saveButton} onPress={saveHolidayWork} disabled={savingHoliday}>
              {savingHoliday ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add leave modal */}
      <Modal visible={leaveModalVisible} animationType="fade" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('absences.addLeave')}</Text>
              <TouchableOpacity onPress={() => setLeaveModalVisible(false)}>
                <Ionicons name="close" size={26} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.fieldLabel}>{t('absences.employee')}</Text>
              <View style={styles.chipWrap}>
                {employees.map((emp) => (
                  <TouchableOpacity
                    key={emp.id}
                    style={[styles.chip, leaveEmployeeId === emp.id && styles.chipActive]}
                    onPress={() => setLeaveEmployeeId(emp.id)}
                  >
                    <Text style={[styles.chipText, leaveEmployeeId === emp.id && styles.chipTextActive]}>{emp.name}</Text>
                  </TouchableOpacity>
                ))}
                {employees.length === 0 && <Text style={styles.emptyHint}>{t('absences.noEmployees')}</Text>}
              </View>

              <Text style={styles.fieldLabel}>{t('absences.leaveType')}</Text>
              <View style={styles.chipWrap}>
                {LEAVE_TYPES.map((lt) => (
                  <TouchableOpacity
                    key={lt.value}
                    style={[styles.chip, leaveType === lt.value && styles.chipActive]}
                    onPress={() => setLeaveType(lt.value)}
                  >
                    <Text style={[styles.chipText, leaveType === lt.value && styles.chipTextActive]}>{lt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('absences.startDate')}</Text>
                  <TouchableOpacity style={styles.dateInputButton} onPress={() => setLeaveStartPickerVisible(true)}>
                    <Ionicons name="calendar" size={16} color={COLORS.primary} />
                    <Text style={styles.dateInputText}>{format(leaveStart, 'd MMM yyyy', { locale: dateLocale })}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('absences.endDate')}</Text>
                  <TouchableOpacity style={styles.dateInputButton} onPress={() => setLeaveEndPickerVisible(true)}>
                    <Ionicons name="calendar" size={16} color={COLORS.primary} />
                    <Text style={styles.dateInputText}>{format(leaveEnd, 'd MMM yyyy', { locale: dateLocale })}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <DateTimePickerModal
                isVisible={leaveStartPickerVisible}
                mode="date"
                date={leaveStart}
                onConfirm={(d) => { setLeaveStart(d); setLeaveStartPickerVisible(false); }}
                onCancel={() => setLeaveStartPickerVisible(false)}
                confirmTextIOS={t('common.select')}
                cancelTextIOS={t('common.cancel')}
                locale={language}
              />
              <DateTimePickerModal
                isVisible={leaveEndPickerVisible}
                mode="date"
                date={leaveEnd}
                onConfirm={(d) => { setLeaveEnd(d); setLeaveEndPickerVisible(false); }}
                onCancel={() => setLeaveEndPickerVisible(false)}
                confirmTextIOS={t('common.select')}
                cancelTextIOS={t('common.cancel')}
                locale={language}
              />

              <Text style={styles.fieldLabel}>{t('absences.note')}</Text>
              <TextInput
                style={styles.textInput}
                placeholder={t('absences.notePlaceholder')}
                placeholderTextColor={COLORS.textMuted}
                value={leaveNote}
                onChangeText={setLeaveNote}
              />
            </ScrollView>
            <TouchableOpacity style={styles.saveButton} onPress={saveLeave} disabled={savingLeave}>
              {savingLeave ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Export modal */}
      <Modal visible={exportModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('absences.export')}</Text>
              <TouchableOpacity onPress={() => setExportModalVisible(false)}>
                <Ionicons name="close" size={26} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>{t('absences.exportHint')}</Text>
            <View style={styles.dateRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>{t('absences.startDate')}</Text>
                <TouchableOpacity style={styles.dateInputButton} onPress={() => setExportStartPickerVisible(true)}>
                  <Ionicons name="calendar" size={16} color={COLORS.primary} />
                  <Text style={styles.dateInputText}>{format(exportStart, 'd MMM yyyy', { locale: dateLocale })}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>{t('absences.endDate')}</Text>
                <TouchableOpacity style={styles.dateInputButton} onPress={() => setExportEndPickerVisible(true)}>
                  <Ionicons name="calendar" size={16} color={COLORS.primary} />
                  <Text style={styles.dateInputText}>{format(exportEnd, 'd MMM yyyy', { locale: dateLocale })}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <DateTimePickerModal
              isVisible={exportStartPickerVisible}
              mode="date"
              date={exportStart}
              onConfirm={(d) => { setExportStart(d); setExportStartPickerVisible(false); }}
              onCancel={() => setExportStartPickerVisible(false)}
              confirmTextIOS={t('common.select')}
              cancelTextIOS={t('common.cancel')}
              locale={language}
            />
            <DateTimePickerModal
              isVisible={exportEndPickerVisible}
              mode="date"
              date={exportEnd}
              onConfirm={(d) => { setExportEnd(d); setExportEndPickerVisible(false); }}
              onCancel={() => setExportEndPickerVisible(false)}
              confirmTextIOS={t('common.select')}
              cancelTextIOS={t('common.cancel')}
              locale={language}
            />
            <TouchableOpacity style={styles.saveButton} onPress={runExport} disabled={exporting}>
              {exporting ? <ActivityIndicator color="white" /> : (
                <>
                  <Ionicons name="download-outline" size={18} color="white" />
                  <Text style={styles.saveButtonText}>{t('absences.exportExcel')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
    textAlign: 'center',
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 4,
    marginHorizontal: 16,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: COLORS.primary,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  modeButtonTextActive: {
    color: 'white',
  },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 14,
    marginBottom: 6,
  },
  yearArrow: {
    padding: 6,
  },
  yearText: {
    fontSize: 15,
    fontWeight: '700',
    color: 'white',
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, paddingHorizontal: 16, marginTop: 8 },
  emptyContainer: { alignItems: 'center', marginTop: 60, gap: 10 },
  emptyText: { color: COLORS.textMuted, fontSize: 14 },
  emptyHint: { color: COLORS.textMuted, fontSize: 13, paddingVertical: 8 },
  entryCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  entryEmployee: {
    color: 'white',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  entryDate: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  entryHolidayName: {
    color: COLORS.primaryLight,
    fontSize: 13,
  },
  entryNote: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  leaveTypeBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  leaveTypeBadgeSick: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  leaveTypeBadgeUnpaid: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  leaveTypeBadgeText: {
    color: COLORS.textLight,
    fontSize: 11,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
  },
  fieldLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginTop: 6,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: 'white',
  },
  holidayList: {
    marginBottom: 4,
  },
  holidayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    marginBottom: 6,
  },
  holidayRowActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  holidayRowDate: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    width: 50,
  },
  holidayRowName: {
    color: COLORS.textLight,
    fontSize: 12,
    flex: 1,
  },
  holidayRowTextActive: {
    color: 'white',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateInputButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dateInputText: {
    color: 'white',
    fontSize: 13,
  },
  textInput: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 12,
    color: 'white',
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 4,
  },
  saveButton: {
    flexDirection: 'row',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
});

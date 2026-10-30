import React, { useState, useCallback } from 'react';
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
import DateTimePickerModal from '../src/components/AppDateTimePicker';
import { format, startOfWeek, addDays, addWeeks, subWeeks } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import { ShiftOccurrence, ShiftRepeatPattern, ScheduleSummary, SchedulePayment } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet, Avatar } from '../src/components';
import { COLORS, CHART_PALETTE } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const REPEAT_PATTERNS: ShiftRepeatPattern[] = ['none', 'daily', 'weekly', 'monthly'];

function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}
function toTimeStr(d: Date): string {
  return format(d, 'HH:mm');
}
function timeToDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
// Trims a round-hour time to just the hour ("09:00" -> "9") so it fits a
// narrow grid cell; anything with minutes is shown in full ("09:30").
function compactTime(t: string): string {
  return t.endsWith(':00') ? String(parseInt(t, 10)) : t;
}
// Deterministic color per team member (from the shared chart palette) so
// the same person reads as the same color across every cell/chip in the
// grid - mirrors how a manager color-codes names on a paper schedule.
function employeeColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return CHART_PALETTE[hash % CHART_PALETTE.length];
}
function weekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

type DirectoryEntry = { user_id: string; name: string; picture: string | null };

export default function WorkScheduleScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { user, hasPermission } = useAuth();
  const canManage = hasPermission('manage_budget');

  const [loading, setLoading] = useState(true);
  const [occurrences, setOccurrences] = useState<ShiftOccurrence[]>([]);
  const [summary, setSummary] = useState<ScheduleSummary | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  // null = whole team (managers only - a plain staff member is always
  // implicitly scoped to themselves server-side regardless of this).
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formUserId, setFormUserId] = useState('');
  const [shiftDate, setShiftDate] = useState(new Date());
  const [startTime, setStartTime] = useState(new Date());
  const [endTime, setEndTime] = useState(new Date());
  const [repeatPattern, setRepeatPattern] = useState<ShiftRepeatPattern>('none');
  const [repeatUntil, setRepeatUntil] = useState(new Date(Date.now() + 30 * 86400000));
  const [hourlyRate, setHourlyRate] = useState('');
  const [note, setNote] = useState('');
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [startPickerVisible, setStartPickerVisible] = useState(false);
  const [endPickerVisible, setEndPickerVisible] = useState(false);
  const [untilPickerVisible, setUntilPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // Correcting actual hours/pay for ONE occurrence - separate from the
  // edit-series form above, since it never touches the shift template.
  const [adjustModalVisible, setAdjustModalVisible] = useState(false);
  const [adjustingOcc, setAdjustingOcc] = useState<ShiftOccurrence | null>(null);
  const [adjustHours, setAdjustHours] = useState('');
  const [adjustRate, setAdjustRate] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);

  // "Mark as paid" for the currently selected member's current month -
  // manager-only. monthStart/monthEnd are kept in state (not just local
  // to loadData) so the pay action can reuse the exact same bounds the
  // summary card was computed over.
  const [monthStart, setMonthStart] = useState('');
  const [monthEnd, setMonthEnd] = useState('');
  const [schedulePayment, setSchedulePayment] = useState<SchedulePayment | null>(null);
  const [payingBusy, setPayingBusy] = useState(false);

  // Week grid ("plug and play" view) - employees x days, color per person,
  // tap a cell to add/act on a shift instead of picking a member + date
  // from the full form every time. Managers only; list view is the
  // fallback and the only view a plain staff member ever sees.
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [gridWeekStart, setGridWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [copyModalVisible, setCopyModalVisible] = useState(false);
  const [copySource, setCopySource] = useState<ShiftOccurrence | null>(null);
  const [copyTargetDates, setCopyTargetDates] = useState<string[]>([]);
  const [copyApplying, setCopyApplying] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const now = new Date();
      const start = toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
      const end = toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60));
      const mStart = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
      const mEnd = toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      setMonthStart(mStart);
      setMonthEnd(mEnd);

      const filterUserId = canManage ? (selectedUserId || undefined) : undefined;
      const [occData, dir] = await Promise.all([
        api.getShiftOccurrences(start, end, filterUserId),
        canManage ? api.getCompanyDirectory() : Promise.resolve([]),
      ]);
      setOccurrences(occData.occurrences);
      setDirectory(dir);

      // A summary only makes sense for ONE person - skip it in the
      // manager's "whole team" view rather than add up different
      // people's hours/pay into one meaningless total.
      if (!canManage || selectedUserId) {
        setSummary(await api.getScheduleSummary(mStart, mEnd, filterUserId));
      } else {
        setSummary(null);
      }

      if (canManage && selectedUserId) {
        const { payments } = await api.getSchedulePayments(mStart, mEnd, selectedUserId);
        setSchedulePayment(payments[0] || null);
      } else {
        setSchedulePayment(null);
      }
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, selectedUserId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const resetForm = () => {
    setEditingId(null);
    setFormUserId(canManage ? (selectedUserId || '') : (user?.user_id || ''));
    setShiftDate(new Date());
    setStartTime(timeToDate('09:00'));
    setEndTime(timeToDate('17:00'));
    setRepeatPattern('none');
    setRepeatUntil(new Date(Date.now() + 30 * 86400000));
    setHourlyRate('');
    setNote('');
  };

  const openCreateModal = () => {
    resetForm();
    setModalVisible(true);
  };

  const openEditModal = (occ: ShiftOccurrence) => {
    setEditingId(occ.shift_id);
    setFormUserId(occ.user_id);
    setShiftDate(new Date(`${occ.date}T00:00:00`));
    setStartTime(timeToDate(occ.start_time));
    setEndTime(timeToDate(occ.end_time));
    setRepeatPattern(occ.repeat_pattern);
    setRepeatUntil(occ.repeat_until ? new Date(`${occ.repeat_until}T00:00:00`) : new Date(Date.now() + 30 * 86400000));
    setHourlyRate(occ.hourly_rate != null ? String(occ.hourly_rate) : '');
    setNote(occ.note || '');
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!formUserId) {
      Alert.alert(t('common.error'), t('schedule.pickMemberError'));
      return;
    }
    if (repeatPattern !== 'none' && toDateStr(repeatUntil) < toDateStr(shiftDate)) {
      Alert.alert(t('common.error'), t('schedule.repeatUntilError'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        date: toDateStr(shiftDate),
        start_time: toTimeStr(startTime),
        end_time: toTimeStr(endTime),
        repeat_pattern: repeatPattern,
        repeat_until: repeatPattern !== 'none' ? toDateStr(repeatUntil) : undefined,
        hourly_rate: hourlyRate.trim() ? parseFloat(hourlyRate) : undefined,
        note: note.trim() || undefined,
      };
      if (editingId) {
        await api.updateShift(editingId, payload);
      } else {
        await api.createShift({ user_id: formUserId, ...payload });
      }
      setModalVisible(false);
      Haptics.success();
      await loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('schedule.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (occ: ShiftOccurrence) => {
    Alert.alert(t('schedule.deleteTitle'), t('schedule.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteShift(occ.shift_id);
            await loadData();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  const openAdjustModal = (occ: ShiftOccurrence) => {
    setAdjustingOcc(occ);
    setAdjustHours(String(occ.hours));
    setAdjustRate(occ.hourly_rate != null ? String(occ.hourly_rate) : '');
    setAdjustReason('');
    setAdjustModalVisible(true);
  };

  const handleSaveAdjustment = async () => {
    if (!adjustingOcc) return;
    const hours = parseFloat(adjustHours);
    if (!hours || hours <= 0) {
      Alert.alert(t('common.error'), t('schedule.adjustHoursError'));
      return;
    }
    if (!adjustReason.trim()) {
      Alert.alert(t('common.error'), t('schedule.adjustReasonError'));
      return;
    }
    setAdjustSaving(true);
    try {
      await api.adjustShiftOccurrence(adjustingOcc.shift_id, adjustingOcc.date, {
        actual_hours: hours,
        actual_hourly_rate: adjustRate.trim() ? parseFloat(adjustRate) : undefined,
        reason: adjustReason.trim(),
      });
      setAdjustModalVisible(false);
      Haptics.success();
      await loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('schedule.adjustSaveError'));
    } finally {
      setAdjustSaving(false);
    }
  };

  const handleRemoveAdjustment = (occ: ShiftOccurrence) => {
    Alert.alert(t('schedule.revertTitle'), t('schedule.revertConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('schedule.revert'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.removeShiftAdjustment(occ.shift_id, occ.date);
            await loadData();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  const handleGridCellPress = (userId: string, dateKey: string, dayOccs: ShiftOccurrence[]) => {
    if (dayOccs.length === 0) {
      resetForm();
      setFormUserId(userId);
      setShiftDate(new Date(`${dateKey}T00:00:00`));
      setModalVisible(true);
      return;
    }
    const occ = dayOccs[0];
    Alert.alert(`${occ.user_name} · ${occ.start_time}-${occ.end_time}`, undefined, [
      { text: t('schedule.edit'), onPress: () => openEditModal(occ) },
      { text: t('schedule.adjustShort'), onPress: () => openAdjustModal(occ) },
      { text: t('schedule.copyShift'), onPress: () => openCopyModal(occ) },
      { text: t('common.delete'), style: 'destructive', onPress: () => handleDelete(occ) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const openCopyModal = (occ: ShiftOccurrence) => {
    setCopySource(occ);
    setCopyTargetDates([]);
    setCopyModalVisible(true);
  };

  const handleApplyCopy = async () => {
    if (!copySource) return;
    if (copyTargetDates.length === 0) {
      Alert.alert(t('common.error'), t('schedule.copyShiftNoneSelected'));
      return;
    }
    setCopyApplying(true);
    let ok = 0;
    let fail = 0;
    for (const dateKey of copyTargetDates) {
      try {
        await api.createShift({
          user_id: copySource.user_id,
          date: dateKey,
          start_time: copySource.start_time,
          end_time: copySource.end_time,
          repeat_pattern: 'none',
          hourly_rate: copySource.hourly_rate ?? undefined,
          note: copySource.note ?? undefined,
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setCopyApplying(false);
    setCopyModalVisible(false);
    if (ok > 0) Haptics.success();
    Alert.alert(t('schedule.copyShiftTitle'), t('schedule.copyShiftResult').replace('{ok}', String(ok)).replace('{fail}', String(fail)));
    await loadData();
  };

  const handleMarkPaid = () => {
    if (!selectedUserId || !summary) return;
    Alert.alert(t('schedule.markPaidTitle'), t('schedule.markPaidConfirm').replace('{amount}', summary.estimated_pay.toFixed(2)), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('schedule.markPaid'),
        onPress: async () => {
          setPayingBusy(true);
          try {
            const payment = await api.createSchedulePayment({
              user_id: selectedUserId, period_start: monthStart, period_end: monthEnd,
            });
            setSchedulePayment(payment);
            Haptics.success();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message || t('schedule.markPaidError'));
          } finally {
            setPayingBusy(false);
          }
        },
      },
    ]);
  };

  const handleUndoPayment = () => {
    if (!schedulePayment) return;
    Alert.alert(t('schedule.undoPaidTitle'), t('schedule.undoPaidConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setPayingBusy(true);
          try {
            await api.deleteSchedulePayment(schedulePayment.id);
            setSchedulePayment(null);
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          } finally {
            setPayingBusy(false);
          }
        },
      },
    ]);
  };

  if (!user) return <AccessDenied />;

  const grouped: [string, ShiftOccurrence[]][] = Object.entries(
    occurrences.reduce((acc, occ) => {
      (acc[occ.date] = acc[occ.date] || []).push(occ);
      return acc;
    }, {} as Record<string, ShiftOccurrence[]>)
  ).sort(([a], [b]) => a.localeCompare(b));

  const occurrencesByUserDate: Record<string, Record<string, ShiftOccurrence[]>> = {};
  occurrences.forEach((occ) => {
    if (!occurrencesByUserDate[occ.user_id]) occurrencesByUserDate[occ.user_id] = {};
    (occurrencesByUserDate[occ.user_id][occ.date] = occurrencesByUserDate[occ.user_id][occ.date] || []).push(occ);
  });
  const gridDays = weekDates(gridWeekStart);
  const gridEmployees = selectedUserId ? directory.filter((d) => d.user_id === selectedUserId) : directory;
  const showGrid = canManage && viewMode === 'grid';

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('schedule.title')}</Text>
            {canManage ? (
              <TouchableOpacity onPress={openCreateModal} style={styles.backButton}>
                <Ionicons name="add" size={24} color="white" />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 40 }} />
            )}
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 32 }}>
              {canManage && (
                <View style={styles.viewToggleRow}>
                  <TouchableOpacity
                    style={[styles.viewToggleBtn, viewMode === 'grid' && styles.viewToggleBtnActive]}
                    onPress={() => setViewMode('grid')}
                  >
                    <Ionicons name="grid-outline" size={15} color={viewMode === 'grid' ? 'white' : COLORS.textSecondary} />
                    <Text style={[styles.viewToggleText, viewMode === 'grid' && styles.viewToggleTextActive]}>{t('schedule.viewGrid')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.viewToggleBtn, viewMode === 'list' && styles.viewToggleBtnActive]}
                    onPress={() => setViewMode('list')}
                  >
                    <Ionicons name="list-outline" size={15} color={viewMode === 'list' ? 'white' : COLORS.textSecondary} />
                    <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>{t('schedule.viewList')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {canManage && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, !selectedUserId && styles.chipActive]}
                      onPress={() => setSelectedUserId(null)}
                    >
                      <Text style={[styles.chipText, !selectedUserId && styles.chipTextActive]}>{t('schedule.wholeTeam')}</Text>
                    </TouchableOpacity>
                    {directory.map((d) => (
                      <TouchableOpacity
                        key={d.user_id}
                        style={[styles.chip, selectedUserId === d.user_id && styles.chipActive]}
                        onPress={() => setSelectedUserId(d.user_id)}
                      >
                        <Text style={[styles.chipText, selectedUserId === d.user_id && styles.chipTextActive]}>{d.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}

              {summary && (
                <View style={styles.summaryCard}>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{summary.total_hours}</Text>
                    <Text style={styles.summaryLabel}>{t('schedule.hoursThisMonth')}</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{summary.estimated_pay.toFixed(2)} €</Text>
                    <Text style={styles.summaryLabel}>{t('schedule.estimatedPay')}</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryValue}>{summary.shift_count}</Text>
                    <Text style={styles.summaryLabel}>{t('schedule.shiftsThisMonth')}</Text>
                  </View>
                </View>
              )}

              {canManage && selectedUserId && summary && summary.estimated_pay > 0 && (
                schedulePayment ? (
                  <View style={styles.paidCard}>
                    <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
                    <Text style={styles.paidText}>
                      {t('schedule.paidLabel')
                        .replace('{amount}', schedulePayment.amount.toFixed(2))
                        .replace('{date}', format(new Date(schedulePayment.created_at), 'd MMM yyyy', { locale: dateLocale }))}
                    </Text>
                    <TouchableOpacity onPress={handleUndoPayment} disabled={payingBusy} hitSlop={8}>
                      <Text style={styles.revertLink}>{t('schedule.undoPaid')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.markPaidButton} onPress={handleMarkPaid} disabled={payingBusy}>
                    {payingBusy ? (
                      <ActivityIndicator color="white" size="small" />
                    ) : (
                      <>
                        <Ionicons name="cash-outline" size={18} color="white" />
                        <Text style={styles.markPaidButtonText}>{t('schedule.markPaid')}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )
              )}

              {showGrid ? (
                <View style={styles.gridWrap}>
                  <View style={styles.weekNav}>
                    <TouchableOpacity onPress={() => setGridWeekStart(subWeeks(gridWeekStart, 1))} hitSlop={8}>
                      <Ionicons name="chevron-back" size={20} color={COLORS.primaryLight} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setGridWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
                      <Text style={styles.weekNavLabel}>
                        {format(gridDays[0], 'd MMM', { locale: dateLocale })} - {format(gridDays[6], 'd MMM', { locale: dateLocale })}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setGridWeekStart(addWeeks(gridWeekStart, 1))} hitSlop={8}>
                      <Ionicons name="chevron-forward" size={20} color={COLORS.primaryLight} />
                    </TouchableOpacity>
                  </View>

                  {gridEmployees.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <Ionicons name="people-outline" size={64} color={COLORS.border} />
                      <Text style={styles.emptyText}>{t('schedule.gridEmptyTeam')}</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.gridHint}>{t('schedule.gridTapHint')}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                          <View style={styles.gridRow}>
                            <View style={styles.gridLabelCell} />
                            {gridDays.map((d) => (
                              <View key={toDateStr(d)} style={styles.gridDayHeaderCell}>
                                <Text style={styles.gridDayHeaderText}>{format(d, 'EEE', { locale: dateLocale })}</Text>
                                <Text style={styles.gridDayHeaderDate}>{format(d, 'd.MM')}</Text>
                              </View>
                            ))}
                          </View>
                          {gridEmployees.map((emp) => {
                            const color = employeeColor(emp.user_id);
                            return (
                              <View key={emp.user_id} style={styles.gridRow}>
                                <View style={styles.gridLabelCell}>
                                  <View style={[styles.gridColorDot, { backgroundColor: color }]} />
                                  <Avatar uri={emp.picture} name={emp.name} size={20} />
                                  <Text style={styles.gridLabelText} numberOfLines={1}>{emp.name}</Text>
                                </View>
                                {gridDays.map((d) => {
                                  const dateKey = toDateStr(d);
                                  const dayOccs = occurrencesByUserDate[emp.user_id]?.[dateKey] || [];
                                  return (
                                    <TouchableOpacity
                                      key={dateKey}
                                      style={styles.gridCell}
                                      onPress={() => handleGridCellPress(emp.user_id, dateKey, dayOccs)}
                                    >
                                      {dayOccs.length === 0 ? (
                                        <Ionicons name="add" size={14} color={COLORS.textMuted} />
                                      ) : (
                                        dayOccs.map((occ) => (
                                          <View
                                            key={occ.shift_id}
                                            style={[styles.gridShiftChip, { backgroundColor: `${color}33`, borderColor: color }]}
                                          >
                                            <Text style={[styles.gridShiftChipText, { color }]} numberOfLines={1}>
                                              {compactTime(occ.start_time)}-{compactTime(occ.end_time)}
                                            </Text>
                                            <View style={styles.gridChipIcons}>
                                              {occ.leave_conflict && <View style={styles.gridConflictDot} />}
                                              {occ.adjusted && <Ionicons name="calculator" size={8} color={COLORS.warning} />}
                                            </View>
                                          </View>
                                        ))
                                      )}
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            );
                          })}
                        </View>
                      </ScrollView>
                    </>
                  )}
                </View>
              ) : (
                <>
              {grouped.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Ionicons name="calendar-outline" size={64} color={COLORS.border} />
                  <Text style={styles.emptyText}>{t('schedule.noShifts')}</Text>
                </View>
              )}

              {grouped.map(([dateKey, dayOccs]) => (
                <View key={dateKey} style={styles.dayGroup}>
                  <Text style={styles.dayHeader}>
                    {format(new Date(`${dateKey}T00:00:00`), 'EEEE, d MMMM yyyy', { locale: dateLocale })}
                  </Text>
                  {dayOccs.map((occ) => (
                    <View key={`${occ.shift_id}-${occ.date}`} style={styles.shiftCard}>
                      <View style={styles.shiftRow}>
                        <View style={styles.shiftTimeBlock}>
                          <Ionicons name="time-outline" size={16} color={COLORS.primary} />
                          <Text style={styles.shiftTime}>{occ.start_time} - {occ.end_time}</Text>
                          {occ.adjusted ? (
                            <>
                              <Text style={styles.shiftHoursStrike}>{occ.scheduled_hours}ч</Text>
                              <Text style={styles.shiftHoursAdjusted}>→ {occ.hours}ч</Text>
                            </>
                          ) : (
                            <Text style={styles.shiftHours}>({occ.hours}ч)</Text>
                          )}
                        </View>
                        {canManage && (
                          <View style={styles.shiftActions}>
                            <TouchableOpacity onPress={() => openAdjustModal(occ)} hitSlop={8}>
                              <Ionicons name="calculator-outline" size={18} color={COLORS.warning} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => openCopyModal(occ)} hitSlop={8}>
                              <Ionicons name="copy-outline" size={18} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => openEditModal(occ)} hitSlop={8}>
                              <Ionicons name="create-outline" size={18} color={COLORS.primary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDelete(occ)} hitSlop={8}>
                              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>

                      {(canManage && !selectedUserId) && (
                        <View style={styles.shiftMemberRow}>
                          <Avatar uri={directory.find((d) => d.user_id === occ.user_id)?.picture} name={occ.user_name} size={18} />
                          <Text style={styles.shiftMemberName}>{occ.user_name}</Text>
                        </View>
                      )}

                      <View style={styles.shiftFooter}>
                        {occ.repeat_pattern !== 'none' && (
                          <Text style={styles.shiftBadge}>{t(`schedule.repeat_${occ.repeat_pattern}`)}</Text>
                        )}
                        {occ.hourly_rate != null && (
                          <Text style={styles.shiftMeta}>{occ.hourly_rate.toFixed(2)} €/ч</Text>
                        )}
                      </View>
                      {occ.note ? <Text style={styles.shiftNote}>{occ.note}</Text> : null}
                      {occ.leave_conflict && (
                        <View style={styles.conflictRow}>
                          <Ionicons name="alert-circle" size={14} color={COLORS.danger} />
                          <Text style={styles.conflictText}>{t('schedule.leaveConflict')}</Text>
                        </View>
                      )}
                      {occ.adjusted && (
                        <View style={styles.adjustedRow}>
                          <Ionicons name="calculator-outline" size={14} color={COLORS.warning} />
                          <Text style={styles.adjustedText}>
                            {t('schedule.adjustedBy').replace('{name}', occ.adjusted_by_name || '?')}
                            {occ.adjustment_reason ? `: ${occ.adjustment_reason}` : ''}
                          </Text>
                          {canManage && (
                            <TouchableOpacity onPress={() => handleRemoveAdjustment(occ)} hitSlop={8}>
                              <Text style={styles.revertLink}>{t('schedule.revert')}</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              ))}
                </>
              )}
            </ScrollView>
          )}

          <BottomSheet visible={modalVisible} onClose={() => setModalVisible(false)}>
            <View style={styles.modalContent}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>
                  {editingId ? t('schedule.editShift') : t('schedule.newShift')}
                </Text>

                {canManage && (
                  <>
                    <Text style={styles.inputLabel}>{t('schedule.member')}</Text>
                    {editingId ? (
                      <Text style={styles.pickerButtonText}>
                        {directory.find((d) => d.user_id === formUserId)?.name || formUserId}
                      </Text>
                    ) : (
                      <View style={styles.chipRow}>
                        {directory.map((d) => (
                          <TouchableOpacity
                            key={d.user_id}
                            style={[styles.chip, formUserId === d.user_id && styles.chipActive]}
                            onPress={() => setFormUserId(d.user_id)}
                          >
                            <Text style={[styles.chipText, formUserId === d.user_id && styles.chipTextActive]}>{d.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </>
                )}

                <Text style={styles.inputLabel}>{t('schedule.date')}</Text>
                <TouchableOpacity style={styles.pickerButton} onPress={() => setDatePickerVisible(true)}>
                  <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.pickerButtonText}>{format(shiftDate, 'd MMM yyyy', { locale: dateLocale })}</Text>
                </TouchableOpacity>

                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>{t('schedule.startTime')}</Text>
                    <TouchableOpacity style={styles.pickerButton} onPress={() => setStartPickerVisible(true)}>
                      <Ionicons name="time-outline" size={18} color={COLORS.primary} />
                      <Text style={styles.pickerButtonText}>{toTimeStr(startTime)}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>{t('schedule.endTime')}</Text>
                    <TouchableOpacity style={styles.pickerButton} onPress={() => setEndPickerVisible(true)}>
                      <Ionicons name="time-outline" size={18} color={COLORS.primary} />
                      <Text style={styles.pickerButtonText}>{toTimeStr(endTime)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.inputLabel}>{t('schedule.repeat')}</Text>
                <View style={styles.chipRow}>
                  {REPEAT_PATTERNS.map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.chip, repeatPattern === p && styles.chipActive]}
                      onPress={() => setRepeatPattern(p)}
                    >
                      <Text style={[styles.chipText, repeatPattern === p && styles.chipTextActive]}>{t(`schedule.repeat_${p}`)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {repeatPattern !== 'none' && (
                  <>
                    <Text style={styles.inputLabel}>{t('schedule.repeatUntil')}</Text>
                    <TouchableOpacity style={styles.pickerButton} onPress={() => setUntilPickerVisible(true)}>
                      <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
                      <Text style={styles.pickerButtonText}>{format(repeatUntil, 'd MMM yyyy', { locale: dateLocale })}</Text>
                    </TouchableOpacity>
                    {editingId && <Text style={styles.hint}>{t('schedule.editAffectsSeries')}</Text>}
                  </>
                )}

                <Text style={styles.inputLabel}>{t('schedule.hourlyRate')}</Text>
                <TextInput
                  style={styles.input}
                  value={hourlyRate}
                  onChangeText={setHourlyRate}
                  placeholder={t('schedule.hourlyRatePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="decimal-pad"
                />

                <Text style={styles.inputLabel}>{t('schedule.note')}</Text>
                <TextInput
                  style={[styles.input, { height: 60 }]}
                  value={note}
                  onChangeText={setNote}
                  placeholder={t('schedule.notePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                />

                <TouchableOpacity
                  style={[styles.saveButton, saving && { opacity: 0.6 }]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setModalVisible(false)}>
                  <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </BottomSheet>

          <BottomSheet visible={adjustModalVisible} onClose={() => setAdjustModalVisible(false)}>
            <View style={styles.modalContent}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{t('schedule.adjustTitle')}</Text>
                {adjustingOcc && (
                  <Text style={styles.hint}>
                    {format(new Date(`${adjustingOcc.date}T00:00:00`), 'd MMM yyyy', { locale: dateLocale })} · {adjustingOcc.user_name} · {t('schedule.scheduled')}: {adjustingOcc.scheduled_hours}ч
                  </Text>
                )}

                <Text style={styles.inputLabel}>{t('schedule.actualHours')}</Text>
                <TextInput
                  style={styles.input}
                  value={adjustHours}
                  onChangeText={setAdjustHours}
                  keyboardType="decimal-pad"
                  placeholder={t('schedule.hourlyRatePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                />

                <Text style={styles.inputLabel}>{t('schedule.actualRate')}</Text>
                <TextInput
                  style={styles.input}
                  value={adjustRate}
                  onChangeText={setAdjustRate}
                  keyboardType="decimal-pad"
                  placeholder={t('schedule.hourlyRatePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                />

                <Text style={styles.inputLabel}>{t('schedule.adjustReason')}</Text>
                <TextInput
                  style={[styles.input, { height: 70 }]}
                  value={adjustReason}
                  onChangeText={setAdjustReason}
                  placeholder={t('schedule.adjustReasonPlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                />

                <TouchableOpacity
                  style={[styles.saveButton, adjustSaving && { opacity: 0.6 }]}
                  onPress={handleSaveAdjustment}
                  disabled={adjustSaving}
                >
                  {adjustSaving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setAdjustModalVisible(false)}>
                  <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </BottomSheet>

          <BottomSheet visible={copyModalVisible} onClose={() => setCopyModalVisible(false)}>
            <View style={styles.modalContent}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{t('schedule.copyShiftTitle')}</Text>
                {copySource && (
                  <Text style={styles.hint}>
                    {copySource.user_name} · {copySource.start_time}-{copySource.end_time}
                  </Text>
                )}
                <Text style={[styles.inputLabel, { marginTop: 12 }]}>{t('schedule.copyShiftHint')}</Text>
                <View style={styles.chipRow}>
                  {copySource &&
                    weekDates(startOfWeek(new Date(`${copySource.date}T00:00:00`), { weekStartsOn: 1 }))
                      .filter((d) => toDateStr(d) !== copySource.date)
                      .map((d) => {
                        const dateKey = toDateStr(d);
                        const active = copyTargetDates.includes(dateKey);
                        return (
                          <TouchableOpacity
                            key={dateKey}
                            style={[styles.chip, active && styles.chipActive]}
                            onPress={() =>
                              setCopyTargetDates((prev) =>
                                active ? prev.filter((x) => x !== dateKey) : [...prev, dateKey]
                              )
                            }
                          >
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>
                              {format(d, 'EEE d', { locale: dateLocale })}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                </View>

                <TouchableOpacity
                  style={[styles.saveButton, copyApplying && { opacity: 0.6 }]}
                  onPress={handleApplyCopy}
                  disabled={copyApplying}
                >
                  {copyApplying ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('schedule.copyShiftApply')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setCopyModalVisible(false)}>
                  <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </BottomSheet>

          <DateTimePickerModal
            isVisible={datePickerVisible}
            mode="date"
            date={shiftDate}
            onConfirm={(d) => { setShiftDate(d); setDatePickerVisible(false); }}
            onCancel={() => setDatePickerVisible(false)}
          />
          <DateTimePickerModal
            isVisible={startPickerVisible}
            mode="time"
            date={startTime}
            onConfirm={(d) => { setStartTime(d); setStartPickerVisible(false); }}
            onCancel={() => setStartPickerVisible(false)}
          />
          <DateTimePickerModal
            isVisible={endPickerVisible}
            mode="time"
            date={endTime}
            onConfirm={(d) => { setEndTime(d); setEndPickerVisible(false); }}
            onCancel={() => setEndPickerVisible(false)}
          />
          <DateTimePickerModal
            isVisible={untilPickerVisible}
            mode="date"
            date={repeatUntil}
            onConfirm={(d) => { setRepeatUntil(d); setUntilPickerVisible(false); }}
            onCancel={() => setUntilPickerVisible(false)}
          />
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
  content: { flex: 1, padding: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, color: COLORS.textMuted, marginTop: 16 },
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    justifyContent: 'space-around',
  },
  summaryItem: { alignItems: 'center' },
  summaryValue: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  summaryLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2, textAlign: 'center' },
  markPaidButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  markPaidButtonText: { color: 'white', fontWeight: 'bold', fontSize: 15 },
  paidCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  paidText: { flex: 1, fontSize: 12, color: COLORS.textSecondary },
  viewToggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  viewToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
  },
  viewToggleBtnActive: { backgroundColor: COLORS.primary },
  viewToggleText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  viewToggleTextActive: { color: 'white' },
  gridWrap: { marginBottom: 16 },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 10,
  },
  weekNavLabel: { fontSize: 14, fontWeight: '700', color: 'white', textTransform: 'capitalize' },
  gridHint: { fontSize: 11, color: COLORS.textMuted, marginBottom: 8 },
  gridRow: { flexDirection: 'row' },
  gridLabelCell: {
    width: 96,
    paddingVertical: 6,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gridColorDot: { width: 6, height: 6, borderRadius: 3 },
  gridLabelText: { fontSize: 11, color: COLORS.textSubtle, flexShrink: 1 },
  gridDayHeaderCell: { width: 56, alignItems: 'center', paddingBottom: 8 },
  gridDayHeaderText: { fontSize: 11, fontWeight: '700', color: COLORS.primaryLight, textTransform: 'capitalize' },
  gridDayHeaderDate: { fontSize: 10, color: COLORS.textMuted, marginTop: 1 },
  gridCell: {
    width: 56,
    minHeight: 44,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    marginRight: 2,
    marginBottom: 2,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  gridShiftChip: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  gridShiftChipText: { fontSize: 10, fontWeight: '700' },
  gridChipIcons: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 },
  gridConflictDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: COLORS.danger },
  dayGroup: { marginBottom: 18 },
  dayHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primaryLight,
    textTransform: 'capitalize',
    marginBottom: 8,
  },
  shiftCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  shiftRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shiftTimeBlock: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shiftTime: { fontSize: 15, fontWeight: '600', color: 'white' },
  shiftHours: { fontSize: 12, color: COLORS.textMuted },
  shiftHoursStrike: { fontSize: 12, color: COLORS.textMuted, textDecorationLine: 'line-through' },
  shiftHoursAdjusted: { fontSize: 12, color: COLORS.warning, fontWeight: '700' },
  shiftActions: { flexDirection: 'row', gap: 14 },
  shiftMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  shiftMemberName: { fontSize: 13, color: COLORS.textSecondary },
  shiftFooter: { flexDirection: 'row', gap: 10, marginTop: 8 },
  shiftBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  shiftMeta: { fontSize: 12, color: COLORS.textMuted, alignSelf: 'center' },
  shiftNote: { fontSize: 12, color: COLORS.textSecondary, marginTop: 6, fontStyle: 'italic' },
  conflictRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  conflictText: { fontSize: 12, color: COLORS.danger, fontWeight: '600' },
  adjustedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  adjustedText: { fontSize: 12, color: COLORS.warning, flexShrink: 1 },
  revertLink: { fontSize: 12, color: COLORS.primary, fontWeight: '600', textDecorationLine: 'underline' },
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
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerButtonText: { color: 'white', fontSize: 14 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.background,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '500' },
  chipTextActive: { color: 'white' },
  hint: { fontSize: 11, color: COLORS.textMuted, marginTop: 6 },
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

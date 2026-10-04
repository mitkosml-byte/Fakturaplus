import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Calendar, DateData } from 'react-native-calendars';
import { format } from 'date-fns';
import { Alert } from '../utils/alert';
import { Toast } from '../utils/toast';
import { Haptics } from '../utils/haptics';
import { api } from '../services/api';
import { ClosedDateException } from '../types';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';

// Python date.weekday() convention (0=Monday..6=Sunday) - matches the
// backend's Company.closed_weekdays exactly, so this array can be sent
// straight through with no translation.
const WEEKDAYS: { value: number; short: string }[] = [
  { value: 0, short: 'Пон' },
  { value: 1, short: 'Вт' },
  { value: 2, short: 'Ср' },
  { value: 3, short: 'Чет' },
  { value: 4, short: 'Пет' },
  { value: 5, short: 'Съб' },
  { value: 6, short: 'Нед' },
];

// JS Date.getDay() is Sunday=0..Saturday=6 - convert to the Python
// convention above before checking membership in closedWeekdays.
function jsDayToWeekday(jsDay: number): number {
  return (jsDay + 6) % 7;
}

const CALENDAR_THEME = {
  backgroundColor: 'transparent',
  calendarBackground: 'transparent',
  textSectionTitleColor: COLORS.textMuted,
  dayTextColor: COLORS.textLight,
  textDisabledColor: COLORS.border,
  monthTextColor: 'white',
  arrowColor: COLORS.primary,
  todayTextColor: COLORS.primary,
  selectedDayBackgroundColor: COLORS.primary,
};

interface ClosedDaysCalendarProps {
  // When true, the whole widget starts collapsed behind a tappable header
  // and the weekly-pattern/exceptions calendar only render once expanded -
  // used on the Home dashboard so it doesn't dominate the screen by default.
  // The dedicated /closed-days screen renders it always-expanded instead.
  collapsible?: boolean;
}

export function ClosedDaysCalendar({ collapsible = false }: ClosedDaysCalendarProps) {
  const { t } = useTranslation();

  const [expanded, setExpanded] = useState(!collapsible);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closedWeekdays, setClosedWeekdays] = useState<number[]>([]);
  const [exceptions, setExceptions] = useState<ClosedDateException[]>([]);

  const [dayModalVisible, setDayModalVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');

  const load = useCallback(async () => {
    try {
      const [company, exceptionsList] = await Promise.all([
        api.getCompany(),
        api.getClosedDateExceptions(),
      ]);
      setClosedWeekdays(company?.closed_weekdays || []);
      setExceptions(exceptionsList);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleWeekday = (value: number) => {
    setClosedWeekdays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value].sort((a, b) => a - b)
    );
  };

  const saveWeeklyPattern = async () => {
    setSaving(true);
    try {
      await api.updateCompany({ closed_weekdays: closedWeekdays });
      Haptics.success();
      Toast.success(t('closedDays.weeklySaved'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const exceptionsByDate = useMemo(() => {
    const map = new Map<string, ClosedDateException>();
    for (const e of exceptions) map.set(e.date, e);
    return map;
  }, [exceptions]);

  // Marks a rolling ~14-month window (6 back, 8 forward) so paging the
  // calendar a reasonable distance in either direction still looks right,
  // without having to track exactly which months are on screen.
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};
    const start = new Date();
    start.setMonth(start.getMonth() - 6);
    start.setDate(1);
    const end = new Date();
    end.setMonth(end.getMonth() + 8);
    const d = new Date(start);
    while (d <= end) {
      const dateStr = format(d, 'yyyy-MM-dd');
      const exception = exceptionsByDate.get(dateStr);
      if (exception) {
        marks[dateStr] = {
          customStyles: {
            container: { backgroundColor: exception.closed ? COLORS.danger : COLORS.success, borderRadius: 8 },
            text: { color: 'white', fontWeight: '700' },
          },
        };
      } else if (closedWeekdays.includes(jsDayToWeekday(d.getDay()))) {
        marks[dateStr] = {
          customStyles: {
            container: { backgroundColor: COLORS.border, borderRadius: 8 },
            text: { color: COLORS.textSecondary },
          },
        };
      }
      d.setDate(d.getDate() + 1);
    }
    return marks;
  }, [closedWeekdays, exceptionsByDate]);

  const openDayModal = (dateStr: string) => {
    setSelectedDate(dateStr);
    setLabelInput(exceptionsByDate.get(dateStr)?.label || '');
    setDayModalVisible(true);
  };

  const selectedException = selectedDate ? exceptionsByDate.get(selectedDate) : undefined;
  const selectedIsDefaultClosed = selectedDate
    ? closedWeekdays.includes(jsDayToWeekday(new Date(`${selectedDate}T00:00:00`).getDay()))
    : false;

  const handleSetException = async (closed: boolean) => {
    if (!selectedDate) return;
    setSaving(true);
    try {
      const updated = await api.upsertClosedDateException({
        date: selectedDate,
        closed,
        label: labelInput.trim() || undefined,
      });
      setExceptions((prev) => [...prev.filter((e) => e.date !== selectedDate), updated]);
      setDayModalVisible(false);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveException = async () => {
    if (!selectedDate) return;
    setSaving(true);
    try {
      await api.deleteClosedDateException(selectedDate);
      setExceptions((prev) => prev.filter((e) => e.date !== selectedDate));
      setDayModalVisible(false);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      {collapsible && (
        <TouchableOpacity style={styles.collapsibleHeader} onPress={() => setExpanded((prev) => !prev)}>
          <Ionicons name="calendar-outline" size={20} color={COLORS.primary} />
          <Text style={styles.collapsibleHeaderTitle}>{t('closedDays.title')}</Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.primary} />
        </TouchableOpacity>
      )}

      {collapsible && (
        <Text style={styles.homeHint}>{t('closedDays.homeHint')}</Text>
      )}

      {expanded && (
        loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <>
            <View style={[styles.section, collapsible && styles.sectionCompact]}>
              <Text style={styles.sectionTitle}>{t('closedDays.weeklyTitle')}</Text>
              <Text style={styles.sectionHint}>{t('closedDays.weeklyHint')}</Text>
              <View style={styles.weekdayRow}>
                {WEEKDAYS.map((w) => {
                  const active = closedWeekdays.includes(w.value);
                  return (
                    <TouchableOpacity
                      key={w.value}
                      style={[styles.weekdayChip, active && styles.weekdayChipActive]}
                      onPress={() => toggleWeekday(w.value)}
                    >
                      <Text style={[styles.weekdayChipText, active && styles.weekdayChipTextActive]}>
                        {w.short}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity style={styles.saveButton} onPress={saveWeeklyPattern} disabled={saving}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
              </TouchableOpacity>
            </View>

            <View style={[styles.section, collapsible && styles.sectionCompact]}>
              <Text style={styles.sectionTitle}>{t('closedDays.exceptionsTitle')}</Text>
              <Text style={styles.sectionHint}>{t('closedDays.exceptionsHint')}</Text>
              <View style={styles.calendarWrapper}>
                <Calendar
                  markingType="custom"
                  markedDates={markedDates}
                  onDayPress={(day: DateData) => openDayModal(day.dateString)}
                  theme={CALENDAR_THEME as any}
                />
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.border }]} />
                  <Text style={styles.legendText}>{t('closedDays.legendWeekly')}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.danger }]} />
                  <Text style={styles.legendText}>{t('closedDays.legendClosed')}</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: COLORS.success }]} />
                  <Text style={styles.legendText}>{t('closedDays.legendOpen')}</Text>
                </View>
              </View>
            </View>
          </>
        )
      )}

      <Modal visible={dayModalVisible} animationType="fade" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDate ? format(new Date(`${selectedDate}T00:00:00`), 'd MMMM yyyy') : ''}
              </Text>
              <TouchableOpacity onPress={() => setDayModalVisible(false)}>
                <Ionicons name="close" size={26} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalStatusText}>
              {selectedException
                ? selectedException.closed
                  ? t('closedDays.statusExceptionClosed')
                  : t('closedDays.statusExceptionOpen')
                : selectedIsDefaultClosed
                ? t('closedDays.statusDefaultClosed')
                : t('closedDays.statusDefaultOpen')}
            </Text>

            <TextInput
              style={styles.labelInput}
              placeholder={t('closedDays.labelPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              value={labelInput}
              onChangeText={setLabelInput}
            />

            <TouchableOpacity
              style={[styles.modalActionButton, styles.modalActionClosed]}
              onPress={() => handleSetException(true)}
              disabled={saving}
            >
              <Ionicons name="lock-closed" size={18} color="white" />
              <Text style={styles.modalActionText}>{t('closedDays.markClosed')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalActionButton, styles.modalActionOpen]}
              onPress={() => handleSetException(false)}
              disabled={saving}
            >
              <Ionicons name="lock-open" size={18} color="white" />
              <Text style={styles.modalActionText}>{t('closedDays.markOpen')}</Text>
            </TouchableOpacity>

            {!!selectedException && (
              <TouchableOpacity style={styles.modalRemoveButton} onPress={handleRemoveException} disabled={saving}>
                <Text style={styles.modalRemoveText}>{t('closedDays.removeException')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
  },
  collapsibleHeaderTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: 'white',
  },
  homeHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  loadingContainer: { paddingVertical: 30, alignItems: 'center' },
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionCompact: {
    marginTop: 8,
    marginBottom: 0,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 14,
    lineHeight: 18,
  },
  weekdayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  weekdayChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  weekdayChipActive: {
    backgroundColor: COLORS.danger,
    borderColor: COLORS.danger,
  },
  weekdayChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  weekdayChipTextActive: {
    color: 'white',
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  calendarWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: COLORS.textSecondary,
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
  modalStatusText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 14,
  },
  labelInput: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    color: 'white',
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  modalActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  modalActionClosed: {
    backgroundColor: COLORS.danger,
  },
  modalActionOpen: {
    backgroundColor: COLORS.success,
  },
  modalActionText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  modalRemoveButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  modalRemoveText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
});

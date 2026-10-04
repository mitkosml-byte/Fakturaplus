import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  format,
  startOfWeek,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  differenceInCalendarMonths,
  differenceInCalendarYears,
} from 'date-fns';
import DateTimePickerModal from './AppDateTimePicker';
import { useTranslation } from '../i18n';
import {
  PeriodMode,
  PeriodState,
  getPeriodBounds,
  formatPeriodLabel,
} from '../utils/periodRange';
import { COLORS } from '../theme/colors';
import { ChipTabs } from './ChipTabs';

interface PeriodNavigatorProps {
  state: PeriodState;
  onChange: (next: PeriodState) => void;
}

const MODES: PeriodMode[] = ['day', 'week', 'month', 'year', 'range'];

// Reusable period picker for any screen that shows totals "for a period" -
// lets the user step back to any past day/week/month/year, or pick an
// arbitrary custom range, instead of being stuck on whatever a screen
// defaults to. Used by both the Home dashboard and the Stats overview cards
// so a user isn't confused by the dashboard resetting to zero on the 1st of
// a new month with no way to see where last month's numbers went.
export function PeriodNavigator({ state, onChange }: PeriodNavigatorProps) {
  const { t, dateLocale, language } = useTranslation();
  const [pickerOpenFor, setPickerOpenFor] = useState<'start' | 'end' | null>(null);
  const [isJumpPickerVisible, setJumpPickerVisible] = useState(false);

  const bounds = getPeriodBounds(state);
  const label = formatPeriodLabel(state, bounds, dateLocale);

  const modeLabel = (m: PeriodMode) =>
    m === 'day' ? t('periodNav.day')
    : m === 'week' ? t('periodNav.week')
    : m === 'month' ? t('periodNav.month')
    : m === 'year' ? t('periodNav.year')
    : t('periodNav.range');

  const selectMode = (mode: PeriodMode) => {
    if (mode === state.mode) return;
    if (mode === 'range') {
      onChange({ mode, offset: 0, rangeStart: bounds.start, rangeEnd: bounds.end });
    } else {
      onChange({ mode, offset: 0 });
    }
  };

  const goPrev = () => onChange({ ...state, offset: state.offset + 1 });
  const goNext = () => onChange({ ...state, offset: Math.max(0, state.offset - 1) });
  const goToday = () => onChange({ ...state, offset: 0 });

  // Lets a far-back period be reached in one tap + one date pick instead of
  // stepping the arrows one day/week/month/year at a time - picking any date
  // inside the target day/week/month/year jumps straight to it.
  const jumpToDate = (picked: Date) => {
    const now = new Date();
    let offset = 0;
    switch (state.mode) {
      case 'day':
        offset = differenceInCalendarDays(now, picked);
        break;
      case 'week':
        offset = differenceInCalendarWeeks(
          startOfWeek(now, { weekStartsOn: 1 }),
          startOfWeek(picked, { weekStartsOn: 1 }),
          { weekStartsOn: 1 }
        );
        break;
      case 'year':
        offset = differenceInCalendarYears(now, picked);
        break;
      case 'month':
      default:
        offset = differenceInCalendarMonths(now, picked);
        break;
    }
    onChange({ ...state, offset: Math.max(0, offset) });
    setJumpPickerVisible(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.modeRow}>
        <ChipTabs
          active={state.mode}
          onChange={selectMode}
          options={MODES.map((m) => ({ key: m, label: modeLabel(m) }))}
        />
      </View>

      {state.mode === 'range' ? (
        <View style={styles.rangeRow}>
          <TouchableOpacity style={styles.rangeDateButton} onPress={() => setPickerOpenFor('start')}>
            <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
            <Text style={styles.rangeDateText}>
              {state.rangeStart ? format(state.rangeStart, 'd MMM yyyy', { locale: dateLocale }) : '-'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.rangeDash}>-</Text>
          <TouchableOpacity style={styles.rangeDateButton} onPress={() => setPickerOpenFor('end')}>
            <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
            <Text style={styles.rangeDateText}>
              {state.rangeEnd ? format(state.rangeEnd, 'd MMM yyyy', { locale: dateLocale }) : '-'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navButton} onPress={goPrev} accessibilityLabel={t('periodNav.previous')}>
            <Ionicons name="chevron-back" size={20} color={COLORS.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.labelWrap}
            onPress={() => setJumpPickerVisible(true)}
            accessibilityLabel={t('periodNav.jumpToPeriod')}
          >
            <View style={styles.labelRow}>
              <Text style={styles.label}>{label}</Text>
              <Ionicons name="chevron-down" size={14} color={COLORS.textMuted} />
            </View>
            {state.offset > 0 && (
              <TouchableOpacity onPress={goToday}>
                <Text style={styles.todayLink}>{t('periodNav.backToCurrent')}</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navButton}
            onPress={goNext}
            disabled={state.offset === 0}
            accessibilityLabel={t('periodNav.next')}
          >
            <Ionicons name="chevron-forward" size={20} color={state.offset === 0 ? COLORS.border : COLORS.primary} />
          </TouchableOpacity>
        </View>
      )}

      <DateTimePickerModal
        isVisible={isJumpPickerVisible}
        mode="date"
        date={bounds.start}
        maximumDate={new Date()}
        onConfirm={jumpToDate}
        onCancel={() => setJumpPickerVisible(false)}
        confirmTextIOS={t('common.select')}
        cancelTextIOS={t('common.cancel')}
        locale={language}
      />
      <DateTimePickerModal
        isVisible={pickerOpenFor === 'start'}
        mode="date"
        date={state.rangeStart || new Date()}
        maximumDate={state.rangeEnd || new Date()}
        onConfirm={(date) => {
          onChange({ ...state, mode: 'range', rangeStart: date });
          setPickerOpenFor(null);
        }}
        onCancel={() => setPickerOpenFor(null)}
        confirmTextIOS={t('common.select')}
        cancelTextIOS={t('common.cancel')}
        locale={language}
      />
      <DateTimePickerModal
        isVisible={pickerOpenFor === 'end'}
        mode="date"
        date={state.rangeEnd || new Date()}
        minimumDate={state.rangeStart}
        maximumDate={new Date()}
        onConfirm={(date) => {
          onChange({ ...state, mode: 'range', rangeEnd: date });
          setPickerOpenFor(null);
        }}
        onCancel={() => setPickerOpenFor(null)}
        confirmTextIOS={t('common.select')}
        cancelTextIOS={t('common.cancel')}
        locale={language}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 8,
    marginBottom: 16,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 8,
  },
  modeChip: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  modeChipActive: {
    backgroundColor: COLORS.primary,
  },
  modeChipText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  modeChipTextActive: {
    color: 'white',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navButton: {
    padding: 8,
  },
  labelWrap: {
    flex: 1,
    alignItems: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  todayLink: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rangeDateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.background,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  rangeDateText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  rangeDash: {
    color: COLORS.textMuted,
  },
});

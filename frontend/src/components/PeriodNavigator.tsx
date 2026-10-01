import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { useTranslation } from '../i18n';
import {
  PeriodMode,
  PeriodState,
  getPeriodBounds,
  formatPeriodLabel,
} from '../utils/periodRange';

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

  return (
    <View style={styles.container}>
      <View style={styles.modeRow}>
        {MODES.map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.modeChip, state.mode === m && styles.modeChipActive]}
            onPress={() => selectMode(m)}
          >
            <Text style={[styles.modeChipText, state.mode === m && styles.modeChipTextActive]}>
              {modeLabel(m)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {state.mode === 'range' ? (
        <View style={styles.rangeRow}>
          <TouchableOpacity style={styles.rangeDateButton} onPress={() => setPickerOpenFor('start')}>
            <Ionicons name="calendar-outline" size={16} color="#8B5CF6" />
            <Text style={styles.rangeDateText}>
              {state.rangeStart ? format(state.rangeStart, 'd MMM yyyy', { locale: dateLocale }) : '-'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.rangeDash}>-</Text>
          <TouchableOpacity style={styles.rangeDateButton} onPress={() => setPickerOpenFor('end')}>
            <Ionicons name="calendar-outline" size={16} color="#8B5CF6" />
            <Text style={styles.rangeDateText}>
              {state.rangeEnd ? format(state.rangeEnd, 'd MMM yyyy', { locale: dateLocale }) : '-'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.navRow}>
          <TouchableOpacity style={styles.navButton} onPress={goPrev} accessibilityLabel={t('periodNav.previous')}>
            <Ionicons name="chevron-back" size={20} color="#8B5CF6" />
          </TouchableOpacity>

          <View style={styles.labelWrap}>
            <Text style={styles.label}>{label}</Text>
            {state.offset > 0 && (
              <TouchableOpacity onPress={goToday}>
                <Text style={styles.todayLink}>{t('periodNav.backToCurrent')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={styles.navButton}
            onPress={goNext}
            disabled={state.offset === 0}
            accessibilityLabel={t('periodNav.next')}
          >
            <Ionicons name="chevron-forward" size={20} color={state.offset === 0 ? '#334155' : '#8B5CF6'} />
          </TouchableOpacity>
        </View>
      )}

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
    backgroundColor: '#1E293B',
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
    backgroundColor: '#8B5CF6',
  },
  modeChipText: {
    color: '#64748B',
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
  label: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  todayLink: {
    color: '#8B5CF6',
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
    backgroundColor: '#0F172A',
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
    color: '#64748B',
  },
});

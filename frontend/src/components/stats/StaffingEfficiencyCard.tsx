import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { StaffingEfficiencyStat, StaffingRebalanceSuggestion } from '../../types';
import { COLORS } from '../../theme/colors';

// Module: cross-data-source insight #1 - revenue per scheduled labor-hour
// by weekday (get_staffing_efficiency), combining Work Schedule's own
// hours with the same revenue-by-weekday pattern WeekdayRevenueCard
// shows - neither data source says anything about this on its own.
type Props = {
  weekdays: StaffingEfficiencyStat[];
  suggestion: StaffingRebalanceSuggestion | null;
};

export function StaffingEfficiencyCard({ weekdays, suggestion }: Props) {
  const { t } = useTranslation();
  if (weekdays.length === 0) return null;

  const maxEfficiency = Math.max(...weekdays.map((w) => w.revenue_per_labor_hour), 1);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="people-outline" size={24} color={COLORS.success} />
        <Text style={styles.title}>{t('stats.staffingEfficiencyTitle')}</Text>
      </View>

      <View style={{ gap: 8 }}>
        {weekdays.map((w) => {
          const isOverstaffed = suggestion?.overstaffed_weekday === w.weekday;
          const isUnderstaffed = suggestion?.understaffed_weekday === w.weekday;
          return (
            <View key={w.weekday} style={styles.row}>
              <Text style={styles.dayLabel}>{t(`weekday.${w.weekday}`)}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.max((w.revenue_per_labor_hour / maxEfficiency) * 100, 4)}%`,
                      backgroundColor: isOverstaffed
                        ? COLORS.danger
                        : isUnderstaffed
                        ? COLORS.success
                        : COLORS.info,
                    },
                  ]}
                />
              </View>
              <Text style={styles.valueLabel}>{w.revenue_per_labor_hour.toFixed(0)} €/ч</Text>
            </View>
          );
        })}
      </View>

      {suggestion && (
        <View style={styles.suggestionBox}>
          <Ionicons name="bulb-outline" size={16} color={COLORS.success} />
          <Text style={styles.suggestionText}>
            {t('stats.staffingRebalanceSuggestion')
              .replace(/\{overDay\}/g, t(`weekday.${suggestion.overstaffed_weekday}`))
              .replace(/\{underDay\}/g, t(`weekday.${suggestion.understaffed_weekday}`))
              .replace('{overPercent}', String(suggestion.overstaffed_percent_of_average))
              .replace('{underPercent}', String(suggestion.understaffed_percent_of_average))
              .replace('{hours}', String(suggestion.suggested_hours_to_move))}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.success,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayLabel: {
    width: 86,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  valueLabel: {
    width: 62,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  suggestionBox: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  suggestionText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
  },
});

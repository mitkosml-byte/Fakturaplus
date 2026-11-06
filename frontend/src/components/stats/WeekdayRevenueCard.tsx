import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { WeekdayRevenueStat, WeakDaySuggestion } from '../../types';
import { COLORS } from '../../theme/colors';

// Module: cross-data-source insight #2 - average revenue per weekday,
// bucketed from daily_revenue alone (get_weekday_revenue_pattern), with a
// highlighted suggestion when one weekday consistently underperforms the
// rest of an otherwise-open week. Generic for any business that logs
// daily revenue - no item or schedule data involved.
type Props = {
  weekdays: WeekdayRevenueStat[];
  suggestion: WeakDaySuggestion | null;
};

export function WeekdayRevenueCard({ weekdays, suggestion }: Props) {
  const { t } = useTranslation();
  if (weekdays.length === 0) return null;

  const maxRevenue = Math.max(...weekdays.map((w) => w.avg_revenue), 1);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="calendar-outline" size={24} color={COLORS.primary} />
        <Text style={styles.title}>{t('stats.weekdayRevenueTitle')}</Text>
      </View>

      <View style={{ gap: 8 }}>
        {weekdays.map((w) => (
          <View key={w.weekday} style={styles.row}>
            <Text style={styles.dayLabel}>{t(`weekday.${w.weekday}`)}</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.max((w.avg_revenue / maxRevenue) * 100, 4)}%`,
                    backgroundColor: suggestion?.weekday === w.weekday ? COLORS.warning : COLORS.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.valueLabel}>{w.avg_revenue.toFixed(0)} €</Text>
          </View>
        ))}
      </View>

      {suggestion && (
        <View style={styles.suggestionBox}>
          <Ionicons name="bulb-outline" size={16} color={COLORS.warning} />
          <Text style={styles.suggestionText}>
            {t('stats.weakDaySuggestion')
              .replace('{day}', t(`weekday.${suggestion.weekday}`))
              .replace('{avg}', suggestion.avg_revenue.toFixed(0))
              .replace('{overall}', suggestion.overall_avg_revenue.toFixed(0))
              .replace('{percent}', String(suggestion.percent_below_average))}
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
    borderLeftColor: COLORS.primary,
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
    color: COLORS.primary,
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
    width: 56,
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

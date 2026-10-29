import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';

// Extracted from stats.tsx (Module 1 audit finding #4). Renders the
// revenue/expense forecast pair plus the lookback-range picker (Module 4
// Finding #1's fix for the old hardcoded 6-month window) - pure
// presentation, the forecast data itself is still fetched/held in
// stats.tsx.
const RANGE_OPTIONS = [
  { days: 30, labelKey: 'stats.forecastRange1m' },
  { days: 90, labelKey: 'stats.forecastRange3m' },
  { days: 180, labelKey: 'stats.forecastRange6m' },
  { days: 365, labelKey: 'stats.forecastRange12m' },
] as const;

type Props = {
  revenueForecast: any;
  expenseForecast: any;
  forecastRangeDays: number;
  onChangeRangeDays: (days: number) => void;
};

export function ForecastCard({ revenueForecast, expenseForecast, forecastRangeDays, onChangeRangeDays }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.forecastSection}>
      <View style={styles.chartHeader}>
        <Ionicons name="analytics" size={22} color={COLORS.primary} />
        <Text style={styles.chartTitle}>{t('stats.forecastTitle')}</Text>
      </View>

      <View style={styles.rankingSelector}>
        {RANGE_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.days}
            style={[styles.rankingButton, forecastRangeDays === opt.days && styles.rankingButtonActive]}
            onPress={() => onChangeRangeDays(opt.days)}
          >
            <Text style={[styles.rankingButtonText, forecastRangeDays === opt.days && styles.rankingButtonTextActive]}>
              {t(opt.labelKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.forecastHint}>
        {t(
          forecastRangeDays === 30 ? 'stats.forecastHint1m'
            : forecastRangeDays === 90 ? 'stats.forecastHint3m'
            : forecastRangeDays === 365 ? 'stats.forecastHint12m'
            : 'stats.forecastHint6m'
        )}
      </Text>
      <View style={styles.forecastRow}>
        {revenueForecast?.forecast?.[0] && (
          <View style={styles.forecastCard}>
            {revenueForecast.trend === 'insufficient_data' ? (
              <>
                <Ionicons name="hourglass-outline" size={20} color={COLORS.textMuted} />
                <Text style={styles.forecastLabel}>{t('stats.forecastAverageOnly')} · {t('stats.forecastRevenue')}</Text>
                <Text style={[styles.forecastValue, { color: COLORS.textMuted }]}>
                  {revenueForecast.avg_monthly.toFixed(0)} €
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="trending-up" size={20} color={COLORS.success} />
                <Text style={styles.forecastLabel}>{t('stats.forecastRevenue')}</Text>
                <Text style={[styles.forecastValue, { color: COLORS.success }]}>
                  {revenueForecast.forecast[0].predicted_amount.toFixed(0)} €
                </Text>
                <Text style={styles.forecastTrend}>
                  {revenueForecast.trend === 'increasing' ? '📈' : revenueForecast.trend === 'decreasing' ? '📉' : '➖'}
                  {' '}{revenueForecast.trend_percent > 0 ? '+' : ''}{revenueForecast.trend_percent}%
                </Text>
              </>
            )}
          </View>
        )}
        {expenseForecast?.forecast?.[0] && (
          <View style={styles.forecastCard}>
            {expenseForecast.trend === 'insufficient_data' ? (
              <>
                <Ionicons name="hourglass-outline" size={20} color={COLORS.textMuted} />
                <Text style={styles.forecastLabel}>{t('stats.forecastAverageOnly')} · {t('stats.forecastExpense')}</Text>
                <Text style={[styles.forecastValue, { color: COLORS.textMuted }]}>
                  {expenseForecast.avg_monthly.toFixed(0)} €
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="trending-down" size={20} color={COLORS.danger} />
                <Text style={styles.forecastLabel}>{t('stats.forecastExpense')}</Text>
                <Text style={[styles.forecastValue, { color: COLORS.danger }]}>
                  {expenseForecast.forecast[0].predicted_amount.toFixed(0)} €
                </Text>
                <Text style={styles.forecastTrend}>
                  {expenseForecast.trend === 'increasing' ? '📈' : expenseForecast.trend === 'decreasing' ? '📉' : '➖'}
                  {' '}{expenseForecast.trend_percent > 0 ? '+' : ''}{expenseForecast.trend_percent}%
                </Text>
              </>
            )}
          </View>
        )}
      </View>

      {(revenueForecast?.trend === 'insufficient_data' || expenseForecast?.trend === 'insufficient_data') && (
        <Text style={styles.forecastHint}>{t('stats.forecastInsufficientData')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  forecastSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  rankingSelector: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 4,
  },
  rankingButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  rankingButtonActive: {
    backgroundColor: COLORS.primary,
  },
  rankingButtonText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  rankingButtonTextActive: {
    color: 'white',
  },
  forecastHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: -4,
    marginBottom: 12,
  },
  forecastRow: {
    flexDirection: 'row',
    gap: 12,
  },
  forecastCard: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  forecastLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  forecastValue: {
    fontSize: 17,
    fontWeight: 'bold',
    marginTop: 4,
  },
  forecastTrend: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
});

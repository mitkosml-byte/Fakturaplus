import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import { InfoButton } from '../InfoButton';
import { formatMoney } from '../../utils/money';

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

// The next month read from the same month last year (the company's own
// months follow a yearly rhythm - see the backend's year-back reading).
const isYearBack = (forecast: any) => forecast?.method === 'year_back';
// Only the average is known: under 4 months of history, and not read from
// last year either.
const isAverageOnly = (forecast: any) => forecast?.trend === 'insufficient_data' && !isYearBack(forecast);
// The month in progress joined the revenue history as its expected end.
const includesCurrentMonth = (forecast: any) => !!forecast?.historical?.some((h: any) => h.estimated);

export function ForecastCard({ revenueForecast, expenseForecast, forecastRangeDays, onChangeRangeDays }: Props) {
  const { t } = useTranslation();
  // The month in progress: what is in so far and where it is heading - the
  // revenue at its average per entered day, the expenses at their pace so
  // far plus the month's payroll and depreciation.
  const revenueNow = revenueForecast?.current_month ?? null;
  const expenseNow = expenseForecast?.current_month ?? null;

  // Against the same months last year for a yearly-rhythm forecast - a
  // turn its rhythm explains is not a trend - else the window's trend.
  const trendLine = (forecast: any) => {
    if (isYearBack(forecast) && forecast.vs_last_year_percent != null) {
      return `${forecast.vs_last_year_percent > 0 ? '+' : ''}${forecast.vs_last_year_percent}% ${t('stats.vsLastYear')}`;
    }
    const icon = forecast.trend === 'increasing' ? '📈' : forecast.trend === 'decreasing' ? '📉' : '➖';
    return `${icon} ${forecast.trend_percent > 0 ? '+' : ''}${forecast.trend_percent}%`;
  };

  // How the forecast was worked out - behind the "i" (Л10).
  const notes = [
    includesCurrentMonth(revenueForecast) ? t('stats.forecastWithCurrentMonth') : '',
    expenseNow?.payroll_from_last_month ? t('stats.forecastPayrollFromLastMonth') : '',
    isYearBack(revenueForecast) || isYearBack(expenseForecast)
      ? t(isYearBack(revenueForecast) && isYearBack(expenseForecast) ? 'stats.forecastYearBackBoth'
        : isYearBack(revenueForecast) ? 'stats.forecastYearBackRevenue' : 'stats.forecastYearBackExpense')
      : '',
    isAverageOnly(revenueForecast) || isAverageOnly(expenseForecast) ? t('stats.forecastInsufficientData') : '',
  ];

  return (
    <View style={styles.forecastSection}>
      <View style={styles.chartHeader}>
        <Ionicons name="analytics" size={22} color={COLORS.primary} />
        <Text style={styles.chartTitle}>{t('stats.forecastTitle')}</Text>
        <InfoButton title={t('stats.forecastTitle')} lines={notes} style={{ marginLeft: 'auto' }} />
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
      {(revenueNow || expenseNow) && (
        <View style={styles.currentMonthBox}>
          <Text style={styles.currentMonthTitle}>{t('stats.forecastThisMonth')}</Text>
          <View style={styles.forecastRow}>
            {revenueNow && (
              <View style={styles.currentMonthCell}>
                <Text style={styles.forecastLabel}>{t('stats.income')}</Text>
                <Text style={[styles.currentMonthValue, { color: COLORS.success }]}>{formatMoney(revenueNow.so_far)}</Text>
                {revenueNow.expected !== null && revenueNow.expected !== undefined && (
                  <Text style={styles.forecastTrend}>
                    {t('stats.forecastExpectedEnd').replace('{amount}', `${formatMoney(revenueNow.expected)}`)}
                  </Text>
                )}
              </View>
            )}
            {expenseNow && (
              <View style={styles.currentMonthCell}>
                <Text style={styles.forecastLabel}>{t('home.totalExpenses')}</Text>
                <Text style={[styles.currentMonthValue, { color: COLORS.danger }]}>{formatMoney(expenseNow.so_far)}</Text>
                {expenseNow.expected !== null && expenseNow.expected !== undefined && (
                  <Text style={styles.forecastTrend}>
                    {t('stats.forecastAtThisPace').replace('{amount}', `${formatMoney(expenseNow.expected)}`)}
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>
      )}

      <View style={styles.forecastRow}>
        {revenueForecast?.forecast?.[0] && (
          <View style={styles.forecastCard}>
            {isAverageOnly(revenueForecast) ? (
              <>
                <Ionicons name="hourglass-outline" size={20} color={COLORS.textMuted} />
                <Text style={styles.forecastLabel}>{t('stats.forecastAverageOnly')} · {t('stats.forecastRevenue')}</Text>
                <Text style={[styles.forecastValue, { color: COLORS.textMuted }]}>
                  {formatMoney(revenueForecast.avg_monthly)}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="trending-up" size={20} color={COLORS.success} />
                <Text style={styles.forecastLabel}>{t('stats.forecastRevenue')}</Text>
                <Text style={[styles.forecastValue, { color: COLORS.success }]}>
                  {formatMoney(revenueForecast.forecast[0].predicted_amount)}
                </Text>
                <Text style={styles.forecastTrend}>{trendLine(revenueForecast)}</Text>
              </>
            )}
          </View>
        )}
        {expenseForecast?.forecast?.[0] && (
          <View style={styles.forecastCard}>
            {isAverageOnly(expenseForecast) ? (
              <>
                <Ionicons name="hourglass-outline" size={20} color={COLORS.textMuted} />
                <Text style={styles.forecastLabel}>{t('stats.forecastAverageOnly')} · {t('stats.forecastExpense')}</Text>
                <Text style={[styles.forecastValue, { color: COLORS.textMuted }]}>
                  {formatMoney(expenseForecast.avg_monthly)}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="trending-down" size={20} color={COLORS.danger} />
                <Text style={styles.forecastLabel}>{t('stats.forecastExpense')}</Text>
                <Text style={[styles.forecastValue, { color: COLORS.danger }]}>
                  {formatMoney(expenseForecast.forecast[0].predicted_amount)}
                </Text>
                <Text style={styles.forecastTrend}>{trendLine(expenseForecast)}</Text>
              </>
            )}
          </View>
        )}
      </View>

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
  currentMonthBox: {
    marginBottom: 12,
  },
  currentMonthTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  currentMonthCell: {
    flex: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  currentMonthValue: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 4,
  },
  forecastCard: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  forecastLabel: {
    fontSize: 12,
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

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';

// Extracted from stats.tsx (Module 1 audit finding #4). Weighted purchase-
// price inflation over a chosen period - pure presentation, the data
// itself is still fetched/held in stats.tsx.
type Props = {
  inflationData: any;
  inflationPeriod: 'month' | 'quarter' | 'year';
  onChangePeriod: (period: 'month' | 'quarter' | 'year') => void;
  loadingInflation: boolean;
  inflationExpanded: boolean;
  onToggleExpanded: () => void;
};

export function PriceInflationCard({
  inflationData, inflationPeriod, onChangePeriod, loadingInflation, inflationExpanded, onToggleExpanded,
}: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.inflationCard}>
      <View style={styles.priceAlertsHeader}>
        <Ionicons name="analytics" size={24} color={COLORS.warning} />
        <Text style={styles.inflationTitle}>{t('stats.priceInflation')}</Text>
      </View>

      <View style={styles.rankingSelector}>
        {(['month', 'quarter', 'year'] as const).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.rankingButton, inflationPeriod === p && styles.rankingButtonActive]}
            onPress={() => onChangePeriod(p)}
          >
            <Text style={[styles.rankingButtonText, inflationPeriod === p && styles.rankingButtonTextActive]}>
              {t(`stats.inflationPeriod.${p}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loadingInflation ? (
        <ActivityIndicator size="small" color={COLORS.warning} style={{ marginVertical: 16 }} />
      ) : inflationData && inflationData.items_compared > 0 ? (
        <>
          <View style={styles.inflationHeadline}>
            <Text style={[
              styles.inflationHeadlineValue,
              { color: inflationData.overall_change_percent > 0 ? COLORS.danger : inflationData.overall_change_percent < 0 ? COLORS.success : COLORS.textSecondary }
            ]}>
              {inflationData.overall_change_percent > 0 ? '+' : ''}{inflationData.overall_change_percent}%
            </Text>
            <Text style={styles.inflationHeadlineLabel}>
              {t('stats.inflationHeadline')} ({inflationData.items_compared} {t('stats.inflationItemsCompared')})
            </Text>
          </View>

          <TouchableOpacity style={styles.inflationToggle} onPress={onToggleExpanded}>
            <Text style={styles.inflationToggleText}>
              {inflationExpanded ? t('stats.inflationHideDetails') : t('stats.inflationShowDetails')}
            </Text>
            <Ionicons name={inflationExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.warning} />
          </TouchableOpacity>

          {inflationExpanded && inflationData.items.map((item: any) => (
            <View key={item.item_name} style={styles.alertItem}>
              <View style={styles.alertInfo}>
                <Text style={styles.alertItemName} numberOfLines={1}>{item.item_name}</Text>
                <Text style={styles.alertSupplier}>{item.supplier} • {item.purchase_count}x</Text>
                <View style={styles.alertPrices}>
                  <Text style={styles.alertOldPrice}>{item.start_price.toFixed(2)}€</Text>
                  <Ionicons name="arrow-forward" size={14} color={COLORS.textMuted} />
                  <Text style={[styles.alertNewPrice, { color: item.change_percent >= 0 ? COLORS.danger : COLORS.success }]}>
                    {item.end_price.toFixed(2)}€
                  </Text>
                  <View style={[styles.alertChangeBadge, { backgroundColor: item.change_percent >= 0 ? '#EF444420' : '#10B98120' }]}>
                    <Text style={[styles.alertChangeText, { color: item.change_percent >= 0 ? COLORS.danger : COLORS.success }]}>
                      {item.change_percent > 0 ? '+' : ''}{item.change_percent}%
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </>
      ) : (
        <Text style={styles.inflationNoData}>{t('stats.inflationNoData')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inflationCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warning,
  },
  priceAlertsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  inflationTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.warning,
    flex: 1,
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
  inflationHeadline: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  inflationHeadlineValue: {
    fontSize: 36,
    fontWeight: 'bold',
  },
  inflationHeadlineLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  inflationToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  inflationToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.warning,
  },
  inflationNoData: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 16,
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  alertInfo: {
    flex: 1,
  },
  alertItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  alertSupplier: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  alertPrices: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  alertOldPrice: {
    fontSize: 12,
    color: COLORS.textMuted,
    textDecorationLine: 'line-through',
  },
  alertNewPrice: {
    fontSize: 13,
    fontWeight: 'bold',
    color: COLORS.danger,
  },
  alertChangeBadge: {
    backgroundColor: '#EF444420',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  alertChangeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.danger,
  },
});

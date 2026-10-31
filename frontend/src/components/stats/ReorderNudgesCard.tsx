import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';

// Extracted from stats.tsx (Module 1 audit finding #4). A pattern in
// purchase timing noticed from data already captured by scanning, not
// inventory/stock tracking - see the reorder-nudges endpoint's own
// docstring.
type Nudge = {
  item_name: string;
  supplier: string;
  median_days_between: number;
  days_since_last: number;
  avg_order_value: number;
};

type Props = {
  nudges: Nudge[];
};

export function ReorderNudgesCard({ nudges }: Props) {
  const { t } = useTranslation();
  if (nudges.length === 0) return null;

  return (
    <View style={styles.inflationCard}>
      <View style={styles.priceAlertsHeader}>
        <Ionicons name="repeat" size={24} color={COLORS.warning} />
        <Text style={styles.inflationTitle}>{t('stats.reorderNudgesTitle')}</Text>
      </View>
      <View style={{ gap: 8 }}>
        {nudges.map((n, idx) => (
          <Text key={idx} style={styles.forecastHint}>
            {t('stats.reorderNudgeLine')
              .replace('{item}', n.item_name)
              .replace('{supplier}', n.supplier)
              .replace('{median}', String(n.median_days_between))
              .replace('{value}', n.avg_order_value.toFixed(0))
              .replace('{daysSince}', String(n.days_since_last))}
          </Text>
        ))}
      </View>
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
  forecastHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: -4,
    marginBottom: 12,
  },
});

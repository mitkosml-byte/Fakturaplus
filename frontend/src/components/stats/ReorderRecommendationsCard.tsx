import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { ReorderItem } from '../../types';
import { COLORS } from '../../theme/colors';

// A standing ordering assistant, not an alert - every recurring item
// with an established cadence (whether or not it's currently overdue,
// unlike ReorderNudgesCard/get_reorder_nudges above it), each with a
// recommended order quantity for its next cycle. See
// get_reorder_recommendations's own docstring for the trend-adjustment
// maths - entirely generic, no item or business is special-cased.
type Props = {
  items: ReorderItem[];
};

export function ReorderRecommendationsCard({ items }: Props) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="cart" size={24} color={COLORS.info} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('stats.reorderRecommendationsTitle')}</Text>
          <Text style={styles.subtitle}>{t('stats.reorderRecommendationsSubtitle')}</Text>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {items.map((n, idx) => (
          <View key={idx} style={styles.row}>
            <Text style={styles.rowText}>
              {t('stats.reorderRecommendationLine')
                .replace('{item}', n.item_name)
                .replace('{supplier}', n.supplier)
                .replace('{quantity}', String(n.recommended_quantity))
                .replace('{unit}', n.unit)
                .replace('{median}', String(n.median_days_between))
                .replace('{daysSince}', String(n.days_since_last))}
            </Text>
          </View>
        ))}
      </View>
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
    borderLeftColor: COLORS.info,
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
    color: COLORS.info,
  },
  subtitle: {
    fontSize: 11.5,
    color: COLORS.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  row: {
    paddingVertical: 2,
  },
  rowText: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
});

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import { formatMoney } from '../../utils/money';

// Under "Оборот (фискален + бакшиш)" on Home: the fiscal revenue alone and
// the tips, each with its share of that revenue - a bar and a percentage.
// 10 000 € of revenue of which 3 000 € tips: tips 30%, fiscal 70%. Shown
// only to whoever sees both (the caller passes them only then), and only
// when there were tips in the period - without them the revenue is the
// fiscal one and the bar would say nothing.

type Props = {
  fiscal: number;
  tips: number;
};

// Whole percentages that add up to 100; a part that is there but under
// half a percent reads "<1%", not "0%".
export function revenueShares(fiscal: number, tips: number): { fiscal: string; tips: string } | null {
  const total = fiscal + tips;
  if (!(total > 0) || !(tips > 0)) return null;
  const tipsWhole = Math.round((tips / total) * 100);
  const fiscalWhole = 100 - tipsWhole;
  const text = (whole: number, amount: number) => {
    if (whole === 0 && amount > 0) return '<1%';
    if (whole === 100 && amount < total) return '>99%';
    return `${whole}%`;
  };
  return { fiscal: text(fiscalWhole, fiscal), tips: text(tipsWhole, tips) };
}

export function RevenueSplit({ fiscal, tips }: Props) {
  const { t } = useTranslation();
  const shares = revenueShares(fiscal, tips);
  if (!shares) return null;
  const parts = [
    { key: 'fiscal', label: t('home.fiscalRevenue'), share: shares.fiscal, amount: fiscal, color: COLORS.primary },
    { key: 'tips', label: t('home.pocket'), share: shares.tips, amount: tips, color: COLORS.warning },
  ];
  return (
    <View style={styles.wrap} accessibilityLabel={t('home.revenueShares')}>
      <View style={styles.bar}>
        {parts.map((part) => (
          part.amount > 0 ? <View key={part.key} style={{ flex: part.amount, backgroundColor: part.color }} /> : null
        ))}
      </View>
      {parts.map((part) => (
        <View key={part.key} style={styles.line}>
          <View style={[styles.swatch, { backgroundColor: part.color }]} />
          <Text style={styles.label} numberOfLines={2}>{part.label}</Text>
          <Text style={[styles.share, { color: part.color }]}>{part.share}</Text>
          <Text style={styles.amount}>{formatMoney(part.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 10,
    gap: 6,
  },
  bar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: COLORS.border,
    marginBottom: 2,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  share: {
    minWidth: 40,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '700',
  },
  amount: {
    minWidth: 92,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
  },
});

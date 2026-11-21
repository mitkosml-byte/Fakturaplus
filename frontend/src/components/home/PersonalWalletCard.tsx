import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import { formatMoney } from '../../utils/money';
import type { PersonalWalletSummary } from '../../types';

const STATUS_COLORS: Record<PersonalWalletSummary['status'], string> = {
  ok: COLORS.success,
  warning: COLORS.warning,
  danger: COLORS.danger,
};

const STATUS_KEYS: Record<PersonalWalletSummary['status'], string> = {
  ok: 'wallet.statusOk',
  warning: 'wallet.statusWarning',
  danger: 'wallet.statusDanger',
};

type Props = {
  // The notebook's month, from Home's one request.
  summary: PersonalWalletSummary;
  // Whoever may write in the notebook gets "Добави разход".
  canAdd: boolean;
};

// The personal notebook on Home, under the main numbers: what was taken
// this month, what is still safe to take, and one tap to write a new entry
// or open the notebook. Only for whoever may see the notebook.
export function PersonalWalletCard({ summary, canAdd }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const color = STATUS_COLORS[summary.status] || COLORS.textSecondary;
  const open = () => router.push({ pathname: '/personal-expenses', params: { tab: 'wallet' } });
  const add = () => router.push({ pathname: '/personal-expenses', params: { tab: 'wallet', add: '1' } });
  const share = summary.spent_percent_of_profit;

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={open} accessibilityRole="button">
        <View style={styles.icon}>
          <Ionicons name="book" size={18} color={COLORS.warning} />
        </View>
        <Text style={styles.title}>{t('wallet.title')}</Text>
        <Text style={styles.open}>{t('wallet.openShort')}</Text>
        <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
      </TouchableOpacity>

      <View style={styles.figures}>
        <View style={styles.figure}>
          <Text style={styles.label}>{t('wallet.spentThisMonth')}</Text>
          <Text style={styles.value}>{formatMoney(summary.total_spent)}</Text>
          {share != null && (
            <Text style={styles.sub}>{`${Math.round(share)}% ${t('wallet.ofProfit')}`}</Text>
          )}
        </View>
        {summary.safe_to_spend !== null && (
          <View style={styles.figure}>
            <Text style={styles.label}>{t('wallet.safeToSpend')}</Text>
            <Text style={[styles.value, { color }]}>{formatMoney(summary.safe_to_spend)}</Text>
            <Text style={[styles.sub, { color }]}>{t(STATUS_KEYS[summary.status])}</Text>
          </View>
        )}
      </View>

      {canAdd && (
        <TouchableOpacity style={styles.add} onPress={add} accessibilityRole="button">
          <Ionicons name="add" size={18} color="white" />
          <Text style={styles.addText}>{t('wallet.addEntry')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', color: 'white' },
  open: { fontSize: 13, fontWeight: '600', color: COLORS.primary },
  figures: { flexDirection: 'row', gap: 12, marginTop: 14 },
  figure: { flex: 1, minWidth: 0 },
  label: { fontSize: 12, color: COLORS.textSecondary },
  value: { fontSize: 20, fontWeight: '800', color: 'white', marginTop: 4 },
  sub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    backgroundColor: COLORS.warning,
    borderRadius: 12,
    paddingVertical: 12,
  },
  addText: { fontSize: 15, fontWeight: '700', color: 'white' },
});

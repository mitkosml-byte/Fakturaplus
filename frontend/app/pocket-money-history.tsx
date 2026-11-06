import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { DailyRevenue } from '../src/types';
import { useTranslation, useLanguageStore } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, AnimatedEmptyIcon, SkeletonRow } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const MONTH_NAMES_BG = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type PeriodPreset = 'all' | 'thisYear' | 'thisMonth' | 'lastMonth';

// Module 2 audit correction: "Джобче" keeps its exact existing behavior
// (the owner was explicit that it serves a different purpose than
// originally assumed, and must stay simple and unchanged) - this screen
// adds ONLY a read-only history/stats view, mirroring the pattern already
// used for personal investments (see personal-expenses.tsx). No add/edit
// here; entries are still made wherever daily revenue is already entered.
export default function PocketMoneyHistoryScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { hasPermission } = useAuth();
  const monthNames = language === 'bg' ? MONTH_NAMES_BG : MONTH_NAMES_EN;

  const canView = hasPermission('view_pocket_money');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revenues, setRevenues] = useState<DailyRevenue[]>([]);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');

  const loadData = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    try {
      const now = new Date();
      const params: { start_date?: string; end_date?: string } = {};
      if (periodPreset === 'thisMonth') {
        params.start_date = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
        params.end_date = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), 'yyyy-MM-dd');
      } else if (periodPreset === 'lastMonth') {
        params.start_date = format(new Date(now.getFullYear(), now.getMonth() - 1, 1), 'yyyy-MM-dd');
        params.end_date = format(new Date(now.getFullYear(), now.getMonth(), 0), 'yyyy-MM-dd');
      } else if (periodPreset === 'thisYear') {
        params.start_date = format(new Date(now.getFullYear(), 0, 1), 'yyyy-MM-dd');
        params.end_date = format(new Date(now.getFullYear(), 11, 31), 'yyyy-MM-dd');
      }
      const data = await api.getDailyRevenues(params);
      // Only days with a non-zero Джобче entry - this history is about
      // that one field, not a general daily-revenue ledger (which has
      // its own screens already).
      setRevenues(data.filter((r) => r.pocket_money > 0));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [canView, periodPreset, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const grouped = useMemo(() => {
    const groups: Record<string, DailyRevenue[]> = {};
    revenues.forEach((r) => {
      const key = r.date.slice(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [revenues]);

  const total = useMemo(() => revenues.reduce((sum, r) => sum + r.pocket_money, 0), [revenues]);

  if (!canView) {
    return <AccessDenied />;
  }

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('pocketMoney.historyTitle')}</Text>
            <View style={styles.backButton} />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsRow}
            contentContainerStyle={styles.chipsContent}
          >
            {([
              { key: 'all', label: t('expenses.periodAll') },
              { key: 'thisMonth', label: t('expenses.periodThisMonth') },
              { key: 'lastMonth', label: t('expenses.periodLastMonth') },
              { key: 'thisYear', label: t('invoices.periodThisYear') },
            ] as const).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.chip, periodPreset === opt.key && styles.chipActive]}
                onPress={() => setPeriodPreset(opt.key)}
              >
                <Text style={[styles.chipText, periodPreset === opt.key && styles.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.summaryBar}>
            <Text style={styles.summaryLabel}>{t('invoices.count')}: <Text style={styles.summaryValue}>{revenues.length}</Text></Text>
            <Text style={styles.summaryLabel}>{t('expenses.totalLabel')}: <Text style={[styles.summaryValue, { color: COLORS.warning }]}>{total.toFixed(2)} €</Text></Text>
          </View>

          {loading ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <SkeletonRow /><SkeletonRow /><SkeletonRow />
            </View>
          ) : (
            <ScrollView
              style={styles.content}
              contentContainerStyle={{ paddingBottom: 32 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
            >
              {grouped.length === 0 && (
                <View style={styles.emptyContainer}>
                  <AnimatedEmptyIcon name="wallet-outline" size={64} color={COLORS.border} />
                  <Text style={styles.emptyText}>{t('pocketMoney.empty')}</Text>
                </View>
              )}
              {grouped.map(([key, monthRevenues]) => {
                const [yearStr, monthStr] = key.split('-');
                const monthTotal = monthRevenues.reduce((sum, r) => sum + r.pocket_money, 0);
                return (
                  <View key={key} style={styles.monthGroup}>
                    <View style={styles.monthHeader}>
                      <Text style={styles.monthHeaderTitle}>
                        {monthNames[parseInt(monthStr, 10) - 1]} {yearStr}
                      </Text>
                      <Text style={styles.monthHeaderStats}>
                        {monthRevenues.length} · {monthTotal.toFixed(2)} €
                      </Text>
                    </View>
                    {monthRevenues
                      .slice()
                      .sort((a, b) => (a.date < b.date ? 1 : -1))
                      .map((r) => (
                        <View key={r.id} style={styles.card}>
                          <Text style={styles.cardDate}>{format(new Date(r.date), 'd MMM yyyy', { locale: dateLocale })}</Text>
                          <Text style={styles.cardAmount}>{r.pocket_money.toFixed(2)} €</Text>
                        </View>
                      ))}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(10, 15, 28, 0.88)' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white', flex: 1, textAlign: 'center' },
  chipsRow: { maxHeight: 44, marginBottom: 8 },
  chipsContent: { paddingHorizontal: 16, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
  },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: 'white' },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  summaryLabel: { fontSize: 13, color: COLORS.textSecondary },
  summaryValue: { fontWeight: 'bold', color: 'white' },
  content: { flex: 1, paddingHorizontal: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: COLORS.textMuted, fontSize: 14, marginTop: 12 },
  monthGroup: { marginBottom: 20 },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  monthHeaderTitle: { fontSize: 15, fontWeight: 'bold', color: 'white' },
  monthHeaderStats: { fontSize: 12, color: COLORS.textMuted },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardDate: { fontSize: 13, color: COLORS.textSecondary },
  cardAmount: { fontSize: 15, fontWeight: 'bold', color: 'white' },
});

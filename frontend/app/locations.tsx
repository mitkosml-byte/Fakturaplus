import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  ImageBackground,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { endOfMonth, endOfYear, format, parseISO, startOfMonth, startOfYear, subMonths } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import type { BusinessLocation, LocationComparison, LocationComparisonRow } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet, ChipTabs } from '../src/components';
import { useLocationsStore } from '../src/stores/locationsStore';
import { COLORS } from '../src/theme/colors';
import { formatMoney } from '../src/utils/money';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

type PeriodKey = 'month' | 'lastMonth' | 'year';
type Draft = { id: string | null; name: string; address: string };

const eur = (value: number) => `${formatMoney(value)}`;
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

function periodRange(key: PeriodKey): [string, string] {
  const today = new Date();
  if (key === 'lastMonth') {
    const last = subMonths(today, 1);
    return [iso(startOfMonth(last)), iso(endOfMonth(last))];
  }
  if (key === 'year') return [iso(startOfYear(today)), iso(endOfYear(today))];
  return [iso(startOfMonth(today)), iso(endOfMonth(today))];
}

// The business's locations (Н11): shops, sites, branches - each one's
// revenue, costs and team side by side. What belongs to no location
// (depreciation, a purchase for the whole business, a day entered before
// there were locations) is shown as shared; the locations and the shared
// part add up to the business's own numbers, the same as in Statistics.
export default function LocationsScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('manage_company');
  const canCompare = hasPermission('view_statistics') && hasPermission('view_profit');
  const reloadStore = useLocationsStore((state) => state.reload);

  const [locations, setLocations] = useState<BusinessLocation[]>([]);
  const [comparison, setComparison] = useState<LocationComparison | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!canManage && !canCompare) {
      setLoading(false);
      return;
    }
    try {
      const [start, end] = periodRange(period);
      const [list, compared] = await Promise.all([
        api.getLocations(),
        canCompare ? api.compareLocations(start, end) : Promise.resolve(null),
      ]);
      setLocations(list);
      setComparison(compared);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [canManage, canCompare, period, t]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!canManage && !canCompare) return <AccessDenied />;

  const afterChange = async () => {
    await Promise.all([load(), reloadStore()]);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      Alert.alert(t('common.error'), t('locations.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const body = { name: draft.name.trim(), address: draft.address.trim() || null };
      if (draft.id) await api.updateLocation(draft.id, body);
      else await api.createLocation(body);
      Haptics.success();
      Toast.success(t('locations.saved'));
      setDraft(null);
      await afterChange();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (location: BusinessLocation, active: boolean) => {
    try {
      await api.updateLocation(location.id, { is_active: active });
      Toast.success(active ? t('locations.reopened') : t('locations.closedToast'));
      setDraft(null);
      await afterChange();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  const remove = (location: BusinessLocation) => {
    Alert.alert(location.name, t('locations.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteLocation(location.id);
            Haptics.destructive();
            setDraft(null);
            await afterChange();
          } catch (error: any) {
            // Used already: offered to be closed instead.
            Alert.alert(location.name, error.message, [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('locations.close'), onPress: () => { setActive(location, false); } },
            ]);
          }
        },
      },
    ]);
  };

  const maxIncome = Math.max(1, ...(comparison?.locations.map((row) => row.income) ?? [0]));
  // The one profit (P1-1): without VAT for a business registered for it.
  const periodText = comparison
    ? `${format(parseISO(comparison.period.start), 'd MMM', { locale: dateLocale })} – ${format(parseISO(comparison.period.end), 'd MMM yyyy', { locale: dateLocale })}`
      + (comparison.vat_excluded ? ` · ${t('profit.withoutVat')}` : '')
    : '';

  const renderRow = (row: LocationComparisonRow) => (
    <View key={row.id} style={styles.card}>
      <View style={styles.cardTop}>
        <Ionicons name="storefront-outline" size={20} color={row.is_active ? COLORS.primary : COLORS.textMuted} />
        <Text style={[styles.name, { flex: 1 }]}>{row.name}</Text>
        {!row.is_active && <Text style={styles.closedBadge}>{t('locations.closed')}</Text>}
        <Text style={[styles.profit, { color: row.profit >= 0 ? COLORS.success : COLORS.danger }]}>{eur(row.profit)}</Text>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.max(2, (row.income / maxIncome) * 100)}%` }]} />
      </View>
      <View style={styles.figures}>
        <Text style={styles.figure}>{t('locations.income')} <Text style={styles.figureValue}>{eur(row.income)}</Text></Text>
        <Text style={styles.figure}>{t('locations.expense')} <Text style={styles.figureValue}>{eur(row.expense)}</Text></Text>
        {row.margin_percent != null && (
          <Text style={styles.figure}>{t('locations.margin')} <Text style={styles.figureValue}>{row.margin_percent}%</Text></Text>
        )}
      </View>
      <Text style={styles.parts}>
        {[
          `${t('locations.part.till')} ${eur(row.parts.till)}`,
          row.parts.issued_invoices ? `${t('locations.part.issued')} ${eur(row.parts.issued_invoices)}` : null,
          `${t('locations.part.purchases')} ${eur(row.parts.purchases)}`,
          row.parts.off_book ? `${t('locations.part.offBook')} ${eur(row.parts.off_book)}` : null,
          row.parts.payroll ? `${t('locations.part.payroll')} ${eur(row.parts.payroll)}` : null,
        ].filter(Boolean).join(' · ')}
      </Text>
      <Text style={styles.parts}>
        {row.revenue_per_day != null
          ? t('locations.perDay').replace('{amount}', eur(row.revenue_per_day)).replace('{days}', String(row.revenue_days))
          : t('locations.noRevenueDays')}
        {row.team ? ` · ${row.team === 1 ? t('locations.teamOne') : t('locations.team').replace('{count}', String(row.team))}` : ''}
      </Text>
    </View>
  );

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('locations.title')}</Text>
            {canManage ? (
              <TouchableOpacity onPress={() => setDraft({ id: null, name: '', address: '' })} style={styles.iconButton} accessibilityLabel={t('locations.add')}>
                <Ionicons name="add" size={24} color="white" />
              </TouchableOpacity>
            ) : <View style={{ width: 40 }} />}
          </View>

          <ScrollView
            style={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          >
            <Text style={styles.intro}>{t('locations.intro')}</Text>
            {loading ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
            ) : locations.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="storefront-outline" size={36} color={COLORS.textMuted} />
                <Text style={styles.empty}>{t('locations.empty')}</Text>
                {canManage && (
                  <TouchableOpacity style={styles.primaryButton} onPress={() => setDraft({ id: null, name: '', address: '' })}>
                    <Text style={styles.primaryButtonText}>{t('locations.add')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <>
                {canCompare && comparison && (
                  <>
                    <ChipTabs
                      active={period}
                      onChange={(key) => { setLoading(true); setPeriod(key); }}
                      options={[
                        { key: 'month', label: t('locations.period.month') },
                        { key: 'lastMonth', label: t('locations.period.lastMonth') },
                        { key: 'year', label: t('locations.period.year') },
                      ]}
                    />
                    <Text style={styles.periodText}>{periodText}</Text>
                    {comparison.locations.map(renderRow)}
                    <View style={[styles.card, styles.sharedCard]}>
                      <View style={styles.cardTop}>
                        <Ionicons name="git-merge-outline" size={20} color={COLORS.textSecondary} />
                        <Text style={[styles.name, { flex: 1 }]}>{t('locations.shared')}</Text>
                        <Text style={[styles.profit, { color: comparison.shared.profit >= 0 ? COLORS.success : COLORS.danger }]}>
                          {eur(comparison.shared.profit)}
                        </Text>
                      </View>
                      <Text style={styles.parts}>
                        {t('locations.income')} {eur(comparison.shared.income)} · {t('locations.expense')} {eur(comparison.shared.expense)}
                      </Text>
                      <Text style={styles.hint}>{t('locations.sharedHint')}</Text>
                    </View>
                    <View style={[styles.card, styles.totalCard]}>
                      <View style={styles.cardTop}>
                        <Ionicons name="business-outline" size={20} color="white" />
                        <Text style={[styles.name, { flex: 1 }]}>{t('locations.total')}</Text>
                        <Text style={[styles.profit, { color: comparison.total.profit >= 0 ? COLORS.success : COLORS.danger }]}>
                          {eur(comparison.total.profit)}
                        </Text>
                      </View>
                      <Text style={styles.parts}>
                        {t('locations.income')} {eur(comparison.total.income)} · {t('locations.expense')} {eur(comparison.total.expense)}
                      </Text>
                      <Text style={styles.hint}>{t('locations.totalHint')}</Text>
                    </View>
                  </>
                )}

                {canManage && (
                  <>
                    <Text style={styles.sectionTitle}>{t('locations.manage')}</Text>
                    {locations.map((location) => (
                      <TouchableOpacity
                        key={location.id}
                        style={styles.manageRow}
                        onPress={() => setDraft({ id: location.id, name: location.name, address: location.address || '' })}
                        activeOpacity={0.85}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.name, !location.is_active && { color: COLORS.textMuted }]}>{location.name}</Text>
                          {!!location.address && <Text style={styles.sub}>{location.address}</Text>}
                        </View>
                        {!location.is_active && <Text style={styles.closedBadge}>{t('locations.closed')}</Text>}
                        <Ionicons name="create-outline" size={18} color={COLORS.textSecondary} />
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </>
            )}
            <View style={{ height: 32 }} />
          </ScrollView>

          <BottomSheet visible={!!draft} onClose={() => setDraft(null)}>
            {draft && (
              <View style={styles.sheet}>
                <Text style={styles.sheetTitle}>{draft.id ? draft.name || t('locations.title') : t('locations.add')}</Text>
                <Text style={styles.label}>{t('locations.name')}</Text>
                <TextInput
                  style={styles.input}
                  value={draft.name}
                  onChangeText={(name) => setDraft({ ...draft, name })}
                  placeholder={t('locations.namePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                  maxLength={120}
                />
                <Text style={styles.label}>{t('locations.address')}</Text>
                <TextInput
                  style={styles.input}
                  value={draft.address}
                  onChangeText={(address) => setDraft({ ...draft, address })}
                  placeholderTextColor={COLORS.textMuted}
                  maxLength={300}
                />
                <TouchableOpacity style={[styles.primaryButton, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>{t('common.save')}</Text>}
                </TouchableOpacity>
                {draft.id && (() => {
                  const location = locations.find((l) => l.id === draft.id);
                  if (!location) return null;
                  return (
                    <>
                      <TouchableOpacity style={styles.secondaryButton} onPress={() => setActive(location, !location.is_active)}>
                        <Text style={styles.secondaryText}>{location.is_active ? t('locations.close') : t('locations.reopen')}</Text>
                      </TouchableOpacity>
                      {location.is_active && <Text style={styles.hint}>{t('locations.closeHint')}</Text>}
                      <TouchableOpacity style={styles.deleteButton} onPress={() => remove(location)}>
                        <Text style={styles.deleteText}>{t('common.delete')}</Text>
                      </TouchableOpacity>
                    </>
                  );
                })()}
              </View>
            )}
          </BottomSheet>
        </SafeAreaView>
      </View>
    </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surface,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  content: { flex: 1, padding: 16 },
  intro: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19, marginBottom: 12 },
  emptyBox: { alignItems: 'center', gap: 10, marginTop: 24 },
  empty: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 19 },
  periodText: { color: COLORS.textMuted, fontSize: 12, marginTop: 8, marginBottom: 10 },
  sectionTitle: { color: 'white', fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10 },
  sharedCard: { backgroundColor: 'rgba(30, 41, 59, 0.6)' },
  totalCard: { borderWidth: 1, borderColor: COLORS.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { color: 'white', fontSize: 15, fontWeight: '600' },
  sub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  profit: { fontSize: 16, fontWeight: '700' },
  bar: { height: 6, borderRadius: 3, backgroundColor: COLORS.background, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  figure: { color: COLORS.textSecondary, fontSize: 12 },
  figureValue: { color: 'white', fontWeight: '600' },
  parts: { color: COLORS.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 },
  hint: { color: COLORS.textMuted, fontSize: 12, marginTop: 6, lineHeight: 15 },
  closedBadge: {
    color: COLORS.textMuted,
    fontSize: 11,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  sheet: { padding: 16 },
  sheetTitle: { color: 'white', fontSize: 17, fontWeight: '700', marginBottom: 8 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: 'white',
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  primaryButton: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 16, alignSelf: 'stretch' },
  primaryButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
  secondaryButton: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 10 },
  secondaryText: { color: 'white', fontWeight: '600' },
  deleteButton: { alignItems: 'center', padding: 12, marginTop: 6 },
  deleteText: { color: COLORS.danger, fontWeight: '600' },
});

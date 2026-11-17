import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import type { CostPart, PriceList, PriceListEntry, PurchaseItem, SoldItem } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';
const VAT_RATES = [20, 9, 0];

const money = (n: number) => `${n.toFixed(2)} €`;
const num = (text: string) => parseFloat(text.replace(',', '.'));

type PartDraft = { item_name: string; unit: string; quantity: string; unit_price: number | null };
type Draft = { id: string | null; name: string; unit: string; price: string; vat: number; parts: PartDraft[] };

// The business's own selling prices (Н8): the same on invoices, bills and
// quotes; what each one costs from the latest purchases of what it is made
// of; and, when a supplier gets dearer, how far the margin fell and what
// price would keep it. The price changes only when the person says so.
export default function PriceListScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const allowed = hasPermission('add_revenue') || hasPermission('issue_invoices')
    || hasPermission('view_statistics') || hasPermission('manage_invoices');

  const [data, setData] = useState<PriceList | null>(null);
  const [sold, setSold] = useState<SoldItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<PurchaseItem[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    try {
      const [list, soldItems] = await Promise.all([api.getPriceList(), api.getSoldItems().catch(() => [] as SoldItem[])]);
      setData(list);
      setSold(soldItems);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [allowed, t]);

  useEffect(() => { load(); }, [load]);

  // What was bought, as the person types.
  useEffect(() => {
    if (!draft || !data?.sees_costs) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) {
      setFound([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      api.getPurchaseItems(search.trim()).then(setFound).catch(() => setFound([]));
    }, 250);
  }, [search, draft, data?.sees_costs]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!allowed) return <AccessDenied />;

  const vatOn = !!data?.vat_registered;
  const shownPrice = (entry: PriceListEntry) =>
    vatOn ? t('priceList.withVat').replace('{amount}', money(entry.price_gross)) : money(entry.price);

  const setPrice = async (entry: PriceListEntry, price: number) => {
    setBusy(entry.id);
    try {
      await api.updatePriceEntry(entry.id, { price });
      Haptics.success();
      Toast.success(t('priceList.saved'));
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setBusy(null);
    }
  };

  const keep = async (entry: PriceListEntry) => {
    setBusy(entry.id);
    try {
      await api.keepPrice(entry.id);
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setBusy(null);
    }
  };

  const addSold = async (item: SoldItem) => {
    try {
      await api.createPriceEntry({ name: item.name, unit: item.unit, price: item.price, vat_rate: item.vat_rate });
      Haptics.success();
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  const openNew = () => {
    setSearch('');
    setDraft({ id: null, name: '', unit: 'бр.', price: '', vat: 20, parts: [] });
  };

  const openEdit = (entry: PriceListEntry) => {
    if (!data?.can_edit) return;
    setSearch('');
    setDraft({
      id: entry.id,
      name: entry.name,
      unit: entry.unit,
      price: String(entry.price),
      vat: entry.vat_rate || 20,
      parts: (entry.costs || []).map((part) => ({
        item_name: part.item_name, unit: part.unit || '', quantity: String(part.quantity), unit_price: part.unit_price,
      })),
    });
  };

  const save = async () => {
    if (!draft) return;
    const price = num(draft.price);
    if (!draft.name.trim() || !(price >= 0)) {
      Alert.alert(t('common.error'), t('priceList.invalid'));
      return;
    }
    const costs: CostPart[] = draft.parts
      .filter((part) => num(part.quantity) > 0)
      .map((part) => ({ item_name: part.item_name, quantity: num(part.quantity), unit: part.unit || null }));
    const body = { name: draft.name.trim(), unit: draft.unit.trim() || 'бр.', price, vat_rate: draft.vat, ...(data?.sees_costs ? { costs } : {}) };
    setSaving(true);
    try {
      if (draft.id) await api.updatePriceEntry(draft.id, body);
      else await api.createPriceEntry(body);
      Toast.success(t('priceList.saved'));
      setDraft(null);
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!draft?.id) return;
    const id = draft.id;
    Alert.alert(draft.name, t('priceList.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deletePriceEntry(id);
            setDraft(null);
            await load();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  const renderEntry = (entry: PriceListEntry) => (
    <TouchableOpacity key={entry.id} style={styles.card} onPress={() => openEdit(entry)} activeOpacity={data?.can_edit ? 0.85 : 1}>
      <View style={styles.cardTop}>
        <Text style={styles.name} numberOfLines={1}>{entry.name}</Text>
        <Text style={styles.price}>{shownPrice(entry)}</Text>
      </View>
      <Text style={styles.sub}>
        {t('priceList.perUnit').replace('{unit}', entry.unit)}
        {vatOn ? ` · ${t('priceList.withoutVat').replace('{amount}', money(entry.price))}` : ''}
      </Text>
      {data?.sees_costs && (
        entry.margin_percent !== null && entry.margin_percent !== undefined ? (
          <View style={styles.marginRow}>
            <Text style={[styles.marginBadge, { color: entry.margin_dropped ? COLORS.warning : COLORS.success }]}>
              {t('priceList.margin').replace('{percent}', entry.margin_percent.toFixed(1))}
            </Text>
            <Text style={styles.sub}>{t('priceList.cost').replace('{amount}', money(entry.cost || 0))}</Text>
          </View>
        ) : (
          <Text style={styles.hint}>{t('priceList.noCost')}</Text>
        )
      )}
      {entry.margin_dropped && entry.suggested_price != null && (
        <View style={styles.dropBox}>
          <Ionicons name="trending-down" size={18} color={COLORS.warning} />
          <View style={{ flex: 1 }}>
            <Text style={styles.dropText}>
              {t('priceList.dropped')
                .replace('{then}', (entry.margin_then_percent || 0).toFixed(0))
                .replace('{now}', (entry.margin_percent || 0).toFixed(0))
                .replace('{price}', vatOn
                  ? t('priceList.withVat').replace('{amount}', money(entry.suggested_gross || 0))
                  : money(entry.suggested_price))}
            </Text>
            {data?.can_edit && (
              <View style={styles.dropActions}>
                <TouchableOpacity
                  style={styles.primarySmall}
                  onPress={() => setPrice(entry, entry.suggested_price!)}
                  disabled={busy === entry.id}
                >
                  <Text style={styles.primarySmallText}>
                    {t('priceList.setNew').replace('{price}', money(vatOn ? entry.suggested_gross || 0 : entry.suggested_price!))}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondarySmall} onPress={() => keep(entry)} disabled={busy === entry.id}>
                  <Text style={styles.secondarySmallText}>{t('priceList.keep')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('priceList.title')}</Text>
            {data?.can_edit ? (
              <TouchableOpacity onPress={openNew} style={styles.backButton} accessibilityLabel={t('priceList.add')}>
                <Ionicons name="add" size={24} color="white" />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 40 }} />
            )}
          </View>

          <ScrollView
            style={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          >
            <Text style={styles.intro}>{t('priceList.intro')}</Text>
            {loading || !data ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
            ) : (
              <>
                {data.entries.length === 0 && <Text style={styles.empty}>{t('priceList.empty')}</Text>}
                {[...data.entries]
                  .sort((a, b) => Number(!!b.margin_dropped) - Number(!!a.margin_dropped))
                  .map(renderEntry)}
                {data.can_edit && sold.length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>{t('priceList.sold')}</Text>
                    <View style={styles.chips}>
                      {sold.map((item) => (
                        <TouchableOpacity key={item.name} style={styles.chip} onPress={() => addSold(item)}>
                          <Ionicons name="add" size={14} color={COLORS.primary} />
                          <Text style={styles.chipText} numberOfLines={1}>{item.name} · {money(item.price)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </>
            )}
            <View style={{ height: 32 }} />
          </ScrollView>

          <BottomSheet visible={!!draft} onClose={() => setDraft(null)}>
            {draft && (
              <View style={styles.sheet}>
                <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 600 }}>
                  <Text style={styles.sheetTitle}>{draft.id ? draft.name : t('priceList.add')}</Text>
                  <Text style={styles.label}>{t('priceList.name')}</Text>
                  <TextInput style={styles.input} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>{t('priceList.unit')}</Text>
                      <TextInput style={styles.input} value={draft.unit} onChangeText={(unit) => setDraft({ ...draft, unit })} />
                    </View>
                    <View style={{ flex: 1.4 }}>
                      <Text style={styles.label}>{vatOn ? t('priceList.price') : t('priceList.priceNoVat')}</Text>
                      <TextInput style={styles.input} value={draft.price} keyboardType="decimal-pad"
                        onChangeText={(price) => setDraft({ ...draft, price })} />
                    </View>
                  </View>
                  {vatOn && (
                    <>
                      <Text style={styles.label}>{t('priceList.vatRate')}</Text>
                      <View style={styles.row}>
                        {VAT_RATES.map((rate) => (
                          <TouchableOpacity
                            key={rate}
                            style={[styles.rate, draft.vat === rate && styles.rateActive]}
                            onPress={() => setDraft({ ...draft, vat: rate })}
                          >
                            <Text style={[styles.rateText, draft.vat === rate && styles.rateTextActive]}>{rate}%</Text>
                          </TouchableOpacity>
                        ))}
                        {num(draft.price) >= 0 && (
                          <Text style={styles.sub}>= {t('priceList.withVat').replace('{amount}', money(num(draft.price) * (1 + draft.vat / 100)))}</Text>
                        )}
                      </View>
                    </>
                  )}

                  {data?.sees_costs && (
                    <>
                      <Text style={[styles.label, { marginTop: 16 }]}>{t('priceList.madeOf').replace('{unit}', draft.unit || 'бр.')}</Text>
                      <Text style={styles.hint}>{t('priceList.madeOfHint')}</Text>
                      {draft.parts.map((part, index) => (
                        <View key={`${part.item_name}-${index}`} style={styles.part}>
                          <Text style={styles.partName} numberOfLines={2}>{part.item_name}</Text>
                          <TextInput
                            style={[styles.input, styles.partQty]}
                            value={part.quantity}
                            keyboardType="decimal-pad"
                            onChangeText={(quantity) => setDraft({
                              ...draft, parts: draft.parts.map((p, i) => (i === index ? { ...p, quantity } : p)),
                            })}
                          />
                          <Text style={styles.sub}>{part.unit || ''}</Text>
                          <TouchableOpacity onPress={() => setDraft({ ...draft, parts: draft.parts.filter((_, i) => i !== index) })} hitSlop={8}>
                            <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      <TextInput
                        style={styles.input}
                        value={search}
                        onChangeText={setSearch}
                        placeholder={t('priceList.searchPurchase')}
                        placeholderTextColor={COLORS.textMuted}
                      />
                      {found.map((item) => (
                        <TouchableOpacity
                          key={item.item_name}
                          style={styles.found}
                          onPress={() => {
                            setDraft({
                              ...draft,
                              parts: [...draft.parts, { item_name: item.item_name, unit: item.unit || '', quantity: '1', unit_price: item.unit_price }],
                            });
                            setSearch('');
                            setFound([]);
                          }}
                        >
                          <Text style={styles.foundName} numberOfLines={1}>{item.item_name}</Text>
                          <Text style={styles.sub} numberOfLines={1}>
                            {t('priceList.lastBought')
                              .replace('{price}', money(item.unit_price))
                              .replace('{unit}', item.unit || '')
                              .replace('{supplier}', item.supplier || '')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </>
                  )}

                  <TouchableOpacity style={[styles.primaryButton, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                    {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>{t('common.save')}</Text>}
                  </TouchableOpacity>
                  {draft.id && (
                    <TouchableOpacity style={styles.deleteButton} onPress={remove}>
                      <Text style={styles.deleteText}>{t('common.delete')}</Text>
                    </TouchableOpacity>
                  )}
                </ScrollView>
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
  backButton: {
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
  empty: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 24, lineHeight: 20 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: 'white', fontSize: 15, fontWeight: '600' },
  price: { color: 'white', fontSize: 15, fontWeight: '700' },
  sub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  hint: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  marginRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  marginBadge: { fontSize: 13, fontWeight: '700' },
  dropBox: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  dropText: { color: COLORS.textLight, fontSize: 13, lineHeight: 18 },
  dropActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  primarySmall: { backgroundColor: COLORS.primary, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  primarySmallText: { color: 'white', fontSize: 12, fontWeight: '600' },
  secondarySmall: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  secondarySmallText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  sectionTitle: { color: 'white', fontSize: 15, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    maxWidth: '100%',
  },
  chipText: { color: COLORS.textLight, fontSize: 12 },
  sheet: { padding: 16 },
  sheetTitle: { color: 'white', fontSize: 17, fontWeight: '700', marginBottom: 8 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginTop: 10, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: 'white',
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rate: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  rateActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  rateText: { color: COLORS.textSecondary, fontWeight: '600' },
  rateTextActive: { color: 'white' },
  part: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  partName: { flex: 1, color: COLORS.textLight, fontSize: 13 },
  partQty: { width: 80, textAlign: 'right' },
  found: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  foundName: { color: 'white', fontSize: 13 },
  primaryButton: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 16 },
  primaryButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
  deleteButton: { alignItems: 'center', padding: 12, marginTop: 6 },
  deleteText: { color: COLORS.danger, fontWeight: '600' },
});

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, ImageBackground, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import type { Customer, CustomerCard, CustomerInput } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet, AnimatedEmptyIcon, SkeletonRow } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const EMPTY_FORM: CustomerInput = { name: '', eik: '', vat_number: '', address: '', email: '', phone: '', notes: '' };
const FIELDS: { key: keyof CustomerInput; label: string; keyboard?: 'number-pad' | 'email-address' | 'phone-pad' }[] = [
  { key: 'name', label: 'customers.name' },
  { key: 'eik', label: 'customers.eik', keyboard: 'number-pad' },
  { key: 'vat_number', label: 'customers.vatNumber' },
  { key: 'address', label: 'customers.address' },
  { key: 'email', label: 'customers.email', keyboard: 'email-address' },
  { key: 'phone', label: 'customers.phone', keyboard: 'phone-pad' },
  { key: 'notes', label: 'customers.notes' },
];

// The business's customers: what an invoice to them names (EIK, VAT number,
// address), remembered from the invoices themselves, and one card per
// customer with what they were invoiced and owe now.
export default function CustomersScreen() {
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();
  const router = useRouter();
  const canManage = hasPermission('add_revenue');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<CustomerInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      setCustomers(await api.getCustomers());
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((c) =>
      [c.name, c.eik, c.vat_number, c.email].some((value) => (value || '').toLowerCase().includes(query)));
  }, [customers, search]);

  const openForm = (customer: Customer | null) => {
    setEditing(customer);
    setForm(customer ? {
      name: customer.name, eik: customer.eik || '', vat_number: customer.vat_number || '', address: customer.address || '',
      email: customer.email || '', phone: customer.phone || '', notes: customer.notes || '',
    } : EMPTY_FORM);
    setFormVisible(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      Alert.alert(t('common.error'), t('customers.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      if (editing) await api.updateCustomer(editing.id, form);
      else await api.createCustomer(form);
      Haptics.success();
      Toast.success(t('customers.saved'));
      setFormVisible(false);
      if (card && editing && card.customer.id === editing.id) openCard(editing.id);
      loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const remove = (customer: Customer) => {
    Alert.alert(t('common.confirm'), t('customers.deleteConfirm').replace('{name}', customer.name), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteCustomer(customer.id);
            setCard(null);
            loadData();
          } catch (error: any) {
            Alert.alert(t('common.error'), error?.message || '');
          }
        },
      },
    ]);
  };

  const openCard = async (id: string) => {
    setCardLoading(true);
    try {
      setCard(await api.getCustomerCard(id));
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || '');
    } finally {
      setCardLoading(false);
    }
  };

  const day = (iso?: string | null) => (iso ? format(parseISO(iso), 'd MMM yyyy', { locale: dateLocale }) : '—');
  const money = (value: number) => `${value.toFixed(2)} €`;
  const docLabel = (doc: CustomerCard['documents'][number]) =>
    doc.doc_type === 'invoice'
      ? `${t('billingDocuments.typeInvoice')} № ${doc.invoice_number || ''}`
      : doc.doc_type === 'bill' ? t('billingDocuments.typeBill') : t('billingDocuments.typeQuote');

  if (!canManage) {
    return <AccessDenied />;
  }

  return (
    <ScreenEnter>
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
                <Ionicons name="arrow-back" size={24} color="white" />
              </TouchableOpacity>
              <Text style={styles.title}>{t('customers.title')}</Text>
              <TouchableOpacity onPress={() => openForm(null)} style={styles.headerButton} accessibilityLabel={t('customers.add')}>
                <Ionicons name="person-add-outline" size={22} color="white" />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={COLORS.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                placeholder={t('customers.search')}
                placeholderTextColor={COLORS.textMuted}
              />
            </View>

            {loading ? (
              <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                <SkeletonRow /><SkeletonRow /><SkeletonRow />
              </View>
            ) : (
              <ScrollView
                style={styles.content}
                contentContainerStyle={{ paddingBottom: 32 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }} tintColor={COLORS.primary} />}
              >
                {shown.length === 0 && (
                  <View style={styles.emptyContainer}>
                    <AnimatedEmptyIcon name="people-outline" size={64} color={COLORS.border} />
                    <Text style={styles.emptyText}>{search ? t('customers.noMatch') : t('customers.empty')}</Text>
                    {!search && <Text style={styles.emptyHint}>{t('customers.emptyHint')}</Text>}
                  </View>
                )}
                {shown.map((customer) => (
                  <TouchableOpacity key={customer.id} style={styles.card} onPress={() => openCard(customer.id)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{customer.name}</Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {[customer.eik && `${t('customers.eikShort')} ${customer.eik}`, customer.address].filter(Boolean).join(' · ') || t('customers.noDetails')}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {cardLoading && (
              <View style={styles.cardLoading}><ActivityIndicator color={COLORS.primary} /></View>
            )}

            <BottomSheet visible={!!card} onClose={() => setCard(null)}>
              {card && (
                <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 30 }}>
                  <View style={styles.sheetHeader}>
                    <Text style={styles.sheetTitle} numberOfLines={2}>{card.customer.name}</Text>
                    <TouchableOpacity onPress={() => openForm(card.customer)} accessibilityLabel={t('customers.edit')}>
                      <Ionicons name="create-outline" size={20} color={COLORS.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => remove(card.customer)} accessibilityLabel={t('common.delete')}>
                      <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
                    </TouchableOpacity>
                  </View>
                  {[card.customer.eik && `${t('customers.eikShort')} ${card.customer.eik}`,
                    card.customer.vat_number && `${t('customers.vatShort')} ${card.customer.vat_number}`,
                    card.customer.address, card.customer.email, card.customer.phone]
                    .filter(Boolean).map((line) => <Text key={String(line)} style={styles.detail}>{line}</Text>)}

                  <View style={styles.statsRow}>
                    <View style={styles.stat}>
                      <Text style={styles.statLabel}>{t('customers.invoiced')}</Text>
                      <Text style={styles.statValue}>{money(card.totals.invoiced)}</Text>
                      <Text style={styles.statHint}>
                        {t('customers.invoiceCount').replace('{count}', String(card.totals.invoice_count))}
                      </Text>
                    </View>
                    <View style={styles.stat}>
                      <Text style={styles.statLabel}>{t('customers.owed')}</Text>
                      <Text style={[styles.statValue, card.totals.owed > 0 && { color: COLORS.warning }]}>{money(card.totals.owed)}</Text>
                      {card.totals.overdue > 0 && (
                        <Text style={[styles.statHint, { color: COLORS.danger }]}>
                          {t('customers.overdue').replace('{amount}', money(card.totals.overdue))}
                        </Text>
                      )}
                    </View>
                  </View>
                  {card.totals.last_invoice_date && (
                    <Text style={styles.detail}>{t('customers.lastInvoice').replace('{date}', day(card.totals.last_invoice_date))}</Text>
                  )}

                  {card.open_receivables.length > 0 && (
                    <>
                      <Text style={styles.sectionTitle}>{t('customers.openDebts')}</Text>
                      {card.open_receivables.map((debt) => (
                        <View key={debt.id} style={styles.line}>
                          <Text style={[styles.lineText, { flex: 1 }]} numberOfLines={1}>{debt.description || '—'}</Text>
                          <Text style={[styles.lineText, debt.overdue && { color: COLORS.danger }]}>
                            {money(debt.left)}{debt.due_date ? ` · ${day(debt.due_date)}` : ''}
                          </Text>
                        </View>
                      ))}
                    </>
                  )}

                  <Text style={styles.sectionTitle}>{t('customers.documents')}</Text>
                  {card.documents.length === 0 && <Text style={styles.detail}>{t('customers.noDocuments')}</Text>}
                  {card.documents.map((doc) => (
                    <View key={doc.id} style={[styles.line, doc.cancelled && { opacity: 0.5 }]}>
                      <Text style={[styles.lineText, { flex: 1 }]} numberOfLines={1}>
                        {docLabel(doc)}{doc.cancelled ? ` · ${t('billingDocuments.cancelled')}` : ''}
                      </Text>
                      <Text style={styles.lineText}>{money(doc.total_amount)} · {day(doc.issue_date)}</Text>
                    </View>
                  ))}
                  <TouchableOpacity style={styles.linkButton} onPress={() => { setCard(null); router.push('/billing-documents'); }}>
                    <Ionicons name="document-text-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.linkText}>{t('customers.toDocuments')}</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </BottomSheet>

            <BottomSheet visible={formVisible} onClose={() => setFormVisible(false)}>
              <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.sheetTitle}>{editing ? t('customers.edit') : t('customers.add')}</Text>
                {FIELDS.map((field) => (
                  <View key={field.key}>
                    <Text style={styles.inputLabel}>{t(field.label)}{field.key === 'name' ? ' *' : ''}</Text>
                    <TextInput
                      style={[styles.input, field.key === 'notes' && { minHeight: 60 }]}
                      value={String(form[field.key] || '')}
                      onChangeText={(value) => setForm((prev) => ({ ...prev, [field.key]: value }))}
                      keyboardType={field.keyboard}
                      autoCapitalize={field.key === 'email' ? 'none' : 'sentences'}
                      multiline={field.key === 'notes'}
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>
                ))}
                <TouchableOpacity style={styles.saveButton} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setFormVisible(false)}>
                  <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </ScrollView>
            </BottomSheet>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white', flex: 1, textAlign: 'center' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 10,
    backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, color: 'white', paddingVertical: 10, fontSize: 14 },
  content: { flex: 1, paddingHorizontal: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 20 },
  emptyText: { color: COLORS.textMuted, fontSize: 14, marginTop: 12 },
  emptyHint: { color: COLORS.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center', lineHeight: 17 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8,
  },
  name: { color: 'white', fontSize: 15, fontWeight: '600' },
  meta: { color: COLORS.textMuted, fontSize: 12, marginTop: 3 },
  cardLoading: { position: 'absolute', top: '50%', alignSelf: 'center' },
  sheet: { padding: 20 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 6 },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: 'bold', color: 'white', marginBottom: 6 },
  detail: { color: COLORS.textSecondary, fontSize: 13, marginTop: 3 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 6 },
  stat: { flex: 1, backgroundColor: COLORS.background, borderRadius: 10, padding: 12 },
  statLabel: { color: COLORS.textMuted, fontSize: 12 },
  statValue: { color: 'white', fontSize: 17, fontWeight: 'bold', marginTop: 4 },
  statHint: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  sectionTitle: { color: 'white', fontSize: 14, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  lineText: { color: COLORS.textSecondary, fontSize: 13 },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  linkText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  inputLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, color: 'white', fontSize: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  saveButton: { backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  saveButtonText: { color: 'white', fontWeight: 'bold', fontSize: 15 },
  cancelButton: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  cancelButtonText: { color: COLORS.textSecondary, fontSize: 14 },
});

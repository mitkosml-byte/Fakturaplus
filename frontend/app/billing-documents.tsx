import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ImageBackground,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { downloadAndShareFile } from '../src/utils/downloadFile';
import { api } from '../src/services/api';
import { BillingDocument, BillingDocumentItem } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet, Expandable, AnimatedEmptyIcon, SkeletonRow } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

type FormItem = { name: string; quantity: string; unit: string; unit_price: string };
const emptyFormItem = (): FormItem => ({ name: '', quantity: '1', unit: 'бр.', unit_price: '' });

// Module 7, Finding #3 (decided): a non-fiscal bill/quote - never a
// sequentially-numbered VAT invoice. A "bill" automatically creates a
// receivable (see /receivables); a "quote" never does.
export default function BillingDocumentsScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('add_revenue');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [documents, setDocuments] = useState<BillingDocument[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [docType, setDocType] = useState<'quote' | 'bill'>('bill');
  const [formCustomerName, setFormCustomerName] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formItems, setFormItems] = useState<FormItem[]>([emptyFormItem()]);
  const [customerNameError, setCustomerNameError] = useState(false);
  const [itemsError, setItemsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      setDocuments(await api.getBillingDocuments());
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const resetForm = () => {
    setDocType('bill');
    setFormCustomerName('');
    setFormNotes('');
    setFormItems([emptyFormItem()]);
    setCustomerNameError(false);
    setItemsError(false);
  };

  const updateFormItem = (index: number, patch: Partial<FormItem>) => {
    setFormItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const addFormItem = () => setFormItems((prev) => [...prev, emptyFormItem()]);
  const removeFormItem = (index: number) => setFormItems((prev) => prev.filter((_, i) => i !== index));

  // Ranks line items from this business's OWN past quotes/bills by how
  // often each recurs, so a repeat product line (same name, unit, price
  // charged to customers) is one tap instead of retyped - reuses the
  // `documents` list already loaded for the history view below, no extra
  // request needed.
  const itemDirectory = useMemo(() => {
    const byKey = new Map<string, { name: string; unit: string; unit_price: number; count: number; date: string }>();
    documents.forEach((doc) => {
      doc.items.forEach((it) => {
        const key = it.name.trim().toLowerCase();
        if (!key) return;
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, { name: it.name.trim(), unit: it.unit, unit_price: it.unit_price, count: 1, date: doc.issue_date });
        } else {
          existing.count += 1;
          if (doc.issue_date >= existing.date) {
            existing.name = it.name.trim();
            existing.unit = it.unit;
            existing.unit_price = it.unit_price;
            existing.date = doc.issue_date;
          }
        }
      });
    });
    return Array.from(byKey.values()).sort((a, b) => b.count - a.count || (a.date < b.date ? 1 : -1));
  }, [documents]);

  const itemMatches = (name: string) => {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    return itemDirectory.filter((it) => it.name.toLowerCase() !== q && it.name.toLowerCase().includes(q)).slice(0, 5);
  };

  const formTotal = formItems.reduce((sum, it) => {
    const qty = parseFloat(it.quantity) || 0;
    const price = parseFloat(it.unit_price) || 0;
    return sum + qty * price;
  }, 0);

  const handleSave = async () => {
    const missingName = !formCustomerName.trim();
    const validItems: BillingDocumentItem[] = formItems
      .filter((it) => it.name.trim() && parseFloat(it.unit_price) >= 0 && parseFloat(it.quantity) > 0)
      .map((it) => ({ name: it.name.trim(), quantity: parseFloat(it.quantity), unit: it.unit || 'бр.', unit_price: parseFloat(it.unit_price) }));
    setCustomerNameError(missingName);
    setItemsError(validItems.length === 0);
    if (missingName || validItems.length === 0) return;

    setSaving(true);
    try {
      await api.createBillingDocument({
        doc_type: docType,
        customer_name: formCustomerName.trim(),
        items: validItems,
        notes: formNotes.trim() || undefined,
      });
      Haptics.success();
      Toast.success(docType === 'bill' ? t('billingDocuments.billSaved') : t('billingDocuments.quoteSaved'));
      setModalVisible(false);
      resetForm();
      loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async (doc: BillingDocument) => {
    setDownloadingId(doc.id);
    try {
      await downloadAndShareFile(api.getBillingDocumentPdfUrl(doc.id), `${doc.doc_type}_${doc.id.slice(0, 8)}.pdf`);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('billingDocuments.downloadError'));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = (doc: BillingDocument) => {
    Alert.alert(t('common.delete'), t('billingDocuments.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteBillingDocument(doc.id);
            Toast.success(t('billingDocuments.deleted'));
            loadData();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  if (!canManage) {
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
            <Text style={styles.title}>{t('billingDocuments.title')}</Text>
            <TouchableOpacity
              onPress={() => { resetForm(); setModalVisible(true); }}
              style={styles.backButton}
              accessibilityLabel={t('billingDocuments.add')}
            >
              <Ionicons name="add" size={24} color="white" />
            </TouchableOpacity>
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
              {documents.length === 0 && (
                <View style={styles.emptyContainer}>
                  <AnimatedEmptyIcon name="document-text-outline" size={64} color={COLORS.border} />
                  <Text style={styles.emptyText}>{t('billingDocuments.empty')}</Text>
                </View>
              )}
              {documents.map((doc) => (
                <View key={doc.id} style={styles.card}>
                  <View style={styles.rowTop}>
                    <View style={[styles.typeBadge, doc.doc_type === 'bill' && styles.typeBadgeBill]}>
                      <Text style={styles.typeBadgeText}>
                        {doc.doc_type === 'bill' ? t('billingDocuments.typeBill') : t('billingDocuments.typeQuote')}
                      </Text>
                    </View>
                    <Text style={styles.amount}>{doc.total_amount.toFixed(2)} €</Text>
                  </View>
                  <Text style={styles.customerName} numberOfLines={1}>{doc.customer_name}</Text>
                  <View style={styles.rowBottom}>
                    <Text style={styles.date}>{format(new Date(doc.issue_date), 'd MMM yyyy', { locale: dateLocale })}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      <TouchableOpacity onPress={() => handleDownload(doc)} disabled={downloadingId === doc.id} hitSlop={8}>
                        {downloadingId === doc.id ? (
                          <ActivityIndicator size="small" color={COLORS.primary} />
                        ) : (
                          <Ionicons name="download-outline" size={18} color={COLORS.primary} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(doc)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          <BottomSheet visible={modalVisible} onClose={() => { setModalVisible(false); resetForm(); }}>
            <View style={styles.modalContent}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>{t('billingDocuments.addNew')}</Text>

                <View style={styles.typeSelector}>
                  {(['bill', 'quote'] as const).map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.typeOption, docType === opt && styles.typeOptionActive]}
                      onPress={() => setDocType(opt)}
                    >
                      <Text style={[styles.typeOptionText, docType === opt && styles.typeOptionTextActive]}>
                        {opt === 'bill' ? t('billingDocuments.typeBill') : t('billingDocuments.typeQuote')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.inputLabel}>{t('receivables.customerName')}</Text>
                <TextInput
                  style={[styles.input, customerNameError && styles.inputErrorBorder]}
                  value={formCustomerName}
                  onChangeText={(v) => { setFormCustomerName(v); setCustomerNameError(false); }}
                  placeholder={t('receivables.customerNamePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                />
                <Expandable expanded={customerNameError}>
                  <Text style={styles.fieldErrorText}>{t('common.required')}</Text>
                </Expandable>

                <Text style={styles.inputLabel}>{t('billingDocuments.items')}</Text>
                {formItems.map((item, index) => (
                  <View key={index} style={styles.itemRow}>
                    <TextInput
                      style={[styles.input, styles.itemNameInput]}
                      value={item.name}
                      onChangeText={(v) => updateFormItem(index, { name: v })}
                      placeholder={t('scan.productNamePlaceholder')}
                      placeholderTextColor={COLORS.textMuted}
                    />
                    {itemMatches(item.name).length > 0 && (
                      <View style={styles.itemChipRow}>
                        {itemMatches(item.name).map((match) => (
                          <TouchableOpacity
                            key={match.name}
                            style={styles.itemChip}
                            onPress={() => updateFormItem(index, {
                              name: match.name,
                              unit: match.unit,
                              unit_price: String(match.unit_price),
                            })}
                          >
                            <Text style={styles.itemChipText} numberOfLines={1}>
                              {match.name} · {match.unit_price.toFixed(2)} €
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    <View style={styles.itemRowFields}>
                      <TextInput
                        style={[styles.input, styles.itemSmallInput]}
                        value={item.quantity}
                        onChangeText={(v) => updateFormItem(index, { quantity: v })}
                        keyboardType="decimal-pad"
                        placeholder={t('scan.qtyPlaceholder')}
                        placeholderTextColor={COLORS.textMuted}
                      />
                      <TextInput
                        style={[styles.input, styles.itemSmallInput]}
                        value={item.unit}
                        onChangeText={(v) => updateFormItem(index, { unit: v })}
                        placeholder={t('scan.unitPlaceholder')}
                        placeholderTextColor={COLORS.textMuted}
                      />
                      <TextInput
                        style={[styles.input, styles.itemSmallInput]}
                        value={item.unit_price}
                        onChangeText={(v) => updateFormItem(index, { unit_price: v })}
                        keyboardType="decimal-pad"
                        placeholder={t('scan.pricePlaceholder')}
                        placeholderTextColor={COLORS.textMuted}
                      />
                      {formItems.length > 1 && (
                        <TouchableOpacity onPress={() => removeFormItem(index)}>
                          <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
                <Expandable expanded={itemsError}>
                  <Text style={styles.fieldErrorText}>{t('billingDocuments.itemsRequired')}</Text>
                </Expandable>
                <TouchableOpacity style={styles.addItemButton} onPress={addFormItem}>
                  <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.addItemButtonText}>{t('billingDocuments.addItem')}</Text>
                </TouchableOpacity>

                <Text style={styles.totalPreview}>{t('receivables.amount')}: {formTotal.toFixed(2)} €</Text>

                <Text style={styles.inputLabel}>{t('receivables.description')}</Text>
                <TextInput
                  style={styles.input}
                  value={formNotes}
                  onChangeText={setFormNotes}
                  placeholder={t('receivables.descriptionPlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                />

                <TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.cancelButton} onPress={() => { setModalVisible(false); resetForm(); }}>
                  <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white', flex: 1, textAlign: 'center' },
  content: { flex: 1, paddingHorizontal: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: COLORS.textMuted, fontSize: 14, marginTop: 12 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  typeBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
  },
  typeBadgeBill: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  typeBadgeText: { fontSize: 11, fontWeight: '700', color: 'white' },
  amount: { fontSize: 15, fontWeight: 'bold', color: COLORS.warning },
  customerName: { fontSize: 14, fontWeight: '600', color: 'white', marginBottom: 6 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 12, color: COLORS.textMuted },
  modalContent: { padding: 20, paddingBottom: 30 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: 'white', marginBottom: 16 },
  typeSelector: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeOption: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  typeOptionActive: { backgroundColor: COLORS.primary },
  typeOptionText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  typeOptionTextActive: { color: 'white' },
  inputLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 12,
    color: 'white',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputErrorBorder: { borderColor: COLORS.danger },
  fieldErrorText: { color: COLORS.danger, fontSize: 12, marginTop: 4 },
  itemRow: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  itemNameInput: { marginBottom: 8 },
  itemChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  itemChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxWidth: 220,
  },
  itemChipText: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' },
  itemRowFields: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  itemSmallInput: { flex: 1, paddingVertical: 10 },
  addItemButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addItemButtonText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  totalPreview: { color: 'white', fontSize: 14, fontWeight: '700', marginTop: 6, textAlign: 'right' },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveButtonText: { color: 'white', fontWeight: 'bold', fontSize: 15 },
  cancelButton: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  cancelButtonText: { color: COLORS.textSecondary, fontSize: 14 },
});

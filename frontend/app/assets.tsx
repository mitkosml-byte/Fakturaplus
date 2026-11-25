import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  RefreshControl,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import DateTimePickerModal from '../src/components/AppDateTimePicker';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { FixedAsset, AssetCategory, AssetCategoryInfo, AssetsSummary, LinkableInvoice } from '../src/types';
import { format, parseISO } from 'date-fns';
import { useTranslation, useLanguageStore } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter } from '../src/components';
import ExcelImportModal from '../src/components/ExcelImportModal';
import { COLORS } from '../src/theme/colors';
import { formatMoney, parseAmount, readAmount } from '../src/utils/money';

const CATEGORY_SHORT_LABELS: Record<AssetCategory, string> = {
  cat_i: 'I · Сгради',
  cat_ii: 'II · Машини',
  cat_iii: 'III · Превозни ср.',
  cat_iv: 'IV · Компютри/софтуер',
  cat_v: 'V · Автомобили',
  cat_vi: 'VI · Огранич. срок',
  cat_vii: 'VII · Други',
};

const STATUS_COLORS: Record<string, string> = {
  active: COLORS.success,
  fully_depreciated: COLORS.textMuted,
  disposed: COLORS.danger,
};

const emptyAssetForm = () => ({
  name: '',
  category: 'cat_vii' as AssetCategory,
  acquisition_value: '',
  annual_depreciation_rate_percent: '',
  responsible_person: '',
  notes: '',
});

export default function AssetsScreen() {
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();
  const { language } = useLanguageStore();
  const router = useRouter();

  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [categories, setCategories] = useState<AssetCategoryInfo[]>([]);
  const [summary, setSummary] = useState<AssetsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [assetModalVisible, setAssetModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [editingAsset, setEditingAsset] = useState<FixedAsset | null>(null);
  const [assetForm, setAssetForm] = useState(emptyAssetForm());
  const [acquisitionDate, setAcquisitionDate] = useState(new Date());
  const [inServiceDate, setInServiceDate] = useState(new Date());
  const [isAcqDatePickerVisible, setAcqDatePickerVisible] = useState(false);
  const [isServiceDatePickerVisible, setServiceDatePickerVisible] = useState(false);
  const [assetImage, setAssetImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The purchase invoice: linked, it stops being an expense of its day.
  const params = useLocalSearchParams<{ fromInvoice?: string }>();
  const canLinkInvoices = hasPermission('manage_invoices');
  const [linkedInvoice, setLinkedInvoice] = useState<{ id: string; label: string } | null>(null);
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceCandidates, setInvoiceCandidates] = useState<LinkableInvoice[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const [disposeModalVisible, setDisposeModalVisible] = useState(false);
  const [disposalDate, setDisposalDate] = useState(new Date());
  const [isDisposalDatePickerVisible, setDisposalDatePickerVisible] = useState(false);
  const [disposalReason, setDisposalReason] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [assetsData, categoriesData, summaryData] = await Promise.all([
        api.getAssets(),
        api.getAssetCategories(),
        api.getAssetsSummary(),
      ]);
      setAssets(assetsData);
      setCategories(categoriesData.categories);
      setSummary(summaryData);
    } catch (error) {
      console.error('Error loading assets:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const categoryMaxRate = (category: AssetCategory) =>
    categories.find((c) => c.value === category)?.max_rate;

  const categoryLabel = (category: AssetCategory) =>
    categories.find((c) => c.value === category)?.label || CATEGORY_SHORT_LABELS[category];

  const openNewAsset = () => {
    setEditingAsset(null);
    setAssetForm(emptyAssetForm());
    setAcquisitionDate(new Date());
    setInServiceDate(new Date());
    setAssetImage(null);
    setLinkedInvoice(null);
    setInvoicePickerOpen(false);
    setAssetModalVisible(true);
  };

  const invoiceLabel = (inv: LinkableInvoice) => `${inv.supplier} № ${inv.invoice_number}`;

  // Picking the purchase invoice also fills what is still empty: the name
  // from its first line, the value from its total, both dates from its date.
  const applyInvoice = (inv: LinkableInvoice, isNew: boolean) => {
    setLinkedInvoice({ id: inv.id, label: invoiceLabel(inv) });
    setInvoicePickerOpen(false);
    setAssetForm((p) => ({
      ...p,
      name: p.name || inv.first_item || '',
      acquisition_value: p.acquisition_value || String(inv.total_amount),
    }));
    if (isNew && inv.date) {
      setAcquisitionDate(parseISO(inv.date));
      setInServiceDate(parseISO(inv.date));
    }
  };

  const searchInvoices = useCallback(async (search: string) => {
    setLoadingCandidates(true);
    try {
      setInvoiceCandidates(await api.getLinkableInvoices({ search }));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoadingCandidates(false);
    }
  }, [t]);

  const openInvoicePicker = () => {
    setInvoicePickerOpen(true);
    searchInvoices(invoiceSearch);
  };

  // "Record as an asset" from an invoice's details.
  useEffect(() => {
    const invoiceId = params.fromInvoice;
    if (!invoiceId || !canLinkInvoices) return;
    api.getLinkableInvoices({ invoiceId })
      .then((found) => {
        if (!found.length) return;
        openNewAsset();
        applyInvoice(found[0], true);
      })
      .catch(() => {});
    // Once per invoice id it was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.fromInvoice]);

  const openEditAsset = (asset: FixedAsset) => {
    setEditingAsset(asset);
    setAssetForm({
      name: asset.name,
      category: asset.category,
      acquisition_value: String(asset.acquisition_value),
      annual_depreciation_rate_percent: String(asset.annual_depreciation_rate_percent),
      responsible_person: asset.responsible_person || '',
      notes: asset.notes || '',
    });
    setAcquisitionDate(new Date(asset.acquisition_date));
    setInServiceDate(new Date(asset.in_service_date));
    setAssetImage(asset.image_base64 || null);
    setLinkedInvoice(asset.invoice_id ? { id: asset.invoice_id, label: asset.invoice_label || '' } : null);
    setInvoicePickerOpen(false);
    setAssetModalVisible(true);
  };

  const selectCategory = (category: AssetCategory) => {
    const maxRate = categoryMaxRate(category);
    setAssetForm((p) => ({
      ...p,
      category,
      annual_depreciation_rate_percent: maxRate !== undefined ? String(maxRate) : p.annual_depreciation_rate_percent,
    }));
  };

  const pickAssetImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0].base64) {
      setAssetImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const saveAsset = async () => {
    if (!assetForm.name.trim() || !assetForm.acquisition_value) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }
    setSaving(true);
    const payload = {
      name: assetForm.name.trim(),
      category: assetForm.category,
      acquisition_date: format(acquisitionDate, 'yyyy-MM-dd'),
      in_service_date: format(inServiceDate, 'yyyy-MM-dd'),
      acquisition_value: parseAmount(assetForm.acquisition_value),
      annual_depreciation_rate_percent: assetForm.annual_depreciation_rate_percent
        ? readAmount(assetForm.annual_depreciation_rate_percent)
        : undefined,
      responsible_person: assetForm.responsible_person.trim() || undefined,
      notes: assetForm.notes.trim() || undefined,
      image_base64: assetImage || undefined,
      // "" removes a link the asset had; undefined leaves things as they are.
      invoice_id: linkedInvoice ? linkedInvoice.id : (editingAsset?.invoice_id ? '' : undefined),
    };
    try {
      if (editingAsset) {
        await api.updateAsset(editingAsset.id, payload);
      } else {
        await api.createAsset(payload);
      }
      setAssetModalVisible(false);
      await loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteAsset = (asset: FixedAsset) => {
    Alert.alert(
      t('assets.deleteAsset'),
      t('assets.deleteAssetConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteAsset(asset.id);
              setAssetModalVisible(false);
              await loadData();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            }
          },
        },
      ]
    );
  };

  const openDispose = () => {
    setDisposalDate(new Date());
    setDisposalReason('');
    setDisposeModalVisible(true);
  };

  const confirmDispose = async () => {
    if (!editingAsset) return;
    try {
      await api.disposeAsset(editingAsset.id, {
        disposal_date: format(disposalDate, 'yyyy-MM-dd'),
        disposal_reason: disposalReason.trim() || undefined,
      });
      setDisposeModalVisible(false);
      setAssetModalVisible(false);
      await loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  const statusLabel = (status: string) => {
    if (status === 'fully_depreciated') return t('assets.statusFullyDepreciated');
    if (status === 'disposed') return t('assets.statusDisposed');
    return t('assets.statusActive');
  };

  if (!hasPermission('manage_budget')) {
    return <AccessDenied />;
  }

  return (
    <ScreenEnter>
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('assets.title')}</Text>
          <TouchableOpacity onPress={() => setImportModalVisible(true)} style={styles.backButton} accessibilityLabel={t('import.button')}>
            <Ionicons name="cloud-upload-outline" size={22} color="white" />
          </TouchableOpacity>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{t('assets.netBookValue')}</Text>
          <Text style={styles.summaryValue}>{formatMoney((summary?.total_net_book_value || 0))}</Text>
          <View style={styles.summaryRow}>
            <View style={styles.summarySubItem}>
              <Text style={styles.summarySubLabel}>{t('assets.acquisitionValue')}</Text>
              <Text style={styles.summarySubValue}>{formatMoney((summary?.total_acquisition_value || 0))}</Text>
            </View>
            <View style={styles.summarySubItem}>
              <Text style={styles.summarySubLabel}>{t('assets.accumulatedDepreciation')}</Text>
              <Text style={styles.summarySubValue}>{formatMoney((summary?.total_accumulated_depreciation || 0))}</Text>
            </View>
            <View style={styles.summarySubItem}>
              <Text style={styles.summarySubLabel}>{t('assets.monthlyDepreciation')}</Text>
              <Text style={styles.summarySubValue}>{formatMoney((summary?.monthly_depreciation_total || 0))}</Text>
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.warning} />}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('assets.summaryTitle')} ({summary?.active_count || 0})</Text>
            <TouchableOpacity style={styles.addButton} onPress={openNewAsset}>
              <Ionicons name="add" size={22} color="white" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.warning} />
            </View>
          ) : assets.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="business-outline" size={56} color={COLORS.border} />
              <Text style={styles.emptyText}>{t('assets.noAssets')}</Text>
              <Text style={styles.emptyHint}>{t('assets.noAssetsHint')}</Text>
            </View>
          ) : (
            assets.map((asset) => (
              <TouchableOpacity key={asset.id} style={styles.assetCard} onPress={() => openEditAsset(asset)}>
                <View style={styles.assetCardMain}>
                  <View style={styles.assetAvatar}>
                    <Ionicons name="business" size={20} color={COLORS.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assetName}>{asset.name}</Text>
                    <Text style={styles.assetMeta}>
                      {asset.inventory_number} · {CATEGORY_SHORT_LABELS[asset.category]}
                    </Text>
                    {asset.invoice_label ? (
                      <Text style={styles.assetMeta} numberOfLines={1}>
                        {t('assets.invoiceShort')}: {asset.invoice_label}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: `${STATUS_COLORS[asset.status]}22` }]}>
                    <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[asset.status] }]}>
                      {statusLabel(asset.status)}
                    </Text>
                  </View>
                </View>
                <View style={styles.assetFigures}>
                  <View style={styles.assetFigureItem}>
                    <Text style={styles.assetFigureLabel}>{t('assets.netBookValue')}</Text>
                    <Text style={styles.assetFigureValue}>{formatMoney(asset.net_book_value)}</Text>
                  </View>
                  <View style={styles.assetFigureItem}>
                    <Text style={styles.assetFigureLabel}>{t('assets.monthlyDepreciation')}</Text>
                    <Text style={styles.assetFigureValue}>{formatMoney(asset.monthly_depreciation)}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Asset Modal */}
      <Modal visible={assetModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} style={{ width: '100%' }}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{editingAsset ? t('assets.editAsset') : t('assets.newAsset')}</Text>

              <Text style={styles.inputLabel}>{t('assets.name')} *</Text>
              <TextInput
                style={styles.input}
                value={assetForm.name}
                onChangeText={(v) => setAssetForm((p) => ({ ...p, name: v }))}
                placeholder={t('assets.namePlaceholder')}
                placeholderTextColor={COLORS.textMuted}
              />

              <Text style={styles.inputLabel}>{t('assets.category')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.categoryRow}
                contentContainerStyle={styles.categoryRowContent}
              >
                {(Object.keys(CATEGORY_SHORT_LABELS) as AssetCategory[]).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.categoryChip, assetForm.category === cat && styles.categoryChipActive]}
                    onPress={() => selectCategory(cat)}
                  >
                    <Text style={[styles.categoryChipText, assetForm.category === cat && styles.categoryChipTextActive]}>
                      {CATEGORY_SHORT_LABELS[cat]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={styles.categoryFullLabel}>{categoryLabel(assetForm.category)}</Text>

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>{t('assets.acquisitionDate')}</Text>
                  <TouchableOpacity style={styles.dateInputButton} onPress={() => setAcqDatePickerVisible(true)}>
                    <Ionicons name="calendar" size={16} color={COLORS.warning} />
                    <Text style={styles.dateInputText}>{format(acquisitionDate, 'd.MM.yyyy')}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>{t('assets.inServiceDate')}</Text>
                  <TouchableOpacity style={styles.dateInputButton} onPress={() => setServiceDatePickerVisible(true)}>
                    <Ionicons name="calendar" size={16} color={COLORS.warning} />
                    <Text style={styles.dateInputText}>{format(inServiceDate, 'd.MM.yyyy')}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <DateTimePickerModal
                isVisible={isAcqDatePickerVisible}
                mode="date"
                date={acquisitionDate}
                onConfirm={(date) => { setAcquisitionDate(date); setAcqDatePickerVisible(false); }}
                onCancel={() => setAcqDatePickerVisible(false)}
                confirmTextIOS={t('common.select')}
                cancelTextIOS={t('common.cancel')}
                locale={language}
              />
              <DateTimePickerModal
                isVisible={isServiceDatePickerVisible}
                mode="date"
                date={inServiceDate}
                onConfirm={(date) => { setInServiceDate(date); setServiceDatePickerVisible(false); }}
                onCancel={() => setServiceDatePickerVisible(false)}
                confirmTextIOS={t('common.select')}
                cancelTextIOS={t('common.cancel')}
                locale={language}
              />

              <Text style={styles.inputLabel}>{t('assets.acquisitionValue')} *</Text>
              <TextInput
                style={styles.input}
                value={assetForm.acquisition_value}
                onChangeText={(v) => setAssetForm((p) => ({ ...p, acquisition_value: v }))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={COLORS.textMuted}
              />
              <Text style={styles.lowValueHint}>{t('assets.lowValueHint')}</Text>

              {canLinkInvoices && (
                <View style={styles.invoiceLinkBox}>
                  <Text style={styles.inputLabel}>{t('assets.purchaseInvoice')}</Text>
                  {linkedInvoice ? (
                    <View style={styles.invoiceLinkedRow}>
                      <Ionicons name="document-text" size={16} color={COLORS.primary} />
                      <Text style={styles.invoiceLinkedText} numberOfLines={1}>{linkedInvoice.label}</Text>
                      <TouchableOpacity onPress={() => setLinkedInvoice(null)} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ) : invoicePickerOpen ? (
                    <View>
                      <TextInput
                        style={styles.input}
                        value={invoiceSearch}
                        onChangeText={(v) => { setInvoiceSearch(v); searchInvoices(v); }}
                        placeholder={t('assets.invoiceSearchPlaceholder')}
                        placeholderTextColor={COLORS.textMuted}
                      />
                      {loadingCandidates ? (
                        <ActivityIndicator color={COLORS.warning} style={{ marginVertical: 8 }} />
                      ) : invoiceCandidates.length === 0 ? (
                        <Text style={styles.fieldHint}>{t('assets.noInvoicesFound')}</Text>
                      ) : (
                        invoiceCandidates.slice(0, 8).map((inv) => {
                          const taken = !!inv.asset_id && inv.asset_id !== editingAsset?.id;
                          return (
                            <TouchableOpacity
                              key={inv.id}
                              style={[styles.invoiceCandidate, taken && { opacity: 0.45 }]}
                              disabled={taken}
                              onPress={() => applyInvoice(inv, !editingAsset)}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={styles.invoiceCandidateTitle} numberOfLines={1}>{invoiceLabel(inv)}</Text>
                                <Text style={styles.invoiceCandidateMeta} numberOfLines={1}>
                                  {inv.date ? format(parseISO(inv.date), 'd MMM yyyy', { locale: dateLocale }) : ''}
                                  {inv.first_item ? ` · ${inv.first_item}` : ''}
                                  {taken ? ` · ${t('assets.invoiceTaken')}` : ''}
                                </Text>
                              </View>
                              <Text style={styles.invoiceCandidateAmount}>{formatMoney(inv.total_amount)}</Text>
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.attachButton} onPress={openInvoicePicker}>
                      <Ionicons name="link-outline" size={18} color={COLORS.warning} />
                      <Text style={styles.attachButtonText}>{t('assets.linkInvoice')}</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={styles.fieldHint}>{t('assets.purchaseInvoiceHint')}</Text>
                </View>
              )}

              <Text style={styles.inputLabel}>{t('assets.depreciationRate')}</Text>
              <TextInput
                style={styles.input}
                value={assetForm.annual_depreciation_rate_percent}
                onChangeText={(v) => setAssetForm((p) => ({ ...p, annual_depreciation_rate_percent: v }))}
                keyboardType="decimal-pad"
                placeholderTextColor={COLORS.textMuted}
              />
              <Text style={styles.fieldHint}>{t('assets.depreciationRateHint')}</Text>

              <Text style={styles.inputLabel}>{t('assets.responsiblePerson')}</Text>
              <TextInput
                style={styles.input}
                value={assetForm.responsible_person}
                onChangeText={(v) => setAssetForm((p) => ({ ...p, responsible_person: v }))}
                placeholder={t('assets.responsiblePersonPlaceholder')}
                placeholderTextColor={COLORS.textMuted}
              />

              <Text style={styles.inputLabel}>{t('assets.notes')}</Text>
              <TextInput
                style={styles.input}
                value={assetForm.notes}
                onChangeText={(v) => setAssetForm((p) => ({ ...p, notes: v }))}
                placeholderTextColor={COLORS.textMuted}
              />

              <TouchableOpacity style={styles.attachButton} onPress={pickAssetImage}>
                <Ionicons name="image-outline" size={18} color={COLORS.warning} />
                <Text style={styles.attachButtonText}>
                  {assetImage ? t('assets.photoAttached') : t('assets.attachPhoto')}
                </Text>
              </TouchableOpacity>

              {editingAsset && (
                <View style={styles.previewCard}>
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>{t('assets.accumulatedDepreciation')}</Text>
                    <Text style={styles.previewValue}>{formatMoney(editingAsset.accumulated_depreciation)}</Text>
                  </View>
                  <View style={[styles.previewRow, styles.previewRowHighlight]}>
                    <Text style={styles.previewLabelBold}>{t('assets.netBookValue')}</Text>
                    <Text style={styles.previewValueBold}>{formatMoney(editingAsset.net_book_value)}</Text>
                  </View>
                </View>
              )}

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setAssetModalVisible(false)}>
                  <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveBtn} onPress={saveAsset} disabled={saving}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.modalSaveText}>{t('common.save')}</Text>}
                </TouchableOpacity>
              </View>

              {editingAsset && editingAsset.status !== 'disposed' && (
                <TouchableOpacity style={styles.disposeButton} onPress={openDispose}>
                  <Ionicons name="archive-outline" size={16} color={COLORS.warning} />
                  <Text style={styles.disposeButtonText}>{t('assets.dispose')}</Text>
                </TouchableOpacity>
              )}

              {editingAsset && (
                <TouchableOpacity style={styles.deleteAssetButton} onPress={() => deleteAsset(editingAsset)}>
                  <Ionicons name="trash" size={16} color={COLORS.danger} />
                  <Text style={styles.deleteAssetText}>{t('assets.deleteAsset')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Dispose Modal */}
      <Modal visible={disposeModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('assets.disposeConfirmTitle')}</Text>

            <Text style={styles.inputLabel}>{t('assets.disposalDate')}</Text>
            <TouchableOpacity style={styles.dateInputButton} onPress={() => setDisposalDatePickerVisible(true)}>
              <Ionicons name="calendar" size={16} color={COLORS.warning} />
              <Text style={styles.dateInputText}>{format(disposalDate, 'd.MM.yyyy')}</Text>
            </TouchableOpacity>
            <DateTimePickerModal
              isVisible={isDisposalDatePickerVisible}
              mode="date"
              date={disposalDate}
              onConfirm={(date) => { setDisposalDate(date); setDisposalDatePickerVisible(false); }}
              onCancel={() => setDisposalDatePickerVisible(false)}
              confirmTextIOS={t('common.select')}
              cancelTextIOS={t('common.cancel')}
              locale={language}
            />

            <Text style={styles.inputLabel}>{t('assets.disposalReason')}</Text>
            <TextInput
              style={styles.input}
              value={disposalReason}
              onChangeText={setDisposalReason}
              placeholder={t('assets.disposalReasonPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setDisposeModalVisible(false)}>
                <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={confirmDispose}>
                <Text style={styles.modalSaveText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ExcelImportModal
        visible={importModalVisible}
        onClose={() => setImportModalVisible(false)}
        entity="assets"
        title={t('import.button')}
        fields={[
          { key: 'name', label: t('assets.name') },
          { key: 'category', label: t('assets.category') },
          { key: 'acquisition_value', label: t('assets.acquisitionValue'), format: (v) => `${formatMoney(Number(v))}` },
        ]}
        onImported={loadData}
      />
    </View>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  invoiceLinkBox: {
    marginTop: 4,
  },
  invoiceLinkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  invoiceLinkedText: {
    flex: 1,
    color: COLORS.textLight,
    fontSize: 14,
  },
  invoiceCandidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  invoiceCandidateTitle: {
    color: COLORS.textLight,
    fontSize: 13,
    fontWeight: '600',
  },
  invoiceCandidateMeta: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  invoiceCandidateAmount: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  container: { flex: 1, backgroundColor: COLORS.background },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
  },
  backButton: { padding: 8, width: 40 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  summaryCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  summaryLabel: { fontSize: 12, color: COLORS.textSecondary },
  summaryValue: { fontSize: 24, fontWeight: 'bold', color: COLORS.warning, marginTop: 4 },
  summaryRow: { flexDirection: 'row', marginTop: 14, width: '100%' },
  summarySubItem: { flex: 1, alignItems: 'center' },
  summarySubLabel: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
  summarySubValue: { fontSize: 13, fontWeight: '600', color: 'white', marginTop: 2 },
  content: { flex: 1, paddingHorizontal: 16 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: 'white' },
  addButton: { backgroundColor: COLORS.warning, borderRadius: 20, padding: 6 },
  loadingContainer: { paddingVertical: 40, alignItems: 'center' },
  emptyContainer: { alignItems: 'center', paddingVertical: 50 },
  emptyText: { fontSize: 16, color: COLORS.textMuted, marginTop: 14 },
  emptyHint: { fontSize: 13, color: COLORS.borderLight, marginTop: 6, textAlign: 'center', paddingHorizontal: 24 },
  assetCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 12 },
  assetCardMain: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  assetAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  assetName: { fontSize: 16, fontWeight: '600', color: 'white' },
  assetMeta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: '600' },
  assetFigures: { flexDirection: 'row', backgroundColor: COLORS.background, borderRadius: 10, padding: 12 },
  assetFigureItem: { flex: 1 },
  assetFigureLabel: { fontSize: 12, color: COLORS.textSecondary },
  assetFigureValue: { fontSize: 14, fontWeight: '600', color: 'white', marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 22 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: 'white', textAlign: 'center' },
  inputLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: COLORS.background, borderRadius: 10, padding: 12, color: 'white', fontSize: 15 },
  row2: { flexDirection: 'row', gap: 12 },
  categoryRow: { marginTop: 2, height: 40, flexGrow: 0, flexShrink: 0 },
  categoryRowContent: { alignItems: 'center', gap: 8 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.background },
  categoryChipActive: { backgroundColor: COLORS.warning },
  categoryChipText: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '500' },
  categoryChipTextActive: { color: 'white' },
  categoryFullLabel: { fontSize: 12, color: COLORS.textMuted, marginTop: 8, lineHeight: 15 },
  dateInputButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.background, borderRadius: 10, padding: 12,
  },
  dateInputText: { color: 'white', fontSize: 13 },
  lowValueHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 6, lineHeight: 15 },
  fieldHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 6 },
  attachButton: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, alignSelf: 'flex-start' },
  attachButtonText: { fontSize: 13, color: COLORS.warning, fontWeight: '500' },
  previewCard: { backgroundColor: COLORS.background, borderRadius: 12, padding: 14, marginTop: 16 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  previewRowHighlight: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 8, marginTop: 4, marginBottom: 0 },
  previewLabel: { fontSize: 12, color: COLORS.textSecondary },
  previewValue: { fontSize: 13, color: 'white', fontWeight: '500' },
  previewLabelBold: { fontSize: 13, color: 'white', fontWeight: '700' },
  previewValueBold: { fontSize: 15, color: 'white', fontWeight: '700' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancelBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: COLORS.border, alignItems: 'center' },
  modalCancelText: { color: 'white', fontSize: 15, fontWeight: '500' },
  modalSaveBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: COLORS.warning, alignItems: 'center' },
  modalSaveText: { color: 'white', fontSize: 15, fontWeight: '600' },
  disposeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, padding: 10 },
  disposeButtonText: { color: COLORS.warning, fontSize: 13, fontWeight: '500' },
  deleteAssetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, padding: 10 },
  deleteAssetText: { color: COLORS.danger, fontSize: 13, fontWeight: '500' },
});

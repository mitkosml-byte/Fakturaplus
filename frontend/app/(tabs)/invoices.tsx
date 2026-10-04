import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Modal,
  ImageBackground,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import DateTimePickerModal from '../../src/components/AppDateTimePicker';
import { Alert } from '../../src/utils/alert';
import { Toast } from '../../src/utils/toast';
import { Haptics } from '../../src/utils/haptics';
import { api } from '../../src/services/api';
import { Invoice, VatTreatment } from '../../src/types';
import { validateEikFormat } from '../../src/utils/eik';
import { format } from 'date-fns';
import { downloadAndShareFile } from '../../src/utils/downloadFile';
import { useTranslation, useLanguageStore } from '../../src/i18n';
import ExcelImportModal from '../../src/components/ExcelImportModal';
import { ScanCreditsBadge } from '../../src/components';
import { COLORS } from '../../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

type PeriodPreset = 'all' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear' | 'custom';

function getPeriodRange(
  preset: PeriodPreset,
  customStart: Date,
  customEnd: Date
): { start?: string; end?: string } {
  const now = new Date();
  switch (preset) {
    case 'thisMonth':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        end: now.toISOString(),
      };
    case 'lastMonth':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString(),
      };
    case 'last3Months':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString(),
        end: now.toISOString(),
      };
    case 'thisYear':
      return {
        start: new Date(now.getFullYear(), 0, 1).toISOString(),
        end: now.toISOString(),
      };
    case 'custom':
      return { start: customStart.toISOString(), end: customEnd.toISOString() };
    default:
      return {};
  }
}

export default function InvoicesScreen() {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const params = useLocalSearchParams<{ paymentFilter?: string }>();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  // Which of this invoice's items triggered a price-increase alert when it
  // was created - fetched lazily per invoice_id so the item rows can flag
  // "up X% from last purchase" without duplicating that comparison here.
  const [selectedInvoiceAlerts, setSelectedInvoiceAlerts] = useState<any[]>([]);
  const [loadingInvoiceAlerts, setLoadingInvoiceAlerts] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [customStartDate, setCustomStartDate] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [customEndDate, setCustomEndDate] = useState<Date>(new Date());
  const [startPickerVisible, setStartPickerVisible] = useState(false);
  const [endPickerVisible, setEndPickerVisible] = useState(false);
  const [showOnlyEikIssues, setShowOnlyEikIssues] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid' | 'partial' | 'overdue'>('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Lets the Home dashboard's unpaid-invoices reminder deep-link straight
  // into this filter instead of always landing on "all".
  useEffect(() => {
    if (
      params.paymentFilter === 'paid' || params.paymentFilter === 'unpaid' ||
      params.paymentFilter === 'partial' || params.paymentFilter === 'overdue'
    ) {
      setPaymentFilter(params.paymentFilter);
      setFiltersExpanded(true);
    }
  }, [params.paymentFilter]);

  // Reverse-charge suppliers are foreign and don't have a Bulgarian ЕИК,
  // so they're excluded from this check on purpose.
  const hasEikIssue = useCallback((inv: Invoice) => {
    if (inv.vat_treatment === 'reverse_charge') return false;
    return !validateEikFormat(inv.supplier_eik).valid;
  }, []);

  const periodOptions: { key: PeriodPreset; label: string }[] = [
    { key: 'all', label: t('invoices.periodAll') },
    { key: 'thisMonth', label: t('invoices.periodThisMonth') },
    { key: 'lastMonth', label: t('invoices.periodLastMonth') },
    { key: 'last3Months', label: t('invoices.periodLast3Months') },
    { key: 'thisYear', label: t('invoices.periodThisYear') },
    { key: 'custom', label: t('invoices.periodCustom') },
  ];

  const loadInvoices = useCallback(async () => {
    try {
      const { start, end } = getPeriodRange(periodPreset, customStartDate, customEndDate);
      const data = await api.getInvoices({
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(start ? { start_date: start } : {}),
        ...(end ? { end_date: end } : {}),
        ...(paymentFilter !== 'all' ? { payment_status: paymentFilter } : {}),
      });
      setInvoices(data);
    } catch (error) {
      console.error('Error loading invoices:', error);
    }
  }, [searchQuery, periodPreset, customStartDate, customEndDate, paymentFilter]);

  // Tab screens stay mounted, so returning here (e.g. after scanning and
  // saving a new invoice) doesn't remount the screen - only re-fetching on
  // focus picks up the change without needing a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      loadInvoices();
    }, [loadInvoices])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadInvoices();
    setRefreshing(false);
  }, [loadInvoices]);

  useEffect(() => {
    if (!selectedInvoice || !selectedInvoice.items || selectedInvoice.items.length === 0) {
      setSelectedInvoiceAlerts([]);
      return;
    }
    let cancelled = false;
    setLoadingInvoiceAlerts(true);
    api.getPriceAlerts(undefined, selectedInvoice.id)
      .then((data) => {
        if (!cancelled) setSelectedInvoiceAlerts(data.alerts || []);
      })
      .catch((error) => {
        console.error('Error loading invoice price alerts:', error);
        if (!cancelled) setSelectedInvoiceAlerts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingInvoiceAlerts(false);
      });
    return () => { cancelled = true; };
  }, [selectedInvoice]);

  // The list endpoint never returns the scanned page images (kept out to
  // keep list payloads small) - fetch the full invoice on demand only when
  // its detail modal is open, so pages can be reviewed after saving.
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [loadingScannedPages, setLoadingScannedPages] = useState(false);
  const [viewerPageIndex, setViewerPageIndex] = useState<number | null>(null);

  useEffect(() => {
    setEditMode(false);
  }, [selectedInvoice?.id]);

  useEffect(() => {
    if (!selectedInvoice) {
      setScannedPages([]);
      return;
    }
    let cancelled = false;
    setLoadingScannedPages(true);
    api.getInvoice(selectedInvoice.id)
      .then((full) => {
        if (cancelled) return;
        const pages = full.image_base64s && full.image_base64s.length > 0
          ? full.image_base64s
          : full.image_base64
          ? [full.image_base64]
          : [];
        setScannedPages(pages);
      })
      .catch((error) => {
        console.error('Error loading invoice scan images:', error);
        if (!cancelled) setScannedPages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingScannedPages(false);
      });
    return () => { cancelled = true; };
  }, [selectedInvoice?.id]);

  const [updatingPayment, setUpdatingPayment] = useState(false);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentAmountInput, setPaymentAmountInput] = useState('');

  const applyInvoiceUpdate = (updated: Invoice) => {
    setSelectedInvoice(updated);
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)));
  };

  // Lets a successfully-scanned invoice have its OCR-misread header fields
  // corrected in place, instead of the only option being delete + rescan.
  const [editMode, setEditMode] = useState(false);
  const [editSupplier, setEditSupplier] = useState('');
  const [editSupplierEik, setEditSupplierEik] = useState('');
  const [editInvoiceNumber, setEditInvoiceNumber] = useState('');
  const [editDate, setEditDate] = useState(new Date());
  const [isEditDatePickerVisible, setEditDatePickerVisible] = useState(false);
  const [editAmountWithoutVat, setEditAmountWithoutVat] = useState('');
  const [editVatAmount, setEditVatAmount] = useState('');
  const [editVatTreatment, setEditVatTreatment] = useState<VatTreatment | ''>('');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const startEditInvoice = (invoice: Invoice) => {
    setEditSupplier(invoice.supplier);
    setEditSupplierEik(invoice.supplier_eik || '');
    setEditInvoiceNumber(invoice.invoice_number);
    setEditDate(new Date(invoice.date));
    setEditAmountWithoutVat(invoice.amount_without_vat.toFixed(2));
    setEditVatAmount(invoice.vat_amount.toFixed(2));
    setEditVatTreatment(invoice.vat_treatment || '');
    setEditNotes(invoice.notes || '');
    setEditMode(true);
  };

  const handleSaveEditedInvoice = async () => {
    if (!selectedInvoice) return;
    const supplier = editSupplier.trim();
    const invoiceNumber = editInvoiceNumber.trim();
    const withoutVat = parseFloat(editAmountWithoutVat.replace(',', '.'));
    const vat = parseFloat(editVatAmount.replace(',', '.'));
    if (!supplier || !invoiceNumber || isNaN(withoutVat) || isNaN(vat)) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await api.updateInvoice(selectedInvoice.id, {
        supplier,
        supplier_eik: editSupplierEik.trim() || undefined,
        invoice_number: invoiceNumber,
        date: editDate.toISOString(),
        amount_without_vat: withoutVat,
        vat_amount: vat,
        total_amount: withoutVat + vat,
        vat_treatment: editVatTreatment || undefined,
        notes: editNotes.trim() || undefined,
      });
      applyInvoiceUpdate(updated);
      setEditMode(false);
      Toast.success(t('common.saved'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleTogglePaid = async (invoice: Invoice) => {
    setUpdatingPayment(true);
    try {
      const updated = await api.updateInvoice(invoice.id, { is_paid: !invoice.is_paid });
      applyInvoiceUpdate(updated);
      if (updated.is_paid) Haptics.success();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setUpdatingPayment(false);
    }
  };

  const openPaymentModal = (invoice: Invoice) => {
    setPaymentAmountInput(invoice.paid_amount > 0 ? invoice.paid_amount.toFixed(2) : '');
    setPaymentModalVisible(true);
  };

  const handleSavePaymentAmount = async () => {
    if (!selectedInvoice) return;
    const amount = parseFloat(paymentAmountInput);
    if (isNaN(amount) || amount < 0) {
      Alert.alert(t('common.error'), t('budget.invalidAmount'));
      return;
    }
    if (amount > selectedInvoice.total_amount + 0.01) {
      Alert.alert(t('common.error'), t('invoices.paidAmountExceedsTotal'));
      return;
    }
    setUpdatingPayment(true);
    try {
      const updated = await api.updateInvoice(selectedInvoice.id, { paid_amount: amount });
      applyInvoiceUpdate(updated);
      setPaymentModalVisible(false);
      Haptics.success();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setUpdatingPayment(false);
    }
  };

  // Sharpened #19 (Motion Design Audit): a confirm dialog the user has
  // seen fifty times gets rubber-stamped on reflex - it protects no one
  // and costs a tap and a beat every time. The row is removed immediately
  // (with its own exit animation via the list's enter/exit motion) and the
  // actual delete only fires after a dismissible undo window, which
  // protects an actual mistake instead of a hypothetical one.
  const handleDeleteInvoice = (id: string) => {
    const removed = invoices.find((inv) => inv.id === id);
    if (!removed) return;

    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    if (selectedInvoice?.id === id) setSelectedInvoice(null);

    let undone = false;
    Toast.undo(t('invoices.deletedUndo'), () => {
      undone = true;
      setInvoices((prev) => (prev.some((inv) => inv.id === id) ? prev : [...prev, removed]));
    });

    setTimeout(async () => {
      if (undone) return;
      try {
        await api.deleteInvoice(id);
        Haptics.destructive();
      } catch (error: any) {
        // The row already left the UI - put it back rather than silently
        // leaving the user thinking a delete that failed server-side
        // actually went through.
        setInvoices((prev) => (prev.some((inv) => inv.id === id) ? prev : [...prev, removed]));
        Alert.alert(t('common.error'), error.message);
      }
    }, 4000);
  };

  const handleExport = async (type: 'excel' | 'pdf') => {
    try {
      const endpoint = type === 'excel' ? '/api/export/invoices/excel' : '/api/export/invoices/pdf';
      const filename = `invoices_${new Date().toISOString().slice(0, 10)}.${type === 'excel' ? 'xlsx' : 'pdf'}`;
      await downloadAndShareFile(endpoint, filename);
      setExportModalVisible(false);
    } catch (error: any) {
      Alert.alert(t('common.error'), language === 'bg' ? 'Не можах да изтегля файла' : 'Could not download file');
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'd MMM yyyy', { locale: dateLocale });
    } catch {
      return dateStr;
    }
  };

  const renderInvoice = ({ item }: { item: Invoice }) => {
    const eikIssue = hasEikIssue(item);
    const isUnpaid = item.payment_method === 'bank_transfer' && !item.is_paid;
    const overdue = isUnpaid && !!item.payment_due_date && new Date(item.payment_due_date).getTime() < Date.now();
    const isPartial = isUnpaid && item.paid_amount > 0;
    const statusLabel = overdue ? t('invoices.overdue') : (isPartial ? t('invoices.partiallyPaid') : t('invoices.unpaid'));

    return (
      <TouchableOpacity
        style={styles.invoiceCard}
        onPress={() => setSelectedInvoice(item)}
        onLongPress={() => handleDeleteInvoice(item.id)}
      >
        <View style={styles.invoiceRowTop}>
          <View style={styles.supplierContainer}>
            <Ionicons name="business" size={18} color={COLORS.primary} />
            <Text style={styles.supplierName} numberOfLines={1}>{item.supplier}</Text>
          </View>
          <View style={styles.invoiceRowTopRight}>
            <Text style={styles.totalValueCompact}>{item.total_amount.toFixed(2)} €</Text>
            {/* Explicit, discoverable delete action - the same long-press
                gesture on the card still works too (and goes through the
                exact same confirm dialog below), but a visible "X" doesn't
                rely on the user already knowing a long-press deletes. */}
            <TouchableOpacity
              style={styles.invoiceDeleteButton}
              onPress={() => handleDeleteInvoice(item.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t('invoices.deleteInvoice')}
            >
              <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.invoiceRowBottom}>
          <Text style={styles.invoiceMeta} numberOfLines={1}>
            {item.invoice_number} · {formatDate(item.date)}
          </Text>

          {(eikIssue || isUnpaid) && (
            <View style={styles.compactBadgeRow}>
              {eikIssue && (
                <View style={styles.compactBadge}>
                  <Ionicons name="alert-circle" size={11} color={COLORS.warning} />
                  <Text style={styles.compactBadgeText}>{t('invoices.missingEik')}</Text>
                </View>
              )}
              {isUnpaid && (
                <View style={[styles.compactBadge, overdue && styles.overdueBadge]}>
                  <Ionicons name={overdue ? 'alert-circle' : (isPartial ? 'pie-chart-outline' : 'time-outline')} size={11} color={overdue ? COLORS.danger : COLORS.warning} />
                  <Text style={[styles.compactBadgeText, overdue && { color: COLORS.danger }]}>
                    {statusLabel}{isPartial ? ` (${(item.total_amount - item.paid_amount).toFixed(2)} €)` : ''}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const activeFilterCount = (periodPreset !== 'all' ? 1 : 0) + (paymentFilter !== 'all' ? 1 : 0);
  const eikIssueCount = useMemo(() => invoices.filter(hasEikIssue).length, [invoices, hasEikIssue]);
  const visibleInvoices = useMemo(
    () => (showOnlyEikIssues ? invoices.filter(hasEikIssue) : invoices),
    [invoices, showOnlyEikIssues, hasEikIssue]
  );

  const totalAmount = visibleInvoices.reduce((sum, inv) => sum + inv.total_amount, 0);
  const totalVat = visibleInvoices.reduce((sum, inv) => sum + inv.vat_amount, 0);

  const sections = useMemo(() => {
    const groups = new Map<string, { title: string; data: Invoice[]; totalAmount: number; totalVat: number }>();
    for (const inv of visibleInvoices) {
      let key: string;
      let title: string;
      try {
        const d = new Date(inv.date);
        key = format(d, 'yyyy-MM');
        title = format(d, 'LLLL yyyy', { locale: dateLocale });
        title = title.charAt(0).toUpperCase() + title.slice(1);
      } catch {
        key = 'unknown';
        title = inv.date;
      }
      if (!groups.has(key)) {
        groups.set(key, { title, data: [], totalAmount: 0, totalVat: 0 });
      }
      const group = groups.get(key)!;
      group.data.push(inv);
      group.totalAmount += inv.total_amount;
      group.totalVat += inv.vat_amount;
    }
    return Array.from(groups.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, group]) => ({ key, ...group }));
  }, [visibleInvoices, dateLocale]);

  const renderSectionHeader = ({ section }: { section: { title: string; data: Invoice[]; totalAmount: number } }) => (
    <View style={styles.monthHeader}>
      <Text style={styles.monthHeaderTitle}>{section.title}</Text>
      <Text style={styles.monthHeaderStats}>
        {section.data.length} · {t('invoices.monthlyTotal')} {section.totalAmount.toFixed(2)} €
      </Text>
    </View>
  );

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('invoices.title')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <ScanCreditsBadge />
              <TouchableOpacity style={styles.exportButton} onPress={() => setImportModalVisible(true)} accessibilityLabel={t('import.button')}>
                <Ionicons name="cloud-upload-outline" size={24} color={COLORS.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.exportButton} onPress={() => setExportModalVisible(true)}>
                <Ionicons name="download" size={24} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color={COLORS.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('invoices.searchPlaceholder')}
              placeholderTextColor={COLORS.textMuted}
              onSubmitEditing={loadInvoices}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); loadInvoices(); }}>
                <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Filters toggle — collapsed by default so the chip rows don't
              permanently eat vertical space above the list */}
          <TouchableOpacity
            style={styles.filtersToggle}
            onPress={() => setFiltersExpanded((prev) => !prev)}
          >
            <Ionicons name="options-outline" size={16} color={COLORS.primary} />
            <Text style={styles.filtersToggleText}>
              {t('invoices.filtersButton')}
              {activeFilterCount > 0 ? ` · ${activeFilterCount} ${t('invoices.filtersActive')}` : ''}
            </Text>
            <Ionicons name={filtersExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.primary} />
          </TouchableOpacity>

          {filtersExpanded && (
            <>
              {/* Period filter */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.periodChipsRow}
                contentContainerStyle={styles.periodChipsContent}
              >
                {periodOptions.map((opt) => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.periodChip, periodPreset === opt.key && styles.periodChipActive]}
                    onPress={() => setPeriodPreset(opt.key)}
                  >
                    <Text style={[styles.periodChipText, periodPreset === opt.key && styles.periodChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {periodPreset === 'custom' && (
                <View style={styles.customRangeRow}>
                  <TouchableOpacity style={styles.customRangeButton} onPress={() => setStartPickerVisible(true)}>
                    <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.customRangeButtonText}>
                      {t('invoices.periodFrom')}: {format(customStartDate, 'd MMM yyyy', { locale: dateLocale })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.customRangeButton} onPress={() => setEndPickerVisible(true)}>
                    <Ionicons name="calendar-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.customRangeButtonText}>
                      {t('invoices.periodTo')}: {format(customEndDate, 'd MMM yyyy', { locale: dateLocale })}
                    </Text>
                  </TouchableOpacity>
                  <DateTimePickerModal
                    isVisible={startPickerVisible}
                    mode="date"
                    date={customStartDate}
                    onConfirm={(d) => { setCustomStartDate(d); setStartPickerVisible(false); }}
                    onCancel={() => setStartPickerVisible(false)}
                  />
                  <DateTimePickerModal
                    isVisible={endPickerVisible}
                    mode="date"
                    date={customEndDate}
                    onConfirm={(d) => { setCustomEndDate(d); setEndPickerVisible(false); }}
                    onCancel={() => setEndPickerVisible(false)}
                  />
                </View>
              )}

              {/* Payment status filter */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.periodChipsRow}
                contentContainerStyle={styles.periodChipsContent}
              >
                {([
                  { key: 'all', label: t('invoices.paymentFilterAll') },
                  { key: 'unpaid', label: t('invoices.paymentFilterUnpaid') },
                  { key: 'partial', label: t('invoices.partiallyPaid') },
                  { key: 'overdue', label: t('invoices.paymentFilterOverdue') },
                  { key: 'paid', label: t('invoices.paymentFilterPaid') },
                ] as const).map((opt) => (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.periodChip, paymentFilter === opt.key && styles.periodChipActive]}
                    onPress={() => setPaymentFilter(opt.key)}
                  >
                    <Text style={[styles.periodChipText, paymentFilter === opt.key && styles.periodChipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* ЕИК issues banner */}
          {eikIssueCount > 0 && (
            <TouchableOpacity
              style={[styles.eikBanner, showOnlyEikIssues && styles.eikBannerActive]}
              onPress={() => setShowOnlyEikIssues((prev) => !prev)}
            >
              <Ionicons name="alert-circle" size={18} color={COLORS.warning} />
              <Text style={styles.eikBannerText}>
                {eikIssueCount} {eikIssueCount === 1 ? t('invoices.missingEikSingular') : t('invoices.missingEikPlural')}
              </Text>
              <Text style={styles.eikBannerAction}>
                {showOnlyEikIssues ? t('invoices.showAll') : t('invoices.showOnlyThese')}
              </Text>
            </TouchableOpacity>
          )}

          {/* Summary */}
          <View style={styles.summaryBar}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('invoices.count')}:</Text>
              <Text style={styles.summaryValue}>{visibleInvoices.length}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('stats.vat')}:</Text>
              <Text style={styles.summaryValue}>{totalVat.toFixed(2)} €</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('invoices.total')}:</Text>
              <Text style={[styles.summaryValue, { color: COLORS.primary }]}>{totalAmount.toFixed(2)} €</Text>
            </View>
          </View>

          {/* List */}
          <SectionList
            sections={sections}
            renderItem={renderInvoice}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="document-text-outline" size={64} color={COLORS.border} />
                <Text style={styles.emptyText}>{t('invoices.noInvoices')}</Text>
                <Text style={styles.emptyHint}>{t('invoices.scanFirst')}</Text>
              </View>
            }
          />

          {/* Export Modal */}
      <Modal visible={exportModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('invoices.exportTitle')}</Text>

            <TouchableOpacity style={styles.exportOption} onPress={() => handleExport('excel')}>
              <View style={[styles.exportIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Ionicons name="document" size={24} color={COLORS.success} />
              </View>
              <View>
                <Text style={styles.exportOptionTitle}>{t('invoices.excelTitle')}</Text>
                <Text style={styles.exportOptionHint}>{t('invoices.excelHint')}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.exportOption} onPress={() => handleExport('pdf')}>
              <View style={[styles.exportIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Ionicons name="document-text" size={24} color={COLORS.danger} />
              </View>
              <View>
                <Text style={styles.exportOptionTitle}>PDF</Text>
                <Text style={styles.exportOptionHint}>{t('invoices.pdfHint')}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={() => setExportModalVisible(false)}>
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ExcelImportModal
        visible={importModalVisible}
        onClose={() => setImportModalVisible(false)}
        entity="invoices"
        title={t('import.button')}
        fields={[
          { key: 'supplier', label: t('invoices.supplier') },
          { key: 'invoice_number', label: t('invoices.invoiceNo') },
          { key: 'total_amount', label: t('invoices.total'), format: (v) => `${Number(v).toFixed(2)} €` },
        ]}
        onImported={loadInvoices}
      />

      {/* Invoice Detail Modal */}
      <Modal visible={!!selectedInvoice} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.detailModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editMode ? t('invoices.editInvoice') : t('invoices.details')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                {!editMode && selectedInvoice && (
                  <TouchableOpacity onPress={() => startEditInvoice(selectedInvoice)} accessibilityLabel={t('invoices.editInvoice')}>
                    <Ionicons name="pencil" size={22} color={COLORS.primary} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => (editMode ? setEditMode(false) : setSelectedInvoice(null))}>
                  <Ionicons name="close" size={28} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            {selectedInvoice && editMode && (
              <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('invoices.supplier')} *</Text>
                  <TextInput
                    style={styles.input}
                    value={editSupplier}
                    onChangeText={setEditSupplier}
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('scan.supplierEik')}</Text>
                  <TextInput
                    style={styles.input}
                    value={editSupplierEik}
                    onChangeText={setEditSupplierEik}
                    keyboardType="number-pad"
                    placeholder="131071587"
                    placeholderTextColor={COLORS.textMuted}
                    maxLength={13}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('invoices.invoiceNo')} *</Text>
                  <TextInput
                    style={styles.input}
                    value={editInvoiceNumber}
                    onChangeText={setEditInvoiceNumber}
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('invoices.dateLabel')} *</Text>
                  <TouchableOpacity style={styles.dateInputButton} onPress={() => setEditDatePickerVisible(true)}>
                    <Ionicons name="calendar" size={20} color={COLORS.primary} />
                    <Text style={styles.dateInputText}>
                      {format(editDate, 'd MMMM yyyy', { locale: dateLocale })}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </View>
                <DateTimePickerModal
                  isVisible={isEditDatePickerVisible}
                  mode="date"
                  date={editDate}
                  onConfirm={(d) => { setEditDate(d); setEditDatePickerVisible(false); }}
                  onCancel={() => setEditDatePickerVisible(false)}
                  confirmTextIOS={t('common.select')}
                  cancelTextIOS={t('common.cancel')}
                  locale={language}
                />

                <View style={styles.detailRow2}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>{t('invoices.withoutVAT')}</Text>
                    <TextInput
                      style={styles.input}
                      value={editAmountWithoutVat}
                      onChangeText={setEditAmountWithoutVat}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>{t('scan.vatAmount')}</Text>
                    <TextInput
                      style={styles.input}
                      value={editVatAmount}
                      onChangeText={setEditVatAmount}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>
                </View>

                <View style={styles.totalSection}>
                  <Text style={styles.totalSectionLabel}>{t('invoices.totalAmount')}</Text>
                  <Text style={styles.totalSectionValue}>
                    {((parseFloat(editAmountWithoutVat.replace(',', '.')) || 0) + (parseFloat(editVatAmount.replace(',', '.')) || 0)).toFixed(2)} €
                  </Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('scan.vatTreatment')}</Text>
                  <View style={styles.vatTreatmentGrid}>
                    {(['standard_20', 'reduced_9', 'zero_rate', 'exempt', 'reverse_charge', 'outside_scope'] as VatTreatment[]).map((option) => (
                      <TouchableOpacity
                        key={option}
                        style={[styles.vatTreatmentChip, editVatTreatment === option && styles.vatTreatmentChipActive]}
                        onPress={() => setEditVatTreatment(option)}
                      >
                        <Text style={[styles.vatTreatmentChipText, editVatTreatment === option && styles.vatTreatmentChipTextActive]}>
                          {t(`vat.${option}`)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('invoices.notes')}</Text>
                  <TextInput
                    style={[styles.input, { minHeight: 70 }]}
                    value={editNotes}
                    onChangeText={setEditNotes}
                    multiline
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>

                <View style={styles.editActionsRow}>
                  <TouchableOpacity style={styles.editCancelButton} onPress={() => setEditMode(false)} disabled={savingEdit}>
                    <Text style={styles.editCancelButtonText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.submitButton, { flex: 1 }]} onPress={handleSaveEditedInvoice} disabled={savingEdit}>
                    {savingEdit ? <ActivityIndicator color="white" /> : <Text style={styles.submitButtonText}>{t('common.save')}</Text>}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}

            {selectedInvoice && !editMode && (
              <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.supplier')}</Text>
                  <Text style={styles.detailSectionValue}>{selectedInvoice.supplier}</Text>
                </View>
                {selectedInvoice.supplier_eik && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('scan.supplierEik')}</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.supplier_eik}</Text>
                  </View>
                )}
                {selectedInvoice.vat_treatment && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('scan.vatTreatment')}</Text>
                    <Text style={styles.detailSectionValue}>{t(`vat.${selectedInvoice.vat_treatment}`)}</Text>
                  </View>
                )}
                {selectedInvoice.vat_treatment === 'reverse_charge' && (() => {
                  const deadline = new Date(new Date(selectedInvoice.date).getTime() + 15 * 24 * 60 * 60 * 1000);
                  const overdue = deadline.getTime() < Date.now();
                  return (
                    <View style={[styles.protocolBanner, overdue && styles.protocolBannerOverdue]}>
                      <Ionicons name={overdue ? 'alert-circle' : 'document-text'} size={18} color={overdue ? COLORS.danger : COLORS.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.protocolBannerTitle}>
                          {t('scan.protocolAssigned')} {selectedInvoice.protocol_number || '—'}
                        </Text>
                        <Text style={[styles.protocolBannerDeadline, overdue && { color: COLORS.danger }]}>
                          {t('invoices.protocolDeadline')}: {formatDate(deadline.toISOString())}
                          {overdue ? ` (${t('invoices.protocolOverdue')})` : ''}
                        </Text>
                      </View>
                    </View>
                  );
                })()}
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.invoiceNo')}</Text>
                  <Text style={styles.detailSectionValue}>{selectedInvoice.invoice_number}</Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.dateLabel')}</Text>
                  <Text style={styles.detailSectionValue}>{formatDate(selectedInvoice.date)}</Text>
                </View>
                <View style={styles.detailRow2}>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('invoices.withoutVAT')}</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.amount_without_vat.toFixed(2)} €</Text>
                  </View>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('invoices.vatPercent')}</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.vat_amount.toFixed(2)} €</Text>
                  </View>
                </View>
                <View style={styles.totalSection}>
                  <Text style={styles.totalSectionLabel}>{t('invoices.totalAmount')}</Text>
                  <Text style={styles.totalSectionValue}>{selectedInvoice.total_amount.toFixed(2)} €</Text>
                </View>

                {selectedInvoice.payment_method && (() => {
                  const overdue = !selectedInvoice.is_paid && !!selectedInvoice.payment_due_date
                    && new Date(selectedInvoice.payment_due_date).getTime() < Date.now();
                  return (
                    <View style={[styles.paymentSection, overdue && styles.paymentSectionOverdue]}>
                      <View style={styles.paymentSectionHeader}>
                        <Text style={styles.detailSectionLabel}>{t('invoices.paymentSection')}</Text>
                        <Text style={styles.paymentMethodTag}>
                          {selectedInvoice.payment_method === 'cash'
                            ? t('invoices.paymentMethodCash')
                            : t('invoices.paymentMethodBankTransfer')}
                        </Text>
                      </View>

                      {selectedInvoice.payment_method === 'bank_transfer' && (
                        <>
                          {selectedInvoice.payment_due_date && !selectedInvoice.is_paid && (
                            <Text style={[styles.paymentDueText, overdue && { color: COLORS.danger }]}>
                              {overdue ? t('invoices.overdueSince') : t('invoices.paymentDueDate')}: {formatDate(selectedInvoice.payment_due_date)}
                            </Text>
                          )}

                          {!selectedInvoice.is_paid && selectedInvoice.paid_amount > 0 && (
                            <View style={styles.paymentProgressBox}>
                              <Text style={styles.paymentProgressText}>
                                {t('invoices.paidOfTotal')
                                  .replace('{paid}', selectedInvoice.paid_amount.toFixed(2))
                                  .replace('{total}', selectedInvoice.total_amount.toFixed(2))}
                              </Text>
                              <Text style={styles.paymentRemainingText}>
                                {t('invoices.remainingAmount')}: {(selectedInvoice.total_amount - selectedInvoice.paid_amount).toFixed(2)} €
                              </Text>
                              <View style={styles.paymentProgressBar}>
                                <View style={[
                                  styles.paymentProgressBarFill,
                                  { width: `${Math.min(100, (selectedInvoice.paid_amount / selectedInvoice.total_amount) * 100)}%` }
                                ]} />
                              </View>
                            </View>
                          )}

                          <TouchableOpacity
                            style={styles.paidCheckboxRow}
                            onPress={() => handleTogglePaid(selectedInvoice)}
                            disabled={updatingPayment}
                          >
                            <View style={[styles.checkbox, selectedInvoice.is_paid && styles.checkboxChecked]}>
                              {selectedInvoice.is_paid && <Ionicons name="checkmark" size={16} color="white" />}
                            </View>
                            <Text style={styles.paidCheckboxLabel}>
                              {selectedInvoice.is_paid && selectedInvoice.paid_at
                                ? `${t('invoices.paidOn')} ${formatDate(selectedInvoice.paid_at)}`
                                : t('invoices.markFullyPaid')}
                            </Text>
                            {updatingPayment && <ActivityIndicator size="small" color={COLORS.primary} />}
                          </TouchableOpacity>

                          {!selectedInvoice.is_paid && (
                            <TouchableOpacity
                              style={styles.recordPaymentButton}
                              onPress={() => openPaymentModal(selectedInvoice)}
                              disabled={updatingPayment}
                            >
                              <Ionicons name="cash-outline" size={16} color={COLORS.primary} />
                              <Text style={styles.recordPaymentButtonText}>
                                {selectedInvoice.paid_amount > 0 ? t('invoices.editPayment') : t('invoices.recordPayment')}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </>
                      )}
                    </View>
                  );
                })()}

                {selectedInvoice.items && selectedInvoice.items.length > 0 && (() => {
                  const items = selectedInvoice.items!;
                  const itemsSum = items.reduce(
                    (sum, it) => sum + (it.total_price ?? (it.quantity || 0) * it.unit_price),
                    0
                  );
                  const mismatch = Math.abs(itemsSum - selectedInvoice.amount_without_vat) > 0.05;
                  return (
                    <View style={styles.itemsSection}>
                      <View style={styles.itemsSectionHeader}>
                        <Text style={styles.detailSectionLabel}>{t('invoices.items')}</Text>
                        {loadingInvoiceAlerts && <ActivityIndicator size="small" color={COLORS.textMuted} />}
                      </View>

                      <View style={styles.itemsTableHeader}>
                        <Text style={[styles.itemsTableHeaderText, { flex: 2 }]}>{t('invoices.itemName')}</Text>
                        <Text style={[styles.itemsTableHeaderText, styles.itemsColRight, { flex: 1 }]}>{t('invoices.itemQty')}</Text>
                        <Text style={[styles.itemsTableHeaderText, styles.itemsColRight, { flex: 1 }]}>{t('invoices.itemUnitPrice')}</Text>
                        <Text style={[styles.itemsTableHeaderText, styles.itemsColRight, { flex: 1 }]}>{t('invoices.itemTotal')}</Text>
                      </View>

                      {items.map((item, index) => {
                        const alert = selectedInvoiceAlerts.find((a) => a.item_name === item.name);
                        const lineTotal = item.total_price ?? (item.quantity || 0) * item.unit_price;
                        return (
                          <View key={index} style={styles.itemRow}>
                            <View style={{ flex: 2 }}>
                              <Text style={styles.itemRowName} numberOfLines={2}>{item.name}</Text>
                              {alert && (
                                <View style={styles.itemPriceAlertBadge}>
                                  <Ionicons name="trending-up" size={11} color={COLORS.danger} />
                                  <Text style={styles.itemPriceAlertText}>
                                    +{alert.change_percent}% {t('invoices.vsLastPurchase')}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={[styles.itemRowValue, styles.itemsColRight, { flex: 1 }]}>
                              {item.quantity} {item.unit}
                            </Text>
                            <Text style={[styles.itemRowValue, styles.itemsColRight, { flex: 1 }]}>
                              {item.unit_price.toFixed(2)}€
                            </Text>
                            <Text style={[styles.itemRowValue, styles.itemsColRight, styles.itemRowTotal, { flex: 1 }]}>
                              {lineTotal.toFixed(2)}€
                            </Text>
                          </View>
                        );
                      })}

                      <View style={styles.itemsSumRow}>
                        <Text style={styles.itemsSumLabel}>{t('invoices.itemsSum')}</Text>
                        <Text style={styles.itemsSumValue}>{itemsSum.toFixed(2)} €</Text>
                      </View>
                      {mismatch && (
                        <View style={styles.itemsMismatchNote}>
                          <Ionicons name="alert-circle-outline" size={14} color={COLORS.warning} />
                          <Text style={styles.itemsMismatchText}>{t('invoices.itemsMismatch')}</Text>
                        </View>
                      )}
                    </View>
                  );
                })()}

                {(loadingScannedPages || scannedPages.length > 0) && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('invoices.scannedPages')}</Text>
                    {loadingScannedPages ? (
                      <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
                    ) : (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                        {scannedPages.map((uri, index) => (
                          <TouchableOpacity
                            key={index}
                            style={styles.scannedPageThumbWrapper}
                            onPress={() => setViewerPageIndex(index)}
                          >
                            <Image source={{ uri }} style={styles.scannedPageThumb} resizeMode="cover" />
                            {scannedPages.length > 1 && (
                              <View style={styles.scannedPageBadge}>
                                <Text style={styles.scannedPageBadgeText}>{index + 1}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                )}

                {selectedInvoice.notes && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('invoices.notes')}</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.notes}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => {
                    setSelectedInvoice(null);
                    handleDeleteInvoice(selectedInvoice.id);
                  }}
                >
                  <Ionicons name="trash" size={20} color={COLORS.danger} />
                  <Text style={styles.deleteButtonText}>{t('invoices.deleteInvoice')}</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Full-screen scanned page viewer - opened by tapping a thumbnail in
          the detail modal above. */}
      <Modal visible={viewerPageIndex !== null} animationType="fade" transparent>
        <View style={styles.pageViewerOverlay}>
          <TouchableOpacity
            style={styles.pageViewerClose}
            onPress={() => setViewerPageIndex(null)}
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={28} color="white" />
          </TouchableOpacity>
          {viewerPageIndex !== null && (
            <>
              <Image
                source={{ uri: scannedPages[viewerPageIndex] }}
                style={styles.pageViewerImage}
                resizeMode="contain"
              />
              {scannedPages.length > 1 && (
                <View style={styles.pageViewerNav}>
                  <TouchableOpacity
                    style={styles.pageViewerNavButton}
                    disabled={viewerPageIndex === 0}
                    onPress={() => setViewerPageIndex((i) => (i !== null ? Math.max(0, i - 1) : i))}
                  >
                    <Ionicons name="chevron-back" size={24} color={viewerPageIndex === 0 ? COLORS.borderLight : 'white'} />
                  </TouchableOpacity>
                  <Text style={styles.pageViewerNavText}>{viewerPageIndex + 1} / {scannedPages.length}</Text>
                  <TouchableOpacity
                    style={styles.pageViewerNavButton}
                    disabled={viewerPageIndex === scannedPages.length - 1}
                    onPress={() => setViewerPageIndex((i) => (i !== null ? Math.min(scannedPages.length - 1, i + 1) : i))}
                  >
                    <Ionicons name="chevron-forward" size={24} color={viewerPageIndex === scannedPages.length - 1 ? COLORS.borderLight : 'white'} />
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>
      </Modal>

      {/* Record/edit payment amount - edit-in-place, same convention as the
          daily-revenue form: the field shows what's already paid, and
          saving REPLACES that value rather than adding to it. */}
      <Modal visible={paymentModalVisible} animationType="fade" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedInvoice && selectedInvoice.paid_amount > 0 ? t('invoices.editPayment') : t('invoices.recordPayment')}
              </Text>
              <TouchableOpacity onPress={() => setPaymentModalVisible(false)}>
                <Ionicons name="close" size={28} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {selectedInvoice && (
              <>
                <View style={styles.editNoticeBanner}>
                  <Ionicons name="information-circle" size={18} color={COLORS.primary} />
                  <Text style={styles.editNoticeText}>{t('invoices.paidAmountEditNotice')}</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('invoices.paidAmountLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={paymentAmountInput}
                    onChangeText={setPaymentAmountInput}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={COLORS.textMuted}
                    autoFocus
                  />
                  <Text style={styles.inputHint}>
                    {t('invoices.totalAmount')}: {selectedInvoice.total_amount.toFixed(2)} €
                  </Text>
                </View>

                <TouchableOpacity style={styles.submitButton} onPress={handleSavePaymentAmount} disabled={updatingPayment}>
                  {updatingPayment ? <ActivityIndicator color="white" /> : <Text style={styles.submitButtonText}>{t('common.save')}</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
        </SafeAreaView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  exportButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    color: 'white',
    fontSize: 16,
  },
  filtersToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filtersToggleText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  periodChipsRow: {
    marginTop: 12,
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
  },
  periodChipsContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  periodChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    marginRight: 8,
    flexShrink: 0,
  },
  periodChipActive: {
    backgroundColor: COLORS.primary,
  },
  periodChipText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  periodChipTextActive: {
    color: 'white',
  },
  customRangeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  customRangeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  customRangeButtonText: {
    fontSize: 12,
    color: COLORS.textLight,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
  },
  monthHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primaryLight,
    textTransform: 'capitalize',
  },
  monthHeaderStats: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: COLORS.surface,
    margin: 16,
    borderRadius: 12,
    padding: 12,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 2,
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  invoiceCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  invoiceRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalValueCompact: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginLeft: 8,
  },
  invoiceRowTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  invoiceDeleteButton: {
    marginLeft: 8,
    padding: 2,
  },
  invoiceRowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  invoiceMeta: {
    fontSize: 12,
    color: COLORS.textMuted,
    flexShrink: 1,
  },
  compactBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    flexShrink: 0,
  },
  compactBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  compactBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.warning,
  },
  overdueBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  eikBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  eikBannerActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
  },
  eikBannerText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.warning,
    fontWeight: '600',
  },
  eikBannerAction: {
    fontSize: 12,
    color: COLORS.warning,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  supplierContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  supplierName: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    color: COLORS.textMuted,
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 14,
    color: COLORS.borderLight,
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  detailModalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '90%',
  },
  detailScroll: {
    maxHeight: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
  },
  editNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  editNoticeText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.primaryLight,
    lineHeight: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: 'white',
  },
  inputHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 6,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  dateInputButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 10,
  },
  dateInputText: {
    flex: 1,
    color: 'white',
    fontSize: 16,
  },
  vatTreatmentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  vatTreatmentChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  vatTreatmentChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  vatTreatmentChipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  vatTreatmentChipTextActive: {
    color: 'white',
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 16,
  },
  editCancelButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: COLORS.border,
  },
  editCancelButtonText: {
    color: COLORS.textLight,
    fontSize: 16,
    fontWeight: '600',
  },
  exportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    marginBottom: 12,
    gap: 16,
  },
  exportIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exportOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  exportOptionHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    color: COLORS.textSecondary,
    fontSize: 16,
  },
  detailSection: {
    marginBottom: 16,
  },
  scannedPageThumbWrapper: {
    marginRight: 10,
    position: 'relative',
  },
  scannedPageThumb: {
    width: 72,
    height: 96,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  scannedPageBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  scannedPageBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
  },
  pageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageViewerClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1,
    padding: 8,
  },
  pageViewerImage: {
    width: '100%',
    height: '80%',
  },
  pageViewerNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginTop: 16,
  },
  pageViewerNavButton: {
    padding: 8,
  },
  pageViewerNavText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  protocolBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  protocolBannerOverdue: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  protocolBannerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
  },
  protocolBannerDeadline: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  detailSectionLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  detailSectionValue: {
    fontSize: 16,
    color: 'white',
  },
  detailRow2: {
    flexDirection: 'row',
    gap: 16,
  },
  totalSection: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  totalSectionLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  totalSectionValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  paymentSection: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  paymentSectionOverdue: {
    borderColor: COLORS.danger,
  },
  paymentSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  paymentMethodTag: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  paymentDueText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  paidCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  paidCheckboxLabel: {
    fontSize: 14,
    color: 'white',
    flex: 1,
  },
  paymentProgressBox: {
    marginBottom: 10,
  },
  paymentProgressText: {
    fontSize: 13,
    color: 'white',
    fontWeight: '600',
  },
  paymentRemainingText: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 2,
    marginBottom: 6,
  },
  paymentProgressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
  paymentProgressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  recordPaymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  recordPaymentButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  itemsSection: {
    marginBottom: 16,
  },
  itemsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  itemsTableHeader: {
    flexDirection: 'row',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 4,
  },
  itemsTableHeaderText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  itemsColRight: {
    textAlign: 'right',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    gap: 4,
  },
  itemRowName: {
    fontSize: 13,
    color: 'white',
    fontWeight: '500',
  },
  itemRowValue: {
    fontSize: 13,
    color: COLORS.textSubtle,
  },
  itemRowTotal: {
    fontWeight: '600',
    color: 'white',
  },
  itemPriceAlertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
  },
  itemPriceAlertText: {
    fontSize: 10,
    color: COLORS.danger,
    fontWeight: '600',
  },
  itemsSumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  itemsSumLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  itemsSumValue: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  itemsMismatchNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  itemsMismatchText: {
    fontSize: 11,
    color: COLORS.warning,
    flex: 1,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
    marginTop: 8,
  },
  deleteButtonText: {
    color: COLORS.danger,
    fontSize: 14,
    fontWeight: '500',
  },
});

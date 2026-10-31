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
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
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
import { ScanCreditsBadge, Expandable, CountUp, SkeletonRow, AnimatedEmptyIcon } from '../../src/components';
import { ExportFormatModal } from '../../src/components/invoices/ExportFormatModal';
import { ImageViewerModal } from '../../src/components/invoices/ImageViewerModal';
import { PaymentModal } from '../../src/components/invoices/PaymentModal';
import { InvoiceDetailModal } from '../../src/components/invoices/InvoiceDetailModal';
import { COLORS } from '../../src/theme/colors';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, useAnimatedScrollHandler, interpolate, Extrapolation } from 'react-native-reanimated';
import { DURATION, EASING } from '../../src/theme/motion';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

// Module-scope so it isn't recreated every render - SectionList itself
// has no Reanimated-provided Animated wrapper (unlike FlatList/ScrollView),
// so one is built here to drive the header's scroll-linked animation below.
const AnimatedSectionList = Animated.createAnimatedComponent(SectionList) as unknown as typeof SectionList;

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
  const { hasPermission } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ paymentFilter?: string; invoiceId?: string }>();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  // Set only when the backend's true match count exceeds what was
  // actually returned (it caps at 1,000 by default) - lets the banner
  // below tell the user some invoices aren't shown instead of silently
  // looking like a complete, if short, list.
  const [invoicesTotalCount, setInvoicesTotalCount] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Header shrinks/fades as the list scrolls past it, same treatment as
  // the Statistics screen - see its comment for why it's clamped.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const headerAnimatedStyle = useAnimatedStyle(() => {
    const progress = interpolate(scrollY.value, [0, 90], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(progress, [0, 1], [1, 0.4]),
      transform: [{ scale: interpolate(progress, [0, 1], [1, 0.92]) }],
    };
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  // Invoice.user_id is who scanned/created it, but the invoice itself only
  // ever stores that id - resolved to a name+picture via the company
  // directory, same approach as calendar.tsx/audit-log.tsx, rather than
  // adding a denormalized field to every invoice document.
  const [pictureByUserId, setPictureByUserId] = useState<Record<string, { name: string; picture: string | null }>>({});
  useEffect(() => {
    api.getCompanyDirectory()
      .then((dir) => setPictureByUserId(Object.fromEntries(dir.map((d) => [d.user_id, { name: d.name, picture: d.picture }]))))
      .catch(() => {});
  }, []);
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
  const chevronRotation = useSharedValue(0);
  useEffect(() => {
    chevronRotation.value = withTiming(filtersExpanded ? 180 : 0, {
      duration: DURATION.deliberate,
      easing: EASING.standard,
    });
  }, [filtersExpanded]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

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

  // Lets a price alert (or anything else pointing at one specific invoice)
  // deep-link straight to it, even if it falls outside whatever date/search
  // filter this screen currently has applied - fetched directly by id
  // rather than relying on it being in the already-loaded `invoices` list.
  useEffect(() => {
    if (!params.invoiceId) return;
    const id = params.invoiceId;
    api.getInvoice(id)
      .then((invoice) => setSelectedInvoice(invoice))
      .catch((error) => console.error('Error opening linked invoice:', error));
  }, [params.invoiceId]);

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
      const { invoices: data, totalCount } = await api.getInvoicesPage({
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(start ? { start_date: start } : {}),
        ...(end ? { end_date: end } : {}),
        ...(paymentFilter !== 'all' ? { payment_status: paymentFilter } : {}),
        limit: 1000,
      });
      setInvoices(data);
      setInvoicesTotalCount(totalCount > data.length ? totalCount : null);
    } catch (error) {
      console.error('Error loading invoices:', error);
    } finally {
      setInitialLoading(false);
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
      Haptics.success();
      Toast.success(t('common.saved'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSavingEdit(false);
    }
  };

  // Optimistic UI (Motion Design Audit, Phase A - the roadmap's highest-
  // leverage item): the checkbox flips the instant it's tapped instead of
  // waiting on the round trip, and only rolls back if the request actually
  // fails. A toggle this small has nothing worth a loading spinner for.
  const handleTogglePaid = async (invoice: Invoice) => {
    const optimistic: Invoice = { ...invoice, is_paid: !invoice.is_paid };
    applyInvoiceUpdate(optimistic);
    if (optimistic.is_paid) Haptics.success();
    try {
      const updated = await api.updateInvoice(invoice.id, { is_paid: optimistic.is_paid });
      applyInvoiceUpdate(updated);
    } catch (error: any) {
      applyInvoiceUpdate(invoice);
      Alert.alert(t('common.error'), error.message);
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

  // Reverted the immediate-delete + 4s-undo-toast pattern (Motion Design
  // Audit #19): a timed toast gives no real protection for a rare,
  // irreversible financial action - miss the window (easy to do - the row
  // is already gone, nothing holds your attention) and the invoice is
  // simply gone. A blocking confirm costs one deliberate tap but can't be
  // missed by accident, which matters far more here than the frame of
  // friction it adds. A second, admin-gated safety net (restore from the
  // audit log) covers the rest - see the audit-log screen.
  const handleDeleteInvoice = (id: string) => {
    const target = invoices.find((inv) => inv.id === id);
    if (!target) return;

    Alert.alert(
      t('common.delete'),
      t('invoices.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('invoices.deleteInvoice'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteInvoice(id);
              Haptics.destructive();
              setInvoices((prev) => prev.filter((inv) => inv.id !== id));
              if (selectedInvoice?.id === id) setSelectedInvoice(null);
              Toast.success(t('invoices.deletedUndo'));
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            }
          },
        },
      ]
    );
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
          <Animated.View style={[styles.header, headerAnimatedStyle]}>
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
          </Animated.View>

          {/* Navigation-architecture review (2026-10): Вземания/Документи/
              Протоколи used to be buried in Profile's "accounting"
              category - they're all documents/money with the outside
              world, the same subject matter as the invoice list right
              below, so a visible link belongs here instead. */}
          {(hasPermission('add_revenue') || hasPermission('view_statistics')) && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.quickLinksRow}
              contentContainerStyle={styles.quickLinksContent}
            >
              {hasPermission('add_revenue') && (
                <TouchableOpacity style={styles.quickLinkChip} onPress={() => router.push('/receivables')}>
                  <Ionicons name="cash-outline" size={15} color={COLORS.success} />
                  <Text style={styles.quickLinkChipText}>{t('receivables.title')}</Text>
                </TouchableOpacity>
              )}
              {hasPermission('add_revenue') && (
                <TouchableOpacity style={styles.quickLinkChip} onPress={() => router.push('/billing-documents')}>
                  <Ionicons name="document-text-outline" size={15} color={COLORS.success} />
                  <Text style={styles.quickLinkChipText}>{t('billingDocuments.title')}</Text>
                </TouchableOpacity>
              )}
              {hasPermission('view_statistics') && (
                <TouchableOpacity style={styles.quickLinkChip} onPress={() => router.push('/protocols')}>
                  <Ionicons name="document-text-outline" size={15} color={COLORS.primary} />
                  <Text style={styles.quickLinkChipText}>{t('profile.protocols')}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}

          {/* Admin-only safety net for the confirm dialog above: whoever
              holds restore_deleted_data can undo a delete after the fact
              too, from the full snapshot kept on that invoice's audit log
              entry - see restore_audit_entry in the backend. */}
          {hasPermission('restore_deleted_data') && (
            <TouchableOpacity style={styles.restoreHintBanner} onPress={() => router.push('/audit-log')}>
              <Ionicons name="time-outline" size={16} color={COLORS.primary} />
              <Text style={styles.restoreHintText}>{t('invoices.restoreDeletedHint')}</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
            </TouchableOpacity>
          )}

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
            <Animated.View style={chevronStyle}>
              <Ionicons name="chevron-down" size={16} color={COLORS.primary} />
            </Animated.View>
          </TouchableOpacity>

          <Expandable expanded={filtersExpanded}>
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
          </Expandable>

          {/* Truncation banner - the backend caps matches per page; this is
              the only signal the user gets that the list isn't complete. */}
          {invoicesTotalCount !== null && (
            <View style={styles.eikBanner}>
              <Ionicons name="information-circle" size={18} color={COLORS.warning} />
              <Text style={styles.eikBannerText}>
                {t('invoices.truncatedBanner')
                  .replace('{shown}', String(invoices.length))
                  .replace('{total}', String(invoicesTotalCount))}
              </Text>
            </View>
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
              <CountUp
                value={totalAmount}
                formatter={(n) => `${n.toFixed(2)} €`}
                style={[styles.summaryValue, { color: COLORS.primary }]}
              />
            </View>
          </View>

          {/* List - a handful of skeleton rows while the first page is
              still loading, instead of briefly flashing the "no invoices"
              empty state for data that just hasn't arrived yet. */}
          {initialLoading && invoices.length === 0 ? (
            <View style={styles.listContent}>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </View>
          ) : (
          <AnimatedSectionList
            sections={sections}
            renderItem={renderInvoice}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled
            keyExtractor={(item: Invoice) => item.id}
            contentContainerStyle={styles.listContent}
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <AnimatedEmptyIcon name="document-text-outline" size={64} color={COLORS.border} />
                <Text style={styles.emptyText}>{t('invoices.noInvoices')}</Text>
                <Text style={styles.emptyHint}>{t('invoices.scanFirst')}</Text>
              </View>
            }
          />
          )}

          {/* Export Modal */}
      <ExportFormatModal
        visible={exportModalVisible}
        onClose={() => setExportModalVisible(false)}
        onExport={handleExport}
      />

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
      <InvoiceDetailModal
        invoice={selectedInvoice}
        scannedBy={selectedInvoice ? pictureByUserId[selectedInvoice.user_id] : undefined}
        onClose={() => setSelectedInvoice(null)}
        editMode={editMode}
        onStartEdit={() => selectedInvoice && startEditInvoice(selectedInvoice)}
        onCancelEdit={() => setEditMode(false)}
        dateLocale={dateLocale}
        language={language}
        editSupplier={editSupplier}
        onChangeSupplier={setEditSupplier}
        editSupplierEik={editSupplierEik}
        onChangeSupplierEik={setEditSupplierEik}
        editInvoiceNumber={editInvoiceNumber}
        onChangeInvoiceNumber={setEditInvoiceNumber}
        editDate={editDate}
        onChangeEditDate={setEditDate}
        isEditDatePickerVisible={isEditDatePickerVisible}
        onOpenEditDatePicker={() => setEditDatePickerVisible(true)}
        onCloseEditDatePicker={() => setEditDatePickerVisible(false)}
        editAmountWithoutVat={editAmountWithoutVat}
        onChangeAmountWithoutVat={setEditAmountWithoutVat}
        editVatAmount={editVatAmount}
        onChangeVatAmount={setEditVatAmount}
        editVatTreatment={editVatTreatment}
        onChangeVatTreatment={setEditVatTreatment}
        editNotes={editNotes}
        onChangeNotes={setEditNotes}
        savingEdit={savingEdit}
        onSaveEdit={handleSaveEditedInvoice}
        selectedInvoiceAlerts={selectedInvoiceAlerts}
        loadingInvoiceAlerts={loadingInvoiceAlerts}
        updatingPayment={updatingPayment}
        onTogglePaid={handleTogglePaid}
        onOpenPaymentModal={openPaymentModal}
        scannedPages={scannedPages}
        loadingScannedPages={loadingScannedPages}
        onViewPage={setViewerPageIndex}
        onDelete={handleDeleteInvoice}
      />

      {/* Full-screen scanned page viewer - opened by tapping a thumbnail in
          the detail modal above. */}
      <ImageViewerModal
        pages={scannedPages}
        pageIndex={viewerPageIndex}
        onChangeIndex={setViewerPageIndex}
      />

      {/* Record/edit payment amount - edit-in-place, same convention as the
          daily-revenue form: the field shows what's already paid, and
          saving REPLACES that value rather than adding to it. */}
      <PaymentModal
        visible={paymentModalVisible}
        onClose={() => setPaymentModalVisible(false)}
        invoice={selectedInvoice}
        amountInput={paymentAmountInput}
        onChangeAmountInput={setPaymentAmountInput}
        onSave={handleSavePaymentAmount}
        saving={updatingPayment}
      />
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
  restoreHintBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  restoreHintText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
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
  quickLinksRow: {
    marginTop: 12,
    height: 36,
    flexGrow: 0,
    flexShrink: 0,
  },
  quickLinksContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  quickLinkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    marginRight: 8,
    flexShrink: 0,
  },
  quickLinkChipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
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
});

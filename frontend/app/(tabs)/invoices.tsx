import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { FirstUseHint } from '../../src/components/FirstUseHint';
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
import { useModules } from '../../src/stores/modulesStore';
import DateTimePickerModal from '../../src/components/AppDateTimePicker';
import { Alert } from '../../src/utils/alert';
import { Toast } from '../../src/utils/toast';
import { Haptics } from '../../src/utils/haptics';
import { api } from '../../src/services/api';
import { Invoice, PaymentMethod, VatTreatment, InvoiceDocumentType } from '../../src/types';
import { validateEikFormat } from '../../src/utils/eik';
import { format } from 'date-fns/format';
import { downloadAndShareFile } from '../../src/utils/downloadFile';
import { useTranslation, useLanguageStore } from '../../src/i18n';
import ExcelImportModal from '../../src/components/ExcelImportModal';
import { ScanCreditsBadge, Expandable, CountUp, SkeletonRow, AnimatedEmptyIcon } from '../../src/components';
import { ExportFormatModal } from '../../src/components/invoices/ExportFormatModal';
import { ImageViewerModal } from '../../src/components/invoices/ImageViewerModal';
import { PaymentModal, PaymentMethodChoice } from '../../src/components/invoices/PaymentModal';
import { InvoiceDetailModal } from '../../src/components/invoices/InvoiceDetailModal';
import { COLORS } from '../../src/theme/colors';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, interpolate, Extrapolation } from 'react-native-reanimated';
import { toApiDate } from '../../src/utils/periodRange';
import { formatAmount, formatMoney, readAmount } from '../../src/utils/money';

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
        start: toApiDate(new Date(now.getFullYear(), now.getMonth(), 1)),
        end: toApiDate(now),
      };
    case 'lastMonth':
      return {
        start: toApiDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        end: toApiDate(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'last3Months':
      return {
        start: toApiDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
        end: toApiDate(now),
      };
    case 'thisYear':
      return {
        start: toApiDate(new Date(now.getFullYear(), 0, 1)),
        end: toApiDate(now),
      };
    case 'custom':
      return { start: toApiDate(customStart), end: toApiDate(customEnd) };
    default:
      return {};
  }
}

export default function InvoicesScreen() {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { hasPermission } = useAuth();
  // A bank statement records payments on supplier invoices and customer debts.
  const canReadStatement = hasPermission('manage_invoices') || hasPermission('add_revenue');
  const usesBilling = useModules().uses('billing');
  const router = useRouter();
  const params = useLocalSearchParams<{ paymentFilter?: string; invoiceId?: string }>();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  // Set only when the backend's true match count exceeds what was
  // actually returned (it caps at 1,000 by default) - lets the banner
  // below tell the user some invoices aren't shown instead of silently
  // looking like a complete, if short, list.
  const [invoicesTotalCount, setInvoicesTotalCount] = useState<number | null>(null);
  // Sums of every invoice the filter matches (from the server), so the
  // header totals cover the whole period even past the first page.
  const [serverTotals, setServerTotals] = useState<{ amount: number; vat: number } | null>(null);
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
      const { invoices: data, totalCount, totalAmount: allAmount, totalVat: allVat } = await api.getInvoicesPage({
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(start ? { start_date: start } : {}),
        ...(end ? { end_date: end } : {}),
        ...(paymentFilter !== 'all' ? { payment_status: paymentFilter } : {}),
        limit: 1000,
      });
      setInvoices(data);
      setInvoicesTotalCount(totalCount > data.length ? totalCount : null);
      setServerTotals(allAmount != null && allVat != null ? { amount: allAmount, vat: allVat } : null);
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
  const [paymentDate, setPaymentDate] = useState(new Date());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodChoice>('bank_transfer');

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
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod | ''>('');
  const [editDocumentType, setEditDocumentType] = useState<InvoiceDocumentType>('invoice');
  const [editCreditedNumber, setEditCreditedNumber] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editLocation, setEditLocation] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Real incident this fixes: OCR (or a fat-fingered manual entry) read a
  // 6-pack as "1 бр.", so the per-unit price looked 6x higher than it
  // actually is and fired a bogus price-change alert - with no way to
  // correct just the quantity/price of one already-saved line, the only
  // option was delete-and-rescan the whole invoice. Quantity/unit_price
  // are kept as strings for direct TextInput binding, same convention as
  // editAmountWithoutVat/editVatAmount above.
  const [editItems, setEditItems] = useState<
    { id: string; name: string; quantity: string; unit: string; unit_price: string }[]
  >([]);

  const startEditInvoice = (invoice: Invoice) => {
    setEditSupplier(invoice.supplier);
    setEditSupplierEik(invoice.supplier_eik || '');
    setEditInvoiceNumber(invoice.invoice_number);
    setEditDate(new Date(invoice.date));
    // Amounts are edited as printed; a credit note's sign is its type.
    setEditDocumentType(invoice.document_type === 'credit_note' ? 'credit_note' : 'invoice');
    setEditCreditedNumber(invoice.credited_invoice_number || '');
    setEditAmountWithoutVat(Math.abs(invoice.amount_without_vat).toFixed(2));
    setEditVatAmount(Math.abs(invoice.vat_amount).toFixed(2));
    setEditVatTreatment(invoice.vat_treatment || '');
    setEditPaymentMethod(invoice.payment_method || '');
    setEditNotes(invoice.notes || '');
    setEditLocation(invoice.location_id ?? null);
    setEditItems(
      (invoice.items || []).map((it) => ({
        id: it.id, name: it.name, quantity: String(it.quantity), unit: it.unit, unit_price: it.unit_price.toFixed(2),
      }))
    );
    setEditMode(true);
  };

  const updateEditItemField = (itemId: string, field: 'quantity' | 'unit_price', value: string) => {
    setEditItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, [field]: value } : it)));
  };

  const handleSaveEditedInvoice = async (checked: { lines?: boolean; paid?: boolean | null } = {}) => {
    if (!selectedInvoice) return;
    const supplier = editSupplier.trim();
    const invoiceNumber = editInvoiceNumber.trim();
    const withoutVat = readAmount(editAmountWithoutVat);
    const vat = readAmount(editVatAmount);
    if (!supplier || !invoiceNumber || isNaN(withoutVat) || isNaN(vat)) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }
    const parsedItems = editItems.map((it) => ({
      id: it.id,
      quantity: readAmount(it.quantity),
      unit_price: readAmount(it.unit_price),
    }));
    if (parsedItems.some((it) => isNaN(it.quantity) || it.quantity <= 0 || isNaN(it.unit_price))) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }
    // The corrected lines are checked against the total, as at scan.
    if (!checked.lines && parsedItems.length > 0) {
      try {
        const check = await api.checkInvoiceDraft({
          amount_without_vat: withoutVat, vat_amount: vat, total_amount: withoutVat + vat,
          items: editItems.map((it, i) => ({
            name: it.name, quantity: parsedItems[i].quantity, unit_price: parsedItems[i].unit_price, printed_total: null,
          })),
        });
        if (check.lines && !check.lines.ok) {
          Alert.alert(
            t('invoices.linesMismatchTitle'),
            t('invoices.linesMismatchText')
              .replace('{lines}', formatAmount(check.lines.sum))
              .replace('{base}', formatAmount(check.lines.base)),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('invoices.saveAnyway'), onPress: () => { handleSaveEditedInvoice({ ...checked, lines: true }); } },
            ],
          );
          return;
        }
      } catch {
        // The check is a help, never a block.
      }
    }
    // From paid at the till to a bank transfer: was it already paid?
    // (Nothing is owed on a credit note - no payment to change or ask.)
    const isCreditNote = editDocumentType === 'credit_note';
    const methodChanged = !isCreditNote && !!editPaymentMethod && editPaymentMethod !== (selectedInvoice.payment_method || '');
    const fromTillToBank = methodChanged && editPaymentMethod === 'bank_transfer'
      && (selectedInvoice.payment_method === 'cash' || selectedInvoice.payment_method === 'card');
    if (fromTillToBank && checked.paid === undefined) {
      Alert.alert(t('invoices.alreadyPaidTitle'), t('invoices.alreadyPaidText'), [
        { text: t('invoices.notPaidYet'), onPress: () => { handleSaveEditedInvoice({ ...checked, paid: false }); } },
        { text: t('invoices.alreadyPaid'), onPress: () => { handleSaveEditedInvoice({ ...checked, paid: true }); } },
      ]);
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await api.updateInvoice(selectedInvoice.id, {
        ...(methodChanged ? { payment_method: editPaymentMethod as PaymentMethod } : {}),
        ...(fromTillToBank && checked.paid ? { is_paid: true } : {}),
        supplier,
        supplier_eik: editSupplierEik.trim() || undefined,
        invoice_number: invoiceNumber,
        document_type: editDocumentType,
        ...(isCreditNote ? { credited_invoice_number: editCreditedNumber.trim() } : {}),
        date: toApiDate(editDate),
        amount_without_vat: withoutVat,
        vat_amount: vat,
        total_amount: withoutVat + vat,
        vat_treatment: editVatTreatment || undefined,
        notes: editNotes.trim() || undefined,
        items: parsedItems.length > 0 ? parsedItems : undefined,
        // "" takes it off any location.
        location_id: editLocation ?? '',
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

  // What is left to pay: the total less what was paid and what credit
  // notes took off.
  const invoiceLeft = (invoice: Invoice) =>
    Math.max(invoice.total_amount - invoice.paid_amount - (invoice.credited_amount || 0), 0);

  const openPaymentModal = (invoice: Invoice) => {
    setPaymentAmountInput(invoiceLeft(invoice).toFixed(2));
    setPaymentDate(new Date());
    setPaymentMethod('bank_transfer');
    setPaymentModalVisible(true);
  };

  // A payment on its own day, added to the invoice's payment history.
  const handleSavePayment = async () => {
    if (!selectedInvoice) return;
    const amount = readAmount(paymentAmountInput);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert(t('common.error'), t('budget.invalidAmount'));
      return;
    }
    if (amount > invoiceLeft(selectedInvoice) + 0.01) {
      Alert.alert(t('common.error'), t('invoices.paidAmountExceedsTotal'));
      return;
    }
    setUpdatingPayment(true);
    try {
      const updated = await api.addInvoicePayment(selectedInvoice.id, {
        amount, date: format(paymentDate, 'yyyy-MM-dd'), method: paymentMethod,
      });
      applyInvoiceUpdate(updated);
      setPaymentModalVisible(false);
      Haptics.success();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setUpdatingPayment(false);
    }
  };

  const handleDeletePayment = (invoice: Invoice, paymentId: string) => {
    Alert.alert(t('invoices.deletePaymentTitle'), t('invoices.deletePaymentConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          setUpdatingPayment(true);
          try {
            applyInvoiceUpdate(await api.deleteInvoicePayment(invoice.id, paymentId));
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          } finally {
            setUpdatingPayment(false);
          }
        },
      },
    ]);
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
              // Where it can be brought back - said once, at the delete (Л10).
              Toast.success(t(hasPermission('restore_deleted_data') ? 'invoices.deletedRestorable' : 'invoices.deletedUndo'));
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
    const isCreditNote = item.document_type === 'credit_note';
    const isUnpaid = !isCreditNote && item.payment_method === 'bank_transfer' && !item.is_paid;
    const overdue = isUnpaid && !!item.payment_due_date && new Date(item.payment_due_date).getTime() < Date.now();
    // Paid in part, or a credit note took part of it off.
    const credited = item.credited_amount || 0;
    const isPartial = isUnpaid && (item.paid_amount > 0 || credited > 0);
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
            <Text style={styles.totalValueCompact}>{formatMoney(item.total_amount)}</Text>
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

          {(eikIssue || isUnpaid || isCreditNote) && (
            <View style={styles.compactBadgeRow}>
              {isCreditNote && (
                <View style={styles.compactBadge}>
                  <Ionicons name="return-down-back" size={11} color={COLORS.primary} />
                  <Text style={styles.compactBadgeText}>{t('invoices.creditNote')}</Text>
                </View>
              )}
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
                    {statusLabel}{isPartial ? ` (${formatMoney(Math.max(0, item.total_amount - item.paid_amount - credited))})` : ''}
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

  // Whole-filter sums from the server unless the list is narrowed on the
  // device (the ЕИК check), where only the shown invoices count.
  const useServerTotals = serverTotals !== null && !showOnlyEikIssues;
  const totalAmount = useServerTotals
    ? serverTotals.amount
    : visibleInvoices.reduce((sum, inv) => sum + inv.total_amount, 0);
  const totalVat = useServerTotals
    ? serverTotals.vat
    : visibleInvoices.reduce((sum, inv) => sum + inv.vat_amount, 0);

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
        {section.data.length} · {t('invoices.monthlyTotal')} {formatMoney(section.totalAmount)}
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
          {((usesBilling && (hasPermission('add_revenue') || hasPermission('issue_invoices'))) || hasPermission('view_statistics') || canReadStatement) && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.quickLinksRow}
              contentContainerStyle={styles.quickLinksContent}
            >
              {usesBilling && hasPermission('add_revenue') && (
                <TouchableOpacity style={styles.quickLinkChip} onPress={() => router.push('/receivables')}>
                  <Ionicons name="cash-outline" size={15} color={COLORS.success} />
                  <Text style={styles.quickLinkChipText}>{t('receivables.title')}</Text>
                </TouchableOpacity>
              )}
              {usesBilling && (hasPermission('add_revenue') || hasPermission('issue_invoices')) && (
                <TouchableOpacity style={styles.quickLinkChip} onPress={() => router.push('/billing-documents')}>
                  <Ionicons name="document-text-outline" size={15} color={COLORS.success} />
                  <Text style={styles.quickLinkChipText}>{t('billingDocuments.title')}</Text>
                </TouchableOpacity>
              )}
              {canReadStatement && (
                <TouchableOpacity style={styles.quickLinkChip} onPress={() => router.push('/bank-statement')}>
                  <Ionicons name="business-outline" size={15} color={COLORS.primary} />
                  <Text style={styles.quickLinkChipText}>{t('bankStatement.title')}</Text>
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

          <View style={{ marginHorizontal: 16 }}>
            <FirstUseHint id="invoices" icon="document-text" text={t('hint.invoices')} />
          </View>

          {/* Search, the filters and the EIK warning - one row (Л13). */}
          <View style={styles.searchRow}>
          <View style={[styles.searchContainer, styles.searchInRow]}>
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
          {/* The filters (period, payment) open under the row; the number
              says how many are on. */}
          <TouchableOpacity
            style={[styles.filterButton, (filtersExpanded || activeFilterCount > 0) && styles.filterButtonOn]}
            onPress={() => setFiltersExpanded((prev) => !prev)}
            accessibilityLabel={t('invoices.filtersButton')}
            accessibilityState={{ expanded: filtersExpanded }}
          >
            <Ionicons name="options-outline" size={20} color={COLORS.primary} />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          {/* Invoices whose supplier has no valid EIK: a filter of its own. */}
          {eikIssueCount > 0 && (
            <TouchableOpacity
              style={[styles.eikChip, showOnlyEikIssues && styles.eikChipOn]}
              onPress={() => setShowOnlyEikIssues((prev) => !prev)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: showOnlyEikIssues }}
              accessibilityLabel={`${eikIssueCount} ${eikIssueCount === 1 ? t('invoices.missingEikSingular') : t('invoices.missingEikPlural')}`}
            >
              <Ionicons name="alert-circle" size={15} color={showOnlyEikIssues ? COLORS.background : COLORS.warning} />
              <Text style={[styles.eikChipText, showOnlyEikIssues && styles.eikChipTextOn]}>{eikIssueCount}</Text>
              <Text style={[styles.eikChipText, showOnlyEikIssues && styles.eikChipTextOn]}>{t('invoices.eikChip')}</Text>
            </TouchableOpacity>
          )}
          </View>

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

          {/* Summary */}
          <View style={styles.summaryBar}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('invoices.count')}:</Text>
              <Text style={styles.summaryValue}>{visibleInvoices.length}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('stats.vat')}:</Text>
              <Text style={styles.summaryValue}>{formatMoney(totalVat)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('invoices.total')}:</Text>
              <CountUp
                value={totalAmount}
                formatter={(n) => `${formatMoney(n)}`}
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
          { key: 'total_amount', label: t('invoices.total'), format: (v) => `${formatMoney(Number(v))}` },
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
        editDocumentType={editDocumentType}
        onChangeDocumentType={setEditDocumentType}
        editCreditedNumber={editCreditedNumber}
        onChangeCreditedNumber={setEditCreditedNumber}
        editPaymentMethod={editPaymentMethod}
        onChangePaymentMethod={setEditPaymentMethod}
        editNotes={editNotes}
        onChangeNotes={setEditNotes}
        editLocation={editLocation}
        onChangeLocation={setEditLocation}
        editItems={editItems}
        onChangeEditItemField={updateEditItemField}
        savingEdit={savingEdit}
        onSaveEdit={() => handleSaveEditedInvoice()}
        selectedInvoiceAlerts={selectedInvoiceAlerts}
        loadingInvoiceAlerts={loadingInvoiceAlerts}
        updatingPayment={updatingPayment}
        onTogglePaid={handleTogglePaid}
        onOpenPaymentModal={openPaymentModal}
        onDeletePayment={handleDeletePayment}
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
        date={paymentDate}
        onChangeDate={setPaymentDate}
        method={paymentMethod}
        onChangeMethod={setPaymentMethod}
        onSave={handleSavePayment}
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
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16 },
  searchInRow: { flex: 1, marginHorizontal: 0, paddingHorizontal: 12, gap: 8 },
  filterButton: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonOn: { backgroundColor: 'rgba(139, 92, 246, 0.2)' },
  filterBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: { color: 'white', fontSize: 10, fontWeight: '700' },
  eikChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 46,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  eikChipOn: { backgroundColor: COLORS.warning },
  eikChipText: { color: COLORS.warning, fontSize: 13, fontWeight: '700' },
  eikChipTextOn: { color: COLORS.background },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    color: 'white',
    fontSize: 16,
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
  eikBannerText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.warning,
    fontWeight: '600',
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

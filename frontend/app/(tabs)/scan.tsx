import React, { useState, useEffect, useMemo, useRef } from 'react';
import { InfoButton } from '../../src/components/InfoButton';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  ImageBackground,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { Toast } from '../../src/utils/toast';
import { Haptics } from '../../src/utils/haptics';
import * as ImagePicker from 'expo-image-picker';
import { prepareScanImage } from '../../src/utils/scanImage';
import DateTimePickerModal from '../../src/components/AppDateTimePicker';
import { ScanCreditsReloadButton, StaggerReveal, Expandable, PressableScale, LocationPicker } from '../../src/components';
import { useLocationChoice, useLocationsStore } from '../../src/stores/locationsStore';
import { api } from '../../src/services/api';
import { useAuth } from '../../src/contexts/AuthContext';
import { useModules } from '../../src/stores/modulesStore';
import { useScanQueueStore, QueuedScan, isNetworkError } from '../../src/stores/scanQueueStore';
import { useNetwork } from '../../src/hooks/useNetwork';
import NetInfo from '@react-native-community/netinfo';
import { OCRResult, InvoiceItemCreate, VatTreatment, PaymentMethod, ItemPriceHint, InvoiceDraftCheck, InvoiceDraftFix, InvoiceDocumentType } from '../../src/types';
import { detectPackMultiple, formatEur, priceAlertMeaning } from '../../src/utils/priceAlert';
import { format } from 'date-fns/format';
import { parse } from 'date-fns/parse';
import { useTranslation, useLanguageStore } from '../../src/i18n';
import { COLORS } from '../../src/theme/colors';
import { toApiDate } from '../../src/utils/periodRange';
import { formatAmount, formatMoney, parseAmount, readAmount } from '../../src/utils/money';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

interface EditableItem {
  name: string;
  quantity: string;
  unit: string;
  unit_price: string;
  // As recognized, before any correction - what a pack re-read is measured
  // against when the invoice is saved (that is how the app learns it).
  // total_price = the line's value as printed, which the amounts check
  // holds quantity x price against.
  ocr?: { quantity: number; unit_price: number; total_price?: number };
  // A pack size learned from an earlier correction that the app applied
  // automatically; `undone` once the owner put the line back.
  packRule?: { multiple: number; undone: boolean };
}

const emptyItem = (): EditableItem => ({ name: '', quantity: '1', unit: 'бр.', unit_price: '' });

// A typed amount as a number ("12,50", "12.50", "1 234,50"); 0 when empty.
const toNumber = (value: string | number | null | undefined): number => parseAmount(String(value ?? ''));

// How long after the last edit the amounts are checked again.
const DRAFT_CHECK_DELAY_MS = 500;

export default function ScanScreen() {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const router = useRouter();

  // Which direction the scanned document is: a purchase invoice FROM a
  // supplier (the default, feeds the invoice form below) or an invoice the
  // business itself ISSUED to a customer in another program - saved as an
  // issued invoice with its own number (income of its day; one paid at the
  // till is in that day's till revenue already and is not counted again).
  const [scanMode, setScanMode] = useState<'purchase' | 'sales'>('purchase');
  // An invoice the business issued is saved as an issued invoice - its own right.
  const { hasPermission, user } = useAuth();
  const companyId = user?.company_id ?? null;
  // Scanning without a connection (Н12): the pages are kept and read once
  // the connection is back - here, or from the queue below.
  const { isOnline } = useNetwork();
  const [offlineWaiting, setOfflineWaiting] = useState(false);
  const queue = useScanQueueStore((state) => state.items);
  const loadQueue = useScanQueueStore((state) => state.load);
  const enqueueScan = useScanQueueStore((state) => state.enqueue);
  const processQueue = useScanQueueStore((state) => state.processPending);
  const retryQueued = useScanQueueStore((state) => state.retry);
  const removeQueued = useScanQueueStore((state) => state.remove);
  const takeQueued = useScanQueueStore((state) => state.take);
  const queueProcessing = useScanQueueStore((state) => state.processing);
  const { uses } = useModules();
  const canIssueInvoices = hasPermission('issue_invoices') && uses('billing');
  const usesTill = uses('till');
  const [salesVatRate, setSalesVatRate] = useState<20 | 9 | 0>(20);
  const [salesCustomer, setSalesCustomer] = useState('');
  const [salesCustomerEik, setSalesCustomerEik] = useState('');
  const [salesPaymentMethod, setSalesPaymentMethod] = useState<'bank_transfer' | 'cash' | 'card'>('bank_transfer');
  const [salesInTill, setSalesInTill] = useState(false);
  const [logsTill, setLogsTill] = useState(false);

  // Whether the business enters its till here: then a sales invoice paid in
  // cash or by card went through the till (a fiscal receipt).
  useEffect(() => {
    if (scanMode !== 'sales') return;
    api.getInvoiceDefaults()
      .then((defaults) => { setLogsTill(defaults.logs_till); setSalesInTill(defaults.logs_till); })
      .catch(() => {});
  }, [scanMode]);

  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Every photographed page of the current invoice, in capture order - a
  // long invoice can span several pages, so this isn't limited to one shot.
  // Each entry is a full data URI (ready to display AND to send to the
  // backend, which strips the prefix itself).
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [ocrCorrections, setOcrCorrections] = useState<string[]>([]);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  // What each recognized line would raise once saved, judged by the same
  // engine as a saved invoice: a "pack of N?" question when the price is
  // exactly a pack multiple of the usual one (with a one-tap fix), or a
  // real change with its size in EUR a month - so a misread is fixed here,
  // before it reaches the price history. Keyed by the item's index in
  // `items` (its name alone isn't a stable key - two rows can share a
  // name before the user's edited them apart).
  const [itemPriceHints, setItemPriceHints] = useState<Record<number, ItemPriceHint>>({});
  // Do the amounts add up (POST /invoices/draft-check)? Asked again after
  // every edit; `draftCheckFresh` is false from an edit until the answer
  // for it arrives - meanwhile the old answer shows dimmed, without its
  // fix buttons (a second tap must not apply a fix twice) or line notes
  // (their positions may have moved).
  const [draftCheck, setDraftCheck] = useState<InvoiceDraftCheck | null>(null);
  const [draftCheckFresh, setDraftCheckFresh] = useState(false);
  const draftCheckSeq = useRef(0);
  const draftLineFlags = useMemo(
    () => Object.fromEntries((draftCheck?.line_flags || []).map((flag) => [flag.index, flag])),
    [draftCheck],
  );

  // Form fields (editable after OCR)
  const [supplier, setSupplier] = useState('');
  const [supplierEik, setSupplierEik] = useState('');
  const [eikCheck, setEikCheck] = useState<{ valid: boolean; reason: string | null } | null>(null);
  // Known suppliers (name + ЕИК) from this company's own invoice history -
  // drives the autocomplete chips below the supplier field, so correcting
  // an OCR misread or typing a supplier manually doesn't mean retyping an
  // ЕИК that's already on file from a previous invoice. Loaded once, lazily
  // (reuses the existing invoice list endpoint, no backend change).
  const [supplierDirectory, setSupplierDirectory] = useState<{ name: string; eik: string; date: string }[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amountWithoutVat, setAmountWithoutVat] = useState('');
  const [vatAmount, setVatAmount] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [vatTreatment, setVatTreatment] = useState<VatTreatment | ''>('');
  const [notes, setNotes] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date());
  // Tri-state: null before any scan (nothing to flag yet), true once OCR
  // genuinely found a printed date, false when it didn't - in that case
  // invoiceDate above still silently holds today's date (the field is
  // required), so this is what drives the "no date found, please check"
  // warning that keeps that silent default from being mistaken for a
  // confirmed, OCR-read date.
  const [dateFoundByOcr, setDateFoundByOcr] = useState<boolean | null>(null);
  // Л6: what was read shows as a short card with Save on top; the whole
  // form opens with "Редактирай".
  const [reviewing, setReviewing] = useState(false);
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  // The location the invoice is for (Н11): until picked, the last one used here.
  const { fallback: defaultLocation } = useLocationChoice();
  const rememberLocation = useLocationsStore((state) => state.remember);
  const [locationPick, setLocationPick] = useState<string | null | undefined>(undefined);
  const invoiceLocation = locationPick === undefined ? defaultLocation : locationPick;
  const [paymentMethodFromOcr, setPaymentMethodFromOcr] = useState(false);
  const [paymentMethodMissing, setPaymentMethodMissing] = useState(false);
  const [paymentDueDate, setPaymentDueDate] = useState<Date | null>(null);
  // A credit note (кредитно известие) takes purchases and the VAT credit
  // down; its amounts are typed as printed and nothing is owed on it.
  const [documentType, setDocumentType] = useState<InvoiceDocumentType>('invoice');
  const isCreditNote = documentType === 'credit_note';
  // The invoice a credit note corrects ("към фактура №", printed on it):
  // what it takes off is no longer owed on that invoice.
  const [creditedInvoiceNumber, setCreditedInvoiceNumber] = useState('');
  const [isDueDatePickerVisible, setDueDatePickerVisible] = useState(false);

  // Suggest a VAT treatment from the amounts (mirrors the backend's own
  // fallback) so the picker isn't just left blank, but only until the user
  // has actually chosen one themselves.
  useEffect(() => {
    if (vatTreatment) return;
    const base = toNumber(amountWithoutVat);
    const vat = toNumber(vatAmount);
    if (!base) return;
    const ratio = vat / base;
    if (Math.abs(ratio - 0.20) < 0.01) setVatTreatment('standard_20');
    else if (Math.abs(ratio - 0.09) < 0.01) setVatTreatment('reduced_9');
  }, [amountWithoutVat, vatAmount, vatTreatment]);

  // Same auto-detection, but snapped to the fixed 20/9/0% chips the daily
  // revenue form uses, for sales mode.
  useEffect(() => {
    const base = toNumber(amountWithoutVat);
    const vat = toNumber(vatAmount);
    if (!base) return;
    const ratio = vat / base;
    if (Math.abs(ratio - 0.09) < 0.01) setSalesVatRate(9);
    else if (Math.abs(ratio) < 0.01) setSalesVatRate(0);
    else setSalesVatRate(20);
  }, [amountWithoutVat, vatAmount]);

  // Live ЕИК format/checksum check, debounced so it doesn't fire on every keystroke
  useEffect(() => {
    const trimmed = supplierEik.trim();
    if (!trimmed) {
      setEikCheck(null);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const result = await api.validateEik(trimmed);
        setEikCheck({ valid: result.valid, reason: result.reason });
      } catch {
        setEikCheck(null);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [supplierEik]);

  useEffect(() => {
    if (scanMode !== 'purchase' || capturedImages.length === 0 || supplierDirectory.length > 0) return;
    api.getInvoices({})
      .then((invoices) => {
        const byName = new Map<string, { name: string; eik: string; date: string }>();
        invoices.forEach((inv) => {
          const key = inv.supplier.trim().toLowerCase();
          if (!key) return;
          const existing = byName.get(key);
          if (!existing || inv.date > existing.date) {
            byName.set(key, { name: inv.supplier.trim(), eik: inv.supplier_eik || '', date: inv.date });
          }
        });
        setSupplierDirectory(Array.from(byName.values()));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanMode, capturedImages.length]);

  const supplierMatches = useMemo(() => {
    const q = supplier.trim().toLowerCase();
    if (!q) return [];
    return supplierDirectory
      .filter((s) => s.name.toLowerCase() !== q && s.name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [supplier, supplierDirectory]);

  // Delegates to the phone's own camera app (via the OS camera picker)
  // instead of a custom in-page live preview. The in-page camera had no
  // reliable autofocus on web (browsers don't expose manual focus control
  // to sites), so photos often came out blurry regardless of screen size
  // or phone quality - the native camera app has full autofocus/HDR and
  // uses the phone's actual camera capabilities.
  // Adds a newly captured page to the current invoice and re-runs OCR over
  // ALL pages so far (not just the new one) - a total on the last page or a
  // header on the first page can only be read correctly once every page is
  // known, so partial per-page results would just get overwritten anyway.
  const addPage = async (dataUri: string) => {
    const updated = [...capturedImages, dataUri];
    setCapturedImages(updated);
    // No connection: the page joins the others, read together later.
    if (offlineWaiting) return;
    await processImages(updated);
  };

  const removePage = async (index: number) => {
    const updated = capturedImages.filter((_, i) => i !== index);
    if (updated.length === 0) {
      resetForm();
      return;
    }
    setCapturedImages(updated);
    await processImages(updated);
  };

  const handleTakePhoto = async () => {
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 1,
      });

      if (!result.canceled && result.assets[0].base64) {
        // OCR reveal choreography, step 1: confirm the capture itself with
        // a light haptic the instant the shutter fires - no delay waiting
        // on the network/OCR call that follows.
        Haptics.success();
        const dataUri = await prepareScanImage(result.assets[0]);
        await addPage(dataUri);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert(t('common.error'), t('scan.cameraError'));
    }
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 1,
    });

    if (!result.canceled && result.assets[0].base64) {
      const dataUri = await prepareScanImage(result.assets[0]);
      await addPage(dataUri);
    }
  };

  // Best-effort like the price hints: no answer just shows nothing.
  useEffect(() => {
    if (scanMode !== 'purchase' || items.length === 0) {
      setDraftCheck(null);
      return;
    }
    setDraftCheckFresh(false);
    const seq = ++draftCheckSeq.current;
    const handle = setTimeout(async () => {
      try {
        const result = await api.checkInvoiceDraft({
          amount_without_vat: toNumber(amountWithoutVat),
          vat_amount: toNumber(vatAmount),
          total_amount: toNumber(totalAmount),
          items: items.map((item) => ({
            name: item.name,
            quantity: toNumber(item.quantity) || 1,
            unit_price: toNumber(item.unit_price),
            printed_total: item.ocr?.total_price ?? null,
          })),
        });
        if (seq === draftCheckSeq.current) {
          setDraftCheck(result);
          setDraftCheckFresh(true);
        }
      } catch {
        if (seq === draftCheckSeq.current) setDraftCheck(null);
      }
    }, DRAFT_CHECK_DELAY_MS);
    return () => clearTimeout(handle);
  }, [items, amountWithoutVat, vatAmount, totalAmount, scanMode]);

  // Best-effort: a failed check just leaves the lines without hints,
  // never blocks the scan.
  const loadItemPriceHints = async (
    ocrItems: { name: string; quantity: number; unit?: string; unit_price: number }[],
    supplierName: string,
  ) => {
    if (!supplierName.trim() || ocrItems.length === 0) return;
    try {
      const { hints } = await api.checkItemPrices(supplierName, ocrItems.map((item) => ({
        name: item.name,
        quantity: item.quantity || 1,
        unit: item.unit || 'бр.',
        unit_price: item.unit_price,
      })));
      const byIndex: Record<number, ItemPriceHint> = {};
      const learned: Record<number, number> = {};
      hints.forEach((hint) => {
        if (hint.kind === 'pack_rule' && hint.auto_apply && hint.pack_multiple) {
          learned[hint.index] = hint.pack_multiple;
        } else {
          byIndex[hint.index] = hint;
        }
      });
      setItemPriceHints(byIndex);
      // A pack size the owner corrected before is applied straight away -
      // only to lines still exactly as recognized, and with an undo.
      if (Object.keys(learned).length > 0) {
        setItems((prev) => prev.map((item, i) => {
          const k = learned[i];
          if (!k || !item.ocr) return item;
          if (toNumber(item.quantity) !== item.ocr.quantity || toNumber(item.unit_price) !== item.ocr.unit_price) {
            return item;
          }
          return {
            ...item,
            quantity: String(Math.round(item.ocr.quantity * k * 1000) / 1000),
            unit_price: String(Math.round((item.ocr.unit_price / k) * 10000) / 10000),
            packRule: { multiple: k, undone: false },
          };
        }));
      }
    } catch {
      // no hints
    }
  };

  // The line as it would read if it really was a pack: N times the
  // quantity at 1/N the price (or the reverse when the price came in N
  // times BELOW the usual pack price). Same line total either way.
  const packFixValues = (index: number): { quantity: number; unitPrice: number } | null => {
    const hint = itemPriceHints[index];
    const item = items[index];
    if (!hint || hint.kind !== 'pack_suspect' || !hint.pack_multiple || !item) return null;
    const k = hint.pack_multiple;
    const qty = toNumber(item.quantity) || 1;
    const price = toNumber(item.unit_price);
    if (!price) return null;
    const split = hint.direction !== 'decrease';
    return {
      quantity: Math.round((split ? qty * k : qty / k) * 1000) / 1000,
      unitPrice: Math.round((split ? price / k : price * k) * 10000) / 10000,
    };
  };

  // The remembered-pack note shows only while the line still holds the
  // values the app put there - an edit by hand makes it the owner's own.
  const packRuleActive = (item: EditableItem): boolean => {
    if (!item.packRule || item.packRule.undone || !item.ocr) return false;
    const k = item.packRule.multiple;
    return toNumber(item.quantity) === Math.round(item.ocr.quantity * k * 1000) / 1000
      && toNumber(item.unit_price) === Math.round((item.ocr.unit_price / k) * 10000) / 10000;
  };

  // Puts a line the app converted with a remembered pack size back the way
  // it was recognized; saving it like that forgets that pack size.
  const undoPackRule = (index: number) => {
    setItems(prev => prev.map((item, i) => (
      i === index && item.ocr && item.packRule
        ? {
          ...item,
          quantity: String(item.ocr.quantity),
          unit_price: String(item.ocr.unit_price),
          packRule: { ...item.packRule, undone: true },
        }
        : item
    )));
  };

  const applyPackFix = (index: number) => {
    const fix = packFixValues(index);
    if (!fix) return;
    updateItem(index, { quantity: String(fix.quantity), unit_price: String(fix.unitPrice) });
  };

  const processImages = async (images: string[]) => {
    const network = await NetInfo.fetch().catch(() => null);
    if (network && (network.isConnected === false || network.isInternetReachable === false)) {
      setOfflineWaiting(true);
      return;
    }
    setOfflineWaiting(false);
    setIsScanning(true);
    setOcrCorrections([]);
    setOcrConfidence(null);
    try {
      const result = await api.scanInvoice(images);
      // The pages as they were read - the sheet straightened and cut out of
      // the table - shown and kept instead of the photos; a page changed
      // meanwhile stays as it is.
      if (result.pages?.some(Boolean)) {
        setCapturedImages((current) => current.map((image, i) => (image === images[i] && result.pages?.[i]) || image));
      }
      applyOcrResult(result);
    } catch (error: any) {
      if (isNetworkError(error)) {
        // The connection dropped on the way: kept, as if offline from the start.
        setOfflineWaiting(true);
      } else if (error.status === 402) {
        // Out of scan credits - this is the app's one paid feature (see
        // ScanCreditService on the backend), so route to the purchase
        // screen instead of showing a dead-end error.
        Alert.alert(
          t('scanCredits.noScansLeft'),
          t('scanCredits.noScansLeftBody'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('scanCredits.goToPackages'), onPress: () => router.push('/scan-credits') },
          ]
        );
      } else {
        Alert.alert(t('scan.scanError'), error.message || t('scan.tryAgain'));
      }
    } finally {
      setIsScanning(false);
    }
  };

  // What was read off the pages, into the form - a scan just made or one
  // taken from the queue of scans read once the connection came back.
  const applyOcrResult = (result: OCRResult) => {
    setOcrResult(result);
    setReviewing(false);
    setDocumentType(result.document_type === 'credit_note' ? 'credit_note' : 'invoice');
    setCreditedInvoiceNumber(result.credited_invoice_number || '');
    // An invoice the business issued: the customer is its recipient.
    setSalesCustomer(result.buyer || '');
    setSalesCustomerEik(result.buyer_eik || '');
    if (result.payment_method === 'cash' || result.payment_method === 'card' || result.payment_method === 'bank_transfer') {
      setSalesPaymentMethod(result.payment_method);
    }
    setSupplier(result.supplier);
    setSupplierEik(result.supplier_eik || '');
    setInvoiceNumber(result.invoice_number);
    setAmountWithoutVat(result.amount_without_vat.toString());
    setVatAmount(result.vat_amount.toString());
    setTotalAmount(result.total_amount.toString());
    
    // Save corrections info
    if (result.corrections && result.corrections.length > 0) {
      setOcrCorrections(result.corrections);
    }
    if (result.confidence) {
      setOcrConfidence(result.confidence);
    }

    // Pre-fill the recognized line items - reviewable/editable before saving
    if (result.items && result.items.length > 0) {
      setItems(result.items.map(item => ({
        name: item.name,
        quantity: String(item.quantity),
        unit: item.unit || 'бр.',
        unit_price: String(item.unit_price),
        ocr: { quantity: item.quantity || 1, unit_price: item.unit_price, total_price: item.total_price },
      })));
      setItemPriceHints({});
      loadItemPriceHints(result.items, result.supplier);
    }
    
    // Set invoice date from OCR if available - and flag it clearly when
    // it isn't, instead of leaving invoiceDate silently at today's date
    // with no sign that nothing was actually read off the invoice.
    let foundDate = false;
    if (result.invoice_date) {
      try {
        // A plain "yyyy-MM-dd" is that day on this device's calendar -
        // new Date() would read it as UTC midnight, the day before
        // anywhere west of Greenwich.
        const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(result.invoice_date)
          ? parse(result.invoice_date, 'yyyy-MM-dd', new Date())
          : new Date(result.invoice_date);
        if (!isNaN(parsedDate.getTime())) {
          setInvoiceDate(parsedDate);
          foundDate = true;
        }
      } catch (e) {
        // Keep default date if parsing fails
      }
    }
    setDateFoundByOcr(foundDate);

    // A payment due date printed on the invoice does NOT reliably mean a
    // deferred bank-transfer payment - many Bulgarian invoice templates
    // print a standard payment-term line even when the purchase was
    // actually settled in cash on the spot, and auto-selecting "Банков
    // превод" from that printed line alone was wrongly flagging cash
    // purchases as unpaid. The due date is still useful if the user DOES
    // pick bank transfer themselves, so it's still pre-filled - just no
    // longer used to pick the payment method on the user's behalf.
    // The payment method printed on the invoice ("Начин на плащане") is
    // taken as read; when it isn't printed, the person picks it before
    // saving - an invoice without one was never tracked as owed.
    setPaymentMethodFromOcr(!!result.payment_method);
    if (result.payment_method) {
      setPaymentMethod(result.payment_method);
    }
    if (result.payment_due_date) {
      try {
        const parsedDueDate = new Date(result.payment_due_date);
        if (!isNaN(parsedDueDate.getTime())) {
          setPaymentDueDate(parsedDueDate);
        }
      } catch (e) {
        // Leave due date unset if parsing fails - manual picker covers it
      }
    }
  };

  // The connection came back while the pages wait here: read them now.
  useEffect(() => {
    if (isOnline && offlineWaiting && capturedImages.length > 0) {
      processImages(capturedImages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  const myQueue = queue.filter((item) => item.companyId === companyId);

  // Kept for later: read on its own once the connection is back.
  const saveForLater = async () => {
    try {
      await enqueueScan(capturedImages, scanMode, companyId);
      Toast.success(t('scanQueue.saved'));
      resetForm();
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || t('scanQueue.saveFailed'));
    }
  };

  const reviewQueued = async (item: QueuedScan) => {
    const taken = await takeQueued(item.id);
    if (!taken) return;
    resetForm();
    setScanMode(taken.mode);
    setCapturedImages(taken.pages);
    applyOcrResult(taken.result);
  };

  const retryNow = async (item: QueuedScan) => {
    await retryQueued(item.id);
    const ready = await processQueue(companyId);
    if (ready > 0) Toast.success(t('scanQueue.readyToast').replace('{count}', String(ready)));
  };

  const deleteQueued = (item: QueuedScan) => {
    Alert.alert(t('scanQueue.deleteTitle'), t('scanQueue.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => { removeQueued(item.id); } },
    ]);
  };

  const handleSaveInvoice = async (confirmed: boolean = false) => {
    if (!isCreditNote && !paymentMethod) {
      // Whether the invoice is owed or already paid decides every payables
      // figure - it is never left to a default.
      setPaymentMethodMissing(true);
      Alert.alert(t('common.error'), t('scan.paymentMethodRequired'));
      return;
    }
    if (!supplier || !invoiceNumber || !totalAmount) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }

    // Amounts that do not add up are asked about once more before they
    // reach the data - saving anyway stays the owner's call.
    const problems = draftProblems();
    if (problems.length > 0 && confirmed !== true) {
      Alert.alert(t('scanCheck.confirmTitle'), `${problems.join('\n')}\n\n${t('scanCheck.confirmBody')}`, [
        { text: t('scanCheck.review'), style: 'cancel' },
        { text: t('scanCheck.saveAnyway'), onPress: () => { handleSaveInvoice(true); } },
      ]);
      return;
    }

    const itemsPayload: InvoiceItemCreate[] = items
      .filter(item => item.name.trim() && item.unit_price)
      .map(item => {
        const quantity = toNumber(item.quantity) || 1;
        // A negative unit_price is kept as-is, not clamped to 0 - a
        // discount/rebate line ("отстъпка") printed as its own row on the
        // invoice is a real, common pattern the backend accepts on purpose.
        const unitPrice = toNumber(item.unit_price);
        // A pack re-read as pieces (by the fix button, by hand or by a
        // remembered pack size) is learned for this supplier and item; a
        // remembered pack size put back to the recognized line is forgotten.
        const packMultiple = item.ocr
          ? detectPackMultiple(item.ocr.quantity, item.ocr.unit_price, quantity, unitPrice)
          : null;
        const putBack = !!item.packRule && !!item.ocr
          && quantity === item.ocr.quantity && unitPrice === item.ocr.unit_price;
        return {
          name: item.name.trim(),
          quantity,
          unit: item.unit.trim() || 'бр.',
          unit_price: unitPrice,
          ...(packMultiple ? { pack_multiple_applied: packMultiple } : {}),
          ...(!packMultiple && putBack ? { pack_rule_rejected: true } : {}),
        };
      });

    setIsSaving(true);
    try {
      const saved = await api.createInvoice({
        supplier,
        supplier_eik: supplierEik.trim() || undefined,
        invoice_number: invoiceNumber,
        document_type: documentType,
        credited_invoice_number: isCreditNote ? creditedInvoiceNumber.trim() || undefined : undefined,
        amount_without_vat: toNumber(amountWithoutVat),
        vat_amount: toNumber(vatAmount),
        total_amount: toNumber(totalAmount),
        vat_treatment: vatTreatment || undefined,
        date: toApiDate(invoiceDate),
        image_base64s: capturedImages.length > 0 ? capturedImages : undefined,
        notes: notes || undefined,
        items: itemsPayload.length > 0 ? itemsPayload : undefined,
        payment_method: (!isCreditNote && paymentMethod) || undefined,
        payment_due_date: !isCreditNote && paymentMethod === 'bank_transfer' && paymentDueDate ? toApiDate(paymentDueDate) : undefined,
        location_id: invoiceLocation,
      });
      if (invoiceLocation) rememberLocation(invoiceLocation);
      Haptics.success();
      if (isCreditNote) {
        Toast.success(t('scan.creditNoteSaved'));
      } else if (saved.protocol_number) {
        Toast.success(`${t('msg.invoiceSaved')} · ${t('scan.protocolAssigned')} ${saved.protocol_number}`);
      } else {
        Toast.success(t('msg.invoiceSaved'));
      }
      resetForm();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // An invoice issued in another program: saved as an issued invoice with
  // its own number - never added to the till's revenue, where a sale paid
  // through the till already is (then it is marked so, not counted twice).
  const handleSaveSalesInvoice = async () => {
    const total = toNumber(totalAmount);
    const number = invoiceNumber.replace(/\D/g, '');
    if (!total || !salesCustomer.trim() || !number) {
      Alert.alert(t('common.error'), t('scan.salesRequired'));
      return;
    }
    if (number.length > 10) {
      Alert.alert(t('common.error'), t('scan.salesNumberTooLong'));
      return;
    }
    const net = Math.round((total / (1 + salesVatRate / 100)) * 100) / 100;
    setIsSaving(true);
    try {
      const saved = await api.createBillingDocument({
        doc_type: 'invoice',
        external: true,
        invoice_number: number,
        customer_name: salesCustomer.trim(),
        customer_eik: salesCustomerEik.trim() || undefined,
        issue_date: toApiDate(invoiceDate),
        payment_method: salesPaymentMethod,
        ...(salesPaymentMethod !== 'bank_transfer' ? { in_till: salesInTill } : {}),
        ...(invoiceLocation ? { location_id: invoiceLocation } : {}),
        items: [{
          name: t('scan.salesLine').replace('{number}', number), quantity: 1, unit: 'бр.', unit_price: net, vat_rate: salesVatRate,
        }],
      });
      if (invoiceLocation) rememberLocation(invoiceLocation);
      Haptics.success();
      Toast.success(t('scan.salesSaved').replace('{number}', saved.invoice_number || number));
      resetForm();
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || '');
    } finally {
      setIsSaving(false);
    }
  };

  const money = (value: number) => formatAmount(Math.abs(value));
  const lineName = (index: number | null) => (index != null && items[index]?.name.trim()) || '?';

  const headerProblemText = (header: NonNullable<InvoiceDraftCheck['header']>) =>
    t('scanCheck.headerMismatch')
      .replace('{expected}', money(header.expected_total))
      .replace('{total}', money(header.total_amount));

  const linesProblemText = (lines: NonNullable<InvoiceDraftCheck['lines']>) =>
    t('scanCheck.linesMismatch')
      .replace('{sum}', money(lines.sum))
      .replace('{base}', money(lines.base))
      .replace('{diff}', money(lines.difference));

  // What does not add up, one sentence each (purchase invoices only).
  const draftProblems = (): string[] => {
    if (scanMode !== 'purchase' || !draftCheck) return [];
    const problems: string[] = [];
    if (draftCheck.header) problems.push(headerProblemText(draftCheck.header));
    if (draftCheck.lines && !draftCheck.lines.ok) problems.push(linesProblemText(draftCheck.lines));
    return problems;
  };

  const draftCauseText = (lines: NonNullable<InvoiceDraftCheck['lines']>): string | null => {
    switch (lines.cause) {
      case 'line_values':
        return lines.index != null
          ? t('scanCheck.causeLineValuesOne').replace('{name}', lineName(lines.index))
          : t('scanCheck.causeLineValues').replace('{n}', String(lines.fixes.length));
      case 'vat_included':
        return t('scanCheck.causeVatIncluded');
      case 'duplicate_line':
        return t('scanCheck.causeDuplicate').replace('{name}', lineName(lines.remove_index));
      case 'decimal_slip':
        return t('scanCheck.causeDecimal')
          .replace('{name}', lineName(lines.index))
          .replace('{price}', String(lines.fixes[0]?.unit_price ?? ''));
      case 'missing_line':
        return t('scanCheck.causeMissing').replace('{diff}', money(lines.difference));
      case 'extra':
        return t('scanCheck.causeExtra').replace('{diff}', money(lines.difference));
      default:
        return null;
    }
  };

  // A fix keeps a line's printed value in step when it agreed with the line
  // before (prices read with VAT, a decimal point misplaced in the value
  // too); otherwise the printed value is what the fix was taken from.
  const withUnitPrice = (item: EditableItem, unitPrice: number): EditableItem => {
    const quantity = toNumber(item.quantity) || 1;
    const printed = item.ocr?.total_price;
    const before = quantity * toNumber(item.unit_price);
    const agreed = printed != null && Math.abs(before - printed) <= Math.max(0.02, 0.005 * Math.abs(printed));
    return {
      ...item,
      unit_price: String(unitPrice),
      ocr: item.ocr && agreed ? { ...item.ocr, total_price: Math.round(quantity * unitPrice * 100) / 100 } : item.ocr,
    };
  };

  const applyDraftFixes = (fixes: InvoiceDraftFix[]) => {
    const byIndex = new Map(fixes.map((fix) => [fix.index, fix.unit_price]));
    setItems((prev) => prev.map((item, i) => {
      const unitPrice = byIndex.get(i);
      return unitPrice == null ? item : withUnitPrice(item, unitPrice);
    }));
    // An edited line's price hint no longer applies, as with any edit.
    setItemPriceHints((prev) => {
      const next = { ...prev };
      byIndex.forEach((_, i) => { delete next[i]; });
      return next;
    });
  };

  const renderDraftCheck = (check: InvoiceDraftCheck) => {
    const lines = check.lines;
    const problem = !!check.header || (!!lines && !lines.ok);
    const fixButton = (label: string, onPress: () => void) => (
      <TouchableOpacity style={styles.packFixButton} onPress={onPress}>
        <Ionicons name="construct-outline" size={14} color={COLORS.warning} />
        <Text style={styles.packFixButtonText}>{label}</Text>
      </TouchableOpacity>
    );
    let action: React.ReactNode = null;
    if (lines && !lines.ok && draftCheckFresh) {
      if (lines.cause === 'line_values' && lines.fixes.length > 1) {
        action = fixButton(t('scanCheck.fixLinePrices').replace('{n}', String(lines.fixes.length)), () => applyDraftFixes(lines.fixes));
      } else if (lines.cause === 'line_values' && lines.fixes.length === 1) {
        // One line off: its price or its quantity was misread - offer both
        // readings that give the printed value, as on the line itself.
        const flag = draftLineFlags[lines.fixes[0].index];
        const index = lines.fixes[0].index;
        action = (
          <View style={styles.lineFixRow}>
            {fixButton(t('scanCheck.setPrice').replace('{price}', String(lines.fixes[0].unit_price)), () => applyDraftFixes(lines.fixes))}
            {flag?.quantity != null && fixButton(
              t('scanCheck.setQuantity').replace('{qty}', String(flag.quantity)),
              () => updateItem(index, { quantity: String(flag.quantity) }),
            )}
          </View>
        );
      } else if (lines.cause === 'decimal_slip' && lines.fixes.length === 1) {
        action = fixButton(t('scanCheck.setPrice').replace('{price}', String(lines.fixes[0].unit_price)), () => applyDraftFixes(lines.fixes));
      } else if (lines.cause === 'vat_included') {
        action = fixButton(t('scanCheck.fixVatIncluded'), () => applyDraftFixes(lines.fixes));
      } else if (lines.cause === 'duplicate_line' && lines.remove_index != null) {
        const index = lines.remove_index;
        action = fixButton(t('scanCheck.removeDuplicate'), () => removeItem(index));
      } else if (lines.cause === 'missing_line') {
        action = fixButton(t('scanCheck.addMissingLine'), addItem);
      }
    }
    const cause = lines && !lines.ok && draftCheckFresh ? draftCauseText(lines) : null;
    return (
      <View style={[styles.checkCard, problem ? styles.checkCardWarn : styles.checkCardOk, !draftCheckFresh && styles.checkCardStale]}>
        {check.header && (
          <View style={styles.checkRow}>
            <Ionicons name="alert-circle" size={16} color={COLORS.warning} />
            <Text style={[styles.checkText, styles.checkTitle]}>{headerProblemText(check.header)}</Text>
          </View>
        )}
        {lines && (lines.ok ? (
          <View style={styles.checkRow}>
            <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
            <Text style={[styles.checkText, { color: COLORS.success }]}>
              {t('scanCheck.allGood').replace('{sum}', money(lines.sum))}
            </Text>
          </View>
        ) : (
          <View style={check.header ? styles.checkSpaced : undefined}>
            <View style={styles.checkRow}>
              <Ionicons name="alert-circle" size={16} color={COLORS.warning} />
              <Text style={[styles.checkText, styles.checkTitle]}>{linesProblemText(lines)}</Text>
            </View>
            {cause && <Text style={styles.checkCause}>{cause}</Text>}
            {action && <View style={styles.checkActions}>{action}</View>}
          </View>
        ))}
      </View>
    );
  };

  const updateItem = (index: number, patch: Partial<EditableItem>) => {
    setItems(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    // A hint judged the line as recognized - once edited, it no longer applies.
    setItemPriceHints(prev => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
    // Hints are keyed by position: the rows below the removed one move up.
    setItemPriceHints(prev => {
      const next: Record<number, ItemPriceHint> = {};
      Object.entries(prev).forEach(([key, hint]) => {
        const i = Number(key);
        if (i < index) next[i] = hint;
        else if (i > index) next[i - 1] = hint;
      });
      return next;
    });
  };

  const addItem = () => {
    setItems(prev => [...prev, emptyItem()]);
  };

  const resetForm = () => {
    setOfflineWaiting(false);
    setLocationPick(undefined);
    setCapturedImages([]);
    setOcrResult(null);
    setSupplier('');
    setSupplierEik('');
    setEikCheck(null);
    setInvoiceNumber('');
    setAmountWithoutVat('');
    setVatAmount('');
    setTotalAmount('');
    setVatTreatment('');
    setNotes('');
    setItems([]);
    setItemPriceHints({});
    setDraftCheck(null);
    setInvoiceDate(new Date());
    setDateFoundByOcr(null);
    setReviewing(false);
    setPaymentMethod('');
    setPaymentMethodFromOcr(false);
    setPaymentMethodMissing(false);
    setPaymentDueDate(null);
    setDocumentType('invoice');
    setCreditedInvoiceNumber('');
    setSalesCustomer('');
    setSalesCustomerEik('');
    setSalesPaymentMethod('bank_transfer');
    setSalesInTill(logsTill);
  };

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardView}
          >
            <ScrollView style={styles.scrollView}>
              <View style={styles.header}>
                <Text style={styles.title}>{t('scan.title')}</Text>
                <Text style={styles.subtitle}>{t('scan.subtitle')}</Text>
              </View>

              {capturedImages.length === 0 && <ScanCreditsReloadButton />}

              {capturedImages.length === 0 && (
                <View style={styles.modeToggle}>
                  <TouchableOpacity
                    style={[styles.modeButton, scanMode === 'purchase' && styles.modeButtonActive]}
                    onPress={() => setScanMode('purchase')}
                  >
                    <Text style={[styles.modeButtonText, scanMode === 'purchase' && styles.modeButtonTextActive]} numberOfLines={1}>
                      {t('scan.modePurchase')}
                    </Text>
                  </TouchableOpacity>
                  {canIssueInvoices && (
                    <TouchableOpacity
                      style={[styles.modeButton, scanMode === 'sales' && styles.modeButtonActive]}
                      onPress={() => setScanMode('sales')}
                    >
                      <Text style={[styles.modeButtonText, scanMode === 'sales' && styles.modeButtonTextActive]} numberOfLines={1}>
                        {t('scan.modeSales')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {capturedImages.length === 0 ? (
                <View style={styles.scanOptions}>
              <TouchableOpacity style={styles.scanButton} onPress={handleTakePhoto}>
                <View style={styles.scanIconContainer}>
                  <Ionicons name="camera" size={48} color={COLORS.primary} />
                </View>
                <Text style={styles.scanButtonText}>{t('scan.takePhoto')}</Text>
                <Text style={styles.scanButtonHint}>{t('scan.useCameraHint')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.scanButton} onPress={handlePickImage}>
                <View style={styles.scanIconContainer}>
                  <Ionicons name="image" size={48} color={COLORS.primary} />
                </View>
                <Text style={styles.scanButtonText}>{t('scan.fromGallery')}</Text>
                <Text style={styles.scanButtonHint}>{t('scan.fromGalleryHint')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {capturedImages.length === 0 && myQueue.length > 0 && (
            <View style={styles.queueBox}>
              <View style={styles.queueHeader}>
                <Ionicons name="cloud-upload-outline" size={18} color={COLORS.primary} />
                <Text style={styles.queueTitle}>{t('scanQueue.title').replace('{count}', String(myQueue.length))}</Text>
                {isOnline && myQueue.some((item) => item.status === 'waiting') && !queueProcessing && (
                  <TouchableOpacity onPress={() => processQueue(companyId)} hitSlop={8}>
                    <Text style={styles.queueLink}>{t('scanQueue.readNow')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {myQueue.map((item) => (
                <View key={item.id} style={styles.queueRow}>
                  <Image source={{ uri: item.pages[0] }} style={styles.queueThumb} resizeMode="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.queueWhen}>
                      {format(new Date(item.createdAt), 'dd.MM HH:mm')}
                      {item.pages.length > 1 ? ` · ${t('scan.invoiceWithPages').replace('{count}', String(item.pages.length))}` : ''}
                    </Text>
                    <Text
                      style={[styles.queueStatus, item.status === 'ready' && { color: COLORS.success }, item.status === 'failed' && { color: COLORS.danger }]}
                      numberOfLines={2}
                    >
                      {item.status === 'failed' ? (item.error || t('scanQueue.failed')) : t(`scanQueue.status.${item.status}`)}
                    </Text>
                  </View>
                  {item.status === 'reading' && <ActivityIndicator size="small" color={COLORS.primary} />}
                  {item.status === 'ready' && (
                    <TouchableOpacity style={styles.queueReview} onPress={() => reviewQueued(item)}>
                      <Text style={styles.queueReviewText}>{t('scanQueue.review')}</Text>
                    </TouchableOpacity>
                  )}
                  {item.status === 'failed' && (
                    <TouchableOpacity onPress={() => retryNow(item)} hitSlop={8} accessibilityLabel={t('scanQueue.retry')}>
                      <Ionicons name="refresh" size={20} color={COLORS.primary} />
                    </TouchableOpacity>
                  )}
                  {item.status !== 'reading' && (
                    <TouchableOpacity onPress={() => deleteQueued(item)} hitSlop={8} accessibilityLabel={t('common.delete')}>
                      <Ionicons name="trash-outline" size={18} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}

          {capturedImages.length === 0 && scanMode === 'purchase' && (
            <View style={[styles.tipsBox, styles.tipsHeader]}>
              <Ionicons name="sparkles-outline" size={18} color={COLORS.primary} />
              <Text style={[styles.tipsTitle, { flex: 1 }]}>{t('scan.tipsTitle')}</Text>
              <InfoButton
                title={t('scan.tipsTitle')}
                lines={[
                  [t('scan.tipSupplier'), t('scan.tipAmounts'), t('scan.tipItems'), t('scan.tipPayment')].map((tip) => `• ${tip}`).join('\n'),
                  t('scan.tipsFooter'),
                ]}
              />
            </View>
          )}

          {capturedImages.length === 0 && scanMode === 'sales' && (
            <View style={[styles.tipsBox, styles.tipsHeader]}>
              <Ionicons name="sparkles-outline" size={18} color={COLORS.primary} />
              <Text style={[styles.tipsTitle, { flex: 1 }]}>{t('scan.salesTipsTitle')}</Text>
              <InfoButton
                title={t('scan.salesTipsTitle')}
                lines={[`• ${t('scan.salesTip1')}\n• ${t('scan.salesTip2')}`, t('scan.salesTipsFooter')]}
              />
            </View>
          )}

          {capturedImages.length > 0 && (
            <View style={styles.resultContainer}>
              {/* Captured pages - a long invoice can span several photos,
                  each shown as a thumbnail with its own remove button. */}
              <View style={styles.imagePreview}>
                {capturedImages.length > 1 && (
                  <Text style={styles.pagesCountText}>
                    {t('scan.invoiceWithPages').replace('{count}', String(capturedImages.length))}
                  </Text>
                )}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pagesStrip}>
                  {capturedImages.map((uri, index) => (
                    <View key={index} style={styles.pageThumbWrapper}>
                      <Image source={{ uri }} style={styles.pageThumb} resizeMode="cover" />
                      <View style={styles.pageThumbBadge}>
                        <Text style={styles.pageThumbBadgeText}>{index + 1}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.pageThumbRemove}
                        onPress={() => removePage(index)}
                        disabled={isScanning}
                        accessibilityLabel={t('scan.removePage')}
                      >
                        <Ionicons name="close" size={14} color="white" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity
                    style={styles.addPageTile}
                    onPress={handleTakePhoto}
                    disabled={isScanning}
                    accessibilityLabel={t('scan.addPage')}
                  >
                    <Ionicons name="add" size={22} color={COLORS.primary} />
                  </TouchableOpacity>
                </ScrollView>
                <View style={styles.pageActionsRow}>
                  <TouchableOpacity style={styles.addPageButton} onPress={handleTakePhoto} disabled={isScanning}>
                    <Ionicons name="camera" size={16} color={COLORS.primary} />
                    <Text style={styles.addPageButtonText}>{t('scan.addPage')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.addPageButton} onPress={handlePickImage} disabled={isScanning}>
                    <Ionicons name="image" size={16} color={COLORS.primary} />
                    <Text style={styles.addPageButtonText}>{t('scan.fromGallery')}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.retakeButton} onPress={resetForm}>
                  <Ionicons name="refresh" size={20} color="white" />
                  <Text style={styles.retakeText}>{t('scan.newScan')}</Text>
                </TouchableOpacity>
              </View>

              {offlineWaiting ? (
                <View style={styles.offlineCard}>
                  <Ionicons name="cloud-offline-outline" size={32} color={COLORS.warning} />
                  <Text style={styles.offlineTitle}>{t('scanQueue.offlineTitle')}</Text>
                  <Text style={styles.offlineText}>{t('scanQueue.offlineText')}</Text>
                  <TouchableOpacity style={styles.offlineButton} onPress={saveForLater}>
                    <Ionicons name="save-outline" size={18} color="white" />
                    <Text style={styles.offlineButtonText}>{t('scanQueue.saveForLater')}</Text>
                  </TouchableOpacity>
                </View>
              ) : isScanning ? (
                <View style={styles.scanningContainer}>
                  <ActivityIndicator size="large" color={COLORS.primary} />
                  <Text style={styles.scanningText}>{t('scan.processing')}</Text>
                </View>
              ) : (
                <View style={styles.formContainer}>
                  {(scanMode === 'sales' || reviewing) && (
                  <>
                  <Text style={styles.formTitle}>
                    {scanMode === 'sales' ? t('scan.salesFormTitle') : t('scan.invoiceDataTitle')}
                  </Text>
                  <Text style={styles.formHint}>
                    {scanMode === 'sales' ? t('scan.salesFormHint') : t('scan.editIfNeeded')}
                  </Text>
                  </>
                  )}

                  {/* AI Corrections Info */}
                  <Expandable expanded={ocrCorrections.length > 0 && (scanMode === 'sales' || reviewing)}>
                    <View style={styles.correctionsContainer}>
                      <View style={styles.correctionsHeader}>
                        <Ionicons name="sparkles" size={18} color={COLORS.success} />
                        <Text style={styles.correctionsTitle}>
                          {t('scan.aiCorrections')}
                        </Text>
                        {ocrConfidence && (
                          <View style={styles.confidenceBadge}>
                            <Text style={styles.confidenceText}>
                              {Math.round(ocrConfidence * 100)}%
                            </Text>
                          </View>
                        )}
                      </View>
                      {ocrCorrections.map((correction, index) => (
                        <View key={index} style={styles.correctionItem}>
                          <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                          <Text style={styles.correctionText}>{correction}</Text>
                        </View>
                      ))}
                    </View>
                  </Expandable>

                  {scanMode === 'sales' ? (
                    <>
                      <View style={styles.protocolNote}>
                        <Ionicons name="information-circle" size={16} color={COLORS.primary} />
                        <Text style={styles.protocolNoteText}>{t('scan.salesNote')}</Text>
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{t('scan.salesCustomer')} *</Text>
                        <TextInput
                          style={styles.input}
                          value={salesCustomer}
                          onChangeText={setSalesCustomer}
                          placeholder={t('scan.salesCustomerPlaceholder')}
                          placeholderTextColor={COLORS.textMuted}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{t('scan.salesCustomerEik')}</Text>
                        <TextInput
                          style={styles.input}
                          value={salesCustomerEik}
                          onChangeText={setSalesCustomerEik}
                          keyboardType="number-pad"
                          placeholder="123456789"
                          placeholderTextColor={COLORS.textMuted}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{t('scan.salesNumber')} *</Text>
                        <TextInput
                          style={styles.input}
                          value={invoiceNumber}
                          onChangeText={setInvoiceNumber}
                          keyboardType="number-pad"
                          placeholder="0000000001"
                          placeholderTextColor={COLORS.textMuted}
                        />
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{t('scan.issueDate')} *</Text>
                        <TouchableOpacity style={styles.dateInputButton} onPress={() => setDatePickerVisible(true)}>
                          <Ionicons name="calendar" size={20} color={COLORS.primary} />
                          <Text style={styles.dateInputText}>
                            {format(invoiceDate, 'd MMMM yyyy', { locale: dateLocale })}
                          </Text>
                          <Ionicons name="chevron-down" size={20} color={COLORS.textMuted} />
                        </TouchableOpacity>
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{t('scan.totalAmount')} *</Text>
                        <TextInput
                          style={styles.input}
                          value={totalAmount}
                          onChangeText={setTotalAmount}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          placeholderTextColor={COLORS.textMuted}
                        />
                        <Text style={styles.eikWarningText}>{t('home.includesVAT')}</Text>
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{t('scan.vatTreatment')}</Text>
                        <View style={styles.vatTreatmentGrid}>
                          {([20, 9, 0] as const).map((rate) => (
                            <TouchableOpacity
                              key={rate}
                              style={[styles.vatTreatmentChip, salesVatRate === rate && styles.vatTreatmentChipActive]}
                              onPress={() => setSalesVatRate(rate)}
                            >
                              <Text style={[styles.vatTreatmentChipText, salesVatRate === rate && styles.vatTreatmentChipTextActive]}>
                                {rate}%
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>

                      <LocationPicker value={invoiceLocation} onChange={setLocationPick} noneLabel={t('locations.noneWhole')} />

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>{t('scan.paymentMethod')}</Text>
                        <View style={styles.vatTreatmentGrid}>
                          {(['bank_transfer', 'cash', 'card'] as const).map((method) => (
                            <TouchableOpacity
                              key={method}
                              style={[styles.vatTreatmentChip, salesPaymentMethod === method && styles.vatTreatmentChipActive]}
                              onPress={() => setSalesPaymentMethod(method)}
                            >
                              <Text style={[styles.vatTreatmentChipText, salesPaymentMethod === method && styles.vatTreatmentChipTextActive]}>
                                {t(`scan.paymentMethod.${method}`)}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        {usesTill && salesPaymentMethod !== 'bank_transfer' && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.inputLabel}>{t('billingDocuments.inTill')}</Text>
                              <Text style={styles.eikWarningText}>
                                {salesInTill ? t('billingDocuments.inTillHint') : t('billingDocuments.notInTillHint')}
                              </Text>
                            </View>
                            <Switch value={salesInTill} onValueChange={setSalesInTill} accessibilityLabel={t('billingDocuments.inTill')} />
                          </View>
                        )}
                      </View>
                    </>
                  ) : !reviewing ? (
                    (() => {
                      // What was read, in a few lines - and an input only
                      // for what was not read (Л6).
                      const missingSupplier = !supplier.trim();
                      const missingNumber = !invoiceNumber.trim();
                      const missingTotal = Number.isNaN(readAmount(totalAmount));
                      const missingPayment = !isCreditNote && !paymentMethod;
                      const problems = draftProblems();
                      const pricesUp = Object.values(itemPriceHints).filter((hint) => hint && hint.kind === 'price_change' && hint.change_percent != null && hint.change_percent > 0).length;
                      const net = toNumber(amountWithoutVat);
                      const vat = toNumber(vatAmount);
                      return (
                        <View style={styles.summaryCard}>
                          <View style={styles.summaryHeader}>
                            <Ionicons name="checkmark-done" size={18} color={COLORS.success} />
                            <Text style={styles.summaryTitle}>{t('scanSummary.title')}</Text>
                          </View>
                          {isCreditNote && (
                            <Text style={styles.summaryNote}>
                              {t('scanSummary.creditNote')}{creditedInvoiceNumber ? ` · № ${creditedInvoiceNumber}` : ''}
                            </Text>
                          )}

                          {missingSupplier ? (
                            <View style={styles.summaryInputGroup}>
                              <Text style={[styles.inputLabel, styles.summaryMissingLabel]}>{t('scan.supplier')} *</Text>
                              <TextInput style={styles.input} value={supplier} onChangeText={setSupplier}
                                placeholder={t('scan.companyNamePlaceholder')} placeholderTextColor={COLORS.textMuted} />
                            </View>
                          ) : (
                            <View style={styles.summaryRow}>
                              <Text style={styles.summaryLabel}>{t('scan.supplier')}</Text>
                              <Text style={styles.summaryValue} numberOfLines={2}>{supplier}{supplierEik ? ` · ${supplierEik}` : ''}</Text>
                            </View>
                          )}

                          {missingNumber ? (
                            <View style={styles.summaryInputGroup}>
                              <Text style={[styles.inputLabel, styles.summaryMissingLabel]}>{t('scan.invoiceNumber')} *</Text>
                              <TextInput style={styles.input} value={invoiceNumber} onChangeText={setInvoiceNumber}
                                placeholder="0000000001" placeholderTextColor={COLORS.textMuted} />
                            </View>
                          ) : (
                            <View style={styles.summaryRow}>
                              <Text style={styles.summaryLabel}>{t('scan.invoiceNumber')}</Text>
                              <Text style={styles.summaryValue}>{invoiceNumber}</Text>
                            </View>
                          )}

                          <TouchableOpacity style={styles.summaryRow} onPress={() => setDatePickerVisible(true)}>
                            <Text style={styles.summaryLabel}>{t('scan.issueDate')}</Text>
                            <Text style={[styles.summaryValue, dateFoundByOcr === false && { color: COLORS.warning }]}>
                              {format(invoiceDate, 'd MMMM yyyy', { locale: dateLocale })}
                              {dateFoundByOcr === false ? ` · ${t('scanSummary.dateNotRead')}` : ''}
                            </Text>
                          </TouchableOpacity>

                          {missingTotal ? (
                            <View style={styles.summaryInputGroup}>
                              <Text style={[styles.inputLabel, styles.summaryMissingLabel]}>{t('scan.totalAmount')} *</Text>
                              <TextInput style={styles.input} value={totalAmount} onChangeText={setTotalAmount}
                                keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={COLORS.textMuted} />
                            </View>
                          ) : (
                            <View style={styles.summaryRow}>
                              <Text style={styles.summaryLabel}>{t('scan.totalAmount')}</Text>
                              <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
                                <Text style={[styles.summaryValue, styles.summaryTotal]}>{formatMoney(toNumber(totalAmount))}</Text>
                                <Text style={styles.summarySub}>
                                  {t('scanSummary.amounts').replace('{net}', formatAmount(net)).replace('{vat}', formatAmount(vat))}
                                </Text>
                              </View>
                            </View>
                          )}

                          {!isCreditNote && (missingPayment ? (
                            <View style={styles.summaryInputGroup}>
                              <Text style={[styles.inputLabel, styles.summaryMissingLabel]}>{t('scan.paymentMethod')} *</Text>
                              <View style={styles.vatTreatmentGrid}>
                                {(['cash', 'card', 'bank_transfer'] as PaymentMethod[]).map((option) => (
                                  <TouchableOpacity
                                    key={option}
                                    style={[styles.vatTreatmentChip, paymentMethodMissing && { borderColor: COLORS.danger }]}
                                    onPress={() => { setPaymentMethod(option); setPaymentMethodFromOcr(false); }}
                                  >
                                    <Text style={styles.vatTreatmentChipText}>{t(`scan.paymentMethod.${option}`)}</Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={styles.summaryRow}
                              onPress={() => (paymentMethod === 'bank_transfer' ? setDueDatePickerVisible(true) : setReviewing(true))}
                            >
                              <Text style={styles.summaryLabel}>{t('scan.paymentMethod')}</Text>
                              <Text style={styles.summaryValue}>
                                {t(`scan.paymentMethod.${paymentMethod}`)}
                                {paymentMethod === 'bank_transfer'
                                  ? ` · ${paymentDueDate ? t('scanSummary.dueDate').replace('{date}', format(paymentDueDate, 'd MMM yyyy', { locale: dateLocale })) : t('scan.paymentDueDateDefault')}`
                                  : ''}
                              </Text>
                            </TouchableOpacity>
                          ))}

                          {items.length > 0 && (
                            <TouchableOpacity style={styles.summaryRow} onPress={() => setReviewing(true)}>
                              <Text style={styles.summaryLabel}>{t('scanSummary.itemsLabel')}</Text>
                              <Text style={[styles.summaryValue, pricesUp > 0 && { color: COLORS.danger }]}>
                                {items.length === 1 ? t('scanSummary.itemsOne') : t('scanSummary.items').replace('{n}', String(items.length))}
                                {pricesUp > 0 ? ` · ${t('scanSummary.pricesUp').replace('{n}', String(pricesUp))}` : ''}
                              </Text>
                            </TouchableOpacity>
                          )}

                          {problems.length > 0 && (
                            <TouchableOpacity style={styles.summaryWarning} onPress={() => setReviewing(true)}>
                              <Ionicons name="alert-circle" size={16} color={COLORS.warning} />
                              <Text style={styles.summaryWarningText}>{t('scanSummary.checkSums')}</Text>
                            </TouchableOpacity>
                          )}

                          <LocationPicker value={invoiceLocation} onChange={setLocationPick} noneLabel={t('locations.noneWhole')} />

                          <PressableScale
                            style={[styles.saveButton, styles.summarySave, isSaving && styles.saveButtonDisabled]}
                            onPress={() => handleSaveInvoice()}
                            disabled={isSaving}
                          >
                            {isSaving ? (
                              <ActivityIndicator color="white" />
                            ) : (
                              <>
                                <Ionicons name="checkmark-circle" size={24} color="white" />
                                <Text style={styles.saveButtonText}>{t('scan.saveInvoice')}</Text>
                              </>
                            )}
                          </PressableScale>
                          <TouchableOpacity style={styles.summaryEdit} onPress={() => setReviewing(true)}>
                            <Ionicons name="create-outline" size={16} color={COLORS.primary} />
                            <Text style={styles.summaryEditText}>{t('scanSummary.edit')}</Text>
                          </TouchableOpacity>

                          <DateTimePickerModal
                            isVisible={isDatePickerVisible}
                            mode="date"
                            date={invoiceDate}
                            onConfirm={(date) => { setInvoiceDate(date); setDateFoundByOcr(null); setDatePickerVisible(false); }}
                            onCancel={() => setDatePickerVisible(false)}
                            confirmTextIOS={t('common.select')}
                            cancelTextIOS={t('common.cancel')}
                            locale={language}
                          />
                          <DateTimePickerModal
                            isVisible={isDueDatePickerVisible}
                            mode="date"
                            date={paymentDueDate || new Date(invoiceDate.getTime() + 14 * 24 * 60 * 60 * 1000)}
                            onConfirm={(date) => { setPaymentDueDate(date); setDueDatePickerVisible(false); }}
                            onCancel={() => setDueDatePickerVisible(false)}
                            confirmTextIOS={t('common.select')}
                            cancelTextIOS={t('common.cancel')}
                            locale={language}
                          />
                        </View>
                      );
                    })()
                  ) : (
                    <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.documentType')}</Text>
                    <View style={styles.vatTreatmentGrid}>
                      {(['invoice', 'credit_note'] as InvoiceDocumentType[]).map((option) => (
                        <TouchableOpacity
                          key={option}
                          style={[styles.vatTreatmentChip, documentType === option && styles.vatTreatmentChipActive]}
                          onPress={() => setDocumentType(option)}
                        >
                          <Text style={[styles.vatTreatmentChipText, documentType === option && styles.vatTreatmentChipTextActive]}>
                            {t(`scan.documentType.${option}`)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {isCreditNote && (
                      <>
                        <View style={styles.protocolNote}>
                          <Ionicons name="return-down-back" size={16} color={COLORS.primary} />
                          <Text style={styles.protocolNoteText}>{t('scan.creditNoteNote')}</Text>
                        </View>
                        <Text style={[styles.inputLabel, { marginTop: 12 }]}>{t('scan.creditedInvoiceNumber')}</Text>
                        <TextInput
                          style={styles.input}
                          value={creditedInvoiceNumber}
                          onChangeText={setCreditedInvoiceNumber}
                          placeholder={t('scan.creditedInvoicePlaceholder')}
                          placeholderTextColor={COLORS.textMuted}
                          accessibilityLabel={t('scan.creditedInvoiceNumber')}
                        />
                      </>
                    )}
                  </View>

                  <StaggerReveal index={0} style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.supplier')} *</Text>
                    <TextInput
                      style={styles.input}
                      value={supplier}
                      onChangeText={setSupplier}
                      placeholder={t('scan.companyNamePlaceholder')}
                      placeholderTextColor={COLORS.textMuted}
                    />
                    {supplierMatches.length > 0 && (
                      <View style={styles.supplierChipRow}>
                        {supplierMatches.map((s) => (
                          <TouchableOpacity
                            key={s.name}
                            style={styles.supplierChip}
                            onPress={() => { setSupplier(s.name); setSupplierEik(s.eik); }}
                          >
                            <Text style={styles.supplierChipText} numberOfLines={1}>{s.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </StaggerReveal>

                  <StaggerReveal index={1} style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.supplierEik')}</Text>
                    <View style={styles.eikInputRow}>
                      <TextInput
                        style={[styles.input, styles.eikInput]}
                        value={supplierEik}
                        onChangeText={setSupplierEik}
                        keyboardType="number-pad"
                        placeholder="131071587"
                        placeholderTextColor={COLORS.textMuted}
                        maxLength={13}
                      />
                      {eikCheck && (
                        <Ionicons
                          name={eikCheck.valid ? 'checkmark-circle' : 'alert-circle'}
                          size={22}
                          color={eikCheck.valid ? COLORS.success : COLORS.warning}
                        />
                      )}
                    </View>
                    {eikCheck && !eikCheck.valid && (
                      <Text style={styles.eikWarningText}>
                        {eikCheck.reason === 'checksum' ? t('scan.eikInvalidChecksum') : t('scan.eikInvalidFormat')}
                      </Text>
                    )}
                  </StaggerReveal>

                  <StaggerReveal index={2} style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.invoiceNumber')} *</Text>
                    <TextInput
                      style={styles.input}
                      value={invoiceNumber}
                      onChangeText={setInvoiceNumber}
                      placeholder="0000000001"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </StaggerReveal>

                  {/* Date of Issue */}
                  <StaggerReveal index={3} style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.issueDate')} *</Text>
                    <TouchableOpacity
                      style={[styles.dateInputButton, dateFoundByOcr === false && styles.dateInputButtonWarning]}
                      onPress={() => setDatePickerVisible(true)}
                    >
                      <Ionicons name="calendar" size={20} color={dateFoundByOcr === false ? COLORS.warning : COLORS.primary} />
                      <Text style={styles.dateInputText}>
                        {format(invoiceDate, 'd MMMM yyyy', { locale: dateLocale })}
                      </Text>
                      <Ionicons name="chevron-down" size={20} color={COLORS.textMuted} />
                    </TouchableOpacity>
                    {dateFoundByOcr === false && (
                      <View style={styles.protocolNote}>
                        <Ionicons name="alert-circle" size={16} color={COLORS.warning} />
                        <Text style={styles.protocolNoteText}>{t('scan.dateNotFoundNote')}</Text>
                      </View>
                    )}
                  </StaggerReveal>

                  <DateTimePickerModal
                    isVisible={isDatePickerVisible}
                    mode="date"
                    date={invoiceDate}
                    onConfirm={(date) => {
                      setInvoiceDate(date);
                      setDatePickerVisible(false);
                    }}
                    onCancel={() => setDatePickerVisible(false)}
                    confirmTextIOS={t('common.select')}
                    cancelTextIOS={t('common.cancel')}
                    locale={language}
                  />

                  <StaggerReveal index={4} style={styles.row}>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.inputLabel}>{t('scan.amountWithoutVAT')}</Text>
                      <TextInput
                        style={styles.input}
                        value={amountWithoutVat}
                        onChangeText={setAmountWithoutVat}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.inputLabel}>{t('scan.vatAmount')}</Text>
                      <TextInput
                        style={styles.input}
                        value={vatAmount}
                        onChangeText={setVatAmount}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={COLORS.textMuted}
                      />
                    </View>
                  </StaggerReveal>

                  <StaggerReveal index={5} style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.totalAmount')} *</Text>
                    <TextInput
                      style={styles.input}
                      value={totalAmount}
                      onChangeText={setTotalAmount}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </StaggerReveal>

                  <StaggerReveal index={6} style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.vatTreatment')}</Text>
                    <View style={styles.vatTreatmentGrid}>
                      {(['standard_20', 'reduced_9', 'zero_rate', 'exempt', 'reverse_charge', 'outside_scope'] as VatTreatment[]).map((option) => (
                        <TouchableOpacity
                          key={option}
                          style={[styles.vatTreatmentChip, vatTreatment === option && styles.vatTreatmentChipActive]}
                          onPress={() => setVatTreatment(option)}
                        >
                          <Text style={[styles.vatTreatmentChipText, vatTreatment === option && styles.vatTreatmentChipTextActive]}>
                            {t(`vat.${option}`)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {vatTreatment === 'reverse_charge' && (
                      <View style={styles.protocolNote}>
                        <Ionicons name="information-circle" size={16} color={COLORS.primary} />
                        <Text style={styles.protocolNoteText}>{t('scan.reverseChargeNote')}</Text>
                      </View>
                    )}
                  </StaggerReveal>

                  <LocationPicker value={invoiceLocation} onChange={setLocationPick} noneLabel={t('locations.noneWhole')} />

                  {/* Nothing is owed on a credit note - no payment to say. */}
                  {!isCreditNote && (
                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, paymentMethodMissing && !paymentMethod && { color: COLORS.danger }]}>
                      {t('scan.paymentMethod')} *
                    </Text>
                    <View style={styles.vatTreatmentGrid}>
                      {(['cash', 'card', 'bank_transfer'] as PaymentMethod[]).map((option) => (
                        <TouchableOpacity
                          key={option}
                          style={[
                            styles.vatTreatmentChip,
                            paymentMethod === option && styles.vatTreatmentChipActive,
                            paymentMethodMissing && !paymentMethod && { borderColor: COLORS.danger },
                          ]}
                          onPress={() => { setPaymentMethod(option); setPaymentMethodFromOcr(false); }}
                        >
                          <Text style={[styles.vatTreatmentChipText, paymentMethod === option && styles.vatTreatmentChipTextActive]}>
                            {t(`scan.paymentMethod.${option}`)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {!paymentMethod && paymentDueDate && (
                      <View style={styles.protocolNote}>
                        <Ionicons name="information-circle" size={16} color={COLORS.primary} />
                        <Text style={styles.protocolNoteText}>{t('scan.paymentMethodNotDetectedNote')}</Text>
                      </View>
                    )}
                    {paymentMethodFromOcr && !!paymentMethod && (
                      <View style={styles.protocolNote}>
                        <Ionicons name="scan" size={16} color={COLORS.primary} />
                        <Text style={styles.protocolNoteText}>{t('scan.paymentMethodFromInvoice')}</Text>
                      </View>
                    )}
                    {(paymentMethod === 'cash' || paymentMethod === 'card') && (
                      <View style={styles.protocolNote}>
                        <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                        <Text style={styles.protocolNoteText}>{t('scan.cashAutoPaidNote')}</Text>
                      </View>
                    )}
                    {paymentMethod === 'bank_transfer' && (
                      <TouchableOpacity
                        style={[styles.dateInputButton, { marginTop: 10 }]}
                        onPress={() => setDueDatePickerVisible(true)}
                      >
                        <Ionicons name="calendar" size={20} color={COLORS.primary} />
                        <Text style={styles.dateInputText}>
                          {paymentDueDate
                            ? format(paymentDueDate, 'd MMMM yyyy', { locale: dateLocale })
                            : t('scan.paymentDueDateDefault')}
                        </Text>
                        <Ionicons name="chevron-down" size={20} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  )}

                  <DateTimePickerModal
                    isVisible={isDueDatePickerVisible}
                    mode="date"
                    date={paymentDueDate || new Date(invoiceDate.getTime() + 14 * 24 * 60 * 60 * 1000)}
                    onConfirm={(date) => {
                      setPaymentDueDate(date);
                      setDueDatePickerVisible(false);
                    }}
                    onCancel={() => setDueDatePickerVisible(false)}
                    confirmTextIOS={t('common.select')}
                    cancelTextIOS={t('common.cancel')}
                    locale={language}
                  />

                  {/* Line items - pre-filled from OCR, editable */}
                  <View style={styles.itemsSection}>
                    <View style={styles.itemsSectionHeader}>
                      <Text style={styles.inputLabel}>
                        {t('scan.productsItemsLabel')}
                      </Text>
                      <TouchableOpacity style={styles.addItemButton} onPress={addItem}>
                        <Ionicons name="add" size={18} color={COLORS.primary} />
                        <Text style={styles.addItemButtonText}>
                          {t('scan.addShort')}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {draftCheck && (draftCheck.header || draftCheck.lines) && renderDraftCheck(draftCheck)}

                    {items.length === 0 ? (
                      <Text style={styles.itemsEmptyHint}>
                        {t('scan.noProductsRecognized')}
                      </Text>
                    ) : (
                      items.map((item, index) => (
                        <View key={index} style={styles.itemRow}>
                          <TextInput
                            style={[styles.input, styles.itemNameInput]}
                            value={item.name}
                            onChangeText={(v) => updateItem(index, { name: v })}
                            placeholder={t('scan.productNamePlaceholder')}
                            placeholderTextColor={COLORS.textMuted}
                          />
                          <View style={styles.itemRowFields}>
                            <TextInput
                              style={[styles.input, styles.itemSmallInput]}
                              value={item.quantity}
                              onChangeText={(v) => updateItem(index, { quantity: v })}
                              keyboardType="decimal-pad"
                              placeholder={t('scan.qtyPlaceholder')}
                              placeholderTextColor={COLORS.textMuted}
                            />
                            <TextInput
                              style={[styles.input, styles.itemSmallInput]}
                              value={item.unit}
                              onChangeText={(v) => updateItem(index, { unit: v })}
                              placeholder={t('scan.unitPlaceholder')}
                              placeholderTextColor={COLORS.textMuted}
                            />
                            <TextInput
                              style={[styles.input, styles.itemSmallInput]}
                              value={item.unit_price}
                              onChangeText={(v) => updateItem(index, { unit_price: v })}
                              keyboardType="decimal-pad"
                              placeholder={t('scan.pricePlaceholder')}
                              placeholderTextColor={COLORS.textMuted}
                            />
                            <TouchableOpacity style={styles.removeItemButton} onPress={() => removeItem(index)}>
                              <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                            </TouchableOpacity>
                          </View>
                          {item.packRule && packRuleActive(item) && (
                            <View style={styles.packRuleRow}>
                              <Ionicons name="cube" size={13} color={COLORS.success} />
                              <Text style={[styles.itemPriceNote, styles.packRuleText]}>
                                {t('scan.packRuleApplied').replace(/\{k\}/g, String(item.packRule.multiple))}
                              </Text>
                              <TouchableOpacity onPress={() => undoPackRule(index)}>
                                <Text style={styles.packRuleUndo}>{t('scan.packRuleUndo')}</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                          {/* What went back has no purchase price to compare. */}
                          {!isCreditNote && itemPriceHints[index] && (() => {
                            const hint = itemPriceHints[index];
                            if (hint.kind === 'pack_suspect') {
                              const fix = packFixValues(index);
                              return (
                                <View>
                                  <Text style={[styles.itemPriceNote, { color: COLORS.warning }]}>
                                    {priceAlertMeaning(hint, t)}
                                  </Text>
                                  {fix && (
                                    <TouchableOpacity style={styles.packFixButton} onPress={() => applyPackFix(index)}>
                                      <Ionicons name="cube-outline" size={14} color={COLORS.warning} />
                                      <Text style={styles.packFixButtonText}>
                                        {t(hint.direction === 'decrease' ? 'scan.packFixCombine' : 'scan.packFixSplit')
                                          .replace('{k}', String(hint.pack_multiple))
                                          .replace('{qty}', String(fix.quantity))
                                          .replace('{price}', String(fix.unitPrice))}
                                      </Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              );
                            }
                            if (hint.change_percent == null || hint.old_price == null) return null;
                            const up = hint.change_percent > 0;
                            const meaning = priceAlertMeaning(hint, t);
                            return (
                              <Text style={[styles.itemPriceNote, { color: up ? COLORS.danger : COLORS.success }]}>
                                {up ? '▲' : '▼'}{' '}
                                {t('scan.priceHintChange')
                                  .replace('{percent}', Math.abs(hint.change_percent).toFixed(0))
                                  .replace('{old}', formatEur(hint.old_price))}
                                {meaning ? ` · ${meaning}` : ''}
                              </Text>
                            );
                          })()}
                          {draftCheckFresh && draftLineFlags[index] && (() => {
                            const flag = draftLineFlags[index];
                            return (
                              <View>
                                <Text style={[styles.itemPriceNote, { color: COLORS.warning }]}>
                                  {t('scanCheck.lineValueMismatch')
                                    .replace('{computed}', money(flag.computed))
                                    .replace('{printed}', money(flag.printed))}
                                </Text>
                                <View style={styles.lineFixRow}>
                                  {flag.unit_price != null && (
                                    <TouchableOpacity
                                      style={styles.packFixButton}
                                      onPress={() => applyDraftFixes([{ index, unit_price: flag.unit_price as number }])}
                                    >
                                      <Text style={styles.packFixButtonText}>
                                        {t('scanCheck.setPrice').replace('{price}', String(flag.unit_price))}
                                      </Text>
                                    </TouchableOpacity>
                                  )}
                                  {flag.quantity != null && (
                                    <TouchableOpacity
                                      style={styles.packFixButton}
                                      onPress={() => updateItem(index, { quantity: String(flag.quantity) })}
                                    >
                                      <Text style={styles.packFixButtonText}>
                                        {t('scanCheck.setQuantity').replace('{qty}', String(flag.quantity))}
                                      </Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              </View>
                            );
                          })()}
                        </View>
                      ))
                    )}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.notes')}</Text>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder={t('scan.notesPlaceholder')}
                      placeholderTextColor={COLORS.textMuted}
                      multiline
                      numberOfLines={3}
                    />
                  </View>
                    </>
                  )}

                  {(scanMode === 'sales' || reviewing) && (
                  <PressableScale
                    style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
                    onPress={scanMode === 'sales' ? handleSaveSalesInvoice : () => handleSaveInvoice()}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={24} color="white" />
                        <Text style={styles.saveButtonText}>
                          {scanMode === 'sales' ? t('scan.saveSalesInvoice') : t('scan.saveInvoice')}
                        </Text>
                      </>
                    )}
                  </PressableScale>
                  )}
                </View>
              )}
            </View>
          )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  // Sits in the form's own card - no second frame around it.
  summaryCard: {},
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  summaryTitle: { color: 'white', fontSize: 16, fontWeight: '700' },
  summaryNote: { color: COLORS.primaryLight, fontSize: 13, marginBottom: 4 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  summaryLabel: { color: COLORS.textSecondary, fontSize: 13 },
  summaryValue: { flexShrink: 1, color: 'white', fontSize: 14, fontWeight: '600', textAlign: 'right' },
  summaryTotal: { fontSize: 17 },
  summarySub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, textAlign: 'right' },
  summaryInputGroup: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  summaryMissingLabel: { color: COLORS.warning },
  summaryWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  summaryWarningText: { flex: 1, color: COLORS.warning, fontSize: 13 },
  summarySave: { marginTop: 12 },
  summaryEdit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  summaryEditText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  offlineCard: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginTop: 12,
  },
  offlineTitle: { color: 'white', fontSize: 16, fontWeight: '700' },
  offlineText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  offlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginTop: 6,
  },
  offlineButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
  queueBox: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 14, marginTop: 20 },
  queueHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  queueTitle: { flex: 1, color: 'white', fontSize: 15, fontWeight: '700' },
  queueLink: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  queueThumb: { width: 44, height: 56, borderRadius: 6, backgroundColor: COLORS.background },
  queueWhen: { color: COLORS.textLight, fontSize: 13, fontWeight: '600' },
  queueStatus: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  queueReview: { backgroundColor: COLORS.primary, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  queueReviewText: { color: 'white', fontSize: 12, fontWeight: '600' },
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
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: COLORS.primary,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  modeButtonTextActive: {
    color: 'white',
  },
  scanOptions: {
    flexDirection: 'row',
    gap: 16,
  },
  scanButton: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  scanIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  scanButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 4,
  },
  scanButtonHint: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  tipsBox: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 20,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tipsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
  },
  resultContainer: {
    flex: 1,
  },
  imagePreview: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  pagesCountText: {
    color: COLORS.primaryLight,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  pagesStrip: {
    flexDirection: 'row',
  },
  pageThumbWrapper: {
    marginRight: 10,
    position: 'relative',
  },
  pageThumb: {
    width: 72,
    height: 96,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pageThumbBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pageThumbBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
  },
  pageThumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPageTile: {
    width: 72,
    height: 96,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  addPageButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 10,
    paddingVertical: 10,
  },
  addPageButtonText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    padding: 8,
    gap: 8,
  },
  retakeText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  scanningContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
  },
  scanningText: {
    color: COLORS.textSecondary,
    marginTop: 16,
    fontSize: 16,
  },
  formContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  formHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  eikInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eikInput: {
    flex: 1,
  },
  eikWarningText: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 6,
  },
  supplierChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  supplierChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxWidth: 200,
  },
  supplierChipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
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
  protocolNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  protocolNoteText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.primaryLight,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
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
  dateInputButtonWarning: {
    borderColor: COLORS.warning,
  },
  dateInputText: {
    flex: 1,
    color: 'white',
    fontSize: 16,
  },
  
  // AI Corrections Styles
  correctionsContainer: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  correctionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  correctionsTitle: {
    color: COLORS.success,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  confidenceBadge: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  confidenceText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  correctionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 4,
  },
  correctionText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
  itemsSection: {
    marginBottom: 16,
  },
  itemsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  addItemButtonText: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  itemsEmptyHint: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginTop: 8,
  },
  itemRow: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemNameInput: {
    marginBottom: 8,
  },
  itemRowFields: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  itemPriceNote: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  packRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  packRuleText: {
    marginTop: 0,
    flexShrink: 1,
    color: COLORS.success,
  },
  packRuleUndo: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  packFixButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.warning + '60',
    backgroundColor: COLORS.warning + '15',
  },
  packFixButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.warning,
  },
  // Do the amounts add up?
  checkCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
  },
  checkCardWarn: {
    borderColor: COLORS.warning,
  },
  checkCardOk: {
    borderColor: COLORS.success,
  },
  checkCardStale: {
    opacity: 0.55,
  },
  checkSpaced: {
    marginTop: 8,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  checkText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  checkTitle: {
    color: 'white',
    fontWeight: '600',
  },
  checkCause: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
    marginTop: 6,
    marginLeft: 22,
  },
  checkActions: {
    marginLeft: 22,
  },
  lineFixRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemSmallInput: {
    flex: 1,
    // Without it a web text input keeps its built-in width and the row
    // runs off the screen (price and delete out of view).
    minWidth: 0,
    paddingVertical: 10,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  removeItemButton: {
    padding: 8,
  },
});

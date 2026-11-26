import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { downloadAndShareFile } from '../src/utils/downloadFile';
import { api } from '../src/services/api';
import { BillingDocument, BillingDocumentItem, BillingDocumentType, Customer, PriceListEntry } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet, Expandable, AnimatedEmptyIcon, SkeletonRow, LocationPicker } from '../src/components';
import { useLocationChoice, useLocationsStore } from '../src/stores/locationsStore';
import { COLORS } from '../src/theme/colors';
import { useModules } from '../src/stores/modulesStore';
import { formatAmount, formatMoney, parseAmount, readAmount } from '../src/utils/money';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

type FormItem = { name: string; quantity: string; unit: string; unit_price: string; vat_rate: string };
const emptyFormItem = (): FormItem => ({ name: '', quantity: '1', unit: 'бр.', unit_price: '', vat_rate: '20' });
type PaymentMethod = 'cash' | 'bank_transfer' | 'card';

// A bill or quote is non-fiscal: a "bill" creates a receivable (see
// /receivables), a "quote" never does. An invoice is issued to a customer:
// numbered in sequence, with VAT, revenue and VAT on its issue date, and
// owed (a receivable that is already revenue) until paid - unless paid in
// cash or by card when issued.
export default function BillingDocumentsScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { hasPermission, user } = useAuth();
  // Invoices are their own right; bills and quotes go with entering revenue.
  const canIssueInvoices = hasPermission('issue_invoices');
  const canBill = hasPermission('add_revenue');
  // Cancelling an issued invoice (a tax document): owner or manager only.
  const canCancelInvoices = canIssueInvoices && (user?.role === 'owner' || user?.role === 'manager');
  const canManage = hasPermission('add_revenue') || hasPermission('issue_invoices');
  const usesTill = useModules().uses('till');
  // Home's "+ Фактура": straight into a new invoice.
  const { new: startNew } = useLocalSearchParams<{ new?: string }>();
  const startedNew = useRef(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [documents, setDocuments] = useState<BillingDocument[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [docType, setDocType] = useState<BillingDocumentType>('bill');
  const [formCustomerEik, setFormCustomerEik] = useState('');
  const [formCustomerAddress, setFormCustomerAddress] = useState('');
  const [formPaymentMethod, setFormPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [formStartNumber, setFormStartNumber] = useState('');
  const [formCustomerName, setFormCustomerName] = useState('');
  // A customer picked from the list: the document is tied to them (and their
  // EIK/address filled in). Typing another name unties it.
  const [formCustomerId, setFormCustomerId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [formNotes, setFormNotes] = useState('');
  const [formItems, setFormItems] = useState<FormItem[]>([emptyFormItem()]);
  const [customerNameError, setCustomerNameError] = useState(false);
  const [itemsError, setItemsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // A business not registered under the VAT Act issues invoices without
  // VAT (чл. 113, ал. 9 ЗДДС); the server applies it, the form mirrors it.
  const [vatRegistered, setVatRegistered] = useState(true);
  // What the business must give before its first invoice: a real ЕИК (not
  // the "AUTO…" one it starts with) and its address. The server refuses
  // an invoice without them; the form says so first.
  const [missingCompanyDetails, setMissingCompanyDetails] = useState<string[]>([]);
  // The business's own prices (Н8): the same line on an invoice, a bill or a quote.
  const [priceList, setPriceList] = useState<PriceListEntry[]>([]);
  // Does the business enter its till's daily revenue here? Then an invoice
  // paid in cash or by card went through the till (a fiscal receipt) and
  // its money is in that day's till revenue - not counted a second time.
  const [logsTill, setLogsTill] = useState(false);
  const [formInTill, setFormInTill] = useState(false);
  // The invoice a credit note is being issued to (the form is then that).
  const [creditFor, setCreditFor] = useState<BillingDocument | null>(null);
  // The quote a bill or an invoice is being made of.
  const [fromQuote, setFromQuote] = useState<BillingDocument | null>(null);
  // The location it is sold at (Н11): until picked, the last one used here.
  const { fallback: defaultLocation } = useLocationChoice();
  const rememberLocation = useLocationsStore((state) => state.remember);
  const [locationPick, setLocationPick] = useState<string | null | undefined>(undefined);
  const docLocation = locationPick === undefined ? defaultLocation : locationPick;
  // A quote: how long it is valid.
  const [formValidDays, setFormValidDays] = useState(30);

  const loadData = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    try {
      const [docs, defaults, knownCustomers, prices] = await Promise.all([
        api.getBillingDocuments(),
        api.getInvoiceDefaults().catch(() => null),
        api.getCustomers().catch(() => [] as Customer[]),
        api.getPriceList().catch(() => null),
      ]);
      setDocuments(docs);
      setPriceList(prices?.entries || []);
      setCustomers(knownCustomers);
      setVatRegistered(defaults?.vat_registered !== false);
      setLogsTill(!!defaults?.logs_till);
      setMissingCompanyDetails(defaults?.missing_company_details || []);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (loading || startedNew.current || startNew !== 'invoice' || !canIssueInvoices) return;
    startedNew.current = true;
    resetForm();
    setDocType('invoice');
    setModalVisible(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, startNew, canIssueInvoices]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const resetForm = () => {
    setCreditFor(null);
    setFromQuote(null);
    setLocationPick(undefined);
    setFormValidDays(30);
    setDocType(canBill ? 'bill' : 'invoice');
    setFormCustomerEik('');
    setFormCustomerAddress('');
    setFormPaymentMethod('bank_transfer');
    setFormInTill(logsTill);
    setFormStartNumber('');
    setFormCustomerName('');
    setFormCustomerId(null);
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

  // The price list first - its price as this document needs it: without
  // VAT on an invoice (the VAT on top), what the customer pays on a bill or
  // a quote - then lines charged before.
  const itemMatches = (name: string) => {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    const listed = priceList
      .filter((entry) => entry.name.toLowerCase() !== q && entry.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((entry) => ({
        name: entry.name, unit: entry.unit, fromList: true,
        unit_price: isInvoice ? entry.price : entry.price_gross,
        vat_rate: entry.vat_rate,
      }));
    const listedNames = new Set(priceList.map((entry) => entry.name.toLowerCase()));
    const past = itemDirectory
      .filter((it) => it.name.toLowerCase() !== q && it.name.toLowerCase().includes(q) && !listedNames.has(it.name.toLowerCase()))
      .slice(0, 5 - listed.length)
      .map((it) => ({ name: it.name, unit: it.unit, unit_price: it.unit_price, fromList: false, vat_rate: undefined as number | undefined }));
    return [...listed, ...past];
  };

  // A credit note is laid out as an invoice is: lines with their VAT rates.
  const isInvoice = docType === 'invoice' || docType === 'credit_note';
  const isCreditNote = docType === 'credit_note';
  const canEditCompany = hasPermission('manage_company');
  const companyFields = (missing: string[]) => missing
    .map((field) => (field === 'eik' ? t('billingDocuments.fieldEik') : t('billingDocuments.fieldAddress')))
    .join(t('billingDocuments.fieldsAnd'));
  const invoiceBlocked = isInvoice && missingCompanyDetails.length > 0;
  const creditLeft = creditFor ? Math.max(creditFor.total_amount - (creditFor.credited_amount || 0), 0) : 0;

  // A quote made into a bill or an invoice: the form filled from it, to
  // check and issue.
  const makeFromQuote = (quote: BillingDocument, target: 'bill' | 'invoice') => {
    resetForm();
    setDocType(target);
    setFromQuote(quote);
    // Made of a quote: sold where the quote was given.
    setLocationPick(quote.location_id ?? null);
    setFormCustomerName(quote.customer_name);
    setFormCustomerId(quote.customer_id || null);
    const known = customers.find((c) => c.id === quote.customer_id);
    setFormCustomerEik(known?.eik || '');
    setFormCustomerAddress(known?.address || '');
    setFormNotes(quote.notes || '');
    setFormItems(quote.items.map((item) => ({
      name: item.name, quantity: String(item.quantity), unit: item.unit || 'бр.',
      unit_price: String(item.unit_price), vat_rate: String(item.vat_rate ?? 20),
    })));
    setModalVisible(true);
  };

  const answerQuote = async (quote: BillingDocument, status: 'accepted' | 'declined') => {
    try {
      await api.setQuoteStatus(quote.id, quote.quote_status === status ? 'open' : status);
      Haptics.success();
      loadData();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    }
  };

  // The same invoice every month (Н7): ready on its day, issued with a tap.
  const makeRecurring = (invoice: BillingDocument) => {
    const day = new Date(invoice.issue_date).getDate();
    Alert.alert(
      t('recurringInvoices.makeRecurring'),
      t('recurringInvoices.makeRecurringText').replace('{day}', String(day)).replace('{customer}', invoice.customer_name),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('recurringInvoices.makeRecurring'),
          onPress: async () => {
            try {
              await api.createRecurringInvoice({ from_document_id: invoice.id });
              Toast.success(t('recurringInvoices.created'));
              router.push('/recurring-invoices');
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            }
          },
        },
      ],
    );
  };

  const openCreditNote = (invoice: BillingDocument) => {
    resetForm();
    setDocType('credit_note');
    setCreditFor(invoice);
    setFormCustomerName(invoice.customer_name);
    setFormCustomerId(invoice.customer_id || null);
    setFormItems([{ ...emptyFormItem(), vat_rate: String(invoice.vat_by_rate?.[0]?.rate ?? 20) }]);
    setModalVisible(true);
  };
  // Known customers matching what is typed (or the most recent few while
  // the field is empty) - one tap fills the name, EIK and address.
  const customerMatches = useMemo(() => {
    if (formCustomerId) return [];
    const query = formCustomerName.trim().toLowerCase();
    const found = query
      ? customers.filter((c) => c.name.toLowerCase().includes(query) || (c.eik || '').includes(query))
      : customers;
    return found.filter((c) => c.name !== formCustomerName).slice(0, 5);
  }, [customers, formCustomerName, formCustomerId]);

  const pickCustomer = (customer: Customer) => {
    setFormCustomerName(customer.name);
    setFormCustomerEik(customer.eik || '');
    setFormCustomerAddress(customer.address || '');
    setFormCustomerId(customer.id);
    setCustomerNameError(false);
  };

  // The first invoice issued here may continue the business's own numbering.
  const hasIssuedInvoices = documents.some((doc) => doc.doc_type === 'invoice');
  const formNet = formItems.reduce((sum, it) => {
    const qty = parseAmount(it.quantity);
    const price = parseAmount(it.unit_price);
    return sum + qty * price;
  }, 0);
  // Without VAT: an invoice of a business not registered for it, or a credit
  // note to an invoice issued without VAT.
  const vatExempt = isCreditNote ? !!creditFor?.vat_exempt_basis : isInvoice && !vatRegistered;
  // VAT on each rate's whole base, as the invoice prints it.
  const formVat = isInvoice && !vatExempt
    ? Object.entries(formItems.reduce<Record<string, number>>((acc, it) => {
        const base = parseAmount(it.quantity) * parseAmount(it.unit_price);
        const rate = it.vat_rate.trim() === '' ? '20' : it.vat_rate.trim();
        acc[rate] = (acc[rate] || 0) + base;
        return acc;
      }, {})).reduce((sum, [rate, base]) => sum + Math.round(base * parseAmount(rate)) / 100, 0)
    : 0;
  const formTotal = formNet + formVat;

  const handleSave = async () => {
    const missingName = !formCustomerName.trim();
    const validItems: BillingDocumentItem[] = formItems
      .filter((it) => it.name.trim() && readAmount(it.unit_price) >= 0 && readAmount(it.quantity) > 0)
      .map((it) => ({
        name: it.name.trim(), quantity: readAmount(it.quantity), unit: it.unit || 'бр.', unit_price: readAmount(it.unit_price),
        ...(isInvoice ? { vat_rate: vatExempt ? 0 : Math.min(100, Math.max(0, parseAmount(it.vat_rate))) } : {}),
      }));
    setCustomerNameError(missingName);
    setItemsError(validItems.length === 0);
    if (missingName || validItems.length === 0) return;
    if (isCreditNote && !formNotes.trim()) {
      Alert.alert(t('common.error'), t('billingDocuments.creditNoteReasonPlaceholder'));
      return;
    }

    setSaving(true);
    try {
      if (isCreditNote && creditFor) {
        const note = await api.createBillingDocument({
          doc_type: 'credit_note',
          credited_document_id: creditFor.id,
          customer_name: creditFor.customer_name,
          items: validItems,
          notes: formNotes.trim(),
        });
        Haptics.success();
        Toast.success(t('billingDocuments.creditNoteSaved').replace('{number}', note.invoice_number || ''));
        setModalVisible(false);
        resetForm();
        loadData();
        return;
      }
      const saved = await api.createBillingDocument({
        doc_type: docType,
        customer_name: formCustomerName.trim(),
        customer_id: formCustomerId || undefined,
        items: validItems,
        notes: formNotes.trim() || undefined,
        ...(fromQuote ? { from_quote_id: fromQuote.id } : {}),
        ...(docLocation ? { location_id: docLocation } : {}),
        ...(docType === 'quote' ? { valid_until: format(addDays(new Date(), formValidDays), 'yyyy-MM-dd') } : {}),
        ...(isInvoice ? {
          customer_eik: formCustomerEik.trim() || undefined,
          customer_address: formCustomerAddress.trim() || undefined,
          payment_method: formPaymentMethod,
          ...(formPaymentMethod !== 'bank_transfer' ? { in_till: formInTill } : {}),
          invoice_number: !hasIssuedInvoices && formStartNumber.trim() ? formStartNumber.trim() : undefined,
        } : {}),
      });
      if (docLocation) rememberLocation(docLocation);
      Haptics.success();
      Toast.success(
        isInvoice
          ? t('billingDocuments.invoiceSaved').replace('{number}', saved.invoice_number || '')
          : docType === 'bill' ? t('billingDocuments.billSaved') : t('billingDocuments.quoteSaved'),
      );
      setModalVisible(false);
      resetForm();
      loadData();
    } catch (error: any) {
      if (error?.code === 'company_details_missing') {
        // The details went missing since the form opened: say which, and lead there.
        setMissingCompanyDetails(error.missing || []);
        Alert.alert(t('common.error'), error.message, canEditCompany ? [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('billingDocuments.companyDetailsOpen'), onPress: () => { setModalVisible(false); router.push('/company-settings'); } },
        ] : undefined);
        return;
      }
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async (doc: BillingDocument) => {
    setDownloadingId(doc.id);
    try {
      const name = doc.doc_type === 'invoice' && doc.invoice_number ? `faktura_${doc.invoice_number}`
        : doc.doc_type === 'credit_note' && doc.invoice_number ? `kreditno_izvestie_${doc.invoice_number}`
          : `${doc.doc_type}_${doc.id.slice(0, 8)}`;
      await downloadAndShareFile(api.getBillingDocumentPdfUrl(doc.id), `${name}.pdf`);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('billingDocuments.downloadError'));
    } finally {
      setDownloadingId(null);
    }
  };

  // Where a bill's or an invoice's money stands, said on its card.
  const paymentLabel = (doc: BillingDocument) => {
    const left = formatAmount(doc.amount_left || 0);
    switch (doc.payment_status) {
      case 'paid': return t('billingDocuments.statusPaid');
      case 'partly_paid':
        return t('billingDocuments.statusPartlyPaid').replace('{paid}', formatAmount(doc.paid_amount || 0)).replace('{left}', left);
      case 'overdue': return t('billingDocuments.statusOverdue').replace('{left}', left);
      case 'credited': return t('billingDocuments.statusCredited');
      default: return t('billingDocuments.statusOwed');
    }
  };
  const paymentBadgeStyle = (status: BillingDocument['payment_status']) =>
    status === 'paid' ? styles.paymentPaid
      : status === 'overdue' ? styles.paymentOverdue
        : status === 'credited' ? styles.paymentCredited : styles.paymentOwed;

  const handleDelete = (doc: BillingDocument) => {
    const confirmText = doc.doc_type === 'invoice' ? t('billingDocuments.invoiceDeleteConfirm')
      : doc.doc_type === 'credit_note' ? t('billingDocuments.creditNoteDeleteConfirm') : t('billingDocuments.deleteConfirm');
    Alert.alert(t('common.delete'), confirmText, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            const result = await api.deleteBillingDocument(doc.id);
            // Its receivable goes with it unless something was already paid on
            // it; an earlier invoice is cancelled, keeping its number.
            if ((result?.refund_due || 0) > 0) {
              // Money came in on it: nothing is owed now, and what was paid
              // is the customer's to get back.
              Alert.alert(
                result?.cancelled ? t('billingDocuments.invoiceCancelled') : t('billingDocuments.deleted'),
                t('billingDocuments.refundAfterCancel').replace('{amount}', formatAmount((result?.refund_due || 0))),
              );
            } else if (result?.cancelled) {
              Toast.success(t('billingDocuments.invoiceCancelled'));
            } else {
              Toast.success(result?.receivable === 'kept' ? t('billingDocuments.deletedReceivableKept') : t('billingDocuments.deleted'));
            }
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
            <TouchableOpacity onPress={() => router.push('/customers')} style={styles.backButton} accessibilityLabel={t('customers.title')}>
              <Ionicons name="people-outline" size={22} color="white" />
            </TouchableOpacity>
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
              {/* What belongs to issuing invoices, one tap each (Л8). */}
              <View style={styles.toolsRow}>
                {hasPermission('issue_invoices') && (
                  <TouchableOpacity style={styles.toolLink} onPress={() => router.push('/recurring-invoices')}>
                    <Ionicons name="repeat-outline" size={14} color={COLORS.success} />
                    <Text style={styles.toolLinkText}>{t('recurringInvoices.title')}</Text>
                  </TouchableOpacity>
                )}
                {hasPermission('add_revenue') && (
                  <TouchableOpacity style={styles.toolLink} onPress={() => router.push('/payment-reminders')}>
                    <Ionicons name="notifications-outline" size={14} color={COLORS.success} />
                    <Text style={styles.toolLinkText}>{t('reminders.title')}</Text>
                  </TouchableOpacity>
                )}
              </View>
              {documents.length === 0 && (
                <View style={styles.emptyContainer}>
                  <AnimatedEmptyIcon name="document-text-outline" size={64} color={COLORS.border} />
                  <Text style={styles.emptyText}>{t('billingDocuments.empty')}</Text>
                </View>
              )}
              {documents.map((doc) => (
                <View key={doc.id} style={[styles.card, doc.cancelled && { opacity: 0.55 }]}>
                  <View style={styles.rowTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                      <View style={[
                        styles.typeBadge, doc.doc_type === 'bill' && styles.typeBadgeBill,
                        (doc.doc_type === 'invoice' || doc.doc_type === 'credit_note') && styles.typeBadgeInvoice,
                      ]}>
                        <Text style={styles.typeBadgeText}>
                          {doc.doc_type === 'invoice'
                            ? `${t('billingDocuments.typeInvoice')} № ${doc.invoice_number || ''}`
                            : doc.doc_type === 'credit_note'
                              ? `${t('billingDocuments.typeCreditNote')} № ${doc.invoice_number || ''}`
                              : doc.doc_type === 'bill' ? t('billingDocuments.typeBill') : t('billingDocuments.typeQuote')}
                        </Text>
                      </View>
                      {doc.cancelled && (
                        <View style={[styles.typeBadge, styles.typeBadgeCancelled]}>
                          <Text style={styles.typeBadgeText}>{t('billingDocuments.cancelled')}</Text>
                        </View>
                      )}
                      {!doc.cancelled && doc.in_till && (
                        <View style={styles.typeBadge}>
                          <Text style={styles.typeBadgeText}>{t('billingDocuments.badgeInTill')}</Text>
                        </View>
                      )}
                      {doc.external && (
                        <View style={styles.typeBadge}>
                          <Text style={styles.typeBadgeText}>{t('billingDocuments.badgeExternal')}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[
                      styles.amount, doc.total_amount < 0 && { color: COLORS.danger },
                      doc.cancelled && { textDecorationLine: 'line-through' },
                    ]}>{formatMoney(doc.total_amount)}</Text>
                  </View>
                  <Text style={styles.customerName} numberOfLines={1}>{doc.customer_name}</Text>
                  {doc.doc_type === 'credit_note' && doc.credited_invoice_number && (
                    <Text style={styles.creditLine}>
                      {t('billingDocuments.creditNoteTo').replace('{number}', doc.credited_invoice_number)}
                    </Text>
                  )}
                  {doc.doc_type === 'invoice' && (doc.credited_amount || 0) > 0 && (
                    <Text style={styles.creditLine}>
                      {t('billingDocuments.creditedLine').replace('{amount}', formatAmount((doc.credited_amount || 0)))}
                    </Text>
                  )}
                  {doc.doc_type === 'quote' && (() => {
                    const today = format(new Date(), 'yyyy-MM-dd');
                    const expired = doc.quote_status === 'open' && !!doc.valid_until && doc.valid_until < today;
                    const label = doc.quote_status === 'accepted' ? t('billingDocuments.quoteAccepted')
                      : doc.quote_status === 'declined' ? t('billingDocuments.quoteDeclined')
                        : expired ? t('billingDocuments.quoteExpired')
                          : doc.valid_until
                            ? t('billingDocuments.quoteOpenUntil').replace('{date}', format(new Date(doc.valid_until), 'd MMM', { locale: dateLocale }))
                            : null;
                    const made = !!doc.converted_document_id && documents.some((d) => d.id === doc.converted_document_id);
                    return (
                      <View style={styles.paymentRow}>
                        {label && (
                          <View style={[styles.paymentBadge,
                            doc.quote_status === 'accepted' ? styles.paymentPaid
                              : doc.quote_status === 'declined' || expired ? styles.paymentCredited : styles.paymentOwed]}>
                            <Text style={styles.typeBadgeText}>{label}</Text>
                          </View>
                        )}
                        {!made && canBill && (
                          <>
                            <TouchableOpacity onPress={() => answerQuote(doc, 'accepted')} hitSlop={6}>
                              <Text style={[styles.quoteAction, doc.quote_status === 'accepted' && styles.quoteActionOn]}>
                                ✓ {t('billingDocuments.quoteMarkAccepted')}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => answerQuote(doc, 'declined')} hitSlop={6}>
                              <Text style={[styles.quoteAction, doc.quote_status === 'declined' && styles.quoteActionOn]}>
                                ✗ {t('billingDocuments.quoteMarkDeclined')}
                              </Text>
                            </TouchableOpacity>
                          </>
                        )}
                        {!made && doc.quote_status !== 'declined' && canBill && (
                          <TouchableOpacity onPress={() => makeFromQuote(doc, 'bill')} hitSlop={6}>
                            <Text style={styles.quoteAction}>{t('billingDocuments.quoteToBill')}</Text>
                          </TouchableOpacity>
                        )}
                        {!made && doc.quote_status !== 'declined' && canIssueInvoices && (
                          <TouchableOpacity onPress={() => makeFromQuote(doc, 'invoice')} hitSlop={6}>
                            <Text style={styles.quoteAction}>{t('billingDocuments.quoteToInvoice')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })()}
                  {doc.payment_status && (
                    <View style={styles.paymentRow}>
                      <View style={[styles.paymentBadge, paymentBadgeStyle(doc.payment_status)]}>
                        <Text style={styles.typeBadgeText}>{paymentLabel(doc)}</Text>
                      </View>
                      {(doc.refund_due || 0) > 0 && (
                        <Text style={styles.refundText}>
                          {t('billingDocuments.refundDue').replace('{amount}', formatAmount((doc.refund_due || 0)))}
                        </Text>
                      )}
                    </View>
                  )}
                  <View style={styles.rowBottom}>
                    <Text style={styles.date}>{format(new Date(doc.issue_date), 'd MMM yyyy', { locale: dateLocale })}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      {!doc.external && (
                        <TouchableOpacity onPress={() => handleDownload(doc)} disabled={downloadingId === doc.id} hitSlop={8}>
                          {downloadingId === doc.id ? (
                            <ActivityIndicator size="small" color={COLORS.primary} />
                          ) : (
                            <Ionicons name="download-outline" size={18} color={COLORS.primary} />
                          )}
                        </TouchableOpacity>
                      )}
                      {doc.doc_type === 'invoice' && !doc.cancelled && canIssueInvoices && !doc.recurring_invoice_id && (
                        <TouchableOpacity onPress={() => makeRecurring(doc)} hitSlop={8} accessibilityLabel={t('recurringInvoices.makeRecurring')}>
                          <Ionicons name="repeat-outline" size={18} color={COLORS.primary} />
                        </TouchableOpacity>
                      )}
                      {doc.doc_type === 'invoice' && !doc.cancelled && canIssueInvoices
                        && doc.total_amount - (doc.credited_amount || 0) > 0.005 && (
                        <TouchableOpacity onPress={() => openCreditNote(doc)} hitSlop={8} accessibilityLabel={t('billingDocuments.creditNoteAction')}>
                          <Ionicons name="return-down-back-outline" size={18} color={COLORS.primary} />
                        </TouchableOpacity>
                      )}
                      {!doc.cancelled && (
                        doc.doc_type !== 'invoice' && doc.doc_type !== 'credit_note' ? canBill : doc.external ? canIssueInvoices : canCancelInvoices
                      ) && (
                        <TouchableOpacity onPress={() => handleDelete(doc)} hitSlop={8}>
                          <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          <BottomSheet visible={modalVisible} onClose={() => { setModalVisible(false); resetForm(); }}>
            <View style={styles.modalContent}>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.modalTitle}>
                  {creditFor
                    ? t('billingDocuments.creditNoteTitle').replace('{number}', creditFor.invoice_number || '')
                    : t('billingDocuments.addNew')}
                </Text>
                {creditFor && (
                  <Text style={styles.invoiceHint}>
                    {creditFor.customer_name} · {t('billingDocuments.creditNoteHint').replace('{left}', formatAmount(creditLeft))}
                  </Text>
                )}

                {!creditFor && (
                <View style={styles.typeSelector}>
                  {(['bill', 'invoice', 'quote'] as const).filter((opt) => (opt === 'invoice' ? canIssueInvoices : canBill)).map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.typeOption, docType === opt && styles.typeOptionActive]}
                      onPress={() => setDocType(opt)}
                    >
                      <Text style={[styles.typeOptionText, docType === opt && styles.typeOptionTextActive]}>
                        {opt === 'invoice' ? t('billingDocuments.typeInvoice') : opt === 'bill' ? t('billingDocuments.typeBill') : t('billingDocuments.typeQuote')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                )}
                {invoiceBlocked ? (
                  <View style={styles.detailsNotice}>
                    <Ionicons name="business-outline" size={18} color={COLORS.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailsNoticeText}>
                        {(canEditCompany ? t('billingDocuments.companyDetailsMissing') : t('billingDocuments.companyDetailsAskOwner'))
                          .replace('{fields}', companyFields(missingCompanyDetails))}
                      </Text>
                      {canEditCompany && (
                        <TouchableOpacity
                          style={styles.detailsNoticeButton}
                          onPress={() => { setModalVisible(false); router.push('/company-settings'); }}
                          accessibilityRole="button"
                        >
                          <Text style={styles.detailsNoticeButtonText}>{t('billingDocuments.companyDetailsOpen')}</Text>
                          <Ionicons name="chevron-forward" size={16} color={COLORS.primaryLight} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ) : isInvoice && !creditFor && <Text style={styles.invoiceHint}>{t('billingDocuments.invoiceHint')}</Text>}
                {!creditFor && (
                  <View style={{ marginTop: 10 }}>
                    <LocationPicker value={docLocation} onChange={setLocationPick} noneLabel={t('locations.noneWhole')} />
                  </View>
                )}
                {fromQuote && (
                  <Text style={styles.invoiceHint}>
                    {t('billingDocuments.fromQuote').replace('{amount}', formatAmount(fromQuote.total_amount))}
                  </Text>
                )}
                {docType === 'quote' && (
                  <>
                    <Text style={styles.inputLabel}>{t('billingDocuments.quoteValidFor')}</Text>
                    <View style={styles.typeSelector}>
                      {[7, 14, 30].map((days) => (
                        <TouchableOpacity
                          key={days}
                          style={[styles.typeOption, formValidDays === days && styles.typeOptionActive]}
                          onPress={() => setFormValidDays(days)}
                        >
                          <Text style={[styles.typeOptionText, formValidDays === days && styles.typeOptionTextActive]}>
                            {t('billingDocuments.quoteDays').replace('{days}', String(days))}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                {!creditFor && (
                <>
                <Text style={styles.inputLabel}>{t('receivables.customerName')}</Text>
                <TextInput
                  style={[styles.input, customerNameError && styles.inputErrorBorder]}
                  value={formCustomerName}
                  onChangeText={(v) => { setFormCustomerName(v); setFormCustomerId(null); setCustomerNameError(false); }}
                  placeholder={t('receivables.customerNamePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                />
                {customerMatches.length > 0 && (
                  <View style={styles.customerChips}>
                    {customerMatches.map((customer) => (
                      <TouchableOpacity key={customer.id} style={styles.customerChip} onPress={() => pickCustomer(customer)}>
                        <Ionicons name="person-outline" size={12} color={COLORS.primary} />
                        <Text style={styles.customerChipText} numberOfLines={1}>
                          {customer.name}{customer.eik ? ` · ${customer.eik}` : ''}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <Expandable expanded={customerNameError}>
                  <Text style={styles.fieldErrorText}>{t('common.required')}</Text>
                </Expandable>
                </>
                )}

                {isInvoice && !creditFor && (
                  <>
                    <Text style={styles.inputLabel}>{t('billingDocuments.customerEik')}</Text>
                    <TextInput
                      style={styles.input}
                      value={formCustomerEik}
                      onChangeText={setFormCustomerEik}
                      keyboardType="number-pad"
                      maxLength={13}
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <Text style={styles.inputLabel}>{t('billingDocuments.customerAddress')}</Text>
                    <TextInput
                      style={styles.input}
                      value={formCustomerAddress}
                      onChangeText={setFormCustomerAddress}
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <Text style={styles.inputLabel}>{t('scan.paymentMethod')}</Text>
                    <View style={styles.typeSelector}>
                      {(['bank_transfer', 'cash', 'card'] as PaymentMethod[]).map((method) => (
                        <TouchableOpacity
                          key={method}
                          style={[styles.typeOption, formPaymentMethod === method && styles.typeOptionActive]}
                          onPress={() => setFormPaymentMethod(method)}
                        >
                          <Text style={[styles.typeOptionText, formPaymentMethod === method && styles.typeOptionTextActive]}>
                            {t(`scan.paymentMethod.${method}`)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={styles.invoiceHint}>
                      {formPaymentMethod === 'bank_transfer' ? t('billingDocuments.invoiceOwed') : t('billingDocuments.invoicePaidNow')}
                    </Text>
                    {usesTill && formPaymentMethod !== 'bank_transfer' && (
                      <View style={styles.tillRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.tillLabel}>{t('billingDocuments.inTill')}</Text>
                          <Text style={styles.invoiceHint}>
                            {formInTill ? t('billingDocuments.inTillHint') : t('billingDocuments.notInTillHint')}
                          </Text>
                        </View>
                        <Switch value={formInTill} onValueChange={setFormInTill} accessibilityLabel={t('billingDocuments.inTill')} />
                      </View>
                    )}
                    {!hasIssuedInvoices && (
                      <>
                        <Text style={styles.inputLabel}>{t('billingDocuments.startNumber')}</Text>
                        <TextInput
                          style={styles.input}
                          value={formStartNumber}
                          onChangeText={(v) => setFormStartNumber(v.replace(/\D/g, '').slice(0, 10))}
                          keyboardType="number-pad"
                          placeholder="0000000001"
                          placeholderTextColor={COLORS.textMuted}
                        />
                      </>
                    )}
                  </>
                )}

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
                              ...(match.fromList && isInvoice && match.vat_rate !== undefined ? { vat_rate: String(match.vat_rate) } : {}),
                            })}
                          >
                            {match.fromList && <Ionicons name="pricetag-outline" size={12} color={COLORS.primary} />}
                            <Text style={styles.itemChipText} numberOfLines={1}>
                              {match.name} · {formatMoney(match.unit_price)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {/* Quantity, unit, price and VAT side by side, each named
                        above its field - a filled field has no placeholder
                        left to say what it is. On a phone they share the
                        row's width; minWidth 0 lets a web text input shrink
                        (its built-in width pushed the price off the screen). */}
                    <View style={styles.itemRowFields}>
                      <View style={[styles.itemField, { flex: 0.8 }]}>
                        <Text style={styles.itemFieldLabel} numberOfLines={1}>{t('invoices.itemQty')}</Text>
                        <TextInput
                          style={[styles.input, styles.itemSmallInput]}
                          value={item.quantity}
                          onChangeText={(v) => updateFormItem(index, { quantity: v })}
                          keyboardType="decimal-pad"
                          placeholderTextColor={COLORS.textMuted}
                          accessibilityLabel={t('invoices.itemQty')}
                        />
                      </View>
                      <View style={[styles.itemField, { flex: 0.8 }]}>
                        <Text style={styles.itemFieldLabel} numberOfLines={1}>{t('scan.unitPlaceholder')}</Text>
                        <TextInput
                          style={[styles.input, styles.itemSmallInput]}
                          value={item.unit}
                          onChangeText={(v) => updateFormItem(index, { unit: v })}
                          placeholderTextColor={COLORS.textMuted}
                          accessibilityLabel={t('scan.unitPlaceholder')}
                        />
                      </View>
                      <View style={[styles.itemField, { flex: 1.4 }]}>
                        <Text style={styles.itemFieldLabel} numberOfLines={1}>
                          {isInvoice ? t('billingDocuments.priceWithoutVat') : t('scan.pricePlaceholder')}
                        </Text>
                        <TextInput
                          style={[styles.input, styles.itemSmallInput]}
                          value={item.unit_price}
                          onChangeText={(v) => updateFormItem(index, { unit_price: v })}
                          keyboardType="decimal-pad"
                          placeholder="0,00"
                          placeholderTextColor={COLORS.textMuted}
                          accessibilityLabel={isInvoice ? t('billingDocuments.priceWithoutVat') : t('scan.pricePlaceholder')}
                        />
                      </View>
                      {isInvoice && !vatExempt && (
                        <View style={[styles.itemField, { flex: 0.7 }]}>
                          <Text style={styles.itemFieldLabel} numberOfLines={1}>{t('billingDocuments.vatRate')}</Text>
                          <TextInput
                            style={[styles.input, styles.itemSmallInput]}
                            value={item.vat_rate}
                            onChangeText={(v) => updateFormItem(index, { vat_rate: v.replace(/[^\d.,]/g, '').replace(',', '.') })}
                            keyboardType="decimal-pad"
                            placeholderTextColor={COLORS.textMuted}
                            accessibilityLabel={t('billingDocuments.vatRate')}
                          />
                        </View>
                      )}
                      {formItems.length > 1 && (
                        <TouchableOpacity
                          onPress={() => removeFormItem(index)}
                          style={styles.itemRemove}
                          accessibilityLabel={t('common.delete')}
                          hitSlop={6}
                        >
                          <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
                <Expandable expanded={itemsError}>
                  <Text style={styles.fieldErrorText}>{t('billingDocuments.itemsRequired')}</Text>
                </Expandable>
                {vatExempt && (
                  <Text style={styles.vatExemptNote}>{t('billingDocuments.vatExemptNote')}</Text>
                )}
                <TouchableOpacity style={styles.addItemButton} onPress={addFormItem}>
                  <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
                  <Text style={styles.addItemButtonText}>{t('billingDocuments.addItem')}</Text>
                </TouchableOpacity>

                {isInvoice && (
                  <Text style={styles.subtotalPreview}>
                    {t('billingDocuments.netAndVat').replace('{net}', formatAmount(formNet)).replace('{vat}', formatAmount(formVat))}
                  </Text>
                )}
                <Text style={styles.totalPreview}>{t('receivables.amount')}: {formatMoney(formTotal)}</Text>
                {fromQuote && docType === 'invoice' && Math.abs(formTotal - fromQuote.total_amount) > 0.01 && (
                  <Text style={styles.quoteDiffers}>
                    {t('billingDocuments.fromQuoteDiffers')
                      .replace('{quote}', formatAmount(fromQuote.total_amount)).replace('{total}', formatAmount(formTotal))}
                  </Text>
                )}

                <Text style={styles.inputLabel}>
                  {isCreditNote ? t('billingDocuments.creditNoteReason') : t('receivables.description')}
                </Text>
                <TextInput
                  style={styles.input}
                  value={formNotes}
                  onChangeText={setFormNotes}
                  placeholder={isCreditNote ? t('billingDocuments.creditNoteReasonPlaceholder') : t('receivables.descriptionPlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                />

              </ScrollView>
              <TouchableOpacity
                style={[styles.saveButton, (saving || invoiceBlocked) && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving || invoiceBlocked}
              >
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setModalVisible(false); resetForm(); }}>
                <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </BottomSheet>
        </SafeAreaView>
      </View>
    </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  customerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  customerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, maxWidth: 220,
  },
  customerChipText: { fontSize: 12, color: COLORS.textSecondary, flexShrink: 1 },
  tillRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, marginBottom: 6 },
  tillLabel: { color: 'white', fontSize: 14, fontWeight: '600' },
  vatExemptNote: { color: COLORS.textSecondary, fontSize: 12, marginTop: 6 },
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
  typeBadgeInvoice: { backgroundColor: 'rgba(59, 130, 246, 0.25)' },
  typeBadgeCancelled: { backgroundColor: 'rgba(239, 68, 68, 0.3)' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  paymentBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  paymentPaid: { backgroundColor: 'rgba(16, 185, 129, 0.3)' },
  paymentOwed: { backgroundColor: 'rgba(245, 158, 11, 0.3)' },
  paymentOverdue: { backgroundColor: 'rgba(239, 68, 68, 0.35)' },
  paymentCredited: { backgroundColor: 'rgba(148, 163, 184, 0.3)' },
  refundText: { fontSize: 12, color: COLORS.warning },
  creditLine: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 6 },
  quoteAction: { fontSize: 12, fontWeight: '600', color: COLORS.primaryLight },
  quoteActionOn: { color: COLORS.success },
  quoteDiffers: { fontSize: 12, color: COLORS.warning, marginTop: 6, lineHeight: 17 },
  invoiceHint: { fontSize: 12, color: COLORS.textSecondary, marginTop: 6, lineHeight: 17 },
  detailsNotice: {
    flexDirection: 'row', gap: 10, marginTop: 10, padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  detailsNoticeText: { fontSize: 13, color: COLORS.warningLight, lineHeight: 18 },
  detailsNoticeButton: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  detailsNoticeButtonText: { fontSize: 14, fontWeight: '600', color: COLORS.primaryLight },
  subtotalPreview: { color: COLORS.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'right' },
  typeBadgeText: { fontSize: 11, fontWeight: '700', color: 'white' },
  amount: { fontSize: 15, fontWeight: 'bold', color: COLORS.warning },
  customerName: { fontSize: 14, fontWeight: '600', color: 'white', marginBottom: 6 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 12, color: COLORS.textMuted },
  toolsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  toolLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  toolLinkText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  modalContent: { padding: 20, paddingBottom: 30, flexShrink: 1 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: 'white', marginBottom: 16 },
  typeSelector: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeOption: {
    // minWidth: 0 overrides flex items' web default of min-width: auto,
    // which refuses to shrink a chip below its text's natural width and
    // overflows a longer label past its border instead of wrapping.
    flex: 1, minWidth: 0, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  typeOptionActive: { backgroundColor: COLORS.primary },
  typeOptionText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  typeOptionTextActive: { color: 'white' },
  inputLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    color: 'white',
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxWidth: 220,
  },
  itemChipText: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600' },
  itemRowFields: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  itemField: { minWidth: 0 },
  itemFieldLabel: { color: COLORS.textMuted, fontSize: 12, marginBottom: 4 },
  itemSmallInput: { minWidth: 0, paddingVertical: 10, paddingHorizontal: 10 },
  itemRemove: { paddingBottom: 12 },
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

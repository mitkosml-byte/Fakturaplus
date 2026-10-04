import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert } from '../../src/utils/alert';
import { Toast } from '../../src/utils/toast';
import { Haptics } from '../../src/utils/haptics';
import * as ImagePicker from 'expo-image-picker';
import DateTimePickerModal from '../../src/components/AppDateTimePicker';
import { ScanCreditsReloadButton } from '../../src/components';
import { api } from '../../src/services/api';
import { OCRResult, InvoiceItemCreate, VatTreatment, PaymentMethod } from '../../src/types';
import { format, parse } from 'date-fns';
import { useTranslation, useLanguageStore } from '../../src/i18n';
import { COLORS } from '../../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

interface EditableItem {
  name: string;
  quantity: string;
  unit: string;
  unit_price: string;
}

const emptyItem = (): EditableItem => ({ name: '', quantity: '1', unit: 'бр.', unit_price: '' });

export default function ScanScreen() {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const router = useRouter();

  // Which direction the scanned document is: a purchase invoice FROM a
  // supplier (the default, feeds the invoice form below) or a sales
  // invoice/receipt the business itself ISSUED to a customer (feeds
  // straight into that day's daily revenue instead - no separate
  // sales-invoice record is kept, per the app's pocket-ledger scope).
  const [scanMode, setScanMode] = useState<'purchase' | 'sales'>('purchase');
  const [salesVatRate, setSalesVatRate] = useState<20 | 9 | 0>(20);

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

  // Form fields (editable after OCR)
  const [supplier, setSupplier] = useState('');
  const [supplierEik, setSupplierEik] = useState('');
  const [eikCheck, setEikCheck] = useState<{ valid: boolean; reason: string | null } | null>(null);
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
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [paymentDueDate, setPaymentDueDate] = useState<Date | null>(null);
  const [isDueDatePickerVisible, setDueDatePickerVisible] = useState(false);

  // Suggest a VAT treatment from the amounts (mirrors the backend's own
  // fallback) so the picker isn't just left blank, but only until the user
  // has actually chosen one themselves.
  useEffect(() => {
    if (vatTreatment) return;
    const base = parseFloat(amountWithoutVat);
    const vat = parseFloat(vatAmount);
    if (!base) return;
    const ratio = vat / base;
    if (Math.abs(ratio - 0.20) < 0.01) setVatTreatment('standard_20');
    else if (Math.abs(ratio - 0.09) < 0.01) setVatTreatment('reduced_9');
  }, [amountWithoutVat, vatAmount, vatTreatment]);

  // Same auto-detection, but snapped to the fixed 20/9/0% chips the daily
  // revenue form uses, for sales mode.
  useEffect(() => {
    const base = parseFloat(amountWithoutVat);
    const vat = parseFloat(vatAmount);
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
        await addPage(`data:image/jpeg;base64,${result.assets[0].base64}`);
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
      await addPage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const processImages = async (images: string[]) => {
    setIsScanning(true);
    setOcrCorrections([]);
    setOcrConfidence(null);
    try {
      const result = await api.scanInvoice(images);
      setOcrResult(result);
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
        })));
      }
      
      // Set invoice date from OCR if available - and flag it clearly when
      // it isn't, instead of leaving invoiceDate silently at today's date
      // with no sign that nothing was actually read off the invoice.
      let foundDate = false;
      if (result.invoice_date) {
        try {
          const parsedDate = new Date(result.invoice_date);
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
    } catch (error: any) {
      if (error.status === 402) {
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

  const handleSaveInvoice = async () => {
    if (!supplier || !invoiceNumber || !totalAmount) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }

    const itemsPayload: InvoiceItemCreate[] = items
      .filter(item => item.name.trim() && item.unit_price)
      .map(item => ({
        name: item.name.trim(),
        quantity: parseFloat(item.quantity) || 1,
        unit: item.unit.trim() || 'бр.',
        unit_price: parseFloat(item.unit_price) || 0,
      }));

    setIsSaving(true);
    try {
      const saved = await api.createInvoice({
        supplier,
        supplier_eik: supplierEik.trim() || undefined,
        invoice_number: invoiceNumber,
        amount_without_vat: parseFloat(amountWithoutVat) || 0,
        vat_amount: parseFloat(vatAmount) || 0,
        total_amount: parseFloat(totalAmount) || 0,
        vat_treatment: vatTreatment || undefined,
        date: invoiceDate.toISOString(),
        image_base64s: capturedImages.length > 0 ? capturedImages : undefined,
        notes: notes || undefined,
        items: itemsPayload.length > 0 ? itemsPayload : undefined,
        payment_method: paymentMethod || undefined,
        payment_due_date: paymentMethod === 'bank_transfer' && paymentDueDate ? paymentDueDate.toISOString() : undefined,
      });
      Haptics.success();
      if (saved.protocol_number) {
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

  // Sales mode hands off to the Home tab's existing daily-revenue modal
  // (via router params, the same pattern the unpaid-invoices card already
  // uses to deep-link into invoices.tsx) rather than saving anything here
  // directly - that modal already knows how to load whatever's currently
  // logged for the date and let the owner reconcile it with this scanned
  // amount, instead of silently overwriting the day's other sales.
  const handleAddToRevenue = () => {
    const total = parseFloat(totalAmount);
    if (!total) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }
    router.push({
      pathname: '/(tabs)',
      params: {
        ocrDate: format(invoiceDate, 'yyyy-MM-dd'),
        ocrFiscalRevenue: String(total),
        ocrVatRate: String(salesVatRate),
      },
    });
    resetForm();
  };

  const updateItem = (index: number, patch: Partial<EditableItem>) => {
    setItems(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setItems(prev => [...prev, emptyItem()]);
  };

  const resetForm = () => {
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
    setInvoiceDate(new Date());
    setDateFoundByOcr(null);
    setPaymentMethod('');
    setPaymentDueDate(null);
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
                  <TouchableOpacity
                    style={[styles.modeButton, scanMode === 'sales' && styles.modeButtonActive]}
                    onPress={() => setScanMode('sales')}
                  >
                    <Text style={[styles.modeButtonText, scanMode === 'sales' && styles.modeButtonTextActive]} numberOfLines={1}>
                      {t('scan.modeSales')}
                    </Text>
                  </TouchableOpacity>
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

          {capturedImages.length === 0 && scanMode === 'purchase' && (
            <View style={styles.tipsBox}>
              <View style={styles.tipsHeader}>
                <Ionicons name="sparkles-outline" size={18} color={COLORS.primary} />
                <Text style={styles.tipsTitle}>{t('scan.tipsTitle')}</Text>
              </View>
              {[t('scan.tipSupplier'), t('scan.tipAmounts'), t('scan.tipItems'), t('scan.tipPayment')].map((tip, i) => (
                <View key={i} style={styles.tipRow}>
                  <Ionicons name="checkmark-circle" size={14} color={COLORS.success} style={{ marginTop: 2 }} />
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
              <Text style={styles.tipsFooter}>{t('scan.tipsFooter')}</Text>
            </View>
          )}

          {capturedImages.length === 0 && scanMode === 'sales' && (
            <View style={styles.tipsBox}>
              <View style={styles.tipsHeader}>
                <Ionicons name="sparkles-outline" size={18} color={COLORS.primary} />
                <Text style={styles.tipsTitle}>{t('scan.salesTipsTitle')}</Text>
              </View>
              <View style={styles.tipRow}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.success} style={{ marginTop: 2 }} />
                <Text style={styles.tipText}>{t('scan.salesTip1')}</Text>
              </View>
              <View style={styles.tipRow}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.success} style={{ marginTop: 2 }} />
                <Text style={styles.tipText}>{t('scan.salesTip2')}</Text>
              </View>
              <Text style={styles.tipsFooter}>{t('scan.salesTipsFooter')}</Text>
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

              {isScanning ? (
                <View style={styles.scanningContainer}>
                  <ActivityIndicator size="large" color={COLORS.primary} />
                  <Text style={styles.scanningText}>{t('scan.processing')}</Text>
                </View>
              ) : (
                <View style={styles.formContainer}>
                  <Text style={styles.formTitle}>
                    {scanMode === 'sales' ? t('scan.salesFormTitle') : t('scan.invoiceDataTitle')}
                  </Text>
                  <Text style={styles.formHint}>
                    {scanMode === 'sales' ? t('scan.salesFormHint') : t('scan.editIfNeeded')}
                  </Text>

                  {/* AI Corrections Info */}
                  {ocrCorrections.length > 0 && (
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
                  )}

                  {scanMode === 'sales' ? (
                    <>
                      <View style={styles.protocolNote}>
                        <Ionicons name="information-circle" size={16} color={COLORS.primary} />
                        <Text style={styles.protocolNoteText}>{t('scan.salesNote')}</Text>
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
                    </>
                  ) : (
                    <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.supplier')} *</Text>
                    <TextInput
                      style={styles.input}
                      value={supplier}
                      onChangeText={setSupplier}
                      placeholder={t('scan.companyNamePlaceholder')}
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>

                  <View style={styles.inputGroup}>
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
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.invoiceNumber')} *</Text>
                    <TextInput
                      style={styles.input}
                      value={invoiceNumber}
                      onChangeText={setInvoiceNumber}
                      placeholder="0000000001"
                      placeholderTextColor={COLORS.textMuted}
                    />
                  </View>

                  {/* Date of Issue */}
                  <View style={styles.inputGroup}>
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
                  </View>

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

                  <View style={styles.row}>
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
                  </View>

                  <View style={styles.inputGroup}>
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
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.paymentMethod')}</Text>
                    <View style={styles.vatTreatmentGrid}>
                      {(['cash', 'bank_transfer'] as PaymentMethod[]).map((option) => (
                        <TouchableOpacity
                          key={option}
                          style={[styles.vatTreatmentChip, paymentMethod === option && styles.vatTreatmentChipActive]}
                          onPress={() => setPaymentMethod(option)}
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
                    {paymentMethod === 'cash' && (
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

                  <TouchableOpacity
                    style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
                    onPress={scanMode === 'sales' ? handleAddToRevenue : handleSaveInvoice}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <>
                        <Ionicons name="checkmark-circle" size={24} color="white" />
                        <Text style={styles.saveButtonText}>
                          {scanMode === 'sales' ? t('scan.addToRevenue') : t('scan.saveInvoice')}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
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
    padding: 20,
    marginTop: 20,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  tipsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
  },
  tipsFooter: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
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
    fontSize: 11,
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
  itemSmallInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  removeItemButton: {
    padding: 8,
  },
});

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  Pressable,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { api } from '../../src/services/api';
import { OCRResult } from '../../src/types';
import { format, parse } from 'date-fns';
import { bg, enUS } from 'date-fns/locale';
import { useTranslation, useLanguageStore } from '../../src/i18n';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function ScanScreen() {
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  const dateLocale = language === 'bg' ? bg : enUS;
  
  const [permission, requestPermission] = useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [ocrCorrections, setOcrCorrections] = useState<string[]>([]);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const cameraRef = useRef<any>(null);

  // Form fields (editable after OCR)
  const [supplier, setSupplier] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amountWithoutVat, setAmountWithoutVat] = useState('');
  const [vatAmount, setVatAmount] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date());
  const [isDatePickerVisible, setDatePickerVisible] = useState(false);

  // Tap to focus - triggers refocus
  const handleTapToFocus = useCallback(() => {
    setFocusKey(prev => prev + 1);
  }, []);

  const handleTakePhoto = async () => {
    if (cameraRef.current) {
      try {
        // Use higher quality for better OCR results
        const photo = await cameraRef.current.takePictureAsync({ 
          base64: true, 
          quality: 0.9,
          skipProcessing: false,
        });
        setCapturedImage(`data:image/jpeg;base64,${photo.base64}`);
        setShowCamera(false);
        await processImage(photo.base64);
      } catch (error) {
        console.error('Error taking photo:', error);
        Alert.alert(t('common.error'), language === 'bg' ? 'Не можах да заснема снимка' : 'Could not take photo');
      }
    }
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0].base64) {
      setCapturedImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
      await processImage(result.assets[0].base64);
    }
  };

  const processImage = async (base64: string) => {
    setIsScanning(true);
    setOcrCorrections([]);
    setOcrConfidence(null);
    try {
      const result = await api.scanInvoice(base64);
      setOcrResult(result);
      setSupplier(result.supplier);
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
      
      // Set invoice date from OCR if available
      if (result.invoice_date) {
        try {
          const parsedDate = new Date(result.invoice_date);
          if (!isNaN(parsedDate.getTime())) {
            setInvoiceDate(parsedDate);
          }
        } catch (e) {
          // Keep default date if parsing fails
        }
      }
    } catch (error: any) {
      Alert.alert(language === 'bg' ? 'Грешка при сканиране' : 'Scan error', error.message || (language === 'bg' ? 'Моля, опитайте отново' : 'Please try again'));
    } finally {
      setIsScanning(false);
    }
  };

  const handleSaveInvoice = async () => {
    if (!supplier || !invoiceNumber || !totalAmount) {
      Alert.alert(t('common.error'), t('msg.fillRequired'));
      return;
    }

    setIsSaving(true);
    try {
      await api.createInvoice({
        supplier,
        invoice_number: invoiceNumber,
        amount_without_vat: parseFloat(amountWithoutVat) || 0,
        vat_amount: parseFloat(vatAmount) || 0,
        total_amount: parseFloat(totalAmount) || 0,
        date: invoiceDate.toISOString(),
        image_base64: capturedImage || undefined,
        notes: notes || undefined,
      });
      Alert.alert(t('common.success'), t('msg.invoiceSaved'));
      resetForm();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setCapturedImage(null);
    setOcrResult(null);
    setSupplier('');
    setInvoiceNumber('');
    setAmountWithoutVat('');
    setVatAmount('');
    setTotalAmount('');
    setNotes('');
    setInvoiceDate(new Date());
  };

  const openCamera = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(t('common.error'), language === 'bg' ? 'Нужен е достъп до камерата' : 'Camera access required');
        return;
      }
    }
    setShowCamera(true);
  };

  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView 
          key={focusKey}
          style={styles.camera} 
          ref={cameraRef} 
          facing="back"
          autofocus="on"
          mode="picture"
        >
          <Pressable style={styles.cameraOverlayPressable} onPress={handleTapToFocus}>
            <SafeAreaView style={styles.cameraOverlay}>
              <TouchableOpacity style={styles.closeButton} onPress={() => setShowCamera(false)}>
                <Ionicons name="close" size={32} color="white" />
              </TouchableOpacity>
              <View style={styles.cameraFrame}>
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
              </View>
              <Text style={styles.cameraHint}>{t('scan.tapToFocus')}</Text>
              <Text style={styles.cameraHint2}>{t('scan.positionInvoice')}</Text>
              <TouchableOpacity style={styles.captureButton} onPress={handleTakePhoto}>
                <Ionicons name="camera" size={36} color="white" />
              </TouchableOpacity>
            </SafeAreaView>
          </Pressable>
        </CameraView>
      </View>
    );
  }

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
                <Text style={styles.subtitle}>{language === 'bg' ? 'Използвай OCR за автоматично извличане' : 'Use OCR for automatic extraction'}</Text>
              </View>

              {!capturedImage ? (
                <View style={styles.scanOptions}>
              <TouchableOpacity style={styles.scanButton} onPress={openCamera}>
                <View style={styles.scanIconContainer}>
                  <Ionicons name="camera" size={48} color="#8B5CF6" />
                </View>
                <Text style={styles.scanButtonText}>{t('scan.takePhoto')}</Text>
                <Text style={styles.scanButtonHint}>{language === 'bg' ? 'Използвай камерата' : 'Use the camera'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.scanButton} onPress={handlePickImage}>
                <View style={styles.scanIconContainer}>
                  <Ionicons name="image" size={48} color="#8B5CF6" />
                </View>
                <Text style={styles.scanButtonText}>{t('scan.fromGallery')}</Text>
                <Text style={styles.scanButtonHint}>{language === 'bg' ? 'От галерията' : 'From gallery'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.resultContainer}>
              {/* Preview Image */}
              <View style={styles.imagePreview}>
                <Image source={{ uri: capturedImage }} style={styles.previewImage} resizeMode="contain" />
                <TouchableOpacity style={styles.retakeButton} onPress={resetForm}>
                  <Ionicons name="refresh" size={20} color="white" />
                  <Text style={styles.retakeText}>{t('scan.newScan')}</Text>
                </TouchableOpacity>
              </View>

              {isScanning ? (
                <View style={styles.scanningContainer}>
                  <ActivityIndicator size="large" color="#8B5CF6" />
                  <Text style={styles.scanningText}>{t('scan.processing')}</Text>
                </View>
              ) : (
                <View style={styles.formContainer}>
                  <Text style={styles.formTitle}>{language === 'bg' ? 'Данни от фактурата' : 'Invoice Data'}</Text>
                  <Text style={styles.formHint}>{language === 'bg' ? 'Редактирайте при нужда' : 'Edit if needed'}</Text>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.supplier')} *</Text>
                    <TextInput
                      style={styles.input}
                      value={supplier}
                      onChangeText={setSupplier}
                      placeholder={language === 'bg' ? 'Име на фирмата' : 'Company name'}
                      placeholderTextColor="#64748B"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.invoiceNumber')} *</Text>
                    <TextInput
                      style={styles.input}
                      value={invoiceNumber}
                      onChangeText={setInvoiceNumber}
                      placeholder="0000000001"
                      placeholderTextColor="#64748B"
                    />
                  </View>

                  {/* Date of Issue */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.issueDate')} *</Text>
                    <TouchableOpacity 
                      style={styles.dateInputButton}
                      onPress={() => setDatePickerVisible(true)}
                    >
                      <Ionicons name="calendar" size={20} color="#8B5CF6" />
                      <Text style={styles.dateInputText}>
                        {format(invoiceDate, 'd MMMM yyyy', { locale: dateLocale })}
                      </Text>
                      <Ionicons name="chevron-down" size={20} color="#64748B" />
                    </TouchableOpacity>
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
                        placeholderTextColor="#64748B"
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
                        placeholderTextColor="#64748B"
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
                      placeholderTextColor="#64748B"
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>{t('scan.notes')}</Text>
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder={language === 'bg' ? 'Допълнителни бележки...' : 'Additional notes...'}
                      placeholderTextColor="#64748B"
                      multiline
                      numberOfLines={3}
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
                    onPress={handleSaveInvoice}
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
    color: '#94A3B8',
    marginTop: 4,
  },
  scanOptions: {
    flexDirection: 'row',
    gap: 16,
  },
  scanButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#334155',
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
    color: '#64748B',
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  cameraOverlayPressable: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
    padding: 20,
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 8,
  },
  cameraFrame: {
    width: '90%',
    aspectRatio: 0.7,
    alignSelf: 'center',
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#8B5CF6',
    borderRadius: 4,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },
  cameraHint: {
    color: 'white',
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  cameraHint2: {
    color: '#94A3B8',
    textAlign: 'center',
    fontSize: 14,
    marginBottom: 20,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  resultContainer: {
    flex: 1,
  },
  imagePreview: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
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
    color: '#8B5CF6',
    fontSize: 14,
    fontWeight: '500',
  },
  scanningContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
  },
  scanningText: {
    color: '#94A3B8',
    marginTop: 16,
    fontSize: 16,
  },
  formContainer: {
    backgroundColor: '#1E293B',
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
    color: '#64748B',
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  saveButton: {
    backgroundColor: '#8B5CF6',
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
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 10,
  },
  dateInputText: {
    flex: 1,
    color: 'white',
    fontSize: 16,
  },
});

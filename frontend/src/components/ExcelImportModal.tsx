import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../services/api';
import { downloadAndShareFile } from '../utils/downloadFile';
import { Alert } from '../utils/alert';
import { useTranslation } from '../i18n';
import { ImportEntity, ImportPreviewResult } from '../types';
import { ModalBlurBackdrop } from './ModalBlurBackdrop';
import { COLORS } from '../theme/colors';

interface FieldConfig {
  key: string;
  label: string;
  format?: (value: any, row: Record<string, any>) => string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  entity: ImportEntity;
  title: string;
  fields: FieldConfig[];
  onImported: () => void;
}

type Step = 'pick' | 'loading' | 'preview' | 'committing' | 'done';

const DOCUMENT_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

export default function ExcelImportModal({ visible, onClose, entity, title, fields, onImported }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('pick');
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [commitSummary, setCommitSummary] = useState<{ imported: number; failed: number } | null>(null);

  const reset = () => {
    setStep('pick');
    setPreview(null);
    setCommitSummary(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadAndShareFile(api.getImportTemplateUrl(entity), `shablon_${entity}.xlsx`);
    } catch {
      Alert.alert(t('common.error'), t('msg.downloadFailed'));
    }
  };

  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: DOCUMENT_TYPES,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];

    setStep('loading');
    try {
      const previewResult = await api.previewImport(entity, {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        file: (asset as any).file,
      });
      setPreview(previewResult);
      setStep('preview');
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
      setStep('pick');
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    const validRows = preview.rows.filter((r) => r.status === 'ok' && r.data).map((r) => r.data as Record<string, any>);
    if (validRows.length === 0) return;

    setStep('committing');
    try {
      const result = await api.commitImport(entity, validRows);
      setCommitSummary({ imported: result.imported, failed: result.failed.length });
      setStep('done');
      onImported();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
      setStep('preview');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <ModalBlurBackdrop />
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={28} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {step === 'pick' && (
              <View>
                <TouchableOpacity style={styles.actionButton} onPress={handleDownloadTemplate}>
                  <Ionicons name="download-outline" size={20} color={COLORS.primary} />
                  <Text style={styles.actionButtonText}>{t('import.downloadTemplate')}</Text>
                </TouchableOpacity>
                <Text style={styles.hint}>{t('import.downloadTemplateHint')}</Text>

                <TouchableOpacity style={[styles.actionButton, styles.primaryButton]} onPress={handlePickFile}>
                  <Ionicons name="cloud-upload-outline" size={20} color="white" />
                  <Text style={[styles.actionButtonText, styles.primaryButtonText]}>{t('import.pickFile')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {step === 'loading' && (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.hint}>{t('import.analyzing')}</Text>
              </View>
            )}

            {step === 'preview' && preview && (
              <View>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryTile}>
                    <Text style={styles.summaryNumber}>{preview.total_rows}</Text>
                    <Text style={styles.summaryLabel}>{t('import.totalRows')}</Text>
                  </View>
                  <View style={styles.summaryTile}>
                    <Text style={[styles.summaryNumber, { color: COLORS.success }]}>{preview.valid_count}</Text>
                    <Text style={styles.summaryLabel}>{t('import.validRows')}</Text>
                  </View>
                  <View style={styles.summaryTile}>
                    <Text style={[styles.summaryNumber, preview.error_count > 0 && { color: COLORS.danger }]}>
                      {preview.error_count}
                    </Text>
                    <Text style={styles.summaryLabel}>{t('import.errorRows')}</Text>
                  </View>
                </View>

                {preview.rows.map((row) => (
                  <View key={row.row_number} style={[styles.rowCard, row.status === 'error' && styles.rowCardError]}>
                    <View style={styles.rowCardHeader}>
                      <Ionicons
                        name={row.status === 'ok' ? 'checkmark-circle' : 'close-circle'}
                        size={16}
                        color={row.status === 'ok' ? COLORS.success : COLORS.danger}
                      />
                      <Text style={styles.rowCardNumber}>{t('import.row')} {row.row_number}</Text>
                    </View>
                    {row.status === 'ok' && row.data && (
                      <Text style={styles.rowCardDetail} numberOfLines={2}>
                        {fields
                          .map((f) => `${f.label}: ${f.format ? f.format(row.data![f.key], row.data!) : (row.data![f.key] ?? '-')}`)
                          .join('  ·  ')}
                      </Text>
                    )}
                    {row.errors.map((err, i) => (
                      <Text key={i} style={styles.errorText}>{err}</Text>
                    ))}
                    {row.warnings.map((w, i) => (
                      <Text key={i} style={styles.warningText}>{w}</Text>
                    ))}
                  </View>
                ))}

                {preview.valid_count > 0 ? (
                  <TouchableOpacity style={[styles.actionButton, styles.primaryButton, { marginTop: 12 }]} onPress={handleCommit}>
                    <Ionicons name="checkmark-done" size={20} color="white" />
                    <Text style={[styles.actionButtonText, styles.primaryButtonText]}>
                      {t('import.importRows').replace('{count}', String(preview.valid_count))}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.hint}>{t('import.noValidRows')}</Text>
                )}
                <TouchableOpacity style={styles.secondaryButton} onPress={reset}>
                  <Text style={styles.secondaryButtonText}>{t('import.pickDifferentFile')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {step === 'committing' && (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.hint}>{t('import.importing')}</Text>
              </View>
            )}

            {step === 'done' && commitSummary && (
              <View style={styles.centerBox}>
                <Ionicons name="checkmark-circle" size={48} color={COLORS.success} />
                <Text style={styles.doneText}>
                  {t('import.doneSummary').replace('{imported}', String(commitSummary.imported))}
                </Text>
                {commitSummary.failed > 0 && (
                  <Text style={styles.warningText}>
                    {t('import.doneFailedSummary').replace('{failed}', String(commitSummary.failed))}
                  </Text>
                )}
                <TouchableOpacity style={[styles.actionButton, styles.primaryButton, { marginTop: 16 }]} onPress={handleClose}>
                  <Text style={[styles.actionButtonText, styles.primaryButtonText]}>{t('common.close')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 20,
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
    marginRight: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 8,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
    marginTop: 16,
  },
  primaryButtonText: {
    color: 'white',
  },
  secondaryButton: {
    alignItems: 'center',
    padding: 10,
    marginTop: 4,
  },
  secondaryButtonText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 8,
    lineHeight: 17,
  },
  centerBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  summaryTile: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  rowCard: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.success,
  },
  rowCardError: {
    borderLeftColor: COLORS.danger,
  },
  rowCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  rowCardNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  rowCardDetail: {
    fontSize: 12,
    color: 'white',
  },
  errorText: {
    fontSize: 12,
    color: COLORS.danger,
    marginTop: 2,
  },
  warningText: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 2,
  },
  doneText: {
    fontSize: 15,
    color: 'white',
    textAlign: 'center',
    marginTop: 12,
  },
});

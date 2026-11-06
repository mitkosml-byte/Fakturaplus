import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '../services/api';
import { Alert } from '../utils/alert';
import { useTranslation } from '../i18n';
import { Employee, PayrollImportPreviewResponse, PayrollImportCommitEntry } from '../types';
import { ModalBlurBackdrop } from './ModalBlurBackdrop';
import { COLORS } from '../theme/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  employees: Employee[];
  onImported: () => void;
}

type Step = 'pick' | 'loading' | 'preview' | 'committing' | 'done';

export default function PayrollPdfImportModal({ visible, onClose, employees, onImported }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('pick');
  const [preview, setPreview] = useState<PayrollImportPreviewResponse | null>(null);
  // Per-row chosen employee_id, keyed by the row's index in preview.entries -
  // pre-filled with the backend's own fuzzy-match suggestion, editable here
  // before anything is actually saved.
  const [selections, setSelections] = useState<Record<number, string | null>>({});
  const [commitSummary, setCommitSummary] = useState<{ imported: number; total: number; skippedCount: number } | null>(null);

  const reset = () => {
    setStep('pick');
    setPreview(null);
    setSelections({});
    setCommitSummary(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];

    setStep('loading');
    try {
      const previewResult = await api.previewPayrollImport({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        file: (asset as any).file,
      });
      setPreview(previewResult);
      const initial: Record<number, string | null> = {};
      previewResult.entries.forEach((entry, i) => {
        initial[i] = entry.already_imported ? null : entry.matched_employee_id;
      });
      setSelections(initial);
      setStep('preview');
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
      setStep('pick');
    }
  };

  const includedCount = preview
    ? preview.entries.filter((entry, i) => !entry.already_imported && selections[i]).length
    : 0;

  const handleCommit = async () => {
    if (!preview) return;
    const entries: PayrollImportCommitEntry[] = preview.entries
      .map((entry, i) => ({ entry, employeeId: selections[i] }))
      .filter(({ entry, employeeId }) => !entry.already_imported && employeeId)
      .map(({ entry, employeeId }) => ({
        employee_id: employeeId as string,
        period_month: preview.period_month,
        period_year: preview.period_year,
        gross_amount: entry.gross_amount,
        insurance_base: entry.insurance_base,
        employee_contributions: entry.employee_contributions,
        employer_contributions: entry.employer_contributions,
        income_tax: entry.income_tax,
        other_deductions: entry.other_deductions,
        net_amount: entry.net_amount,
      }));
    if (entries.length === 0) return;

    setStep('committing');
    try {
      const result = await api.commitPayrollImport(entries);
      setCommitSummary({ imported: result.imported, total: entries.length, skippedCount: result.skipped.length });
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
            <Text style={styles.title}>{t('payroll.importPdfTitle')}</Text>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={28} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {step === 'pick' && (
              <View>
                <Text style={styles.hint}>{t('payroll.importPdfHint')}</Text>
                <TouchableOpacity style={[styles.actionButton, styles.primaryButton]} onPress={handlePickFile}>
                  <Ionicons name="document-attach-outline" size={20} color="white" />
                  <Text style={[styles.actionButtonText, styles.primaryButtonText]}>{t('payroll.importPdfPickFile')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {step === 'loading' && (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.hint}>{t('payroll.importPdfAnalyzing')}</Text>
              </View>
            )}

            {step === 'preview' && preview && (
              <View>
                <Text style={styles.periodLabel}>
                  {t('payroll.importPdfPeriod')
                    .replace('{month}', String(preview.period_month))
                    .replace('{year}', String(preview.period_year))}
                </Text>
                <Text style={styles.hint}>{t('payroll.importPdfReviewHint')}</Text>

                {preview.entries.map((entry, i) => (
                  <View key={i} style={[styles.rowCard, entry.already_imported && styles.rowCardMuted]}>
                    <View style={styles.rowHeader}>
                      <Text style={styles.rowName}>{entry.name}</Text>
                      {!!entry.egn && <Text style={styles.rowMeta}>{t('payroll.importPdfEgn')}: {entry.egn}</Text>}
                    </View>
                    {!!entry.position && <Text style={styles.rowMeta}>{entry.position}</Text>}

                    <View style={styles.amountsRow}>
                      <Text style={styles.amountText}>{t('payroll.importPdfGross')}: {entry.gross_amount.toFixed(2)} €</Text>
                      <Text style={styles.amountText}>{t('payroll.importPdfTax')}: {entry.income_tax.toFixed(2)} €</Text>
                      <Text style={[styles.amountText, styles.amountNet]}>{t('payroll.importPdfNet')}: {entry.net_amount.toFixed(2)} €</Text>
                    </View>

                    {entry.already_imported ? (
                      <Text style={styles.alreadyImportedText}>
                        <Ionicons name="alert-circle" size={13} color={COLORS.warning} /> {t('payroll.importPdfAlreadyImported')}
                      </Text>
                    ) : (
                      <View style={styles.chipRow}>
                        <TouchableOpacity
                          style={[styles.chip, !selections[i] && styles.chipActive]}
                          onPress={() => setSelections((p) => ({ ...p, [i]: null }))}
                        >
                          <Text style={[styles.chipText, !selections[i] && styles.chipTextActive]}>
                            {t('payroll.importPdfSkip')}
                          </Text>
                        </TouchableOpacity>
                        {employees.map((emp) => (
                          <TouchableOpacity
                            key={emp.id}
                            style={[styles.chip, selections[i] === emp.id && styles.chipActive]}
                            onPress={() => setSelections((p) => ({ ...p, [i]: emp.id }))}
                          >
                            <Text style={[styles.chipText, selections[i] === emp.id && styles.chipTextActive]}>
                              {emp.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ))}

                {includedCount > 0 ? (
                  <TouchableOpacity style={[styles.actionButton, styles.primaryButton, { marginTop: 12 }]} onPress={handleCommit}>
                    <Ionicons name="checkmark-done" size={20} color="white" />
                    <Text style={[styles.actionButtonText, styles.primaryButtonText]}>
                      {t('payroll.importPdfCommit').replace('{count}', String(includedCount))}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.hint}>{t('payroll.importPdfNoneSelected')}</Text>
                )}
                <TouchableOpacity style={styles.secondaryButton} onPress={reset}>
                  <Text style={styles.secondaryButtonText}>{t('payroll.importPdfPickDifferent')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {step === 'committing' && (
              <View style={styles.centerBox}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.hint}>{t('payroll.importPdfCommitting')}</Text>
              </View>
            )}

            {step === 'done' && commitSummary && (
              <View style={styles.centerBox}>
                <Ionicons name="checkmark-circle" size={48} color={COLORS.success} />
                <Text style={styles.doneText}>
                  {t('payroll.importPdfDone')
                    .replace('{imported}', String(commitSummary.imported))
                    .replace('{total}', String(commitSummary.total))}
                </Text>
                {commitSummary.skippedCount > 0 && (
                  <Text style={styles.warningText}>
                    {t('payroll.importPdfSkippedCount').replace('{count}', String(commitSummary.skippedCount))}
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
    maxWidth: 480,
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
  periodLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: 'white',
    marginBottom: 4,
  },
  rowCard: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  rowCardMuted: {
    borderLeftColor: COLORS.textMuted,
    opacity: 0.7,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  rowMeta: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  amountsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
    marginBottom: 6,
  },
  amountText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  amountNet: {
    color: COLORS.success,
    fontWeight: '600',
  },
  alreadyImportedText: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  chipTextActive: {
    color: 'white',
    fontWeight: '600',
  },
  warningText: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 2,
    textAlign: 'center',
  },
  doneText: {
    fontSize: 15,
    color: 'white',
    textAlign: 'center',
    marginTop: 12,
  },
});

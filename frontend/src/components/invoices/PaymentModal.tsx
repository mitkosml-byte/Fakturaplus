import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { Invoice } from '../../types';
import { COLORS } from '../../theme/colors';

// Extracted from invoices.tsx (Module 1 audit finding #4). Edit-in-place,
// same convention as the daily-revenue form: the field shows what's
// already paid, and saving REPLACES that value rather than adding to it.
type Props = {
  visible: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  amountInput: string;
  onChangeAmountInput: (value: string) => void;
  onSave: () => void;
  saving: boolean;
};

export function PaymentModal({ visible, onClose, invoice, amountInput, onChangeAmountInput, onSave, saving }: Props) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {invoice && invoice.paid_amount > 0 ? t('invoices.editPayment') : t('invoices.recordPayment')}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {invoice && (
            <>
              <View style={styles.editNoticeBanner}>
                <Ionicons name="information-circle" size={18} color={COLORS.primary} />
                <Text style={styles.editNoticeText}>{t('invoices.paidAmountEditNotice')}</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('invoices.paidAmountLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={amountInput}
                  onChangeText={onChangeAmountInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={COLORS.textMuted}
                  autoFocus
                />
                <Text style={styles.inputHint}>
                  {t('invoices.totalAmount')}: {invoice.total_amount.toFixed(2)} €
                </Text>
              </View>

              <TouchableOpacity style={styles.submitButton} onPress={onSave} disabled={saving}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={styles.submitButtonText}>{t('common.save')}</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
});

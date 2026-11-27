import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns/format';
import { useTranslation, useLanguageStore } from '../../i18n';
import { Invoice } from '../../types';
import { COLORS } from '../../theme/colors';
import DateTimePickerModal from '../AppDateTimePicker';
import { formatAmount } from '../../utils/money';

export type PaymentMethodChoice = 'bank_transfer' | 'cash' | 'card';

// A payment to the supplier: its amount (what is left, to start with), its
// own day and how it was paid - added to the invoice's payment history,
// as with what customers pay.
type Props = {
  visible: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  amountInput: string;
  onChangeAmountInput: (value: string) => void;
  date: Date;
  onChangeDate: (date: Date) => void;
  method: PaymentMethodChoice;
  onChangeMethod: (method: PaymentMethodChoice) => void;
  onSave: () => void;
  saving: boolean;
};

export function PaymentModal({
  visible, onClose, invoice, amountInput, onChangeAmountInput, date, onChangeDate, method, onChangeMethod, onSave, saving,
}: Props) {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const [pickingDate, setPickingDate] = useState(false);
  const left = invoice ? Math.max(invoice.total_amount - invoice.paid_amount - (invoice.credited_amount || 0), 0) : 0;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('invoices.recordPayment')}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={28} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>

          {invoice && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('receivables.paymentAmount')} (€)</Text>
                <TextInput
                  style={styles.input}
                  value={amountInput}
                  onChangeText={onChangeAmountInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={COLORS.textMuted}
                  autoFocus
                />
                <Text style={styles.inputHint}>{t('receivables.leftToPay').replace('{left}', formatAmount(left))}</Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('receivables.paymentDate')}</Text>
                <TouchableOpacity style={styles.input} onPress={() => setPickingDate(true)}>
                  <Text style={{ color: 'white', fontSize: 16 }}>{format(date, 'd MMMM yyyy', { locale: dateLocale })}</Text>
                </TouchableOpacity>
                <DateTimePickerModal
                  isVisible={pickingDate}
                  mode="date"
                  date={date}
                  maximumDate={new Date()}
                  onConfirm={(d: Date) => { onChangeDate(d); setPickingDate(false); }}
                  onCancel={() => setPickingDate(false)}
                  locale={language}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('scan.paymentMethod')}</Text>
                <View style={styles.methodRow}>
                  {(['bank_transfer', 'cash', 'card'] as const).map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.methodChip, method === m && styles.methodChipActive]}
                      onPress={() => onChangeMethod(m)}
                    >
                      <Text style={[styles.methodChipText, method === m && styles.methodChipTextActive]}>
                        {t(`scan.paymentMethod.${m}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
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
  methodRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  methodChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  methodChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  methodChipText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  methodChipTextActive: {
    color: 'white',
    fontWeight: '600',
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

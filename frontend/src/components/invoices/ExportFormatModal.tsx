import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';

// Extracted from invoices.tsx (Module 1 audit finding #4). Pure
// presentation - the export itself runs in invoices.tsx.
type Props = {
  visible: boolean;
  onClose: () => void;
  onExport: (format: 'excel' | 'pdf') => void;
};

export function ExportFormatModal({ visible, onClose, onExport }: Props) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>{t('invoices.exportTitle')}</Text>

          <TouchableOpacity style={styles.exportOption} onPress={() => onExport('excel')}>
            <View style={[styles.exportIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="document" size={24} color={COLORS.success} />
            </View>
            <View>
              <Text style={styles.exportOptionTitle}>{t('invoices.excelTitle')}</Text>
              <Text style={styles.exportOptionHint}>{t('invoices.excelHint')}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.exportOption} onPress={() => onExport('pdf')}>
            <View style={[styles.exportIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons name="document-text" size={24} color={COLORS.danger} />
            </View>
            <View>
              <Text style={styles.exportOptionTitle}>PDF</Text>
              <Text style={styles.exportOptionHint}>{t('invoices.pdfHint')}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
  },
  exportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    marginBottom: 12,
    gap: 16,
  },
  exportIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exportOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  exportOptionHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    color: COLORS.textSecondary,
    fontSize: 16,
  },
});

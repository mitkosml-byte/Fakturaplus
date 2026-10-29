import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';

// Extracted from stats.tsx's renderCompareModal (Module 1 audit finding
// #4). Pure presentation - compareResult is still fetched/held in
// stats.tsx.
const CHART_COLORS: string[] = [
  COLORS.primary, COLORS.success, COLORS.warning, COLORS.danger, COLORS.info,
  COLORS.pink, COLORS.teal, COLORS.orange, COLORS.indigo, COLORS.lime,
];

type Props = {
  visible: boolean;
  onClose: () => void;
  loadingCompare: boolean;
  compareResult: any;
};

export function SupplierCompareModal({ visible, onClose, loadingCompare, compareResult }: Props) {
  const { t } = useTranslation();
  const maxAmount = compareResult?.suppliers?.length
    ? Math.max(...compareResult.suppliers.map((s: any) => s.total_amount), 1)
    : 1;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={1}>{t('stats.compareTitle')}</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={28} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>

        {loadingCompare ? (
          <View style={styles.modalLoading}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : compareResult?.suppliers?.length ? (
          <ScrollView style={{ flex: 1, padding: 16 }}>
            {compareResult.suppliers.map((s: any, idx: number) => (
              <View key={s.supplier} style={styles.compareCard}>
                <Text style={styles.compareSupplierName} numberOfLines={1}>{s.supplier}</Text>

                <View style={styles.compareBarRow}>
                  <Text style={styles.compareBarLabel}>{t('stats.compareTotalAmount')}</Text>
                  <Text style={styles.compareBarValue}>{s.total_amount.toFixed(2)} €</Text>
                </View>
                <View style={styles.compareBarTrack}>
                  <View style={[styles.compareBarFill, { width: `${(s.total_amount / maxAmount) * 100}%`, backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }]} />
                </View>

                <View style={styles.compareStatsRow}>
                  <View style={styles.compareStatItem}>
                    <Text style={styles.compareStatLabel}>{t('stats.compareInvoiceCount')}</Text>
                    <Text style={styles.compareStatValue}>{s.invoice_count}</Text>
                  </View>
                  <View style={styles.compareStatItem}>
                    <Text style={styles.compareStatLabel}>{t('stats.compareAvgInvoice')}</Text>
                    <Text style={styles.compareStatValue}>{s.avg_invoice.toFixed(2)} €</Text>
                  </View>
                </View>
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          <View style={styles.modalLoading}>
            <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.noDataText}>{t('stats.noData')}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
    textAlign: 'center',
  },
  modalLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  compareCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  compareSupplierName: {
    fontSize: 15,
    fontWeight: '700',
    color: 'white',
    marginBottom: 10,
  },
  compareBarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  compareBarLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  compareBarValue: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
  },
  compareBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.background,
    overflow: 'hidden',
    marginBottom: 12,
  },
  compareBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  compareStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  compareStatItem: {
    alignItems: 'center',
  },
  compareStatLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginBottom: 2,
  },
  compareStatValue: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
});

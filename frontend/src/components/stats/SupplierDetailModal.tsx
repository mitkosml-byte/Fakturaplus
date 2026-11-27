import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BarChart } from 'react-native-gifted-charts';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import { formatAmount, formatMoney } from '../../utils/money';
import { SupplierDetailedResponse, SupplierGroupBy } from '../../types';

// One supplier in detail: its overview, its purchases by day, week, month
// or year, unusual invoices and the latest ones. Moved out of stats.tsx
// (the large files split step by step); the detail is still loaded and
// held there - this only shows it.

// How a supplier's purchases can be read - by day, week, month or year.
const SUPPLIER_GROUPS: { key: SupplierGroupBy; labelKey: string }[] = [
  { key: 'day', labelKey: 'stats.groupDay' },
  { key: 'week', labelKey: 'stats.groupWeek' },
  { key: 'month', labelKey: 'stats.groupMonth' },
  { key: 'year', labelKey: 'stats.groupYear' },
];
// Bars wide enough for each granularity's label (DD.MM, MM.YYYY, YYYY).
const SERIES_BAR_WIDTH: Record<SupplierGroupBy, number> = { day: 22, week: 26, month: 34, year: 34 };

type Props = {
  /** The supplier shown; none closes the window. */
  supplier: string | null;
  detail: SupplierDetailedResponse | null;
  loading: boolean;
  reportScope: 'period' | 'all';
  groupBy: SupplierGroupBy;
  onGroupBy: (group: SupplierGroupBy) => void;
  chartWidth: number;
  onClose: () => void;
};

export function SupplierDetailModal({ supplier, detail, loading, reportScope, groupBy, onGroupBy, chartWidth, onClose }: Props) {
  const { t, dateLocale } = useTranslation();

  // A supplier's purchases by day, week, month or year: every period is
  // there (zero when nothing was bought), and one cut by the chosen
  // range's ends or still running is drawn lighter - it is not a whole one.
  const supplierSeries = detail?.series ?? [];
  // Month on month (or year on year) says something; deliveries come in
  // lumps, so day on day or week on week is mostly noise.
  const seriesHasGrowth = detail?.group_by === 'month' || detail?.group_by === 'year';
  const lastSeriesGrowth = seriesHasGrowth
    ? [...supplierSeries].reverse().find((point) => point.growth_percent !== null) ?? null
    : null;
  const formatRange = (range?: { start_date: string; end_date: string } | null) =>
    range ? `${format(parseISO(range.start_date), 'd MMM yyyy', { locale: dateLocale })} – ${format(parseISO(range.end_date), 'd MMM yyyy', { locale: dateLocale })}` : '';

  return (
    <Modal
      visible={!!supplier}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={onClose}
          >
            <Ionicons name="close" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.modalTitle} numberOfLines={1}>{supplier}</Text>
          <View style={{ width: 40 }} />
        </View>

        {loading && !detail ? (
          <View style={styles.modalLoading}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : detail?.found ? (
          <ScrollView style={styles.modalContent}>
            {/* Overview Card */}
            <View style={styles.detailCard}>
              <Text style={styles.detailCardTitle}>{t('stats.supplierOverview')}</Text>
              <Text style={styles.detailPeriodText}>
                {reportScope === 'period' ? formatRange(detail.period) : t('stats.allTime')}
              </Text>
              <View style={styles.detailGrid}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{formatMoney(detail.overview?.total_amount)}</Text>
                  <Text style={styles.detailLabel}>{t('stats.totalAmount')}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{detail.overview?.invoice_count}</Text>
                  <Text style={styles.detailLabel}>{t('stats.invoiceCount')}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{formatMoney(detail.overview?.avg_invoice)}</Text>
                  <Text style={styles.detailLabel}>{t('stats.avgInvoice')}</Text>
                </View>
                <View style={styles.detailItem}>
                  <Text style={styles.detailValue}>{formatMoney(detail.overview?.total_vat)}</Text>
                  <Text style={styles.detailLabel}>{t('stats.vat')}</Text>
                </View>
              </View>
              {(detail.overview?.credit_note_count || 0) > 0 && (
                <Text style={styles.detailNote}>
                  {t('stats.creditNotesLine')
                    .replace('{count}', String(detail.overview?.credit_note_count || 0))
                    .replace('{amount}', formatAmount((detail.overview?.credit_note_total || 0)))}
                </Text>
              )}
              {(detail.overview?.assets_total || 0) > 0 && (
                <Text style={styles.detailNote}>
                  {t('stats.assetsIncluded').replace('{amount}', formatAmount((detail.overview?.assets_total || 0)))}
                </Text>
              )}
              
              <View style={styles.detailDates}>
                <View style={styles.detailDateItem}>
                  <Ionicons name="calendar-outline" size={16} color={COLORS.textMuted} />
                  <Text style={styles.detailDateLabel}>{t('stats.firstDelivery')}: </Text>
                  <Text style={styles.detailDateValue}>{detail.overview?.first_delivery || t('stats.noValue')}</Text>
                </View>
                <View style={styles.detailDateItem}>
                  <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
                  <Text style={styles.detailDateLabel}>{t('stats.lastDelivery')}: </Text>
                  <Text style={styles.detailDateValue}>{detail.overview?.last_delivery || t('stats.noValue')}</Text>
                </View>
              </View>
              
              <View style={[
                styles.statusBadge, 
                { backgroundColor: detail.overview?.is_active ? '#10B98120' : '#EF444420' }
              ]}>
                <Ionicons 
                  name={detail.overview?.is_active ? "checkmark-circle" : "alert-circle"} 
                  size={16} 
                  color={detail.overview?.is_active ? COLORS.success : COLORS.danger} 
                />
                <Text style={[
                  styles.statusText, 
                  { color: detail.overview?.is_active ? COLORS.success : COLORS.danger }
                ]}>
                  {detail.overview?.is_active ? t('stats.activeSupplier') : `${t('stats.inactiveSupplier')} (${detail.overview?.days_inactive} ${t('stats.days')})`}
                </Text>
              </View>
            </View>

            {/* Purchases by day / week / month / year */}
            <View style={styles.detailCard}>
              <Text style={styles.detailCardTitle}>{t('stats.supplierSeriesTitle')}</Text>
              <View style={[styles.unitChipsRow, { marginTop: 0, marginBottom: 12 }]}>
                {SUPPLIER_GROUPS.map((group) => (
                  <TouchableOpacity
                    key={group.key}
                    style={[styles.unitChip, groupBy === group.key && styles.unitChipActive]}
                    onPress={() => onGroupBy(group.key)}
                  >
                    <Text style={[styles.unitChipText, groupBy === group.key && styles.unitChipTextActive]}>
                      {t(group.labelKey)}
                    </Text>
                  </TouchableOpacity>
                ))}
                {loading && <ActivityIndicator size="small" color={COLORS.primary} />}
              </View>
              {supplierSeries.length > 0 ? (() => {
                const group = detail.group_by ?? groupBy;
                const barWidth = SERIES_BAR_WIDTH[group];
                const spacing = 10;
                return (
                  <BarChart
                    key={`series-${group}-${supplierSeries.map((point) => point.amount).join('_')}`}
                    data={supplierSeries.map((point) => ({
                      value: point.amount,
                      label: point.label,
                      frontColor: point.is_partial ? COLORS.primary + '55' : COLORS.primary,
                    }))}
                    width={chartWidth - 54}
                    height={160}
                    barWidth={barWidth}
                    spacing={spacing}
                    initialSpacing={spacing}
                    endSpacing={spacing}
                    labelWidth={barWidth + spacing}
                    noOfSections={4}
                    barBorderRadius={4}
                    yAxisColor={COLORS.border}
                    xAxisColor={COLORS.border}
                    yAxisTextStyle={{ color: COLORS.textMuted, fontSize: 10 }}
                    xAxisLabelTextStyle={{ color: COLORS.textMuted, fontSize: 9 }}
                    yAxisLabelWidth={34}
                    hideRules
                    isAnimated
                  />
                );
              })() : (
                <Text style={styles.noDataText}>{t('stats.noData')}</Text>
              )}
              {supplierSeries.some((point) => point.is_partial) && (
                <View style={styles.seriesLegendRow}>
                  <View style={styles.seriesLegendSwatch} />
                  <Text style={styles.seriesNote}>{t('stats.partialBucket')}</Text>
                </View>
              )}
              {lastSeriesGrowth && lastSeriesGrowth.growth_percent !== null && (
                <Text style={styles.seriesNote}>
                  {t('stats.seriesLastGrowth')
                    .replace('{label}', lastSeriesGrowth.label)
                    .replace('{growth}', `${lastSeriesGrowth.growth_percent > 0 ? '+' : ''}${lastSeriesGrowth.growth_percent}`)}
                </Text>
              )}
            </View>

            {/* Anomalies */}
            {detail.anomalies && detail.anomalies.length > 0 && (
              <View style={styles.detailCard}>
                <View style={styles.anomalyHeader}>
                  <Ionicons name="warning" size={20} color={COLORS.warning} />
                  <Text style={styles.detailCardTitle}>{t('stats.anomalies')}</Text>
                </View>
                {detail.anomalies.map((anomaly, index) => (
                  <View key={index} style={styles.anomalyItem}>
                    <View>
                      <Text style={styles.anomalyInvoice}>№{anomaly.invoice_number}</Text>
                      <Text style={styles.anomalyDate}>{anomaly.date}</Text>
                    </View>
                    <View style={styles.anomalyAmount}>
                      <Text style={styles.anomalyValue}>{formatMoney(anomaly.amount)}</Text>
                      <Text style={styles.anomalyDeviation}>+{anomaly.deviation_percent}%</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Recent Invoices */}
            {detail.recent_invoices && detail.recent_invoices.length > 0 && (
              <View style={styles.detailCard}>
                <Text style={styles.detailCardTitle}>{t('stats.recentInvoices')}</Text>
                {detail.recent_invoices.map((invoice, index) => (
                  <View key={index} style={styles.recentInvoiceItem}>
                    <View>
                      <View style={styles.recentInvoiceTitleRow}>
                        <Text style={styles.recentInvoiceNumber}>№{invoice.invoice_number}</Text>
                        {invoice.document_type === 'credit_note' && (
                          <Text style={styles.recentInvoiceBadge}>{t('stats.badgeCreditNote')}</Text>
                        )}
                        {invoice.is_asset && (
                          <Text style={styles.recentInvoiceBadge}>{t('stats.badgeAsset')}</Text>
                        )}
                      </View>
                      <Text style={styles.recentInvoiceDate}>{invoice.date}</Text>
                    </View>
                    <Text style={[
                      styles.recentInvoiceAmount,
                      invoice.document_type === 'credit_note' && { color: COLORS.danger },
                    ]}>{formatMoney(invoice.total_amount)}</Text>
                  </View>
                ))}
              </View>
            )}
            
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          <View style={styles.modalLoading}>
            <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.noDataText}>{t('stats.noSupplierData')}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  detailPeriodText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: -6,
    marginBottom: 10,
  },
  detailNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 8,
  },
  seriesLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  seriesLegendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: COLORS.primary + '55',
  },
  seriesNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 6,
  },
  noDataText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  // Modal Styles
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
  modalCloseButton: {
    padding: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
    textAlign: 'center',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  modalLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Detail Card
  detailCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  detailCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 16,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  detailItem: {
    width: '47%',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  detailValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  detailLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  detailDates: {
    marginTop: 16,
  },
  detailDateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  detailDateLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  detailDateValue: {
    fontSize: 12,
    color: 'white',
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Anomaly
  anomalyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  anomalyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  anomalyInvoice: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  anomalyDate: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  anomalyAmount: {
    alignItems: 'flex-end',
  },
  anomalyValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.warning,
  },
  anomalyDeviation: {
    fontSize: 12,
    color: COLORS.danger,
    fontWeight: 'bold',
  },
  // Recent Invoices
  recentInvoiceItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  recentInvoiceNumber: {
    fontSize: 14,
    fontWeight: '500',
    color: 'white',
  },
  recentInvoiceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recentInvoiceBadge: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textMuted,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  recentInvoiceDate: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  recentInvoiceAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.success,
  },
  // Quantity ranking per unit
  unitChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  unitChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  unitChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  unitChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  unitChipTextActive: {
    color: 'white',
  },
});

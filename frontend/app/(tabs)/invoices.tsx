import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Modal,
  Linking,
  Platform,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { Alert } from '../../src/utils/alert';
import { api } from '../../src/services/api';
import { Invoice } from '../../src/types';
import { validateEikFormat } from '../../src/utils/eik';
import { format } from 'date-fns';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTranslation, useLanguageStore } from '../../src/i18n';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

type PeriodPreset = 'all' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear' | 'custom';

function getPeriodRange(
  preset: PeriodPreset,
  customStart: Date,
  customEnd: Date
): { start?: string; end?: string } {
  const now = new Date();
  switch (preset) {
    case 'thisMonth':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        end: now.toISOString(),
      };
    case 'lastMonth':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString(),
      };
    case 'last3Months':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString(),
        end: now.toISOString(),
      };
    case 'thisYear':
      return {
        start: new Date(now.getFullYear(), 0, 1).toISOString(),
        end: now.toISOString(),
      };
    case 'custom':
      return { start: customStart.toISOString(), end: customEnd.toISOString() };
    default:
      return {};
  }
}

export default function InvoicesScreen() {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [customStartDate, setCustomStartDate] = useState<Date>(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [customEndDate, setCustomEndDate] = useState<Date>(new Date());
  const [startPickerVisible, setStartPickerVisible] = useState(false);
  const [endPickerVisible, setEndPickerVisible] = useState(false);
  const [showOnlyEikIssues, setShowOnlyEikIssues] = useState(false);

  // Reverse-charge suppliers are foreign and don't have a Bulgarian ЕИК,
  // so they're excluded from this check on purpose.
  const hasEikIssue = useCallback((inv: Invoice) => {
    if (inv.vat_treatment === 'reverse_charge') return false;
    return !validateEikFormat(inv.supplier_eik).valid;
  }, []);

  const periodOptions: { key: PeriodPreset; label: string }[] = [
    { key: 'all', label: t('invoices.periodAll') },
    { key: 'thisMonth', label: t('invoices.periodThisMonth') },
    { key: 'lastMonth', label: t('invoices.periodLastMonth') },
    { key: 'last3Months', label: t('invoices.periodLast3Months') },
    { key: 'thisYear', label: t('invoices.periodThisYear') },
    { key: 'custom', label: t('invoices.periodCustom') },
  ];

  const loadInvoices = useCallback(async () => {
    try {
      const { start, end } = getPeriodRange(periodPreset, customStartDate, customEndDate);
      const data = await api.getInvoices({
        ...(searchQuery ? { supplier: searchQuery } : {}),
        ...(start ? { start_date: start } : {}),
        ...(end ? { end_date: end } : {}),
      });
      setInvoices(data);
    } catch (error) {
      console.error('Error loading invoices:', error);
    }
  }, [searchQuery, periodPreset, customStartDate, customEndDate]);

  // Tab screens stay mounted, so returning here (e.g. after scanning and
  // saving a new invoice) doesn't remount the screen - only re-fetching on
  // focus picks up the change without needing a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      loadInvoices();
    }, [loadInvoices])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadInvoices();
    setRefreshing(false);
  }, [loadInvoices]);

  const handleDeleteInvoice = async (id: string) => {
    Alert.alert(
      t('invoices.delete'),
      t('invoices.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteInvoice(id);
              loadInvoices();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            }
          },
        },
      ]
    );
  };

  const handleExport = async (type: 'excel' | 'pdf') => {
    try {
      const url = type === 'excel' 
        ? api.getExportExcelUrl()
        : api.getExportPdfUrl();
      
      if (Platform.OS === 'web') {
        window.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
      setExportModalVisible(false);
    } catch (error: any) {
      Alert.alert(t('common.error'), language === 'bg' ? 'Не можах да изтегля файла' : 'Could not download file');
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'd MMM yyyy', { locale: dateLocale });
    } catch {
      return dateStr;
    }
  };

  const renderInvoice = ({ item }: { item: Invoice }) => (
    <TouchableOpacity
      style={styles.invoiceCard}
      onPress={() => setSelectedInvoice(item)}
      onLongPress={() => handleDeleteInvoice(item.id)}
    >
      <View style={styles.invoiceHeader}>
        <View style={styles.supplierContainer}>
          <Ionicons name="business" size={20} color="#8B5CF6" />
          <Text style={styles.supplierName} numberOfLines={1}>{item.supplier}</Text>
        </View>
        <Text style={styles.invoiceDate}>{formatDate(item.date)}</Text>
      </View>

      {hasEikIssue(item) && (
        <View style={styles.eikWarningBadge}>
          <Ionicons name="alert-circle" size={13} color="#F59E0B" />
          <Text style={styles.eikWarningBadgeText}>{t('invoices.missingEik')}</Text>
        </View>
      )}

      <View style={styles.invoiceDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t('invoices.invoiceNo')}:</Text>
          <Text style={styles.detailValue}>{item.invoice_number}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t('invoices.withoutVAT')}:</Text>
          <Text style={styles.detailValue}>{item.amount_without_vat.toFixed(2)} €</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>{t('stats.vat')}:</Text>
          <Text style={styles.detailValue}>{item.vat_amount.toFixed(2)} €</Text>
        </View>
      </View>

      <View style={styles.invoiceFooter}>
        <Text style={styles.totalLabel}>{t('invoices.total')}:</Text>
        <Text style={styles.totalValue}>{item.total_amount.toFixed(2)} €</Text>
      </View>
    </TouchableOpacity>
  );

  const eikIssueCount = useMemo(() => invoices.filter(hasEikIssue).length, [invoices, hasEikIssue]);
  const visibleInvoices = useMemo(
    () => (showOnlyEikIssues ? invoices.filter(hasEikIssue) : invoices),
    [invoices, showOnlyEikIssues, hasEikIssue]
  );

  const totalAmount = visibleInvoices.reduce((sum, inv) => sum + inv.total_amount, 0);
  const totalVat = visibleInvoices.reduce((sum, inv) => sum + inv.vat_amount, 0);

  const sections = useMemo(() => {
    const groups = new Map<string, { title: string; data: Invoice[]; totalAmount: number; totalVat: number }>();
    for (const inv of visibleInvoices) {
      let key: string;
      let title: string;
      try {
        const d = new Date(inv.date);
        key = format(d, 'yyyy-MM');
        title = format(d, 'LLLL yyyy', { locale: dateLocale });
        title = title.charAt(0).toUpperCase() + title.slice(1);
      } catch {
        key = 'unknown';
        title = inv.date;
      }
      if (!groups.has(key)) {
        groups.set(key, { title, data: [], totalAmount: 0, totalVat: 0 });
      }
      const group = groups.get(key)!;
      group.data.push(inv);
      group.totalAmount += inv.total_amount;
      group.totalVat += inv.vat_amount;
    }
    return Array.from(groups.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, group]) => ({ key, ...group }));
  }, [visibleInvoices, dateLocale]);

  const renderSectionHeader = ({ section }: { section: { title: string; data: Invoice[]; totalAmount: number } }) => (
    <View style={styles.monthHeader}>
      <Text style={styles.monthHeaderTitle}>{section.title}</Text>
      <Text style={styles.monthHeaderStats}>
        {section.data.length} · {t('invoices.monthlyTotal')} {section.totalAmount.toFixed(2)} €
      </Text>
    </View>
  );

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('invoices.title')}</Text>
            <TouchableOpacity style={styles.exportButton} onPress={() => setExportModalVisible(true)}>
              <Ionicons name="download" size={24} color="#8B5CF6" />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color="#64748B" />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={t('invoices.searchPlaceholder')}
              placeholderTextColor="#64748B"
              onSubmitEditing={loadInvoices}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); loadInvoices(); }}>
                <Ionicons name="close-circle" size={20} color="#64748B" />
              </TouchableOpacity>
            )}
          </View>

          {/* Period filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.periodChipsRow}
            contentContainerStyle={styles.periodChipsContent}
          >
            {periodOptions.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.periodChip, periodPreset === opt.key && styles.periodChipActive]}
                onPress={() => setPeriodPreset(opt.key)}
              >
                <Text style={[styles.periodChipText, periodPreset === opt.key && styles.periodChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {periodPreset === 'custom' && (
            <View style={styles.customRangeRow}>
              <TouchableOpacity style={styles.customRangeButton} onPress={() => setStartPickerVisible(true)}>
                <Ionicons name="calendar-outline" size={16} color="#8B5CF6" />
                <Text style={styles.customRangeButtonText}>
                  {t('invoices.periodFrom')}: {format(customStartDate, 'd MMM yyyy', { locale: dateLocale })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.customRangeButton} onPress={() => setEndPickerVisible(true)}>
                <Ionicons name="calendar-outline" size={16} color="#8B5CF6" />
                <Text style={styles.customRangeButtonText}>
                  {t('invoices.periodTo')}: {format(customEndDate, 'd MMM yyyy', { locale: dateLocale })}
                </Text>
              </TouchableOpacity>
              <DateTimePickerModal
                isVisible={startPickerVisible}
                mode="date"
                date={customStartDate}
                onConfirm={(d) => { setCustomStartDate(d); setStartPickerVisible(false); }}
                onCancel={() => setStartPickerVisible(false)}
              />
              <DateTimePickerModal
                isVisible={endPickerVisible}
                mode="date"
                date={customEndDate}
                onConfirm={(d) => { setCustomEndDate(d); setEndPickerVisible(false); }}
                onCancel={() => setEndPickerVisible(false)}
              />
            </View>
          )}

          {/* ЕИК issues banner */}
          {eikIssueCount > 0 && (
            <TouchableOpacity
              style={[styles.eikBanner, showOnlyEikIssues && styles.eikBannerActive]}
              onPress={() => setShowOnlyEikIssues((prev) => !prev)}
            >
              <Ionicons name="alert-circle" size={18} color="#F59E0B" />
              <Text style={styles.eikBannerText}>
                {eikIssueCount} {eikIssueCount === 1 ? t('invoices.missingEikSingular') : t('invoices.missingEikPlural')}
              </Text>
              <Text style={styles.eikBannerAction}>
                {showOnlyEikIssues ? t('invoices.showAll') : t('invoices.showOnlyThese')}
              </Text>
            </TouchableOpacity>
          )}

          {/* Summary */}
          <View style={styles.summaryBar}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('invoices.count')}:</Text>
              <Text style={styles.summaryValue}>{visibleInvoices.length}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('stats.vat')}:</Text>
              <Text style={styles.summaryValue}>{totalVat.toFixed(2)} €</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>{t('invoices.total')}:</Text>
              <Text style={[styles.summaryValue, { color: '#8B5CF6' }]}>{totalAmount.toFixed(2)} €</Text>
            </View>
          </View>

          {/* List */}
          <SectionList
            sections={sections}
            renderItem={renderInvoice}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="document-text-outline" size={64} color="#334155" />
                <Text style={styles.emptyText}>{t('invoices.noInvoices')}</Text>
                <Text style={styles.emptyHint}>{t('invoices.scanFirst')}</Text>
              </View>
            }
          />

          {/* Export Modal */}
      <Modal visible={exportModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('invoices.exportTitle')}</Text>

            <TouchableOpacity style={styles.exportOption} onPress={() => handleExport('excel')}>
              <View style={[styles.exportIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Ionicons name="document" size={24} color="#10B981" />
              </View>
              <View>
                <Text style={styles.exportOptionTitle}>{t('invoices.excelTitle')}</Text>
                <Text style={styles.exportOptionHint}>{t('invoices.excelHint')}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.exportOption} onPress={() => handleExport('pdf')}>
              <View style={[styles.exportIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Ionicons name="document-text" size={24} color="#EF4444" />
              </View>
              <View>
                <Text style={styles.exportOptionTitle}>PDF</Text>
                <Text style={styles.exportOptionHint}>{t('invoices.pdfHint')}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={() => setExportModalVisible(false)}>
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Invoice Detail Modal */}
      <Modal visible={!!selectedInvoice} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.detailModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('invoices.details')}</Text>
              <TouchableOpacity onPress={() => setSelectedInvoice(null)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedInvoice && (
              <View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.supplier')}</Text>
                  <Text style={styles.detailSectionValue}>{selectedInvoice.supplier}</Text>
                </View>
                {selectedInvoice.supplier_eik && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('scan.supplierEik')}</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.supplier_eik}</Text>
                  </View>
                )}
                {selectedInvoice.vat_treatment && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('scan.vatTreatment')}</Text>
                    <Text style={styles.detailSectionValue}>{t(`vat.${selectedInvoice.vat_treatment}`)}</Text>
                  </View>
                )}
                {selectedInvoice.vat_treatment === 'reverse_charge' && (() => {
                  const deadline = new Date(new Date(selectedInvoice.date).getTime() + 15 * 24 * 60 * 60 * 1000);
                  const overdue = deadline.getTime() < Date.now();
                  return (
                    <View style={[styles.protocolBanner, overdue && styles.protocolBannerOverdue]}>
                      <Ionicons name={overdue ? 'alert-circle' : 'document-text'} size={18} color={overdue ? '#EF4444' : '#8B5CF6'} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.protocolBannerTitle}>
                          {t('scan.protocolAssigned')} {selectedInvoice.protocol_number || '—'}
                        </Text>
                        <Text style={[styles.protocolBannerDeadline, overdue && { color: '#EF4444' }]}>
                          {t('invoices.protocolDeadline')}: {formatDate(deadline.toISOString())}
                          {overdue ? ` (${t('invoices.protocolOverdue')})` : ''}
                        </Text>
                      </View>
                    </View>
                  );
                })()}
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.invoiceNo')}</Text>
                  <Text style={styles.detailSectionValue}>{selectedInvoice.invoice_number}</Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>{t('invoices.dateLabel')}</Text>
                  <Text style={styles.detailSectionValue}>{formatDate(selectedInvoice.date)}</Text>
                </View>
                <View style={styles.detailRow2}>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('invoices.withoutVAT')}</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.amount_without_vat.toFixed(2)} €</Text>
                  </View>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('invoices.vatPercent')}</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.vat_amount.toFixed(2)} €</Text>
                  </View>
                </View>
                <View style={styles.totalSection}>
                  <Text style={styles.totalSectionLabel}>{t('invoices.totalAmount')}</Text>
                  <Text style={styles.totalSectionValue}>{selectedInvoice.total_amount.toFixed(2)} €</Text>
                </View>
                {selectedInvoice.notes && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>{t('invoices.notes')}</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.notes}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => {
                    setSelectedInvoice(null);
                    handleDeleteInvoice(selectedInvoice.id);
                  }}
                >
                  <Ionicons name="trash" size={20} color="#EF4444" />
                  <Text style={styles.deleteButtonText}>{t('invoices.deleteInvoice')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  exportButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    marginHorizontal: 16,
    borderRadius: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    color: 'white',
    fontSize: 16,
  },
  periodChipsRow: {
    marginTop: 12,
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
  },
  periodChipsContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  periodChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    marginRight: 8,
    flexShrink: 0,
  },
  periodChipActive: {
    backgroundColor: '#8B5CF6',
  },
  periodChipText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  periodChipTextActive: {
    color: 'white',
  },
  customRangeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  customRangeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  customRangeButtonText: {
    fontSize: 12,
    color: '#E2E8F0',
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
  },
  monthHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#C4B5FD',
    textTransform: 'capitalize',
  },
  monthHeaderStats: {
    fontSize: 12,
    color: '#94A3B8',
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#1E293B',
    margin: 16,
    borderRadius: 12,
    padding: 12,
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 2,
  },
  listContent: {
    padding: 16,
    paddingTop: 0,
  },
  invoiceCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  eikWarningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 10,
    marginTop: -4,
  },
  eikWarningBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F59E0B',
  },
  eikBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  eikBannerActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.25)',
  },
  eikBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#F59E0B',
    fontWeight: '600',
  },
  eikBannerAction: {
    fontSize: 12,
    color: '#F59E0B',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  supplierContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  supplierName: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    flex: 1,
  },
  invoiceDate: {
    fontSize: 12,
    color: '#64748B',
  },
  invoiceDetails: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detailLabel: {
    fontSize: 13,
    color: '#94A3B8',
  },
  detailValue: {
    fontSize: 13,
    color: '#E2E8F0',
  },
  invoiceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  totalLabel: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    color: '#64748B',
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 14,
    color: '#475569',
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  detailModalContent: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
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
  exportOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#0F172A',
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
    color: '#64748B',
    marginTop: 2,
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    color: '#94A3B8',
    fontSize: 16,
  },
  detailSection: {
    marginBottom: 16,
  },
  protocolBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  protocolBannerOverdue: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  protocolBannerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
  },
  protocolBannerDeadline: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  detailSectionLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  detailSectionValue: {
    fontSize: 16,
    color: 'white',
  },
  detailRow2: {
    flexDirection: 'row',
    gap: 16,
  },
  totalSection: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  totalSectionLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  totalSectionValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#8B5CF6',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
    marginTop: 8,
  },
  deleteButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '500',
  },
});

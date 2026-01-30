import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  Alert,
  Modal,
  Linking,
  Platform,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/services/api';
import { Invoice } from '../../src/types';
import { format } from 'date-fns';
import { bg } from 'date-fns/locale';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function InvoicesScreen() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const loadInvoices = useCallback(async () => {
    try {
      const data = await api.getInvoices(
        searchQuery ? { supplier: searchQuery } : undefined
      );
      setInvoices(data);
    } catch (error) {
      console.error('Error loading invoices:', error);
    }
  }, [searchQuery]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadInvoices();
    setRefreshing(false);
  }, [loadInvoices]);

  const handleDeleteInvoice = async (id: string) => {
    Alert.alert(
      'Изтриване',
      'Сигурни ли сте, че искате да изтриете тази фактура?',
      [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Изтрий',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteInvoice(id);
              loadInvoices();
            } catch (error: any) {
              Alert.alert('Грешка', error.message);
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
      Alert.alert('Грешка', 'Не можах да изтегля файла');
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), 'd MMM yyyy', { locale: bg });
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

      <View style={styles.invoiceDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>№ Фактура:</Text>
          <Text style={styles.detailValue}>{item.invoice_number}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Без ДДС:</Text>
          <Text style={styles.detailValue}>{item.amount_without_vat.toFixed(2)} лв.</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>ДДС:</Text>
          <Text style={styles.detailValue}>{item.vat_amount.toFixed(2)} лв.</Text>
        </View>
      </View>

      <View style={styles.invoiceFooter}>
        <Text style={styles.totalLabel}>Общо:</Text>
        <Text style={styles.totalValue}>{item.total_amount.toFixed(2)} лв.</Text>
      </View>
    </TouchableOpacity>
  );

  const totalAmount = invoices.reduce((sum, inv) => sum + inv.total_amount, 0);
  const totalVat = invoices.reduce((sum, inv) => sum + inv.vat_amount, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Фактури</Text>
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
          placeholder="Търси по доставчик..."
          placeholderTextColor="#64748B"
          onSubmitEditing={loadInvoices}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => { setSearchQuery(''); loadInvoices(); }}>
            <Ionicons name="close-circle" size={20} color="#64748B" />
          </TouchableOpacity>
        )}
      </View>

      {/* Summary */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Брой:</Text>
          <Text style={styles.summaryValue}>{invoices.length}</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>ДДС:</Text>
          <Text style={styles.summaryValue}>{totalVat.toFixed(2)} лв.</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Общо:</Text>
          <Text style={[styles.summaryValue, { color: '#8B5CF6' }]}>{totalAmount.toFixed(2)} лв.</Text>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={invoices}
        renderItem={renderInvoice}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={64} color="#334155" />
            <Text style={styles.emptyText}>Няма фактури</Text>
            <Text style={styles.emptyHint}>Сканирайте първата си фактура</Text>
          </View>
        }
      />

      {/* Export Modal */}
      <Modal visible={exportModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Експорт на фактури</Text>

            <TouchableOpacity style={styles.exportOption} onPress={() => handleExport('excel')}>
              <View style={[styles.exportIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Ionicons name="document" size={24} color="#10B981" />
              </View>
              <View>
                <Text style={styles.exportOptionTitle}>Excel (а.xlsx)</Text>
                <Text style={styles.exportOptionHint}>За редактиране и анализ</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.exportOption} onPress={() => handleExport('pdf')}>
              <View style={[styles.exportIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Ionicons name="document-text" size={24} color="#EF4444" />
              </View>
              <View>
                <Text style={styles.exportOptionTitle}>PDF</Text>
                <Text style={styles.exportOptionHint}>За печат и архив</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={() => setExportModalVisible(false)}>
              <Text style={styles.cancelButtonText}>Отказ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Invoice Detail Modal */}
      <Modal visible={!!selectedInvoice} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.detailModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Детайли</Text>
              <TouchableOpacity onPress={() => setSelectedInvoice(null)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {selectedInvoice && (
              <View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>Доставчик</Text>
                  <Text style={styles.detailSectionValue}>{selectedInvoice.supplier}</Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>№ Фактура</Text>
                  <Text style={styles.detailSectionValue}>{selectedInvoice.invoice_number}</Text>
                </View>
                <View style={styles.detailSection}>
                  <Text style={styles.detailSectionLabel}>Дата</Text>
                  <Text style={styles.detailSectionValue}>{formatDate(selectedInvoice.date)}</Text>
                </View>
                <View style={styles.detailRow2}>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>Без ДДС</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.amount_without_vat.toFixed(2)} лв.</Text>
                  </View>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>ДДС (20%)</Text>
                    <Text style={styles.detailSectionValue}>{selectedInvoice.vat_amount.toFixed(2)} лв.</Text>
                  </View>
                </View>
                <View style={styles.totalSection}>
                  <Text style={styles.totalSectionLabel}>Обща сума</Text>
                  <Text style={styles.totalSectionValue}>{selectedInvoice.total_amount.toFixed(2)} лв.</Text>
                </View>
                {selectedInvoice.notes && (
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionLabel}>Бележки</Text>
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
                  <Text style={styles.deleteButtonText}>Изтрий фактурата</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
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

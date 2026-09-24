import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert } from '../src/utils/alert';
import { useTranslation } from '../src/i18n';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';

export default function ExportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [ledgerPeriod, setLedgerPeriod] = useState<'thisMonth' | 'lastMonth'>('lastMonth');

  // Use environment variable for API URL - no hardcoded fallback for production
  const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

  const downloadFile = async (endpoint: string, filename: string, loadingKey: string) => {
    setLoading(loadingKey);

    try {
      // Get auth token from storage
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const token = await AsyncStorage.getItem('session_token');

      if (!token) {
        Alert.alert(t('common.error'), t('export.notLoggedIn'));
        return;
      }

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const reader = new FileReader();

      reader.onloadend = async () => {
        const base64data = reader.result as string;
        const base64 = base64data.split(',')[1];

        const fileUri = `${(FileSystem as any).documentDirectory || (FileSystem as any).cacheDirectory}${filename}`;

        await (FileSystem as any).writeAsStringAsync(fileUri, base64, {
          encoding: (FileSystem as any).EncodingType.Base64,
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri);
        } else {
          Alert.alert(t('common.success'), t('export.fileSaved'));
        }
      };

      reader.readAsDataURL(blob);

    } catch (error) {
      console.error('Export error:', error);
      Alert.alert(t('common.error'), t('export.failed'));
    } finally {
      setLoading(null);
    }
  };

  const exportData = (format: 'excel' | 'pdf') => {
    const endpoint = format === 'excel'
      ? '/api/export/invoices/excel'
      : '/api/export/invoices/pdf';
    const filename = `invoices_${new Date().toISOString().slice(0, 10)}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
    downloadFile(endpoint, filename, format);
  };

  const exportVatLedger = () => {
    const now = new Date();
    const targetMonth = ledgerPeriod === 'lastMonth' ? now.getMonth() - 1 : now.getMonth();
    const start = new Date(now.getFullYear(), targetMonth, 1);
    const end = new Date(now.getFullYear(), targetMonth + 1, 0);
    const toDateStr = (d: Date) => d.toISOString().slice(0, 10);
    const endpoint = `/api/export/vat-ledger/excel?start_date=${toDateStr(start)}&end_date=${toDateStr(end)}`;
    const filename = `dnevnik_${toDateStr(start).slice(0, 7)}.xlsx`;
    downloadFile(endpoint, filename, 'ledger');
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('export.title')}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.content}>
          <Text style={styles.subtitle}>{t('export.subtitle')}</Text>

          {/* VAT Ledger Export */}
          <View style={styles.ledgerCard}>
            <View style={styles.ledgerHeader}>
              <View style={[styles.iconContainer, { backgroundColor: 'rgba(139, 92, 246, 0.2)', marginRight: 12 }]}>
                <Ionicons name="albums" size={28} color="#8B5CF6" />
              </View>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle}>{t('export.vatLedger')}</Text>
                <Text style={styles.cardDesc}>{t('export.vatLedgerDesc')}</Text>
              </View>
            </View>

            <View style={styles.ledgerPeriodRow}>
              <TouchableOpacity
                style={[styles.ledgerPeriodChip, ledgerPeriod === 'lastMonth' && styles.ledgerPeriodChipActive]}
                onPress={() => setLedgerPeriod('lastMonth')}
              >
                <Text style={[styles.ledgerPeriodText, ledgerPeriod === 'lastMonth' && styles.ledgerPeriodTextActive]}>
                  {t('export.lastMonth')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ledgerPeriodChip, ledgerPeriod === 'thisMonth' && styles.ledgerPeriodChipActive]}
                onPress={() => setLedgerPeriod('thisMonth')}
              >
                <Text style={[styles.ledgerPeriodText, ledgerPeriod === 'thisMonth' && styles.ledgerPeriodTextActive]}>
                  {t('export.thisMonth')}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.ledgerDownloadButton}
              onPress={exportVatLedger}
              disabled={loading !== null}
            >
              {loading === 'ledger' ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="download" size={18} color="white" />
                  <Text style={styles.ledgerDownloadText}>{t('export.download')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Excel Export */}
          <TouchableOpacity 
            style={styles.exportCard}
            onPress={() => exportData('excel')}
            disabled={loading !== null}
          >
            <View style={[styles.iconContainer, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
              <Ionicons name="document-text" size={32} color="#10B981" />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{t('export.excel')}</Text>
              <Text style={styles.cardDesc}>{t('export.excelDesc')}</Text>
            </View>
            {loading === 'excel' ? (
              <ActivityIndicator color="#10B981" />
            ) : (
              <Ionicons name="download-outline" size={24} color="#64748B" />
            )}
          </TouchableOpacity>

          {/* PDF Export */}
          <TouchableOpacity 
            style={styles.exportCard}
            onPress={() => exportData('pdf')}
            disabled={loading !== null}
          >
            <View style={[styles.iconContainer, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}>
              <Ionicons name="document" size={32} color="#EF4444" />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>{t('export.pdf')}</Text>
              <Text style={styles.cardDesc}>{t('export.pdfDesc')}</Text>
            </View>
            {loading === 'pdf' ? (
              <ActivityIndicator color="#EF4444" />
            ) : (
              <Ionicons name="download-outline" size={24} color="#64748B" />
            )}
          </TouchableOpacity>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={20} color="#8B5CF6" />
            <Text style={styles.infoText}>{t('export.info')}</Text>
          </View>

          <TouchableOpacity style={styles.statsLinkCard} onPress={() => router.push('/(tabs)/stats')}>
            <Ionicons name="stats-chart" size={20} color="#8B5CF6" />
            <Text style={styles.statsLinkText}>{t('export.statsExportHint')}</Text>
            <Ionicons name="chevron-forward" size={18} color="#64748B" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1E293B',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 24,
    textAlign: 'center',
  },
  ledgerCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#8B5CF640',
  },
  ledgerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  ledgerPeriodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  ledgerPeriodChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#0F172A',
    alignItems: 'center',
  },
  ledgerPeriodChipActive: {
    backgroundColor: '#8B5CF6',
  },
  ledgerPeriodText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  ledgerPeriodTextActive: {
    color: 'white',
  },
  ledgerDownloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#8B5CF6',
    borderRadius: 10,
    paddingVertical: 12,
  },
  ledgerDownloadText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  exportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
  cardDesc: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#8B5CF620',
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
    gap: 12,
  },
  infoText: {
    flex: 1,
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 20,
  },
  statsLinkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    gap: 10,
  },
  statsLinkText: {
    flex: 1,
    color: '#CBD5E1',
    fontSize: 13,
  },
});

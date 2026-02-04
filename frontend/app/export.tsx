import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from '../src/i18n';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';

export default function ExportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const API_URL = Constants.expoConfig?.extra?.EXPO_BACKEND_URL || 
                  process.env.EXPO_PUBLIC_API_URL || 
                  'http://localhost:8001';

  const exportData = async (format: 'excel' | 'pdf') => {
    setLoading(format);
    
    try {
      // Get auth token from storage
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const token = await AsyncStorage.getItem('session_token');
      
      if (!token) {
        Alert.alert(t('common.error'), t('export.notLoggedIn'));
        return;
      }

      const endpoint = format === 'excel' 
        ? '/api/export/invoices/excel'
        : '/api/export/invoices/pdf';
      
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
        
        const filename = format === 'excel' 
          ? `invoices_${new Date().toISOString().slice(0, 10)}.xlsx`
          : `invoices_${new Date().toISOString().slice(0, 10)}.pdf`;
        
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
});

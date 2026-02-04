import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ImageBackground,
  RefreshControl,
  Share,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { api } from '@/src/services/api';
import { format } from 'date-fns';
import { bg, enUS } from 'date-fns/locale';
import { useTranslation, useLanguageStore } from '../src/i18n';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function BackupScreen() {
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  const dateLocale = language === 'bg' ? bg : enUS;
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backupStatus, setBackupStatus] = useState<{
    has_backup: boolean;
    last_backup_date: string | null;
    file_name?: string;
    statistics?: { invoices: number; revenues: number; expenses: number };
  } | null>(null);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const loadBackupStatus = useCallback(async () => {
    try {
      const status = await api.getBackupStatus();
      setBackupStatus(status);
    } catch (error) {
      console.error('Error loading backup status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBackupStatus();
  }, [loadBackupStatus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBackupStatus();
    setRefreshing(false);
  }, [loadBackupStatus]);

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    try {
      // Create backup from server
      const backupData = await api.createBackup();
      
      // Convert to JSON string
      const jsonString = JSON.stringify(backupData, null, 2);
      
      // Create file
      const fileName = `invoice_backup_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;
      
      await FileSystem.writeAsStringAsync(fileUri, jsonString);
      
      // Check if sharing is available
      const isSharingAvailable = await Sharing.isAvailableAsync();
      
      if (isSharingAvailable) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: t('backup.saveFile'),
        });
        
        Alert.alert(
          t('backup.successTitle'),
          `${t('backup.backupCreated')}\n\n📊 ${t('backup.statistics')}:\n• ${t('backup.invoices')}: ${backupData.statistics.invoice_count}\n• ${t('backup.revenues')}: ${backupData.statistics.revenue_count}\n• ${t('backup.expenses')}: ${backupData.statistics.expense_count}\n\n${t('backup.saveFile')}`
        );
      } else {
        Alert.alert(
          t('backup.backupCreated'),
          `${t('backup.sharingNotAvailable')}\n\n${t('backup.file')}: ${fileName}`
        );
      }
      
      // Update status
      await loadBackupStatus();
      
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('backup.createError'));
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async () => {
    try {
      // Select file
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      
      if (result.canceled) {
        return;
      }
      
      const file = result.assets[0];
      
      // Show confirmation
      Alert.alert(
        t('backup.confirmation'),
        `${t('backup.restoreQuestion')}\n${file.name}?\n\n⚠️ ${t('backup.restoreWarning')}`,
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('backup.restoreButton'),
            style: 'destructive',
            onPress: async () => {
              setIsRestoring(true);
              try {
                // Read file
                const content = await FileSystem.readAsStringAsync(file.uri);
                const backupData = JSON.parse(content);
                
                // Send to server for restoration
                const restoreResult = await api.restoreBackup(backupData);
                
                Alert.alert(
                  t('backup.successTitle'),
                  `${t('backup.restored')}\n\n📊 ${t('backup.restoredRecords')}:\n• ${t('backup.invoices')}: ${restoreResult.restored.invoices}\n• ${t('backup.revenues')}: ${restoreResult.restored.revenues}\n• ${t('backup.expenses')}: ${restoreResult.restored.expenses}`
                );
                
                await loadBackupStatus();
                
              } catch (error: any) {
                Alert.alert(t('common.error'), error.message || t('backup.restoreError'));
              } finally {
                setIsRestoring(false);
              }
            },
          },
        ]
      );
      
    } catch (error: any) {
      Alert.alert('Грешка', error.message || 'Неуспешен избор на файл');
    }
  };

  if (loading) {
    return (
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#10B981" />
          </SafeAreaView>
        </View>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{t('backup.title')}</Text>
            <View style={styles.headerRight} />
          </View>

          <ScrollView 
            style={styles.scrollView}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={['#10B981']}
                tintColor="#10B981"
              />
            }
          >
            {/* Info Card */}
            <View style={styles.infoCard}>
              <Ionicons name="cloud-upload" size={32} color="#10B981" />
              <View style={styles.infoTextContainer}>
                <Text style={styles.infoTitle}>{t('backup.infoTitle')}</Text>
                <Text style={styles.infoDescription}>
                  {t('backup.infoDescription')}
                </Text>
              </View>
            </View>

            {/* Status Card */}
            <View style={styles.statusCard}>
              <Text style={styles.sectionTitle}>{t('backup.status')}</Text>
              
              {backupStatus?.has_backup ? (
                <>
                  <View style={styles.statusRow}>
                    <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                    <Text style={styles.statusText}>{t('backup.lastBackup')}:</Text>
                    <Text style={styles.statusValue}>
                      {backupStatus.last_backup_date 
                        ? format(new Date(backupStatus.last_backup_date), "d MMM yyyy, HH:mm", { locale: dateLocale })
                        : t('backup.unknown')}
                    </Text>
                  </View>
                  
                  {backupStatus.statistics && (
                    <View style={styles.statisticsContainer}>
                      <View style={styles.statItem}>
                        <Ionicons name="document-text" size={18} color="#8B5CF6" />
                        <Text style={styles.statValue}>{backupStatus.statistics.invoices}</Text>
                        <Text style={styles.statLabel}>{t('backup.invoices')}</Text>
                      </View>
                      <View style={styles.statItem}>
                        <Ionicons name="cash" size={18} color="#10B981" />
                        <Text style={styles.statValue}>{backupStatus.statistics.revenues}</Text>
                        <Text style={styles.statLabel}>{t('backup.revenues')}</Text>
                      </View>
                      <View style={styles.statItem}>
                        <Ionicons name="cart" size={18} color="#EF4444" />
                        <Text style={styles.statValue}>{backupStatus.statistics.expenses}</Text>
                        <Text style={styles.statLabel}>{t('backup.expenses')}</Text>
                      </View>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.statusRow}>
                  <Ionicons name="alert-circle" size={20} color="#F59E0B" />
                  <Text style={styles.statusText}>{t('backup.noBackup')}</Text>
                </View>
              )}
            </View>

            {/* Actions */}
            <View style={styles.actionsContainer}>
              <TouchableOpacity
                style={[styles.actionButton, styles.backupButton, isCreatingBackup && styles.buttonDisabled]}
                onPress={handleCreateBackup}
                disabled={isCreatingBackup || isRestoring}
              >
                {isCreatingBackup ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload" size={24} color="white" />
                    <Text style={styles.actionButtonText}>{t('backup.create')}</Text>
                  </>
                )}
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.actionButton, styles.restoreButton, isRestoring && styles.buttonDisabled]}
                onPress={handleRestoreBackup}
                disabled={isCreatingBackup || isRestoring}
              >
                {isRestoring ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicons name="cloud-download" size={24} color="white" />
                    <Text style={styles.actionButtonText}>{t('backup.restore')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Instructions */}
            <View style={styles.instructionsCard}>
              <Text style={styles.instructionsTitle}>📖 Как да използвате</Text>
              
              <View style={styles.instruction}>
                <View style={styles.instructionNumber}>
                  <Text style={styles.instructionNumberText}>1</Text>
                </View>
                <Text style={styles.instructionText}>
                  Натиснете "Създай Backup" за да експортирате данните
                </Text>
              </View>
              
              <View style={styles.instruction}>
                <View style={styles.instructionNumber}>
                  <Text style={styles.instructionNumberText}>2</Text>
                </View>
                <Text style={styles.instructionText}>
                  Изберете "Запази в Google Drive" от менюто за споделяне
                </Text>
              </View>
              
              <View style={styles.instruction}>
                <View style={styles.instructionNumber}>
                  <Text style={styles.instructionNumberText}>3</Text>
                </View>
                <Text style={styles.instructionText}>
                  За възстановяване - изберете файла от Google Drive
                </Text>
              </View>
            </View>

          </ScrollView>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  infoTextContainer: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#10B981',
    marginBottom: 4,
  },
  infoDescription: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
  },
  statusCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  statusText: {
    fontSize: 14,
    color: '#94A3B8',
  },
  statusValue: {
    fontSize: 14,
    color: 'white',
    fontWeight: '500',
  },
  statisticsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  statItem: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  statLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  actionsContainer: {
    gap: 12,
    marginBottom: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 14,
    gap: 12,
  },
  backupButton: {
    backgroundColor: '#10B981',
  },
  restoreButton: {
    backgroundColor: '#3B82F6',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  instructionsCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
  },
  instruction: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  instructionNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  instructionNumberText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
  },
});

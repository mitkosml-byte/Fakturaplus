import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../src/services/api';
import { Invoice } from '../src/types';
import { format } from 'date-fns';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied } from '../src/components';
import { COLORS } from '../src/theme/colors';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function ProtocolsScreen() {
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();
  const router = useRouter();

  const [protocols, setProtocols] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadProtocols = useCallback(async () => {
    try {
      const data = await api.getReverseChargeProtocols();
      setProtocols(data);
    } catch (error) {
      console.error('Error loading protocols:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProtocols();
  }, [loadProtocols]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProtocols();
    setRefreshing(false);
  };

  const overdueCount = protocols.filter((inv) => new Date(inv.date).getTime() + 15 * DAY_MS < Date.now()).length;

  if (!hasPermission('view_statistics')) {
    return <AccessDenied />;
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('protocols.title')}</Text>
          <View style={{ width: 40 }} />
        </View>

        {overdueCount > 0 && (
          <View style={styles.overdueBanner}>
            <Ionicons name="alert-circle" size={20} color={COLORS.danger} />
            <Text style={styles.overdueBannerText}>
              {overdueCount} {overdueCount === 1 ? t('protocols.overdueSingular') : t('protocols.overduePlural')}
            </Text>
          </View>
        )}

        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : protocols.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={56} color={COLORS.border} />
              <Text style={styles.emptyText}>{t('protocols.empty')}</Text>
              <Text style={styles.emptyHint}>{t('protocols.emptyHint')}</Text>
            </View>
          ) : (
            protocols.map((inv) => {
              const deadline = new Date(new Date(inv.date).getTime() + 15 * DAY_MS);
              const overdue = deadline.getTime() < Date.now();
              return (
                <View key={inv.id} style={[styles.protocolCard, overdue && styles.protocolCardOverdue]}>
                  <View style={styles.protocolCardHeader}>
                    <Text style={styles.protocolNumber}>№ {inv.protocol_number || '—'}</Text>
                    {overdue && (
                      <View style={styles.overdueBadge}>
                        <Text style={styles.overdueBadgeText}>{t('invoices.protocolOverdue')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.supplierName} numberOfLines={1}>{inv.supplier}</Text>
                  <View style={styles.protocolMetaRow}>
                    <Text style={styles.protocolMeta}>
                      {t('invoices.dateLabel')}: {format(new Date(inv.date), 'd MMM yyyy', { locale: dateLocale })}
                    </Text>
                    <Text style={[styles.protocolMeta, overdue && { color: COLORS.danger, fontWeight: '600' }]}>
                      {t('invoices.protocolDeadline')}: {format(deadline, 'd MMM yyyy', { locale: dateLocale })}
                    </Text>
                  </View>
                  <View style={styles.protocolAmountRow}>
                    <Text style={styles.protocolAmountLabel}>{t('invoices.withoutVAT')}</Text>
                    <Text style={styles.protocolAmountValue}>{inv.amount_without_vat.toFixed(2)} €</Text>
                  </View>
                </View>
              );
            })
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    backgroundColor: COLORS.surface,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  overdueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  overdueBannerText: {
    color: COLORS.danger,
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.textMuted,
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 13,
    color: COLORS.borderLight,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  protocolCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  protocolCardOverdue: {
    borderLeftColor: COLORS.danger,
  },
  protocolCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  protocolNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primaryLight,
  },
  overdueBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  overdueBadgeText: {
    color: COLORS.danger,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  supplierName: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    marginBottom: 8,
  },
  protocolMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  protocolMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  protocolAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },
  protocolAmountLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  protocolAmountValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
  },
});

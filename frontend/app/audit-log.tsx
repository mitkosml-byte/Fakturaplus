import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../src/services/api';
import { format } from 'date-fns';
import { bg, enUS } from 'date-fns/locale';
import { useTranslation, useLanguageStore } from '../src/i18n';

type ActionFilter = 'all' | 'create' | 'update' | 'delete' | 'export';

interface AuditLogEntry {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  details?: Record<string, any> | null;
  created_at: string;
}

const ACTION_ICONS: Record<string, { name: any; color: string }> = {
  create: { name: 'add-circle', color: '#10B981' },
  update: { name: 'create', color: '#F59E0B' },
  delete: { name: 'trash', color: '#EF4444' },
  export: { name: 'download', color: '#3B82F6' },
};

export default function AuditLogScreen() {
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  const dateLocale = language === 'bg' ? bg : enUS;
  const router = useRouter();

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');

  const loadLogs = useCallback(async () => {
    try {
      const data = await api.getAuditLogs({
        action: actionFilter === 'all' ? undefined : actionFilter,
        limit: 100,
      });
      setLogs(data.logs || []);
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [actionFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLogs();
    setRefreshing(false);
  };

  const filterOptions: { key: ActionFilter; label: string }[] = [
    { key: 'all', label: t('auditLog.filterAll') },
    { key: 'create', label: t('auditLog.actionCreate') },
    { key: 'update', label: t('auditLog.actionUpdate') },
    { key: 'delete', label: t('auditLog.actionDelete') },
    { key: 'export', label: t('auditLog.actionExport') },
  ];

  const describeEntry = (entry: AuditLogEntry): string => {
    const d = entry.details || {};
    if (entry.entity_type === 'invoice') {
      const supplierBit = d.supplier ? ` – ${d.supplier}` : '';
      const numberBit = d.invoice_number ? ` №${d.invoice_number}` : '';
      const amountBit = typeof d.total_amount === 'number' ? ` (${d.total_amount.toFixed(2)} €)` : '';
      if (entry.action === 'update') {
        const fields = Object.keys(d).join(', ');
        return `${t('auditLog.entityInvoice')}${numberBit}${fields ? `: ${fields}` : ''}`;
      }
      return `${t('auditLog.entityInvoice')}${numberBit}${supplierBit}${amountBit}`;
    }
    if (entry.action === 'export') {
      const formatLabel = d.format ? d.format.toUpperCase() : '';
      const count = typeof d.count === 'number' ? ` (${d.count} ${t('auditLog.entityInvoices')})` : '';
      return `${formatLabel}${count}`;
    }
    return entry.entity_type;
  };

  const formatTimestamp = (value: string) => {
    try {
      return format(new Date(value), 'd MMM yyyy, HH:mm', { locale: dateLocale });
    } catch {
      return value;
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('auditLog.title')}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterRowContent}
        >
          {filterOptions.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.filterChip, actionFilter === opt.key && styles.filterChipActive]}
              onPress={() => setActionFilter(opt.key)}
            >
              <Text style={[styles.filterChipText, actionFilter === opt.key && styles.filterChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        >
          {!loading && logs.length === 0 && (
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={56} color="#334155" />
              <Text style={styles.emptyText}>{t('auditLog.empty')}</Text>
            </View>
          )}

          {logs.map((entry) => {
            const icon = ACTION_ICONS[entry.action] || { name: 'ellipse', color: '#64748B' };
            return (
              <View key={entry.id} style={styles.logRow}>
                <View style={[styles.logIcon, { backgroundColor: `${icon.color}20` }]}>
                  <Ionicons name={icon.name} size={18} color={icon.color} />
                </View>
                <View style={styles.logContent}>
                  <Text style={styles.logSummary}>
                    <Text style={styles.logUser}>{entry.user_name}</Text> · {describeEntry(entry)}
                  </Text>
                  <Text style={styles.logTimestamp}>{formatTimestamp(entry.created_at)}</Text>
                </View>
              </View>
            );
          })}

          <View style={{ height: 40 }} />
        </ScrollView>
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
  filterRow: {
    marginTop: 12,
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
  },
  filterRowContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    marginRight: 8,
    flexShrink: 0,
  },
  filterChipActive: {
    backgroundColor: '#8B5CF6',
  },
  filterChipText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: 'white',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#64748B',
    marginTop: 16,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  logIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logContent: {
    flex: 1,
  },
  logSummary: {
    fontSize: 14,
    color: '#E2E8F0',
    lineHeight: 20,
  },
  logUser: {
    fontWeight: '700',
    color: 'white',
  },
  logTimestamp: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
});

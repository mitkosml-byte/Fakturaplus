import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../src/services/api';
import { format } from 'date-fns';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { AccessDenied, ScreenEnter, AnimatedEmptyIcon } from '../src/components';
import { COLORS } from '../src/theme/colors';

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
  create: { name: 'add-circle', color: COLORS.success },
  update: { name: 'create', color: COLORS.warning },
  delete: { name: 'trash', color: COLORS.danger },
  export: { name: 'download', color: COLORS.info },
};

export default function AuditLogScreen() {
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();
  const router = useRouter();

  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Takes an optional override so the "clear" button can search with an
  // empty string immediately, instead of racing the setSearchQuery('')
  // state update that wouldn't be visible to this callback until the next
  // render.
  const loadLogs = useCallback(async (searchOverride?: string) => {
    try {
      const search = searchOverride !== undefined ? searchOverride : searchQuery;
      const data = await api.getAuditLogs({
        action: actionFilter === 'all' ? undefined : actionFilter,
        search: search.trim() || undefined,
        limit: 100,
      });
      setLogs(data.logs || []);
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, searchQuery]);

  // Reloads on mount and whenever the action filter (chips) changes, but
  // NOT on every searchQuery keystroke - search only runs when the user
  // submits it (onSubmitEditing below), same as the invoices screen's
  // search box, so typing doesn't fire a request per character.
  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter]);

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

  // A deleted invoice carries its full snapshot on this entry (see
  // restore_audit_entry in the backend) exactly once, until restored -
  // gated on its own permission since undoing someone else's delete,
  // possibly days later, is a sensitive admin action, not routine invoice
  // work (see restore_deleted_data in ROLE_PERMISSIONS).
  const canRestore = (entry: AuditLogEntry) =>
    hasPermission('restore_deleted_data') &&
    entry.action === 'delete' &&
    entry.entity_type === 'invoice' &&
    !entry.details?.restored;

  const handleRestore = (entry: AuditLogEntry) => {
    Alert.alert(
      t('auditLog.restoreConfirmTitle'),
      t('auditLog.restoreConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('auditLog.restore'),
          onPress: async () => {
            setRestoringId(entry.id);
            try {
              await api.restoreAuditLogEntry(entry.id);
              Haptics.success();
              Toast.success(t('auditLog.restoreSuccess'));
              setLogs((prev) =>
                prev.map((l) => (l.id === entry.id ? { ...l, details: { ...l.details, restored: true } } : l))
              );
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
            } finally {
              setRestoringId(null);
            }
          },
        },
      ]
    );
  };

  const formatTimestamp = (value: string) => {
    try {
      return format(new Date(value), 'd MMM yyyy, HH:mm', { locale: dateLocale });
    } catch {
      return value;
    }
  };

  if (!hasPermission('view_audit_log')) {
    return <AccessDenied />;
  }

  return (
    <ScreenEnter>
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('auditLog.title')}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('auditLog.searchPlaceholder')}
            placeholderTextColor={COLORS.textMuted}
            onSubmitEditing={() => loadLogs()}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchQuery(''); loadLogs(''); }}>
              <Ionicons name="close-circle" size={20} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {!loading && logs.length === 0 && (
            <View style={styles.emptyContainer}>
              <AnimatedEmptyIcon name="document-text-outline" size={56} color={COLORS.border} />
              <Text style={styles.emptyText}>{t('auditLog.empty')}</Text>
            </View>
          )}

          {logs.map((entry) => {
            const icon = ACTION_ICONS[entry.action] || { name: 'ellipse', color: COLORS.textMuted };
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
                  {canRestore(entry) && (
                    <TouchableOpacity
                      style={styles.restoreButton}
                      onPress={() => handleRestore(entry)}
                      disabled={restoringId === entry.id}
                    >
                      <Ionicons name="arrow-undo" size={14} color={COLORS.primary} />
                      <Text style={styles.restoreButtonText}>
                        {restoringId === entry.id ? '...' : t('auditLog.restore')}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {entry.action === 'delete' && entry.entity_type === 'invoice' && entry.details?.restored && (
                    <Text style={styles.restoredBadge}>{t('auditLog.restored')}</Text>
                  )}
                </View>
              </View>
            );
          })}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
    </ScreenEnter>
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginTop: 12,
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
    backgroundColor: COLORS.surface,
    marginRight: 8,
    flexShrink: 0,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 13,
    color: COLORS.textSecondary,
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
    color: COLORS.textMuted,
    marginTop: 16,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.surface,
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
    color: COLORS.textLight,
    lineHeight: 20,
  },
  logUser: {
    fontWeight: '700',
    color: 'white',
  },
  logTimestamp: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  restoreButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  restoredBadge: {
    fontSize: 12,
    color: COLORS.success,
    fontWeight: '500',
    marginTop: 6,
  },
});

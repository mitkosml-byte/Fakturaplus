import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLanguageStore } from '../i18n';

interface EmptyStateProps {
  icon: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name={icon as any} size={48} color="#64748B" />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.actionButton} onPress={onAction}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Pre-configured empty states
export function EmptyInvoices({ onScan }: { onScan?: () => void }) {
  const { language } = useLanguageStore();
  return (
    <EmptyState
      icon="document-text-outline"
      title={language === 'bg' ? 'Няма фактури' : 'No invoices'}
      subtitle={language === 'bg' ? 'Сканирайте първата си фактура' : 'Scan your first invoice'}
      actionLabel={language === 'bg' ? 'Сканирай' : 'Scan'}
      onAction={onScan}
    />
  );
}

export function EmptyData() {
  const { language } = useLanguageStore();
  return (
    <EmptyState
      icon="analytics-outline"
      title={language === 'bg' ? 'Няма данни' : 'No data'}
      subtitle={language === 'bg' ? 'Започнете да добавяте записи' : 'Start adding records'}
    />
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { language } = useLanguageStore();
  return (
    <EmptyState
      icon="alert-circle-outline"
      title={language === 'bg' ? 'Възникна грешка' : 'An error occurred'}
      subtitle={language === 'bg' ? 'Не можахме да заредим данните' : 'Could not load data'}
      actionLabel={language === 'bg' ? 'Опитай отново' : 'Try again'}
      onAction={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 24,
  },
  actionButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
});

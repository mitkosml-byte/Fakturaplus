import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ImageBackground } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

// Module 3 audit finding: "the 'give it its own history screen' pattern
// is already repeating with no central hub" - this screen IS that hub.
// One place that lists every history/records screen in the app, so
// finding one doesn't depend on remembering which Home stat card, modal
// button, or Profile category it happens to be tucked under.
export default function HistoryHubScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();

  const items: {
    key: string;
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    iconColor: string;
    onPress: () => void;
  }[] = [
    ...(hasPermission('manage_invoices') ? [{
      key: 'scanCredits',
      title: t('scanCredits.title'),
      subtitle: t('historyHub.scanCreditsDesc'),
      icon: 'scan-outline' as const,
      iconColor: COLORS.teal,
      onPress: () => router.push('/scan-credits'),
    }] : []),
    ...(hasPermission('view_off_book_expenses') ? [{
      key: 'offBookExpenses',
      title: t('expenses.historyTitle'),
      subtitle: t('historyHub.offBookExpensesDesc'),
      icon: 'receipt-outline' as const,
      iconColor: COLORS.warning,
      onPress: () => router.push('/off-book-expenses'),
    }] : []),
    ...(hasPermission('view_pocket_money') ? [{
      key: 'pocketMoney',
      title: t('pocketMoney.historyTitle'),
      subtitle: t('historyHub.pocketMoneyDesc'),
      icon: 'wallet-outline' as const,
      iconColor: COLORS.success,
      onPress: () => router.push('/pocket-money-history'),
    }] : []),
    ...(hasPermission('view_personal_investments') || hasPermission('view_personal_wallet') ? [{
      key: 'personalExpenses',
      title: t('personal.title'),
      subtitle: t('historyHub.personalExpensesDesc'),
      icon: 'person-outline' as const,
      iconColor: COLORS.danger,
      onPress: () => router.push('/personal-expenses'),
    }] : []),
    ...(hasPermission('add_revenue') ? [{
      key: 'receivables',
      title: t('receivables.title'),
      subtitle: t('profile.receivablesDesc'),
      icon: 'cash-outline' as const,
      iconColor: COLORS.success,
      onPress: () => router.push('/receivables'),
    }] : []),
    ...(hasPermission('add_revenue') ? [{
      key: 'billingDocuments',
      title: t('billingDocuments.title'),
      subtitle: t('profile.billingDocumentsDesc'),
      icon: 'document-text-outline' as const,
      iconColor: COLORS.primary,
      onPress: () => router.push('/billing-documents'),
    }] : []),
    ...(hasPermission('view_statistics') ? [{
      key: 'protocols',
      title: t('profile.protocols'),
      subtitle: t('profile.protocolsDesc'),
      icon: 'document-attach-outline' as const,
      iconColor: COLORS.primary,
      onPress: () => router.push('/protocols'),
    }] : []),
    ...(hasPermission('view_audit_log') ? [{
      key: 'auditLog',
      title: t('profile.auditLog'),
      subtitle: t('profile.auditLogDesc'),
      icon: 'list-outline' as const,
      iconColor: COLORS.indigo,
      onPress: () => router.push('/audit-log'),
    }] : []),
  ];

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('historyHub.title')}</Text>
            <View style={styles.backButton} />
          </View>

          <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 32 }}>
            {items.map((item) => (
              <TouchableOpacity key={item.key} style={styles.card} onPress={item.onPress}>
                <View style={[styles.iconCircle, { backgroundColor: `${item.iconColor}26` }]}>
                  <Ionicons name={item.icon} size={20} color={item.iconColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(10, 15, 28, 0.88)' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white', flex: 1, textAlign: 'center' },
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: 'white' },
  cardSubtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
});

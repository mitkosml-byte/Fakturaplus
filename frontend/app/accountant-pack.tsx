import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import type { AccountantPack } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter } from '../src/components';
import { downloadAndShareFile, NotLoggedInError } from '../src/utils/downloadFile';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

// "YYYY-MM" of the month before this one - the month a pack is usually for.
function lastMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// The month's pack for the accountant (Н4): what it holds, what is missing,
// and one button to send it (or download it).
export default function AccountantPackScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const params = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState<string>(params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : lastMonth());
  const [pack, setPack] = useState<AccountantPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAccountantPack(month);
      setPack(data);
      setEmail((current) => current || data.accountant_email || '');
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [month, t]);

  useEffect(() => { load(); }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      const { shared } = await downloadAndShareFile(`/api/accountant-pack/zip?month=${month}`, `dokumenti_${month}.zip`);
      if (!shared) Toast.success(t('export.fileSaved'));
    } catch (error: any) {
      Alert.alert(t('common.error'), error instanceof NotLoggedInError ? t('export.notLoggedIn') : t('export.failed'));
    } finally {
      setDownloading(false);
    }
  };

  const send = async () => {
    if (!email.trim()) {
      Alert.alert(t('common.error'), t('accountantPack.enterEmail'));
      return;
    }
    setSending(true);
    try {
      const result = await api.sendAccountantPack(month, email.trim());
      Haptics.success();
      Toast.success(t('accountantPack.sent').replace('{email}', result.sent_to));
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSending(false);
    }
  };

  if (!hasPermission('export_data')) return <AccessDenied />;

  const counts = pack?.counts;
  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = counts ? [
    { icon: 'receipt-outline', label: t('accountantPack.purchases'), value: t('accountantPack.withScans').replace('{count}', String(counts.purchases)).replace('{scanned}', String(counts.scanned)) },
    { icon: 'cash-outline', label: t('accountantPack.revenueDays'), value: String(counts.revenue_days) },
    { icon: 'document-text-outline', label: t('accountantPack.issued'), value: String(counts.issued_invoices) },
    { icon: 'return-down-back-outline', label: t('accountantPack.creditNotes'), value: String(counts.credit_notes) },
    { icon: 'people-outline', label: t('accountantPack.payroll'), value: String(counts.payroll_entries) },
  ] : [];

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('accountantPack.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.monthRow}>
              <TouchableOpacity onPress={() => setMonth(shiftMonth(month, -1))} style={styles.monthArrow}>
                <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
              </TouchableOpacity>
              <Text style={styles.monthLabel}>{pack?.label || month}</Text>
              <TouchableOpacity onPress={() => setMonth(shiftMonth(month, 1))} style={styles.monthArrow}>
                <Ionicons name="chevron-forward" size={22} color={COLORS.primary} />
              </TouchableOpacity>
            </View>

            {loading || !pack ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
            ) : (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('accountantPack.whatIsIn')}</Text>
                  {rows.map((row) => (
                    <View key={row.label} style={styles.row}>
                      <Ionicons name={row.icon} size={18} color={COLORS.primary} />
                      <Text style={styles.rowLabel}>{row.label}</Text>
                      <Text style={styles.rowValue}>{row.value}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('accountantPack.check')}</Text>
                  {pack.checks.length === 0 ? (
                    <View style={styles.row}>
                      <Ionicons name="checkmark-circle" size={18} color={COLORS.success} />
                      <Text style={styles.rowLabel}>{t('accountantPack.allThere')}</Text>
                    </View>
                  ) : pack.checks.map((check) => (
                    <View key={check.key} style={styles.checkRow}>
                      <Ionicons
                        name={check.severity === 'warning' ? 'alert-circle' : 'information-circle-outline'}
                        size={18}
                        color={check.severity === 'warning' ? COLORS.warning : COLORS.textSecondary}
                      />
                      <Text style={styles.checkText}>{check.message}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('accountantPack.send')}</Text>
                  {pack.last_sent && (
                    <Text style={styles.hint}>
                      {t('accountantPack.lastSent')
                        .replace('{date}', format(parseISO(pack.last_sent.sent_at), 'dd.MM.yyyy'))
                        .replace('{email}', pack.last_sent.sent_to)}
                    </Text>
                  )}
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t('accountantPack.emailPlaceholder')}
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {!pack.email_available && <Text style={styles.hint}>{t('accountantPack.emailUnavailable')}</Text>}
                  <TouchableOpacity
                    style={[styles.primaryButton, (sending || !pack.email_available) && { opacity: 0.5 }]}
                    onPress={send}
                    disabled={sending || !pack.email_available}
                  >
                    {sending ? <ActivityIndicator color="white" /> : (
                      <>
                        <Ionicons name="send" size={18} color="white" />
                        <Text style={styles.primaryButtonText}>{t('accountantPack.sendButton')}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryButton} onPress={download} disabled={downloading}>
                    {downloading ? <ActivityIndicator color={COLORS.primary} /> : (
                      <>
                        <Ionicons name="download-outline" size={18} color={COLORS.primary} />
                        <Text style={styles.secondaryButtonText}>{t('accountantPack.download')}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <Text style={styles.hint}>{t('accountantPack.contents')}</Text>
                </View>
                <View style={{ height: 32 }} />
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </ImageBackground>
    </ScreenEnter>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  content: { flex: 1, padding: 16 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  monthArrow: { padding: 8, backgroundColor: COLORS.surface, borderRadius: 10 },
  monthLabel: { color: 'white', fontSize: 18, fontWeight: '700' },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: 'white', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rowLabel: { flex: 1, color: COLORS.textLight, fontSize: 14 },
  rowValue: { color: 'white', fontSize: 14, fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  checkText: { flex: 1, color: COLORS.textLight, fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 17, marginTop: 8 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: 'white',
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  primaryButton: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
  },
  primaryButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  secondaryButtonText: { color: COLORS.primary, fontSize: 15, fontWeight: '600' },
});

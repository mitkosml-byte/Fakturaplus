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
  RefreshControl,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { format, parseISO } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import type { PaymentReminderItem, PaymentReminders } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';
import { formatMoney } from '../src/utils/money';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

type Draft = { email: string; subject: string; message: string };

const money = (n: number) => `${formatMoney(n)}`;
const dayLabel = (iso: string) => format(parseISO(iso), 'dd.MM.yyyy');

const STAGE_COLOR: Record<PaymentReminderItem['stage'], string> = {
  due: COLORS.primary,
  week: COLORS.warning,
  two_weeks: COLORS.danger,
};

// Payment reminders to customers (Н6): the program says when one is due -
// on the due date, a week and two weeks after it - and words it; the person
// reads it, changes what they like and sends it. Nothing goes by itself, and
// a stage is sent once.
export default function PaymentRemindersScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const allowed = hasPermission('add_revenue');

  const [data, setData] = useState<PaymentReminders | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    try {
      const result = await api.getPaymentReminders();
      setData(result);
      // The words the program offers, kept while the person edits them.
      setDrafts((current) => {
        const next: Record<string, Draft> = {};
        for (const item of [...result.suggested, ...result.other]) {
          const key = `${item.receivable_id}:${item.suggested ? item.stage : 'manual'}`;
          next[key] = current[key] || { email: item.email || '', subject: item.subject, message: item.message };
        }
        return next;
      });
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [allowed, t]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!allowed) return <AccessDenied />;

  const draftKey = (item: PaymentReminderItem) => `${item.receivable_id}:${item.suggested ? item.stage : 'manual'}`;

  const updateDraft = (item: PaymentReminderItem, change: Partial<Draft>) => {
    const key = draftKey(item);
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...change } }));
  };

  const send = async (item: PaymentReminderItem) => {
    const draft = drafts[draftKey(item)];
    if (!draft?.email.trim()) {
      Alert.alert(t('reminders.title'), t('reminders.enterEmail'));
      return;
    }
    setBusy(item.receivable_id);
    try {
      const result = await api.sendPaymentReminder(item.receivable_id, {
        stage: item.suggested ? item.stage : 'manual',
        email: draft.email.trim(),
        subject: draft.subject,
        message: draft.message,
      });
      Haptics.success();
      Toast.success(t('reminders.sent').replace('{email}', result.to));
      setOpen(null);
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setBusy(null);
    }
  };

  const record = async (item: PaymentReminderItem, action: 'skipped' | 'sent_other') => {
    setBusy(item.receivable_id);
    try {
      await api.recordPaymentReminder(item.receivable_id, item.stage, action);
      Toast.success(t('reminders.recorded'));
      setOpen(null);
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setBusy(null);
    }
  };

  // Another way: the phone's share sheet (a message, Viber...), else the clipboard.
  const share = async (item: PaymentReminderItem) => {
    const draft = drafts[draftKey(item)];
    const text = `${draft.subject}\n\n${draft.message}`;
    try {
      await Share.share({ message: text });
    } catch {
      await Clipboard.setStringAsync(text);
      Toast.success(t('reminders.copied'));
    }
  };

  const renderItem = (item: PaymentReminderItem) => {
    const isOpen = open === draftKey(item);
    const draft = drafts[draftKey(item)];
    const last = item.history[item.history.length - 1];
    return (
      <View key={draftKey(item)} style={styles.card}>
        <TouchableOpacity onPress={() => setOpen(isOpen ? null : draftKey(item))} activeOpacity={0.8}>
          <View style={styles.cardTop}>
            <Text style={styles.customer} numberOfLines={1}>{item.customer_name}</Text>
            {item.suggested ? (
              <View style={[styles.badge, { borderColor: STAGE_COLOR[item.stage] }]}>
                <Text style={[styles.badgeText, { color: STAGE_COLOR[item.stage] }]}>{t(`reminders.stage.${item.stage}`)}</Text>
              </View>
            ) : (
              <Text style={styles.late}>{t('reminders.daysLate').replace('{days}', String(item.days_overdue))}</Text>
            )}
          </View>
          <Text style={styles.label} numberOfLines={2}>
            {item.label} · {t('reminders.dueOn').replace('{date}', dayLabel(item.due_date))}
          </Text>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>{t('reminders.left')}</Text>
            <Text style={styles.amount}>{money(item.amount_left)}</Text>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} />
          </View>
          {last && (
            <Text style={styles.history}>
              {t('reminders.last')
                .replace('{date}', format(new Date(last.at), 'dd.MM'))
                .replace('{how}', t(`reminders.channel.${last.channel}`))}
            </Text>
          )}
        </TouchableOpacity>

        {isOpen && draft && (
          <View style={styles.editor}>
            <Text style={styles.fieldLabel}>{t('reminders.email')}</Text>
            <TextInput
              style={styles.input}
              value={draft.email}
              onChangeText={(email) => updateDraft(item, { email })}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="klient@primer.bg"
              placeholderTextColor={COLORS.textMuted}
            />
            <Text style={styles.fieldLabel}>{t('reminders.subject')}</Text>
            <TextInput
              style={styles.input}
              value={draft.subject}
              onChangeText={(subject) => updateDraft(item, { subject })}
              placeholderTextColor={COLORS.textMuted}
            />
            <Text style={styles.fieldLabel}>{t('reminders.message')}</Text>
            <TextInput
              style={[styles.input, styles.message]}
              value={draft.message}
              onChangeText={(message) => updateDraft(item, { message })}
              multiline
              textAlignVertical="top"
            />
            {item.document?.has_pdf && <Text style={styles.hint}>{t('reminders.withPdf')}</Text>}

            {data?.email_enabled && (
              <TouchableOpacity
                style={[styles.primaryButton, busy === item.receivable_id && { opacity: 0.6 }]}
                onPress={() => send(item)}
                disabled={busy === item.receivable_id}
              >
                {busy === item.receivable_id ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <View style={styles.buttonRow}>
                    <Ionicons name="send" size={16} color="white" />
                    <Text style={styles.primaryButtonText}>{t('reminders.send')}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
            <View style={styles.secondaryRow}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => share(item)}>
                <Ionicons name="share-outline" size={15} color={COLORS.primary} />
                <Text style={styles.secondaryText}>{t('reminders.share')}</Text>
              </TouchableOpacity>
              {item.suggested && (
                <TouchableOpacity style={styles.secondaryButton} onPress={() => record(item, 'sent_other')} disabled={busy === item.receivable_id}>
                  <Ionicons name="checkmark" size={15} color={COLORS.primary} />
                  <Text style={styles.secondaryText}>{t('reminders.markSent')}</Text>
                </TouchableOpacity>
              )}
              {item.suggested && (
                <TouchableOpacity style={styles.secondaryButton} onPress={() => record(item, 'skipped')} disabled={busy === item.receivable_id}>
                  <Ionicons name="close" size={15} color={COLORS.textSecondary} />
                  <Text style={[styles.secondaryText, { color: COLORS.textSecondary }]}>{t('reminders.skip')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('reminders.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            style={styles.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          >
            <Text style={styles.intro}>{t('reminders.intro')}</Text>
            {data && !data.email_enabled && (
              <View style={styles.notice}>
                <Ionicons name="information-circle-outline" size={18} color={COLORS.warning} />
                <Text style={styles.noticeText}>{t('reminders.emailOff')}</Text>
              </View>
            )}

            {loading || !data ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
            ) : data.suggested.length === 0 && data.other.length === 0 ? (
              <Text style={styles.empty}>{t('reminders.none')}</Text>
            ) : (
              <>
                {data.suggested.length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>{t('reminders.suggested')} ({data.suggested.length})</Text>
                    {data.suggested.map(renderItem)}
                  </>
                )}
                {data.other.length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>{t('reminders.other')} ({data.other.length})</Text>
                    {data.other.map(renderItem)}
                  </>
                )}
              </>
            )}
            <View style={{ height: 32 }} />
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
  intro: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19, marginBottom: 12 },
  notice: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  noticeText: { flex: 1, fontSize: 12, color: COLORS.textLight, lineHeight: 17 },
  empty: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 40 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: 'white', marginTop: 8, marginBottom: 8 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customer: { flex: 1, color: 'white', fontSize: 15, fontWeight: '600' },
  badge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  late: { color: COLORS.danger, fontSize: 12 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  amountLabel: { color: COLORS.textSecondary, fontSize: 12 },
  amount: { flex: 1, color: 'white', fontSize: 18, fontWeight: '700' },
  history: { color: COLORS.textMuted, fontSize: 11, marginTop: 4 },
  editor: { marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 4, marginTop: 8 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: 'white',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  message: { minHeight: 180 },
  hint: { color: COLORS.textMuted, fontSize: 11, marginTop: 6 },
  primaryButton: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 12 },
  primaryButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  secondaryText: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },
});

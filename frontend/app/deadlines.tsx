import React, { useCallback, useEffect, useState } from 'react';
import { AmbientGlow } from '../src/components/AmbientGlow';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import type { Deadline, DeadlineCategory, DeadlineRepeat } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied, ScreenEnter, BottomSheet } from '../src/components';
import DateTimePickerModal from '../src/components/AppDateTimePicker';
import { COLORS } from '../src/theme/colors';
import { formatMoney, readAmount } from '../src/utils/money';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const CATEGORIES: DeadlineCategory[] = ['insurance', 'inspection', 'contract', 'accountant', 'tax', 'license', 'other'];
const REPEATS: DeadlineRepeat[] = ['none', 'monthly', 'quarterly', 'half_yearly', 'yearly'];
const ICON: Record<DeadlineCategory, keyof typeof Ionicons.glyphMap> = {
  insurance: 'shield-checkmark-outline',
  inspection: 'construct-outline',
  contract: 'document-text-outline',
  accountant: 'calculator-outline',
  tax: 'receipt-outline',
  license: 'ribbon-outline',
  other: 'flag-outline',
};
const STATUS_COLOR: Record<Deadline['status'], string> = {
  overdue: COLORS.danger,
  soon: COLORS.warning,
  later: COLORS.textSecondary,
  done: COLORS.textMuted,
};

type Draft = {
  id: string | null;
  title: string;
  category: DeadlineCategory;
  date: Date;
  repeat: DeadlineRepeat;
  remind: string;
  amount: string;
  notes: string;
};

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

// The business's own deadlines (Н10): an insurance, an inspection, a
// contract, what the accountant needs by a date - entered by the owner,
// reminded before it (on Home and in the morning notification) and moved to
// its next date once done. No law is read; the dates are the owner's.
export default function DeadlinesScreen() {
  const router = useRouter();
  const { t, language, dateLocale } = useTranslation();
  const { user } = useAuth();
  const allowed = user?.role === 'owner' || user?.role === 'manager';

  const [items, setItems] = useState<Deadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    try {
      setItems(await api.getDeadlines());
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

  const dayText = (value: string) => format(parseISO(value), 'd MMMM yyyy', { locale: dateLocale });
  const whenText = (item: Deadline) => {
    if (item.status === 'done') return t('deadlines.done');
    if (item.days_left < 0) return t('deadlines.lateBy').replace('{days}', String(-item.days_left));
    if (item.days_left === 0) return t('deadlines.today');
    if (item.days_left === 1) return t('deadlines.tomorrow');
    return t('deadlines.inDays').replace('{days}', String(item.days_left));
  };

  const markDone = async (item: Deadline) => {
    setBusy(item.id);
    try {
      const updated = await api.markDeadlineDone(item.id, item.due_date);
      Haptics.success();
      Toast.success(updated.is_active
        ? t('deadlines.doneNext').replace('{date}', format(parseISO(updated.due_date), 'dd.MM.yyyy'))
        : t('deadlines.doneFinal'));
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const openNew = () => setDraft({
    id: null, title: '', category: 'other', date: new Date(), repeat: 'none', remind: '7', amount: '', notes: '',
  });

  const openEdit = (item: Deadline) => setDraft({
    id: item.id,
    title: item.title,
    category: item.category,
    date: parseISO(item.due_date),
    repeat: item.repeat === 'months' ? 'none' : item.repeat,
    remind: String(item.remind_days_before),
    amount: item.amount != null ? String(item.amount) : '',
    notes: item.notes || '',
  });

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      Alert.alert(t('common.error'), t('deadlines.invalid'));
      return;
    }
    const amount = draft.amount.trim() ? readAmount(draft.amount) : null;
    const body = {
      title: draft.title.trim(), category: draft.category, due_date: iso(draft.date), repeat: draft.repeat,
      remind_days_before: Math.max(0, Math.min(365, parseInt(draft.remind, 10) || 0)),
      amount: amount != null && Number.isFinite(amount) ? amount : null, notes: draft.notes.trim() || null,
    };
    setSaving(true);
    try {
      if (draft.id) await api.updateDeadline(draft.id, body);
      else await api.createDeadline(body);
      Toast.success(t('deadlines.saved'));
      setDraft(null);
      await load();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!draft?.id) return;
    const id = draft.id;
    Alert.alert(draft.title, t('deadlines.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteDeadline(id);
            setDraft(null);
            await load();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  const groups = (['overdue', 'soon', 'later', 'done'] as const)
    .map((status) => ({ status, items: items.filter((item) => item.status === status) }))
    .filter((group) => group.items.length > 0);

  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <AmbientGlow />
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('deadlines.title')}</Text>
            <TouchableOpacity onPress={openNew} style={styles.backButton} accessibilityLabel={t('deadlines.add')}>
              <Ionicons name="add" size={24} color="white" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          >
            <Text style={styles.intro}>{t('deadlines.intro')}</Text>
            {loading ? (
              <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
            ) : items.length === 0 ? (
              <Text style={styles.empty}>{t('deadlines.empty')}</Text>
            ) : (
              groups.map((group) => (
                <View key={group.status}>
                  <Text style={[styles.sectionTitle, { color: STATUS_COLOR[group.status] === COLORS.textSecondary ? 'white' : STATUS_COLOR[group.status] }]}>
                    {t(`deadlines.${group.status}`)}
                  </Text>
                  {group.items.map((item) => (
                    <TouchableOpacity key={item.id} style={styles.card} onPress={() => openEdit(item)} activeOpacity={0.85}>
                      <View style={styles.cardTop}>
                        <Ionicons name={ICON[item.category]} size={20} color={STATUS_COLOR[item.status]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.name}>{item.title}</Text>
                          <Text style={styles.sub}>
                            {dayText(item.due_date)} · <Text style={{ color: STATUS_COLOR[item.status] }}>{whenText(item)}</Text>
                          </Text>
                          <Text style={styles.sub}>
                            {t(`deadlines.category.${item.category}`)}
                            {item.repeat !== 'none' && item.repeat !== 'months' ? ` · ${t(`deadlines.repeat.${item.repeat}`)}` : ''}
                            {item.amount != null ? ` · ${formatMoney(item.amount)}` : ''}
                          </Text>
                          {!!item.notes && <Text style={styles.notes} numberOfLines={2}>{item.notes}</Text>}
                        </View>
                        {item.is_active && (item.status === 'overdue' || item.status === 'soon') && (
                          <TouchableOpacity
                            style={[styles.doneButton, busy === item.id && { opacity: 0.6 }]}
                            onPress={() => markDone(item)}
                            disabled={busy === item.id}
                          >
                            {busy === item.id ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.doneText}>{t('deadlines.markDone')}</Text>}
                          </TouchableOpacity>
                        )}
                      </View>
                      {item.next_dates.length > 1 && (
                        <Text style={styles.next}>
                          {t('deadlines.next').replace('{dates}', item.next_dates.slice(1).map((d) => format(parseISO(d), 'dd.MM.yyyy')).join(', '))}
                        </Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ))
            )}
            <View style={{ height: 32 }} />
          </ScrollView>

          <BottomSheet visible={!!draft} onClose={() => setDraft(null)}>
            {draft && (
              <View style={styles.sheet}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={styles.sheetTitle}>{draft.id ? draft.title : t('deadlines.add')}</Text>
                  <Text style={styles.label}>{t('deadlines.what')}</Text>
                  <TextInput
                    style={styles.input}
                    value={draft.title}
                    onChangeText={(title) => setDraft({ ...draft, title })}
                    placeholder={t('deadlines.whatPlaceholder')}
                    placeholderTextColor={COLORS.textMuted}
                  />
                  <View style={styles.chips}>
                    {CATEGORIES.map((category) => (
                      <TouchableOpacity
                        key={category}
                        style={[styles.chip, draft.category === category && styles.chipActive]}
                        onPress={() => setDraft({ ...draft, category })}
                      >
                        <Ionicons name={ICON[category]} size={13} color={draft.category === category ? 'white' : COLORS.textSecondary} />
                        <Text style={[styles.chipText, draft.category === category && styles.chipTextActive]}>
                          {t(`deadlines.category.${category}`)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.label}>{t('deadlines.date')}</Text>
                  <TouchableOpacity style={styles.input} onPress={() => setPicking(true)}>
                    <Text style={{ color: 'white' }}>{format(draft.date, 'd MMMM yyyy', { locale: dateLocale })}</Text>
                  </TouchableOpacity>
                  <DateTimePickerModal
                    isVisible={picking}
                    mode="date"
                    date={draft.date}
                    onConfirm={(d) => { setDraft({ ...draft, date: d }); setPicking(false); }}
                    onCancel={() => setPicking(false)}
                    confirmTextIOS={t('common.select')}
                    cancelTextIOS={t('common.cancel')}
                    locale={language}
                  />
                  <Text style={styles.label}>{t('deadlines.repeat')}</Text>
                  <View style={styles.chips}>
                    {REPEATS.map((repeat) => (
                      <TouchableOpacity
                        key={repeat}
                        style={[styles.chip, draft.repeat === repeat && styles.chipActive]}
                        onPress={() => setDraft({ ...draft, repeat })}
                      >
                        <Text style={[styles.chipText, draft.repeat === repeat && styles.chipTextActive]}>{t(`deadlines.repeat.${repeat}`)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>{t('deadlines.remind')}</Text>
                      <TextInput style={styles.input} value={draft.remind} keyboardType="number-pad" maxLength={3}
                        onChangeText={(remind) => setDraft({ ...draft, remind: remind.replace(/\D/g, '') })} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>{t('deadlines.amount')}</Text>
                      <TextInput style={styles.input} value={draft.amount} keyboardType="decimal-pad"
                        onChangeText={(amount) => setDraft({ ...draft, amount })} />
                    </View>
                  </View>
                  <Text style={styles.label}>{t('deadlines.notes')}</Text>
                  <TextInput style={[styles.input, { minHeight: 60 }]} value={draft.notes} multiline
                    onChangeText={(notes) => setDraft({ ...draft, notes })} />
                </ScrollView>
                <TouchableOpacity style={[styles.primaryButton, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>{t('common.save')}</Text>}
                </TouchableOpacity>
                {draft.id && (
                  <TouchableOpacity style={styles.deleteButton} onPress={remove}>
                    <Text style={styles.deleteText}>{t('common.delete')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </BottomSheet>
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
  empty: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 24 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  card: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { color: 'white', fontSize: 15, fontWeight: '600' },
  sub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },
  notes: { color: COLORS.textMuted, fontSize: 12, marginTop: 4 },
  next: { color: COLORS.textMuted, fontSize: 12, marginTop: 8, marginLeft: 30 },
  doneButton: { backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  doneText: { color: 'white', fontSize: 13, fontWeight: '600' },
  sheet: { padding: 16, flexShrink: 1 },
  sheetTitle: { color: 'white', fontSize: 17, fontWeight: '700', marginBottom: 8 },
  label: { color: COLORS.textSecondary, fontSize: 12, marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: 'white',
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textSecondary, fontSize: 12 },
  chipTextActive: { color: 'white', fontWeight: '600' },
  primaryButton: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 16 },
  primaryButtonText: { color: 'white', fontSize: 15, fontWeight: '600' },
  deleteButton: { alignItems: 'center', padding: 12, marginTop: 6 },
  deleteText: { color: COLORS.danger, fontWeight: '600' },
});

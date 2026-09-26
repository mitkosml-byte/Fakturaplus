import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { format } from 'date-fns';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { CalendarEvent } from '../src/types';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { AccessDenied } from '../src/components';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

const REMINDER_OPTIONS: { key: string; minutes: number | null }[] = [
  { key: 'none', minutes: null },
  { key: 'min15', minutes: 15 },
  { key: 'hour1', minutes: 60 },
  { key: 'day1', minutes: 1440 },
];

function toDateStr(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}
function toTimeStr(d: Date): string {
  return format(d, 'HH:mm');
}

export default function CalendarScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { hasPermission } = useAuth();

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState<Date>(new Date());
  const [hasTime, setHasTime] = useState(false);
  const [eventTime, setEventTime] = useState<Date>(new Date());
  const [visibility, setVisibility] = useState<'personal' | 'shared'>('personal');
  const [reminderKey, setReminderKey] = useState('none');
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const now = new Date();
      const start = toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
      const end = toDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90));
      const data = await api.getCalendarEvents(start, end);
      setEvents(data);
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents])
  );

  const grouped = useMemo(() => {
    const byDate = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      if (!byDate.has(ev.event_date)) byDate.set(ev.event_date, []);
      byDate.get(ev.event_date)!.push(ev);
    }
    return Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setEventDate(new Date());
    setHasTime(false);
    setEventTime(new Date());
    setVisibility('personal');
    setReminderKey('none');
  };

  const openCreateModal = () => {
    resetForm();
    setModalVisible(true);
  };

  const openEditModal = (ev: CalendarEvent) => {
    setEditingId(ev.id);
    setTitle(ev.title);
    setDescription(ev.description || '');
    setEventDate(new Date(`${ev.event_date}T00:00:00`));
    setHasTime(!!ev.event_time);
    if (ev.event_time) {
      setEventTime(new Date(`${ev.event_date}T${ev.event_time}:00`));
    }
    setVisibility(ev.visibility);
    const match = REMINDER_OPTIONS.find((o) => o.minutes === (ev.reminder_minutes_before ?? null));
    setReminderKey(match ? match.key : 'none');
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert(t('common.error'), t('calendar.titleRequired'));
      return;
    }
    setSaving(true);
    try {
      const reminderMinutes = REMINDER_OPTIONS.find((o) => o.key === reminderKey)?.minutes ?? null;
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        event_date: toDateStr(eventDate),
        event_time: hasTime ? toTimeStr(eventTime) : null,
        visibility,
        reminder_minutes_before: reminderMinutes,
      };
      if (editingId) {
        await api.updateCalendarEvent(editingId, payload);
      } else {
        await api.createCalendarEvent(payload);
      }
      setModalVisible(false);
      resetForm();
      await loadEvents();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (ev: CalendarEvent) => {
    Alert.alert(t('calendar.deleteTitle'), t('calendar.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteCalendarEvent(ev.id);
            await loadEvents();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  if (!hasPermission('team_collaboration')) {
    return <AccessDenied />;
  }

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('calendar.title')}</Text>
            <TouchableOpacity onPress={openCreateModal} style={styles.backButton} accessibilityLabel={t('calendar.newEvent')}>
              <Ionicons name="add" size={24} color="white" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#8B5CF6" />
            </View>
          ) : (
            <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 32 }}>
              {grouped.length === 0 && (
                <View style={styles.emptyContainer}>
                  <Ionicons name="calendar-outline" size={64} color="#334155" />
                  <Text style={styles.emptyText}>{t('calendar.noEvents')}</Text>
                </View>
              )}
              {grouped.map(([dateKey, dayEvents]) => (
                <View key={dateKey} style={styles.dayGroup}>
                  <Text style={styles.dayHeader}>
                    {format(new Date(`${dateKey}T00:00:00`), 'EEEE, d MMMM yyyy', { locale: dateLocale })}
                  </Text>
                  {dayEvents.map((ev) => (
                    <TouchableOpacity key={ev.id} style={styles.eventCard} onPress={() => openEditModal(ev)}>
                      <View style={styles.eventRow}>
                        <View style={styles.eventTitleRow}>
                          <Ionicons
                            name={ev.visibility === 'shared' ? 'people' : 'person'}
                            size={16}
                            color={ev.visibility === 'shared' ? '#10B981' : '#8B5CF6'}
                          />
                          <Text style={styles.eventTitle} numberOfLines={1}>{ev.title}</Text>
                        </View>
                        {ev.event_time && <Text style={styles.eventTime}>{ev.event_time}</Text>}
                      </View>
                      {!!ev.description && (
                        <Text style={styles.eventDescription} numberOfLines={2}>{ev.description}</Text>
                      )}
                      <View style={styles.eventFooter}>
                        <Text style={styles.eventMeta}>
                          {ev.visibility === 'shared' ? `${t('calendar.sharedBy')} ${ev.creator_name}` : t('calendar.personal')}
                          {ev.reminder_minutes_before ? ` · 🔔` : ''}
                        </Text>
                        <TouchableOpacity onPress={() => handleDelete(ev)} hitSlop={8}>
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}

          <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalOverlay}
            >
              <View style={styles.modalContent}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  <Text style={styles.modalTitle}>
                    {editingId ? t('calendar.editEvent') : t('calendar.newEvent')}
                  </Text>

                  <Text style={styles.inputLabel}>{t('calendar.eventTitle')}</Text>
                  <TextInput
                    style={styles.input}
                    value={title}
                    onChangeText={setTitle}
                    placeholder={t('calendar.eventTitlePlaceholder')}
                    placeholderTextColor="#64748B"
                  />

                  <Text style={styles.inputLabel}>{t('calendar.eventDescription')}</Text>
                  <TextInput
                    style={[styles.input, { height: 70 }]}
                    value={description}
                    onChangeText={setDescription}
                    placeholder={t('calendar.eventDescriptionPlaceholder')}
                    placeholderTextColor="#64748B"
                    multiline
                  />

                  <Text style={styles.inputLabel}>{t('calendar.eventDate')}</Text>
                  <TouchableOpacity style={styles.pickerButton} onPress={() => setDatePickerVisible(true)}>
                    <Ionicons name="calendar-outline" size={18} color="#8B5CF6" />
                    <Text style={styles.pickerButtonText}>{format(eventDate, 'd MMM yyyy', { locale: dateLocale })}</Text>
                  </TouchableOpacity>

                  <View style={styles.rowBetween}>
                    <Text style={styles.inputLabel}>{t('calendar.specificTime')}</Text>
                    <TouchableOpacity onPress={() => setHasTime((v) => !v)}>
                      <Ionicons name={hasTime ? 'checkbox' : 'square-outline'} size={22} color="#8B5CF6" />
                    </TouchableOpacity>
                  </View>
                  {hasTime && (
                    <TouchableOpacity style={styles.pickerButton} onPress={() => setTimePickerVisible(true)}>
                      <Ionicons name="time-outline" size={18} color="#8B5CF6" />
                      <Text style={styles.pickerButtonText}>{format(eventTime, 'HH:mm')}</Text>
                    </TouchableOpacity>
                  )}

                  <Text style={styles.inputLabel}>{t('calendar.visibility')}</Text>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, visibility === 'personal' && styles.chipActive]}
                      onPress={() => setVisibility('personal')}
                    >
                      <Text style={[styles.chipText, visibility === 'personal' && styles.chipTextActive]}>
                        {t('calendar.personal')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.chip, visibility === 'shared' && styles.chipActive]}
                      onPress={() => setVisibility('shared')}
                    >
                      <Text style={[styles.chipText, visibility === 'shared' && styles.chipTextActive]}>
                        {t('calendar.shared')}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.inputLabel}>{t('calendar.reminder')}</Text>
                  <View style={styles.chipRow}>
                    {REMINDER_OPTIONS.map((opt) => (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.chip, reminderKey === opt.key && styles.chipActive]}
                        onPress={() => setReminderKey(opt.key)}
                      >
                        <Text style={[styles.chipText, reminderKey === opt.key && styles.chipTextActive]}>
                          {t(`calendar.reminder_${opt.key}`)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    style={[styles.saveButton, saving && { opacity: 0.6 }]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    {saving ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.cancelButton} onPress={() => setModalVisible(false)}>
                    <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </Modal>

          <DateTimePickerModal
            isVisible={datePickerVisible}
            mode="date"
            date={eventDate}
            onConfirm={(d) => { setEventDate(d); setDatePickerVisible(false); }}
            onCancel={() => setDatePickerVisible(false)}
          />
          <DateTimePickerModal
            isVisible={timePickerVisible}
            mode="time"
            date={eventTime}
            onConfirm={(d) => { setEventTime(d); setTimePickerVisible(false); }}
            onCancel={() => setTimePickerVisible(false)}
          />
        </SafeAreaView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)' },
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 18, fontWeight: 'bold', color: 'white' },
  content: { flex: 1, padding: 16 },
  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 16, color: '#64748B', marginTop: 16 },
  dayGroup: { marginBottom: 18 },
  dayHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#C4B5FD',
    textTransform: 'capitalize',
    marginBottom: 8,
  },
  eventCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  eventRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  eventTitle: { fontSize: 15, fontWeight: '600', color: 'white', flex: 1 },
  eventTime: { fontSize: 13, color: '#94A3B8', marginLeft: 8 },
  eventDescription: { fontSize: 13, color: '#94A3B8', marginTop: 6 },
  eventFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  eventMeta: { fontSize: 12, color: '#64748B' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
  },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: 'white', marginBottom: 16 },
  inputLabel: { fontSize: 13, color: '#94A3B8', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: 'white',
    fontSize: 15,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerButtonText: { color: 'white', fontSize: 14 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#0F172A',
  },
  chipActive: { backgroundColor: '#8B5CF6' },
  chipText: { fontSize: 13, color: '#94A3B8', fontWeight: '500' },
  chipTextActive: { color: 'white' },
  saveButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  cancelButton: { alignItems: 'center', paddingVertical: 14 },
  cancelButtonText: { color: '#94A3B8', fontSize: 14 },
});

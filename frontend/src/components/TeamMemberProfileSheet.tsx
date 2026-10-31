import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Alert } from '../utils/alert';
import { Haptics } from '../utils/haptics';
import { api } from '../services/api';
import { TeamMemberProfile, TeamNote, TeamNoteType } from '../types';
import { useTranslation, useLanguageStore } from '../i18n';
import { useAuth } from '../contexts/AuthContext';
import { getRoleName, getRoleColor } from '../utils/roles';
import { COLORS } from '../theme/colors';
import { BottomSheet } from './BottomSheet';
import { Avatar } from './Avatar';

type Props = {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
};

// Opened by tapping a team member's avatar (e.g. the work-schedule grid) -
// everything a manager can already see about that person in one place,
// plus private positive/negative performance notes only managers ever see.
export function TeamMemberProfileSheet({ visible, userId, onClose }: Props) {
  const { t, dateLocale } = useTranslation();
  const { language } = useLanguageStore();
  const { user: currentUser } = useAuth();

  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<TeamMemberProfile | null>(null);
  const [addingType, setAddingType] = useState<TeamNoteType | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteTextError, setNoteTextError] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    if (!visible || !userId) {
      setProfile(null);
      setAddingType(null);
      setNoteText('');
      return;
    }
    setLoading(true);
    api.getTeamMemberProfile(userId)
      .then(setProfile)
      .catch((error: any) => Alert.alert(t('common.error'), error.message || t('teamProfile.loadError')))
      .finally(() => setLoading(false));
    // t() is a plain function from useTranslation(), recreated on every
    // render (not memoized) - listing it here would refire this effect on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, userId]);

  const refreshNotes = async () => {
    if (!userId) return;
    const notes = await api.getTeamNotes(userId);
    setProfile((prev) => (prev ? { ...prev, notes } : prev));
  };

  const handleSaveNote = async () => {
    if (!userId || !addingType) return;
    const text = noteText.trim();
    if (!text) {
      setNoteTextError(true);
      return;
    }
    setSavingNote(true);
    try {
      await api.createTeamNote({ user_id: userId, note_type: addingType, text });
      setAddingType(null);
      setNoteText('');
      setNoteTextError(false);
      Haptics.success();
      await refreshNotes();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message || t('teamProfile.noteSaveError'));
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = (note: TeamNote) => {
    Alert.alert(t('teamProfile.deleteNoteTitle'), t('teamProfile.deleteNoteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteTeamNote(note.id);
            await refreshNotes();
          } catch (error: any) {
            Alert.alert(t('common.error'), error.message);
          }
        },
      },
    ]);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.sheet}>
        {loading || !profile ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <Avatar uri={profile.member.picture} name={profile.member.name} size={56} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{profile.member.name}</Text>
                <View style={[styles.roleBadge, { backgroundColor: `${getRoleColor(profile.member.role)}20` }]}>
                  <Text style={[styles.roleBadgeText, { color: getRoleColor(profile.member.role) }]}>
                    {getRoleName(profile.member.role, language)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={26} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.memberSince}>
              {t('teamProfile.memberSince').replace('{date}', format(new Date(profile.member.created_at), 'd MMM yyyy', { locale: dateLocale }))}
            </Text>

            <View style={styles.card}>
              {profile.employee ? (
                <>
                  {profile.employee.position && (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{t('teamProfile.position')}</Text>
                      <Text style={styles.infoValue}>{profile.employee.position}</Text>
                    </View>
                  )}
                  {profile.employee.hire_date && (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{t('teamProfile.hireDate')}</Text>
                      <Text style={styles.infoValue}>{format(new Date(profile.employee.hire_date), 'd MMM yyyy', { locale: dateLocale })}</Text>
                    </View>
                  )}
                </>
              ) : (
                <Text style={styles.noLinkText}>{t('teamProfile.noEmployeeLink')}</Text>
              )}
            </View>

            <Text style={styles.sectionTitle}>{t('teamProfile.thisMonth')}</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{profile.schedule_summary.total_hours}</Text>
                <Text style={styles.statLabel}>{t('schedule.hoursThisMonth')}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{profile.schedule_summary.estimated_pay.toFixed(2)} €</Text>
                <Text style={styles.statLabel}>{t('schedule.estimatedPay')}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{profile.schedule_summary.shift_count}</Text>
                <Text style={styles.statLabel}>{t('schedule.shiftsThisMonth')}</Text>
              </View>
            </View>

            {profile.employee && (
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{profile.leave_entries.length}</Text>
                  <Text style={styles.statLabel}>{t('teamProfile.leaveCount')}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{profile.holiday_work_entries.length}</Text>
                  <Text style={styles.statLabel}>{t('teamProfile.holidayWorkCount')}</Text>
                </View>
              </View>
            )}

            <View style={styles.notesHeader}>
              <Text style={styles.sectionTitle}>{t('teamProfile.notesTitle')}</Text>
              <Text style={[
                styles.netScore,
                { color: profile.notes.net_score > 0 ? COLORS.success : profile.notes.net_score < 0 ? COLORS.danger : COLORS.textMuted },
              ]}>
                {profile.notes.net_score > 0 ? '+' : ''}{profile.notes.net_score}
              </Text>
            </View>
            <Text style={styles.notesHint}>{t('teamProfile.notesHint')}</Text>

            <View style={styles.noteTypeRow}>
              <TouchableOpacity
                style={[styles.noteTypeButton, { borderColor: COLORS.success }, addingType === 'positive' && { backgroundColor: `${COLORS.success}22` }]}
                onPress={() => { setAddingType('positive'); setNoteText(''); setNoteTextError(false); }}
              >
                <Ionicons name="add-circle-outline" size={16} color={COLORS.success} />
                <Text style={[styles.noteTypeText, { color: COLORS.success }]}>{t('teamProfile.addPositive')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.noteTypeButton, { borderColor: COLORS.danger }, addingType === 'negative' && { backgroundColor: `${COLORS.danger}22` }]}
                onPress={() => { setAddingType('negative'); setNoteText(''); setNoteTextError(false); }}
              >
                <Ionicons name="remove-circle-outline" size={16} color={COLORS.danger} />
                <Text style={[styles.noteTypeText, { color: COLORS.danger }]}>{t('teamProfile.addNegative')}</Text>
              </TouchableOpacity>
            </View>

            {addingType && (
              <View style={styles.addNoteBox}>
                <TextInput
                  style={[styles.noteInput, noteTextError && styles.noteInputError]}
                  value={noteText}
                  onChangeText={(v) => { setNoteText(v); setNoteTextError(false); }}
                  placeholder={t('teamProfile.notePlaceholder')}
                  placeholderTextColor={COLORS.textMuted}
                  multiline
                />
                {noteTextError && <Text style={styles.fieldErrorText}>{t('teamProfile.noteTextError')}</Text>}
                <View style={styles.addNoteActions}>
                  <TouchableOpacity style={styles.cancelButton} onPress={() => setAddingType(null)}>
                    <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveButton, savingNote && { opacity: 0.6 }]}
                    onPress={handleSaveNote}
                    disabled={savingNote}
                  >
                    {savingNote ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.saveButtonText}>{t('common.save')}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {profile.notes.notes.length === 0 ? (
              <Text style={styles.noNotesText}>{t('teamProfile.noNotes')}</Text>
            ) : (
              profile.notes.notes.map((note) => (
                <View key={note.id} style={styles.noteCard}>
                  <Ionicons
                    name={note.note_type === 'positive' ? 'add-circle' : 'remove-circle'}
                    size={18}
                    color={note.note_type === 'positive' ? COLORS.success : COLORS.danger}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.noteText}>{note.text}</Text>
                    <Text style={styles.noteMeta}>
                      {note.created_by_name} · {format(new Date(note.created_at), 'd MMM yyyy', { locale: dateLocale })}
                    </Text>
                  </View>
                  {currentUser?.user_id === note.created_by && (
                    <TouchableOpacity onPress={() => handleDeleteNote(note)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={16} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '90%',
    minHeight: 200,
  },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 19, fontWeight: 'bold', color: 'white' },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, marginTop: 4 },
  roleBadgeText: { fontSize: 11, fontWeight: '700' },
  memberSince: { fontSize: 12, color: COLORS.textMuted, marginTop: 10 },
  card: { backgroundColor: COLORS.background, borderRadius: 12, padding: 12, marginTop: 14 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  infoLabel: { fontSize: 13, color: COLORS.textSecondary },
  infoValue: { fontSize: 13, color: 'white', fontWeight: '600' },
  noLinkText: { fontSize: 12, color: COLORS.textMuted, fontStyle: 'italic' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: COLORS.primaryLight, marginTop: 18, marginBottom: 8 },
  statsRow: { flexDirection: 'row', backgroundColor: COLORS.background, borderRadius: 12, padding: 12, justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: 'bold', color: 'white' },
  statLabel: { fontSize: 10, color: COLORS.textMuted, marginTop: 2, textAlign: 'center' },
  notesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 0 },
  netScore: { fontSize: 20, fontWeight: 'bold' },
  notesHint: { fontSize: 11, color: COLORS.textMuted, marginBottom: 10 },
  noteTypeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  noteTypeButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, paddingVertical: 8,
  },
  noteTypeText: { fontSize: 12, fontWeight: '700' },
  addNoteBox: { backgroundColor: COLORS.background, borderRadius: 12, padding: 12, marginBottom: 12 },
  noteInput: { color: 'white', fontSize: 14, minHeight: 60, textAlignVertical: 'top' },
  noteInputError: { borderWidth: 1, borderColor: COLORS.danger, borderRadius: 8, padding: 6 },
  fieldErrorText: { fontSize: 11, color: COLORS.danger, marginTop: 4 },
  addNoteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  cancelButton: { paddingVertical: 8, paddingHorizontal: 12 },
  cancelButtonText: { color: COLORS.textSecondary, fontSize: 13 },
  saveButton: { backgroundColor: COLORS.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  saveButtonText: { color: 'white', fontSize: 13, fontWeight: '700' },
  noNotesText: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', paddingVertical: 20 },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: COLORS.background, borderRadius: 10, padding: 10, marginBottom: 8 },
  noteText: { fontSize: 13, color: 'white' },
  noteMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 4 },
});

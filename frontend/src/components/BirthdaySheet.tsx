import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n';
import { api } from '../services/api';
import { Alert } from '../utils/alert';
import { Toast } from '../utils/toast';
import { COLORS } from '../theme/colors';
import { PressableScale } from './PressableScale';

type Props = {
  visible: boolean;
  birthday: string | null;
  onClose: () => void;
  onSaved: (birthday: string | null) => void;
};

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// One's own birthday - day and month only, never the year: the team sees
// it on the day and the owner's greeting comes. Optional, removable.
export function BirthdaySheet({ visible, birthday, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDay(birthday ? String(Number(birthday.slice(3))) : '');
    setMonth(birthday ? String(Number(birthday.slice(0, 2))) : '');
  }, [visible, birthday]);

  const save = async (value: string | null) => {
    setSaving(true);
    try {
      const result = await api.setMyBirthday(value);
      Toast.success(t('birthday.saved'));
      onSaved(result.birthday);
      onClose();
    } catch (error: any) {
      Alert.alert(t('common.error'), error?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN_MONTH[m - 1])) {
      Alert.alert(t('common.error'), t('birthday.invalid'));
      return;
    }
    save(`${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="gift-outline" size={22} color={COLORS.primary} />
            <Text style={styles.title}>{t('birthday.title')}</Text>
          </View>
          <Text style={styles.explain}>{t('birthday.explain')}</Text>
          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={styles.label}>{t('birthday.day')}</Text>
              <TextInput
                style={styles.input} value={day} onChangeText={setDay} keyboardType="number-pad"
                maxLength={2} placeholder={t('birthday.dayHint')} placeholderTextColor={COLORS.textMuted}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('birthday.month')}</Text>
              <TextInput
                style={styles.input} value={month} onChangeText={setMonth} keyboardType="number-pad"
                maxLength={2} placeholder={t('birthday.monthHint')} placeholderTextColor={COLORS.textMuted}
              />
            </View>
          </View>
          <View style={styles.buttons}>
            {birthday ? (
              <TouchableOpacity style={styles.secondary} onPress={() => save(null)} disabled={saving}>
                <Text style={styles.secondaryText}>{t('birthday.remove')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.secondary} onPress={onClose} disabled={saving}>
                <Text style={styles.secondaryText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            )}
            <PressableScale style={styles.primary} onPress={submit} disabled={saving}>
              {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>{t('common.save')}</Text>}
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 18, width: '100%', maxWidth: 460, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 18, fontWeight: '700', color: 'white' },
  explain: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19, marginTop: 10 },
  fields: { flexDirection: 'row', gap: 12, marginTop: 14 },
  field: { flex: 1, minWidth: 0 },
  label: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.background, borderRadius: 10, padding: 12, color: 'white', fontSize: 16,
    borderWidth: 1, borderColor: COLORS.border, textAlign: 'center', minWidth: 0,
  },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 18 },
  secondary: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  secondaryText: { color: COLORS.textSecondary, fontWeight: '600' },
  primary: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: COLORS.primary },
  primaryText: { color: 'white', fontWeight: '700' },
});

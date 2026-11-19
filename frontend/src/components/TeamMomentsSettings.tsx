import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { useTranslation } from '../i18n';
import { api } from '../services/api';
import { Alert } from '../utils/alert';
import { COLORS } from '../theme/colors';

type Moments = { birthdays: boolean; holidays: boolean };

// The owner's choice: does the app greet birthdays (a message from the
// owner and the managers) and remind the team of holidays in the team chat.
export function TeamMomentsSettings() {
  const { t } = useTranslation();
  const [moments, setMoments] = useState<Moments | null>(null);

  useEffect(() => {
    api.getTeamMoments().then(setMoments).catch(() => setMoments(null));
  }, []);

  if (!moments) return null;

  const toggle = async (key: keyof Moments, value: boolean) => {
    const before = moments;
    setMoments({ ...moments, [key]: value });
    try {
      setMoments(await api.setTeamMoments({ [key]: value }));
    } catch (error: any) {
      setMoments(before);
      Alert.alert(t('common.error'), error?.message || '');
    }
  };

  const Row = ({ keyName, title, hint }: { keyName: keyof Moments; title: string; hint: string }) => (
    <View style={styles.row}>
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch value={moments[keyName]} onValueChange={(value) => toggle(keyName, value)} />
    </View>
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('teamMoments.title')}</Text>
      <Row keyName="birthdays" title={t('teamMoments.birthdays')} hint={t('teamMoments.birthdaysHint')} />
      <Row keyName="holidays" title={t('teamMoments.holidays')} hint={t('teamMoments.holidaysHint')} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: 'white', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  texts: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600', color: 'white' },
  hint: { fontSize: 12, color: COLORS.textMuted, marginTop: 3, lineHeight: 17 },
});

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns/format';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';

// A second step at login is required of the owner and the accountant: until
// its day, Home says by when, with a way straight to it. Gone once it is on.
export function TwoFactorDueCard() {
  const { user } = useAuth();
  const { t, dateLocale } = useTranslation();
  const router = useRouter();
  if (!user?.two_factor_due_at || user.two_factor_enabled || user.two_factor_overdue) return null;
  const due = format(new Date(user.two_factor_due_at), 'd MMMM', { locale: dateLocale });

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />
        <Text style={styles.title}>{t('twoFactorDue.title')}</Text>
      </View>
      <Text style={styles.text}>{t('twoFactorDue.text').replace('{date}', due)}</Text>
      <TouchableOpacity style={styles.button} onPress={() => router.push('/account-security')} accessibilityRole="button">
        <Text style={styles.buttonText}>{t('twoFactorDue.button')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.45)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: 'white', fontSize: 16, fontWeight: '700' },
  text: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  button: { alignSelf: 'flex-start', backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  buttonText: { color: 'white', fontSize: 14, fontWeight: '700' },
});

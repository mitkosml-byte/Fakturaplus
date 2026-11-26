import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import { Toast } from '../../utils/toast';
import { Alert } from '../../utils/alert';

type Props = {
  // After joining the business that invited the person: Home loads again.
  onJoined?: () => void;
};

// The email of a new account is confirmed with the 6-digit code sent to it
// (P1-7). Until then the account works in its own business, but joins no
// one's team - an invitation used at registration waits for the code. Gone
// once the email is confirmed.
export function EmailVerifyCard({ onJoined }: Props) {
  const { user, setUser, refreshUser } = useAuth();
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!user || user.email_verified !== false) return null;

  const confirm = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) {
      setNote(t('verifyEmail.sixDigits'));
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const result = await api.verifyEmail(digits);
      setUser(result.user);
      setCode('');
      if (result.joined_company) {
        Toast.success(t('verifyEmail.joined').replace('{company}', result.joined_company.name));
        onJoined?.();
      } else if (result.invite_error) {
        Alert.alert(t('verifyEmail.done'), t('verifyEmail.inviteFailed').replace('{reason}', result.invite_error));
      } else {
        Toast.success(t('verifyEmail.done'));
      }
    } catch (error: any) {
      setNote(error?.message || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await api.resendEmailCode();
      if (result.already_verified) {
        await refreshUser();
        return;
      }
      setNote(result.sent ? t('verifyEmail.sentAgain') : t('verifyEmail.notSent'));
    } catch (error: any) {
      setNote(error?.message || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="mail-unread" size={20} color={COLORS.warning} />
        <Text style={styles.title}>{t('verifyEmail.title')}</Text>
      </View>
      <Text style={styles.text}>
        {t('verifyEmail.text').replace('{email}', user.email)}
        {user.invite_pending ? ` ${t('verifyEmail.invitePending')}` : ''}
      </Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, code ? styles.inputFilled : null]}
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
          placeholder={t('verifyEmail.placeholder')}
          placeholderTextColor={COLORS.textMuted}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          onSubmitEditing={confirm}
          editable={!busy}
          accessibilityLabel={t('verifyEmail.placeholder')}
        />
        <TouchableOpacity style={[styles.button, busy && styles.buttonBusy]} onPress={confirm} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.buttonText}>{t('verifyEmail.confirm')}</Text>}
        </TouchableOpacity>
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      <TouchableOpacity onPress={resend} disabled={busy} hitSlop={8} accessibilityRole="button">
        <Text style={styles.link}>{t('verifyEmail.resend')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: 'white', fontSize: 16, fontWeight: '700' },
  text: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: 'white',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  // The digits spaced out once typed - the placeholder stays readable.
  inputFilled: { fontSize: 18, letterSpacing: 4, paddingVertical: 10 },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 104,
    alignItems: 'center',
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: 'white', fontSize: 15, fontWeight: '700' },
  note: { color: COLORS.warning, fontSize: 13 },
  link: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
});

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';

type Props = {
  visible: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  // A new password is typed twice; one that opens something, once.
  repeat?: boolean;
  minLength?: number;
  busy?: boolean;
  // What the server answered (a wrong password...).
  error?: string | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

// A password asked for in the app's own sheet (the web's prompt() cannot
// hide what is typed): the backup's password, new or to open a file.
export function PasswordPrompt({ visible, title, text, confirmLabel, repeat, minLength = 1, busy, error, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [again, setAgain] = useState('');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setValue('');
      setAgain('');
      setNote(null);
    }
  }, [visible]);

  const submit = () => {
    if (value.length < minLength) {
      setNote(t('backup.passwordShort'));
      return;
    }
    if (repeat && value !== again) {
      setNote(t('backup.passwordMismatch'));
      return;
    }
    setNote(null);
    onSubmit(value);
  };

  const shown = note || error;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.text}>{text}</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={repeat ? t('backup.passwordNew') : t('backup.password')}
            placeholderTextColor={COLORS.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={repeat ? 'new-password' : 'current-password'}
            onSubmitEditing={repeat ? undefined : submit}
            editable={!busy}
            accessibilityLabel={repeat ? t('backup.passwordNew') : t('backup.password')}
          />
          {repeat && (
            <TextInput
              style={styles.input}
              value={again}
              onChangeText={setAgain}
              placeholder={t('backup.passwordRepeat')}
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              onSubmitEditing={submit}
              editable={!busy}
              accessibilityLabel={t('backup.passwordRepeat')}
            />
          )}
          {shown ? <Text style={styles.error}>{shown}</Text> : null}
          <View style={styles.buttons}>
            <TouchableOpacity style={[styles.button, styles.cancel]} onPress={onCancel} disabled={busy} accessibilityRole="button">
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.confirm, busy && styles.busy]} onPress={submit} disabled={busy} accessibilityRole="button">
              {busy ? <ActivityIndicator color="white" size="small" /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  sheet: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    gap: 12,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  title: { color: 'white', fontSize: 18, fontWeight: '700' },
  text: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: 'white',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  error: { color: COLORS.warning, fontSize: 13 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  cancel: { backgroundColor: 'rgba(255,255,255,0.08)' },
  cancelText: { color: COLORS.textSecondary, fontSize: 15, fontWeight: '600' },
  confirm: { backgroundColor: COLORS.primary },
  confirmText: { color: 'white', fontSize: 15, fontWeight: '700' },
  busy: { opacity: 0.7 },
});

import React, { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { Alert } from '../src/utils/alert';
import { api } from '../src/services/api';
import { useLanguageStore } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function AccountSecurityScreen() {
  const router = useRouter();
  const { language } = useLanguageStore();
  const { user, refreshUser } = useAuth();
  const hasPassword = !!user?.has_password;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const t = (bg: string, en: string) => (language === 'bg' ? bg : en);

  const handleSave = async () => {
    if (hasPassword && !currentPassword.trim()) {
      Alert.alert(t('Грешка', 'Error'), t('Въведете текущата си парола', 'Enter your current password'));
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert(t('Грешка', 'Error'), t('Паролата трябва да е поне 8 символа', 'Password must be at least 8 characters'));
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      Alert.alert(t('Грешка', 'Error'), t('Паролата трябва да съдържа буква и цифра', 'Password must contain a letter and a digit'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('Грешка', 'Error'), t('Паролите не съвпадат', 'Passwords do not match'));
      return;
    }

    setSaving(true);
    try {
      await api.changePassword(newPassword, hasPassword ? currentPassword : undefined);
      await refreshUser();
      Alert.alert(
        t('Успех', 'Success'),
        hasPassword
          ? t('Паролата е сменена успешно', 'Password changed successfully')
          : t('Паролата е зададена успешно. Вече можете да влизате и с имейл.', 'Password set successfully. You can now also log in with email.')
      );
      router.back();
    } catch (error: any) {
      Alert.alert(t('Грешка', 'Error'), error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>{t('Акаунт и сигурност', 'Account & Security')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                  <Ionicons name="lock-closed" size={24} color="#8B5CF6" />
                </View>
                <View style={styles.sectionTitleContainer}>
                  <Text style={styles.sectionTitle}>
                    {hasPassword ? t('Смяна на парола', 'Change Password') : t('Задаване на парола', 'Set Password')}
                  </Text>
                  <Text style={styles.sectionSubtitle}>
                    {hasPassword
                      ? t('Актуализирайте паролата за вход', 'Update your login password')
                      : t('Влизате с Google. Задайте парола, за да можете да влизате и с имейл.', 'You sign in with Google. Set a password to also log in with email.')}
                  </Text>
                </View>
              </View>

              {hasPassword && (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{t('Текуща парола', 'Current password')}</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      style={styles.passwordInput}
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      secureTextEntry={!showCurrent}
                      placeholder="••••••••"
                      placeholderTextColor="#64748B"
                    />
                    <TouchableOpacity onPress={() => setShowCurrent(!showCurrent)}>
                      <Ionicons name={showCurrent ? 'eye-off-outline' : 'eye-outline'} size={20} color="#64748B" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>{t('Нова парола', 'New password')}</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showNew}
                    placeholder="••••••••"
                    placeholderTextColor="#64748B"
                  />
                  <TouchableOpacity onPress={() => setShowNew(!showNew)}>
                    <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={20} color="#64748B" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.inputHint}>
                  {t('Поне 8 символа, с буква и цифра', 'At least 8 characters, with a letter and a digit')}
                </Text>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>{t('Потвърди нова парола', 'Confirm new password')}</Text>
                <TextInput
                  style={[styles.passwordInput, styles.fullWidthInput]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showNew}
                  placeholder="••••••••"
                  placeholderTextColor="#64748B"
                />
              </View>
            </View>

            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={24} color="#64748B" />
              <Text style={styles.infoText}>
                {t('Имейлът за вход е ', 'Login email is ')}
                <Text style={{ color: '#E2E8F0', fontWeight: '600' }}>{user?.email}</Text>
                {t('. Смяната на имейл не е налична в момента.', '. Changing the email is not available yet.')}
              </Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.saveButtonText}>
                  {hasPassword ? t('Смени паролата', 'Change password') : t('Задай парола', 'Set password')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </ImageBackground>
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
  section: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sectionTitleContainer: { flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: 'white' },
  sectionSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  inputContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  inputLabel: { fontSize: 14, color: '#94A3B8', marginBottom: 8 },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    color: 'white',
    fontSize: 16,
  },
  fullWidthInput: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputHint: { fontSize: 12, color: '#64748B', marginTop: 8 },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  infoText: { flex: 1, fontSize: 13, color: '#64748B', lineHeight: 20 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: '#1E293B' },
  saveButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});

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
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import { useTranslation } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';
import { ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function AccountSecurityScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const hasPassword = !!user?.has_password;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (hasPassword && !currentPassword.trim()) {
      Alert.alert(t('common.error'), t('accountSecurity.enterCurrentPassword'));
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert(t('common.error'), t('accountSecurity.passwordMinLength'));
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      Alert.alert(t('common.error'), t('accountSecurity.passwordComplexity'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('common.error'), t('accountSecurity.passwordsDontMatch'));
      return;
    }

    setSaving(true);
    try {
      await api.changePassword(newPassword, hasPassword ? currentPassword : undefined);
      await refreshUser();
      Haptics.success();
      Toast.success(
        hasPassword
          ? t('accountSecurity.passwordChanged')
          : t('accountSecurity.passwordSet')
      );
      router.back();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSaving(false);
    }
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
            <Text style={styles.title}>{t('accountSecurity.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                  <Ionicons name="lock-closed" size={24} color={COLORS.primary} />
                </View>
                <View style={styles.sectionTitleContainer}>
                  <Text style={styles.sectionTitle}>
                    {hasPassword ? t('accountSecurity.changePassword') : t('accountSecurity.setPassword')}
                  </Text>
                  <Text style={styles.sectionSubtitle}>
                    {hasPassword
                      ? t('accountSecurity.updatePasswordHint')
                      : t('accountSecurity.googleSetPasswordHint')}
                  </Text>
                </View>
              </View>

              {hasPassword && (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{t('accountSecurity.currentPassword')}</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      style={styles.passwordInput}
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      secureTextEntry={!showCurrent}
                      placeholder="••••••••"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <TouchableOpacity onPress={() => setShowCurrent(!showCurrent)}>
                      <Ionicons name={showCurrent ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>{t('accountSecurity.newPassword')}</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showNew}
                    placeholder="••••••••"
                    placeholderTextColor={COLORS.textMuted}
                  />
                  <TouchableOpacity onPress={() => setShowNew(!showNew)}>
                    <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textMuted} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.inputHint}>
                  {t('accountSecurity.passwordHint')}
                </Text>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>{t('accountSecurity.confirmNewPassword')}</Text>
                <TextInput
                  style={[styles.passwordInput, styles.fullWidthInput]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showNew}
                  placeholder="••••••••"
                  placeholderTextColor={COLORS.textMuted}
                />
              </View>
            </View>

            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={24} color={COLORS.textMuted} />
              <Text style={styles.infoText}>
                {t('accountSecurity.loginEmailIs')}
                <Text style={{ color: COLORS.textLight, fontWeight: '600' }}>{user?.email}</Text>
                {t('accountSecurity.emailChangeUnavailable')}
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
                  {hasPassword ? t('accountSecurity.changePasswordButton') : t('accountSecurity.setPasswordButton')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
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
  section: {
    backgroundColor: COLORS.surface,
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
  sectionSubtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  inputContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  inputLabel: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 8 },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    color: 'white',
    fontSize: 16,
  },
  fullWidthInput: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  inputHint: { fontSize: 12, color: COLORS.textMuted, marginTop: 8 },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  infoText: { flex: 1, fontSize: 13, color: COLORS.textMuted, lineHeight: 20 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: COLORS.surface },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});

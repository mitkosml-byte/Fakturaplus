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
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
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
import { format } from 'date-fns/format';
import { COLORS } from '../src/theme/colors';
import type { TwoFactorMethod, TwoFactorSetup, TwoFactorStatus } from '../src/types';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function AccountSecurityScreen() {
  const router = useRouter();
  const { t, dateLocale } = useTranslation();
  const { user, refreshUser, logout } = useAuth();
  const hasPassword = !!user?.has_password;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deletePassword, setDeletePassword] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  const handleDeleteAccount = () => {
    if (hasPassword && !deletePassword.trim()) {
      Alert.alert(t('common.error'), t('accountSecurity.enterPasswordToDelete'));
      return;
    }
    Alert.alert(
      t('accountSecurity.deleteAccountTitle'),
      t('accountSecurity.deleteAccountConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('accountSecurity.deleteAccountConfirmButton'),
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await api.deleteAccount(hasPassword ? deletePassword : undefined);
              Haptics.success();
              // Root layout's auth guard redirects to "/login" as soon as
              // isAuthenticated flips false, same as the regular logout
              // flow - no manual navigation needed.
              await logout();
            } catch (error: any) {
              Alert.alert(t('common.error'), error.message);
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

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
            <Text style={styles.title}>{t('accountSecurity.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
            {/* Required of the owner and the accountant: first on the
                screen, and past its day the only way on. */}
            {user?.two_factor_due_at && (
              <>
                <View style={styles.requiredNote}>
                  <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />
                  <Text style={styles.requiredText}>
                    {user.two_factor_overdue
                      ? t('twoFactorDue.overdue')
                      : t('twoFactorDue.text').replace('{date}', format(new Date(user.two_factor_due_at), 'd MMMM', { locale: dateLocale }))}
                  </Text>
                  {user.two_factor_overdue && (
                    <TouchableOpacity onPress={() => logout()} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.requiredLogout}>{t('twoFactorDue.logout')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TwoFactorSection hasPassword={hasPassword} onChanged={refreshUser} />
              </>
            )}
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

            {!user?.two_factor_due_at && <TwoFactorSection hasPassword={hasPassword} onChanged={refreshUser} />}

            <View style={styles.dangerSection}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                  <Ionicons name="warning" size={24} color={COLORS.danger} />
                </View>
                <View style={styles.sectionTitleContainer}>
                  <Text style={[styles.sectionTitle, { color: COLORS.danger }]}>
                    {t('accountSecurity.deleteAccountTitle')}
                  </Text>
                  <Text style={styles.sectionSubtitle}>{t('accountSecurity.deleteAccountHint')}</Text>
                </View>
              </View>

              {hasPassword && (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{t('accountSecurity.currentPassword')}</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      style={styles.passwordInput}
                      value={deletePassword}
                      onChangeText={setDeletePassword}
                      secureTextEntry={!showDeletePassword}
                      placeholder="••••••••"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    <TouchableOpacity onPress={() => setShowDeletePassword(!showDeletePassword)}>
                      <Ionicons name={showDeletePassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={[styles.deleteButton, deleting && styles.saveButtonDisabled]}
                onPress={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator color={COLORS.danger} />
                ) : (
                  <Text style={styles.deleteButtonText}>{t('accountSecurity.deleteAccountButton')}</Text>
                )}
              </TouchableOpacity>
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

// The second step at login: turned on with a first right code (from an
// authenticator app, or sent by email), then the recovery codes shown once;
// turned off with the password and a code.
function TwoFactorSection({ hasPassword, onChanged }: { hasPassword: boolean; onChanged: () => Promise<void> | void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [onPassword, setOnPassword] = useState('');
  const [offPassword, setOffPassword] = useState('');
  const [offCode, setOffCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api.getTwoFactor());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const start = async (method: TwoFactorMethod) => {
    if (hasPassword && !onPassword.trim()) {
      Alert.alert(t('common.error'), t('accountSecurity.enterCurrentPassword'));
      return;
    }
    setBusy(true);
    try {
      setSetup(await api.setupTwoFactor(method, onPassword || undefined));
      setOnPassword('');
      setCode('');
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setBusy(false);
    }
  };

  const turnOn = async () => {
    if (!code.trim()) {
      Alert.alert(t('common.error'), t('login.enterCode'));
      return;
    }
    setBusy(true);
    try {
      const result = await api.enableTwoFactor(code.trim());
      setRecoveryCodes(result.recovery_codes);
      setSetup(null);
      setCode('');
      Haptics.success();
      await load();
      await onChanged();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (hasPassword && !offPassword.trim()) {
      Alert.alert(t('common.error'), t('accountSecurity.enterCurrentPassword'));
      return;
    }
    setBusy(true);
    try {
      await api.disableTwoFactor(offPassword || undefined, offCode.trim() || undefined);
      setOffPassword('');
      setOffCode('');
      Toast.success(t('accountSecurity.twoFactorOff'));
      await load();
      await onChanged();
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setBusy(false);
    }
  };

  const openInApp = async (uri: string, secret: string) => {
    try {
      await Linking.openURL(uri);
    } catch {
      // No app that takes the link here (a computer, say): the key, typed in.
      await Clipboard.setStringAsync(secret);
      Toast.success(t('accountSecurity.keyCopied'));
    }
  };

  if (!status) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
          <Ionicons name={status.enabled ? 'shield-checkmark' : 'shield-outline'} size={24} color={COLORS.success} />
        </View>
        <View style={styles.sectionTitleContainer}>
          <Text style={styles.sectionTitle}>{t('accountSecurity.twoFactorTitle')}</Text>
          <Text style={styles.sectionSubtitle}>
            {status.enabled
              ? (status.method === 'email' ? t('accountSecurity.twoFactorOnEmail') : t('accountSecurity.twoFactorOnApp'))
              : t('accountSecurity.twoFactorHint')}
          </Text>
        </View>
      </View>

      {recoveryCodes && (
        <View style={styles.recoveryBox}>
          <Text style={styles.recoveryTitle}>{t('accountSecurity.recoveryTitle')}</Text>
          <Text style={styles.inputHint}>{t('accountSecurity.recoveryHint')}</Text>
          <View style={styles.recoveryGrid}>
            {recoveryCodes.map((c) => (
              <Text key={c} selectable style={styles.recoveryCode}>{c}</Text>
            ))}
          </View>
          <View style={styles.twoFactorRow}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={async () => {
                await Clipboard.setStringAsync(recoveryCodes.join('\n'));
                Toast.success(t('accountSecurity.codesCopied'));
              }}
            >
              <Text style={styles.secondaryButtonText}>{t('accountSecurity.copyCodes')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primarySmallButton} onPress={() => setRecoveryCodes(null)}>
              <Text style={styles.saveButtonText}>{t('accountSecurity.savedThem')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {status.enabled && !recoveryCodes && (
        <View style={styles.inputContainer}>
          <Text style={styles.inputHint}>
            {t('accountSecurity.recoveryCodesLeft').replace('{count}', String(status.recovery_codes_left))}
          </Text>
          <Text style={[styles.inputHint, { marginBottom: 8 }]}>{t('accountSecurity.turnOffHint')}</Text>
          {hasPassword && (
            <TextInput
              style={[styles.passwordInput, styles.fullWidthInput, { marginBottom: 8 }]}
              value={offPassword}
              onChangeText={setOffPassword}
              secureTextEntry
              placeholder={t('accountSecurity.currentPassword')}
              placeholderTextColor={COLORS.textMuted}
            />
          )}
          {status.method === 'totp' && (
            <TextInput
              style={[styles.passwordInput, styles.fullWidthInput, { marginBottom: 8 }]}
              value={offCode}
              onChangeText={(v) => setOffCode(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={9}
              placeholder={t('accountSecurity.codePlaceholder')}
              placeholderTextColor={COLORS.textMuted}
            />
          )}
          <TouchableOpacity style={[styles.deleteButton, busy && styles.saveButtonDisabled]} onPress={turnOff} disabled={busy}>
            <Text style={styles.deleteButtonText}>{t('accountSecurity.turnOff')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!status.enabled && !setup && (
        <View style={styles.inputContainer}>
          {status.recommended && (
            <Text style={[styles.inputHint, { marginTop: 0, marginBottom: 12 }]}>{t('accountSecurity.twoFactorRecommended')}</Text>
          )}
          {hasPassword && (
            <TextInput
              style={[styles.passwordInput, styles.fullWidthInput, { marginBottom: 8 }]}
              value={onPassword}
              onChangeText={setOnPassword}
              secureTextEntry
              placeholder={t('accountSecurity.currentPassword')}
              placeholderTextColor={COLORS.textMuted}
            />
          )}
          <TouchableOpacity style={styles.methodButton} onPress={() => start('totp')} disabled={busy}>
            <Ionicons name="phone-portrait-outline" size={22} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>{t('accountSecurity.useApp')}</Text>
              <Text style={styles.sectionSubtitle}>{t('accountSecurity.useAppHint')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.methodButton, !status.email_available && styles.saveButtonDisabled]}
            onPress={() => start('email')}
            disabled={busy || !status.email_available}
          >
            <Ionicons name="mail-outline" size={22} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.methodTitle}>{t('accountSecurity.useEmail')}</Text>
              {!status.email_available && (
                <Text style={styles.sectionSubtitle}>{t('accountSecurity.emailUnavailable')}</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {!status.enabled && setup && (
        <View style={styles.inputContainer}>
          {setup.method === 'totp' && setup.secret && setup.otpauth_uri ? (
            <>
              <Text style={[styles.inputHint, { marginTop: 0, marginBottom: 12 }]}>{t('accountSecurity.appSetupSteps')}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => openInApp(setup.otpauth_uri!, setup.secret!)}>
                <Text style={styles.secondaryButtonText}>{t('accountSecurity.openInApp')}</Text>
              </TouchableOpacity>
              <Text style={[styles.inputLabel, { marginTop: 12 }]}>{t('accountSecurity.secretKey')}</Text>
              <Text selectable style={styles.secretKey}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</Text>
              <TouchableOpacity
                onPress={async () => {
                  await Clipboard.setStringAsync(setup.secret!);
                  Toast.success(t('accountSecurity.keyCopied'));
                }}
              >
                <Text style={styles.linkText}>{t('accountSecurity.copyKey')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={[styles.inputHint, { marginTop: 0, marginBottom: 12 }]}>
              {t('accountSecurity.emailCodeSent').replace('{email}', setup.sent_to || '')}
            </Text>
          )}
          <TextInput
            style={[styles.passwordInput, styles.fullWidthInput, styles.codeField, !!code && styles.codeFieldFilled]}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={6}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            placeholder={t('accountSecurity.codePlaceholder')}
            placeholderTextColor={COLORS.textMuted}
          />
          <View style={styles.twoFactorRow}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => { setSetup(null); setCode(''); }}>
              <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primarySmallButton, busy && styles.saveButtonDisabled]} onPress={turnOn} disabled={busy}>
              {busy ? <ActivityIndicator color="white" /> : <Text style={styles.saveButtonText}>{t('accountSecurity.turnOn')}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  requiredNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(139, 92, 246, 0.45)', padding: 14, marginBottom: 16,
  },
  requiredText: { flex: 1, color: 'white', fontSize: 14, lineHeight: 20 },
  requiredLogout: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
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
  dangerSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  deleteButton: {
    marginTop: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  deleteButtonText: { color: COLORS.danger, fontSize: 16, fontWeight: '600' },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: COLORS.surface },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  methodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  methodTitle: { fontSize: 15, fontWeight: '600', color: 'white' },
  secretKey: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
    fontFamily: 'monospace',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    overflow: 'hidden',
  },
  linkText: { color: COLORS.primary, fontSize: 13, fontWeight: '500', marginTop: 8, marginBottom: 12 },
  codeField: { textAlign: 'center', marginBottom: 12 },
  codeFieldFilled: { letterSpacing: 6, fontWeight: '600' },
  twoFactorRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  secondaryButton: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  secondaryButtonText: { color: COLORS.primary, fontSize: 15, fontWeight: '600' },
  primarySmallButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  recoveryBox: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.success,
  },
  recoveryTitle: { fontSize: 15, fontWeight: '700', color: 'white' },
  recoveryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  recoveryCode: {
    width: '47%',
    color: 'white',
    fontSize: 15,
    fontFamily: 'monospace',
    textAlign: 'center',
    paddingVertical: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    overflow: 'hidden',
  },
});

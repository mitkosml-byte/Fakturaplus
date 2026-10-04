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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert } from '../src/utils/alert';
import { Toast } from '../src/utils/toast';
import { Haptics } from '../src/utils/haptics';
import { api } from '../src/services/api';
import { useTranslation } from '../src/i18n';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleRequestCode = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert(t('common.error'), t('forgotPassword.enterEmail'));
      return;
    }
    setSending(true);
    try {
      await api.forgotPassword(trimmed);
      Alert.alert(t('forgotPassword.sent'), t('forgotPassword.codeSentMessage'));
      setStep('reset');
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setSending(false);
    }
  };

  const handleResetPassword = async () => {
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      Alert.alert(t('common.error'), t('forgotPassword.enterCode'));
      return;
    }
    if (!newPassword.trim()) {
      Alert.alert(t('common.error'), t('forgotPassword.enterNewPassword'));
      return;
    }
    setResetting(true);
    try {
      await api.resetPassword(email.trim(), trimmedCode, newPassword);
      Haptics.success();
      Toast.success(t('forgotPassword.passwordChanged'));
      router.replace('/login');
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
    } finally {
      setResetting(false);
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
            <Text style={styles.title}>{t('forgotPassword.title')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
              {step === 'request' ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={[styles.sectionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                      <Ionicons name="mail" size={24} color={COLORS.primary} />
                    </View>
                    <View style={styles.sectionTitleContainer}>
                      <Text style={styles.sectionTitle}>{t('forgotPassword.yourEmail')}</Text>
                      <Text style={styles.sectionSubtitle}>
                        {t('forgotPassword.willSendCode')}
                      </Text>
                    </View>
                  </View>

                  <TextInput
                    style={styles.textInput}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    textContentType="username"
                    autoComplete="email"
                  />

                  <TouchableOpacity
                    style={[styles.actionButton, sending && styles.actionButtonDisabled]}
                    onPress={handleRequestCode}
                    disabled={sending}
                  >
                    {sending ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text style={styles.actionButtonText}>{t('forgotPassword.sendCode')}</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setStep('reset')} style={styles.secondaryLink}>
                    <Text style={styles.secondaryLinkText}>
                      {t('forgotPassword.alreadyHaveCode')}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <View style={[styles.sectionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                      <Ionicons name="key" size={24} color={COLORS.primary} />
                    </View>
                    <View style={styles.sectionTitleContainer}>
                      <Text style={styles.sectionTitle}>{t('forgotPassword.codeAndNewPassword')}</Text>
                      <Text style={styles.sectionSubtitle}>
                        {t('forgotPassword.codeValidity')}
                      </Text>
                    </View>
                  </View>

                  <TextInput
                    style={styles.textInput}
                    value={email}
                    onChangeText={setEmail}
                    placeholder={t('forgotPassword.emailPlaceholder')}
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />

                  <TextInput
                    style={[styles.textInput, styles.codeInput]}
                    value={code}
                    onChangeText={(v) => setCode(v.toUpperCase())}
                    placeholder="ABCD1234"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={8}
                  />

                  <TextInput
                    style={styles.textInput}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder={t('forgotPassword.newPasswordPlaceholder')}
                    placeholderTextColor={COLORS.textMuted}
                    secureTextEntry
                    textContentType="newPassword"
                    autoComplete="new-password"
                  />

                  <TouchableOpacity
                    style={[styles.actionButton, resetting && styles.actionButtonDisabled]}
                    onPress={handleResetPassword}
                    disabled={resetting}
                  >
                    {resetting ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text style={styles.actionButtonText}>{t('forgotPassword.resetPassword')}</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setStep('request')} style={styles.secondaryLink}>
                    <Text style={styles.secondaryLinkText}>
                      {t('forgotPassword.sendNewCode')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
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
  textInput: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 16,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  codeInput: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
  },
  actionButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  actionButtonDisabled: { opacity: 0.6 },
  actionButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  secondaryLink: { alignItems: 'center', marginTop: 16, padding: 4 },
  secondaryLinkText: { color: COLORS.primary, fontSize: 13, fontWeight: '500' },
});

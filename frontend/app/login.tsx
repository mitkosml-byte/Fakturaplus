import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Platform,
  ImageBackground, Image, TextInput, KeyboardAvoidingView, ScrollView
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../src/utils/alert';
import { LinearGradient } from 'expo-linear-gradient';
import { useLanguageStore, useTranslation } from '../src/i18n';
import { api } from '../src/services/api';
import { setStoredToken } from '../src/utils/tokenStorage';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function LoginScreen() {
  const { isLoading, isAuthenticated, setUser } = useAuth();
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const { language, setLanguage, loadLanguage } = useLanguageStore();
  const { t } = useTranslation();
  
  // Email/Password form state
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Optional invitation code, shown only on registration - lets someone
  // who was invited to a company join it directly on signup instead of
  // landing in their own auto-created company with no obvious way back
  // (the only other entry point is buried in Профил > Фирма > "Присъедини
  // се по покана").
  const [showInviteCode, setShowInviteCode] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    loadLanguage();
  }, []);

  const handleEmailAuth = async () => {
    if (!email.trim()) {
      Alert.alert(language === 'bg' ? 'Грешка' : 'Error', language === 'bg' ? 'Въведете имейл' : 'Enter email');
      return;
    }
    if (!password.trim()) {
      Alert.alert(language === 'bg' ? 'Грешка' : 'Error', language === 'bg' ? 'Въведете парола' : 'Enter password');
      return;
    }
    if (authMode === 'register' && !name.trim()) {
      Alert.alert(language === 'bg' ? 'Грешка' : 'Error', language === 'bg' ? 'Въведете име' : 'Enter name');
      return;
    }

    setIsProcessing(true);
    try {
      let result;
      if (authMode === 'register') {
        result = await api.register(email.trim(), password, name.trim(), inviteCode.trim() || undefined);
      } else {
        result = await api.login(email.trim(), password);
      }

      api.setToken(result.session_token);
      // Persist the token so the session survives a reload/app restart -
      // checkAuth() on the next app boot reads it back to restore login.
      await setStoredToken(result.session_token);

      // The account already exists and is logged in at this point - an
      // invalid/expired code (invite_error) doesn't undo that, it just
      // means they landed in their own new company instead of the
      // inviter's. Say so, but don't block sign-up over it.
      if (authMode === 'register' && inviteCode.trim() && 'invite_error' in result && result.invite_error) {
        Alert.alert(
          language === 'bg' ? 'Кодът не проработи' : "Code didn't work",
          result.invite_error + '\n\n' + (language === 'bg'
            ? 'Профилът е създаден. Можете да опитате отново от Профил > Фирма > "Присъедини се по покана".'
            : 'Your account was created. You can try again from Profile > Company > "Join by invitation".')
        );
      }
      setUser(result.user);
      // The root layout's auth guard navigates to /(tabs) once
      // isAuthenticated flips true - no manual navigation needed here.
    } catch (error: any) {
      Alert.alert(language === 'bg' ? 'Грешка' : 'Error', error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading || isProcessing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <ImageBackground 
      source={{ uri: BACKGROUND_IMAGE }} 
      style={styles.container}
      resizeMode="cover"
    >
      <LinearGradient
        colors={['rgba(15, 23, 42, 0.85)', 'rgba(30, 41, 59, 0.75)', 'rgba(15, 23, 42, 0.9)']}
        style={styles.gradient}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {/* Language Selector */}
            <View style={styles.languageSelector}>
              <TouchableOpacity 
                style={[styles.langButton, language === 'bg' && styles.langButtonActive]}
                onPress={() => setLanguage('bg')}
              >
                <Text style={[styles.langButtonText, language === 'bg' && styles.langButtonTextActive]}>🇧🇬 BG</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.langButton, language === 'en' && styles.langButtonActive]}
                onPress={() => setLanguage('en')}
              >
                <Text style={[styles.langButtonText, language === 'en' && styles.langButtonTextActive]}>🇬🇧 EN</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.content}>
              <View style={styles.logoContainer}>
                <Image 
                  source={require('../assets/images/logo.png')} 
                  style={styles.logo}
                  resizeMode="contain"
                />
                <Text style={styles.title}>Фактура+</Text>
                <Text style={styles.subtitle}>{t('login.title')}</Text>
              </View>

              {/* Auth Mode Toggle */}
              <View style={styles.authToggle}>
                <TouchableOpacity 
                  style={[styles.authToggleButton, authMode === 'login' && styles.authToggleButtonActive]}
                  onPress={() => setAuthMode('login')}
                >
                  <Text style={[styles.authToggleText, authMode === 'login' && styles.authToggleTextActive]}>
                    {language === 'bg' ? 'Вход' : 'Login'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.authToggleButton, authMode === 'register' && styles.authToggleButtonActive]}
                  onPress={() => setAuthMode('register')}
                >
                  <Text style={[styles.authToggleText, authMode === 'register' && styles.authToggleTextActive]}>
                    {language === 'bg' ? 'Регистрация' : 'Register'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Email/Password Form */}
              <View style={styles.formContainer}>
                {authMode === 'register' && (
                  <View style={styles.inputContainer}>
                    <Ionicons name="person-outline" size={20} color="#64748B" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder={language === 'bg' ? 'Име' : 'Name'}
                      placeholderTextColor="#64748B"
                      value={name}
                      onChangeText={setName}
                      autoCapitalize="words"
                      textContentType="name"
                      autoComplete="name"
                    />
                  </View>
                )}
                
                <View style={styles.inputContainer}>
                  <Ionicons name="mail-outline" size={20} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder={language === 'bg' ? 'Имейл' : 'Email'}
                    placeholderTextColor="#64748B"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    textContentType="username"
                    autoComplete="email"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Ionicons name="lock-closed-outline" size={20} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder={language === 'bg' ? 'Парола' : 'Password'}
                    placeholderTextColor="#64748B"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    textContentType={authMode === 'register' ? 'newPassword' : 'password'}
                    autoComplete={authMode === 'register' ? 'new-password' : 'password'}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#64748B" />
                  </TouchableOpacity>
                </View>

                {authMode === 'login' && (
                  <TouchableOpacity onPress={() => router.push('/forgot-password')} style={styles.forgotPasswordLink}>
                    <Text style={styles.forgotPasswordText}>
                      {language === 'bg' ? 'Забравена парола?' : 'Forgot password?'}
                    </Text>
                  </TouchableOpacity>
                )}

                {authMode === 'register' && !showInviteCode && (
                  <TouchableOpacity onPress={() => setShowInviteCode(true)} style={styles.inviteCodeToggle}>
                    <Ionicons name="key-outline" size={16} color="#8B5CF6" />
                    <Text style={styles.inviteCodeToggleText}>
                      {language === 'bg' ? 'Имате код за покана? (по избор)' : 'Have an invitation code? (optional)'}
                    </Text>
                  </TouchableOpacity>
                )}

                {authMode === 'register' && showInviteCode && (
                  <View style={styles.inputContainer}>
                    <Ionicons name="key-outline" size={20} color="#64748B" style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder={language === 'bg' ? 'Код за покана (по избор)' : 'Invitation code (optional)'}
                      placeholderTextColor="#64748B"
                      value={inviteCode}
                      onChangeText={(v) => setInviteCode(v.toUpperCase())}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={8}
                    />
                  </View>
                )}

                <TouchableOpacity style={styles.emailButton} onPress={handleEmailAuth}>
                  <Text style={styles.emailButtonText}>
                    {authMode === 'login' 
                      ? (language === 'bg' ? 'Вход' : 'Login')
                      : (language === 'bg' ? 'Регистрация' : 'Register')
                    }
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Legal Links */}
              <View style={styles.legalLinks}>
                <TouchableOpacity onPress={() => router.push('/privacy-policy')}>
                  <Text style={styles.legalLink}>
                    {language === 'bg' ? 'Поверителност' : 'Privacy Policy'}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.legalDot}>•</Text>
                <TouchableOpacity onPress={() => router.push('/terms-of-service')}>
                  <Text style={styles.legalLink}>
                    {language === 'bg' ? 'Условия' : 'Terms'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </ImageBackground>
  );
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureItem}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon as any} size={20} color="#8B5CF6" />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  gradient: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: 60,
  },
  languageSelector: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    marginRight: 20,
    marginBottom: 20,
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderRadius: 12,
    padding: 4,
  },
  langButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  langButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  langButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  langButtonTextActive: {
    color: 'white',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  loadingText: {
    color: '#94A3B8',
    marginTop: 16,
    fontSize: 16,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 12,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
  },
  authToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    width: '100%',
    maxWidth: 300,
  },
  authToggleButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  authToggleButtonActive: {
    backgroundColor: '#8B5CF6',
  },
  authToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  authToggleTextActive: {
    color: 'white',
  },
  formContainer: {
    width: '100%',
    maxWidth: 300,
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputIcon: {
    marginRight: 12,
  },
  forgotPasswordLink: {
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  forgotPasswordText: {
    color: '#8B5CF6',
    fontSize: 13,
    fontWeight: '500',
  },
  inviteCodeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingVertical: 4,
  },
  inviteCodeToggleText: {
    color: '#8B5CF6',
    fontSize: 13,
    fontWeight: '500',
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    color: 'white',
  },
  emailButton: {
    backgroundColor: '#10B981',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  emailButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  featuresContainer: {
    width: '100%',
    maxWidth: 300,
    marginBottom: 48,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  featureText: {
    fontSize: 16,
    color: '#E2E8F0',
  },
  legalLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
  },
  legalLink: {
    color: '#64748B',
    fontSize: 12,
  },
  legalDot: {
    color: '#64748B',
    marginHorizontal: 8,
  },
  disclaimer: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 32,
    textAlign: 'center',
  },
});

import React, { useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Platform, 
  ImageBackground, Image, TextInput, KeyboardAvoidingView, ScrollView, Alert 
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { useLanguageStore, useTranslation } from '../src/i18n';
import { api } from '../src/services/api';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function Index() {
  const { isLoading, isAuthenticated, login, setUser } = useAuth();
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

  useEffect(() => {
    loadLanguage();
  }, []);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/(tabs)');
    }
  }, [isLoading, isAuthenticated]);

  useEffect(() => {
    // Check for session_id in URL (web)
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const hash = window.location.hash;
      if (hash.includes('session_id=')) {
        const sessionId = hash.split('session_id=')[1]?.split('&')[0];
        if (sessionId) {
          handleSessionId(sessionId);
          window.location.hash = '';
        }
      }
    }
  }, []);

  const handleSessionId = async (sessionId: string) => {
    try {
      setIsProcessing(true);
      await login(sessionId);
      router.replace('/(tabs)');
    } catch (error) {
      console.error('Login error:', error);
      setIsProcessing(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      // For Expo Go, use exp:// scheme; for standalone app use custom scheme
      const redirectUrl = Platform.OS === 'web'
        ? (typeof window !== 'undefined' ? window.location.origin + '/' : '/')
        : Linking.createURL('/');
      
      console.log('Google login redirect URL:', redirectUrl);
      
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      
      if (Platform.OS === 'web') {
        window.location.href = authUrl;
      } else {
        setIsProcessing(true);
        const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
        console.log('WebBrowser result:', result);
        
        if (result.type === 'success' && result.url) {
          const url = result.url;
          console.log('Received URL:', url);
          
          let sessionId = null;
          // Try different URL formats
          if (url.includes('#session_id=')) {
            sessionId = url.split('#session_id=')[1]?.split('&')[0];
          } else if (url.includes('?session_id=')) {
            sessionId = url.split('?session_id=')[1]?.split('&')[0];
          } else if (url.includes('session_id=')) {
            sessionId = url.split('session_id=')[1]?.split('&')[0];
          }
          
          console.log('Extracted sessionId:', sessionId);
          
          if (sessionId) {
            await handleSessionId(sessionId);
          } else {
            setIsProcessing(false);
            Alert.alert(
              language === 'bg' ? 'Грешка' : 'Error',
              language === 'bg' ? 'Не беше получен session ID' : 'No session ID received'
            );
          }
        } else if (result.type === 'cancel') {
          console.log('User cancelled');
          setIsProcessing(false);
        } else {
          setIsProcessing(false);
        }
      }
    } catch (error) {
      console.error('Google login error:', error);
      setIsProcessing(false);
      Alert.alert(
        language === 'bg' ? 'Грешка' : 'Error',
        language === 'bg' ? 'Грешка при вход с Google' : 'Google login failed'
      );
    }
  };

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
        result = await api.register(email.trim(), password, name.trim());
      } else {
        result = await api.login(email.trim(), password);
      }
      
      api.setToken(result.session_token);
      setUser(result.user);
      router.replace('/(tabs)');
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
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#64748B" />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.emailButton} onPress={handleEmailAuth}>
                  <Text style={styles.emailButtonText}>
                    {authMode === 'login' 
                      ? (language === 'bg' ? 'Вход' : 'Login')
                      : (language === 'bg' ? 'Регистрация' : 'Register')
                    }
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{language === 'bg' ? 'или' : 'or'}</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity style={styles.googleButton} onPress={handleGoogleLogin}>
                <Ionicons name="logo-google" size={24} color="white" />
                <Text style={styles.googleButtonText}>{t('login.google')}</Text>
              </TouchableOpacity>

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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 300,
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#334155',
  },
  dividerText: {
    color: '#64748B',
    paddingHorizontal: 16,
    fontSize: 14,
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
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#334155',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    maxWidth: 300,
    borderWidth: 1,
    borderColor: '#475569',
  },
  googleButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
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

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Platform, ImageBackground, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { useLanguageStore, useTranslation, Language } from '../src/i18n';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function Index() {
  const { isLoading, isAuthenticated, login } = useAuth();
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const { language, setLanguage, loadLanguage } = useLanguageStore();
  const { t } = useTranslation();

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
    const redirectUrl = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? window.location.origin + '/' : '/')
      : Linking.createURL('/');
    
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
    
    if (Platform.OS === 'web') {
      window.location.href = authUrl;
    } else {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type === 'success' && result.url) {
        const url = result.url;
        let sessionId = null;
        if (url.includes('#session_id=')) {
          sessionId = url.split('#session_id=')[1]?.split('&')[0];
        } else if (url.includes('?session_id=')) {
          sessionId = url.split('?session_id=')[1]?.split('&')[0];
        }
        if (sessionId) {
          await handleSessionId(sessionId);
        }
      }
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

  const handleLanguageToggle = () => {
    setLanguage(language === 'bg' ? 'en' : 'bg');
  };

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

          <View style={styles.featuresContainer}>
            <FeatureItem icon="scan" text={language === 'bg' ? 'OCR сканиране' : 'OCR Scanning'} />
            <FeatureItem icon="calculator" text={language === 'bg' ? 'ДДС изчисления' : 'VAT Calculations'} />
            <FeatureItem icon="stats-chart" text={language === 'bg' ? 'Статистики и графики' : 'Statistics & Charts'} />
            <FeatureItem icon="document-text" text={language === 'bg' ? 'Експорт Excel/PDF' : 'Export Excel/PDF'} />
          </View>

          <TouchableOpacity style={styles.googleButton} onPress={handleGoogleLogin}>
            <Ionicons name="logo-google" size={24} color="white" />
            <Text style={styles.googleButtonText}>{t('login.google')}</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            {language === 'bg' 
              ? 'Българско приложение за управление на фактури'
              : 'Bulgarian invoice management application'
            }
          </Text>
        </View>
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
  languageSelector: {
    flexDirection: 'row',
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderRadius: 12,
    padding: 4,
    zIndex: 10,
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
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    width: 140,
    height: 140,
    marginBottom: 16,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#94A3B8',
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
    backgroundColor: '#8B5CF6',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: '100%',
    maxWidth: 300,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  googleButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
  },
  disclaimer: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 32,
    textAlign: 'center',
  },
});

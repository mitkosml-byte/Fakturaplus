import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useLanguageStore } from '../i18n';
import { COLORS } from '../theme/colors';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message }: LoadingScreenProps) {
  const { language } = useLanguageStore();
  
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.text}>
        {message || (language === 'bg' ? 'Зареждане...' : 'Loading...')}
      </Text>
    </View>
  );
}

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export function LoadingOverlay({ visible, message }: LoadingOverlayProps) {
  const { language } = useLanguageStore();
  
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.overlayContent}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.overlayText}>
          {message || (language === 'bg' ? 'Моля, изчакайте...' : 'Please wait...')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  text: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textSecondary,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  overlayContent: {
    backgroundColor: COLORS.surface,
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
  },
  overlayText: {
    marginTop: 16,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
});

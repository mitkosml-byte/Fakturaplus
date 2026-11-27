import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';
import { reportError } from '../utils/errorReporter';

type Props = { error: Error; retry: () => Promise<void> };

// What a screen shows instead of going blank when it breaks while drawing:
// the error goes to the program's error log, and the person can try again
// or go back to Home. Plain parts only - the providers above may be the
// thing that broke.
export function ScreenErrorFallback({ error, retry }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    reportError(error, 'render');
  }, [error]);

  const goHome = () => {
    try {
      router.replace('/(tabs)');
    } catch {
      void retry();
    }
  };

  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={48} color={COLORS.warning} />
      <Text style={styles.title}>{t('errorBoundary.title')}</Text>
      <Text style={styles.body}>{t('errorBoundary.body')}</Text>
      <TouchableOpacity style={styles.primary} onPress={() => void retry()}>
        <Text style={styles.primaryText}>{t('errorBoundary.retry')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={goHome}>
        <Text style={styles.secondaryText}>{t('errorBoundary.home')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: COLORS.background,
  },
  title: { color: 'white', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  body: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 360 },
  primary: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 28,
    marginTop: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  primaryText: { color: 'white', fontSize: 15, fontWeight: '600' },
  secondary: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
    minWidth: 200,
    alignItems: 'center',
  },
  secondaryText: { color: 'white', fontSize: 15, fontWeight: '600' },
});

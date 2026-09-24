import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useLanguageStore } from '../i18n';

// Shown in place of a whole screen when the signed-in user's role lacks the
// permission that screen requires - a direct-URL visit (or a stale menu
// link after a role change) should land here instead of the screen's data.
export function AccessDenied() {
  const router = useRouter();
  const { language } = useLanguageStore();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="lock-closed" size={48} color="#64748B" />
        </View>
        <Text style={styles.title}>{language === 'bg' ? 'Нямате достъп' : 'Access denied'}</Text>
        <Text style={styles.subtitle}>
          {language === 'bg'
            ? 'Ролята Ви в компанията не позволява достъп до този екран.'
            : 'Your role in the company does not allow access to this screen.'}
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>{language === 'bg' ? 'Назад' : 'Back'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '600', color: '#E2E8F0', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#94A3B8', textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  button: { paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#8B5CF6', borderRadius: 12 },
  buttonText: { fontSize: 14, fontWeight: '600', color: 'white' },
});

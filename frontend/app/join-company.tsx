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
import { api } from '../src/services/api';
import { useLanguageStore } from '../src/i18n';
import { useAuth } from '../src/contexts/AuthContext';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function JoinCompanyScreen() {
  const router = useRouter();
  const { language } = useLanguageStore();
  const { refreshUser } = useAuth();

  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);

  const t = (bg: string, en: string) => (language === 'bg' ? bg : en);

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      Alert.alert(t('Грешка', 'Error'), t('Въведете код за покана', 'Enter an invitation code'));
      return;
    }

    setJoining(true);
    try {
      const result = await api.acceptInvitation(trimmed);
      await refreshUser();
      Alert.alert(t('Успех', 'Success'), result.message, [
        { text: 'OK', onPress: () => router.replace('/(tabs)/profile') },
      ]);
    } catch (error: any) {
      Alert.alert(t('Грешка', 'Error'), error.message);
    } finally {
      setJoining(false);
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
            <Text style={styles.title}>{t('Присъединяване по покана', 'Join by Invitation')}</Text>
            <View style={{ width: 40 }} />
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
                    <Ionicons name="key" size={24} color="#8B5CF6" />
                  </View>
                  <View style={styles.sectionTitleContainer}>
                    <Text style={styles.sectionTitle}>{t('Код за покана', 'Invitation code')}</Text>
                    <Text style={styles.sectionSubtitle}>
                      {t('Получавате го от собственика на фирмата', 'You receive this from the company owner')}
                    </Text>
                  </View>
                </View>

                <TextInput
                  style={styles.codeInput}
                  value={code}
                  onChangeText={(v) => setCode(v.toUpperCase())}
                  placeholder="ABCD1234"
                  placeholderTextColor="#64748B"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                />
              </View>

              <View style={styles.infoCard}>
                <Ionicons name="information-circle" size={24} color="#64748B" />
                <Text style={styles.infoText}>
                  {t(
                    'Кодовете за покана са валидни 7 дни и могат да бъдат използвани само от имейла, за който са издадени (ако е зададен такъв).',
                    'Invitation codes are valid for 7 days and can only be used by the email they were issued to (if one was specified).'
                  )}
                </Text>
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.joinButton, joining && styles.joinButtonDisabled]}
                onPress={handleJoin}
                disabled={joining}
              >
                {joining ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.joinButtonText}>{t('Присъедини се', 'Join')}</Text>
                )}
              </TouchableOpacity>
            </View>
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
  codeInput: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    color: 'white',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
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
  joinButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  joinButtonDisabled: { opacity: 0.6 },
  joinButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});

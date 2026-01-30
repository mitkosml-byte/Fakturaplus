import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/services/api';
import { NotificationSettings } from '@/src/types';

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);
const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function NotificationsSettingsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [thresholdEnabled, setThresholdEnabled] = useState(false);
  const [thresholdAmount, setThresholdAmount] = useState('');
  const [periodicEnabled, setPeriodicEnabled] = useState(false);
  const [selectedDates, setSelectedDates] = useState<number[]>([]);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await api.getNotificationSettings();
      setThresholdEnabled(settings.vat_threshold_enabled);
      setThresholdAmount(settings.vat_threshold_amount > 0 ? settings.vat_threshold_amount.toString() : '');
      setPeriodicEnabled(settings.periodic_enabled);
      setSelectedDates(settings.periodic_dates || []);
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateNotificationSettings({
        vat_threshold_enabled: thresholdEnabled,
        vat_threshold_amount: parseFloat(thresholdAmount) || 0,
        periodic_enabled: periodicEnabled,
        periodic_dates: selectedDates,
      });
      Alert.alert('Успех', 'Настройките са запазени');
      router.back();
    } catch (error: any) {
      Alert.alert('Грешка', error.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleDate = (day: number) => {
    setSelectedDates(prev => 
      prev.includes(day) 
        ? prev.filter(d => d !== day)
        : [...prev, day].sort((a, b) => a - b)
    );
  };

  if (loading) {
    return (
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#8B5CF6" />
            </View>
          </SafeAreaView>
        </View>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.title}>Известия за ДДС</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView style={styles.content}>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Ionicons name="alert-circle" size={24} color="#EF4444" />
            </View>
            <View style={styles.sectionTitleContainer}>
              <Text style={styles.sectionTitle}>Известие при надхвърляне</Text>
              <Text style={styles.sectionSubtitle}>Известие когато ДДС надхвърли сума</Text>
            </View>
            <Switch
              value={thresholdEnabled}
              onValueChange={setThresholdEnabled}
              trackColor={{ false: '#334155', true: '#8B5CF6' }}
              thumbColor={thresholdEnabled ? 'white' : '#64748B'}
            />
          </View>

          {thresholdEnabled && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Сума на ДДС (€)</Text>
              <TextInput
                style={styles.input}
                value={thresholdAmount}
                onChangeText={setThresholdAmount}
                keyboardType="decimal-pad"
                placeholder="Напр. 5000"
                placeholderTextColor="#64748B"
              />
              <Text style={styles.inputHint}>
                Известие когато ДДС за плащане надхвърли тази сума
              </Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.15)' }]}>
              <Ionicons name="calendar" size={24} color="#8B5CF6" />
            </View>
            <View style={styles.sectionTitleContainer}>
              <Text style={styles.sectionTitle}>Периодични известия</Text>
              <Text style={styles.sectionSubtitle}>Напомняне на избрани дати</Text>
            </View>
            <Switch
              value={periodicEnabled}
              onValueChange={setPeriodicEnabled}
              trackColor={{ false: '#334155', true: '#8B5CF6' }}
              thumbColor={periodicEnabled ? 'white' : '#64748B'}
            />
          </View>

          {periodicEnabled && (
            <View style={styles.datesContainer}>
              <Text style={styles.inputLabel}>Изберете дати от месеца</Text>
              <View style={styles.datesGrid}>
                {DAYS_OF_MONTH.map(day => (
                  <TouchableOpacity
                    key={day}
                    style={[
                      styles.dateButton,
                      selectedDates.includes(day) && styles.dateButtonSelected
                    ]}
                    onPress={() => toggleDate(day)}
                  >
                    <Text style={[
                      styles.dateButtonText,
                      selectedDates.includes(day) && styles.dateButtonTextSelected
                    ]}>
                      {day}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {selectedDates.length > 0 && (
                <Text style={styles.selectedDatesText}>
                  Избрани: {selectedDates.join(', ')}
                </Text>
              )}
            </View>
          )}
        </View>

            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={24} color="#64748B" />
              <Text style={styles.infoText}>
                Известията се изпращат като push нотификации. 
                Уверете се, че сте ги разрешили.
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
                <Text style={styles.saveButtonText}>Запази настройки</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sectionTitleContainer: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  inputContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  inputLabel: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputHint: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 8,
  },
  datesContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  datesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  dateButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  dateButtonSelected: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  dateButtonText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '500',
  },
  dateButtonTextSelected: {
    color: 'white',
  },
  selectedDatesText: {
    fontSize: 12,
    color: '#8B5CF6',
    marginTop: 12,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#64748B',
    lineHeight: 20,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  saveButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

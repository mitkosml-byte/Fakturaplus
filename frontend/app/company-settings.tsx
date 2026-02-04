import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ImageBackground,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api } from '@/src/services/api';
import { Company } from '@/src/types';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function CompanySettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  
  // Form fields
  const [name, setName] = useState('');
  const [eik, setEik] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [mol, setMol] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankIban, setBankIban] = useState('');
  
  // Join existing company
  const [joinEik, setJoinEik] = useState('');
  const [showJoinSection, setShowJoinSection] = useState(false);

  const loadCompany = useCallback(async () => {
    try {
      const data = await api.getCompany();
      if (data) {
        setCompany(data);
        setName(data.name || '');
        setEik(data.eik || '');
        setVatNumber(data.vat_number || '');
        setMol(data.mol || '');
        setAddress(data.address || '');
        setCity(data.city || '');
        setPhone(data.phone || '');
        setEmail(data.email || '');
        setBankName(data.bank_name || '');
        setBankIban(data.bank_iban || '');
      }
    } catch (error) {
      console.error('Error loading company:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCompany();
  }, [loadCompany]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Грешка', 'Въведете име на фирмата');
      return;
    }
    if (!eik.trim()) {
      Alert.alert('Грешка', 'Въведете ЕИК на фирмата');
      return;
    }

    setSaving(true);
    try {
      const savedCompany = await api.createOrUpdateCompany({
        name: name.trim(),
        eik: eik.trim(),
        vat_number: vatNumber.trim() || undefined,
        mol: mol.trim() || undefined,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        bank_name: bankName.trim() || undefined,
        bank_iban: bankIban.trim() || undefined,
      });
      setCompany(savedCompany);
      Alert.alert('Успех', 'Данните на фирмата са запазени');
    } catch (error: any) {
      Alert.alert('Грешка', error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleJoinCompany = async () => {
    if (!joinEik.trim()) {
      Alert.alert('Грешка', 'Въведете ЕИК на фирмата');
      return;
    }

    setSaving(true);
    try {
      const result = await api.joinCompanyByEik(joinEik.trim());
      Alert.alert('Успех', result.message);
      setCompany(result.company);
      setName(result.company.name || '');
      setEik(result.company.eik || '');
      setVatNumber(result.company.vat_number || '');
      setMol(result.company.mol || '');
      setAddress(result.company.address || '');
      setCity(result.company.city || '');
      setPhone(result.company.phone || '');
      setEmail(result.company.email || '');
      setBankName(result.company.bank_name || '');
      setBankIban(result.company.bank_iban || '');
      setShowJoinSection(false);
      setJoinEik('');
    } catch (error: any) {
      Alert.alert('Грешка', error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
        <View style={styles.overlay}>
          <SafeAreaView style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#8B5CF6" />
          </SafeAreaView>
        </View>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardView}
          >
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <Ionicons name="arrow-back" size={24} color="white" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Настройки на фирма</Text>
              <View style={styles.headerRight} />
            </View>

            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
              {/* Info Card */}
              <View style={styles.infoCard}>
                <Ionicons name="business" size={24} color="#8B5CF6" />
                <Text style={styles.infoText}>
                  Фирмените данни се споделят между всички потребители в една фирма.
                  Дублиращите се фактури се проверяват за цялата фирма.
                </Text>
              </View>

              {/* Join Existing Company Section */}
              {!company && (
                <View style={styles.joinSection}>
                  <TouchableOpacity
                    style={styles.joinToggle}
                    onPress={() => setShowJoinSection(!showJoinSection)}
                  >
                    <Ionicons name="people" size={20} color="#8B5CF6" />
                    <Text style={styles.joinToggleText}>
                      Присъединяване към съществуваща фирма
                    </Text>
                    <Ionicons 
                      name={showJoinSection ? "chevron-up" : "chevron-down"} 
                      size={20} 
                      color="#64748B" 
                    />
                  </TouchableOpacity>
                  
                  {showJoinSection && (
                    <View style={styles.joinForm}>
                      <Text style={styles.joinHint}>
                        Въведете ЕИК на фирмата, към която искате да се присъедините
                      </Text>
                      <TextInput
                        style={styles.input}
                        value={joinEik}
                        onChangeText={setJoinEik}
                        placeholder="Въведете ЕИК"
                        placeholderTextColor="#64748B"
                        keyboardType="number-pad"
                      />
                      <TouchableOpacity
                        style={[styles.joinButton, saving && styles.buttonDisabled]}
                        onPress={handleJoinCompany}
                        disabled={saving}
                      >
                        {saving ? (
                          <ActivityIndicator color="white" />
                        ) : (
                          <>
                            <Ionicons name="log-in" size={20} color="white" />
                            <Text style={styles.joinButtonText}>Присъедини се</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              {/* Company Form */}
              <View style={styles.formContainer}>
                <Text style={styles.sectionTitle}>
                  {company ? 'Редактиране на фирма' : 'Създаване на нова фирма'}
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Име на фирмата *</Text>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Моята фирма ЕООД"
                    placeholderTextColor="#64748B"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>ЕИК/Булстат *</Text>
                  <TextInput
                    style={styles.input}
                    value={eik}
                    onChangeText={setEik}
                    placeholder="123456789"
                    placeholderTextColor="#64748B"
                    keyboardType="number-pad"
                    editable={!company}
                  />
                  {company && (
                    <Text style={styles.inputHint}>ЕИК не може да се променя</Text>
                  )}
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>ДДС номер</Text>
                  <TextInput
                    style={styles.input}
                    value={vatNumber}
                    onChangeText={setVatNumber}
                    placeholder="BG123456789"
                    placeholderTextColor="#64748B"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>МОЛ</Text>
                  <TextInput
                    style={styles.input}
                    value={mol}
                    onChangeText={setMol}
                    placeholder="Иван Иванов"
                    placeholderTextColor="#64748B"
                  />
                </View>

                <View style={styles.row}>
                  <View style={[styles.inputGroup, { flex: 2 }]}>
                    <Text style={styles.inputLabel}>Адрес</Text>
                    <TextInput
                      style={styles.input}
                      value={address}
                      onChangeText={setAddress}
                      placeholder="ул. Примерна 1"
                      placeholderTextColor="#64748B"
                    />
                  </View>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Град</Text>
                    <TextInput
                      style={styles.input}
                      value={city}
                      onChangeText={setCity}
                      placeholder="София"
                      placeholderTextColor="#64748B"
                    />
                  </View>
                </View>

                <View style={styles.row}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Телефон</Text>
                    <TextInput
                      style={styles.input}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="+359 888 123456"
                      placeholderTextColor="#64748B"
                      keyboardType="phone-pad"
                    />
                  </View>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Имейл</Text>
                    <TextInput
                      style={styles.input}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="office@firma.bg"
                      placeholderTextColor="#64748B"
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <Text style={styles.sectionSubtitle}>Банкови данни</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Банка</Text>
                  <TextInput
                    style={styles.input}
                    value={bankName}
                    onChangeText={setBankName}
                    placeholder="Име на банката"
                    placeholderTextColor="#64748B"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>IBAN</Text>
                  <TextInput
                    style={styles.input}
                    value={bankIban}
                    onChangeText={setBankIban}
                    placeholder="BG12XXXX00001234567890"
                    placeholderTextColor="#64748B"
                    autoCapitalize="characters"
                  />
                </View>

                <TouchableOpacity
                  style={[styles.saveButton, saving && styles.buttonDisabled]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={24} color="white" />
                      <Text style={styles.saveButtonText}>Запази</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
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
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
    padding: 16,
  },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    gap: 12,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
  },
  joinSection: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    marginBottom: 20,
    overflow: 'hidden',
  },
  joinToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  joinToggleText: {
    flex: 1,
    fontSize: 15,
    color: 'white',
    fontWeight: '500',
  },
  joinForm: {
    padding: 16,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  joinHint: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 12,
    marginTop: 12,
  },
  joinButton: {
    flexDirection: 'row',
    backgroundColor: '#10B981',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  joinButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  formContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
  },
  sectionSubtitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 16,
    marginBottom: 12,
  },
  inputGroup: {
    marginBottom: 16,
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
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  saveButton: {
    flexDirection: 'row',
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

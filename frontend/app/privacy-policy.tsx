import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation, useLanguageStore } from '../src/i18n';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function PrivacyPolicyScreen() {
  const { language } = useLanguageStore();
  
  const content = language === 'bg' ? {
    title: 'Политика за поверителност',
    lastUpdated: 'Последна актуализация: Януари 2025',
    sections: [
      {
        title: '1. Въведение',
        text: 'Invoice Manager ("ние", "нас", "приложението") се ангажира да защитава поверителността на вашите данни. Тази политика описва как събираме, използваме и защитаваме вашата информация.',
      },
      {
        title: '2. Събирани данни',
        text: 'Събираме следната информация:\n• Имейл адрес и име (при регистрация)\n• Данни за фактури и финансови записи\n• Информация за фирмата\n• Данни за използване на приложението',
      },
      {
        title: '3. Използване на данните',
        text: 'Използваме вашите данни за:\n• Предоставяне на услугите на приложението\n• Изчисляване на ДДС и финансови отчети\n• Подобряване на функционалността\n• Изпращане на важни известия',
      },
      {
        title: '4. Съхранение и сигурност',
        text: 'Данните се съхраняват сигурно в криптирани бази данни. Използваме индустриални стандарти за защита на вашата информация. Достъп до данните имат само оторизирани служители.',
      },
      {
        title: '5. Споделяне на данни',
        text: 'НЕ продаваме и НЕ споделяме вашите лични данни с трети страни, освен:\n• Когато е необходимо за предоставяне на услугата\n• По закон или съдебно разпореждане\n• С ваше изрично съгласие',
      },
      {
        title: '6. Вашите права',
        text: 'Имате право да:\n• Достъпите вашите данни\n• Коригирате неточности\n• Изтриете акаунта си\n• Експортирате данните си\n• Оттеглите съгласието си',
      },
      {
        title: '7. Контакт',
        text: 'За въпроси относно поверителността, моля свържете се с нас на: support@invoicemanager.app',
      },
    ],
  } : {
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: January 2025',
    sections: [
      {
        title: '1. Introduction',
        text: 'Invoice Manager ("we", "us", "the app") is committed to protecting the privacy of your data. This policy describes how we collect, use, and protect your information.',
      },
      {
        title: '2. Data Collection',
        text: 'We collect the following information:\n• Email address and name (during registration)\n• Invoice and financial record data\n• Company information\n• App usage data',
      },
      {
        title: '3. Data Usage',
        text: 'We use your data to:\n• Provide app services\n• Calculate VAT and financial reports\n• Improve functionality\n• Send important notifications',
      },
      {
        title: '4. Storage and Security',
        text: 'Data is stored securely in encrypted databases. We use industry standards to protect your information. Only authorized personnel have access to data.',
      },
      {
        title: '5. Data Sharing',
        text: 'We do NOT sell or share your personal data with third parties, except:\n• When necessary to provide the service\n• By law or court order\n• With your explicit consent',
      },
      {
        title: '6. Your Rights',
        text: 'You have the right to:\n• Access your data\n• Correct inaccuracies\n• Delete your account\n• Export your data\n• Withdraw your consent',
      },
      {
        title: '7. Contact',
        text: 'For privacy questions, please contact us at: support@invoicemanager.app',
      },
    ],
  };

  return (
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{content.title}</Text>
            <View style={styles.headerRight} />
          </View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            <Text style={styles.lastUpdated}>{content.lastUpdated}</Text>
            
            {content.sections.map((section, index) => (
              <View key={index} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionText}>{section.text}</Text>
              </View>
            ))}
            
            <View style={{ height: 40 }} />
          </ScrollView>
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
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
  },
  container: {
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
    padding: 20,
  },
  lastUpdated: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8B5CF6',
    marginBottom: 8,
  },
  sectionText: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 22,
  },
});

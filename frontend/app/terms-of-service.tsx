import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useLanguageStore } from '../src/i18n';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function TermsOfServiceScreen() {
  const { language } = useLanguageStore();
  
  const content = language === 'bg' ? {
    title: 'Условия за ползване',
    lastUpdated: 'Последна актуализация: Януари 2025',
    sections: [
      {
        title: '1. Приемане на условията',
        text: 'С използването на Invoice Manager вие приемате тези условия за ползване. Ако не сте съгласни с някое от условията, моля не използвайте приложението.',
      },
      {
        title: '2. Описание на услугата',
        text: 'Invoice Manager е приложение за управление на фактури, финансова отчетност и изчисляване на ДДС за бизнеси в България. Услугата включва OCR сканиране, статистики и backup функционалност.',
      },
      {
        title: '3. Потребителски акаунт',
        text: 'Вие сте отговорни за:\n• Поддържане на конфиденциалност на акаунта\n• Всички дейности под вашия акаунт\n• Актуалност на информацията\n• Незабавно уведомяване при неоторизиран достъп',
      },
      {
        title: '4. Допустимо използване',
        text: 'Съгласявате се да НЕ:\n• Използвате услугата за незаконни цели\n• Нарушавате права на интелектуална собственост\n• Опитвате да получите неоторизиран достъп\n• Разпространявате зловреден софтуер\n• Претоварвате системата с автоматизирани заявки',
      },
      {
        title: '5. Интелектуална собственост',
        text: 'Всички права върху приложението, включително код, дизайн, лого и съдържание, принадлежат на Invoice Manager. Получавате ограничен лиценз за лично, некомерсиално използване.',
      },
      {
        title: '6. Ограничение на отговорността',
        text: 'Услугата се предоставя "както е". Не гарантираме непрекъснатост или липса на грешки. Не носим отговорност за:\n• Загуба на данни\n• Финансови загуби от използване на приложението\n• Грешки в изчисленията',
      },
      {
        title: '7. Прекратяване',
        text: 'Можем да прекратим или спрем достъпа ви по всяко време, без предупреждение, при нарушаване на тези условия.',
      },
      {
        title: '8. Промени в условията',
        text: 'Запазваме правото да променяме тези условия. При съществени промени ще бъдете уведомени чрез приложението.',
      },
      {
        title: '9. Приложимо право',
        text: 'Тези условия се уреждат от законодателството на Република България. Спорове се решават от компетентните съдилища в България.',
      },
    ],
  } : {
    title: 'Terms of Service',
    lastUpdated: 'Last updated: January 2025',
    sections: [
      {
        title: '1. Acceptance of Terms',
        text: 'By using Invoice Manager, you accept these terms of service. If you do not agree with any of the terms, please do not use the application.',
      },
      {
        title: '2. Service Description',
        text: 'Invoice Manager is an application for invoice management, financial reporting, and VAT calculation for businesses in Bulgaria. The service includes OCR scanning, statistics, and backup functionality.',
      },
      {
        title: '3. User Account',
        text: 'You are responsible for:\n• Maintaining account confidentiality\n• All activities under your account\n• Keeping information up to date\n• Immediately reporting unauthorized access',
      },
      {
        title: '4. Acceptable Use',
        text: 'You agree NOT to:\n• Use the service for illegal purposes\n• Violate intellectual property rights\n• Attempt unauthorized access\n• Distribute malicious software\n• Overload the system with automated requests',
      },
      {
        title: '5. Intellectual Property',
        text: 'All rights to the application, including code, design, logo, and content, belong to Invoice Manager. You receive a limited license for personal, non-commercial use.',
      },
      {
        title: '6. Limitation of Liability',
        text: 'The service is provided "as is". We do not guarantee uninterrupted or error-free operation. We are not liable for:\n• Data loss\n• Financial losses from using the application\n• Calculation errors',
      },
      {
        title: '7. Termination',
        text: 'We may terminate or suspend your access at any time, without notice, for violation of these terms.',
      },
      {
        title: '8. Changes to Terms',
        text: 'We reserve the right to modify these terms. You will be notified of significant changes through the application.',
      },
      {
        title: '9. Governing Law',
        text: 'These terms are governed by the laws of the Republic of Bulgaria. Disputes are resolved by competent courts in Bulgaria.',
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

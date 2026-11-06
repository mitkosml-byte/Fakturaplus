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
import { ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function TermsOfServiceScreen() {
  const { language } = useLanguageStore();
  
  const content = language === 'bg' ? {
    title: 'Условия за ползване',
    lastUpdated: 'Последна актуализация: 31 октомври 2026 г.',
    sections: [
      {
        title: '1. Приемане на условията',
        text: 'С използването на Фактура+ вие приемате тези условия за ползване. Ако не сте съгласни с някое от условията, моля не използвайте приложението.',
      },
      {
        title: '2. Описание на услугата',
        text: 'Фактура+ е приложение за управление на фактури, дневен оборот, разходи, ведомости, работен график, дълготрайни активи и финансова отчетност за бизнеси в България. Услугата включва OCR сканиране на фактури (вкл. многостранични), автоматично изчисляване на ДДС, статистики и прогнози, AI асистент „Питай за числата си“, работа в екип с роли и права за достъп, работен график и отпуски, клиенти и вземания, личен тефтер „Джобче“, споделен календар и съобщения, бележки за членове на екипа, проследяване на цени, одитен лог, изчисляване на официалните празници, износ на данни и функционалност за износ/импорт на бекъп.',
      },
      {
        title: '3. Потребителски акаунт',
        text: 'Вие сте отговорни за:\n• Поддържане на конфиденциалност на акаунта\n• Всички дейности под вашия акаунт\n• Актуалност на информацията\n• Незабавно уведомяване при неоторизиран достъп\n• Данните, които въвеждате за други лица (служители, съдружници), включително уведомяването им, когато е приложимо по закон\n\nМожете да изтриете акаунта си по всяко време от Профил → Акаунт и сигурност - вижте т. 8 от Политиката за поверителност за точно какво се изтрива.',
      },
      {
        title: '4. Допустимо използване',
        text: 'Съгласявате се да НЕ:\n• Използвате услугата за незаконни цели\n• Нарушавате права на интелектуална собственост\n• Опитвате да получите неоторизиран достъп\n• Разпространявате зловреден софтуер\n• Претоварвате системата с автоматизирани заявки',
      },
      {
        title: '5. Интелектуална собственост',
        text: 'Всички права върху приложението, включително код, дизайн, лого и съдържание, принадлежат на Фактура+. Получавате ограничен лиценз за използване на услугата в рамките на вашата фирма.',
      },
      {
        title: '6. Плащания и абонаменти',
        text: 'Скан кредитите (пакети или автоматично презареждане) и платените абонаменти се заплащат през Stripe. Автоматичното презареждане е текущ абонамент, който се подновява периодично, докато не го изключите от екрана „Скан кредити“ - спирането важи занапред и не възстановява вече платени суми. Платени скан кредити не се възстановяват освен ако не е предвидено друго по закон. Безплатната месечна квота скан кредити се подновява автоматично всеки месец.',
      },
      {
        title: '7. Ограничение на отговорността',
        text: 'Услугата се предоставя "както е". Не гарантираме непрекъснатост или липса на грешки. Приложението е помощен инструмент - крайната отговорност за верността на счетоводните и данъчни резултати остава на потребителя/счетоводителя. AI асистентът „Питай за числата си“ и автоматичното разпознаване при сканиране дават информационни отговори, не професионален счетоводен или данъчен съвет - винаги проверявайте резултата. Не носим отговорност за:\n• Загуба на данни\n• Финансови загуби от използване на приложението\n• Грешки в изчисленията или в автоматично разпознатите от AI данни',
      },
      {
        title: '8. Прекратяване',
        text: 'Можем да прекратим или спрем достъпа ви по всяко време, без предупреждение, при нарушаване на тези условия.',
      },
      {
        title: '9. Промени в условията',
        text: 'Запазваме правото да променяме тези условия. При съществени промени ще бъдете уведомени чрез приложението.',
      },
      {
        title: '10. Приложимо право',
        text: 'Тези условия се уреждат от законодателството на Република България. Спорове се решават от компетентните съдилища в България.',
      },
    ],
  } : {
    title: 'Terms of Service',
    lastUpdated: 'Last updated: October 31, 2026',
    sections: [
      {
        title: '1. Acceptance of Terms',
        text: 'By using Fakturaplus, you accept these terms of service. If you do not agree with any of the terms, please do not use the application.',
      },
      {
        title: '2. Service Description',
        text: 'Fakturaplus is an application for managing invoices, daily revenue, expenses, payroll, work scheduling, fixed assets, and financial reporting for businesses in Bulgaria. The service includes OCR scanning of invoices (incl. multi-page ones), automatic VAT calculation, statistics and forecasts, the "Ask about your numbers" AI assistant, team collaboration with roles and access permissions, work scheduling and leave, customers and receivables, the personal "Wallet" ledger, a shared calendar and messaging, notes about team members, price tracking, an audit log, official-holiday calculation, data export, and backup export/import functionality.',
      },
      {
        title: '3. User Account',
        text: "You are responsible for:\n• Maintaining account confidentiality\n• All activities under your account\n• Keeping information up to date\n• Immediately reporting unauthorized access\n• Any data you enter about other individuals (employees, co-owners), including notifying them where required by law\n\nYou can delete your account at any time from Profile → Account & Security - see section 8 of the Privacy Policy for exactly what gets deleted.",
      },
      {
        title: '4. Acceptable Use',
        text: 'You agree NOT to:\n• Use the service for illegal purposes\n• Violate intellectual property rights\n• Attempt unauthorized access\n• Distribute malicious software\n• Overload the system with automated requests',
      },
      {
        title: '5. Intellectual Property',
        text: 'All rights to the application, including code, design, logo, and content, belong to Fakturaplus. You receive a limited license to use the service within your company.',
      },
      {
        title: '6. Payments and Subscriptions',
        text: 'Scan credits (one-time packages or auto-reload) and paid subscriptions are charged through Stripe. Auto-reload is a recurring subscription that renews periodically until you turn it off from the Scan Credits screen - turning it off applies going forward and does not refund amounts already charged. Purchased scan credits are non-refundable except where required by law. The free monthly scan-credit quota renews automatically each month.',
      },
      {
        title: '7. Limitation of Liability',
        text: 'The service is provided "as is". We do not guarantee uninterrupted or error-free operation. The app is a helper tool - final responsibility for the accuracy of accounting and tax results remains with the user/accountant. The "Ask about your numbers" AI assistant and the automatic recognition used while scanning give informational answers, not professional accounting or tax advice - always verify the result. We are not liable for:\n• Data loss\n• Financial losses from using the application\n• Errors in calculations or in AI-recognized data',
      },
      {
        title: '8. Termination',
        text: 'We may terminate or suspend your access at any time, without notice, for violation of these terms.',
      },
      {
        title: '9. Changes to Terms',
        text: 'We reserve the right to modify these terms. You will be notified of significant changes through the application.',
      },
      {
        title: '10. Governing Law',
        text: 'These terms are governed by the laws of the Republic of Bulgaria. Disputes are resolved by the competent courts in Bulgaria.',
      },
    ],
  };

  return (
    <ScreenEnter>
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
    </ScreenEnter>
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
    borderBottomColor: COLORS.border,
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
    color: COLORS.textMuted,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 8,
  },
  sectionText: {
    fontSize: 14,
    color: COLORS.textSubtle,
    lineHeight: 22,
  },
});

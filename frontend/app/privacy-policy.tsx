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
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function PrivacyPolicyScreen() {
  const { language } = useLanguageStore();
  
  // NOTE: no support domain/email exists yet - once the app has its own
  // domain, add a real contact address to the "Контакт"/"Contact" section
  // below instead of the in-app-only phrasing currently used there.
  const content = language === 'bg' ? {
    title: 'Политика за поверителност',
    lastUpdated: 'Последна актуализация: 30 септември 2026 г.',
    sections: [
      {
        title: '1. Въведение',
        text: 'Фактура+ ("ние", "нас", "приложението") се ангажира да защитава поверителността на вашите данни. Тази политика описва как събираме, използваме и защитаваме вашата информация.',
      },
      {
        title: '2. Събирани данни',
        text: 'Събираме следната информация:\n• Имейл адрес и име (при регистрация)\n• Данни за фактури и финансови записи (вкл. снимки на фактури, направени с камерата, при сканиране)\n• Информация за фирмата, вкл. ЕИК и банкови данни, ако ги въведете\n• Данни за служители, въведени от титуляря/мениджъра: имена, заплати, ваучери, осигуровки, отпуски и работа на празници\n• Съдържание на екипния календар и вътрешните съобщения, ако използвате тези функции\n• Токен за push известия, ако разрешите известия на устройството\n• Данни за използване на приложението',
      },
      {
        title: '3. Използване на данните',
        text: 'Използваме вашите данни за:\n• Предоставяне на услугите на приложението\n• Изчисляване на ДДС, ведомости и финансови отчети\n• Координация в екипа (споделен календар, вътрешни съобщения, push известия)\n• Подобряване на функционалността\n• Изпращане на важни известия',
      },
      {
        title: '4. Съхранение и сигурност',
        text: 'Прилагаме разумни технически и организационни мерки за сигурност, включително хеширане на пароли и контрол на достъпа - само членове на вашата фирма с подходяща роля виждат данните на фирмата.',
      },
      {
        title: '5. Споделяне на данни',
        text: 'Данните на фирмата (фактури, оборот, служители и т.н.) се виждат от всички членове на вашата фирма според ролята и правата им - това не е споделяне с трета страна, а вътрешен достъп в рамките на екипа, който сами управлявате.\n\nНЕ продаваме и НЕ споделяме вашите лични данни с външни трети страни, освен:\n• Когато е необходимо за предоставяне на услугата (напр. AI разпознаване на сканирани фактури)\n• По закон или съдебно разпореждане\n• С ваше изрично съгласие',
      },
      {
        title: '6. Вашите права',
        text: 'Имате право да:\n• Достъпите вашите данни\n• Коригирате неточности\n• Изтриете акаунта си\n• Експортирате данните си (Excel/PDF от съответните екрани)\n• Оттеглите съгласието си',
      },
      {
        title: '7. Контакт',
        text: 'За въпроси относно поверителността, моля свържете се с титуляря на вашата фирма или системния администратор в приложението.',
      },
    ],
  } : {
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: September 30, 2026',
    sections: [
      {
        title: '1. Introduction',
        text: 'Fakturaplus ("we", "us", "the app") is committed to protecting the privacy of your data. This policy describes how we collect, use, and protect your information.',
      },
      {
        title: '2. Data Collection',
        text: 'We collect the following information:\n• Email address and name (during registration)\n• Invoice and financial record data (incl. camera photos of invoices taken while scanning)\n• Company information, incl. tax ID (EIK) and bank details if you enter them\n• Employee data entered by the owner/manager: names, salaries, vouchers, insurance, leave and holiday work\n• Team calendar and internal message content, if you use those features\n• A push notification token, if you allow notifications on your device\n• App usage data',
      },
      {
        title: '3. Data Usage',
        text: 'We use your data to:\n• Provide app services\n• Calculate VAT, payroll, and financial reports\n• Support team coordination (shared calendar, internal messages, push notifications)\n• Improve functionality\n• Send important notifications',
      },
      {
        title: '4. Storage and Security',
        text: 'We apply reasonable technical and organizational security measures, including password hashing and access control - only members of your company with the appropriate role can see the company\'s data.',
      },
      {
        title: '5. Data Sharing',
        text: "Your company's data (invoices, revenue, employees, etc.) is visible to every member of your company according to their role and permissions - this is internal access within a team you manage, not sharing with a third party.\n\nWe do NOT sell or share your personal data with outside third parties, except:\n• When necessary to provide the service (e.g. AI recognition of scanned invoices)\n• By law or court order\n• With your explicit consent",
      },
      {
        title: '6. Your Rights',
        text: 'You have the right to:\n• Access your data\n• Correct inaccuracies\n• Delete your account\n• Export your data (Excel/PDF from the relevant screens)\n• Withdraw your consent',
      },
      {
        title: '7. Contact',
        text: "For privacy questions, please contact your company's owner or system administrator within the app.",
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

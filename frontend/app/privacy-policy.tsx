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
import { ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

export default function PrivacyPolicyScreen() {
  const { language } = useLanguageStore();
  
  // NOTE: no support domain/email exists yet - once the app has its own
  // domain, add a real contact address to the "Контакт"/"Contact" section
  // below instead of the in-app-only phrasing currently used there.
  const content = language === 'bg' ? {
    title: 'Политика за поверителност',
    lastUpdated: 'Последна актуализация: 31 октомври 2026 г.',
    sections: [
      {
        title: '1. Въведение',
        text: 'Фактура+ ("ние", "нас", "приложението") се ангажира да защитава поверителността на вашите данни. Тази политика описва как събираме, използваме и защитаваме вашата информация.',
      },
      {
        title: '2. Събирани данни',
        text: 'Събираме следната информация:\n• Имейл адрес и име (при регистрация)\n• Профилна снимка, ако качите такава\n• Данни за фактури и финансови записи (вкл. снимки на фактури, направени с камерата, при сканиране)\n• Информация за фирмата, вкл. ЕИК и банкови данни, ако ги въведете\n• Данни за служители, въведени от титуляря/мениджъра: имена, заплати, ваучери, осигуровки, отпуски, работен график и работа на празници\n• Бележки за членове на екипа, въведени от титуляря/мениджъра в профила на служителя\n• Данни за клиенти, ако водите клиенти и вземания: име, телефон, имейл, бележки\n• Лични финансови записи в „Джобче“ (личен тефтер), ако използвате тази функция - водят се отделно от фирмените данни\n• Съдържание на екипния календар и вътрешните съобщения, ако използвате тези функции\n• Въпросите, които задавате на AI асистента „Питай за числата си“\n• Токен за push известия, ако разрешите известия на устройството\n• Данни за използване на приложението',
      },
      {
        title: '3. Използване на данните',
        text: 'Използваме вашите данни за:\n• Предоставяне на услугите на приложението\n• Изчисляване на ДДС, ведомости и финансови отчети\n• Координация в екипа (работен график, споделен календар, вътрешни съобщения, push известия)\n• AI разпознаване на сканирани фактури и отговори на въпроси за вашите финанси\n• Обработка на плащания при закупуване на скан кредити или абонамент\n• Подобряване на функционалността\n• Изпращане на важни известия',
      },
      {
        title: '4. Съхранение и сигурност',
        text: 'Прилагаме разумни технически и организационни мерки за сигурност, включително хеширане на пароли и контрол на достъпа - само членове на вашата фирма с подходяща роля виждат данните на фирмата, а всяко създаване, редактиране или изтриване на чувствителни записи (служители, работен график, плащания) се записва в дневник за одит (Audit log), видим за титуляря.',
      },
      {
        title: '5. AI обработка на данни',
        text: 'За разпознаване на сканирани фактури (OCR) и за AI асистента „Питай за числата си“ използваме Anthropic (доставчик на AI модела Claude). При сканиране изпращаме снимката на фактурата; при въпрос към асистента изпращаме кратко обобщение на избраните от вас финансови показатели (приходи, разходи, оборот и т.н.), не пълната ви база данни. Тези данни се обработват единствено за връщане на резултат в приложението, в съответствие с условията на доставчика за API достъп. AI функциите са по избор - останалата част от приложението работи напълно и без тях.',
      },
      {
        title: '6. Плащания',
        text: 'При закупуване на скан кредити или активиране на абонамент плащането се обработва директно от Stripe - сертифициран международен доставчик на платежни услуги. НЕ съхраняваме номера на банкови карти - те се въвеждат директно в сигурната платежна страница на Stripe. До нас достига само резултатът от плащането и минимална информация за транзакцията, необходима за счетоводни цели.',
      },
      {
        title: '7. Споделяне на данни',
        text: 'Данните на фирмата (фактури, оборот, служители и т.н.) се виждат от всички членове на вашата фирма според ролята и правата им - това не е споделяне с трета страна, а вътрешен достъп в рамките на екипа, който сами управлявате.\n\nНЕ продаваме и НЕ споделяме вашите лични данни с външни трети страни, освен:\n• Когато е необходимо за предоставяне на услугата (вижте т. 5 и т. 6 по-горе - AI обработка и плащания)\n• По закон или съдебно разпореждане\n• С ваше изрично съгласие',
      },
      {
        title: '8. Вашите права',
        text: 'Имате право да:\n• Достъпите вашите данни\n• Коригирате неточности\n• Изтриете акаунта си (Профил → Акаунт и сигурност → Изтрий акаунта) - премахва трайно личните ви данни (име, имейл, парола, снимка). Фирмените записи (фактури, служители и т.н.) остават достъпни за останалите членове на фирмата, а ако сте били неин единствен собственик - се запазват по счетоводното законодателство, без връзка към ваш личен акаунт\n• Експортирате данните си (Excel/PDF от съответните екрани)\n• Оттеглите съгласието си',
      },
      {
        title: '9. Контакт',
        text: 'За въпроси относно поверителността, моля свържете се с титуляря на вашата фирма или системния администратор в приложението.',
      },
    ],
  } : {
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: October 31, 2026',
    sections: [
      {
        title: '1. Introduction',
        text: 'Fakturaplus ("we", "us", "the app") is committed to protecting the privacy of your data. This policy describes how we collect, use, and protect your information.',
      },
      {
        title: '2. Data Collection',
        text: 'We collect the following information:\n• Email address and name (during registration)\n• A profile photo, if you upload one\n• Invoice and financial record data (incl. camera photos of invoices taken while scanning)\n• Company information, incl. tax ID (EIK) and bank details if you enter them\n• Employee data entered by the owner/manager: names, salaries, vouchers, insurance, leave, work schedule, and holiday work\n• Notes about team members, entered by the owner/manager on an employee\'s profile\n• Customer data, if you track customers and receivables: name, phone, email, notes\n• Personal financial entries in the "Wallet" (personal ledger) feature, if you use it - kept separate from company data\n• Team calendar and internal message content, if you use those features\n• Questions you ask the "Ask about your numbers" AI assistant\n• A push notification token, if you allow notifications on your device\n• App usage data',
      },
      {
        title: '3. Data Usage',
        text: 'We use your data to:\n• Provide app services\n• Calculate VAT, payroll, and financial reports\n• Support team coordination (work schedule, shared calendar, internal messages, push notifications)\n• AI recognition of scanned invoices and answering questions about your finances\n• Process payments when you purchase scan credits or a subscription\n• Improve functionality\n• Send important notifications',
      },
      {
        title: '4. Storage and Security',
        text: "We apply reasonable technical and organizational security measures, including password hashing and access control - only members of your company with the appropriate role can see the company's data, and creating, editing, or deleting sensitive records (employees, work schedule, payments) is recorded in an audit log visible to the owner.",
      },
      {
        title: '5. AI Processing',
        text: 'For scanned-invoice recognition (OCR) and the "Ask about your numbers" AI assistant, we use Anthropic (provider of the Claude AI model). When scanning, we send the invoice photo; when you ask the assistant a question, we send a short summary of the financial figures you have access to (revenue, expenses, turnover, etc.), not your full database. This data is processed solely to return a result inside the app, under the provider\'s API terms. The AI features are optional - the rest of the app works fully without them.',
      },
      {
        title: '6. Payments',
        text: "When you purchase scan credits or activate a subscription, payment is processed directly by Stripe, a certified international payment service provider. We do NOT store card numbers - they are entered directly on Stripe's secure payment page. We only receive the payment result and the minimal transaction information needed for accounting purposes.",
      },
      {
        title: '7. Data Sharing',
        text: "Your company's data (invoices, revenue, employees, etc.) is visible to every member of your company according to their role and permissions - this is internal access within a team you manage, not sharing with a third party.\n\nWe do NOT sell or share your personal data with outside third parties, except:\n• When necessary to provide the service (see sections 5 and 6 above - AI processing and payments)\n• By law or court order\n• With your explicit consent",
      },
      {
        title: '8. Your Rights',
        text: "You have the right to:\n• Access your data\n• Correct inaccuracies\n• Delete your account (Profile → Account & Security → Delete account) - permanently removes your personal data (name, email, password, photo). Company records (invoices, employees, etc.) remain available to other company members, or, if you were its sole owner, are retained under accounting law with no link to a personal account\n• Export your data (Excel/PDF from the relevant screens)\n• Withdraw your consent",
      },
      {
        title: '9. Contact',
        text: "For privacy questions, please contact your company's owner or system administrator within the app.",
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

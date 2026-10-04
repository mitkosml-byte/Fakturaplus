import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation, useLanguageStore } from '../src/i18n';
import { api } from '../src/services/api';
import { ScreenEnter } from '../src/components';
import { COLORS } from '../src/theme/colors';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

interface HelpSection {
  icon: string;
  title: string;
  content: string[];
}

export default function HelpScreen() {
  const { t } = useTranslation();
  const { language } = useLanguageStore();

  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackAnonymous, setFeedbackAnonymous] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<'idle' | 'submitting' | 'success' | 'error' | 'empty'>('idle');

  const handleSubmitFeedback = async () => {
    if (!feedbackMessage.trim()) {
      setFeedbackStatus('empty');
      return;
    }
    setFeedbackStatus('submitting');
    try {
      await api.submitFeedback(feedbackMessage.trim(), feedbackAnonymous);
      setFeedbackMessage('');
      setFeedbackStatus('success');
    } catch (error) {
      setFeedbackStatus('error');
    }
  };

  // Help content based on language
  const helpSections = language === 'bg' ? [
    {
      icon: 'information-circle',
      title: 'За приложението',
      content: [
        'Фактура+ е приложение за управление на фактури, оборот, разходи, персонал и финансова отчетност за малки и средни бизнеси в България.',
        'Помага за проследяване на приходи, разходи, ДДС, служители и активи - с поддръжка на екип от няколко потребители с различни роли.',
      ],
    },
    {
      icon: 'scan',
      title: 'Сканиране на фактури (OCR)',
      content: [
        '📷 Натиснете "Сканирай" в долното меню',
        '📄 Заснемете фактурата с камерата или изберете от галерията',
        '📑 Ако фактурата е на няколко страници, натиснете "Добави страница" - AI разпознава данните от всички страници заедно',
        '🔍 Системата автоматично ще извлече: доставчик, ЕИК, номер, дата, суми, ДДС третиране и артикули',
        '✏️ Можете да редактирате извлечените данни ако има грешки',
        '💾 Запазете фактурата с бутона "Запази" - сканираните страници остават достъпни за преглед от детайлите на фактурата',
        '🧾 Режим "Издадена фактура" прехвърля сумата директно в дневния оборот, без отделен запис на фактура',
      ],
    },
    {
      icon: 'cash',
      title: 'Дневен оборот',
      content: [
        '💰 Въвеждайте дневния фискализиран оборот от касов апарат за избрана дата',
        '✏️ Записът за деня се ПОПРАВЯ, а не се добавя - ако запазите нова сума за дата, на която вече има въведена, тя ЗАМЕСТВА старата (не се сумират)',
        '👛 "Джобче" е за суми които НЕ влизат в ДДС изчислението',
        '💳 Отделно поле за оборот с карта',
        '📅 Можете да изберете конкретна дата от календара',
      ],
    },
    {
      icon: 'trending-down',
      title: 'В канала (разходи без фактура)',
      content: [
        '🛒 Записвайте разходи за които нямате фактура',
        '📝 Въведете описание и сума - всеки запис е отделен ред (не заменя предишен)',
        '📋 Виждате списък с разходите за избраната дата',
        '🗑️ Можете да изтривате грешно въведени записи',
        '⚠️ Тези разходи НЕ дават право на данъчен кредит',
      ],
    },
    {
      icon: 'calculator',
      title: 'ДДС изчисление',
      content: [
        '📈 ДДС от продажби се изчислява от въведения оборот и избраната ставка (20%, 9% или 0%)',
        '📉 ДДС кредит = ДДС от входящите фактури, според избраното ДДС третиране на всяка (стандартно 20%, намалено 9%, нулева ставка, освободени, извън обхвата или обратно начисляване)',
        '📄 При обратно начисляване приложението автоматично номерира протокол по чл. 117 ЗДДС',
        '💳 ДДС за плащане = ДДС продажби - ДДС кредит',
        '📊 Дневник на покупки/продажби (ДДС дневник) се експортира от Профил → Експорт за конкретен период',
      ],
    },
    {
      icon: 'bar-chart',
      title: 'Статистики и прогнози',
      content: [
        '📊 Преглед на приходи, разходи и печалба за седмица, месец, година или изминал период',
        '📈 Графики с барчета по дни, вкл. изменение спрямо предходен период',
        '🌙 Почивните дни на фирмата (вижте секция "Почивни дни" по-долу) се показват в сиво и се изключват от средния дневен оборот',
        '🏆 Топ доставчици и артикули по суми',
        '🔮 Прогноза за приходи/разходи и анализ на възвръщаемостта (ROI) - само за титуляря',
        '🔄 Дърпане надолу за опресняване на данните',
      ],
    },
    {
      icon: 'wallet',
      title: 'Бюджет',
      content: [
        '🎯 Задайте месечен лимит на разходите в Профил → Бюджет',
        '🔔 Получавате известие при доближаване или надвишаване на лимита',
        '📆 Бюджетът е за текущия месец и се преизчислява всеки месец',
      ],
    },
    {
      icon: 'business',
      title: 'Фирма, роли и права',
      content: [
        '🏢 Въведете данните на фирмата в Профил → Фирма',
        '👥 Множество потребители могат да споделят една фирма - поканете ги с роля Мениджър, Служител или Счетоводител',
        '🏭 Собственик на няколко фирми? Добавете допълнителна фирма от банера с името на фирмата в Профил и превключвайте между тях',
        '🤝 За ООД с повече от един собственик - добавяте допълнителни титуляри; премахването на титуляр изисква одобрение от всички останали титуляри (защита срещу злоупотреба при вътрешен конфликт)',
        '🔐 Всяка роля има права по подразбиране, които титулярят може фино да настрои за всеки поканен потребител поотделно (напр. достъп до печалба, лични средства, извънфактурни разходи)',
        '⚠️ Защита от дублиране на фактури за цялата фирма',
      ],
    },
    {
      icon: 'people',
      title: 'Служители и ведомости',
      content: [
        '👤 Добавете служители в Профил → Ведомост за заплати, с брутна/нетна заплата, ваучери за храна и осигуровки',
        '🧮 Приложението изчислява осигуровки, данък и нетна сума за всеки служител по месеци',
        '📑 Ведомостните записи се пазят по месец и година за история',
      ],
    },
    {
      icon: 'sunny',
      title: 'Празници и отпуски',
      content: [
        '🎉 Профил → Празници и отпуски отбелязва кои служители са работили на официален празник (за допълнително възнаграждение по чл. 262 КТ)',
        '🏖️ Записвайте отпуски по вид - платена, неплатена или болнична, с период от-до',
        '📅 Официалният празничен календар (вкл. Великден и компенсиращите почивни дни) се изчислява автоматично за всяка година',
        '📤 Счетоводителят може да изтегли Excel файл със списъка за избран период, за прилагане към фирмените документи',
      ],
    },
    {
      icon: 'calendar-outline',
      title: 'Почивни дни',
      content: [
        '📅 Профил → Почивни дни - отбележете кои дни от седмицата фирмата обичайно е затворена (напр. неделя)',
        '➕ Добавяйте и еднократни изключения през вграден календар - празник, ремонт или отваряне на иначе затворен ден',
        '📉 Почивните дни се изключват от средния дневен оборот в статистиките, вместо да се броят като дни с нулев оборот',
      ],
    },
    {
      icon: 'cube',
      title: 'Дълготрайни активи (ДМА)',
      content: [
        '🏗️ Добавяйте дълготрайни активи по данъчна категория в Профил → Дълготрайни активи',
        '📉 Приложението изчислява годишна данъчна и счетоводна амортизация автоматично',
        '📋 Проследявате статус: активен, напълно амортизиран или изведен от употреба',
      ],
    },
    {
      icon: 'pricetags',
      title: 'Проследяване на цени и доставчици',
      content: [
        '📈 Приложението следи историята на цените по артикул и доставчик от сканираните фактури',
        '🔔 Получавате аларма при рязко покачване на цена над зададен праг (настройва се в Статистики)',
        '🧩 AI автоматично обединява едни и същи артикули/доставчици, изписани по различен начин на различни фактури',
      ],
    },
    {
      icon: 'people-circle',
      title: 'Екип: календар и съобщения',
      content: [
        '📅 Споделен календар за събития и напомняния между собственик, мениджър и счетоводител',
        '💬 Вътрешен чат - екипен канал и лични съобщения между членовете на фирмата',
        '🔔 Push известия за нови съобщения и предстоящи събития (ако разрешите известия на устройството)',
      ],
    },
    {
      icon: 'person-circle',
      title: 'Лични вложения (само за титуляря)',
      content: [
        '💼 Проследявайте лични средства, които влагате в бизнеса (стока, наем, персонал и др.) - за анализ на възвръщаемостта (ROI). За разходи, които теглите от бизнеса за лични нужди, вижте Лично тефтерче',
        '📜 Пълна история с филтри по период, вид и категория в Начало → История',
      ],
    },
    {
      icon: 'document-text',
      title: 'Одитен лог',
      content: [
        '🕵️ Профил → Одитен лог показва кой какво е направил (създал, редактирал, изтрил) и кога - вижда се само от роли с достъп',
      ],
    },
    {
      icon: 'cloud-upload',
      title: 'Backup',
      content: [
        '☁️ Профил → Google Drive бекъп',
        '📤 Създайте backup и го запазете в Google Drive',
        '📥 Възстановете данни от backup файл',
        '🔒 Данните се съхраняват сигурно в базата данни на приложението',
      ],
    },
  ] : [
    {
      icon: 'information-circle',
      title: 'About the App',
      content: [
        'Fakturaplus is an app for managing invoices, revenue, expenses, staff, and financial reporting for small and medium businesses in Bulgaria.',
        'It helps track income, expenses, VAT, employees, and assets - with support for a team of several users in different roles.',
      ],
    },
    {
      icon: 'scan',
      title: 'Invoice Scanning (OCR)',
      content: [
        '📷 Press "Scan" in the bottom menu',
        '📄 Capture the invoice with the camera or select from the gallery',
        '📑 If the invoice spans several pages, tap "Add page" - AI reads all pages together',
        '🔍 The system automatically extracts: supplier, EIK, number, date, amounts, VAT treatment and line items',
        '✏️ You can edit the extracted data if there are errors',
        '💾 Save the invoice with the "Save" button - the scanned pages stay available from the invoice detail view',
        '🧾 "Issued invoice" mode adds the amount directly to daily revenue instead of a separate invoice record',
      ],
    },
    {
      icon: 'cash',
      title: 'Daily Revenue',
      content: [
        '💰 Enter the daily fiscal revenue from the cash register for a chosen date',
        "✏️ The day's entry is CORRECTED, not added to - saving a new amount for a date that already has one REPLACES it (amounts are not summed)",
        '👛 "Pocket money" is for amounts NOT included in the VAT calculation',
        '💳 A separate field for card revenue',
        '📅 You can pick a specific date from the calendar',
      ],
    },
    {
      icon: 'trending-down',
      title: 'Expenses (no invoice)',
      content: [
        '🛒 Record expenses you have no invoice for',
        '📝 Enter description and amount - each entry is its own line (does not replace a previous one)',
        '📋 See the list of expenses for the selected date',
        '🗑️ You can delete incorrectly entered records',
        '⚠️ These expenses do NOT give VAT credit',
      ],
    },
    {
      icon: 'calculator',
      title: 'VAT Calculation',
      content: [
        '📈 Sales VAT is calculated from the entered revenue and the chosen rate (20%, 9% or 0%)',
        '📉 VAT credit = VAT from incoming invoices, per each one\'s VAT treatment (standard 20%, reduced 9%, zero rate, exempt, outside scope, or reverse charge)',
        '📄 For reverse charge, the app automatically numbers a Чл. 117 ЗДДС self-billing protocol',
        '💳 VAT to pay = Sales VAT - VAT credit',
        '📊 The purchases/sales VAT ledger exports from Profile → Export for any period',
      ],
    },
    {
      icon: 'bar-chart',
      title: 'Statistics and Forecasts',
      content: [
        '📊 Overview of income, expenses and profit by week, month, year, or a past period',
        '📈 Daily bar charts, including change vs. the previous period',
        "🌙 The company's closed days (see \"Closed days\" below) show in grey and are excluded from the average daily turnover",
        '🏆 Top suppliers and items by amount',
        '🔮 Revenue/expense forecast and ROI analysis - owner only',
        '🔄 Pull down to refresh',
      ],
    },
    {
      icon: 'wallet',
      title: 'Budget',
      content: [
        '🎯 Set a monthly expense limit in Profile → Budget',
        '🔔 Get notified when approaching or exceeding the limit',
        '📆 The budget is for the current month and resets each month',
      ],
    },
    {
      icon: 'business',
      title: 'Company, Roles and Permissions',
      content: [
        '🏢 Enter the company data in Profile → Company',
        '👥 Multiple users can share one company - invite them as Manager, Staff or Accountant',
        '🏭 Own more than one company? Add another one from the company-name banner in Profile and switch between them',
        '🤝 For a multi-owner company (ООД) - add additional owners; removing an owner requires approval from every other owner (protects against abuse in an internal conflict)',
        '🔐 Each role has default permissions, which the owner can fine-tune per invited user (e.g. access to profit, personal funds, off-book expenses)',
        '⚠️ Protection against duplicate invoices across the whole company',
      ],
    },
    {
      icon: 'people',
      title: 'Employees and Payroll',
      content: [
        '👤 Add employees in Profile → Payroll, with gross/net salary, food vouchers and insurance',
        '🧮 The app calculates insurance, tax and net pay for each employee, by month',
        '📑 Payroll entries are kept by month and year for history',
      ],
    },
    {
      icon: 'sunny',
      title: 'Holidays and Leave',
      content: [
        '🎉 Profile → Holidays and leave logs which employees worked on an official holiday (extra-pay entitlement under Чл. 262 КТ)',
        '🏖️ Log leave by type - paid, unpaid or sick - with a start-end date range',
        '📅 The official holiday calendar (incl. Easter and the compensating days off) is computed automatically for every year',
        '📤 The accountant can download an Excel list for a chosen period, to attach to company documents',
      ],
    },
    {
      icon: 'calendar-outline',
      title: 'Closed Days',
      content: [
        "📅 Profile → Closed days - mark which weekdays the business is normally closed (e.g. Sunday)",
        '➕ Add one-off exceptions on a built-in calendar - a holiday, a closure for repairs, or reopening an otherwise-closed day',
        '📉 Closed days are excluded from the average daily turnover in statistics instead of counting as zero-revenue days',
      ],
    },
    {
      icon: 'cube',
      title: 'Fixed Assets',
      content: [
        '🏗️ Add fixed assets by tax category in Profile → Fixed Assets',
        '📉 The app calculates annual tax and accounting depreciation automatically',
        '📋 Track status: active, fully depreciated, or disposed',
      ],
    },
    {
      icon: 'pricetags',
      title: 'Price and Supplier Tracking',
      content: [
        '📈 The app tracks price history per item and supplier from scanned invoices',
        '🔔 Get an alert when a price jumps above a set threshold (configured in Statistics)',
        '🧩 AI automatically merges the same item/supplier written differently across invoices',
      ],
    },
    {
      icon: 'people-circle',
      title: 'Team: Calendar and Messages',
      content: [
        '📅 A shared calendar for events and reminders between the owner, manager and accountant',
        '💬 A built-in chat - a team channel and direct messages between company members',
        '🔔 Push notifications for new messages and upcoming events (if you allow notifications on your device)',
      ],
    },
    {
      icon: 'person-circle',
      title: 'Personal Investments (owner only)',
      content: [
        '💼 Track personal funds you invest into the business (goods, rent, personnel, etc.) - for return-on-investment (ROI) analysis. For expenses you withdraw from the business for personal use, see Personal Wallet',
        '📜 Full history with filters by period, type and category under Home → History',
      ],
    },
    {
      icon: 'document-text',
      title: 'Audit Log',
      content: [
        '🕵️ Profile → Audit log shows who did what (created, edited, deleted) and when - visible only to roles with access',
      ],
    },
    {
      icon: 'cloud-upload',
      title: 'Backup',
      content: [
        '☁️ Profile → Google Drive backup',
        '📤 Create a backup and save it to Google Drive',
        '📥 Restore data from a backup file',
        "🔒 Data is stored securely in the app's own database",
      ],
    },
  ];
  
  return (
    <ScreenEnter>
    <ImageBackground source={{ uri: BACKGROUND_IMAGE }} style={styles.backgroundImage}>
      <View style={styles.overlay}>
        <SafeAreaView style={styles.container} edges={['top']}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="white" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{t('help.title')}</Text>
            <View style={styles.headerRight} />
          </View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            {/* App Logo/Title */}
            <View style={styles.appInfo}>
              <Ionicons name="receipt" size={48} color={COLORS.primary} />
              <Text style={styles.appTitle}>{t('help.appTitle')}</Text>
              <Text style={styles.appSubtitle}>{t('help.appSubtitle')}</Text>
              <Text style={styles.appVersion}>{t('help.version')} 1.0.0</Text>
            </View>

            {/* Help Sections */}
            {helpSections.map((section, index) => (
              <View key={index} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name={section.icon as any} size={24} color={COLORS.primary} />
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                </View>
                <View style={styles.sectionContent}>
                  {section.content.map((item, itemIndex) => (
                    <Text key={itemIndex} style={styles.sectionText}>
                      {item}
                    </Text>
                  ))}
                </View>
              </View>
            ))}

            {/* Contact/Support */}
            <View style={styles.supportCard}>
              <Ionicons name="help-buoy" size={32} color={COLORS.success} />
              <Text style={styles.supportTitle}>{t('help.needHelp')}</Text>
              <Text style={styles.supportText}>
                {t('help.contactSupport')}
              </Text>
            </View>

            {/* Feedback box */}
            <View style={styles.feedbackCard}>
              <View style={styles.feedbackHeader}>
                <Ionicons name="chatbubble-ellipses" size={26} color={COLORS.primary} />
                <Text style={styles.feedbackTitle}>{t('feedback.title')}</Text>
              </View>
              <Text style={styles.feedbackIntro}>{t('feedback.intro')}</Text>

              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleButton, feedbackAnonymous && styles.toggleButtonActive]}
                  onPress={() => setFeedbackAnonymous(true)}
                >
                  <Ionicons name="eye-off-outline" size={16} color={feedbackAnonymous ? 'white' : COLORS.textSecondary} />
                  <Text style={[styles.toggleButtonText, feedbackAnonymous && styles.toggleButtonTextActive]}>
                    {t('feedback.anonymousLabel')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleButton, !feedbackAnonymous && styles.toggleButtonActive]}
                  onPress={() => setFeedbackAnonymous(false)}
                >
                  <Ionicons name="person-outline" size={16} color={!feedbackAnonymous ? 'white' : COLORS.textSecondary} />
                  <Text style={[styles.toggleButtonText, !feedbackAnonymous && styles.toggleButtonTextActive]}>
                    {t('feedback.namedLabel')}
                  </Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.feedbackInput}
                placeholder={t('feedback.placeholder')}
                placeholderTextColor={COLORS.textMuted}
                value={feedbackMessage}
                onChangeText={(v) => {
                  setFeedbackMessage(v);
                  if (feedbackStatus !== 'idle') setFeedbackStatus('idle');
                }}
                multiline
                numberOfLines={4}
                maxLength={2000}
                textAlignVertical="top"
              />

              {feedbackStatus === 'empty' && (
                <Text style={styles.feedbackErrorText}>{t('feedback.emptyError')}</Text>
              )}
              {feedbackStatus === 'error' && (
                <Text style={styles.feedbackErrorText}>{t('feedback.error')}</Text>
              )}
              {feedbackStatus === 'success' && (
                <Text style={styles.feedbackSuccessText}>{t('feedback.success')}</Text>
              )}

              <TouchableOpacity
                style={styles.feedbackSubmitButton}
                onPress={handleSubmitFeedback}
                disabled={feedbackStatus === 'submitting'}
              >
                {feedbackStatus === 'submitting' ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={styles.feedbackSubmitButtonText}>{t('feedback.submit')}</Text>
                )}
              </TouchableOpacity>
            </View>

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
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
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
    padding: 16,
  },
  appInfo: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 16,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 12,
  },
  appSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  appVersion: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 8,
  },
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  sectionContent: {
    padding: 16,
  },
  sectionText: {
    fontSize: 14,
    color: COLORS.textSubtle,
    lineHeight: 22,
    marginBottom: 8,
  },
  supportCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  supportTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.success,
    marginTop: 12,
  },
  supportText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  feedbackCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  feedbackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  feedbackTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  feedbackIntro: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 19,
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toggleButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  toggleButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  toggleButtonTextActive: {
    color: 'white',
  },
  feedbackInput: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    color: 'white',
    fontSize: 14,
    minHeight: 90,
    marginBottom: 10,
  },
  feedbackErrorText: {
    fontSize: 12,
    color: COLORS.danger,
    marginBottom: 8,
  },
  feedbackSuccessText: {
    fontSize: 12,
    color: COLORS.success,
    marginBottom: 8,
  },
  feedbackSubmitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  feedbackSubmitButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
});

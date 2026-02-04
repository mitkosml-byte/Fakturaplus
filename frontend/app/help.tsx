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
import { useTranslation, useLanguageStore } from '../src/i18n';

const BACKGROUND_IMAGE = 'https://images.unsplash.com/photo-1571161535093-e7642c4bd0c8?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMjh8MHwxfHNlYXJjaHwzfHxjYWxtJTIwbmF0dXJlJTIwbGFuZHNjYXBlfGVufDB8fHxibHVlfDE3Njk3OTQ3ODF8MA&ixlib=rb-4.1.0&q=85';

interface HelpSection {
  icon: string;
  title: string;
  content: string[];
}

export default function HelpScreen() {
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  
  // Help content based on language
  const helpSections = language === 'bg' ? [
    {
      icon: 'information-circle',
      title: 'За приложението',
      content: [
        'Това приложение е създадено за управление на входящи фактури и финансова отчетност за малки и средни бизнеси в България.',
        'Помага за проследяване на приходи, разходи и автоматично изчисляване на ДДС.',
      ],
    },
    {
      icon: 'scan',
      title: 'Сканиране на фактури (OCR)',
      content: [
        '📷 Натиснете "Сканирай" в долното меню',
        '📄 Заснемете фактурата с камерата или изберете от галерията',
        '🔍 Системата автоматично ще извлече: доставчик, номер, суми и дата',
        '✏️ Можете да редактирате извлечените данни ако има грешки',
        '💾 Запазете фактурата с бутона "Запази"',
      ],
    },
    {
      icon: 'cash',
      title: 'Дневен оборот',
      content: [
        '💰 Въвеждайте дневния фискализиран оборот от касов апарат',
        '📊 Сумите се добавят автоматично - не се заменят',
        '👛 "Джобче" е за суми които НЕ влизат в ДДС изчислението',
        '📅 Можете да изберете конкретна дата от календара',
      ],
    },
    {
      icon: 'trending-down',
      title: 'В канала (разходи без фактура)',
      content: [
        '🛒 Записвайте разходи за които нямате фактура',
        '📝 Въведете описание и сума',
        '📋 Виждате списък с разходите за избраната дата',
        '🗑️ Можете да изтривате грешно въведени записи',
        '⚠️ Тези разходи НЕ дават право на данъчен кредит',
      ],
    },
    {
      icon: 'calculator',
      title: 'ДДС изчисление',
      content: [
        '📈 ДДС от продажби = 20% от фискализирания оборот',
        '📉 ДДС кредит = ДДС от входящите фактури',
        '💳 ДДС за плащане = ДДС продажби - ДДС кредит',
        '📆 Статистиките се изчисляват за текущия календарен месец',
      ],
    },
    {
      icon: 'bar-chart',
      title: 'Статистики',
      content: [
        '📊 Преглед на приходи, разходи и печалба',
        '📈 Графики по седмица, месец или година',
        '🏆 Топ 10 доставчици по суми',
        '🔄 Дърпане надолу за опресняване на данните',
      ],
    },
    {
      icon: 'business',
      title: 'Фирмени данни',
      content: [
        '🏢 Въведете данните на фирмата в Профил → Фирма',
        '👥 Множество потребители могат да споделят една фирма',
        '🔗 Присъединете се към съществуваща фирма по ЕИК',
        '⚠️ Защита от дублиране на фактури за цялата фирма',
      ],
    },
    {
      icon: 'cloud-upload',
      title: 'Backup',
      content: [
        '☁️ Профил → Google Drive бекъп',
        '📤 Създайте backup и го запазете в Google Drive',
        '📥 Възстановете данни от backup файл',
        '🔒 Данните се съхраняват сигурно локално',
      ],
    },
  ] : [
    {
      icon: 'information-circle',
      title: 'About the App',
      content: [
        'This app is designed for managing incoming invoices and financial reporting for small and medium businesses in Bulgaria.',
        'It helps track income, expenses, and automatically calculates VAT.',
      ],
    },
    {
      icon: 'scan',
      title: 'Invoice Scanning (OCR)',
      content: [
        '📷 Press "Scan" in the bottom menu',
        '📄 Capture the invoice with camera or select from gallery',
        '🔍 The system will automatically extract: supplier, number, amounts and date',
        '✏️ You can edit the extracted data if there are errors',
        '💾 Save the invoice with the "Save" button',
      ],
    },
    {
      icon: 'cash',
      title: 'Daily Revenue',
      content: [
        '💰 Enter the daily fiscal revenue from cash register',
        '📊 Amounts are added automatically - not replaced',
        '👛 "Pocket money" is for amounts NOT included in VAT calculation',
        '📅 You can select a specific date from the calendar',
      ],
    },
    {
      icon: 'trending-down',
      title: 'Expenses (no invoice)',
      content: [
        '🛒 Record expenses without invoice',
        '📝 Enter description and amount',
        '📋 See the list of expenses for the selected date',
        '🗑️ You can delete incorrectly entered records',
        '⚠️ These expenses do NOT give VAT credit',
      ],
    },
    {
      icon: 'calculator',
      title: 'VAT Calculation',
      content: [
        '📈 VAT from sales = 20% of fiscal revenue',
        '📉 VAT credit = VAT from incoming invoices',
        '💳 VAT to pay = Sales VAT - VAT credit',
        '📆 Statistics are calculated for the current calendar month',
      ],
    },
    {
      icon: 'bar-chart',
      title: 'Statistics',
      content: [
        '📊 Overview of income, expenses and profit',
        '📈 Charts by week, month or year',
        '🏆 Top 10 suppliers by amounts',
        '🔄 Pull down to refresh data',
      ],
    },
    {
      icon: 'business',
      title: 'Company Data',
      content: [
        '🏢 Enter company data in Profile → Company',
        '👥 Multiple users can share one company',
        '🔗 Join an existing company by EIK',
        '⚠️ Protection against duplicate invoices for the entire company',
      ],
    },
    {
      icon: 'cloud-upload',
      title: 'Backup',
      content: [
        '☁️ Profile → Google Drive backup',
        '📤 Create backup and save it to Google Drive',
        '📥 Restore data from backup file',
        '🔒 Data is stored securely locally',
      ],
    },
  ];
  
  return (
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
              <Ionicons name="receipt" size={48} color="#8B5CF6" />
              <Text style={styles.appTitle}>{t('help.appTitle')}</Text>
              <Text style={styles.appSubtitle}>{t('help.appSubtitle')}</Text>
              <Text style={styles.appVersion}>{t('help.version')} 1.0.0</Text>
            </View>

            {/* Help Sections */}
            {helpSections.map((section, index) => (
              <View key={index} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name={section.icon as any} size={24} color="#8B5CF6" />
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
              <Ionicons name="help-buoy" size={32} color="#10B981" />
              <Text style={styles.supportTitle}>{t('help.needHelp')}</Text>
              <Text style={styles.supportText}>
                {t('help.contactSupport')}
              </Text>
            </View>

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
    color: '#94A3B8',
    marginTop: 4,
  },
  appVersion: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 8,
  },
  section: {
    backgroundColor: '#1E293B',
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
    borderBottomColor: '#334155',
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
    color: '#CBD5E1',
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
    color: '#10B981',
    marginTop: 12,
  },
  supportText: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
});

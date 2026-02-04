// Localization system for the app
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type Language = 'bg' | 'en';

interface Translations {
  [key: string]: {
    bg: string;
    en: string;
  };
}

export const translations: Translations = {
  // Login Screen
  'login.title': {
    bg: 'Управление на фактури',
    en: 'Invoice Manager',
  },
  'login.subtitle': {
    bg: 'Влезте, за да продължите',
    en: 'Sign in to continue',
  },
  'login.google': {
    bg: 'Вход с Google',
    en: 'Sign in with Google',
  },
  'login.selectLanguage': {
    bg: 'Изберете език',
    en: 'Select language',
  },
  
  // Navigation
  'nav.home': {
    bg: 'Главна',
    en: 'Home',
  },
  'nav.scan': {
    bg: 'Сканирай',
    en: 'Scan',
  },
  'nav.invoices': {
    bg: 'Фактури',
    en: 'Invoices',
  },
  'nav.stats': {
    bg: 'Статистики',
    en: 'Statistics',
  },
  'nav.profile': {
    bg: 'Профил',
    en: 'Profile',
  },
  
  // Home Screen
  'home.welcome': {
    bg: 'Добре дошли!',
    en: 'Welcome!',
  },
  'home.currentMonth': {
    bg: 'Текущ месец',
    en: 'Current month',
  },
  'home.totalIncome': {
    bg: 'Общо приходи',
    en: 'Total Income',
  },
  'home.totalExpenses': {
    bg: 'Общо разходи',
    en: 'Total Expenses',
  },
  'home.vatToPay': {
    bg: 'ДДС за плащане',
    en: 'VAT to pay',
  },
  'home.profit': {
    bg: 'Печалба',
    en: 'Profit',
  },
  'home.dailyRevenue': {
    bg: 'Дневен оборот',
    en: 'Daily Revenue',
  },
  'home.expenses': {
    bg: 'В канала',
    en: 'Expenses',
  },
  'home.accumulatedFor': {
    bg: 'Натрупано за',
    en: 'Accumulated for',
  },
  'home.fiscal': {
    bg: 'Фискален',
    en: 'Fiscal',
  },
  'home.pocket': {
    bg: 'Джобче',
    en: 'Pocket',
  },
  'home.addFiscalRevenue': {
    bg: 'Добави фискализиран оборот',
    en: 'Add fiscal revenue',
  },
  'home.addToPocket': {
    bg: 'Добави към джобче',
    en: 'Add to pocket',
  },
  'home.willBeAdded': {
    bg: 'Ще се добави към съществуващото',
    en: 'Will be added to existing',
  },
  'home.includesVAT': {
    bg: 'Влиза в ДДС',
    en: 'Includes VAT',
  },
  'home.excludesVAT': {
    bg: 'НЕ влиза в ДДС',
    en: 'Excludes VAT',
  },
  'home.save': {
    bg: 'Запиши',
    en: 'Save',
  },
  'home.date': {
    bg: 'Дата',
    en: 'Date',
  },
  
  // Expenses
  'expenses.title': {
    bg: 'В канала (разходи)',
    en: 'Expenses (no invoice)',
  },
  'expenses.forDate': {
    bg: 'Разходи за',
    en: 'Expenses for',
  },
  'expenses.noExpenses': {
    bg: 'Няма записани разходи за тази дата',
    en: 'No expenses recorded for this date',
  },
  'expenses.totalForDay': {
    bg: 'Общо за деня',
    en: 'Total for day',
  },
  'expenses.addNew': {
    bg: 'Добави нов разход',
    en: 'Add new expense',
  },
  'expenses.description': {
    bg: 'Описание',
    en: 'Description',
  },
  'expenses.amount': {
    bg: 'Сума',
    en: 'Amount',
  },
  'expenses.add': {
    bg: 'Добави разход',
    en: 'Add expense',
  },
  'expenses.placeholder': {
    bg: 'Напр. гориво, материали...',
    en: 'E.g. fuel, materials...',
  },
  
  // Scan Screen
  'scan.title': {
    bg: 'Сканиране на фактура',
    en: 'Scan Invoice',
  },
  'scan.takePhoto': {
    bg: 'Заснемане',
    en: 'Take Photo',
  },
  'scan.fromGallery': {
    bg: 'От галерия',
    en: 'From Gallery',
  },
  'scan.processing': {
    bg: 'Обработка...',
    en: 'Processing...',
  },
  'scan.supplier': {
    bg: 'Доставчик',
    en: 'Supplier',
  },
  'scan.invoiceNumber': {
    bg: '№ Фактура',
    en: 'Invoice No.',
  },
  'scan.issueDate': {
    bg: 'Дата на издаване',
    en: 'Issue Date',
  },
  'scan.amountWithoutVAT': {
    bg: 'Сума без ДДС',
    en: 'Amount (excl. VAT)',
  },
  'scan.vatAmount': {
    bg: 'ДДС',
    en: 'VAT',
  },
  'scan.totalAmount': {
    bg: 'Обща сума',
    en: 'Total Amount',
  },
  'scan.notes': {
    bg: 'Бележки',
    en: 'Notes',
  },
  'scan.saveInvoice': {
    bg: 'Запази фактура',
    en: 'Save Invoice',
  },
  'scan.newScan': {
    bg: 'Ново сканиране',
    en: 'New Scan',
  },
  'scan.tapToFocus': {
    bg: 'Докоснете екрана за фокусиране',
    en: 'Tap screen to focus',
  },
  'scan.positionInvoice': {
    bg: 'Позиционирайте фактурата в рамката',
    en: 'Position invoice in frame',
  },
  
  // Invoices Screen
  'invoices.title': {
    bg: 'Фактури',
    en: 'Invoices',
  },
  'invoices.search': {
    bg: 'Търсене по доставчик...',
    en: 'Search by supplier...',
  },
  'invoices.export': {
    bg: 'Експорт',
    en: 'Export',
  },
  'invoices.noInvoices': {
    bg: 'Няма фактури',
    en: 'No invoices',
  },
  'invoices.delete': {
    bg: 'Изтриване',
    en: 'Delete',
  },
  'invoices.deleteConfirm': {
    bg: 'Сигурни ли сте, че искате да изтриете тази фактура?',
    en: 'Are you sure you want to delete this invoice?',
  },
  
  // Statistics Screen
  'stats.title': {
    bg: 'Статистики',
    en: 'Statistics',
  },
  'stats.subtitle': {
    bg: 'Анализ на приходи и разходи',
    en: 'Income & expense analysis',
  },
  'stats.overview': {
    bg: 'Общ преглед',
    en: 'Overview',
  },
  'stats.suppliers': {
    bg: 'Доставчици',
    en: 'Suppliers',
  },
  'stats.week': {
    bg: 'Седмица',
    en: 'Week',
  },
  'stats.month': {
    bg: 'Месец',
    en: 'Month',
  },
  'stats.year': {
    bg: 'Година',
    en: 'Year',
  },
  'stats.income': {
    bg: 'Приходи',
    en: 'Income',
  },
  'stats.vatBreakdown': {
    bg: 'ДДС Разбивка',
    en: 'VAT Breakdown',
  },
  'stats.vatFromSales': {
    bg: 'ДДС от продажби',
    en: 'VAT from sales',
  },
  'stats.vatCredit': {
    bg: 'ДДС за възстановяване',
    en: 'VAT credit',
  },
  'stats.currentMonthTotal': {
    bg: 'Общо за текущия месец',
    en: 'Total for current month',
  },
  'stats.totalAmount': {
    bg: 'Обща сума',
    en: 'Total Amount',
  },
  'stats.vat': {
    bg: 'ДДС',
    en: 'VAT',
  },
  'stats.supplierCount': {
    bg: 'Доставчици',
    en: 'Suppliers',
  },
  'stats.invoiceCount': {
    bg: 'Фактури',
    en: 'Invoices',
  },
  'stats.top10': {
    bg: 'Топ 10 Доставчици',
    en: 'Top 10 Suppliers',
  },
  'stats.avgInvoice': {
    bg: 'Ср.',
    en: 'Avg.',
  },
  'stats.noData': {
    bg: 'Няма данни',
    en: 'No data',
  },
  
  // Profile Screen
  'profile.title': {
    bg: 'Профил',
    en: 'Profile',
  },
  'profile.settings': {
    bg: 'Настройки',
    en: 'Settings',
  },
  'profile.company': {
    bg: 'Фирма',
    en: 'Company',
  },
  'profile.companyData': {
    bg: 'Данни на фирмата',
    en: 'Company data',
  },
  'profile.notifications': {
    bg: 'Известия',
    en: 'Notifications',
  },
  'profile.vatNotifications': {
    bg: 'ДДС напомняния',
    en: 'VAT reminders',
  },
  'profile.backup': {
    bg: 'Google Drive бекъп',
    en: 'Google Drive Backup',
  },
  'profile.backupRestore': {
    bg: 'Backup & Restore',
    en: 'Backup & Restore',
  },
  'profile.language': {
    bg: 'Език',
    en: 'Language',
  },
  'profile.info': {
    bg: 'Информация',
    en: 'Information',
  },
  'profile.help': {
    bg: 'Помощ',
    en: 'Help',
  },
  'profile.howToUse': {
    bg: 'Как да използвате приложението',
    en: 'How to use the app',
  },
  'profile.about': {
    bg: 'За приложението',
    en: 'About',
  },
  'profile.version': {
    bg: 'Версия',
    en: 'Version',
  },
  'profile.logout': {
    bg: 'Изход',
    en: 'Logout',
  },
  'profile.logoutConfirm': {
    bg: 'Сигурни ли сте, че искате да излезете?',
    en: 'Are you sure you want to log out?',
  },
  
  // Common
  'common.cancel': {
    bg: 'Отказ',
    en: 'Cancel',
  },
  'common.confirm': {
    bg: 'Потвърди',
    en: 'Confirm',
  },
  'common.save': {
    bg: 'Запази',
    en: 'Save',
  },
  'common.delete': {
    bg: 'Изтрий',
    en: 'Delete',
  },
  'common.close': {
    bg: 'Затвори',
    en: 'Close',
  },
  'common.success': {
    bg: 'Успех',
    en: 'Success',
  },
  'common.error': {
    bg: 'Грешка',
    en: 'Error',
  },
  'common.loading': {
    bg: 'Зареждане...',
    en: 'Loading...',
  },
  'common.select': {
    bg: 'Избери',
    en: 'Select',
  },
  
  // Messages
  'msg.invoiceSaved': {
    bg: 'Фактурата е записана',
    en: 'Invoice saved',
  },
  'msg.expenseSaved': {
    bg: 'Разходът е записан',
    en: 'Expense saved',
  },
  'msg.revenueSaved': {
    bg: 'Оборотът е записан',
    en: 'Revenue saved',
  },
  'msg.fillRequired': {
    bg: 'Попълнете задължителните полета',
    en: 'Fill in required fields',
  },
  'msg.duplicateInvoice': {
    bg: 'Тази фактура вече съществува',
    en: 'This invoice already exists',
  },
};

// Zustand store for language
interface LanguageState {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  loadLanguage: () => Promise<void>;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  language: 'bg',
  
  setLanguage: async (lang: Language) => {
    await AsyncStorage.setItem('app_language', lang);
    set({ language: lang });
  },
  
  loadLanguage: async () => {
    try {
      const savedLang = await AsyncStorage.getItem('app_language');
      if (savedLang === 'bg' || savedLang === 'en') {
        set({ language: savedLang });
      }
    } catch (error) {
      console.error('Error loading language:', error);
    }
  },
}));

// Translation hook
export function useTranslation() {
  const { language } = useLanguageStore();
  
  const t = (key: string): string => {
    const translation = translations[key];
    if (!translation) {
      console.warn(`Missing translation for key: ${key}`);
      return key;
    }
    return translation[language] || translation['bg'] || key;
  };
  
  return { t, language };
}

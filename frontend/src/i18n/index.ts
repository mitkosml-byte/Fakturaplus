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
  'msg.deleteConfirmExpense': {
    bg: 'Сигурни ли сте, че искате да изтриете този разход?',
    en: 'Are you sure you want to delete this expense?',
  },
  'msg.enterAtLeastOne': {
    bg: 'Въведете поне една стойност',
    en: 'Enter at least one value',
  },
  'msg.fillAllFields': {
    bg: 'Попълнете всички полета',
    en: 'Fill in all fields',
  },
  
  // Invoice details
  'invoices.invoiceNo': {
    bg: '№ Фактура',
    en: 'Invoice No.',
  },
  'invoices.withoutVAT': {
    bg: 'Без ДДС',
    en: 'Without VAT',
  },
  'invoices.total': {
    bg: 'Общо',
    en: 'Total',
  },
  'invoices.count': {
    bg: 'Брой',
    en: 'Count',
  },
  'invoices.exportTitle': {
    bg: 'Експорт на фактури',
    en: 'Export Invoices',
  },
  'invoices.excelTitle': {
    bg: 'Excel (.xlsx)',
    en: 'Excel (.xlsx)',
  },
  'invoices.excelHint': {
    bg: 'За редактиране и анализ',
    en: 'For editing and analysis',
  },
  'invoices.pdfHint': {
    bg: 'За печат и архив',
    en: 'For printing and archive',
  },
  'invoices.details': {
    bg: 'Детайли',
    en: 'Details',
  },
  'invoices.supplier': {
    bg: 'Доставчик',
    en: 'Supplier',
  },
  'invoices.dateLabel': {
    bg: 'Дата',
    en: 'Date',
  },
  'invoices.vatPercent': {
    bg: 'ДДС (20%)',
    en: 'VAT (20%)',
  },
  'invoices.totalAmount': {
    bg: 'Обща сума',
    en: 'Total Amount',
  },
  'invoices.notes': {
    bg: 'Бележки',
    en: 'Notes',
  },
  'invoices.deleteInvoice': {
    bg: 'Изтрий фактурата',
    en: 'Delete Invoice',
  },
  'invoices.scanFirst': {
    bg: 'Сканирайте първата си фактура',
    en: 'Scan your first invoice',
  },
  'invoices.searchPlaceholder': {
    bg: 'Търси по доставчик...',
    en: 'Search by supplier...',
  },
  'invoices.downloadError': {
    bg: 'Не можах да изтегля файла',
    en: 'Could not download file',
  },
  
  // Company Settings
  'company.title': {
    bg: 'Настройки на фирма',
    en: 'Company Settings',
  },
  'company.infoText': {
    bg: 'Фирмените данни се споделят между всички потребители в една фирма. Дублиращите се фактури се проверяват за цялата фирма.',
    en: 'Company data is shared between all users in a company. Duplicate invoices are checked company-wide.',
  },
  'company.joinExisting': {
    bg: 'Присъединяване към съществуваща фирма',
    en: 'Join existing company',
  },
  'company.joinHint': {
    bg: 'Въведете ЕИК на фирмата, към която искате да се присъедините',
    en: 'Enter the EIK of the company you want to join',
  },
  'company.enterEik': {
    bg: 'Въведете ЕИК',
    en: 'Enter EIK',
  },
  'company.join': {
    bg: 'Присъедини се',
    en: 'Join',
  },
  'company.editCompany': {
    bg: 'Редактиране на фирма',
    en: 'Edit Company',
  },
  'company.createNew': {
    bg: 'Създаване на нова фирма',
    en: 'Create New Company',
  },
  'company.name': {
    bg: 'Име на фирмата',
    en: 'Company Name',
  },
  'company.eik': {
    bg: 'ЕИК/Булстат',
    en: 'EIK/Bulstat',
  },
  'company.eikCantChange': {
    bg: 'ЕИК не може да се променя',
    en: 'EIK cannot be changed',
  },
  'company.vatNumber': {
    bg: 'ДДС номер',
    en: 'VAT Number',
  },
  'company.mol': {
    bg: 'МОЛ',
    en: 'Manager',
  },
  'company.address': {
    bg: 'Адрес',
    en: 'Address',
  },
  'company.city': {
    bg: 'Град',
    en: 'City',
  },
  'company.phone': {
    bg: 'Телефон',
    en: 'Phone',
  },
  'company.email': {
    bg: 'Имейл',
    en: 'Email',
  },
  'company.bankDetails': {
    bg: 'Банкови данни',
    en: 'Bank Details',
  },
  'company.bankName': {
    bg: 'Банка',
    en: 'Bank',
  },
  'company.iban': {
    bg: 'IBAN',
    en: 'IBAN',
  },
  'company.enterNameError': {
    bg: 'Въведете име на фирмата',
    en: 'Enter company name',
  },
  'company.enterEikError': {
    bg: 'Въведете ЕИК на фирмата',
    en: 'Enter company EIK',
  },
  'company.saved': {
    bg: 'Данните на фирмата са запазени',
    en: 'Company data saved',
  },
  
  // Backup Screen
  'backup.title': {
    bg: 'Backup & Restore',
    en: 'Backup & Restore',
  },
  'backup.infoTitle': {
    bg: 'Google Drive Backup',
    en: 'Google Drive Backup',
  },
  'backup.infoDescription': {
    bg: 'Създайте backup на вашите данни и го запазете в Google Drive или друго облачно хранилище.',
    en: 'Create a backup of your data and save it to Google Drive or other cloud storage.',
  },
  'backup.status': {
    bg: 'Статус на backup',
    en: 'Backup Status',
  },
  'backup.lastBackup': {
    bg: 'Последен backup',
    en: 'Last backup',
  },
  'backup.unknown': {
    bg: 'Неизвестно',
    en: 'Unknown',
  },
  'backup.invoices': {
    bg: 'Фактури',
    en: 'Invoices',
  },
  'backup.revenues': {
    bg: 'Обороти',
    en: 'Revenues',
  },
  'backup.expenses': {
    bg: 'Разходи',
    en: 'Expenses',
  },
  'backup.noBackup': {
    bg: 'Няма създаден backup',
    en: 'No backup created',
  },
  'backup.create': {
    bg: 'Създай Backup',
    en: 'Create Backup',
  },
  'backup.restore': {
    bg: 'Възстанови от файл',
    en: 'Restore from file',
  },
  'backup.howToUse': {
    bg: 'Как да използвате',
    en: 'How to use',
  },
  'backup.step1': {
    bg: 'Натиснете "Създай Backup" за да експортирате данните',
    en: 'Press "Create Backup" to export your data',
  },
  'backup.step2': {
    bg: 'Изберете "Запази в Google Drive" от менюто за споделяне',
    en: 'Select "Save to Google Drive" from the sharing menu',
  },
  'backup.step3': {
    bg: 'За възстановяване - изберете файла от Google Drive',
    en: 'To restore - select the file from Google Drive',
  },
  'backup.successTitle': {
    bg: 'Успех!',
    en: 'Success!',
  },
  'backup.backupCreated': {
    bg: 'Backup файлът е създаден.',
    en: 'Backup file created.',
  },
  'backup.statistics': {
    bg: 'Статистика',
    en: 'Statistics',
  },
  'backup.saveFile': {
    bg: 'Запазете файла в Google Drive или друго място за съхранение.',
    en: 'Save the file to Google Drive or other storage.',
  },
  'backup.sharingNotAvailable': {
    bg: 'Файлът е създаден, но споделянето не е достъпно на това устройство.',
    en: 'File created, but sharing is not available on this device.',
  },
  'backup.file': {
    bg: 'Файл',
    en: 'File',
  },
  'backup.createError': {
    bg: 'Неуспешно създаване на backup',
    en: 'Failed to create backup',
  },
  'backup.confirmation': {
    bg: 'Потвърждение',
    en: 'Confirmation',
  },
  'backup.restoreQuestion': {
    bg: 'Искате ли да възстановите данните от:',
    en: 'Do you want to restore data from:',
  },
  'backup.restoreWarning': {
    bg: 'Съществуващи данни няма да бъдат изтрити, само ще се добавят нови.',
    en: 'Existing data will not be deleted, only new data will be added.',
  },
  'backup.restoreButton': {
    bg: 'Възстанови',
    en: 'Restore',
  },
  'backup.restored': {
    bg: 'Данните са възстановени успешно!',
    en: 'Data restored successfully!',
  },
  'backup.restoredRecords': {
    bg: 'Възстановени записи',
    en: 'Restored records',
  },
  'backup.restoreError': {
    bg: 'Неуспешно възстановяване',
    en: 'Failed to restore',
  },
  'backup.fileSelectError': {
    bg: 'Неуспешен избор на файл',
    en: 'Failed to select file',
  },
  
  // Help Screen
  'help.title': {
    bg: 'Помощ / Help',
    en: 'Help',
  },
  'help.appTitle': {
    bg: 'Invoice Manager',
    en: 'Invoice Manager',
  },
  'help.appSubtitle': {
    bg: 'Управление на фактури и финанси',
    en: 'Invoice and Finance Management',
  },
  'help.version': {
    bg: 'Версия',
    en: 'Version',
  },
  'help.about': {
    bg: 'За приложението',
    en: 'About the App',
  },
  'help.aboutText1': {
    bg: 'Това приложение е създадено за управление на входящи фактури и финансова отчетност за малки и средни бизнеси в България.',
    en: 'This app is designed for managing incoming invoices and financial reporting for small and medium businesses in Bulgaria.',
  },
  'help.aboutText2': {
    bg: 'Помага за проследяване на приходи, разходи и автоматично изчисляване на ДДС.',
    en: 'It helps track income, expenses and automatically calculates VAT.',
  },
  'help.scanTitle': {
    bg: 'Сканиране на фактури (OCR)',
    en: 'Invoice Scanning (OCR)',
  },
  'help.dailyRevenueTitle': {
    bg: 'Дневен оборот',
    en: 'Daily Revenue',
  },
  'help.expensesTitle': {
    bg: 'В канала (разходи без фактура)',
    en: 'Expenses (no invoice)',
  },
  'help.vatTitle': {
    bg: 'ДДС изчисление',
    en: 'VAT Calculation',
  },
  'help.statsTitle': {
    bg: 'Статистики',
    en: 'Statistics',
  },
  'help.companyTitle': {
    bg: 'Фирмени данни',
    en: 'Company Data',
  },
  'help.backupTitle': {
    bg: 'Backup',
    en: 'Backup',
  },
  'help.needHelp': {
    bg: 'Нужда от помощ?',
    en: 'Need help?',
  },
  'help.contactSupport': {
    bg: 'При въпроси или проблеми, моля свържете се с вашия счетоводител или системен администратор.',
    en: 'For questions or issues, please contact your accountant or system administrator.',
  },
  
  // Roles
  'role.accountant': {
    bg: 'Счетоводител',
    en: 'Accountant',
  },
  'role.user': {
    bg: 'Потребител',
    en: 'User',
  },
  
  // Home Screen additional
  'home.invoices': {
    bg: 'Фактури',
    en: 'Invoices',
  },
  'home.fiscalRevenue': {
    bg: 'Фискален оборот',
    en: 'Fiscal Revenue',
  },
  
  // Stats Screen additional
  'stats.totalIncome': {
    bg: 'Общ приход',
    en: 'Total Income',
  },
  'stats.totalExpense': {
    bg: 'Общ разход',
    en: 'Total Expense',
  },
  'stats.vatToPay': {
    bg: 'ДДС за плащане',
    en: 'VAT to Pay',
  },
  'stats.profitLabel': {
    bg: 'Печалба',
    en: 'Profit',
  },
  'stats.expensesNoInvoice': {
    bg: 'Разходи "в канала"',
    en: 'Expenses (no invoice)',
  },
  'stats.additionalInfo': {
    bg: 'Допълнителна информация',
    en: 'Additional Information',
  },
  'stats.loadingData': {
    bg: 'Зареждане на данни...',
    en: 'Loading data...',
  },
  'stats.noSupplierData': {
    bg: 'Няма данни за доставчици',
    en: 'No supplier data',
  },
  
  // Advanced Supplier Statistics
  'stats.executiveSummary': {
    bg: 'Изпълнително резюме',
    en: 'Executive Summary',
  },
  'stats.totalSuppliers': {
    bg: 'Общо доставчици',
    en: 'Total Suppliers',
  },
  'stats.activeSuppliers': {
    bg: 'Активни',
    en: 'Active',
  },
  'stats.inactiveSuppliers': {
    bg: 'Неактивни',
    en: 'Inactive',
  },
  'stats.top3Concentration': {
    bg: 'Топ 3 концентрация',
    en: 'Top 3 Concentration',
  },
  'stats.highDependencyAlert': {
    bg: 'доставчици с висока зависимост (>30%)',
    en: 'suppliers with high dependency (>30%)',
  },
  'stats.byAmount': {
    bg: 'По сума',
    en: 'By Amount',
  },
  'stats.byFrequency': {
    bg: 'По честота',
    en: 'By Frequency',
  },
  'stats.byAvg': {
    bg: 'Ср. фактура',
    en: 'Avg Invoice',
  },
  'stats.topByAmount': {
    bg: 'Топ 10 по обем',
    en: 'Top 10 by Volume',
  },
  'stats.topByFrequency': {
    bg: 'Топ 10 по честота',
    en: 'Top 10 by Frequency',
  },
  'stats.topByAvg': {
    bg: 'Топ 10 по средна стойност',
    en: 'Top 10 by Average',
  },
  'stats.invoices': {
    bg: 'фактури',
    en: 'invoices',
  },
  'stats.avgShort': {
    bg: 'Ср.',
    en: 'Avg',
  },
  'stats.highDependency': {
    bg: 'Висока зависимост',
    en: 'High Dependency',
  },
  'stats.highDependencyDesc': {
    bg: 'Тези доставчици представляват повече от 30% от покупките ви. Помислете за диверсификация.',
    en: 'These suppliers represent more than 30% of your purchases. Consider diversification.',
  },
  'stats.supplierOverview': {
    bg: 'Преглед на доставчика',
    en: 'Supplier Overview',
  },
  'stats.firstDelivery': {
    bg: 'Първа доставка',
    en: 'First Delivery',
  },
  'stats.lastDelivery': {
    bg: 'Последна доставка',
    en: 'Last Delivery',
  },
  'stats.activeSupplier': {
    bg: 'Активен доставчик',
    en: 'Active Supplier',
  },
  'stats.inactiveSupplier': {
    bg: 'Неактивен',
    en: 'Inactive',
  },
  'stats.days': {
    bg: 'дни',
    en: 'days',
  },
  'stats.monthlyTrend': {
    bg: 'Месечна тенденция',
    en: 'Monthly Trend',
  },
  'stats.anomalies': {
    bg: 'Аномалии (необичайни суми)',
    en: 'Anomalies (unusual amounts)',
  },
  'stats.recentInvoices': {
    bg: 'Последни фактури',
    en: 'Recent Invoices',
  },
  
  // Items & Price Tracking
  'stats.items': {
    bg: 'Артикули',
    en: 'Items',
  },
  'stats.itemsTitle': {
    bg: 'Статистика на артикулите',
    en: 'Item Statistics',
  },
  'stats.priceAlerts': {
    bg: 'Ценови аларми',
    en: 'Price Alerts',
  },
  'stats.priceChange': {
    bg: 'Промяна в цена',
    en: 'Price Change',
  },
  'stats.oldPrice': {
    bg: 'Стара цена',
    en: 'Old Price',
  },
  'stats.newPrice': {
    bg: 'Нова цена',
    en: 'New Price',
  },
  'stats.priceIncrease': {
    bg: 'Повишение на цената',
    en: 'Price Increase',
  },
  'stats.topByQuantity': {
    bg: 'Топ по количество',
    en: 'Top by Quantity',
  },
  'stats.topByValue': {
    bg: 'Топ по стойност',
    en: 'Top by Value',
  },
  'stats.priceTrends': {
    bg: 'Ценови тенденции',
    en: 'Price Trends',
  },
  'stats.avgPrice': {
    bg: 'Средна цена',
    en: 'Avg Price',
  },
  'stats.minPrice': {
    bg: 'Мин. цена',
    en: 'Min Price',
  },
  'stats.maxPrice': {
    bg: 'Макс. цена',
    en: 'Max Price',
  },
  'stats.priceVariance': {
    bg: 'Вариация',
    en: 'Variance',
  },
  'stats.supplierCompare': {
    bg: 'Сравнение по доставчици',
    en: 'Supplier Comparison',
  },
  'stats.bestSupplier': {
    bg: 'Най-изгоден доставчик',
    en: 'Best Supplier',
  },
  'stats.potentialSavings': {
    bg: 'Потенциални спестявания',
    en: 'Potential Savings',
  },
  'stats.totalItems': {
    bg: 'Общо артикули',
    en: 'Total Items',
  },
  'stats.uniqueItems': {
    bg: 'Уникални артикули',
    en: 'Unique Items',
  },
  'stats.totalValue': {
    bg: 'Обща стойност',
    en: 'Total Value',
  },
  'stats.alertThreshold': {
    bg: 'Праг за аларма',
    en: 'Alert Threshold',
  },
  'stats.alertsEnabled': {
    bg: 'Аларми активни',
    en: 'Alerts Enabled',
  },
  'stats.noAlerts': {
    bg: 'Няма ценови аларми',
    en: 'No price alerts',
  },
  'stats.noItems': {
    bg: 'Няма артикули',
    en: 'No items',
  },
  'stats.markAsRead': {
    bg: 'Маркирай като прочетена',
    en: 'Mark as read',
  },
  'stats.dismiss': {
    bg: 'Отхвърли',
    en: 'Dismiss',
  },
  'stats.priceHistory': {
    bg: 'История на цените',
    en: 'Price History',
  },
  'stats.quantity': {
    bg: 'Количество',
    en: 'Quantity',
  },
  'stats.unit': {
    bg: 'Единица',
    en: 'Unit',
  },
  
  // Scan screen items
  'scan.addItem': {
    bg: 'Добави артикул',
    en: 'Add Item',
  },
  'scan.itemName': {
    bg: 'Наименование',
    en: 'Item Name',
  },
  'scan.quantity': {
    bg: 'Количество',
    en: 'Quantity',
  },
  'scan.unit': {
    bg: 'Мерна единица',
    en: 'Unit',
  },
  'scan.unitPrice': {
    bg: 'Единична цена',
    en: 'Unit Price',
  },
  'scan.items': {
    bg: 'Артикули',
    en: 'Items',
  },
  'scan.noItems': {
    bg: 'Няма добавени артикули',
    en: 'No items added',
  },
  'scan.priceAlert': {
    bg: 'Внимание: Повишение на цена!',
    en: 'Warning: Price Increase!',
  },
  
  // Units
  'units.pieces': {
    bg: 'ед.',
    en: 'pcs',
  },
  'units.kg': {
    bg: 'кг',
    en: 'kg',
  },
  'units.liters': {
    bg: 'л',
    en: 'L',
  },
  'units.meters': {
    bg: 'м',
    en: 'm',
  },
  
  // Supplier stats lowercase
  'stats.suppliersLower': {
    bg: 'доставчици',
    en: 'suppliers',
  },
  'stats.times': {
    bg: 'пъти',
    en: 'times',
  },
  'stats.noValue': {
    bg: 'няма',
    en: 'none',
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

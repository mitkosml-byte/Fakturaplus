// Localization system for the app
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { bg as dateFnsBg, enUS as dateFnsEnUS } from 'date-fns/locale';

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
  'home.importRevenueHistory': {
    bg: 'Импортирай оборот назад във времето',
    en: 'Import past revenue history',
  },
  'home.importExpensesHistory': {
    bg: 'Импортирай разходи назад във времето',
    en: 'Import past expenses history',
  },
  'home.ocrAdditionNote': {
    bg: 'Добавени {amount} € от сканирана издадена фактура към сумата за деня.',
    en: 'Added {amount} € from a scanned issued invoice to the day\'s total.',
  },
  'home.restrictedDataNote': {
    bg: 'Част от данните са скрити за вашия достъп - показаните суми са изчислени без тях.',
    en: 'Some data is hidden for your access level - the figures shown are calculated without it.',
  },
  'home.dailyRevenue': {
    bg: 'Дневен оборот',
    en: 'Daily Revenue',
  },
  'home.avgDailyTurnover': {
    bg: 'Среден оборот на ден',
    en: 'Average Daily Turnover',
  },
  'home.avgDailyTurnoverSubtitle': {
    bg: 'този месец, за {days} дни · виж по периоди',
    en: 'this month, over {days} days · view by period',
  },
  'home.expenses': {
    bg: 'В канала',
    en: 'Expenses',
  },
  'home.fiscal': {
    bg: 'Фискален',
    en: 'Fiscal',
  },
  'home.pocket': {
    bg: 'Джобче',
    en: 'Pocket',
  },
  'home.fiscalRevenueLabel': {
    bg: 'Фискализиран оборот',
    en: 'Fiscal revenue',
  },
  'home.pocketLabel': {
    bg: 'Джобче',
    en: 'Pocket',
  },
  'home.cardRevenueLabel': {
    bg: 'От тях – платено с карта',
    en: 'Of which - paid by card',
  },
  'home.cardRevenueHint': {
    bg: 'Остатъкът от фискализирания оборот се приема за в брой',
    en: 'The rest of the fiscal revenue is treated as cash',
  },
  'home.cashRevenue': {
    bg: 'Оборот в брой',
    en: 'Cash Turnover',
  },
  'home.cardRevenue': {
    bg: 'Оборот с карта',
    en: 'Card Turnover',
  },
  'home.unpaidInvoices': {
    bg: 'Неплатени фактури',
    en: 'Unpaid Invoices',
  },
  'home.unpaidInvoicesCount': {
    bg: 'неплатени',
    en: 'unpaid',
  },
  'home.overdueInvoicesCount': {
    bg: 'просрочени',
    en: 'overdue',
  },
  'home.editInPlaceNotice': {
    bg: 'Полетата по-долу показват вече записаното за тази дата. Промяна на стойност я замества с новата — не се добавя към старата.',
    en: "These fields show what's already logged for this date. Changing a value replaces it — it doesn't add to the old one.",
  },
  'home.includesVAT': {
    bg: 'Влиза в ДДС',
    en: 'Includes VAT',
  },
  'home.excludesVAT': {
    bg: 'НЕ влиза в ДДС',
    en: 'Excludes VAT',
  },
  'home.vatRate': {
    bg: 'ДДС ставка на оборота',
    en: 'VAT rate on this revenue',
  },
  'home.vatRateHint': {
    bg: 'Изберете 9% за намалена ставка (хотели, ресторанти...) или 0% за нулева/освободена. По подразбиране 20%.',
    en: 'Choose 9% for the reduced rate (hotels, restaurants...) or 0% for zero-rate/exempt. Defaults to 20%.',
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
  'scan.modePurchase': {
    bg: 'Фактура от доставчик',
    en: 'Invoice from a supplier',
  },
  'scan.modeSales': {
    bg: 'Издадена фактура (продажба)',
    en: 'Issued invoice (sale)',
  },
  'scan.salesFormTitle': {
    bg: 'Обобщение на продажбата',
    en: 'Sale summary',
  },
  'scan.salesFormHint': {
    bg: 'Проверете сумата и датата преди да добавите към оборота',
    en: 'Check the amount and date before adding to revenue',
  },
  'scan.salesNote': {
    bg: 'Това е фактура, издадена от вас към клиент - няма да се запази като отделна фактура, а сумата ще се добави към дневния оборот за тази дата.',
    en: "This is an invoice you issued to a customer - it won't be saved as a separate invoice; the amount will be added to that date's daily revenue instead.",
  },
  'scan.addToRevenue': {
    bg: 'Добави към дневния оборот',
    en: 'Add to daily revenue',
  },
  'scan.salesTipsTitle': {
    bg: 'Какво прави сканирането тук',
    en: 'What scanning does here',
  },
  'scan.salesTip1': {
    bg: 'Разпознава общата сума и ДДС ставката от издадената фактура',
    en: 'Recognizes the total amount and VAT rate from the issued invoice',
  },
  'scan.salesTip2': {
    bg: 'Отваря дневния оборот за тази дата, за да прегледате и добавите сумата',
    en: "Opens that date's daily revenue so you can review and add the amount",
  },
  'scan.salesTipsFooter': {
    bg: 'Само за фактури, издадени от вас към клиенти - не се запазва отделен документ.',
    en: "For invoices you issue to customers only - no separate document is kept.",
  },
  'scan.tipsTitle': {
    bg: 'Какво разпознава сканирането',
    en: 'What the scan recognizes',
  },
  'scan.tipSupplier': {
    bg: 'Доставчик, ЕИК и номер на фактурата',
    en: 'Supplier, VAT ID and invoice number',
  },
  'scan.tipAmounts': {
    bg: 'Обща сума, ДДС и данъчно третиране (стандартна ставка, намалена, обратно начисляване...)',
    en: 'Total amount, VAT and tax treatment (standard rate, reduced, reverse charge...)',
  },
  'scan.tipItems': {
    bg: 'Отделните артикули - и те се сверяват автоматично с предходна цена от същия доставчик',
    en: 'Individual line items - automatically checked against the last price from the same supplier',
  },
  'scan.tipPayment': {
    bg: 'Начин на плащане и срок, ако е отпечатан на фактурата',
    en: 'Payment method and due date, if printed on the invoice',
  },
  'scan.tipsFooter': {
    bg: 'Само за фактури от доставчици - работи най-добре със снимка на цяла, ясно осветена фактура.',
    en: 'For supplier invoices only - works best with a full, well-lit photo of the invoice.',
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
  'scan.supplierEik': {
    bg: 'ЕИК/Булстат на доставчика',
    en: "Supplier's EIK/Bulstat",
  },
  'scan.eikInvalidFormat': {
    bg: 'Невалиден формат (9 или 13 цифри)',
    en: 'Invalid format (9 or 13 digits)',
  },
  'scan.eikInvalidChecksum': {
    bg: 'Контролната цифра не съвпада - проверете номера',
    en: "Check digit doesn't match - please verify the number",
  },
  'scan.eikValid': {
    bg: 'Коректен ЕИК',
    en: 'Valid EIK',
  },
  'scan.vatTreatment': {
    bg: 'ДДС третиране',
    en: 'VAT treatment',
  },
  'scan.reverseChargeNote': {
    bg: 'При запис ще се генерира автоматично номер на протокол по чл.117 ЗДДС, който трябва да се издаде до 15 дни от датата на доставката.',
    en: 'Saving will auto-assign a чл.117 self-billing protocol number, due within 15 days of the supply date.',
  },
  'scan.protocolAssigned': {
    bg: 'Издаден протокол по чл.117 №',
    en: 'Issued чл.117 protocol №',
  },
  'scan.paymentMethod': {
    bg: 'Начин на плащане',
    en: 'Payment method',
  },
  'scan.paymentMethod.cash': {
    bg: 'В брой',
    en: 'Cash',
  },
  'scan.paymentMethod.bank_transfer': {
    bg: 'Банков превод',
    en: 'Bank transfer',
  },
  'scan.cashAutoPaidNote': {
    bg: 'Плащанията в брой се маркират автоматично като платени.',
    en: 'Cash payments are automatically marked as paid.',
  },
  'scan.paymentDueDateDefault': {
    bg: 'Срок за плащане (по подразбиране 14 дни)',
    en: 'Payment due date (defaults to 14 days)',
  },
  'invoices.protocolDeadline': {
    bg: 'Краен срок за протокола',
    en: 'Protocol deadline',
  },
  'invoices.protocolOverdue': {
    bg: 'просрочен',
    en: 'overdue',
  },
  'profile.protocols': {
    bg: 'Протоколи по чл.117',
    en: 'чл.117 protocols',
  },
  'profile.protocolsDesc': {
    bg: 'Самоначислен ДДС и срокове за подаване',
    en: 'Self-charged VAT and filing deadlines',
  },
  'protocols.title': {
    bg: 'Протоколи по чл.117',
    en: 'чл.117 protocols',
  },
  'protocols.overdueSingular': {
    bg: 'протокол е просрочен',
    en: 'protocol is overdue',
  },
  'protocols.overduePlural': {
    bg: 'протокола са просрочени',
    en: 'protocols are overdue',
  },
  'protocols.empty': {
    bg: 'Няма протоколи по чл.117',
    en: 'No чл.117 protocols',
  },
  'protocols.emptyHint': {
    bg: 'Появяват се тук, когато маркирате фактура с ДДС третиране "Обратно начисляване"',
    en: 'Appear here when you mark an invoice with VAT treatment "Reverse charge"',
  },
  'vat.standard_20': {
    bg: 'Стандартна 20%',
    en: 'Standard 20%',
  },
  'vat.reduced_9': {
    bg: 'Намалена 9%',
    en: 'Reduced 9%',
  },
  'vat.zero_rate': {
    bg: 'Нулева ставка',
    en: 'Zero rate',
  },
  'vat.exempt': {
    bg: 'Освободена доставка',
    en: 'Exempt supply',
  },
  'vat.reverse_charge': {
    bg: 'Обратно начисляване',
    en: 'Reverse charge',
  },
  'vat.outside_scope': {
    bg: 'Извън обхвата на ЗДДС',
    en: 'Outside VAT scope',
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
  'stats.chartNavPrev': {
    bg: 'Предишни 7 дни',
    en: 'Previous 7 days',
  },
  'stats.chartNavNext': {
    bg: 'Следващи 7 дни',
    en: 'Next 7 days',
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
  'msg.downloadFailed': {
    bg: 'Не можах да изтегля файла',
    en: 'Could not download the file',
  },
  'import.button': {
    bg: 'Импортирай от Excel',
    en: 'Import from Excel',
  },
  'import.downloadTemplate': {
    bg: 'Изтегли шаблон',
    en: 'Download template',
  },
  'import.downloadTemplateHint': {
    bg: 'Шаблонът съдържа заглавен ред, пример и кратки указания - попълнете го и го качете обратно.',
    en: 'The template has a header row, an example row and short instructions - fill it in and upload it back.',
  },
  'import.pickFile': {
    bg: 'Избери файл (.xlsx / .csv)',
    en: 'Choose file (.xlsx / .csv)',
  },
  'import.analyzing': {
    bg: 'Анализирам файла...',
    en: 'Analyzing the file...',
  },
  'import.totalRows': {
    bg: 'Общо редове',
    en: 'Total rows',
  },
  'import.validRows': {
    bg: 'Валидни',
    en: 'Valid',
  },
  'import.errorRows': {
    bg: 'С грешки',
    en: 'With errors',
  },
  'import.row': {
    bg: 'Ред',
    en: 'Row',
  },
  'import.importRows': {
    bg: 'Импортирай {count} реда',
    en: 'Import {count} rows',
  },
  'import.noValidRows': {
    bg: 'Няма валидни редове за импортиране - поправете файла и опитайте отново.',
    en: 'No valid rows to import - fix the file and try again.',
  },
  'import.pickDifferentFile': {
    bg: 'Избери друг файл',
    en: 'Choose a different file',
  },
  'import.importing': {
    bg: 'Импортирам...',
    en: 'Importing...',
  },
  'import.doneSummary': {
    bg: 'Успешно импортирани {imported} реда.',
    en: 'Successfully imported {imported} rows.',
  },
  'import.doneFailedSummary': {
    bg: '{failed} реда не бяха импортирани (напр. вече съществуват) - виж детайлите по-горе.',
    en: '{failed} rows were not imported (e.g. already exist) - see details above.',
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
  'invoices.items': {
    bg: 'Артикули',
    en: 'Items',
  },
  'invoices.itemName': {
    bg: 'Артикул',
    en: 'Item',
  },
  'invoices.itemQty': {
    bg: 'Кол-во',
    en: 'Qty',
  },
  'invoices.itemUnitPrice': {
    bg: 'Ед. цена',
    en: 'Unit price',
  },
  'invoices.itemTotal': {
    bg: 'Общо',
    en: 'Total',
  },
  'invoices.itemsSum': {
    bg: 'Сбор на артикулите',
    en: 'Items sum',
  },
  'invoices.itemsMismatch': {
    bg: 'Сборът на артикулите се различава от стойността без ДДС на фактурата - възможна грешка при въвеждането.',
    en: "The items' sum differs from the invoice's amount without VAT - possible entry error.",
  },
  'invoices.vsLastPurchase': {
    bg: 'спрямо предишна доставка',
    en: 'vs. last purchase',
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
    bg: 'Търси по доставчик или номер...',
    en: 'Search by supplier or number...',
  },
  'invoices.paymentFilterAll': {
    bg: 'Всички',
    en: 'All',
  },
  'invoices.paymentFilterUnpaid': {
    bg: 'Неплатени',
    en: 'Unpaid',
  },
  'invoices.paymentFilterOverdue': {
    bg: 'Просрочени',
    en: 'Overdue',
  },
  'invoices.paymentFilterPaid': {
    bg: 'Платени',
    en: 'Paid',
  },
  'invoices.unpaid': {
    bg: 'Неплатена',
    en: 'Unpaid',
  },
  'invoices.overdue': {
    bg: 'Просрочена',
    en: 'Overdue',
  },
  'invoices.paymentSection': {
    bg: 'Плащане',
    en: 'Payment',
  },
  'invoices.paymentMethodCash': {
    bg: 'В брой',
    en: 'Cash',
  },
  'invoices.paymentMethodBankTransfer': {
    bg: 'Банков превод',
    en: 'Bank transfer',
  },
  'invoices.paymentDueDate': {
    bg: 'Срок за плащане',
    en: 'Payment due date',
  },
  'invoices.markAsPaid': {
    bg: 'Маркирай като платена',
    en: 'Mark as paid',
  },
  'invoices.paidOn': {
    bg: 'Платена на',
    en: 'Paid on',
  },
  'invoices.overdueSince': {
    bg: 'Просрочена от',
    en: 'Overdue since',
  },
  'invoices.partiallyPaid': {
    bg: 'Частично платена',
    en: 'Partially paid',
  },
  'invoices.paidOfTotal': {
    bg: 'Платено {paid} от {total} €',
    en: 'Paid {paid} of {total} €',
  },
  'invoices.remainingAmount': {
    bg: 'Остатък',
    en: 'Remaining',
  },
  'invoices.recordPayment': {
    bg: 'Регистрирай плащане',
    en: 'Record payment',
  },
  'invoices.editPayment': {
    bg: 'Промени плащането',
    en: 'Edit payment',
  },
  'invoices.markFullyPaid': {
    bg: 'Маркирай като напълно платена',
    en: 'Mark as fully paid',
  },
  'invoices.paidAmountLabel': {
    bg: 'Платена сума до момента (€)',
    en: 'Amount paid so far (€)',
  },
  'invoices.paidAmountEditNotice': {
    bg: 'Полето показва вече платената сума до момента. Промяна го заменя изцяло - не се добавя към старата.',
    en: 'This field shows the total paid so far. Changing it replaces that value - it does not add to it.',
  },
  'invoices.paidAmountExceedsTotal': {
    bg: 'Платената сума не може да надвишава общата сума на фактурата',
    en: 'The paid amount cannot exceed the invoice total',
  },
  'invoices.fullyPaid': {
    bg: 'Напълно платена',
    en: 'Fully paid',
  },
  'invoices.downloadError': {
    bg: 'Не можах да изтегля файла',
    en: 'Could not download file',
  },
  'invoices.periodAll': {
    bg: 'Всички',
    en: 'All',
  },
  'invoices.periodThisMonth': {
    bg: 'Този месец',
    en: 'This month',
  },
  'invoices.periodLastMonth': {
    bg: 'Миналия месец',
    en: 'Last month',
  },
  'invoices.periodLast3Months': {
    bg: 'Последните 3 месеца',
    en: 'Last 3 months',
  },
  'invoices.periodThisYear': {
    bg: 'Тази година',
    en: 'This year',
  },
  'invoices.periodCustom': {
    bg: 'Период',
    en: 'Custom',
  },
  'invoices.periodFrom': {
    bg: 'От',
    en: 'From',
  },
  'invoices.periodTo': {
    bg: 'До',
    en: 'To',
  },
  'invoices.monthlyTotal': {
    bg: 'Общо',
    en: 'Total',
  },
  'invoices.missingEik': {
    bg: 'Без ЕИК',
    en: 'No EIK',
  },
  'invoices.missingEikSingular': {
    bg: 'фактура без валиден ЕИК на доставчика',
    en: "invoice with no valid supplier EIK",
  },
  'invoices.missingEikPlural': {
    bg: 'фактури без валиден ЕИК на доставчика',
    en: "invoices with no valid supplier EIK",
  },
  'invoices.showAll': {
    bg: 'Покажи всички',
    en: 'Show all',
  },
  'invoices.showOnlyThese': {
    bg: 'Покажи само тях',
    en: 'Show only these',
  },
  'invoices.filtersButton': {
    bg: 'Филтри',
    en: 'Filters',
  },
  'invoices.filtersActive': {
    bg: 'активни',
    en: 'active',
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
    bg: 'Присъединяване по покана',
    en: 'Join by invitation',
  },
  'company.joinHint': {
    bg: 'Имате код за покана от вашия работодател? Въведете го тук.',
    en: 'Have an invitation code from your employer? Enter it here.',
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
  'backup.skippedRecords': {
    bg: 'Пропуснати (вече съществуващи или невалидни) записи',
    en: 'Skipped (already existing or invalid) records',
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
  'stats.top3Title': {
    bg: 'Топ 3',
    en: 'Top 3',
  },
  'stats.topSuppliers': {
    bg: 'Доставчици',
    en: 'Suppliers',
  },
  'stats.topItems': {
    bg: 'Артикули',
    en: 'Items',
  },
  'stats.forecastTitle': {
    bg: 'Прогноза за следващия месец',
    en: 'Forecast for next month',
  },
  'stats.forecastHint': {
    bg: 'На база последните 6 месеца',
    en: 'Based on the last 6 months',
  },
  'stats.forecastRevenue': {
    bg: 'Очакван оборот',
    en: 'Expected revenue',
  },
  'stats.forecastExpense': {
    bg: 'Очакван разход',
    en: 'Expected expense',
  },
  'stats.roiTrendTitle': {
    bg: 'ROI тренд (последните 6 месеца)',
    en: 'ROI trend (last 6 months)',
  },
  'stats.compare': {
    bg: 'Сравни',
    en: 'Compare',
  },
  'stats.compareHint': {
    bg: 'Изберете 2-5 доставчика за сравнение',
    en: 'Select 2-5 suppliers to compare',
  },
  'stats.compareMinRequired': {
    bg: 'Изберете поне 2 доставчика',
    en: 'Select at least 2 suppliers',
  },
  'stats.compareMaxReached': {
    bg: 'Може да сравните най-много 5 доставчика',
    en: 'You can compare at most 5 suppliers',
  },
  'stats.compareButtonWithCount': {
    bg: 'Сравни',
    en: 'Compare',
  },
  'stats.compareTitle': {
    bg: 'Сравнение на доставчици',
    en: 'Supplier comparison',
  },
  'stats.compareTotalAmount': {
    bg: 'Обща сума',
    en: 'Total amount',
  },
  'stats.compareInvoiceCount': {
    bg: 'Брой фактури',
    en: 'Invoice count',
  },
  'stats.compareAvgInvoice': {
    bg: 'Средна фактура',
    en: 'Average invoice',
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
  'stats.priceTrendsDesc': {
    bg: 'Тези артикули имат значителни ценови промени. Следете ги внимателно.',
    en: 'These items have significant price changes. Monitor them closely.',
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
  
  // Loud price-alert popup
  'priceAlertPopup.title': {
    bg: 'Промяна в цените!',
    en: 'Price change!',
  },
  'priceAlertPopup.subtitleSingle': {
    bg: 'Забелязахме повишение на цената на артикул от последна фактура.',
    en: 'We noticed a price increase on an item from a recent invoice.',
  },
  'priceAlertPopup.subtitleMultiple': {
    bg: 'Забелязахме повишение на цените на {count} артикула от последни фактури.',
    en: 'We noticed price increases on {count} items from recent invoices.',
  },
  'priceAlertPopup.more': {
    bg: '+ още {count}',
    en: '+ {count} more',
  },
  'priceAlertPopup.dismiss': {
    bg: 'Затвори',
    en: 'Dismiss',
  },
  'priceAlertPopup.viewDetails': {
    bg: 'Виж в статистиката',
    en: 'View in statistics',
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
  'stats.avgDailyTurnover': {
    bg: 'Среден оборот на ден',
    en: 'Average Daily Turnover',
  },
  'stats.avgDailyTurnoverSubtitle': {
    bg: 'средно за избрания период ({days} дни)',
    en: 'averaged over the selected period ({days} days)',
  },
  'stats.priceInflation': {
    bg: 'Обща инфлация на цените',
    en: 'Overall Price Inflation',
  },
  'stats.inflationPeriod.month': {
    bg: 'Месец',
    en: 'Month',
  },
  'stats.inflationPeriod.quarter': {
    bg: 'Тримесечие',
    en: 'Quarter',
  },
  'stats.inflationPeriod.year': {
    bg: 'Година',
    en: 'Year',
  },
  'stats.inflationHeadline': {
    bg: 'средно претеглена промяна на покупните цени',
    en: 'weighted average change in purchase prices',
  },
  'stats.inflationItemsCompared': {
    bg: 'артикула',
    en: 'items',
  },
  'stats.inflationShowDetails': {
    bg: 'Покажи по артикули',
    en: 'Show by item',
  },
  'stats.inflationHideDetails': {
    bg: 'Скрий детайлите',
    en: 'Hide details',
  },
  'stats.inflationNoData': {
    bg: 'Няма достатъчно данни за избрания период (нужни са поне 2 покупки на артикул).',
    en: 'Not enough data for the selected period (at least 2 purchases per item are needed).',
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
  
  // AI Item Merging
  'items.aiMerge': {
    bg: 'AI Сливане',
    en: 'AI Merge',
  },
  'items.aiMergeDescription': {
    bg: 'Автоматично откриване на сходни продукти',
    en: 'Auto-detect similar products',
  },
  'items.mergeGroups': {
    bg: 'Групи сходни продукти',
    en: 'Similar product groups',
  },
  'items.noMergeGroups': {
    bg: 'Няма открити сходни продукти',
    en: 'No similar products found',
  },
  'items.mergeApplied': {
    bg: 'Сливането е приложено',
    en: 'Merge applied',
  },
  'items.mergedItems': {
    bg: 'Обединени артикули',
    en: 'Merged items',
  },
  'items.variants': {
    bg: 'Варианти',
    en: 'Variants',
  },
  'items.runAiMerge': {
    bg: 'Стартирай AI анализ',
    en: 'Run AI analysis',
  },
  'items.analyzing': {
    bg: 'Анализиране...',
    en: 'Analyzing...',
  },
  'items.mergeSuccess': {
    bg: 'Намерени {{count}} групи сходни продукти',
    en: 'Found {{count}} groups of similar products',
  },
  'items.deleteMerge': {
    bg: 'Премахни сливане',
    en: 'Remove merge',
  },
  'items.deleteMergeConfirm': {
    bg: 'Сигурни ли сте, че искате да премахнете това сливане?',
    en: 'Are you sure you want to remove this merge?',
  },
  'items.viewMerged': {
    bg: 'Обединена статистика',
    en: 'Merged statistics',
  },
  
  // Personal Expenses & ROI (Owner only)
  'personal.title': {
    bg: 'Лични разходи',
    en: 'Personal Expenses',
  },
  'personal.subtitle': {
    bg: 'Вашите инвестиции в бизнеса',
    en: 'Your investments in the business',
  },
  'personal.addExpense': {
    bg: 'Добави разход',
    en: 'Add Expense',
  },
  'personal.amount': {
    bg: 'Сума (лв)',
    en: 'Amount (BGN)',
  },
  'personal.description': {
    bg: 'Описание',
    en: 'Description',
  },
  'personal.typeInvestment': {
    bg: 'Инвестиция',
    en: 'Investment',
  },
  'personal.typeRecurring': {
    bg: 'Текущ разход',
    en: 'Recurring',
  },
  'personal.typeOneTime': {
    bg: 'Еднократен',
    en: 'One-time',
  },
  'personal.categoryGoods': {
    bg: 'Стока',
    en: 'Goods',
  },
  'personal.categoryService': {
    bg: 'Услуга',
    en: 'Service',
  },
  'personal.categoryPersonnel': {
    bg: 'Персонал',
    en: 'Personnel',
  },
  'personal.categoryRent': {
    bg: 'Наем',
    en: 'Rent',
  },
  'personal.categoryExtraordinary': {
    bg: 'Извънреден',
    en: 'Extraordinary',
  },
  'personal.categoryOther': {
    bg: 'Друго',
    en: 'Other',
  },
  'personal.period': {
    bg: 'Период',
    en: 'Period',
  },
  'personal.supplier': {
    bg: 'Доставчик',
    en: 'Supplier',
  },
  'personal.project': {
    bg: 'Проект',
    en: 'Project',
  },
  'personal.notes': {
    bg: 'Бележки',
    en: 'Notes',
  },
  'personal.noExpenses': {
    bg: 'Няма лични разходи за периода',
    en: 'No personal expenses for this period',
  },
  'personal.created': {
    bg: 'Разходът е записан',
    en: 'Expense recorded',
  },
  'personal.deleted': {
    bg: 'Разходът е изтрит',
    en: 'Expense deleted',
  },
  'personal.deleteConfirm': {
    bg: 'Сигурни ли сте, че искате да изтриете този разход?',
    en: 'Are you sure you want to delete this expense?',
  },
  
  // ROI
  'roi.title': {
    bg: 'ROI Анализ',
    en: 'ROI Analysis',
  },
  'roi.totalInvestment': {
    bg: 'Лична инвестиция',
    en: 'Personal Investment',
  },
  'roi.totalRevenue': {
    bg: 'Общ оборот',
    en: 'Total Revenue',
  },
  'roi.totalProfit': {
    bg: 'Печалба',
    en: 'Profit',
  },
  'roi.roiPercent': {
    bg: 'ROI',
    en: 'ROI',
  },
  'roi.profitable': {
    bg: 'Печеливш',
    en: 'Profitable',
  },
  'roi.notProfitable': {
    bg: 'Непечеливш',
    en: 'Not Profitable',
  },
  'roi.investmentCovered': {
    bg: 'Инвестицията покрита',
    en: 'Investment Covered',
  },
  'roi.investmentNotCovered': {
    bg: 'Инвестицията не е покрита',
    en: 'Investment Not Covered',
  },
  'roi.aiInsights': {
    bg: 'AI Анализ',
    en: 'AI Insights',
  },
  'roi.trend': {
    bg: 'Тренд',
    en: 'Trend',
  },
  'roi.noData': {
    bg: 'Няма данни за анализ',
    en: 'No data for analysis',
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
  
  // Budget Screen
  'budget.title': {
    bg: 'Бюджет',
    en: 'Budget',
  },
  'budget.monthlyBudget': {
    bg: 'Месечен бюджет',
    en: 'Monthly Budget',
  },
  'budget.spent': {
    bg: 'Изхарчени',
    en: 'Spent',
  },
  'budget.remaining': {
    bg: 'Остават',
    en: 'Remaining',
  },
  'budget.month': {
    bg: 'Месец',
    en: 'Month',
  },
  'budget.limit': {
    bg: 'Лимит',
    en: 'Limit',
  },
  'budget.exceeded': {
    bg: 'Бюджетът е надхвърлен!',
    en: 'Budget exceeded!',
  },
  'budget.nearLimit': {
    bg: 'Близо до лимита!',
    en: 'Near limit!',
  },
  'budget.noBudget': {
    bg: 'Няма зададен бюджет',
    en: 'No budget set',
  },
  'budget.tapToCreate': {
    bg: 'Натиснете за създаване',
    en: 'Tap to create',
  },
  'budget.setBudget': {
    bg: 'Задай бюджет',
    en: 'Set Budget',
  },
  'budget.monthlyLimit': {
    bg: 'Месечен лимит (лв)',
    en: 'Monthly Limit (BGN)',
  },
  'budget.alertAt': {
    bg: 'Предупреждение при (%)',
    en: 'Alert at (%)',
  },
  'budget.saved': {
    bg: 'Бюджетът е запазен',
    en: 'Budget saved',
  },
  'budget.saveError': {
    bg: 'Грешка при запазване',
    en: 'Error saving',
  },
  'budget.invalidAmount': {
    bg: 'Въведете валидна сума',
    en: 'Enter valid amount',
  },
  'budget.invalidData': {
    bg: 'Невалидни данни',
    en: 'Invalid data',
  },
  'budget.recurring': {
    bg: 'Периодични разходи',
    en: 'Recurring Expenses',
  },
  'budget.addRecurring': {
    bg: 'Добави периодичен разход',
    en: 'Add Recurring Expense',
  },
  'budget.everyMonth': {
    bg: 'Всеки месец на',
    en: 'Every month on',
  },
  'budget.noRecurring': {
    bg: 'Няма периодични разходи',
    en: 'No recurring expenses',
  },
  'budget.description': {
    bg: 'Описание',
    en: 'Description',
  },
  'budget.amount': {
    bg: 'Сума (лв)',
    en: 'Amount (BGN)',
  },
  'budget.dayOfMonth': {
    bg: 'Ден от месеца (1-28)',
    en: 'Day of month (1-28)',
  },
  'budget.descPlaceholder': {
    bg: 'напр. Наем, Интернет...',
    en: 'e.g. Rent, Internet...',
  },
  'budget.recurringCreated': {
    bg: 'Периодичният разход е създаден',
    en: 'Recurring expense created',
  },
  'budget.deleteRecurringConfirm': {
    bg: 'Сигурни ли сте, че искате да изтриете този периодичен разход?',
    en: 'Are you sure you want to delete this recurring expense?',
  },
  'budget.deleteError': {
    bg: 'Грешка при изтриване',
    en: 'Error deleting',
  },
  
  // Export Screen  
  'export.title': {
    bg: 'Експорт',
    en: 'Export',
  },
  'export.subtitle': {
    bg: 'Експортирайте вашите данни',
    en: 'Export your data',
  },
  'export.vatLedger': {
    bg: 'Дневник на покупки/продажби',
    en: 'Purchases/sales VAT ledger',
  },
  'export.vatLedgerDesc': {
    bg: 'Работен дневник по ЗДДС за счетоводителя, групиран по ставки — основа за справка-декларацията',
    en: "Working ЗДДС ledger for the accountant, grouped by VAT rate — the base for the monthly return",
  },
  'export.lastMonth': {
    bg: 'Миналия месец',
    en: 'Last month',
  },
  'export.thisMonth': {
    bg: 'Този месец',
    en: 'This month',
  },
  'export.download': {
    bg: 'Изтегли',
    en: 'Download',
  },
  'export.excel': {
    bg: 'Excel файл (.xlsx)',
    en: 'Excel File (.xlsx)',
  },
  'export.excelDesc': {
    bg: 'За редактиране и анализ в Excel',
    en: 'For editing and analysis in Excel',
  },
  'export.pdf': {
    bg: 'PDF документ',
    en: 'PDF Document',
  },
  'export.pdfDesc': {
    bg: 'За печат и архивиране',
    en: 'For printing and archiving',
  },
  'export.info': {
    bg: 'Експортът включва всички ваши фактури, приходи и разходи за текущия период.',
    en: 'Export includes all your invoices, revenues and expenses for the current period.',
  },
  'export.statsExportHint': {
    bg: 'Търсите PDF с обобщена статистика и графики? Той е в раздел Статистики.',
    en: 'Looking for a summary PDF with charts? That one lives in the Statistics tab.',
  },
  'export.notLoggedIn': {
    bg: 'Не сте влезли в системата',
    en: 'Not logged in',
  },
  'export.fileSaved': {
    bg: 'Файлът е запазен',
    en: 'File saved',
  },
  'export.failed': {
    bg: 'Грешка при експорт',
    en: 'Export failed',
  },
  
  // Profile screen budget & export links
  'profile.budget': {
    bg: 'Бюджет',
    en: 'Budget',
  },
  'profile.budgetDesc': {
    bg: 'Управление на месечен бюджет',
    en: 'Manage monthly budget',
  },
  'profile.auditLog': {
    bg: 'Дневник на действията',
    en: 'Audit log',
  },
  'profile.auditLogDesc': {
    bg: 'Кой какво е добавил, променил или изтрил',
    en: 'Who added, changed or deleted what',
  },
  'auditLog.title': {
    bg: 'Дневник на действията',
    en: 'Audit log',
  },
  'auditLog.empty': {
    bg: 'Няма записани действия',
    en: 'No recorded actions',
  },
  'auditLog.filterAll': {
    bg: 'Всички',
    en: 'All',
  },
  'auditLog.actionCreate': {
    bg: 'Създадена',
    en: 'Created',
  },
  'auditLog.actionUpdate': {
    bg: 'Редактирана',
    en: 'Updated',
  },
  'auditLog.actionDelete': {
    bg: 'Изтрита',
    en: 'Deleted',
  },
  'auditLog.actionExport': {
    bg: 'Експорт',
    en: 'Export',
  },
  'auditLog.entityInvoice': {
    bg: 'фактура',
    en: 'invoice',
  },
  'auditLog.entityInvoices': {
    bg: 'фактури',
    en: 'invoices',
  },
  'profile.export': {
    bg: 'Експорт',
    en: 'Export',
  },
  'profile.exportDesc': {
    bg: 'Изтегли данни в Excel/PDF',
    en: 'Download data as Excel/PDF',
  },
  
  // User Management
  'users.title': {
    bg: 'Управление на потребители',
    en: 'User Management',
  },
  'users.invite': {
    bg: 'Покани',
    en: 'Invite',
  },
  'users.roleOwner': {
    bg: 'Титуляр',
    en: 'Owner',
  },
  'users.roleManager': {
    bg: 'Мениджър',
    en: 'Manager',
  },
  'users.roleStaff': {
    bg: 'Служител',
    en: 'Staff',
  },
  'users.changeRole': {
    bg: 'Промени роля',
    en: 'Change Role',
  },
  'users.remove': {
    bg: 'Премахни',
    en: 'Remove',
  },
  'users.removeConfirm': {
    bg: 'Сигурни ли сте, че искате да премахнете този потребител?',
    en: 'Are you sure you want to remove this user?',
  },

  'profile.payrollDesc': { bg: 'Служители и месечни ведомости', en: 'Employees and monthly payroll' },
  'payroll.title': { bg: 'Ведомост за заплати', en: 'Payroll' },
  'payroll.employees': { bg: 'Служители', en: 'Employees' },
  'payroll.noEmployees': { bg: 'Няма добавени служители', en: 'No employees yet' },
  'payroll.noEmployeesHint': { bg: 'Добавете служител, за да започнете да начислявате заплати', en: 'Add an employee to start processing payroll' },
  'payroll.newEmployee': { bg: 'Нов служител', en: 'New employee' },
  'payroll.editEmployee': { bg: 'Редактиране на служител', en: 'Edit employee' },
  'payroll.name': { bg: 'Име', en: 'Name' },
  'payroll.namePlaceholder': { bg: 'Име на служителя', en: "Employee's name" },
  'payroll.position': { bg: 'Длъжност', en: 'Position' },
  'payroll.positionPlaceholder': { bg: 'напр. Продавач-консултант', en: 'e.g. Sales assistant' },
  'payroll.agreementType': { bg: 'Начин на договаряне', en: 'Agreement type' },
  'payroll.grossAgreement': { bg: 'Бруто (стандартно)', en: 'Gross (standard)' },
  'payroll.netAgreement': { bg: 'Нето "на ръка"', en: 'Net take-home' },
  'payroll.grossSalary': { bg: 'Брутна заплата', en: 'Gross salary' },
  'payroll.netSalary': { bg: 'Нетна заплата ("на ръка")', en: 'Net salary (take-home)' },
  'payroll.foodVouchers': { bg: 'Ваучери за храна', en: 'Food vouchers' },
  'payroll.additionalInsurance': { bg: 'Допълнително осигуряване', en: 'Additional insurance' },
  'payroll.noPosition': { bg: 'Без длъжност', en: 'No position' },
  'payroll.netShort': { bg: '· нето', en: '· net' },
  'payroll.grossShort': { bg: '· бруто', en: '· gross' },
  'payroll.process': { bg: 'Начисли за месеца', en: 'Process for this month' },
  'payroll.netAmount': { bg: 'Нетно за получаване', en: 'Net take-home' },
  'payroll.totalEmployerCost': { bg: 'Общ разход за работодателя', en: 'Total employer cost' },
  'payroll.removeEntry': { bg: 'Премахни начислението', en: 'Remove this entry' },
  'payroll.deleteEmployee': { bg: 'Изтрий служителя', en: 'Delete employee' },
  'payroll.deleteEmployeeConfirm': { bg: 'Служителят ще бъде изтрит, но вече начислените заплати остават в историята.', en: "The employee will be deleted, but past payroll entries stay in the history." },
  'payroll.deleteEntryConfirm': { bg: 'Сигурни ли сте, че искате да премахнете това начисление?', en: 'Remove this payroll entry?' },
  'payroll.bonus': { bg: 'Бонус за месеца', en: 'Bonus this month' },
  'payroll.attachPhoto': { bg: 'Прикачи снимка на ведомостта', en: 'Attach a photo of the payslip' },
  'payroll.photoAttached': { bg: 'Снимката е прикачена ✓', en: 'Photo attached ✓' },
  'payroll.period': { bg: 'Период', en: 'Period' },
  'payroll.grossAmount': { bg: 'Брутно възнаграждение', en: 'Gross amount' },
  'payroll.employeeContributions': { bg: 'Осигуровки (за сметка на служителя)', en: "Contributions (employee's share)" },
  'payroll.incomeTax': { bg: 'Данък общ доход', en: 'Income tax' },
  'payroll.employerContributions': { bg: 'Осигуровки за сметка на работодателя', en: "Employer's contributions" },
  'payroll.rates': { bg: 'Осигурителни ставки', en: 'Contribution rates' },
  'payroll.ratesDisclaimer': { bg: 'Тези проценти се сменят всяка година от НАП/НОИ — проверявайте ги с вашия счетоводител.', en: 'These percentages change every year — verify them with your accountant.' },
  'payroll.employeeRate': { bg: 'Осигуровки за сметка на осигурения (%)', en: "Employee's contribution rate (%)" },
  'payroll.employerRate': { bg: 'Осигуровки за сметка на работодателя (%)', en: "Employer's contribution rate (%)" },
  'payroll.incomeTaxRate': { bg: 'Данък общ доход (%)', en: 'Income tax rate (%)' },
  'payroll.minInsuranceIncome': { bg: 'Минимален осигурителен доход (€)', en: 'Minimum insurance income (€)' },
  'payroll.maxInsuranceIncome': { bg: 'Максимален осигурителен доход (€)', en: 'Maximum insurance income (€)' },
  'payroll.totalCostThisMonth': { bg: 'Общ разход за персонал този месец', en: 'Total staff cost this month' },

  'profile.assetsDesc': { bg: 'Регистър на дълготрайните активи и амортизации', en: 'Fixed assets register and depreciation' },
  'assets.title': { bg: 'Дълготрайни активи (ДМА)', en: 'Fixed assets' },
  'assets.depreciationThisMonth': { bg: 'Амортизации за месеца', en: 'Depreciation this month' },
  'assets.netBookValue': { bg: 'Балансова стойност', en: 'Net book value' },
  'assets.acquisitionValue': { bg: 'Доставна стойност', en: 'Acquisition value' },
  'assets.accumulatedDepreciation': { bg: 'Начислена амортизация', en: 'Accumulated depreciation' },
  'assets.monthlyDepreciation': { bg: 'Месечна амортизация', en: 'Monthly depreciation' },
  'assets.noAssets': { bg: 'Няма добавени активи', en: 'No assets yet' },
  'assets.noAssetsHint': { bg: 'Добавете сграда, оборудване, автомобил или друг дълготраен актив, за да следите амортизацията му автоматично', en: 'Add a building, equipment, vehicle or other fixed asset to track its depreciation automatically' },
  'assets.newAsset': { bg: 'Нов актив', en: 'New asset' },
  'assets.editAsset': { bg: 'Редактиране на актив', en: 'Edit asset' },
  'assets.name': { bg: 'Наименование', en: 'Name' },
  'assets.namePlaceholder': { bg: 'напр. Лек автомобил Skoda Octavia', en: 'e.g. Company car' },
  'assets.category': { bg: 'Данъчна категория', en: 'Tax category' },
  'assets.acquisitionDate': { bg: 'Дата на придобиване', en: 'Acquisition date' },
  'assets.inServiceDate': { bg: 'Дата на въвеждане в експлоатация', en: 'Date put into service' },
  'assets.depreciationRate': { bg: 'Годишна норма на амортизация (%)', en: 'Annual depreciation rate (%)' },
  'assets.depreciationRateHint': { bg: 'Това е данъчната норма по чл. 55 ЗКПО (максимална за категорията). Счетоводната Ви амортизация може да е различна, според собствената Ви амортизационна политика — коригирайте, ако е така.', en: 'This is the tax depreciation rate under Art. 55 CITA (the category maximum). Your real accounting depreciation may differ per your own policy — adjust if so.' },
  'assets.responsiblePerson': { bg: 'Материално отговорно лице', en: 'Responsible person' },
  'assets.responsiblePersonPlaceholder': { bg: 'напр. Иван Иванов', en: "e.g. the employee's name" },
  'assets.notes': { bg: 'Бележки', en: 'Notes' },
  'assets.lowValueHint': { bg: 'Активи под 357.93 € обикновено могат да се отчитат директно като разход вместо ДМА, според счетоводната политика на фирмата.', en: 'Assets below €357.93 can usually be expensed directly instead of capitalized, per the company\'s accounting policy.' },
  'assets.attachPhoto': { bg: 'Прикачи снимка/документ', en: 'Attach a photo/document' },
  'assets.photoAttached': { bg: 'Снимката е прикачена ✓', en: 'Photo attached ✓' },
  'assets.statusActive': { bg: 'Активен', en: 'Active' },
  'assets.statusFullyDepreciated': { bg: 'Напълно амортизиран', en: 'Fully depreciated' },
  'assets.statusDisposed': { bg: 'Бракуван/продаден', en: 'Disposed' },
  'assets.dispose': { bg: 'Бракувай / продай', en: 'Dispose' },
  'assets.disposeConfirmTitle': { bg: 'Бракуване на актив', en: 'Dispose asset' },
  'assets.disposalDate': { bg: 'Дата на бракуване/продажба', en: 'Disposal date' },
  'assets.disposalReason': { bg: 'Причина (по избор)', en: 'Reason (optional)' },
  'assets.disposalReasonPlaceholder': { bg: 'напр. Продаден, бракуван поради износване', en: 'e.g. Sold, scrapped due to wear' },
  'assets.deleteAsset': { bg: 'Изтрий актива', en: 'Delete asset' },
  'assets.deleteAssetConfirm': { bg: 'Активът и историята на амортизацията му ще бъдат изтрити безвъзвратно.', en: 'The asset and its depreciation history will be permanently deleted.' },
  'assets.summaryTitle': { bg: 'Активни активи', en: 'Active assets' },

  'companySwitcher.switchCompany': { bg: 'Смяна на фирма', en: 'Switch company' },
  'companySwitcher.yourCompanies': { bg: 'Вашите фирми', en: 'Your companies' },
  'companySwitcher.viewingAs': { bg: 'Преглеждате като', en: 'Viewing as' },
  'companySwitcher.switched': { bg: 'Превключено', en: 'Switched' },
  'companySwitcher.switchedTo': { bg: 'Вече преглеждате', en: 'You are now viewing' },
  'invitations.roleAccountant': { bg: 'Счетоводител', en: 'Accountant' },
  'invitations.accountantHint': { bg: 'Достъп до статистики, фактури, ведомости и ДМА на тази фирма, без право да управлява потребители или данните на фирмата. Може да работи с няколко фирми клиенти от един акаунт.', en: "Access to this company's statistics, invoices, payroll and fixed assets, without managing users or company settings. Can work across several client companies from one account." },
  'invitations.permissionsTitle': { bg: 'Права на достъп', en: 'Access permissions' },
  'invitations.permissionsHint': { bg: 'Отметнати са правата по подразбиране за тази роля. Може да ги коригирате.', en: "The role's default permissions are pre-checked. You can adjust them." },
  'users.editAccess': { bg: 'Редакция на достъп', en: 'Edit access' },
  'users.role': { bg: 'Роля', en: 'Role' },
  'users.saveChanges': { bg: 'Запази промените', en: 'Save changes' },

  'notifications.title': { bg: 'Известия за ДДС', en: 'VAT notifications' },
  'notifications.thresholdTitle': { bg: 'Известие при надхвърляне', en: 'Threshold alert' },
  'notifications.thresholdSubtitle': { bg: 'Известие когато ДДС надхвърли сума', en: 'Alert when VAT exceeds an amount' },
  'notifications.thresholdAmountLabel': { bg: 'Сума на ДДС (€)', en: 'VAT amount (€)' },
  'notifications.thresholdAmountPlaceholder': { bg: 'Напр. 5000', en: 'e.g. 5000' },
  'notifications.thresholdHint': { bg: 'Известие когато ДДС за плащане надхвърли тази сума', en: 'Notifies you when the VAT due exceeds this amount' },
  'notifications.periodicTitle': { bg: 'Периодични известия', en: 'Periodic reminders' },
  'notifications.periodicSubtitle': { bg: 'Напомняне на избрани дати', en: 'Reminders on chosen dates' },
  'notifications.selectDatesLabel': { bg: 'Изберете дати от месеца', en: 'Choose dates of the month' },
  'notifications.selectedDatesLabel': { bg: 'Избрани', en: 'Selected' },
  'notifications.pushInfo': { bg: 'Известията се изпращат като push нотификации. Уверете се, че сте ги разрешили.', en: 'Notifications are sent as push notifications. Make sure you have allowed them.' },
  'notifications.save': { bg: 'Запази настройки', en: 'Save settings' },
  'notifications.saved': { bg: 'Настройките са запазени', en: 'Settings saved' },
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

  const dateLocale = language === 'bg' ? dateFnsBg : dateFnsEnUS;

  return { t, language, dateLocale };
}

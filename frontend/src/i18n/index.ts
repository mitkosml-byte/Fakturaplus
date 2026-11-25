// Localization system for the app
import { useCallback } from 'react';
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
    en: 'Invoice Management',
  },
  'login.subtitle': {
    bg: 'Влезте, за да продължите',
    en: 'Sign in to continue',
  },
  'login.selectLanguage': {
    bg: 'Изберете език',
    en: 'Select language',
  },
  'login.enterEmail': {
    bg: 'Въведете имейл',
    en: 'Enter email',
  },
  'login.enterPassword': {
    bg: 'Въведете парола',
    en: 'Enter password',
  },
  'login.enterName': {
    bg: 'Въведете име',
    en: 'Enter name',
  },
  'login.codeDidntWork': {
    bg: 'Кодът не проработи',
    en: "Code didn't work",
  },
  'login.accountCreatedTryAgain': {
    bg: 'Профилът е създаден. Можете да опитате отново от Профил > Фирма > "Присъедини се по покана".',
    en: 'Your account was created. You can try again from Profile > Company > "Join by invitation".',
  },
  'login.loginTab': {
    bg: 'Вход',
    en: 'Login',
  },
  'login.registerTab': {
    bg: 'Регистрация',
    en: 'Register',
  },
  'login.namePlaceholder': {
    bg: 'Име',
    en: 'Name',
  },
  'login.emailPlaceholder': {
    bg: 'Имейл',
    en: 'Email',
  },
  'login.passwordPlaceholder': {
    bg: 'Парола',
    en: 'Password',
  },
  'login.twoFactorTitle': { bg: 'Код за вход', en: 'Login code' },
  'login.twoFactorApp': { bg: 'Въведете 6-цифрения код от приложението за кодове.', en: 'Enter the 6-digit code from your authenticator app.' },
  'login.twoFactorEmail': { bg: 'Изпратихме код на имейла ви. Въведете го тук.', en: 'We sent a code to your email. Enter it here.' },
  'login.twoFactorEmailFailed': {
    bg: 'Имейлът с кода не можа да бъде изпратен. Влезте с един от резервните кодове.',
    en: 'The email with the code could not be sent. Log in with one of your recovery codes.',
  },
  'login.twoFactorRecoveryHint': { bg: 'Нямате телефона? Въведете резервен код (XXXX-XXXX).', en: 'No phone? Enter a recovery code (XXXX-XXXX).' },
  'login.twoFactorPlaceholder': { bg: 'Код', en: 'Code' },
  'login.enterCode': { bg: 'Въведете кода', en: 'Enter the code' },
  'login.confirmCode': { bg: 'Потвърди', en: 'Confirm' },
  'login.backToLogin': { bg: 'Назад към входа', en: 'Back to login' },
  'login.forgotPassword': {
    bg: 'Забравена парола?',
    en: 'Forgot password?',
  },
  'login.newUserHint': {
    bg: 'Получихте покана или сте нов потребител? Регистрирайте се тук',
    en: 'Got an invitation or new here? Register here',
  },
  'login.haveInviteCode': {
    bg: 'Имате код за покана? (по избор)',
    en: 'Have an invitation code? (optional)',
  },
  'login.inviteCodePlaceholder': {
    bg: 'Код за покана (по избор)',
    en: 'Invitation code (optional)',
  },
  'login.privacyPolicy': {
    bg: 'Поверителност',
    en: 'Privacy Policy',
  },
  'login.terms': {
    bg: 'Условия',
    en: 'Terms',
  },

  // Forgot Password Screen
  'forgotPassword.title': {
    bg: 'Забравена парола',
    en: 'Forgot Password',
  },
  'forgotPassword.enterEmail': {
    bg: 'Въведете имейл',
    en: 'Enter your email',
  },
  'forgotPassword.sent': {
    bg: 'Изпратено',
    en: 'Sent',
  },
  'forgotPassword.codeSentMessage': {
    bg: 'Ако имейлът съществува в системата, изпратихме код за възстановяване. Проверете пощата си.',
    en: 'If that email is registered, we sent a reset code. Check your inbox.',
  },
  'forgotPassword.enterCode': {
    bg: 'Въведете кода от имейла',
    en: 'Enter the code from the email',
  },
  'forgotPassword.enterNewPassword': {
    bg: 'Въведете нова парола',
    en: 'Enter a new password',
  },
  'forgotPassword.passwordChanged': {
    bg: 'Паролата е сменена успешно. Моля, влезте отново.',
    en: 'Password changed successfully. Please log in again.',
  },
  'forgotPassword.yourEmail': {
    bg: 'Вашият имейл',
    en: 'Your email',
  },
  'forgotPassword.willSendCode': {
    bg: 'Ще ви изпратим код за възстановяване',
    en: "We'll send you a reset code",
  },
  'forgotPassword.sendCode': {
    bg: 'Изпрати код',
    en: 'Send code',
  },
  'forgotPassword.alreadyHaveCode': {
    bg: 'Вече имам код',
    en: 'I already have a code',
  },
  'forgotPassword.codeAndNewPassword': {
    bg: 'Код и нова парола',
    en: 'Code and new password',
  },
  'forgotPassword.codeValidity': {
    bg: 'Кодът е валиден 30 минути',
    en: 'The code is valid for 30 minutes',
  },
  'forgotPassword.emailPlaceholder': {
    bg: 'Имейл',
    en: 'Email',
  },
  'forgotPassword.newPasswordPlaceholder': {
    bg: 'Нова парола',
    en: 'New password',
  },
  'forgotPassword.resetPassword': {
    bg: 'Смени паролата',
    en: 'Reset password',
  },
  'forgotPassword.sendNewCode': {
    bg: 'Изпрати нов код',
    en: 'Send a new code',
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
  'nav.team': {
    bg: 'Екип',
    en: 'Team',
  },
  'nav.profile': {
    bg: 'Акаунт',
    en: 'Account',
  },
  'team.title': {
    bg: 'Екип',
    en: 'Team',
  },
  'team.subtitle': {
    bg: 'Календар, съобщения и всичко, свързано с хората в екипа',
    en: 'Calendar, messages, and everything about your team',
  },
  
  // Morning briefing card (top of Home) - renders whatever the backend's
  // unified Proactive Second Brain engine (GET /proactive/signals) ranks
  // highest; signal title/detail text itself comes from the backend
  // (Bulgarian-only, same as every other push notification in the app).
  'briefing.title': {
    bg: 'Дневен преглед',
    en: 'Daily briefing',
  },
  'briefing.allClear': {
    bg: 'Нищо спешно днес - всичко изглежда наред.',
    en: 'Nothing urgent today - everything looks fine.',
  },
  'briefing.new': {
    bg: 'Ново',
    en: 'New',
  },
  'briefing.newCount': {
    bg: '{n} нови от вчера',
    en: '{n} new since yesterday',
  },
  'briefing.showMore': {
    bg: 'Покажи още {n}',
    en: 'Show {n} more',
  },
  'briefing.showLess': {
    bg: 'Покажи по-малко',
    en: 'Show less',
  },
  'briefing.cta.unpaid_invoices': {
    bg: 'Виж фактурите',
    en: 'View invoices',
  },
  'briefing.cta.receivables': {
    bg: 'Виж вземанията',
    en: 'View receivables',
  },
  'briefing.cta.payments_this_week': {
    bg: 'Виж плащанията',
    en: 'View payments',
  },
  'briefing.cta.backup': {
    bg: 'Направи архив',
    en: 'Make a backup',
  },
  'briefing.cta.accountant_pack': {
    bg: 'Виж пакета',
    en: 'View the pack',
  },
  'briefing.cta.cash_flow': {
    bg: 'Виж паричния поток',
    en: 'View the cash flow',
  },
  'briefing.cta.payment_reminders': {
    bg: 'Прегледай напомнянията',
    en: 'Review the reminders',
  },
  'briefing.cta.recurring_invoices': {
    bg: 'Издай фактурите',
    en: 'Issue the invoices',
  },
  'briefing.cta.two_factor': {
    bg: 'Включи',
    en: 'Turn it on',
  },
  'briefing.cta.scan_credits': {
    bg: 'Добави сканирания',
    en: 'Add scans',
  },
  'briefing.cta.budget': {
    bg: 'Виж бюджета',
    en: 'View budget',
  },
  'briefing.cta.price_alerts': {
    bg: 'Виж цените',
    en: 'View prices',
  },
  'briefing.cta.reorder': {
    bg: 'Виж какво да поръчаш',
    en: 'See what to order',
  },
  'briefing.cta.forecast': {
    bg: 'Виж прогнозата',
    en: 'View forecast',
  },
  'briefing.cta.schedule_unpaid': {
    bg: 'Плати часовете',
    en: 'Pay the hours',
  },
  'briefing.cta.team_on_leave': {
    bg: 'Виж графика',
    en: 'View schedule',
  },
  'briefing.cta.personal_wallet': {
    bg: 'Виж личните разходи',
    en: 'View personal spending',
  },
  'briefing.cta.weak_weekday': {
    bg: 'Виж оборота по дни',
    en: 'View revenue by weekday',
  },
  'briefing.cta.staffing_mismatch': {
    bg: 'Виж часовете спрямо оборота',
    en: 'View hours vs revenue',
  },
  'briefing.cta.missing_revenue': {
    bg: 'Въведи оборота',
    en: 'Enter revenue',
  },
  'briefing.cta.recurring_invoice_missing': {
    bg: 'Сканирай фактурата',
    en: 'Scan the invoice',
  },
  'briefing.cta.recurring': {
    bg: 'Към периодичните',
    en: 'Recurring expenses',
  },
  'briefing.recurringRecord': {
    bg: 'Платен е – запиши',
    en: 'Paid – record it',
  },
  'briefing.recurringSkip': {
    bg: 'Пропусни месеца',
    en: 'Skip this month',
  },
  'briefing.recurringYes': {
    bg: 'Да, същото е',
    en: 'Yes, the same',
  },
  'briefing.recurringNo': {
    bg: 'Не, различно е',
    en: 'No, different',
  },
  'recurring.badge': {
    bg: 'Периодичен разход',
    en: 'Recurring expense',
  },
  'recurring.dayRange': {
    bg: 'Денят трябва да е между 1 и 28.',
    en: 'The day must be between 1 and 28.',
  },
  'recurring.supplierRequired': {
    bg: 'Посочи доставчика, от когото идва фактурата – по него програмата я разпознава всеки месец.',
    en: 'Name the supplier the invoice comes from – that is how the app recognises it every month.',
  },
  'recurring.updated': {
    bg: 'Периодичният разход е обновен',
    en: 'Recurring expense updated',
  },
  'recurring.deleteConfirm': {
    bg: 'Да спре ли този периодичен разход? Вече записаните плащания остават.',
    en: 'Stop this recurring expense? Payments already recorded stay.',
  },
  'recurring.recorded': {
    bg: 'Записан като разход',
    en: 'Recorded as an expense',
  },
  'recurring.expenseLabel': {
    bg: 'разход „{description}“ – {amount} на {date}',
    en: 'expense “{description}” – {amount} on {date}',
  },
  'recurring.invoiceLabel': {
    bg: 'фактура № {number} от {supplier} – {amount} на {date}',
    en: 'invoice No. {number} from {supplier} – {amount} on {date}',
  },
  'recurring.paidByInvoice': {
    bg: '{month}: платен с фактура № {number} – {amount}',
    en: '{month}: paid by invoice No. {number} – {amount}',
  },
  'recurring.recordedTwice': {
    bg: 'Записан е и разход без фактура за {amount}. Едно и също плащане ли е?',
    en: 'An expense without an invoice of {amount} is recorded too. Is it the same payment?',
  },
  'recurring.sameKeepInvoice': {
    bg: 'Същото е – остави фактурата',
    en: 'Same – keep the invoice',
  },
  'recurring.different': {
    bg: 'Не, различно е',
    en: 'No, different',
  },
  'recurring.paidByExpense': {
    bg: '{month}: записан на {date} – {amount}',
    en: '{month}: recorded on {date} – {amount}',
  },
  'recurring.invoiceCameToo': {
    bg: 'Дойде и {record}. Ако е същото плащане, фактурата заменя записа.',
    en: 'Also came: {record}. If it is the same payment, the invoice replaces the record.',
  },
  'recurring.skipped': {
    bg: '{month}: пропуснат този месец',
    en: '{month}: skipped this month',
  },
  'recurring.unskip': {
    bg: 'Върни',
    en: 'Undo',
  },
  'recurring.isThisIt': {
    bg: '{month}: това ли е плащането – {record}?',
    en: '{month}: is this the payment – {record}?',
  },
  'recurring.yesThatIsIt': {
    bg: 'Да, това е',
    en: 'Yes, that is it',
  },
  'recurring.upcomingInvoice': {
    bg: '{month}: очаква се фактура около {date}',
    en: '{month}: invoice expected around {date}',
  },
  'recurring.upcoming': {
    bg: '{month}: плаща се на {date}',
    en: '{month}: due on {date}',
  },
  'recurring.awaitingInvoice': {
    bg: '{month}: чака се фактурата (около {date})',
    en: '{month}: waiting for the invoice (around {date})',
  },
  'recurring.invoiceMissing': {
    bg: '{month}: фактурата липсва (очаквана около {date}). Въведи я, когато дойде.',
    en: '{month}: the invoice is missing (expected around {date}). Enter it when it comes.',
  },
  'recurring.skipMonth': {
    bg: 'Пропусни месеца',
    en: 'Skip this month',
  },
  'recurring.duePaid': {
    bg: '{month}: платен ли е? (на {date})',
    en: '{month}: is it paid? (due {date})',
  },
  'recurring.paidRecord': {
    bg: 'Платен е – запиши',
    en: 'Paid – record it',
  },
  'recurring.outlook': {
    bg: 'Този месец: {total} периодични разходи · платени {paid} · очакват се още {left}',
    en: 'This month: {total} in recurring expenses · paid {paid} · still to come {left}',
  },
  'recurring.emptyHint': {
    bg: 'Наем, абонаменти, застраховки, сметки, вноски – добави ги веднъж и програмата следи всяко плащане, всеки месец или през няколко месеца, без да го брои два пъти.',
    en: 'Rent, subscriptions, insurance, bills, installments – add them once and the app tracks every payment, monthly or every few months, never counting it twice.',
  },
  'recurring.everyMonthOn': {
    bg: 'всеки месец на {day}-о',
    en: 'every month on day {day}',
  },
  'recurring.withInvoiceFrom': {
    bg: 'с фактура от {supplier}',
    en: 'invoiced by {supplier}',
  },
  'recurring.noInvoiceAuto': {
    bg: 'без фактура · записва се сам',
    en: 'no invoice · recorded by itself',
  },
  'recurring.noInvoiceAsk': {
    bg: 'без фактура · пита на деня',
    en: 'no invoice · asks on the day',
  },
  'recurring.pause': {
    bg: 'Спри',
    en: 'Pause',
  },
  'recurring.resume': {
    bg: 'Пусни',
    en: 'Resume',
  },
  'recurring.startsIn': {
    bg: 'Започва от {month}',
    en: 'Starts in {month}',
  },
  'recurring.edit': {
    bg: 'Периодичен разход',
    en: 'Recurring expense',
  },
  'recurring.usualAmount': {
    bg: 'Обичайна сума (€)',
    en: 'Usual amount (€)',
  },
  'recurring.invoiceComes': {
    bg: 'Идва ли фактура за него?',
    en: 'Does an invoice come for it?',
  },
  'recurring.withInvoice': {
    bg: 'С фактура',
    en: 'With invoice',
  },
  'recurring.withoutInvoice': {
    bg: 'Без фактура',
    en: 'Without invoice',
  },
  'recurring.withInvoiceHint': {
    bg: 'Фактурата е разходът: програмата не записва нищо отделно. Чака я от доставчика при всяко плащане, отбелязва го като платено и напомня, ако закъснее.',
    en: 'The invoice is the expense: the app records nothing separately. It waits for it from the supplier at each payment, marks it paid and reminds you when it is late.',
  },
  'recurring.withoutInvoiceHint': {
    bg: 'Програмата записва разход без фактура – когато потвърдиш, че е платен, или сама на деня му. Ако все пак дойде фактура за него, тя заменя записа и разходът не се брои два пъти.',
    en: 'The app records an expense without an invoice – when you confirm it is paid, or by itself on its day. If an invoice does come for it, the invoice replaces the record and the cost is never counted twice.',
  },
  'recurring.supplier': {
    bg: 'Доставчик',
    en: 'Supplier',
  },
  'recurring.supplierOptional': {
    bg: 'Доставчик (по избор)',
    en: 'Supplier (optional)',
  },
  'recurring.supplierPlaceholder': {
    bg: 'Име на доставчика',
    en: 'Supplier name',
  },
  'recurring.supplierEik': {
    bg: 'ЕИК на доставчика (по избор)',
    en: 'Supplier EIK (optional)',
  },
  'recurring.autoRecord': {
    bg: 'Записвай сам на деня му',
    en: 'Record by itself on its day',
  },
  'recurring.autoRecordHint': {
    bg: 'Без да пита. Изключено – на деня пита „Платен ли е?“.',
    en: 'Without asking. Off – on the day it asks “Is it paid?”.',
  },
  'recurring.howOften': { bg: 'Колко често се плаща', en: 'How often it is paid' },
  'recurring.everyMonth': { bg: 'Всеки месец', en: 'Every month' },
  'recurring.everyNMonths': { bg: 'На {n} месеца', en: 'Every {n} months' },
  'recurring.yearly': { bg: 'Годишно', en: 'Yearly' },
  'recurring.otherInterval': { bg: 'Друго', en: 'Other' },
  'recurring.everyPrefix': { bg: 'На всеки', en: 'Every' },
  'recurring.monthsSuffix': { bg: 'месеца', en: 'months' },
  'recurring.firstPayment': { bg: 'Първо плащане', en: 'First payment' },
  'recurring.paymentsCount': { bg: 'Брой плащания', en: 'Payments' },
  'recurring.noEnd': { bg: 'без край', en: 'no end' },
  'recurring.earlierMonth': { bg: 'По-ранен месец', en: 'Earlier month' },
  'recurring.laterMonth': { bg: 'По-късен месец', en: 'Later month' },
  'recurring.lastPaymentHint': { bg: 'Последно плащане: {month}', en: 'Last payment: {month}' },
  'recurring.paymentsAlreadyOver': {
    bg: 'Последното плащане е било през {month} – плащанията вече са приключили.',
    en: 'The last payment was in {month} – the payments are already over.',
  },
  'recurring.intervalRange': {
    bg: 'Броят месеци трябва да е цяло число от 1 до {max}.',
    en: 'The number of months must be a whole number from 1 to {max}.',
  },
  'recurring.countRange': {
    bg: 'Броят плащания трябва да е цяло число – или празно, ако няма край.',
    en: 'The number of payments must be a whole number – or empty when there is no end.',
  },
  'recurring.everyNMonthsOn': { bg: 'на всеки {n} месеца на {day}-о', en: 'every {n} months on day {day}' },
  'recurring.yearlyOn': { bg: 'всяка година на {date}', en: 'every year on {date}' },
  'recurring.nextPayment': { bg: 'следващо плащане: {date}', en: 'next payment: {date}' },
  'recurring.firstPaymentOn': { bg: 'първо плащане: {date}', en: 'first payment: {date}' },
  'recurring.paymentsLeft': { bg: 'остават {left} плащания, до {month}', en: '{left} payments left, until {month}' },
  'recurring.lastPayment': { bg: 'последно плащане', en: 'the last payment' },
  'recurring.paymentsOver': { bg: 'Плащанията приключиха', en: 'The payments are over' },
  'scan.creditedInvoiceNumber': {
    bg: 'Към фактура №',
    en: 'For invoice No.',
  },
  'scan.creditedInvoicePlaceholder': {
    bg: 'Номерът на фактурата, която известието коригира',
    en: 'The number of the invoice the credit note corrects',
  },
  'invoices.creditedTo': {
    bg: 'Към фактура № {number}.',
    en: 'For invoice No. {number}.',
  },
  'invoices.creditedToMissing': {
    bg: 'Фактурата още не е въведена – свързва се щом я добавиш.',
    en: 'That invoice is not in yet – it is linked as soon as you add it.',
  },
  'invoices.creditedAmount': {
    bg: 'Кредитни известия: −{amount} €',
    en: 'Credit notes: −{amount} €',
  },
  'invoices.refundDue': {
    bg: 'За връщане или прихващане от доставчика: {amount} €',
    en: 'For the supplier to refund or offset: {amount} €',
  },
  'scan.salesRequired': {
    bg: 'Попълни клиента, номера на фактурата и сумата.',
    en: 'Fill in the customer, the invoice number and the amount.',
  },
  'scan.salesNumberTooLong': {
    bg: 'Номерът на фактурата е най-много 10 цифри.',
    en: 'An invoice number has at most 10 digits.',
  },
  'scan.salesLine': {
    bg: 'Съгласно фактура № {number}',
    en: 'As per invoice No. {number}',
  },
  'scan.salesSaved': {
    bg: 'Фактура № {number} е записана при издадените',
    en: 'Invoice No. {number} saved with the issued invoices',
  },
  'scan.salesCustomer': {
    bg: 'Клиент (получател)',
    en: 'Customer (recipient)',
  },
  'scan.salesCustomerPlaceholder': {
    bg: 'Името на клиента от фактурата',
    en: 'The customer name on the invoice',
  },
  'scan.salesCustomerEik': {
    bg: 'ЕИК на клиента',
    en: 'Customer EIK',
  },
  'scan.salesNumber': {
    bg: 'Номер на фактурата',
    en: 'Invoice number',
  },
  'billingDocuments.inTill': {
    bg: 'Мина през касата (касов бон)',
    en: 'Rung up at the till (fiscal receipt)',
  },
  'billingDocuments.inTillHint': {
    bg: 'Сумата вече е в оборота на касата за деня - фактурата не я добавя втори път.',
    en: 'The amount is in the day\'s till revenue already - the invoice does not add it a second time.',
  },
  'billingDocuments.notInTillHint': {
    bg: 'Сумата не е в оборота на касата - фактурата е приходът за деня.',
    en: 'The amount is not in the till revenue - the invoice is the day\'s income.',
  },
  'billingDocuments.badgeInTill': {
    bg: 'през касата',
    en: 'at the till',
  },
  'billingDocuments.badgeExternal': {
    bg: 'от друга програма',
    en: 'other program',
  },
  'customers.title': {
    bg: 'Клиенти',
    en: 'Customers',
  },
  'customers.add': {
    bg: 'Нов клиент',
    en: 'New customer',
  },
  'customers.edit': {
    bg: 'Данни на клиента',
    en: 'Customer details',
  },
  'customers.search': {
    bg: 'Търси по име, ЕИК или имейл',
    en: 'Search by name, EIK or email',
  },
  'customers.empty': {
    bg: 'Още няма клиенти',
    en: 'No customers yet',
  },
  'customers.emptyHint': {
    bg: 'Добави ги тук или просто издай фактура – клиентът се запомня сам, със своя ЕИК и адрес.',
    en: 'Add them here or just issue an invoice – the customer is remembered with their EIK and address.',
  },
  'customers.noMatch': {
    bg: 'Няма клиент с такова име или ЕИК',
    en: 'No customer with that name or EIK',
  },
  'customers.noDetails': {
    bg: 'Без ЕИК и адрес',
    en: 'No EIK or address',
  },
  'customers.name': {
    bg: 'Име',
    en: 'Name',
  },
  'customers.eik': {
    bg: 'ЕИК/Булстат',
    en: 'EIK/Bulstat',
  },
  'customers.vatNumber': {
    bg: 'ДДС номер',
    en: 'VAT number',
  },
  'customers.address': {
    bg: 'Адрес',
    en: 'Address',
  },
  'customers.email': {
    bg: 'Имейл',
    en: 'Email',
  },
  'customers.phone': {
    bg: 'Телефон',
    en: 'Phone',
  },
  'customers.notes': {
    bg: 'Бележки',
    en: 'Notes',
  },
  'customers.eikShort': {
    bg: 'ЕИК',
    en: 'EIK',
  },
  'customers.vatShort': {
    bg: 'ДДС №',
    en: 'VAT No.',
  },
  'customers.nameRequired': {
    bg: 'Името на клиента е задължително.',
    en: 'The customer name is required.',
  },
  'customers.saved': {
    bg: 'Клиентът е записан',
    en: 'Customer saved',
  },
  'customers.deleteConfirm': {
    bg: 'Да изтрия ли „{name}“? Документите и дълговете остават с името, на което са издадени.',
    en: 'Delete “{name}”? Their documents and debts stay under the name they were issued to.',
  },
  'customers.invoiced': {
    bg: 'Фактурирано',
    en: 'Invoiced',
  },
  'customers.invoiceCount': {
    bg: '{count} фактури',
    en: '{count} invoices',
  },
  'customers.owed': {
    bg: 'Дължи сега',
    en: 'Owes now',
  },
  'customers.overdue': {
    bg: '{amount} просрочени',
    en: '{amount} overdue',
  },
  'customers.lastInvoice': {
    bg: 'Последна фактура: {date}',
    en: 'Last invoice: {date}',
  },
  'customers.openDebts': {
    bg: 'Неплатени',
    en: 'Unpaid',
  },
  'customers.documents': {
    bg: 'Последни документи',
    en: 'Recent documents',
  },
  'customers.noDocuments': {
    bg: 'Още няма документи към този клиент.',
    en: 'No documents to this customer yet.',
  },
  'customers.toDocuments': {
    bg: 'Към сметки и фактури',
    en: 'To bills and invoices',
  },
  'payroll.ratesFrom': {
    bg: 'В сила от (месец, ГГГГ-ММ)',
    en: 'In effect from (month, YYYY-MM)',
  },
  'payroll.ratesFromHint': {
    bg: 'Ведомостите от по-ранни месеци остават със ставките от своето време.',
    en: 'Payrolls of earlier months keep the rates of their own time.',
  },
  'payroll.ratesFromInvalid': {
    bg: 'Въведи месеца като ГГГГ-ММ, например 2027-01.',
    en: 'Enter the month as YYYY-MM, e.g. 2027-01.',
  },
  'payroll.ratesVersion': {
    bg: 'В сила от {month}',
    en: 'In effect from {month}',
  },
  'payroll.ratesFromStart': {
    bg: 'Първоначални ставки',
    en: 'Initial rates',
  },
  'payroll.ratesDeleteConfirm': {
    bg: 'Да изтрия ли ставките в сила от {month}? Месеците след това минават на предишните.',
    en: 'Delete the rates in effect from {month}? The months after go back to the previous ones.',
  },
  'briefing.cta.payroll_rates_year': {
    bg: 'Провери ставките',
    en: 'Check the rates',
  },
  'home.bankRevenue': {
    bg: 'Приход по банка (фактури)',
    en: 'Income by bank (invoices)',
  },
  'stats.creditNotesLine': {
    bg: 'Кредитни известия: {count} (−{amount} €)',
    en: 'Credit notes: {count} (−{amount} €)',
  },
  'stats.assetsIncluded': {
    bg: 'вкл. покупки на активи {amount} € - те не са разход на деня си, а се амортизират',
    en: 'incl. asset purchases {amount} € - not an expense of their day, they are depreciated',
  },
  'stats.badgeCreditNote': {
    bg: 'КИ',
    en: 'CN',
  },
  'stats.badgeAsset': {
    bg: 'актив',
    en: 'asset',
  },
  'briefing.snooze': {
    bg: 'Отложи 3 дни',
    en: 'Snooze 3 days',
  },
  'briefing.done': {
    bg: 'Готово',
    en: 'Done',
  },
  'briefing.hide': {
    bg: 'Скрий',
    en: 'Hide',
  },
  'briefing.stillBuying': {
    bg: 'Да, още го купувам',
    en: 'Yes, still buying it',
  },
  'briefing.discontinue': {
    bg: 'Не, спрях го',
    en: 'No, I stopped',
  },
  'briefing.markPaid': {
    bg: 'Да, платени са',
    en: 'Yes, they are paid',
  },
  'briefing.markPaidConfirmTitle': {
    bg: 'Отбележи като платени?',
    en: 'Mark as paid?',
  },
  'briefing.markPaidConfirmBody': {
    bg: '{count} фактури ще бъдат отбелязани като изцяло платени. Можеш да промениш всяка от тях после.',
    en: '{count} invoices will be marked as fully paid. You can change each of them later.',
  },
  'briefing.markedPaid': {
    bg: 'Отбелязах {count} фактури като платени',
    en: 'Marked {count} invoices as paid',
  },
  'briefing.snoozed': {
    bg: 'Ще го видиш отново след 3 дни',
    en: "You'll see it again in 3 days",
  },
  'briefing.discontinued': {
    bg: 'Спрях напомнянията за този артикул, докато не го купиш отново',
    en: "No more reminders for this item until you buy it again",
  },
  // "Ask your own numbers" chat (Module 4 Finding #3) - plain-language Q&A
  // scoped strictly to the company's own stored data.
  'askMyNumbers.title': {
    bg: 'Попитай за числата си',
    en: 'Ask about your numbers',
  },
  'askMyNumbers.subtitle': {
    bg: 'Прост въпрос, отговор само по твоите данни',
    en: 'A plain question, answered only from your own data',
  },
  'askMyNumbers.disclaimer': {
    bg: 'Отговаря само по въведените данни на фирмата.',
    en: 'Answers only from the company\'s own data.',
  },
  'askMyNumbers.placeholder': {
    bg: 'Напиши въпрос...',
    en: 'Type a question...',
  },
  'askMyNumbers.emptyTitle': {
    bg: 'Питай с прости думи',
    en: 'Ask in plain language',
  },
  'askMyNumbers.suggestion1': {
    bg: 'Какви са най-големите ми разходи този месец?',
    en: 'What are my biggest expenses this month?',
  },
  'askMyNumbers.suggestion2': {
    bg: 'Сравни ме със миналия месец',
    en: 'Compare me to last month',
  },
  'askMyNumbers.suggestion3': {
    bg: 'Кой ми дължи пари?',
    en: 'Who owes me money?',
  },
  'askMyNumbers.suggestion4': {
    bg: 'Имам ли неплатени фактури към доставчици?',
    en: 'Do I have unpaid invoices to suppliers?',
  },
  'askMyNumbers.numbersTitle': {
    bg: 'Числата зад отговора',
    en: 'The numbers behind this answer',
  },
  'askMyNumbers.thisMonth': {
    bg: 'Този месец',
    en: 'This month',
  },
  'askMyNumbers.lastMonth': {
    bg: 'Миналия месец',
    en: 'Last month',
  },
  'askMyNumbers.revenue': {
    bg: 'Оборот',
    en: 'Revenue',
  },
  'askMyNumbers.expenses': {
    bg: 'Разходи',
    en: 'Expenses',
  },
  'askMyNumbers.profit': {
    bg: 'Печалба',
    en: 'Profit',
  },
  'askMyNumbers.profitHidden': {
    bg: 'скрита за теб',
    en: 'hidden from you',
  },
  'askMyNumbers.topExpenses': {
    bg: 'Най-големи разходи',
    en: 'Biggest expenses',
  },
  'askMyNumbers.unpaid': {
    bg: '{count} неплатени фактури ({overdue} просрочени) - {amount} €',
    en: '{count} unpaid invoices ({overdue} overdue) - {amount} €',
  },
  'askMyNumbers.receivables': {
    bg: '{count} неплатени вземания ({overdue} просрочени) - дължат ти {amount} €',
    en: '{count} unpaid receivables ({overdue} overdue) - customers owe you {amount} €',
  },
  'askMyNumbers.budget': {
    bg: 'Бюджет: {percent}% от {limit} €',
    en: 'Budget: {percent}% of {limit} €',
  },
  'askMyNumbers.vatDue': {
    bg: 'ДДС за внасяне този месец: {amount} €',
    en: 'VAT due this month: {amount} €',
  },
  'askMyNumbers.forecastRevenue': {
    bg: 'Прогноза приходи следващ месец: {amount} €{note}',
    en: 'Forecast revenue next month: {amount} €{note}',
  },
  'askMyNumbers.forecastExpenses': {
    bg: 'Прогноза разходи следващ месец: {amount} €{note}',
    en: 'Forecast expenses next month: {amount} €{note}',
  },
  'askMyNumbers.forecastInsufficientData': {
    bg: ' (малко история - просто средно)',
    en: ' (little history - plain average)',
  },
  'askMyNumbers.roi': {
    bg: 'Възвръщаемост: {roiPercent}% от вложени {investment} €',
    en: 'Return: {roiPercent}% on {investment} € put in',
  },
  'askMyNumbers.assets': {
    bg: 'Активи: {count} бр., балансова стойност {value} €',
    en: 'Assets: {count}, net book value {value} €',
  },
  'askMyNumbers.payroll': {
    bg: 'Персонал: {count} служители, разход {amount} €',
    en: 'Payroll: {count} employees, cost {amount} €',
  },
  'askMyNumbers.scanCredits': {
    bg: 'Остават {count} скана',
    en: '{count} scans remaining',
  },
  'askMyNumbers.priceAlerts': {
    bg: '{count} непрочетени ценови сигнала',
    en: '{count} unread price alerts',
  },
  'askMyNumbers.reorderNudge': {
    bg: '{item} - обичайно се поръчва на всеки {days} дни за ~{value} €, последно преди {since} дни. Препоръчано количество: ~{quantity} {unit}.',
    en: '{item} - usually reordered every {days} days for ~{value} €, last ordered {since} days ago. Suggested quantity: ~{quantity} {unit}.',
  },
  'askMyNumbers.itemPurchasesTitle': {
    bg: 'Най-големи разходи по артикул (цялата история)',
    en: 'Top items by spend (all-time)',
  },
  'askMyNumbers.itemPurchaseLine': {
    bg: '{item}: {quantity} {unit} за {spent} € ({count}x поръчано)',
    en: '{item}: {quantity} {unit} for {spent} € (ordered {count}x)',
  },
  'askMyNumbers.genericError': {
    bg: 'Нещо се обърка. Опитай отново.',
    en: 'Something went wrong. Try again.',
  },

  // Home Screen
  'dayCard.morning': { bg: 'Добро утро', en: 'Good morning' },
  'dayCard.day': { bg: 'Добър ден', en: 'Good afternoon' },
  'dayCard.evening': { bg: 'Добър вечер', en: 'Good evening' },
  'dayCard.night': { bg: 'Здравей', en: 'Hello' },
  'team.revenueHint': { bg: 'Въведи касата за деня', en: "Enter the day's till" },
  'dayCard.locate': { bg: 'Покажи времето тук', en: 'Show the weather here' },
  'dayCard.locateHint': {
    bg: 'С местоположението на устройството, закръглено до около 1 км – само за времето.',
    en: "With this device's location, rounded to about 1 km – for the weather only.",
  },
  'dayCard.locateFailed': { bg: 'Няма достъп до местоположението', en: 'No access to the location' },
  'dayCard.weatherLine': { bg: '{label}, {min}°–{max}° · {place}', en: '{label}, {min}°–{max}° · {place}' },
  'dayCard.effectLower': {
    bg: 'В дъждовни дни оборотът ти обикновено е с {percent}% по-нисък',
    en: 'On wet days your revenue is usually {percent}% lower',
  },
  'dayCard.effectHigher': {
    bg: 'В дъждовни дни оборотът ти обикновено е с {percent}% по-висок',
    en: 'On wet days your revenue is usually {percent}% higher',
  },
  'dayCard.attribution': { bg: 'Времето: {source}', en: 'Weather: {source}' },
  'birthday.title': { bg: 'Рожден ден', en: 'Birthday' },
  'birthday.notSet': { bg: 'Не е въведен', en: 'Not set' },
  'birthday.explain': {
    bg: 'Само ден и месец, никога годината. На този ден екипът го вижда на началния екран, а собственикът и управителят ти пращат поздрав. По желание – можеш да го махнеш по всяко време.',
    en: 'Day and month only, never the year. On the day the team sees it on the home screen and the owner and manager send you a greeting. Optional – you can remove it any time.',
  },
  'birthday.day': { bg: 'Ден', en: 'Day' },
  'birthday.month': { bg: 'Месец', en: 'Month' },
  'birthday.remove': { bg: 'Махни', en: 'Remove' },
  'birthday.invalid': { bg: 'Невалидна дата – провери деня и месеца.', en: 'Invalid date – check the day and month.' },
  'birthday.saved': { bg: 'Рожденият ден е запазен', en: 'Birthday saved' },
  'birthday.dayHint': { bg: 'ДД', en: 'DD' },
  'birthday.monthHint': { bg: 'ММ', en: 'MM' },
  'teamMoments.title': { bg: 'Поводи в екипа', en: 'Team moments' },
  'teamMoments.birthdays': { bg: 'Поздрав за рожден ден', en: 'Birthday greeting' },
  'teamMoments.birthdaysHint': {
    bg: 'На рождения ден на колега му идва съобщение от собственика и управителя.',
    en: "On a colleague's birthday they get a message from the owner and the manager.",
  },
  'teamMoments.holidays': { bg: 'Напомняне за празници', en: 'Holiday reminder' },
  'teamMoments.holidaysHint': {
    bg: 'Ден преди официален празник в екипния чат пише дали почивате или работите по график.',
    en: 'The day before a public holiday the team chat says whether you are closed or open as scheduled.',
  },
  'home.welcome': {
    bg: 'Добре дошли!',
    en: 'Welcome!',
  },
  'home.switchLanguage': {
    bg: 'Смяна на езика',
    en: 'Switch language',
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
  'home.scanReport': { bg: 'Снимай дневния отчет (Z)', en: 'Scan the daily report (Z)' },
  'home.scanReportHint': {
    bg: 'Снимайте дневния финансов отчет от касовия апарат - оборотът по ДДС групи, в брой и с карта се попълват сами. Проверете и запазете. Ползва едно сканиране.',
    en: 'Photograph the till\'s daily Z report - the revenue by VAT group, cash and card fill in by themselves. Check and save. Uses one scan.',
  },
  'home.zReportApplied': { bg: 'Попълнено от Z-отчет № {number} - проверете и запазете.', en: 'Filled in from Z report No. {number} - check and save.' },
  'home.zReportAppliedNoNumber': { bg: 'Попълнено от Z-отчета - проверете и запазете.', en: 'Filled in from the Z report - check and save.' },
  'home.zReportCheck': { bg: 'Проверете отчета', en: 'Check the report' },
  'home.ocrAdditionNote': {
    bg: 'Добавени {amount} € от сканирана издадена фактура към сумата за деня.',
    en: 'Added {amount} € from a scanned issued invoice to the day\'s total.',
  },
  'visibility.noStatistics': {
    bg: 'Общите суми на фирмата са скрити за вашия достъп.',
    en: 'The company totals are hidden for your access level.',
  },
  'visibility.pocketMoney': {
    bg: 'джобчето',
    en: 'pocket money',
  },
  'visibility.offBookExpenses': {
    bg: 'разходите без фактура',
    en: 'expenses without an invoice',
  },
  'visibility.payroll': {
    bg: 'заплатите',
    en: 'the payroll',
  },
  'visibility.listSeparator': {
    bg: ', ',
    en: ', ',
  },
  'visibility.and': {
    bg: ' и ',
    en: ' and ',
  },
  'visibility.totalsWithout': {
    bg: 'Сумите са без {items} - скрити са за вашия достъп.',
    en: 'The totals leave out {items} - hidden for your access level.',
  },
  'visibility.profitHidden': {
    bg: 'Печалбата е скрита за вашия достъп.',
    en: 'Profit is hidden for your access level.',
  },
  'visibility.profitWithout': {
    bg: 'Сумите и печалбата са без {items} (скрити за вашия достъп) - това не е действителната печалба на фирмата.',
    en: 'The totals and profit leave out {items} (hidden for your access level) - this is not the company\'s actual profit.',
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
    bg: 'средно за {days} дни с въведен оборот',
    en: 'average over {days} days with revenue entered',
  },
  'home.expectedPeriodEnd': {
    bg: 'Очакван край на периода: {amount}',
    en: 'Expected by the end of the period: {amount}',
  },
  'periodNav.soFar': {
    bg: 'Досега: {range}',
    en: 'So far: {range}',
  },
  // The till's and Джобче's revenue added up, under the number boxes.
  'stats.paymentKinds': { bg: 'Приходи по вид плащане', en: 'Income by payment kind' },
  'home.revenueSum': { bg: 'Оборот (фискален + джобче)', en: 'Revenue (fiscal + pocket)' },
  // A scanned invoice confirmed in one tap (Л6).
  'scanSummary.title': { bg: 'Прочетено от снимката', en: 'Read from the photo' },
  'scanSummary.creditNote': { bg: 'Кредитно известие', en: 'Credit note' },
  'scanSummary.amounts': { bg: 'без ДДС {net} € · ДДС {vat} €', en: 'net {net} € · VAT {vat} €' },
  'scanSummary.dueDate': { bg: 'до {date}', en: 'by {date}' },
  'scanSummary.itemsLabel': { bg: 'Артикули', en: 'Items' },
  'scanSummary.items': { bg: '{n} реда', en: '{n} lines' },
  'scanSummary.itemsOne': { bg: '1 ред', en: '1 line' },
  'scanSummary.pricesUp': { bg: '{n} поскъпнали', en: '{n} went up' },
  'scanSummary.checkSums': { bg: 'Сумите не се връзват - прегледайте ги', en: "The amounts don't add up - check them" },
  'scanSummary.dateNotRead': { bg: 'не се прочете', en: 'not read' },
  'scanSummary.edit': { bg: 'Редактирай всички полета', en: 'Edit all fields' },
  // The first start: one question (Л5).
  'start.question': { bg: 'С какво работите?', en: 'What do you work with?' },
  'start.subtitle': { bg: 'Отбележете каквото ползвате - програмата ще показва само него.', en: 'Tick what you use - the app will show just that.' },
  'start.till': { bg: 'Каса (касов апарат)', en: 'A till (cash register)' },
  'start.tillHint': { bg: 'дневен оборот и джобче', en: 'daily revenue and pocket money' },
  'start.billing': { bg: 'Фактури към клиенти', en: 'Invoices to customers' },
  'start.billingHint': { bg: 'издаване, вземания, оферти', en: 'issuing, receivables, quotes' },
  'start.team': { bg: 'Служители', en: 'Employees' },
  'start.teamHint': { bg: 'график, заплати, отпуски', en: 'schedule, payroll, leave' },
  'start.vat': { bg: 'Регистрирани по ДДС', en: 'VAT registered' },
  'start.vatHint': { bg: 'ДДС за плащане и фактури с ДДС', en: 'VAT to pay and invoices with VAT' },
  'start.done': { bg: 'Готово', en: 'Done' },
  'start.later': { bg: 'Всичко се променя после от Акаунт → Фирма.', en: 'Change any of it later in Account → Company.' },
  'start.skip': { bg: 'Пропусни', en: 'Skip' },
  // An empty Home says where to start.
  'startHere.title': { bg: 'Започни оттук', en: 'Start here' },
  'startHere.revenue': { bg: 'Въведете оборота за деня', en: "Enter the day's revenue" },
  'startHere.invoice': { bg: 'Снимайте фактура от доставчик', en: 'Photograph a supplier invoice' },
  'startHere.issued': { bg: 'Издайте фактура към клиент', en: 'Issue an invoice to a customer' },
  'startHere.hide': { bg: 'Скрий', en: 'Hide' },
  // What a screen does, once, the first time it is opened.
  'hint.invoices': { bg: 'Докоснете фактура, за да я платите.', en: 'Tap an invoice to pay it.' },
  'hint.stats': { bg: 'Периодът е общ с Главната.', en: 'The period is shared with Home.' },
  // The invoices' header in one row (Л13).
  'invoices.eikChip': { bg: 'без ЕИК', en: 'no EIK' },
  // Shorter texts, the owner's words (Л10).
  'common.howItWorks': { bg: 'Как се смята', en: 'How it works' },
  'invoices.deletedRestorable': { bg: 'Фактурата е изтрита — може да я върнете от Дневника на действията.', en: 'Invoice deleted - you can bring it back from the audit log.' },
  'home.pocketHint': { bg: 'Оборот извън касовия апарат — не влиза в ДДС', en: 'Revenue outside the till - not in VAT' },
  'expenses.subtitle': { bg: 'Разход без фактура — в брой, дребни покупки', en: 'An expense without an invoice - cash, small purchases' },
  // Statistics without repeats (Л9): the month's costs under the expense chart.
  'stats.monthlyPayroll': { bg: 'заплати {amount}', en: 'salaries {amount}' },
  'stats.monthlyDepreciation': { bg: 'амортизация {amount}', en: 'depreciation {amount}' },
  'stats.monthlyCostsBoth': { bg: 'заплати и амортизация {amount}', en: 'salaries and depreciation {amount}' },
  'stats.and': { bg: ' и ', en: ' and ' },
  'stats.monthlyCostsApart': { bg: '{costs} за периода — разход на месеца, не на отделен ден.', en: '{costs} for the period - a cost of the month, not of a single day.' },
  'stats.monthlyCostsIncluded': { bg: 'В това число {costs}.', en: 'Of which {costs}.' },
  // One place per function (Л8).
  'home.askPlaceholder': { bg: 'Попитайте за числата си…', en: 'Ask about your numbers…' },
  'stats.cashFlowSection': { bg: 'какво влиза и излиза в следващите седмици', en: 'what comes in and goes out in the weeks ahead' },
  'stats.accountantPackSection': { bg: 'всичко за счетоводителя за месеца', en: "everything for the accountant for the month" },
  // Home's actions, each with a word on what it records.
  'home.actionRevenueHint': { bg: 'каса и джобче', en: 'till and pocket' },
  'home.actionExpenseHint': { bg: 'без фактура', en: 'no invoice' },
  'home.actionInvoice': { bg: 'Фактура', en: 'Invoice' },
  'home.actionInvoiceHint': { bg: 'към клиент', en: 'to a customer' },
  'home.importRevenueShort': { bg: 'Минали дни от Excel', en: 'Past days from Excel' },
  'home.importExpensesShort': { bg: 'Минали разходи от Excel', en: 'Past expenses from Excel' },
  'home.expenses': {
    bg: 'В канала',
    en: 'Expenses',
  },
  'home.fiscal': {
    bg: 'Фискален',
    en: 'Fiscal',
  },
  'historyHub.title': {
    bg: 'История и справки',
    en: 'History & records',
  },
  'historyHub.subtitle': {
    bg: 'Всичко на едно място - кредити, разходи, джобче, клиенти',
    en: 'Everything in one place - credits, expenses, pocket money, customers',
  },
  'historyHub.scanCreditsDesc': {
    bg: 'Баланс и история на кредитите за сканиране',
    en: 'Scan-credit balance and transaction history',
  },
  'historyHub.offBookExpensesDesc': {
    bg: 'История на разходите „в канала"',
    en: 'Off-book expense history',
  },
  'historyHub.pocketMoneyDesc': {
    bg: 'История на Джобчето по дни',
    en: 'Day-by-day pocket-money history',
  },
  'historyHub.personalNotebook': {
    bg: 'Лично тефтерче и вложения',
    en: 'Personal wallet and investments',
  },
  'historyHub.personalExpensesDesc': {
    bg: 'Взетото от фирмата за лични нужди и вложеното в нея',
    en: 'What was taken from the business for personal needs, and what was put in',
  },
  'pocketMoney.historyTitle': {
    bg: 'История на Джобчето',
    en: 'Pocket money history',
  },
  'pocketMoney.empty': {
    bg: 'Няма записи с Джобче за този период',
    en: 'No pocket-money entries for this period',
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
    bg: 'Приход в брой',
    en: 'Cash income',
  },
  'home.cardRevenue': {
    bg: 'Приход с карта',
    en: 'Card income',
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
  // The day's total beside the quick fills of the revenue form.
  'home.dayTotal': { bg: 'Общо за деня', en: 'Day total' },
  'home.dayTotalWithoutPocket': { bg: 'Общо без джобче', en: 'Total without pocket' },
  'home.withoutPocket': { bg: 'без джобче', en: 'without pocket' },
  'home.sameAsYesterday': {
    bg: 'Както вчера',
    en: 'Same as yesterday',
  },
  'home.sameAsYesterdayEmpty': {
    bg: 'Няма записан оборот за вчера',
    en: 'No revenue logged for yesterday',
  },
  'home.sameAsYesterdayApplied': {
    bg: 'Попълнено от вчерашния оборот',
    en: "Filled in from yesterday's revenue",
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
  'home.vatSplitAction': {
    bg: 'Денят е с продажби по различни ставки',
    en: 'The day has sales at different rates',
  },
  'home.vatByRate': {
    bg: 'Фискализиран оборот по ставки ДДС',
    en: 'Fiscal revenue by VAT rate',
  },
  'home.vatByRateHint': {
    bg: 'Както е в дневния отчет на касата - групите с еднаква ставка се събират.',
    en: "As the till's daily report shows it - groups with the same rate are added together.",
  },
  'home.vatRateAmount': {
    bg: 'Оборот {rate}%',
    en: 'Revenue at {rate}%',
  },
  'home.vatByRateTotal': {
    bg: 'Общо фискализиран оборот: {amount} €',
    en: 'Fiscal revenue in total: {amount} €',
  },
  'home.vatOneRate': {
    bg: 'Една ставка за целия ден',
    en: 'One rate for the whole day',
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
    bg: 'В канала',
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
  'expenses.history': {
    bg: 'История',
    en: 'History',
  },
  'expenses.recentDescriptions': {
    bg: 'Скорошни',
    en: 'Recent',
  },
  'expenses.duplicateTitle': {
    bg: 'Възможно повторение',
    en: 'Possible duplicate',
  },
  'expenses.duplicateMessage': {
    bg: 'Вече имаш разход „{description}“ за този ден - сигурен ли си, че искаш да добавиш още един?',
    en: 'You already have an expense "{description}" for this day - are you sure you want to add another one?',
  },
  'expenses.addAnyway': {
    bg: 'Добави пак',
    en: 'Add anyway',
  },
  'expenses.historyTitle': {
    bg: 'История на В канала',
    en: 'Off-book expenses history',
  },
  'receivables.title': {
    bg: 'Кой ми дължи',
    en: 'Who owes me',
  },
  'receivables.add': {
    bg: 'Добави',
    en: 'Add',
  },
  'receivables.addNew': {
    bg: 'Нов запис',
    en: 'New entry',
  },
  'receivables.editTitle': {
    bg: 'Редактирай записа',
    en: 'Edit entry',
  },
  'receivables.filterAll': {
    bg: 'Всички',
    en: 'All',
  },
  'receivables.filterUnpaid': {
    bg: 'Неплатени',
    en: 'Unpaid',
  },
  'receivables.filterOverdue': {
    bg: 'Просрочени',
    en: 'Overdue',
  },
  'receivables.filterPaid': {
    bg: 'Платени',
    en: 'Paid',
  },
  'receivables.totalOwed': {
    bg: 'Дължимо общо',
    en: 'Total owed',
  },
  'receivables.overdueCount': {
    bg: 'Просрочени',
    en: 'Overdue',
  },
  'receivables.customerName': {
    bg: 'Клиент',
    en: 'Customer',
  },
  'receivables.customerNamePlaceholder': {
    bg: 'Име на клиента',
    en: "Customer's name",
  },
  'receivables.amount': {
    bg: 'Сума',
    en: 'Amount',
  },
  'receivables.description': {
    bg: 'Описание',
    en: 'Description',
  },
  'receivables.descriptionPlaceholder': {
    bg: 'За какво е (незадължително)',
    en: 'What it was for (optional)',
  },
  'receivables.dueDate': {
    bg: 'Падеж',
    en: 'Due date',
  },
  'receivables.noDueDate': {
    bg: 'Без падеж',
    en: 'No due date',
  },
  'receivables.dueLabel': {
    bg: 'Падеж',
    en: 'Due',
  },
  'receivables.paidLabel': {
    bg: 'Платено',
    en: 'Paid',
  },
  'receivables.empty': {
    bg: 'Няма записи - добави първия с бутона горе',
    en: 'No entries yet - add the first one above',
  },
  'receivables.saved': {
    bg: 'Записът е добавен',
    en: 'Entry saved',
  },
  'receivables.updated': {
    bg: 'Записът е обновен',
    en: 'Entry updated',
  },
  'receivables.markedPaid': {
    bg: 'Отбелязано като платено',
    en: 'Marked as paid',
  },
  'receivables.paymentTitle': { bg: 'Получено плащане', en: 'Payment received' },
  'receivables.paymentAmount': { bg: 'Сума', en: 'Amount' },
  'receivables.paymentDate': { bg: 'Дата на плащане', en: 'Payment date' },
  'receivables.recordPayment': { bg: 'Запиши плащането', en: 'Record payment' },
  'receivables.leftToPay': { bg: 'остават {left} €', en: '{left} € left' },
  'receivables.creditedLine': { bg: 'Кредитни известия: −{amount} €', en: 'Credit notes: −{amount} €' },
  'receivables.refundDue': { bg: 'За връщане на клиента: {amount} €', en: 'To give back to the customer: {amount} €' },
  'receivables.cancelledLabel': { bg: 'Анулирана', en: 'Cancelled' },
  'receivables.lockedByInvoice': {
    bg: 'Сумата и клиентът са по фактурата - променят се с кредитно известие или анулиране.',
    en: "The amount and customer are the invoice's - a credit note or cancelling it changes them.",
  },
  'billingDocuments.statusPaid': { bg: 'Платена', en: 'Paid' },
  'billingDocuments.statusPartlyPaid': { bg: 'Платени {paid} · остават {left} €', en: '{paid} paid · {left} € left' },
  'billingDocuments.statusOwed': { bg: 'Дължима', en: 'Owed' },
  'billingDocuments.statusOverdue': { bg: 'Просрочена · {left} €', en: 'Overdue · {left} €' },
  'billingDocuments.statusCredited': { bg: 'Кредитирана', en: 'Credited' },
  'billingDocuments.refundDue': { bg: 'За връщане {amount} €', en: 'To give back {amount} €' },
  'billingDocuments.deletedReceivableKept': {
    bg: 'Сметката е изтрита. По вземането вече има плащане, затова то остава.',
    en: 'Bill deleted. Its receivable already has a payment, so it stays.',
  },
  'billingDocuments.typeCreditNote': { bg: 'КИ', en: 'CN' },
  'billingDocuments.quoteValidFor': { bg: 'Валидна', en: 'Valid for' },
  'billingDocuments.quoteDays': { bg: '{days} дни', en: '{days} days' },
  'billingDocuments.quoteOpenUntil': { bg: 'Валидна до {date}', en: 'Valid until {date}' },
  'billingDocuments.quoteExpired': { bg: 'Изтекла', en: 'Expired' },
  'billingDocuments.quoteAccepted': { bg: 'Приета', en: 'Accepted' },
  'billingDocuments.quoteDeclined': { bg: 'Отказана', en: 'Declined' },
  'billingDocuments.quoteMarkAccepted': { bg: 'Приета', en: 'Accepted' },
  'billingDocuments.quoteMarkDeclined': { bg: 'Отказана', en: 'Declined' },
  'billingDocuments.quoteToBill': { bg: '→ Сметка', en: '→ Bill' },
  'billingDocuments.quoteToInvoice': { bg: '→ Фактура', en: '→ Invoice' },
  'billingDocuments.fromQuote': { bg: 'От оферта за {amount} €', en: 'From a quote of {amount} €' },
  'billingDocuments.fromQuoteDiffers': {
    bg: 'Офертата е за {quote} €, а фактурата ще е за {total} € - цените във фактурата са без ДДС. Проверете ги.',
    en: 'The quote was {quote} €, the invoice will be {total} € - invoice prices are before VAT. Check them.',
  },
  'billingDocuments.creditNoteAction': { bg: 'Кредитно известие', en: 'Credit note' },
  'billingDocuments.creditNoteTitle': { bg: 'Кредитно известие към фактура № {number}', en: 'Credit note to invoice No. {number}' },
  'billingDocuments.creditNoteHint': {
    bg: 'Намалява прихода и ДДС на датата си и дължимото по фактурата. Може да се кредитират още {left} €.',
    en: 'Takes revenue and VAT off on its date, and off what is owed on the invoice. Up to {left} € more can be credited.',
  },
  'billingDocuments.creditNoteReason': { bg: 'Основание', en: 'Reason' },
  'billingDocuments.creditNoteReasonPlaceholder': { bg: 'Напр. отстъпка, върната стока', en: 'E.g. a discount, goods returned' },
  'billingDocuments.creditNoteSaved': { bg: 'Кредитно известие № {number} е издадено', en: 'Credit note No. {number} issued' },
  'billingDocuments.creditNoteTo': { bg: 'към фактура № {number}', en: 'to invoice No. {number}' },
  'billingDocuments.creditedLine': { bg: 'Кредитирана с {amount} €', en: 'Credited by {amount} €' },
  'billingDocuments.creditNoteDeleteConfirm': {
    bg: 'Да анулирам ли кредитното известие? Фактурата отново ще се дължи изцяло.',
    en: 'Cancel this credit note? The invoice will be owed in full again.',
  },
  'billingDocuments.refundAfterCancel': {
    bg: 'По нея вече е платено {amount} €. Нищо не се дължи повече, а платеното е за връщане на клиента (или прихващане) - вижда се във Вземания.',
    en: '{amount} € was already paid on it. Nothing is owed any more, and what was paid is the customer\'s to get back (or offset) - see Receivables.',
  },
  'receivables.paidSoFar': { bg: 'Платени {paid} € · остават {left} €', en: '{paid} € paid · {left} € left' },
  'receivables.partPaid': { bg: 'Частичното плащане е записано', en: 'Part payment recorded' },
  'receivables.logAsRevenueHintDay': {
    bg: '{name} плати {amount} € в брой. Да го добавя ли към джобчето за {date}?',
    en: '{name} paid {amount} € in cash. Add it to the pocket money for {date}?',
  },
  'receivables.logAsRevenueTitle': {
    bg: 'Добави ли го и в дневния оборот?',
    en: 'Log it as revenue too?',
  },
  'receivables.logAsRevenueHint': {
    bg: '{amount} € от {name} - да ги добавим ли към джобните пари за днес?',
    en: '{amount} € from {name} - add it to today\'s pocket money revenue?',
  },
  'receivables.logAsRevenueSkip': {
    bg: 'Не сега',
    en: 'Not now',
  },
  'receivables.logAsRevenueConfirm': {
    bg: 'Добави',
    en: 'Add it',
  },
  'receivables.logAsRevenueSuccess': {
    bg: 'Добавено към дневния оборот',
    en: 'Added to daily revenue',
  },
  'receivables.deleted': {
    bg: 'Записът е изтрит',
    en: 'Entry deleted',
  },
  'receivables.deleteConfirm': {
    bg: 'Да изтрия ли този запис?',
    en: 'Delete this entry?',
  },
  'billingDocuments.title': {
    bg: 'Фактури, оферти и сметки',
    en: 'Invoices, quotes & bills',
  },
  'billingDocuments.add': {
    bg: 'Добави',
    en: 'Add',
  },
  'billingDocuments.addNew': {
    bg: 'Нов документ',
    en: 'New document',
  },
  'billingDocuments.typeInvoice': {
    bg: 'Фактура',
    en: 'Invoice',
  },
  'billingDocuments.invoiceSaved': {
    bg: 'Фактура № {number} е издадена',
    en: 'Invoice No. {number} issued',
  },
  'billingDocuments.invoiceDeleteConfirm': {
    bg: 'Последната издадена фактура се изтрива. По-ранна се анулира: номерът ѝ остава, а сумата ѝ вече не е приход и ДДС.',
    en: 'The last invoice issued is deleted. An earlier one is cancelled: its number stays, and its amount no longer counts as revenue and VAT.',
  },
  'billingDocuments.invoiceCancelled': {
    bg: 'Фактурата е анулирана - номерът ѝ остава',
    en: 'Invoice cancelled - its number stays',
  },
  'billingDocuments.cancelled': {
    bg: 'Анулирана',
    en: 'Cancelled',
  },
  'billingDocuments.invoiceHint': {
    bg: 'Фактура към клиент: пореден номер, ДДС за всеки ред, приход и ДДС на датата на издаване. Данните на доставчика в PDF-а са от профила на фирмата.',
    en: 'An invoice to a customer: the next number, VAT on each line, revenue and VAT on the issue date. The supplier details on the PDF come from the company profile.',
  },
  'billingDocuments.customerEik': {
    bg: 'ЕИК на клиента',
    en: 'Customer EIK',
  },
  'billingDocuments.customerAddress': {
    bg: 'Адрес на клиента',
    en: 'Customer address',
  },
  'billingDocuments.invoiceOwed': {
    bg: 'Клиентът я плаща до 14 дни - вземането се появява във „Вземания“ и плащането по него не се брои втори път като приход.',
    en: 'The customer pays within 14 days - it shows under Receivables, and the payment is not counted as revenue a second time.',
  },
  'billingDocuments.invoicePaidNow': {
    bg: 'Платена при издаването - не остава вземане.',
    en: 'Paid when issued - nothing left owed.',
  },
  'billingDocuments.startNumber': {
    bg: 'Номер на тази фактура (по избор - ако продължавате своя номерация)',
    en: 'Number of this invoice (optional - to continue your own numbering)',
  },
  'billingDocuments.priceWithoutVat': {
    bg: 'Цена без ДДС',
    en: 'Price excl. VAT',
  },
  'billingDocuments.vatExemptNote': {
    bg: 'Фирмата не е регистрирана по ЗДДС: фактурата се издава без ДДС, с основание чл. 113, ал. 9 ЗДДС.',
    en: 'The business is not registered for VAT: the invoice is issued without VAT, citing Art. 113(9) VAT Act.',
  },
  'billingDocuments.vatRate': {
    bg: 'ДДС %',
    en: 'VAT %',
  },
  'billingDocuments.netAndVat': {
    bg: 'Основа {net} € + ДДС {vat} €',
    en: 'Base {net} € + VAT {vat} €',
  },
  'billingDocuments.typeBill': {
    bg: 'Сметка',
    en: 'Bill',
  },
  'billingDocuments.typeQuote': {
    bg: 'Оферта',
    en: 'Quote',
  },
  'billingDocuments.items': {
    bg: 'Артикули/услуги',
    en: 'Items/services',
  },
  'billingDocuments.addItem': {
    bg: 'Добави ред',
    en: 'Add row',
  },
  'billingDocuments.itemsRequired': {
    bg: 'Добави поне един артикул с валидна цена',
    en: 'Add at least one item with a valid price',
  },
  'billingDocuments.empty': {
    bg: 'Няма фактури, оферти или сметки още - добави първата с бутона горе',
    en: 'No invoices, quotes or bills yet - add the first one above',
  },
  'billingDocuments.billSaved': {
    bg: 'Сметката е записана',
    en: 'Bill saved',
  },
  'billingDocuments.quoteSaved': {
    bg: 'Офертата е записана',
    en: 'Quote saved',
  },
  'billingDocuments.deleted': {
    bg: 'Документът е изтрит',
    en: 'Document deleted',
  },
  'billingDocuments.deleteConfirm': {
    bg: 'Да изтрия ли този документ?',
    en: 'Delete this document?',
  },
  'billingDocuments.downloadError': {
    bg: 'Грешка при изтегляне на PDF',
    en: 'Error downloading the PDF',
  },
  'expenses.searchPlaceholder': {
    bg: 'Търси по описание...',
    en: 'Search by description...',
  },
  'expenses.periodAll': {
    bg: 'Всички',
    en: 'All',
  },
  'expenses.periodThisMonth': {
    bg: 'Този месец',
    en: 'This month',
  },
  'expenses.periodLastMonth': {
    bg: 'Миналия месец',
    en: 'Last month',
  },
  'expenses.empty': {
    bg: 'Няма записани разходи',
    en: 'No expenses recorded',
  },
  'expenses.editExpense': {
    bg: 'Редакция на разход',
    en: 'Edit expense',
  },
  'expenses.expenseUpdated': {
    bg: 'Разходът е обновен',
    en: 'Expense updated',
  },
  'expenses.expenseDeleted': {
    bg: 'Разходът е изтрит',
    en: 'Expense deleted',
  },
  'expenses.totalLabel': {
    bg: 'Общо',
    en: 'Total',
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
    bg: 'Издадена фактура',
    en: 'Issued invoice',
  },
  'scan.salesFormTitle': {
    bg: 'Обобщение на продажбата',
    en: 'Sale summary',
  },
  'scan.salesFormHint': {
    bg: 'Проверете клиента, номера, сумата и датата преди да запишете',
    en: 'Check the customer, number, amount and date before saving',
  },
  'scan.salesNote': {
    bg: 'Фактура, издадена от вас в друга програма: записва се като издадена фактура със своя номер - приход за датата си. Платена в брой или с карта през касата, тя вече е в оборота за деня и не се брои втори път.',
    en: 'An invoice you issued in another program: saved as an issued invoice with its own number - income of its date. Paid in cash or by card through the till, it is in that day\'s till revenue already and is not counted twice.',
  },
  'scan.saveSalesInvoice': {
    bg: 'Запиши издадената фактура',
    en: 'Save the issued invoice',
  },
  'scan.salesTipsTitle': {
    bg: 'Какво прави сканирането тук',
    en: 'What scanning does here',
  },
  'scan.salesTip1': {
    bg: 'Разпознава клиента, номера, сумата и ДДС ставката от издадената фактура',
    en: 'Recognizes the customer, number, amount and VAT rate from the issued invoice',
  },
  'scan.salesTip2': {
    bg: 'Записва я при издадените фактури - без да я добавя към оборота на касата',
    en: 'Saves it with the issued invoices - without adding it to the till revenue',
  },
  'scan.salesTipsFooter': {
    bg: 'Само за фактури, издадени от вас към клиенти в друга програма.',
    en: 'For invoices you issued to customers in another program only.',
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
    bg: 'Обща сума, ДДС и вид ДДС (стандартна ставка, намалена, обратно начисляване...)',
    en: 'Total amount, VAT and VAT type (standard rate, reduced, reverse charge...)',
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
    bg: 'Вид ДДС',
    en: 'VAT type',
  },
  'scan.reverseChargeNote': {
    bg: 'При запис ще се генерира автоматично номер на протокол по чл.117 ЗДДС, който трябва да се издаде до 15 дни от датата на доставката.',
    en: 'Saving will auto-assign an Art. 117 self-billing protocol number, due within 15 days of the supply date.',
  },
  'scan.protocolAssigned': {
    bg: 'Издаден протокол по чл.117 №',
    en: 'Issued Art. 117 protocol No.',
  },
  'scan.documentType': {
    bg: 'Вид документ',
    en: 'Document type',
  },
  'scan.documentType.invoice': {
    bg: 'Фактура',
    en: 'Invoice',
  },
  'scan.documentType.credit_note': {
    bg: 'Кредитно известие',
    en: 'Credit note',
  },
  'scan.creditNoteNote': {
    bg: 'Въведете сумите както са отпечатани - известието намалява покупките и ДДС кредита. Нищо не се дължи по него.',
    en: 'Enter the amounts as printed - the note takes purchases and the VAT credit down. Nothing is owed on it.',
  },
  'scan.creditNoteSaved': {
    bg: 'Кредитното известие е запазено',
    en: 'Credit note saved',
  },
  'invoices.creditNote': {
    bg: 'Кредитно известие',
    en: 'Credit note',
  },
  'invoices.creditNoteSettled': {
    bg: 'Намалява покупките - нищо не се дължи',
    en: 'Takes purchases down - nothing owed',
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
  'scan.paymentMethod.card': {
    bg: 'С карта',
    en: 'Card',
  },
  'scan.cashAutoPaidNote': {
    bg: 'Платеното в брой или с карта се маркира автоматично като платено.',
    en: 'Cash and card payments are automatically marked as paid.',
  },
  'scan.paymentMethodRequired': {
    bg: 'Избери начин на плащане – от него зависи дали фактурата е платена или се дължи.',
    en: 'Choose the payment method – it decides whether the invoice is paid or still owed.',
  },
  'scan.paymentMethodFromInvoice': {
    bg: 'Разчетено от фактурата.',
    en: 'Read from the invoice.',
  },
  'scan.paymentDueDateDefault': {
    bg: 'Срок за плащане (по подразбиране 14 дни)',
    en: 'Payment due date (defaults to 14 days)',
  },
  'scan.dateNotFoundNote': {
    bg: 'AI не откри дата на фактурата - моля, проверете и въведете я ръчно.',
    en: "AI couldn't find a date on the invoice - please check and enter it manually.",
  },
  'scan.paymentMethodNotDetectedNote': {
    bg: 'Открита е дата за падеж, но начинът на плащане не е ясен - моля, изберете ръчно.',
    en: "A due date was found, but the payment method isn't clear - please choose manually.",
  },
  'scan.cameraError': {
    bg: 'Не можах да заснема снимка',
    en: 'Could not take photo',
  },
  'scan.scanError': {
    bg: 'Грешка при сканиране',
    en: 'Scan error',
  },
  'scan.tryAgain': {
    bg: 'Моля, опитайте отново',
    en: 'Please try again',
  },
  'scan.subtitle': {
    bg: 'Снимайте фактура — попълва се сама',
    en: 'Photograph an invoice - it fills itself in',
  },
  'scan.useCameraHint': {
    bg: 'снимайте фактурата сега',
    en: 'photograph the invoice now',
  },
  'scan.fromGalleryHint': {
    bg: 'вече направена снимка',
    en: 'a photo you already took',
  },
  'scan.invoiceWithPages': {
    bg: 'Фактура с {count} страници',
    en: 'Invoice with {count} pages',
  },
  'scan.removePage': {
    bg: 'Премахни страницата',
    en: 'Remove page',
  },
  'scan.invoiceDataTitle': {
    bg: 'Данни от фактурата',
    en: 'Invoice Data',
  },
  'scan.editIfNeeded': {
    bg: 'Редактирайте при нужда',
    en: 'Edit if needed',
  },
  'scan.aiCorrections': {
    bg: 'AI корекции',
    en: 'AI Corrections',
  },
  'scan.companyNamePlaceholder': {
    bg: 'Име на фирмата',
    en: 'Company name',
  },
  'scan.productsItemsLabel': {
    bg: 'Продукти/артикули',
    en: 'Products/items',
  },
  'scan.addShort': {
    bg: 'Добави',
    en: 'Add',
  },
  'scan.noProductsRecognized': {
    bg: 'Няма разпознати продукти. Добавете ги ръчно при нужда.',
    en: 'No products recognized. Add them manually if needed.',
  },
  'scan.productNamePlaceholder': {
    bg: 'Име на продукта',
    en: 'Product name',
  },
  'scan.qtyPlaceholder': {
    bg: 'Бр.',
    en: 'Qty',
  },
  'scan.unitPlaceholder': {
    bg: 'Мярка',
    en: 'Unit',
  },
  'scan.pricePlaceholder': {
    bg: 'Цена',
    en: 'Price',
  },
  'scan.notesPlaceholder': {
    bg: 'Допълнителни бележки...',
    en: 'Additional notes...',
  },

  // Scan credits - the app's only paid feature (see ScanCreditService on
  // the backend). Package names come from the backend as plain Bulgarian
  // strings; the screen maps a package's id through packageName* below
  // for display instead, so English mode doesn't show Bulgarian labels.
  'scanCredits.title': {
    bg: 'Кредити за сканиране',
    en: 'Scan Credits',
  },
  'scanCredits.totalRemaining': {
    bg: 'сканирания общо оставащи',
    en: 'scans remaining in total',
  },
  'scanCredits.includesPurchased': {
    bg: 'вкл. {count} закупени · никога не изтичат',
    en: 'incl. {count} purchased · never expire',
  },
  'scanCredits.freeOfQuota': {
    bg: '{used}/{quota} безплатни',
    en: '{used}/{quota} free',
  },
  'scanCredits.freeLabel': {
    bg: 'безплатни',
    en: 'free',
  },
  'scanCredits.freeRenewOn': {
    bg: 'безплатните се подновяват на 1-во число',
    en: 'the free quota renews on the 1st',
  },
  'scanCredits.depletionForecast': {
    bg: 'При този темп ще ти стигнат за около {days} дни',
    en: 'At this pace, that\'s about {days} days left',
  },
  'scanCredits.depletionNow': {
    bg: 'При този темп кредитите ти вече са на привършване',
    en: 'At this pace, your credits are about to run out',
  },
  'scanCredits.recentTransactions': {
    bg: 'Последни транзакции',
    en: 'Recent transactions',
  },
  'scanCredits.viewAll': {
    bg: 'Виж всички',
    en: 'View all',
  },
  'scanCredits.downloadHistory': {
    bg: 'Изтегли история (Excel)',
    en: 'Download history (Excel)',
  },
  'scanCredits.noTransactionsYet': {
    bg: 'Все още няма транзакции',
    en: 'No transactions yet',
  },
  'scanCredits.transactionScanUsed': {
    bg: 'Сканиране на фактура',
    en: 'Invoice scan',
  },
  'scanCredits.transactionPurchase': {
    bg: 'Покупка',
    en: 'Purchase',
  },
  'scanCredits.reloadButton': {
    bg: 'Презареди кредити за сканиране',
    en: 'Top up scan credits',
  },
  'scanCredits.reloadButtonWithCount': {
    bg: 'Остават {count} сканирания · Презареди',
    en: '{count} scans left · Top up',
  },
  'scanCredits.buyPackages': {
    bg: 'Купи пакет сканирания',
    en: 'Buy a scan package',
  },
  'scanCredits.bestValue': {
    bg: 'НАЙ-ИЗГОДНО',
    en: 'BEST VALUE',
  },
  'scanCredits.buy': {
    bg: 'Купи',
    en: 'Buy',
  },
  'scanCredits.perScan': {
    bg: '{price} €/бр.',
    en: '€{price}/scan',
  },
  'scanCredits.packageLineWithBonus': {
    bg: '{name} — {paid} + {bonus} бонус = {total}',
    en: '{name} — {paid} + {bonus} bonus = {total}',
  },
  'scanCredits.packageLineNoBonus': {
    bg: '{name} — {total} сканирания',
    en: '{name} — {total} scans',
  },
  'scanCredits.packageNameSmall': { bg: 'Малък', en: 'Small' },
  'scanCredits.packageNameMedium': { bg: 'Среден', en: 'Medium' },
  'scanCredits.packageNameLarge': { bg: 'Голям', en: 'Large' },
  'scanCredits.packageNameBusiness': { bg: 'Бизнес', en: 'Business' },
  'scanCredits.customAmount': {
    bg: 'Персонализирано количество',
    en: 'Custom amount',
  },
  'scanCredits.customAmountHint': {
    bg: 'До 1000 сканирания, цена на стъпки като пакетите',
    en: 'Up to 1000 scans, priced in brackets like the packages',
  },
  'scanCredits.quantityLabel': {
    bg: 'Брой:',
    en: 'Quantity:',
  },
  'scanCredits.buyThisAmount': {
    bg: 'Купи това количество',
    en: 'Buy this amount',
  },
  'scanCredits.autoReload': {
    bg: 'Автоматично презареждане',
    en: 'Auto-reload',
  },
  'scanCredits.autoReloadHint': {
    bg: 'Избираш пакет, който се купува автоматично всеки месец в деня на абонамента ти. Спираш по всяко време с един клик — без въпроси.',
    en: 'Pick a package that is purchased automatically every month, on the day you subscribed. Stop any time with one click — no questions asked.',
  },
  'scanCredits.autoReloadActiveWith': {
    bg: 'Активно: {name} ({count} сканирания/месец)',
    en: 'Active: {name} ({count} scans/month)',
  },
  'scanCredits.stopAutoReload': {
    bg: 'Спри автоматичното презареждане',
    en: 'Stop auto-reload',
  },
  'scanCredits.chooseAutoReloadPackage': {
    bg: 'Избери пакет за автоматично презареждане',
    en: 'Choose a package for auto-reload',
  },
  'scanCredits.noScansLeft': {
    bg: 'Нямаш оставащи сканирания',
    en: 'No scans remaining',
  },
  'scanCredits.noScansLeftBody': {
    bg: 'Безплатните се подновяват на 1-во число. Купи пакет сега, за да продължиш да сканираш днес.',
    en: 'The free quota renews on the 1st. Buy a package now to keep scanning today.',
  },
  'scanCredits.outOfScansBanner': {
    bg: 'Свършиха безплатните сканирания за този месец — купи пакет, за да продължиш.',
    en: 'You’re out of free scans this month — buy a package to continue.',
  },
  'scanCredits.goToPackages': {
    bg: 'Виж пакети',
    en: 'View packages',
  },
  'scanCredits.close': {
    bg: 'Затвори',
    en: 'Close',
  },
  'scanCredits.loadError': {
    bg: 'Грешка при зареждане на баланса',
    en: 'Error loading your balance',
  },
  'scanCredits.openingCheckout': {
    bg: 'Отваряне на плащане...',
    en: 'Opening checkout...',
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
    en: 'Art. 117 protocols',
  },
  'profile.protocolsDesc': {
    bg: 'Самоначислен ДДС и срокове за подаване',
    en: 'Self-charged VAT and filing deadlines',
  },
  'protocols.title': {
    bg: 'Протоколи по чл.117',
    en: 'Art. 117 protocols',
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
    en: 'No Art. 117 protocols',
  },
  'protocols.emptyHint': {
    bg: 'Появяват се тук, когато фактура е с вид ДДС „Обратно начисляване“',
    en: 'Appear here when an invoice has the VAT type "Reverse charge"',
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
  'scan.addPage': {
    bg: 'Добави страница',
    en: 'Add Page',
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
  'invoices.deletedUndo': {
    bg: 'Фактурата е изтрита',
    en: 'Invoice deleted',
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

  // Shared period navigator (Home dashboard + Stats overview cards)
  'periodNav.day': {
    bg: 'Ден',
    en: 'Day',
  },
  'periodNav.week': {
    bg: 'Седмица',
    en: 'Week',
  },
  'periodNav.month': {
    bg: 'Месец',
    en: 'Month',
  },
  'periodNav.year': {
    bg: 'Година',
    en: 'Year',
  },
  'periodNav.range': {
    bg: 'От–до',
    en: 'Range',
  },
  'periodNav.previous': {
    bg: 'Предходен период',
    en: 'Previous period',
  },
  'periodNav.next': {
    bg: 'Следващ период',
    en: 'Next period',
  },
  'periodNav.backToCurrent': {
    bg: 'Обратно към текущия',
    en: 'Back to current',
  },
  'periodNav.jumpToPeriod': {
    bg: 'Избери период от календар',
    en: 'Pick a period from the calendar',
  },
  'periodNav.vsPrevious': {
    bg: 'спрямо предходния период',
    en: 'vs. the previous period',
  },
  'stats.income': {
    bg: 'Приходи',
    en: 'Income',
  },
  'stats.vatBreakdown': {
    bg: 'ДДС за периода',
    en: 'VAT for the period',
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
  // As many as the chart shows: up to ten.
  'stats.topSuppliersN': {
    bg: 'Топ {count} доставчици',
    en: 'Top {count} suppliers',
  },
  'stats.otherSuppliers': {
    bg: 'Останалите ({count})',
    en: 'The rest ({count})',
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
    bg: 'Акаунт',
    en: 'Account',
  },
  'profile.settings': {
    bg: 'Настройки',
    en: 'Settings',
  },
  'profile.category.company': {
    bg: 'Фирма и екип',
    en: 'Company & Team',
  },
  'profile.category.accounting': {
    bg: 'Счетоводство',
    en: 'Accounting',
  },
  'profile.category.security': {
    bg: 'Сигурност',
    en: 'Security',
  },
  'profile.category.settings': {
    bg: 'Настройки',
    en: 'Settings',
  },
  'profile.category.support': {
    bg: 'Поддръжка',
    en: 'Support',
  },
  'profile.users': {
    bg: 'Потребители',
    en: 'Users',
  },
  'profile.usersDesc': {
    bg: 'Управление и покани',
    en: 'Manage & invite',
  },
  'profile.company': {
    bg: 'Фирма',
    en: 'Company',
  },
  'profile.companyData': {
    bg: 'Данни на фирмата',
    en: 'Company data',
  },
  'profile.noCompanyYet': {
    bg: 'Създайте фирма или се присъединете по покана',
    en: 'Create a company or join by invitation',
  },
  'profile.accountSecurity': {
    bg: 'Акаунт и сигурност',
    en: 'Account & Security',
  },
  'profile.changePassword': {
    bg: 'Смяна на парола',
    en: 'Change password',
  },
  'profile.setPasswordForEmail': {
    bg: 'Задайте парола за вход с имейл',
    en: 'Set a password for email login',
  },
  'profile.notifications': {
    bg: 'Известия',
    en: 'Notifications',
  },
  'profile.vatNotifications': {
    bg: 'ДДС напомняния',
    en: 'VAT reminders',
  },
  'profile.calendar': {
    bg: 'Календар',
    en: 'Calendar',
  },
  'profile.calendarDesc': {
    bg: 'Събития и напомняния за екипа',
    en: 'Events and reminders for the team',
  },
  'profile.messages': {
    bg: 'Съобщения',
    en: 'Messages',
  },
  'profile.messagesDesc': {
    bg: 'Екипен чат и лични съобщения',
    en: 'Team chat and direct messages',
  },
  'profile.closedDays': {
    bg: 'Почивни дни',
    en: 'Closed days',
  },
  'profile.closedDaysDesc': {
    bg: 'Седмичен график и празници за статистиките',
    en: 'Weekly schedule and holidays for statistics',
  },
  'profile.backup': {
    bg: 'Копие на всички данни',
    en: 'Copy of all data',
  },
  'profile.backupRestore': {
    bg: 'Запазване и връщане от файл',
    en: 'Save to a file and restore',
  },
  'profile.language': {
    bg: 'Език',
    en: 'Language',
  },
  'profile.languageBulgarian': {
    bg: '🇧🇬 Български',
    en: '🇧🇬 Български',
  },
  'profile.languageEnglish': {
    bg: '🇬🇧 English',
    en: '🇬🇧 English',
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
  'profile.privacyPolicy': {
    bg: 'Поверителност',
    en: 'Privacy Policy',
  },
  'profile.privacyPolicyDesc': {
    bg: 'Защита на данните',
    en: 'Data protection',
  },
  'profile.termsOfService': {
    bg: 'Условия',
    en: 'Terms of Service',
  },
  'profile.termsOfServiceDesc': {
    bg: 'Правила за ползване',
    en: 'Usage rules',
  },
  'profile.logout': {
    bg: 'Изход',
    en: 'Logout',
  },
  'profile.logoutConfirm': {
    bg: 'Сигурни ли сте, че искате да излезете?',
    en: 'Are you sure you want to log out?',
  },
  'profile.changeAvatar': {
    bg: 'Смяна на профилна снимка',
    en: 'Change profile picture',
  },
  'profile.avatarUploadError': {
    bg: 'Неуспешно качване на снимката. Опитайте отново.',
    en: 'Failed to upload picture. Try again.',
  },
  'profile.removeAvatarTitle': {
    bg: 'Премахване на снимката',
    en: 'Remove picture',
  },
  'profile.removeAvatarConfirm': {
    bg: 'Да премахнем ли текущата профилна снимка?',
    en: 'Remove your current profile picture?',
  },
  'profile.cropTitle': {
    bg: 'Позиционирай снимката',
    en: 'Position your picture',
  },
  'profile.cropHint': {
    bg: 'Плъзни снимката, за да избереш коя част да се вижда',
    en: 'Drag the photo to choose which part shows',
  },
  'profile.cropUse': {
    bg: 'Използвай',
    en: 'Use photo',
  },

  // Common
  'common.cancel': {
    bg: 'Отказ',
    en: 'Cancel',
  },
  'common.areYouSure': {
    bg: 'Сигурни ли сте?',
    en: 'Are you sure?',
  },
  'common.yes': {
    bg: 'Да',
    en: 'Yes',
  },
  'common.no': {
    bg: 'Не',
    en: 'No',
  },
  'common.confirm': {
    bg: 'Потвърди',
    en: 'Confirm',
  },
  'common.save': {
    bg: 'Запази',
    en: 'Save',
  },
  'common.edit': {
    bg: 'Редактирай',
    en: 'Edit',
  },
  'common.saving': {
    bg: 'Запазване...',
    en: 'Saving...',
  },
  'common.operationFailed': {
    bg: 'Действието не бе успешно. Опитайте отново.',
    en: 'The operation failed. Please try again.',
  },
  'common.delete': {
    bg: 'Изтрий',
    en: 'Delete',
  },
  'common.close': {
    bg: 'Затвори',
    en: 'Close',
  },
  'common.undo': {
    bg: 'Отмяна',
    en: 'Undo',
  },
  'common.saved': {
    bg: 'Промените са запазени',
    en: 'Changes saved',
  },
  'common.required': {
    bg: 'Задължително поле',
    en: 'Required field',
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
  'import.alreadyPresentSummary': {
    bg: '{count} реда вече ги има (същата дата, описание и сума) – не са внесени втори път.',
    en: '{count} rows are already there (same date, description and amount) – not imported twice.',
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
  'invoices.linesMismatchTitle': { bg: 'Редовете не дават сумата', en: 'The lines do not add up' },
  'invoices.linesMismatchText': {
    bg: 'Сборът на редовете е {lines} €, а сумата без ДДС е {base} €. Провери количествата и цените – или запази така.',
    en: 'The lines add up to {lines} €, but the amount without VAT is {base} €. Check quantities and prices – or save as it is.',
  },
  'invoices.saveAnyway': { bg: 'Запази така', en: 'Save anyway' },
  'invoices.alreadyPaidTitle': { bg: 'Вече платена ли е?', en: 'Already paid?' },
  'invoices.alreadyPaidText': {
    bg: 'Фактурата става по банков път. Ако още не е платена, ще се води като задължение до плащането.',
    en: 'The invoice becomes a bank transfer. If it is not paid yet, it will count as owed until paid.',
  },
  'invoices.notPaidYet': { bg: 'Не, дължи се', en: 'No, it is owed' },
  'invoices.alreadyPaid': { bg: 'Да, платена е', en: 'Yes, it is paid' },
  'invoices.isAssetTitle': { bg: 'Дълготраен актив', en: 'Fixed asset' },
  'invoices.isAssetText': {
    bg: 'Не се брои като разход в деня си – брои се амортизацията на актива. ДДС остава кредит.',
    en: 'Not an expense of its day – the asset\'s depreciation is. Its VAT stays a credit.',
  },
  'invoices.makeAsset': { bg: 'Запиши като дълготраен актив', en: 'Record as a fixed asset' },
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
  'invoices.scannedBy': {
    bg: 'Сканирано от',
    en: 'Scanned by',
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
  'invoices.scannedPages': {
    bg: 'Сканирани страници',
    en: 'Scanned Pages',
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
  'invoices.editItemsHint': {
    bg: 'Поправи количество или единична цена, ако артикул е записан грешно (напр. пакет от 6 бр., въведен като 1 бр.).',
    en: 'Correct quantity or unit price if an item was recorded wrong (e.g. a 6-pack entered as 1 unit).',
  },
  'invoices.itemsSum': {
    bg: 'Сбор на артикулите',
    en: 'Items sum',
  },
  'invoices.itemsMismatch': {
    bg: 'Сборът на артикулите се различава от стойността без ДДС на фактурата - възможна грешка при въвеждането.',
    en: "The items' sum differs from the invoice's amount without VAT - possible entry error.",
  },
  'invoices.vsBaseline': {
    bg: 'спрямо средно от последните {count} доставки',
    en: 'vs. average of last {count} purchases',
  },
  'invoices.vsBaselineSingle': {
    bg: 'спрямо последната доставка',
    en: 'vs. last purchase',
  },
  'invoices.deleteInvoice': {
    bg: 'Изтрий фактурата',
    en: 'Delete Invoice',
  },
  'invoices.editInvoice': {
    bg: 'Редактирай фактурата',
    en: 'Edit Invoice',
  },
  'invoices.scanFirst': {
    bg: 'Сканирайте първата си фактура',
    en: 'Scan your first invoice',
  },
  'invoices.searchPlaceholder': {
    bg: 'Доставчик или №',
    en: 'Supplier or No.',
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
    bg: 'Добави плащане',
    en: 'Add a payment',
  },
  'invoices.paymentHistory': { bg: 'Плащания', en: 'Payments' },
  'invoices.deletePaymentTitle': { bg: 'Махни плащането', en: 'Remove the payment' },
  'invoices.deletePaymentConfirm': {
    bg: 'Да махна ли това плащане? Сумата отново ще се води дължима.',
    en: 'Remove this payment? Its amount will be owed again.',
  },
  'invoices.markFullyPaid': {
    bg: 'Маркирай като напълно платена',
    en: 'Mark as fully paid',
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
  'invoices.filtersButton': {
    bg: 'Филтри',
    en: 'Filters',
  },
  'invoices.truncatedBanner': {
    bg: 'Показани са {shown} от {total} фактури. Прецизирай период или търсене, за да видиш останалите.',
    en: 'Showing {shown} of {total} invoices. Narrow the date range or search to see the rest.',
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
  'company.vatRegistered': {
    bg: 'Регистрирана по ЗДДС',
    en: 'Registered for VAT',
  },
  'company.vatRegisteredHint': {
    bg: 'Фактурите се издават с ДДС и програмата показва ДДС за внасяне. Прагът за регистрация следи счетоводителят.',
    en: 'Invoices carry VAT and the app shows the VAT to pay. Your accountant tracks the registration threshold.',
  },
  'company.profitTax': { bg: 'Данък върху печалбата (%)', en: 'Profit tax (%)' },
  'company.profitTaxHint': {
    bg: 'За нетния марж на началната страница. Ако не е попълнено – по закона: {rate}% ({form}). При патентен данък въведете 0.',
    en: 'For the net margin on Home. When empty – as the law says: {rate}% ({form}). With a patent tax, enter 0.',
  },
  'company.profitTaxCompany': { bg: 'дружество', en: 'a company' },
  'company.profitTaxSoleTrader': { bg: 'ЕТ', en: 'a sole trader' },
  'company.profitTaxError': {
    bg: 'Данъкът върху печалбата е между 0 и 50%.',
    en: 'The profit tax is between 0 and 50%.',
  },
  'company.vatNotRegisteredHint': {
    bg: 'Фактурите се издават без ДДС (чл. 113, ал. 9 ЗДДС) и картите за ДДС се скриват. Прагът за регистрация следи счетоводителят.',
    en: 'Invoices are issued without VAT (Art. 113(9) VAT Act) and the VAT cards are hidden. Your accountant tracks the registration threshold.',
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
    bg: 'Копие на данните',
    en: 'Copy of the data',
  },
  'backup.infoTitle': {
    bg: 'Износ на бекъп',
    en: 'Backup export',
  },
  'backup.infoDescription': {
    bg: 'Създайте backup на вашите данни и го запазете където пожелаете - Google Drive, имейл или локално на устройството.',
    en: 'Create a backup of your data and save it wherever you like - Google Drive, email, or locally on your device.',
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
  'backup.monthlyEmail': { bg: 'Месечен архив по имейл', en: 'Monthly backup by email' },
  'backup.monthlyEmailHint': {
    bg: 'Веднъж месечно архивът идва на имейла ви - копие извън приложението.',
    en: 'Once a month the backup comes to your email - a copy outside the app.',
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
    bg: 'Изберете къде да го запазите от менюто за споделяне (Google Drive, имейл, локално)',
    en: 'Choose where to save it from the sharing menu (Google Drive, email, locally)',
  },
  'backup.step3': {
    bg: 'За възстановяване - изберете запазения файл',
    en: 'To restore - select the saved file',
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
    bg: 'Запазете файла където пожелаете - Google Drive, имейл или локално на устройството.',
    en: 'Save the file wherever you like - Google Drive, email, or locally on your device.',
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
    bg: 'Нищо съществуващо няма да бъде изтрито – добавят се само записите, които липсват, и нищо не се дублира.',
    en: 'Nothing existing is deleted – only missing records are added, and nothing is duplicated.',
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
  'backup.otherRecords': { bg: 'Други записи (екип, заплати, график, активи, вземания, настройки)', en: 'Other records (team, payroll, schedule, assets, receivables, settings)' },
  'backup.alreadyPresent': { bg: 'Вече налични – не са добавени втори път', en: 'Already present – not added twice' },
  'backup.notInTeam': { bg: 'За хора, които не са в тази фирма – пропуснати', en: 'About people not in this company – skipped' },
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
    bg: 'Помощ',
    en: 'Help',
  },
  'help.appTitle': {
    bg: 'Фактура+',
    en: 'Fakturaplus',
  },
  'help.appSubtitle': {
    bg: 'Фактури, финанси и екип на едно място',
    en: 'Invoices, finances and your team in one place',
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
    bg: 'Сканиране на фактури',
    en: 'Scanning invoices',
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

  // Feedback box (bottom of Help screen)
  'feedback.title': {
    bg: 'Обратна връзка',
    en: 'Feedback',
  },
  'feedback.intro': {
    bg: 'Фактура+ е направено от опит в реалния бизнес, но никой не познава нуждите на вашата фирма по-добре от вас. Ще се радваме на всяка идея или забелязан проблем - това е начинът да изградим един наистина по-обхватен и по-добър продукт в помощ на бизнеса.',
    en: "Fakturaplus is built from real business experience, but nobody knows your company's needs better than you do. We welcome every idea or issue you notice - it's how we build a genuinely more complete, better product to help your business.",
  },
  'feedback.anonymousLabel': {
    bg: 'Анонимно',
    en: 'Anonymous',
  },
  'feedback.namedLabel': {
    bg: 'С моето име',
    en: 'With my name',
  },
  'feedback.placeholder': {
    bg: 'Споделете проблем, идея или предложение...',
    en: 'Share a problem, idea, or suggestion...',
  },
  'feedback.submit': {
    bg: 'Изпрати',
    en: 'Submit',
  },
  'feedback.submitting': {
    bg: 'Изпращане...',
    en: 'Submitting...',
  },
  'feedback.success': {
    bg: 'Благодарим! Съобщението е изпратено.',
    en: 'Thank you! Your message has been sent.',
  },
  'feedback.error': {
    bg: 'Възникна грешка. Опитайте отново.',
    en: 'Something went wrong. Please try again.',
  },
  'feedback.emptyError': {
    bg: 'Моля, въведете съобщение.',
    en: 'Please enter a message.',
  },

  // Onboarding tutorial (shown once on first login, reopenable via the "?" button)
  'tutorial.helpButtonLabel': {
    bg: 'Помощ',
    en: 'Help',
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
  'stats.vatToPay': {
    bg: 'ДДС за плащане',
    en: 'VAT to Pay',
  },
  'stats.ofWhichIssuedInvoices': {
    bg: 'от тях издадени фактури: {amount} €',
    en: 'of which issued invoices: {amount} €',
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
  'stats.top3WithVat': {
    bg: 'с ДДС',
    en: 'incl. VAT',
  },
  'stats.top3WithoutVat': {
    bg: 'без ДДС',
    en: 'excl. VAT',
  },
  'stats.forecastTitle': {
    bg: 'Прогноза за следващия месец',
    en: 'Forecast for next month',
  },
  'stats.forecastHint': {
    bg: 'На база последните 6 месеца',
    en: 'Based on the last 6 months',
  },
  'stats.forecastHint1m': {
    bg: 'На база последния 1 месец',
    en: 'Based on the last 1 month',
  },
  'stats.forecastHint3m': {
    bg: 'На база последните 3 месеца',
    en: 'Based on the last 3 months',
  },
  'stats.forecastHint6m': {
    bg: 'На база последните 6 месеца',
    en: 'Based on the last 6 months',
  },
  'stats.forecastHint12m': {
    bg: 'На база последните 12 месеца',
    en: 'Based on the last 12 months',
  },
  'stats.forecastRange1m': {
    bg: '1 мес.',
    en: '1 mo',
  },
  'stats.forecastRange3m': {
    bg: '3 мес.',
    en: '3 mo',
  },
  'stats.forecastRange6m': {
    bg: '6 мес.',
    en: '6 mo',
  },
  'stats.forecastRange12m': {
    bg: '12 мес.',
    en: '12 mo',
  },
  'stats.forecastInsufficientData': {
    bg: 'Все още се учим от твоя бизнес - прогнозата ще стане по-точна с още история (поне 4 месеца данни).',
    en: "Still learning your business - the forecast gets sharper with more history (at least 4 months of data).",
  },
  'stats.forecastAverageOnly': {
    bg: 'Средно на месец',
    en: 'Monthly average',
  },
  'stats.vsLastYear': {
    bg: 'спрямо миналата година',
    en: 'vs last year',
  },
  'stats.forecastYearBackRevenue': {
    bg: 'Оборотът ти по месеци следва миналогодишния, затова прогнозата за него е по същия месец миналата година, при сегашното ти ниво спрямо миналата година.',
    en: "Your monthly revenue follows last year's, so its forecast uses the same month last year at your current level against last year.",
  },
  'stats.forecastYearBackExpense': {
    bg: 'Разходите ти по месеци следват миналогодишните, затова прогнозата за тях е по същия месец миналата година, при сегашното ти ниво спрямо миналата година.',
    en: "Your monthly expenses follow last year's, so their forecast uses the same month last year at your current level against last year.",
  },
  'stats.forecastYearBackBoth': {
    bg: 'Оборотът и разходите ти по месеци следват миналогодишните, затова прогнозата е по същия месец миналата година, при сегашното ти ниво спрямо миналата година.',
    en: "Your monthly revenue and expenses follow last year's, so the forecast uses the same month last year at your current level against last year.",
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
    bg: 'Възвръщаемост на вложеното по месеци',
    en: 'Return on what you put in, by month',
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
    bg: 'Топ {count} по обем',
    en: 'Top {count} by volume',
  },
  'stats.topByFrequency': {
    bg: 'Топ {count} по честота',
    en: 'Top {count} by frequency',
  },
  'stats.topByAvg': {
    bg: 'Топ {count} по средна стойност',
    en: 'Top {count} by average',
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
    bg: 'Забелязахме промяна в цената на артикул от последна фактура.',
    en: 'We noticed a price change on an item from a recent invoice.',
  },
  'priceAlertPopup.subtitleMultiple': {
    bg: 'Забелязахме промяна в цените на {count} артикула от последни фактури.',
    en: 'We noticed price changes on {count} items from recent invoices.',
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
  'priceAlertPopup.invoiceRef': {
    bg: 'фактура №{number}',
    en: 'invoice #{number}',
  },
  'priceAlertPopup.basisSingle': {
    bg: 'Сравнено с последната покупка на този артикул',
    en: 'Compared to the last purchase of this item',
  },
  'priceAlertPopup.basisMultiple': {
    bg: 'Сравнено със средната цена от последните {count} покупки',
    en: 'Compared to the average of the last {count} purchases',
  },
  'priceAlertPopup.viewInvoice': {
    bg: 'Виж фактурата',
    en: 'View invoice',
  },
  'priceAlertPopup.muteItem': {
    bg: 'Не предупреждавай пак',
    en: "Don't alert again",
  },
  'priceAlertPopup.muted': {
    bg: 'Няма да получаваш повече аларми за този артикул от този доставчик',
    en: "You won't get alerts for this item from this supplier anymore",
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
  'stats.priceAlertsEmpty': {
    bg: 'Няма активни ценови аларми в момента.',
    en: 'No active price alerts right now.',
  },
  'priceAlertSettings.title': {
    bg: 'Настройки на ценови аларми',
    en: 'Price alert settings',
  },
  'priceAlertSettings.saved': {
    bg: 'Настройките са запазени',
    en: 'Settings saved',
  },
  'priceAlertSettings.enabled': {
    bg: 'Ценови аларми',
    en: 'Price alerts',
  },
  'priceAlertSettings.enabledHint': {
    bg: 'Изключи ако изобщо не искаш да получаваш аларми за промяна в цените.',
    en: "Turn off if you don't want price-change alerts at all.",
  },
  'priceAlertSettings.alertOnDecrease': {
    bg: 'Предупреждавай и при поевтиняване',
    en: 'Also alert on price drops',
  },
  'priceAlertSettings.alertOnDecreaseHint': {
    bg: 'Полезно - може да означава възможност за преговори с друг доставчик или по-изгодна покупка.',
    en: 'Useful - can mean a negotiation opportunity or a better deal elsewhere.',
  },
  'priceAlertSettings.threshold': {
    bg: 'Праг за аларма (%)',
    en: 'Alert threshold (%)',
  },
  'priceAlertSettings.thresholdHint': {
    bg: 'Алармирай само при промяна поне с толкова процента спрямо средната от последните покупки.',
    en: 'Only alert when the change is at least this many percent vs. the recent-purchases average.',
  },
  'priceAlertSettings.minMonthlyImpact': {
    bg: 'Минимално въздействие на месец (€)',
    en: 'Minimum impact per month (€)',
  },
  'priceAlertSettings.minMonthlyImpactHint': {
    bg: 'Алармирай само ако промяната струва поне толкова на месец при обичайното ти количество - 18% по-скъпи питки, купувани с хиляди, алармират; 12% по-скъп препарат за 2 € на месец - не.',
    en: 'Only alert when the change costs at least this much a month at your usual quantity - pitas bought by the thousand alert at +18%; a detergent costing 2 € more a month does not.',
  },
  'priceAlert.monthlyImpact': {
    bg: '≈ {amount} € на месец при обичайното количество',
    en: '≈ {amount} € a month at your usual quantity',
  },
  'priceAlert.packQuestionUp': {
    bg: 'Цената е точно {k}× обичайната ({old} €) – стек от {k} ли е, записан като 1 бр.?',
    en: 'The price is exactly {k}× the usual ({old} €) – a pack of {k} entered as 1 piece?',
  },
  'priceAlert.packQuestionDown': {
    bg: 'Цената е точно {k} пъти под обичайната ({old} €) – по бройка ли е, вместо на стек от {k}?',
    en: 'The price is exactly {k} times below the usual ({old} €) – per piece instead of per pack of {k}?',
  },
  'priceAlert.packBadge': {
    bg: '×{k}?',
    en: '×{k}?',
  },
  'scan.packFixSplit': {
    bg: 'Да, стек от {k}: {qty} × {price} €',
    en: 'Yes, pack of {k}: {qty} × {price} €',
  },
  'scan.packFixCombine': {
    bg: 'Да, по {k} в стек: {qty} × {price} €',
    en: 'Yes, {k} per pack: {qty} × {price} €',
  },
  'scan.packRuleApplied': {
    bg: 'Записах го като стек от {k} – както при предишната ти поправка',
    en: 'Entered as a pack of {k} – like your earlier correction',
  },
  'scan.packRuleUndo': {
    bg: 'Върни',
    en: 'Undo',
  },
  'scanCheck.allGood': {
    bg: 'Сборът на редовете ({sum} €) съвпада с данъчната основа.',
    en: 'The lines add up to the tax base ({sum} €).',
  },
  'scanCheck.headerMismatch': {
    bg: 'Основа + ДДС = {expected} €, а сумата за плащане е {total} €. Провери сумите горе.',
    en: 'Base + VAT = {expected} €, but the total is {total} €. Check the amounts above.',
  },
  'scanCheck.linesMismatch': {
    bg: 'Редовете дават {sum} €, а данъчната основа е {base} € (разлика {diff} €).',
    en: 'The lines add up to {sum} €, the tax base is {base} € (difference {diff} €).',
  },
  'scanCheck.causeLineValues': {
    bg: 'Стойностите на редовете съвпадат с основата, но при {n} реда количество × цена дава друго – вероятно отстъпка по ред. За точни цени запиши цената след отстъпката.',
    en: 'The line values match the base, but on {n} lines quantity × price does not - most likely a per-line discount. For accurate prices, keep the price after the discount.',
  },
  'scanCheck.causeLineValuesOne': {
    bg: 'При „{name}“ количество × цена не съвпада със стойността на реда – вероятно е разчетена грешно цифра.',
    en: 'On "{name}" quantity × price does not match the line value - most likely a misread digit.',
  },
  'scanCheck.fixLinePrices': {
    bg: 'Цена след отстъпката ({n} реда)',
    en: 'Price after discount ({n} lines)',
  },
  'scanCheck.causeVatIncluded': {
    bg: 'Цените на редовете изглеждат с ДДС: сборът им съвпада със сумата за плащане. Историята на цените пази цени без ДДС.',
    en: 'The line prices look VAT-inclusive: they add up to the total. Price history keeps prices without VAT.',
  },
  'scanCheck.fixVatIncluded': {
    bg: 'Махни ДДС от цените',
    en: 'Remove VAT from the prices',
  },
  'scanCheck.causeDuplicate': {
    bg: 'Редът „{name}“ изглежда разчетен два пъти – без него сборът съвпада.',
    en: '"{name}" looks read twice - without it the lines add up.',
  },
  'scanCheck.removeDuplicate': {
    bg: 'Махни повторения ред',
    en: 'Remove the repeated line',
  },
  'scanCheck.causeDecimal': {
    bg: 'При „{name}“ вероятно е сбъркана десетичната запетая: с цена {price} € сборът съвпада.',
    en: 'On "{name}" the decimal point is likely misplaced: at {price} € the lines add up.',
  },
  'scanCheck.causeMissing': {
    bg: 'Липсват {diff} € – вероятно пропуснат ред. Добави го или провери снимката.',
    en: '{diff} € is missing - most likely a skipped line. Add it or check the photo.',
  },
  'scanCheck.addMissingLine': {
    bg: 'Добави ред',
    en: 'Add a line',
  },
  'scanCheck.causeExtra': {
    bg: 'Редовете са с {diff} € над основата – провери за двоен ред или обща отстъпка, която не е въведена като ред.',
    en: 'The lines are {diff} € over the base - check for a line read twice or an overall discount not entered as a line.',
  },
  'scanCheck.lineValueMismatch': {
    bg: 'Количество × цена = {computed} €, а стойността на реда е {printed} €.',
    en: 'Quantity × price = {computed} €, but the line value is {printed} €.',
  },
  'scanCheck.setPrice': {
    bg: 'Цена {price} €',
    en: 'Price {price} €',
  },
  'scanCheck.setQuantity': {
    bg: 'Количество {qty}',
    en: 'Quantity {qty}',
  },
  'scanCheck.confirmTitle': {
    bg: 'Сумите не съвпадат',
    en: 'The amounts do not add up',
  },
  'scanCheck.confirmBody': {
    bg: 'Запази все пак?',
    en: 'Save anyway?',
  },
  'scanCheck.review': {
    bg: 'Провери',
    en: 'Review',
  },
  'scanCheck.saveAnyway': {
    bg: 'Запази все пак',
    en: 'Save anyway',
  },
  'scan.priceHintChange': {
    bg: '{percent}% спрямо обичайните {old} €',
    en: '{percent}% vs the usual {old} €',
  },
  'priceAlertSettings.mutedTitle': {
    bg: 'Спрени аларми за артикули',
    en: 'Muted item alerts',
  },
  'priceAlertSettings.mutedHint': {
    bg: 'Артикули, за които няма да получаваш повече ценови аларми от конкретния доставчик.',
    en: "Items you've chosen not to get price alerts for, from a specific supplier.",
  },
  'priceAlertSettings.mutedEmpty': {
    bg: 'Няма спрени артикули.',
    en: 'No muted items.',
  },
  'priceAlertSettings.unmute': {
    bg: 'Възобнови',
    en: 'Unmute',
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
    bg: 'средно за {days} дни с въведен оборот',
    en: 'average over {days} days with revenue entered',
  },
  'stats.forecastThisMonth': {
    bg: 'Този месец досега',
    en: 'This month so far',
  },
  'stats.forecastExpectedEnd': {
    bg: 'очакван край {amount}',
    en: 'expected end {amount}',
  },
  'stats.forecastAtThisPace': {
    bg: 'по досегашния темп {amount}',
    en: 'at the pace so far {amount}',
  },
  'stats.forecastWithCurrentMonth': {
    bg: 'Прогнозата включва очаквания край на текущия месец.',
    en: 'The forecast includes the expected end of the current month.',
  },
  'stats.activeInPeriod': {
    bg: 'С покупки в периода',
    en: 'Bought from in the period',
  },
  'stats.inactiveInPeriod': {
    bg: 'Без покупки в периода',
    en: 'Not bought from in the period',
  },
  'stats.groupDay': {
    bg: 'Дни',
    en: 'Days',
  },
  'stats.groupWeek': {
    bg: 'Седмици',
    en: 'Weeks',
  },
  'stats.groupMonth': {
    bg: 'Месеци',
    en: 'Months',
  },
  'stats.groupYear': {
    bg: 'Години',
    en: 'Years',
  },
  'stats.partialBucket': {
    bg: 'незавършен',
    en: 'in progress',
  },
  'stats.supplierSeriesTitle': {
    bg: 'Покупки по периоди',
    en: 'Purchases by period',
  },
  'stats.allTime': {
    bg: 'Цялото време',
    en: 'All time',
  },
  'stats.periodTotal': {
    bg: 'Общо за периода',
    en: 'Total for the period',
  },
  'stats.allTimeTotal': {
    bg: 'Общо за цялото време',
    en: 'Total for all time',
  },
  'stats.activityLast30Note': {
    bg: 'Активен = доставка през последните 30 дни',
    en: 'Active = a delivery in the last 30 days',
  },
  'stats.seriesLastGrowth': {
    bg: 'Последен цял период ({label}): {growth}% спрямо предходния',
    en: 'Last whole period ({label}): {growth}% vs the one before',
  },
  'stats.forecastPayrollFromLastMonth': {
    bg: 'Заплатите за месеца още не са въведени – взети са от миналия месец.',
    en: 'This month’s payroll isn’t entered yet - last month’s is used.',
  },
  'stats.byPeriod': {
    bg: 'По период',
    en: 'By period',
  },
  'stats.priceInflation': {
    bg: 'Обща инфлация на цените',
    en: 'Overall Price Inflation',
  },
  // Orders (ReorderPlanCard): by supplier, what is due and how much.
  'reorder.title': { bg: 'Поръчки', en: 'Orders' },
  'reorder.subtitle': {
    bg: 'По доставчици – кое е време да поръчате и колко, по ритъма на покупките и дните за доставка.',
    en: 'By supplier – what is due and how much, from the rhythm of your purchases and the delivery days.',
  },
  'reorder.toOrder': { bg: '{count} за поръчка', en: '{count} to order' },
  'reorder.soon': { bg: '{count} скоро', en: '{count} soon' },
  'reorder.allGood': { bg: 'наред', en: 'all good' },
  'reorder.itemOne': { bg: '1 артикул', en: '1 item' },
  'reorder.itemMany': { bg: '{count} артикула', en: '{count} items' },
  'reorder.statusOrder': { bg: 'Поръчай', en: 'Order' },
  'reorder.statusSoon': { bg: 'Скоро', en: 'Soon' },
  'reorder.statusOk': { bg: 'Наред', en: 'OK' },
  'reorder.rhythm': {
    bg: 'на всеки {median} дни · последно преди {days} дни',
    en: 'every {median} days · last {days} days ago',
  },
  'reorder.alsoOthers': { bg: 'купувано и от други доставчици', en: 'also bought from other suppliers' },
  'reorder.copy': { bg: 'Копирай', en: 'Copy' },
  'reorder.markOrdered': { bg: 'Поръчано', en: 'Ordered' },
  'reorder.markedOrdered': { bg: 'Отбелязано като поръчано', en: 'Marked as ordered' },
  'reorder.statusOrdered': { bg: 'Поръчано', en: 'Ordered' },
  'reorder.orderedWhen': { bg: 'поръчано {when}', en: 'ordered {when}' },
  'reorder.orderedWhenBy': { bg: 'поръчано {when} от {name}', en: 'ordered {when} by {name}' },
  'reorder.today': { bg: 'днес', en: 'today' },
  'reorder.yesterday': { bg: 'вчера', en: 'yesterday' },
  'reorder.daysAgo': { bg: 'преди {count} дни', en: '{count} days ago' },
  // Fixed delivery days, read from the supplier's invoice dates.
  'reorder.weekdaysShort': { bg: 'пн,вт,ср,чт,пт,сб,нд', en: 'Mon,Tue,Wed,Thu,Fri,Sat,Sun' },
  'reorder.onWeekdays': {
    bg: 'в понеделник,във вторник,в сряда,в четвъртък,в петък,в събота,в неделя',
    en: 'on Mondays,on Tuesdays,on Wednesdays,on Thursdays,on Fridays,on Saturdays,on Sundays',
  },
  'reorder.delivers': { bg: 'Доставя {days}', en: 'Delivers {days}' },
  'reorder.newDays': { bg: 'нови дни', en: 'new days' },
  'reorder.deliveryOn': { bg: 'Доставка {day}', en: 'Delivery {day}' },
  'reorder.orderToday': { bg: 'поръчай днес', en: 'order today' },
  'reorder.orderTomorrow': { bg: 'поръчай до утре', en: 'order by tomorrow' },
  'reorder.orderBy': { bg: 'поръчай до {day}', en: 'order by {day}' },
  'reorder.orderNow': { bg: 'поръчай веднага', en: 'order now' },
  'reorder.usually': { bg: 'обикновено {day}', en: 'usually {day}' },
  'reorder.holiday': {
    bg: '{day} е празник ({name}) – доставката може да не дойде. Поръчай за повече дни.',
    en: '{day} is a public holiday ({name}) – the delivery may not come. Order for more days.',
  },
  'reorder.missing': { bg: 'Доставката на {day} дойде без: {items}', en: 'The delivery on {day} came without: {items}' },
  'reorder.missingItem': { bg: 'липсваше в доставката на {day}', en: 'missing from the delivery on {day}' },
  'reorder.noInvoice': {
    bg: 'Няма фактура от вчерашната доставка ({day}) – сканирай я, ако е дошла.',
    en: "No invoice for yesterday's delivery ({day}) – scan it if it came.",
  },
  'reorder.copied': {
    bg: 'Поръчката е копирана – поставете я във Viber или имейл',
    en: 'Order copied – paste it into Viber or an email',
  },
  'reorder.orderFor': { bg: 'Поръчка за {supplier}:', en: 'Order for {supplier}:' },
  'reorder.staleTitle': { bg: 'Отдавна не е поръчвано ({count})', en: 'Not ordered for a long time ({count})' },
  'reorder.staleHint': {
    bg: 'Още ли ги ползвате? Скритите се появяват пак, ако ги купите отново.',
    en: 'Still using them? Hidden ones come back once bought again.',
  },
  'reorder.staleRhythm': {
    bg: '{supplier} · обикновено на всеки {median} дни · последно преди {days} дни',
    en: '{supplier} · usually every {median} days · last {days} days ago',
  },
  'reorder.hide': { bg: 'Скрий', en: 'Hide' },
  'reorder.hidden': {
    bg: 'Скрито – появява се пак, ако го купите отново',
    en: 'Hidden – it comes back once bought again',
  },
  // Full weekday names, index 0=Monday matching the backend's own
  // Python date.weekday() convention (and ClosedDaysCalendar's existing
  // WEEKDAYS array) - shared by both weekday-pattern cards below.
  'weekday.0': { bg: 'Понеделник', en: 'Monday' },
  'weekday.1': { bg: 'Вторник', en: 'Tuesday' },
  'weekday.2': { bg: 'Сряда', en: 'Wednesday' },
  'weekday.3': { bg: 'Четвъртък', en: 'Thursday' },
  'weekday.4': { bg: 'Петък', en: 'Friday' },
  'weekday.5': { bg: 'Събота', en: 'Saturday' },
  'weekday.6': { bg: 'Неделя', en: 'Sunday' },
  'stats.weekdayRevenueTitle': {
    bg: 'Оборот по дни от седмицата',
    en: 'Revenue by weekday',
  },
  'stats.weakDaySuggestion': {
    bg: '{day} изостава - средно {avg} € срещу обичайните {overall} € ({percent}% по-малко). Струва ли си пълен работен ден?',
    en: '{day} lags behind - averaging {avg} € vs. your usual {overall} € ({percent}% less). Worth a full working day?',
  },
  'stats.staffingEfficiencyTitle': {
    bg: 'Екип спрямо оборот',
    en: 'Staffing vs. revenue',
  },
  'stats.staffingRebalanceSuggestion': {
    bg: 'В {overDay} имаш пълен екип, но оборотът на отработен час е само {overPercent}% от средното; в {underDay} същият екип изкарва {underPercent}%. Обмисли да преместиш ~{hours} часа от {overDay} към {underDay}.',
    en: 'On {overDay} you\'re fully staffed, but revenue per labor-hour is only {overPercent}% of average; on {underDay} the same staffing earns {underPercent}%. Consider moving ~{hours} hours from {overDay} to {underDay}.',
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
  'stats.pricePerBaseUnit': {
    bg: 'Цена за {unit}',
    en: 'Price per {unit}',
  },
  'stats.comparedPerBase': {
    bg: 'Сравнено по цена за {unit}',
    en: 'Compared per {unit}',
  },
  'stats.otherSizes': {
    bg: 'Други разфасовки',
    en: 'Other pack sizes',
  },
  'stats.otherSizesDesc': {
    bg: 'Същият продукт в друга опаковка, сравнен по цена за {unit}.',
    en: 'The same product in another pack size, compared per {unit}.',
  },
  'stats.thisSizePrice': {
    bg: 'Тази разфасовка: {price} €/{unit}.',
    en: 'This size: {price} €/{unit}.',
  },
  'stats.cheaperBy': {
    bg: 'с {pct}% по-евтино',
    en: '{pct}% cheaper',
  },
  'stats.dearerBy': {
    bg: 'с {pct}% по-скъпо',
    en: '{pct}% dearer',
  },
  'stats.samePricePerUnit': {
    bg: 'същата цена',
    en: 'same price',
  },
  'stats.catalogTitle': {
    bg: 'Едно и също ли е?',
    en: 'Is it the same item?',
  },
  'stats.catalogDesc': {
    bg: 'Имената във фактурите не винаги съвпадат. Кажи кое е същият артикул – програмата ще го запомни.',
    en: 'Names on invoices do not always match. Say which is the same item - the app will remember.',
  },
  'stats.mergedWith': {
    bg: 'Обединено с',
    en: 'Joined with',
  },
  'stats.similarNames': {
    bg: 'Подобни имена',
    en: 'Similar names',
  },
  'stats.markSame': {
    bg: 'Същото',
    en: 'Same',
  },
  'stats.markDifferent': {
    bg: 'Различно',
    en: 'Different',
  },
  'stats.separate': {
    bg: 'Раздели',
    en: 'Separate',
  },
  'stats.quantityByUnit': {
    bg: 'Количеството се сравнява само в една мерна единица.',
    en: 'Quantities are only compared within one unit.',
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
    bg: 'Обща стойност без ДДС',
    en: 'Total value excl. VAT',
  },
  'stats.itemsCoverage': {
    bg: 'Артикулите покриват {percent}% от покупките за периода (без ДДС) - {count} фактури са без прочетени редове.',
    en: 'Items cover {percent}% of the period\'s purchases (excl. VAT) - {count} invoices have no read lines.',
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
  
  // Personal Investments & ROI (Owner only)
  'personal.title': {
    bg: 'Лични вложения',
    en: 'Personal Investments',
  },
  'personal.subtitle': {
    bg: 'Вашите лични вложения в бизнеса',
    en: 'Your personal investments in the business',
  },
  'personal.periodNotice': {
    bg: 'Ще се запише за {period} - месецът, който в момента гледате на Начало',
    en: 'This will be recorded for {period} - the month you\'re currently viewing on Home',
  },
  'personal.addExpense': {
    bg: 'Добави вложение',
    en: 'Add Investment',
  },
  'personal.history': {
    bg: 'История',
    en: 'History',
  },
  'personal.amount': {
    bg: 'Сума (€)',
    en: 'Amount (€)',
  },
  'personal.description': {
    bg: 'Описание',
    en: 'Description',
  },
  'personal.descriptionPlaceholder': {
    bg: 'напр. Наем, Заплати...',
    en: 'e.g. Rent, Salaries...',
  },
  'personal.type': {
    bg: 'Тип',
    en: 'Type',
  },
  'personal.category': {
    bg: 'Категория',
    en: 'Category',
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
    bg: 'Няма лични вложения за периода',
    en: 'No personal investments for this period',
  },
  'personal.created': {
    bg: 'Вложението е записано',
    en: 'Investment recorded',
  },
  'personal.deleted': {
    bg: 'Вложението е изтрито',
    en: 'Investment deleted',
  },
  'personal.deleteConfirm': {
    bg: 'Сигурни ли сте, че искате да изтриете това вложение?',
    en: 'Are you sure you want to delete this investment?',
  },

  // Personal Wallet (Лично тефтерче) - household spending tracked out of
  // company funds, distinct from "personal" above (money put INTO the
  // business).
  'wallet.tabInvestments': {
    bg: 'Инвестиции',
    en: 'Investments',
  },
  'wallet.tabWallet': {
    bg: 'Тефтерче',
    en: 'Wallet',
  },
  'wallet.title': {
    bg: 'Лично тефтерче',
    en: 'Personal wallet',
  },
  'wallet.subtitle': {
    bg: 'Лични разходи от фирмените пари',
    en: 'Personal spending out of company funds',
  },
  'wallet.safeToSpend': {
    bg: 'Безопасно за теглене',
    en: 'Safe to spend',
  },
  'wallet.safeToSpendHint': {
    bg: 'Печалбата за месеца без ДДС за внасяне, очакваните заплати, вече изтегленото и предстоящите задължения',
    en: "This month's profit less the VAT to pay, the expected salaries, what's already withdrawn and upcoming obligations",
  },
  'billingDocuments.companyDetailsMissing': {
    bg: 'Преди първата фактура попълнете {fields} на фирмата - иначе фактурата не е валидна.',
    en: "Before the first invoice, fill in the business's {fields} - otherwise the invoice is not valid.",
  },
  'billingDocuments.companyDetailsAskOwner': {
    bg: 'Собственикът трябва да попълни {fields} на фирмата, преди да се издават фактури.',
    en: "The owner has to fill in the business's {fields} before invoices can be issued.",
  },
  'billingDocuments.companyDetailsOpen': { bg: 'Данни на фирмата', en: 'Business details' },
  'billingDocuments.fieldEik': { bg: 'ЕИК', en: 'EIK' },
  'billingDocuments.fieldAddress': { bg: 'адрес', en: 'address' },
  'billingDocuments.fieldsAnd': { bg: ' и ', en: ' and ' },
  'wallet.setAside': {
    bg: 'Задържано: {parts}',
    en: 'Kept back: {parts}',
  },
  'wallet.setAsideVat': { bg: 'ДДС {amount}', en: 'VAT {amount}' },
  'wallet.setAsideSalaries': { bg: 'заплати {amount}', en: 'salaries {amount}' },
  'wallet.setAsideUpcoming': { bg: 'предстоящи {amount}', en: 'upcoming {amount}' },
  'wallet.profitHidden': {
    bg: 'Печалбата е скрита за вашия достъп – тук са само записите и сумите им.',
    en: 'The profit is hidden for your access level – only the entries and their sums are here.',
  },
  'home.personalUse': { bg: 'Лично ползване', en: 'Personal use' },
  'home.leftInBusiness': { bg: 'Остава във фирмата', en: 'Left in the business' },
  'stats.personalUseLine': {
    bg: 'Лично ползване (тефтерчето): {amount} · остава във фирмата {left}',
    en: 'Personal use (the notebook): {amount} · left in the business {left}',
  },
  'stats.personalUseOnly': {
    bg: 'Лично ползване (тефтерчето): {amount}',
    en: 'Personal use (the notebook): {amount}',
  },
  'breakEven.payrollHidden': {
    bg: 'Без заплатите – скрити са за вашия достъп.',
    en: 'Without the payroll – hidden for your access level.',
  },
  'wallet.spentThisMonth': {
    bg: 'Изтеглено този месец',
    en: 'Withdrawn this month',
  },
  'wallet.ofProfit': {
    bg: 'от печалбата',
    en: 'of profit',
  },
  'wallet.statusOk': {
    bg: 'В норма',
    en: 'On track',
  },
  'wallet.statusWarning': {
    bg: 'Внимание',
    en: 'Caution',
  },
  'wallet.statusDanger': {
    bg: 'Риск от преразход',
    en: 'Overspend risk',
  },
  'wallet.addEntry': {
    bg: 'Добави разход',
    en: 'Add expense',
  },
  'wallet.editEntry': {
    bg: 'Коригирай разход',
    en: 'Edit expense',
  },
  'wallet.category': {
    bg: 'Категория',
    en: 'Category',
  },
  'wallet.categoryLoan': {
    bg: 'Кредит',
    en: 'Loan',
  },
  'wallet.categoryLease': {
    bg: 'Лизинг',
    en: 'Lease',
  },
  'wallet.categoryUtility': {
    bg: 'Комунални',
    en: 'Utilities',
  },
  'wallet.categoryInsurance': {
    bg: 'Застраховка',
    en: 'Insurance',
  },
  'wallet.categorySubscription': {
    bg: 'Абонамент',
    en: 'Subscription',
  },
  'wallet.categoryDaily': {
    bg: 'Ежедневни',
    en: 'Daily',
  },
  'wallet.categoryOneOff': {
    bg: 'Еднократно',
    en: 'One-off',
  },
  'wallet.isRecurring': {
    bg: 'Повтарящ се разход',
    en: 'Recurring expense',
  },
  'wallet.nextDueDate': {
    bg: 'Дата на следващо плащане',
    en: 'Next due date',
  },
  'wallet.hasEndDate': {
    bg: 'Има крайна дата (договор/период)',
    en: 'Has an end date (contract/term)',
  },
  'wallet.hasEndDateHint': {
    bg: 'Включи, ако разходът е за определен период - напр. лизинг или абонамент с краен срок',
    en: 'Turn on if the expense runs for a fixed period - e.g. a lease or a fixed-term subscription',
  },
  'wallet.recurringUntil': {
    bg: 'Важи до',
    en: 'Valid until',
  },
  'wallet.byCategory': {
    bg: 'По категория',
    en: 'By category',
  },
  'wallet.needsVsWants': {
    bg: 'Нужди срещу желания',
    en: 'Needs vs. wants',
  },
  'wallet.needs': {
    bg: 'Нужди (кредити, лизинг, комунални)',
    en: 'Needs (loans, lease, utilities)',
  },
  'wallet.wants': {
    bg: 'Желания (абонаменти, ежедневни)',
    en: 'Wants (subscriptions, daily)',
  },
  'wallet.vsLastMonth': {
    bg: 'спрямо миналия месец',
    en: 'vs. last month',
  },
  'wallet.upcoming': {
    bg: 'Предстоящи плащания',
    en: 'Upcoming payments',
  },
  'wallet.advice': {
    bg: 'Съвети',
    en: 'Advice',
  },
  'wallet.settings': {
    bg: 'Настройки на алармата',
    en: 'Alert settings',
  },
  'wallet.alertThreshold': {
    bg: 'Праг за аларма (% от печалбата)',
    en: 'Alert threshold (% of profit)',
  },
  'wallet.saveThreshold': {
    bg: 'Запази прага',
    en: 'Save threshold',
  },
  'wallet.thresholdSaved': {
    bg: 'Прагът е запазен',
    en: 'Threshold saved',
  },
  'wallet.noEntries': {
    bg: 'Няма въведени лични разходи',
    en: 'No personal expenses recorded',
  },
  'wallet.noEntriesHint': {
    bg: 'Добавете първия разход, за да започне проследяването',
    en: 'Add your first expense to start tracking',
  },
  'wallet.deleteConfirm': {
    bg: 'Сигурни ли сте, че искате да изтриете този запис?',
    en: 'Are you sure you want to delete this entry?',
  },
  'wallet.entrySaved': {
    bg: 'Записът е запазен',
    en: 'Entry saved',
  },
  'wallet.entryDeleted': {
    bg: 'Записът е изтрит',
    en: 'Entry deleted',
  },
  'wallet.homeTeaserTitle': {
    bg: 'Лично тефтерче',
    en: 'Personal wallet',
  },
  'wallet.openShort': { bg: 'Отвори', en: 'Open' },
  'wallet.homeTeaserOpen': {
    bg: 'Отвори тефтерчето',
    en: 'Open wallet',
  },

  // ROI
  'roi.title': {
    bg: 'Възвръщаемост на вложеното',
    en: 'Return on what you put in',
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
    bg: 'Възвръщаемост',
    en: 'Return',
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
  'roi.analysisTitle': {
    bg: 'Какво ти връща бизнесът',
    en: 'What the business gives back',
  },
  'roi.whatMoved': {
    bg: 'Какво помръдна печалбата',
    en: 'What moved profit',
  },
  'roi.whatToDo': {
    bg: 'Какво можеш да направиш',
    en: 'What you can do',
  },
  'roi.aiAdvice': {
    bg: 'Съвет от AI',
    en: 'AI advice',
  },
  'roi.askAdvice': {
    bg: 'Поискай съвет от AI',
    en: 'Ask AI for advice',
  },
  'roi.askAdviceHint': {
    bg: 'По тези числа – пази се, докато данните не се променят.',
    en: 'From these numbers - kept until the data changes.',
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
  'budget.soFarNote': {
    bg: 'Похарченото е до {date} – с дела от заплатите и амортизацията за изминалите дни.',
    en: 'Spent is through {date} – with the share of payroll and depreciation for the days so far.',
  },
  'budget.expectedMonthEnd': { bg: 'Към края на месеца: ~{amount} €', en: 'By month end: ~{amount} €' },
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
    bg: 'Месечен лимит (€)',
    en: 'Monthly Limit (€)',
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
    bg: 'Сума (€)',
    en: 'Amount (€)',
  },
  'budget.dayOfMonth': {
    bg: 'Ден от месеца',
    en: 'Day of month',
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
    en: "Working VAT ledger for the accountant, grouped by VAT rate — the base for the monthly return",
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
  'auditLog.searchPlaceholder': {
    bg: 'Търси по потребител, доставчик или номер...',
    en: 'Search by user, supplier or number...',
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
  'auditLog.entityExpense': { bg: 'Разход без фактура', en: 'Expense without invoice' },
  'auditLog.entityPayroll': { bg: 'Ведомост', en: 'Payroll entry' },
  'auditLog.entityIssuedInvoice': {
    bg: 'Издадена фактура',
    en: 'Issued invoice',
  },
  'auditLog.entityIssuedCreditNote': {
    bg: 'Кредитно известие към клиент',
    en: 'Credit note to a customer',
  },
  'auditLog.entityInvoice': {
    bg: 'фактура',
    en: 'invoice',
  },
  'auditLog.entityInvoices': {
    bg: 'фактури',
    en: 'invoices',
  },
  'auditLog.restore': {
    bg: 'Възстанови',
    en: 'Restore',
  },
  'auditLog.restored': {
    bg: 'Възстановена',
    en: 'Restored',
  },
  'auditLog.restoreConfirmTitle': {
    bg: 'Възстановяване на фактура',
    en: 'Restore invoice',
  },
  'auditLog.restoreConfirmMessage': {
    bg: 'Фактурата ще бъде добавена отново, точно както е била преди изтриването.',
    en: 'The invoice will be added back exactly as it was before it was deleted.',
  },
  'auditLog.restoreSuccess': {
    bg: 'Фактурата е възстановена',
    en: 'Invoice restored',
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
  'users.headerTitle': {
    bg: 'Потребители',
    en: 'Users',
  },
  'users.ownerOnlyAccess': {
    bg: 'Само титулярят има достъп до тази секция',
    en: 'Only the owner has access to this section',
  },
  'users.enterEmailOrPhone': {
    bg: 'Въведете имейл или телефон',
    en: 'Enter email or phone',
  },
  'users.copied': {
    bg: 'Копирано!',
    en: 'Copied!',
  },
  'users.codeCopiedToClipboard': {
    bg: 'Кодът е копиран в клипборда',
    en: 'Code copied to clipboard',
  },
  'users.shareInviteMessage': {
    bg: 'Поканен сте да се присъедините към {company}!\n\nКод за достъп: {code}\n\nОтворете приложението Фактура+ и въведете кода в Профил → Фирма → Присъединяване по покана.',
    en: 'You are invited to join {company}!\n\nAccess code: {code}\n\nOpen the Fakturaplus app and enter the code in Profile → Company → Join by Invitation.',
  },
  'users.cancelInvitationTitle': {
    bg: 'Отмяна на покана',
    en: 'Cancel Invitation',
  },
  'users.approvalRequired': {
    bg: 'Изисква се одобрение',
    en: 'Approval required',
  },
  'users.accessUpdated': {
    bg: 'Достъпът е обновен',
    en: 'Access updated',
  },
  'users.removeTitle': {
    bg: 'Премахване',
    en: 'Remove',
  },
  'users.removeOwnerWarning': {
    bg: '{name} е собственик. Премахването ще създаде заявка, която трябва да бъде одобрена от другите собственици.',
    en: '{name} is an owner. Removal will create a request that the other owners must approve.',
  },
  'users.removeConfirmNamed': {
    bg: 'Сигурни ли сте, че искате да премахнете {name}?',
    en: 'Are you sure you want to remove {name}?',
  },
  'users.sendRequest': {
    bg: 'Изпрати заявка',
    en: 'Send request',
  },
  'users.executed': {
    bg: 'Изпълнено',
    en: 'Executed',
  },
  'users.executedMessage': {
    bg: 'Заявката получи всички нужни одобрения и беше изпълнена.',
    en: 'The request received all required approvals and was executed.',
  },
  'users.companyMembers': {
    bg: 'Членове на фирмата',
    en: 'Company Members',
  },
  'users.pendingInvitations': {
    bg: 'Чакащи покани',
    en: 'Pending Invitations',
  },
  'users.code': {
    bg: 'Код',
    en: 'Code',
  },
  'users.inviteUser': {
    bg: 'Покани потребител',
    en: 'Invite User',
  },
  'users.emailLabel': {
    bg: 'Имейл',
    en: 'Email',
  },
  'users.or': {
    bg: '— или —',
    en: '— or —',
  },
  'users.phoneLabel': {
    bg: 'Телефон',
    en: 'Phone',
  },
  'users.createInvitation': {
    bg: 'Създай покана',
    en: 'Create Invitation',
  },
  'users.invitationCreated': {
    bg: 'Поканата е създадена!',
    en: 'Invitation Created!',
  },
  'users.shareCodeHint': {
    bg: 'Споделете кода с поканения потребител:',
    en: 'Share this code with the invited user:',
  },
  'users.copy': {
    bg: 'Копирай',
    en: 'Copy',
  },
  'users.share': {
    bg: 'Сподели',
    en: 'Share',
  },
  'users.done': {
    bg: 'Готово',
    en: 'Done',
  },

  'profile.payrollDesc': { bg: 'Служители и месечни ведомости', en: 'Employees and monthly payroll' },
  'profile.absencesDesc': { bg: 'Работа на празници, отпуски и болнични за счетоводителя', en: 'Holiday work, leave and sick leave for the accountant' },
  'profile.workSchedule': { bg: 'Работен график', en: 'Work schedule' },
  'profile.workScheduleDesc': { bg: 'Смени и почасово заплащане', en: 'Shifts and hourly pay' },
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
  'payroll.importPdfButton': { bg: 'Импортирай ведомост (PDF)', en: 'Import payslip (PDF)' },
  'payroll.importPdfTitle': { bg: 'Импорт на ведомост от PDF', en: 'Import payslip from PDF' },
  'payroll.importPdfHint': {
    bg: 'Качете PDF ведомостта, която получавате от счетоводителя (управителска или за служители) - данните ще бъдат разпознати автоматично.',
    en: 'Upload the payslip PDF your accountant sends you (management or staff) - the data will be recognized automatically.',
  },
  'payroll.importPdfPickFile': { bg: 'Избери PDF файл', en: 'Choose PDF file' },
  'payroll.importPdfAnalyzing': { bg: 'Анализираме ведомостта...', en: 'Analyzing the payslip...' },
  'payroll.importPdfPeriod': { bg: 'Период: {month}/{year}', en: 'Period: {month}/{year}' },
  'payroll.importPdfReviewHint': {
    bg: 'Проверете разпознатите данни и изберете служител за всеки ред, преди да импортирате.',
    en: 'Review the recognized data and pick an employee for each row before importing.',
  },
  'payroll.importPdfEgn': { bg: 'ЕГН', en: 'National ID' },
  'payroll.importPdfGross': { bg: 'Бруто', en: 'Gross' },
  'payroll.importPdfTax': { bg: 'Данък', en: 'Tax' },
  'payroll.importPdfNet': { bg: 'Нето', en: 'Net' },
  'payroll.importPdfAlreadyImported': { bg: 'Вече е импортирано за този период', en: 'Already imported for this period' },
  'payroll.importPdfSkip': { bg: 'Пропусни', en: 'Skip' },
  'payroll.importPdfNewEmployee': { bg: '+ Нов служител', en: '+ New employee' },
  'payroll.importedBadge': { bg: 'От ведомост (PDF)', en: 'From payslip (PDF)' },
  'payroll.importPdfCommit': { bg: 'Импортирай {count} записа', en: 'Import {count} entries' },
  'payroll.importPdfNoneSelected': {
    bg: 'Изберете служител поне за един ред, за да продължите.',
    en: 'Pick an employee for at least one row to continue.',
  },
  'payroll.importPdfPickDifferent': { bg: 'Избери друг файл', en: 'Choose a different file' },
  'payroll.importPdfCommitting': { bg: 'Импортираме...', en: 'Importing...' },
  'payroll.importPdfDone': { bg: 'Импортирани {imported} от {total} записа', en: 'Imported {imported} of {total} entries' },
  'payroll.importPdfSkippedCount': { bg: '{count} пропуснати (вече съществуват)', en: '{count} skipped (already exist)' },
  'payroll.linkedAccount': { bg: 'Свързан акаунт в екипа', en: 'Linked team account' },
  'payroll.linkedAccountHint': {
    bg: 'По избор - свържете този служител с неговия акаунт в приложението, за да работи графикът и проверката за отпуска в "Работен график".',
    en: 'Optional - link this employee to their own app account so Work Schedule can check their shifts against recorded leave.',
  },
  'payroll.noLinkedAccount': { bg: 'Без връзка', en: 'Not linked' },
  'payroll.noPosition': { bg: 'Без длъжност', en: 'No position' },
  'payroll.netShort': { bg: '· нето', en: '· net' },
  'payroll.grossShort': { bg: '· бруто', en: '· gross' },
  'payroll.process': { bg: 'Начисли за месеца', en: 'Process for this month' },
  'payroll.netAmount': { bg: 'Нетно за получаване', en: 'Net take-home' },
  'payroll.totalEmployerCost': { bg: 'Общ разход за работодателя', en: 'Total employer cost' },
  'payroll.countedInExpenses': { bg: 'Отразява се в разходите', en: 'Counts toward expenses' },
  'payroll.payTeam': { bg: 'Плати екипа', en: 'Pay the team' },

  // Pay run - one action for everyone due this month, mixing fixed
  // salary (formal payroll) and hourly (Work Schedule) team members.
  'payRun.doublePayTitle': { bg: 'Вече е платено за този месец', en: 'Already paid for this month' },
  'payRun.payAnyway': { bg: 'Плати и това', en: 'Pay this too' },
  'payRun.payAnywayCount': { bg: 'Плати и тях ({count}) – отделни плащания са', en: 'Pay them too ({count}) – they are separate payments' },
  'payRun.title': { bg: 'Плащане на екипа', en: 'Pay the team' },
  'payRun.allPaid': { bg: 'Всички са платени за този месец', en: 'Everyone is paid for this month' },
  'payRun.fixedSalary': { bg: 'Фиксирана заплата', en: 'Fixed salary' },
  'payRun.hourly': { bg: 'Почасово по график', en: 'Hourly (Work Schedule)' },
  'payRun.pickAtLeastOne': { bg: 'Изберете поне един служител', en: 'Pick at least one person' },
  'payRun.processError': { bg: 'Неуспешно обработване на плащанията', en: 'Could not process the payments' },
  'payRun.resultsTitle': { bg: 'Резултат', en: 'Result' },
  'payRun.processSelected': { bg: 'Плати {count} ({amount} €)', en: 'Pay {count} ({amount} €)' },
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
  'profile.receivablesDesc': { bg: 'Кой колко ти дължи и от кога', en: 'Who owes you how much, and since when' },
  'profile.billingDocumentsDesc': { bg: 'Нефискални оферти и сметки за клиенти', en: 'Non-fiscal quotes and bills for customers' },
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
  'assets.purchaseInvoice': { bg: 'Фактура за покупката', en: 'Purchase invoice' },
  'assets.linkInvoice': { bg: 'Свържи с фактура', en: 'Link an invoice' },
  'assets.invoiceSearchPlaceholder': { bg: 'Доставчик или номер на фактура', en: 'Supplier or invoice number' },
  'assets.noInvoicesFound': { bg: 'Няма намерени фактури', en: 'No invoices found' },
  'assets.invoiceTaken': { bg: 'към друг актив', en: 'on another asset' },
  'assets.invoiceShort': { bg: 'Фактура', en: 'Invoice' },
  'assets.purchaseInvoiceHint': {
    bg: 'Свързаната фактура не се брои като разход в деня си – разходът е амортизацията, месец по месец. ДДС от нея остава данъчен кредит.',
    en: 'The linked invoice is not an expense of its day – the depreciation is, month by month. Its VAT stays a tax credit.',
  },
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
  'companySwitcher.addAnother': { bg: 'Добави нова фирма', en: 'Add another company' },
  'companySwitcher.newCompanyHint': {
    bg: 'Създава отделна нова фирма, на която ставате собственик - остава ви пълен достъп и до текущата, превключвайте между тях по всяко време.',
    en: 'Creates a separate new company that you become the owner of - you keep full access to your current one too, and can switch between them any time.',
  },
  'companySwitcher.newCompanyMissingFields': { bg: 'Въведете име и ЕИК на новата фирма', en: 'Enter the new company\'s name and EIK' },
  'companySwitcher.newCompanyCreated': { bg: 'Новата фирма е създадена', en: 'The new company was created' },
  'invitations.roleAccountant': { bg: 'Счетоводител', en: 'Accountant' },
  'invitations.accountantHint': { bg: 'Достъп до статистики, фактури, ведомости и ДМА на тази фирма, без право да управлява потребители или данните на фирмата. Може да работи с няколко фирми клиенти от един акаунт.', en: "Access to this company's statistics, invoices, payroll and fixed assets, without managing users or company settings. Can work across several client companies from one account." },
  'invitations.permissionsTitle': { bg: 'Права на достъп', en: 'Access permissions' },
  'invitations.permissionsHint': { bg: 'Отметнати са правата по подразбиране за тази роля. Може да ги коригирате.', en: "The role's default permissions are pre-checked. You can adjust them." },
  'users.editAccess': { bg: 'Редакция на достъп', en: 'Edit access' },
  'users.role': { bg: 'Роля', en: 'Role' },
  'users.saveChanges': { bg: 'Запази промените', en: 'Save changes' },
  'users.ownerInviteHint': {
    bg: 'Съсобственик с пълни права. Добавянето е незабавно, но премахването на собственик по-късно ще изисква одобрение от всички останали собственици.',
    en: 'A co-owner with full rights. Adding is immediate, but removing an owner later will require approval from all other owners.',
  },
  'users.ownerDemoteHint': {
    bg: 'Този потребител е собственик. Промяната на ролята му ще създаде заявка, която трябва да бъде одобрена от другите собственици.',
    en: 'This user is an owner. Changing their role will create a request that the other owners must approve.',
  },
  'users.pendingOwnerActions': { bg: 'Чакащи заявки за собственост', en: 'Pending ownership requests' },
  'users.ownerActionSummary': { bg: '{requester} предлага {target} да получи роля: {action}', en: '{requester} proposes changing {target} to: {action}' },
  'users.ownerActionRemove': { bg: 'премахване от фирмата', en: 'removal from the company' },
  'users.ownerActionApprovals': { bg: 'Одобрения', en: 'Approvals' },
  'users.approve': { bg: 'Одобри', en: 'Approve' },
  'users.reject': { bg: 'Отхвърли', en: 'Reject' },

  'notifications.title': { bg: 'Известия за ДДС', en: 'VAT notifications' },
  'notifications.periodicTitle': { bg: 'Периодични известия', en: 'Periodic reminders' },
  'notifications.periodicSubtitle': { bg: 'Какво чака действие – на избрани дати от месеца', en: 'What waits for action – on chosen days of the month' },
  'notifications.periodicHint': {
    bg: 'Идва в {{time}}, в часа на сутрешния преглед, и тогава замества него. Ден след края на по-къс месец (напр. 31-во) идва в последния му ден.',
    en: 'Arrives at {{time}}, the morning review hour, and replaces it that day. A day past a shorter month\'s end (e.g. the 31st) arrives on its last day.',
  },
  'notifications.dailyTitle': { bg: 'Сутрешен преглед', en: 'Morning review' },
  'notifications.dailySubtitle': {
    bg: 'Веднъж на ден, само ако нещо важно чака – само с това, което ти имаш право да виждаш',
    en: 'Once a day, only when something important waits – only with what you are allowed to see',
  },
  'notifications.dailyHourLabel': { bg: 'В колко часа', en: 'At what time' },
  'notifications.dailyHourHint': {
    bg: 'Часът е по календара на бизнеса. След 21:00 не се изпраща нищо – пропусната сутрин не идва през нощта.',
    en: 'The time follows the business calendar. Nothing is sent after 21:00 – a missed morning never arrives at night.',
  },
  'notifications.selectDatesLabel': { bg: 'Изберете дати от месеца', en: 'Choose dates of the month' },
  'notifications.selectedDatesLabel': { bg: 'Избрани', en: 'Selected' },
  'notifications.pushInfo': { bg: 'Известията се изпращат като push нотификации. Уверете се, че сте ги разрешили.', en: 'Notifications are sent as push notifications. Make sure you have allowed them.' },
  'notifications.save': { bg: 'Запази настройки', en: 'Save settings' },
  'notifications.saved': { bg: 'Настройките са запазени', en: 'Settings saved' },
  'notifications.pushTitle': { bg: 'Push известия', en: 'Push notifications' },
  'notifications.pushSubtitle': { bg: 'Ново съобщение или напомняне се показва в известията на телефона', en: 'A new message or reminder shows up in your phone\'s notifications' },
  'notifications.pushDenied': { bg: 'Известията са блокирани за този сайт. Разрешете ги от настройките на браузъра.', en: 'Notifications are blocked for this site. Allow them in your browser settings.' },
  'notifications.pushError': { bg: 'Неуспешно включване на известията. Опитайте отново.', en: 'Could not enable notifications. Please try again.' },

  // Work schedule - self-visible to any team member (own shifts), create/edit
  // restricted to manage_budget (same tier as payroll/leave).
  'schedule.title': { bg: 'Работен график', en: 'Work schedule' },
  'schedule.wholeTeam': { bg: 'Целият екип', en: 'Whole team' },
  'schedule.hoursThisMonth': { bg: 'Часове този месец', en: 'Hours this month' },
  'schedule.estimatedPay': { bg: 'Прогнозно възнаграждение', en: 'Estimated pay' },
  'schedule.leaveDaysExcluded': {
    bg: '{count} смени са в дни на отпуск и не са включени в часовете и заплащането (освен ако не въведеш корекция с реално отработените часове).',
    en: '{count} shifts fall on leave days and are not counted in hours or pay (unless you record the hours actually worked).',
  },
  'schedule.shiftsThisMonth': { bg: 'Смени този месец', en: 'Shifts this month' },
  'schedule.noShifts': { bg: 'Няма планирани смени', en: 'No shifts scheduled' },
  'schedule.newShift': { bg: 'Нова смяна', en: 'New shift' },
  'schedule.editShift': { bg: 'Редактиране на смяна', en: 'Edit shift' },
  'schedule.member': { bg: 'Служител', en: 'Team member' },
  'schedule.date': { bg: 'Дата', en: 'Date' },
  'schedule.startTime': { bg: 'Начало', en: 'Start' },
  'schedule.endTime': { bg: 'Край', en: 'End' },
  'schedule.repeat': { bg: 'Повторение', en: 'Repeat' },
  'schedule.repeat_none': { bg: 'Еднократно', en: 'One-time' },
  'schedule.repeat_daily': { bg: 'Ежедневно', en: 'Daily' },
  'schedule.repeat_weekly': { bg: 'Ежеседмично', en: 'Weekly' },
  'schedule.repeat_monthly': { bg: 'Ежемесечно', en: 'Monthly' },
  'schedule.repeatUntil': { bg: 'До дата', en: 'Until' },
  'schedule.editAffectsSeries': {
    bg: 'Промените засягат цялата поредица смени, не само тази.',
    en: 'Changes affect the whole series of shifts, not just this one.',
  },
  'schedule.hourlyRate': { bg: 'Часова ставка (по избор)', en: 'Hourly rate (optional)' },
  'schedule.hourlyRatePlaceholder': { bg: 'напр. 10.00', en: 'e.g. 10.00' },
  'schedule.note': { bg: 'Бележка (по избор)', en: 'Note (optional)' },
  'schedule.notePlaceholder': { bg: 'Допълнителни детайли...', en: 'Additional details...' },
  'schedule.leaveConflict': { bg: 'Служителят има одобрена отпуска тази дата', en: 'This team member has approved leave on this date' },
  'schedule.deleteTitle': { bg: 'Изтриване на смяна', en: 'Delete shift' },
  'schedule.deleteConfirm': {
    bg: 'Да изтрием ли тази смяна (и цялата ѝ поредица, ако се повтаря)?',
    en: 'Delete this shift (and its whole repeating series, if any)?',
  },
  'schedule.pickMemberError': { bg: 'Изберете служител', en: 'Pick a team member' },
  'schedule.repeatUntilError': { bg: 'Крайната дата е преди началната', en: 'The end date is before the start date' },
  'schedule.saveError': { bg: 'Неуспешно запазване на смяната', en: 'Could not save the shift' },
  'schedule.adjustTitle': { bg: 'Корекция на отработени часове', en: 'Correct worked hours' },
  'schedule.scheduled': { bg: 'По график', en: 'Scheduled' },
  'schedule.actualHours': { bg: 'Реално отработени часове', en: 'Actual hours worked' },
  'schedule.actualRate': { bg: 'Часова ставка за този ден (по избор)', en: "This day's hourly rate (optional)" },
  'schedule.adjustReason': { bg: 'Причина за корекцията', en: 'Reason for the correction' },
  'schedule.adjustReasonPlaceholder': { bg: 'напр. напусна по-рано, дошъл е по-късно, спор за часовете...', en: 'e.g. left early, came in late, dispute over the hours...' },
  'schedule.adjustHoursError': { bg: 'Въведете валидни часове', en: 'Enter valid hours' },
  'schedule.adjustReasonError': { bg: 'Моля, посочете причина за корекцията', en: 'Please give a reason for the correction' },
  'schedule.adjustSaveError': { bg: 'Неуспешна корекция', en: 'Could not save the correction' },
  'schedule.adjustedBy': { bg: 'Коригирано от {name}', en: 'Corrected by {name}' },
  'schedule.revert': { bg: 'Върни по график', en: 'Revert to scheduled' },
  'schedule.revertTitle': { bg: 'Връщане по график', en: 'Revert to scheduled' },
  'schedule.revertConfirm': { bg: 'Да върнем ли часовете по график за този ден?', en: "Revert this day's hours back to the schedule?" },
  'schedule.markPaid': { bg: 'Маркирай като платено', en: 'Mark as paid' },
  'schedule.markPaidTitle': { bg: 'Маркиране като платено', en: 'Mark as paid' },
  'schedule.markPaidConfirm': {
    bg: 'Това ще добави {amount} € като реален разход за този месец. Продължи?',
    en: 'This will add {amount} € as a real expense for this month. Continue?',
  },
  'schedule.markPaidError': { bg: 'Неуспешно маркиране като платено', en: 'Could not mark as paid' },
  'schedule.paidLabel': { bg: 'Платено {amount} € на {date}', en: 'Paid {amount} € on {date}' },
  'schedule.undoPaid': { bg: 'Отмени', en: 'Undo' },
  'schedule.undoPaidTitle': { bg: 'Отмяна на плащане', en: 'Undo payment' },
  'schedule.undoPaidConfirm': {
    bg: 'Това ще премахне и свързания разход от общите разходи. Продължи?',
    en: 'This will also remove the linked expense from total business expenses. Continue?',
  },

  // Grid ("plug and play") week view - an alternative to the day-grouped
  // list above, modeled after a paper weekly schedule: employees as rows,
  // days as columns, a colored block per shift.
  'schedule.viewList': { bg: 'Списък', en: 'List' },
  'schedule.viewGrid': { bg: 'Решетка', en: 'Grid' },
  'schedule.thisWeek': { bg: 'Тази седмица', en: 'This week' },
  'schedule.gridEmptyTeam': { bg: 'Добавете служители в екипа, за да ги видите тук', en: 'Add team members to see them here' },
  'schedule.gridTapHint': {
    bg: 'Докоснете празна клетка за смяна, задръжте за отпуска',
    en: 'Tap an empty cell for a shift, hold it for leave',
  },
  'schedule.leaveType_paid': { bg: 'Платена', en: 'Paid' },
  'schedule.leaveType_unpaid': { bg: 'Неплатена', en: 'Unpaid' },
  'schedule.leaveType_sick': { bg: 'Болнична', en: 'Sick' },
  'schedule.leaveShort_paid': { bg: 'Отпуск', en: 'Leave' },
  'schedule.leaveShort_unpaid': { bg: 'Неплат.', en: 'Unpaid' },
  'schedule.leaveShort_sick': { bg: 'Болнич.', en: 'Sick' },
  'schedule.leaveType': { bg: 'Вид отсъствие', en: 'Leave type' },
  'schedule.startDate': { bg: 'От дата', en: 'Start date' },
  'schedule.endDate': { bg: 'До дата', en: 'End date' },
  'schedule.addLeaveTitle': { bg: 'Нова отпуска', en: 'New leave' },
  'schedule.leaveSaveError': { bg: 'Неуспешно запазване на отпуската', en: 'Could not save the leave' },
  'schedule.addShiftAnyway': { bg: 'Добави смяна все пак', en: 'Add shift anyway' },
  'schedule.deleteLeave': { bg: 'Изтрий отпуската', en: 'Delete leave' },
  'schedule.deleteLeaveTitle': { bg: 'Изтриване на отпуска', en: 'Delete leave' },
  'schedule.deleteLeaveConfirm': { bg: 'Да изтрием ли тази отпуска?', en: 'Delete this leave entry?' },
  'schedule.noLinkedEmployeeTitle': { bg: 'Няма връзка с ведомостта', en: 'Not linked to payroll' },
  'schedule.noLinkedEmployeeHint': {
    bg: 'За да добавите отпуска, свържете този служител с картон във "Ведомост".',
    en: 'To log leave, link this team member to a payroll record in Payroll.',
  },
  'schedule.edit': { bg: 'Редактирай', en: 'Edit' },
  'schedule.adjustShort': { bg: 'Коригирай часове', en: 'Correct hours' },
  'schedule.copyShift': { bg: 'Копирай в други дни', en: 'Copy to other days' },
  'schedule.copyShiftTitle': { bg: 'Копиране на смяна', en: 'Copy shift' },
  'schedule.copyShiftHint': { bg: 'Избери дните от тази седмица, в които да се приложи същата смяна', en: 'Pick the days this week to apply the same shift to' },
  'schedule.copyShiftApply': { bg: 'Приложи', en: 'Apply' },
  'schedule.copyShiftNoneSelected': { bg: 'Изберете поне един ден', en: 'Pick at least one day' },
  'schedule.copyShiftResult': { bg: 'Добавени смени: {ok}, неуспешни: {fail}', en: 'Shifts added: {ok}, failed: {fail}' },

  // Team member profile - opened by tapping an avatar (e.g. in the work
  // schedule grid). Manager-only, aggregates identity + schedule stats +
  // leave history, plus private positive/negative performance notes.
  'teamProfile.loadError': { bg: 'Неуспешно зареждане на профила', en: 'Could not load the profile' },
  'teamProfile.memberSince': { bg: 'В екипа от {date}', en: 'On the team since {date}' },
  'teamProfile.position': { bg: 'Длъжност', en: 'Position' },
  'teamProfile.hireDate': { bg: 'Нает на', en: 'Hired on' },
  'teamProfile.noEmployeeLink': { bg: 'Няма свързан картон във ведомостта', en: 'Not linked to a payroll record' },
  'teamProfile.thisMonth': { bg: 'Този месец', en: 'This month' },
  'teamProfile.leaveCount': { bg: 'Отпуски (общо)', en: 'Leave entries (all time)' },
  'teamProfile.holidayWorkCount': { bg: 'Работа на празник (общо)', en: 'Holiday work (all time)' },
  'teamProfile.notesTitle': { bg: 'Бележки от мениджмънта', en: 'Management notes' },
  'teamProfile.notesHint': { bg: 'Видими само за мениджъри - служителят не ги вижда', en: 'Visible only to managers - the team member never sees these' },
  'teamProfile.netScore': { bg: 'Нетен резултат', en: 'Net score' },
  'teamProfile.addPositive': { bg: 'Позитивна', en: 'Positive' },
  'teamProfile.addNegative': { bg: 'Негативна', en: 'Negative' },
  'teamProfile.notePlaceholder': { bg: 'Кратко описание за анализ...', en: 'A short note for later analysis...' },
  'teamProfile.noteTextError': { bg: 'Въведете текст на бележката', en: 'Enter the note text' },
  'teamProfile.noteSaveError': { bg: 'Неуспешно запазване на бележката', en: 'Could not save the note' },
  'teamProfile.noNotes': { bg: 'Все още няма бележки', en: 'No notes yet' },
  'teamProfile.deleteNoteTitle': { bg: 'Изтриване на бележка', en: 'Delete note' },
  'teamProfile.deleteNoteConfirm': { bg: 'Тази бележка ще бъде изтрита безвъзвратно.', en: 'This note will be permanently deleted.' },

  // Calendar (shared team calendar - owner/manager/accountant)
  'calendar.title': { bg: 'Календар', en: 'Calendar' },
  'calendar.noEvents': { bg: 'Няма събития в този период', en: 'No events in this period' },
  'calendar.personal': { bg: 'Лично', en: 'Personal' },
  'calendar.shared': { bg: 'Споделено', en: 'Shared' },
  'calendar.sharedBy': { bg: 'Споделено от', en: 'Shared by' },
  'calendar.newEvent': { bg: 'Ново събитие', en: 'New event' },
  'calendar.editEvent': { bg: 'Редактиране на събитие', en: 'Edit event' },
  'calendar.eventTitle': { bg: 'Заглавие', en: 'Title' },
  'calendar.eventTitlePlaceholder': { bg: 'Напр. Среща с ДДС консултант', en: 'e.g. Meeting with VAT consultant' },
  'calendar.eventDescription': { bg: 'Описание (по избор)', en: 'Description (optional)' },
  'calendar.eventDescriptionPlaceholder': { bg: 'Допълнителни детайли...', en: 'Additional details...' },
  'calendar.eventDate': { bg: 'Дата', en: 'Date' },
  'calendar.specificTime': { bg: 'Конкретен час', en: 'Specific time' },
  'calendar.visibility': { bg: 'Видимост', en: 'Visibility' },
  'calendar.reminder': { bg: 'Напомняне', en: 'Reminder' },
  'calendar.reminder_none': { bg: 'Без', en: 'None' },
  'calendar.reminder_min15': { bg: '15 мин. преди', en: '15 min before' },
  'calendar.reminder_hour1': { bg: '1 час преди', en: '1 hour before' },
  'calendar.reminder_day1': { bg: '1 ден преди', en: '1 day before' },
  'calendar.titleRequired': { bg: 'Моля, въведете заглавие', en: 'Please enter a title' },
  'calendar.deleteTitle': { bg: 'Изтриване на събитие', en: 'Delete event' },
  'calendar.deleteConfirm': { bg: 'Сигурни ли сте, че искате да изтриете това събитие?', en: 'Are you sure you want to delete this event?' },

  // Closed days (weekly pattern + one-off exceptions, excluded from daily-average stats)
  'closedDays.title': { bg: 'Почивни дни', en: 'Closed days' },
  'closedDays.homeHint': {
    bg: 'За по-точно изчисление на средния оборот е добре да попълвате календара редовно - отбелязвайте кои дни сте затворени.',
    en: 'For a more accurate average turnover, fill in the calendar regularly - mark which days you were closed.',
  },
  'closedDays.weeklyTitle': { bg: 'Седмичен график', en: 'Weekly schedule' },
  'closedDays.weeklyHint': { bg: 'Отбележете кои дни от седмицата обичайно сте затворени - изключват се от средния дневен оборот в статистиките.', en: "Mark which weekdays you're normally closed - excluded from the average daily turnover in statistics." },
  'closedDays.weeklySaved': { bg: 'Седмичният график е запазен', en: 'Weekly schedule saved' },
  'closedDays.exceptionsTitle': { bg: 'Изключения в календара', en: 'Calendar exceptions' },
  'closedDays.exceptionsHint': { bg: 'Докоснете дата, за да я отбележите като извънредно затворена (напр. празник) или отворена въпреки седмичния график.', en: 'Tap a date to mark it as an extra closure (e.g. a holiday) or open despite the weekly schedule.' },
  'closedDays.legendWeekly': { bg: 'По график', en: 'By schedule' },
  'closedDays.legendClosed': { bg: 'Затворен', en: 'Closed' },
  'closedDays.legendOpen': { bg: 'Отворен', en: 'Open' },
  'closedDays.labelPlaceholder': { bg: 'Бележка (напр. Великден)', en: 'Note (e.g. Easter)' },
  'closedDays.markClosed': { bg: 'Отбележи като затворен', en: 'Mark as closed' },
  'closedDays.markOpen': { bg: 'Отбележи като отворен', en: 'Mark as open' },
  'closedDays.removeException': { bg: 'Премахни изключението', en: 'Remove exception' },
  'closedDays.statusDefaultOpen': { bg: 'По подразбиране: отворен ден', en: 'By default: open day' },
  'closedDays.statusDefaultClosed': { bg: 'По подразбиране: затворен ден (по седмичния график)', en: 'By default: closed day (weekly schedule)' },
  'closedDays.statusExceptionClosed': { bg: 'Изключение: затворен', en: 'Exception: closed' },
  'closedDays.statusExceptionOpen': { bg: 'Изключение: отворен', en: 'Exception: open' },

  // Employee holiday-work + leave tracking (accountant compliance list)
  'absences.title': { bg: 'Празници и отпуски', en: 'Holidays and leave' },
  'absences.holidayWorkTab': { bg: 'Празници', en: 'Holiday work' },
  'absences.leaveTab': { bg: 'Отпуски', en: 'Leave' },
  'absences.sickTab': { bg: 'Болнични', en: 'Sick leave' },
  'absences.noSick': { bg: 'Няма отбелязани болнични за тази година', en: 'No sick leave logged for this year' },
  'absences.addSick': { bg: 'Нов болничен', en: 'New sick leave' },
  'absences.editSick': { bg: 'Болничен', en: 'Sick leave' },
  'absences.editLeave': { bg: 'Отпуска', en: 'Leave' },
  'absences.sheetNumber': { bg: '№ на болничния лист', en: 'Sick note number' },
  'absences.sheetMissing': { bg: 'без № на листа', en: 'no sick note number' },
  'absences.sheetKind': { bg: 'Лист', en: 'Sick note' },
  'absences.sheetPrimary': { bg: 'Първичен', en: 'First' },
  'absences.sheetContinuation': { bg: 'Продължение', en: 'Continuation' },
  'absences.sickReason': { bg: 'Причина', en: 'Reason' },
  'absences.reason_illness': { bg: 'Общо заболяване', en: 'Illness' },
  'absences.reason_work_accident': { bg: 'Трудова злополука', en: 'Work accident' },
  'absences.reason_occupational': { bg: 'Професионална болест', en: 'Occupational disease' },
  'absences.reason_family_care': { bg: 'Гледане на болен близък', en: 'Caring for a sick relative' },
  'absences.reason_maternity': { bg: 'Бременност и раждане', en: 'Pregnancy and childbirth' },
  'absences.reason_other': { bg: 'Друго', en: 'Other' },
  'absences.sickDaysPreview': { bg: 'Календарни дни: {calendar} · работни дни: {working}', en: 'Calendar days: {calendar} · working days: {working}' },
  'absences.calendarDays': { bg: '{days} дни', en: '{days} days' },
  'absences.calendarDay': { bg: '1 ден', en: '1 day' },
  'absences.sickPrivacy': { bg: 'Без диагноза и ЕГН - не са нужни тук.', en: 'No diagnosis or personal number - they are not needed here.' },
  'absences.deleteSickConfirm': { bg: 'Да се изтрие ли болничният?', en: 'Delete this sick leave?' },
  'absences.leaveDaysOnly': { bg: 'Работни дни: {days}', en: 'Working days: {days}' },
  'absences.noHolidayWork': { bg: 'Няма отбелязана работа на празници за тази година', en: 'No holiday work logged for this year' },
  'absences.noLeave': { bg: 'Няма отбелязани отпуски за тази година', en: 'No leave logged for this year' },
  'absences.balanceTitle': { bg: 'Остатък от платения отпуск', en: 'Paid leave left' },
  'absences.balanceLeft': { bg: 'остават {days} дни', en: '{days} days left' },
  'absences.balanceOver': { bg: 'надвишен с {days} дни', en: 'over by {days} days' },
  'absences.balanceDetail': {
    bg: '{entitlement} за годината + {carried} прехвърлени · ползвани {used} · планирани {planned}',
    en: '{entitlement} for the year + {carried} carried over · used {used} · booked {planned}',
  },
  'absences.leaveSettingsTitle': { bg: 'Платен отпуск - {name}', en: 'Paid leave - {name}' },
  'absences.annualDays': { bg: 'Дни платен отпуск годишно', en: 'Paid leave days a year' },
  'absences.carriedInto': { bg: 'Неизползвани дни, прехвърлени към {year}', en: 'Unused days carried into {year}' },
  'absences.carriedHint': {
    bg: 'Отпускът се брои в работни дни, от годината, в която служителят е добавен тук - неизползваните дни от по-рано въведете тук.',
    en: 'Leave counts in working days, from the year the employee was added here - enter the unused days from before here.',
  },
  'absences.leaveDaysPreview': { bg: 'Работни дни: {days} · ще останат {left}', en: 'Working days: {days} · {left} will be left' },
  'absences.addEntry': { bg: 'Добави запис', en: 'Add entry' },
  'absences.addHolidayWork': { bg: 'Работа на празник', en: 'Holiday work' },
  'absences.addLeave': { bg: 'Нова отпуска', en: 'New leave' },
  'absences.employee': { bg: 'Служител', en: 'Employee' },
  'absences.noEmployees': { bg: 'Нямате добавени служители', en: 'No employees added yet' },
  'absences.holiday': { bg: 'Празник', en: 'Holiday' },
  'absences.leaveType': { bg: 'Вид отсъствие', en: 'Leave type' },
  'absences.startDate': { bg: 'От дата', en: 'Start date' },
  'absences.endDate': { bg: 'До дата', en: 'End date' },
  'absences.note': { bg: 'Бележка', en: 'Note' },
  'absences.notePlaceholder': { bg: 'По избор', en: 'Optional' },
  'absences.endBeforeStart': { bg: 'Крайната дата е преди началната', en: 'End date is before the start date' },
  'absences.deleteHolidayWorkConfirm': { bg: 'Да се изтрие ли записът за работа на празник?', en: 'Delete this holiday-work entry?' },
  'absences.deleteLeaveConfirm': { bg: 'Да се изтрие ли записът за отпуска?', en: 'Delete this leave entry?' },
  'absences.export': { bg: 'Експорт за счетоводителя', en: 'Export for the accountant' },
  'absences.exportHint': { bg: 'Excel файл с работата на празници, отпуските и болничните за избрания период', en: 'Excel file with holiday work, leave and sick leave for the selected period' },
  'absences.exportExcel': { bg: 'Изтегли Excel', en: 'Download Excel' },

  // Messages (team channel + direct messages)
  'messages.title': { bg: 'Съобщения', en: 'Messages' },
  'messages.noConversations': { bg: 'Все още няма разговори', en: 'No conversations yet' },
  'messages.noMessagesYet': { bg: 'Все още няма съобщения', en: 'No messages yet' },
  'messages.typeMessage': { bg: 'Напишете съобщение...', en: 'Type a message...' },
  'messages.newDm': { bg: 'Ново лично съобщение', en: 'New direct message' },
  'messages.noMembers': { bg: 'Няма колеги с достъп до тази функция', en: 'No teammates with access to this feature' },
  'messages.enablePushHint': { bg: 'Включете известията, за да не пропускате съобщения', en: 'Enable notifications so you don\'t miss messages' },

  // Account & Security screen
  'accountSecurity.title': { bg: 'Акаунт и сигурност', en: 'Account & Security' },
  'accountSecurity.enterCurrentPassword': { bg: 'Въведете текущата си парола', en: 'Enter your current password' },
  'accountSecurity.passwordMinLength': { bg: 'Паролата трябва да е поне 8 символа', en: 'Password must be at least 8 characters' },
  'accountSecurity.passwordComplexity': { bg: 'Паролата трябва да съдържа буква и цифра', en: 'Password must contain a letter and a digit' },
  'accountSecurity.passwordsDontMatch': { bg: 'Паролите не съвпадат', en: 'Passwords do not match' },
  'accountSecurity.passwordChanged': { bg: 'Паролата е сменена успешно', en: 'Password changed successfully' },
  'accountSecurity.passwordSet': { bg: 'Паролата е зададена успешно. Вече можете да влизате и с имейл.', en: 'Password set successfully. You can now also log in with email.' },
  'accountSecurity.changePassword': { bg: 'Смяна на парола', en: 'Change Password' },
  'accountSecurity.setPassword': { bg: 'Задаване на парола', en: 'Set Password' },
  'accountSecurity.updatePasswordHint': { bg: 'Актуализирайте паролата за вход', en: 'Update your login password' },
  'accountSecurity.googleSetPasswordHint': { bg: 'Влизате с Google. Задайте парола, за да можете да влизате и с имейл.', en: 'You sign in with Google. Set a password to also log in with email.' },
  'accountSecurity.currentPassword': { bg: 'Текуща парола', en: 'Current password' },
  'accountSecurity.newPassword': { bg: 'Нова парола', en: 'New password' },
  'accountSecurity.passwordHint': { bg: 'Поне 8 символа, с буква и цифра', en: 'At least 8 characters, with a letter and a digit' },
  'accountSecurity.confirmNewPassword': { bg: 'Потвърди нова парола', en: 'Confirm new password' },
  'accountSecurity.loginEmailIs': { bg: 'Имейлът за вход е ', en: 'Login email is ' },
  'accountSecurity.emailChangeUnavailable': { bg: '. Смяната на имейл не е налична в момента.', en: '. Changing the email is not available yet.' },
  'accountSecurity.changePasswordButton': { bg: 'Смени паролата', en: 'Change password' },
  'accountSecurity.setPasswordButton': { bg: 'Задай парола', en: 'Set password' },
  'accountSecurity.deleteAccountTitle': { bg: 'Изтриване на акаунта', en: 'Delete account' },
  'accountSecurity.deleteAccountHint': {
    bg: 'Трайно изтрива вашите лични данни (име, имейл, парола, снимка). Фирмените записи (фактури, служители и т.н.) остават, ако други хора ги ползват.',
    en: 'Permanently deletes your personal data (name, email, password, photo). Company records (invoices, employees, etc.) remain if other people use them.',
  },
  'accountSecurity.enterPasswordToDelete': { bg: 'Въведете паролата си, за да потвърдите изтриването', en: 'Enter your password to confirm deletion' },
  'accountSecurity.deleteAccountConfirm': {
    bg: 'Това действие е необратимо. Акаунтът ви и личните ви данни ще бъдат изтрити завинаги.',
    en: 'This action cannot be undone. Your account and personal data will be permanently deleted.',
  },
  'accountSecurity.deleteAccountConfirmButton': { bg: 'Да, изтрий акаунта', en: 'Yes, delete account' },
  'accountSecurity.deleteAccountButton': { bg: 'Изтрий акаунта', en: 'Delete account' },
  'accountSecurity.twoFactorTitle': { bg: 'Втора стъпка при вход', en: 'Two-step login' },
  'accountSecurity.twoFactorHint': {
    bg: 'След паролата - и код, който имате само вие. Някой с паролата ви пак не може да влезе.',
    en: 'After the password, a code only you have. Someone with your password still cannot log in.',
  },
  'accountSecurity.twoFactorRecommended': {
    bg: 'Препоръчително за собственика и управителя - те виждат целия бизнес.',
    en: 'Recommended for the owner and the manager - they see the whole business.',
  },
  'accountSecurity.twoFactorOnApp': { bg: 'Включена: код от приложение за кодове', en: 'On: a code from an authenticator app' },
  'accountSecurity.twoFactorOnEmail': { bg: 'Включена: код по имейл', en: 'On: a code by email' },
  'accountSecurity.recoveryCodesLeft': { bg: 'Оставащи резервни кодове: {count}', en: 'Recovery codes left: {count}' },
  'accountSecurity.useApp': { bg: 'С приложение за кодове', en: 'With an authenticator app' },
  'accountSecurity.useAppHint': {
    bg: 'Google Authenticator, Microsoft Authenticator, Authy и подобни - работи и без интернет.',
    en: 'Google Authenticator, Microsoft Authenticator, Authy and the like - works offline too.',
  },
  'accountSecurity.useEmail': { bg: 'С код по имейл', en: 'With a code by email' },
  'accountSecurity.emailUnavailable': { bg: 'Изпращането на имейли не е настроено на този сървър.', en: 'Sending email is not set up on this server.' },
  'accountSecurity.appSetupSteps': {
    bg: 'Добавете акаунт в приложението - с бутона по-долу или като въведете ключа ръчно. После напишете 6-цифрения код, който то показва.',
    en: 'Add an account in the app - with the button below or by typing the key. Then enter the 6-digit code it shows.',
  },
  'accountSecurity.openInApp': { bg: 'Отвори в приложението', en: 'Open in the app' },
  'accountSecurity.secretKey': { bg: 'Ключ', en: 'Key' },
  'accountSecurity.copyKey': { bg: 'Копирай ключа', en: 'Copy the key' },
  'accountSecurity.keyCopied': { bg: 'Ключът е копиран', en: 'Key copied' },
  'accountSecurity.emailCodeSent': { bg: 'Изпратихме код на {email}. Въведете го тук.', en: 'We sent a code to {email}. Enter it here.' },
  'accountSecurity.codePlaceholder': { bg: '6-цифрен код', en: '6-digit code' },
  'accountSecurity.turnOn': { bg: 'Включи', en: 'Turn on' },
  'accountSecurity.turnOff': { bg: 'Изключи втората стъпка', en: 'Turn off the second step' },
  'accountSecurity.turnOffHint': {
    bg: 'За да я изключите - паролата и код от приложението (или резервен код).',
    en: 'To turn it off - your password and a code from the app (or a recovery code).',
  },
  'accountSecurity.twoFactorOn': { bg: 'Втората стъпка е включена', en: 'Two-step login is on' },
  'accountSecurity.twoFactorOff': { bg: 'Втората стъпка е изключена', en: 'Two-step login is off' },
  'accountSecurity.recoveryTitle': { bg: 'Резервни кодове', en: 'Recovery codes' },
  'accountSecurity.recoveryHint': {
    bg: 'Запишете ги на сигурно място. Всеки влиза веднъж, ако нямате телефона. Показват се само сега.',
    en: 'Keep them somewhere safe. Each one logs in once if you do not have your phone. Shown only now.',
  },
  'accountSecurity.copyCodes': { bg: 'Копирай', en: 'Copy' },
  'accountSecurity.codesCopied': { bg: 'Кодовете са копирани', en: 'Codes copied' },
  'accountSecurity.savedThem': { bg: 'Записах ги', en: 'I saved them' },

  // Break-even and the day's target (Н5)
  'breakEven.title': { bg: 'Дневна цел', en: 'Today\'s target' },
  'breakEven.todayTarget': {
    bg: 'толкова трябва да продадеш днес, за да е месецът на нула. Днес досега: {amount}',
    en: 'is what today has to sell for the month to end at zero. Today so far: {amount}',
  },
  'breakEven.nextDaysTarget': {
    bg: 'на ден от следващия работен ден, за да е месецът на нула',
    en: 'a day from the next working day, for the month to end at zero',
  },
  'breakEven.missingAtEnd': { bg: 'не достигат, за да покрие месецът разходите си', en: 'short of the month\'s break-even' },
  'breakEven.reachedTitle': { bg: 'Месецът е на плюс', en: 'The month is in profit' },
  'breakEven.reachedText': { bg: 'разходите на месеца са покрити - оттук нататък всяка продажба носи печалба', en: 'above break-even - from here on every sale is profit' },
  'breakEven.monthLine': { bg: 'За месеца: {soFar} от {target}', en: 'This month: {soFar} of {target}' },
  'breakEven.daysLeft': { bg: 'остават {days} работни дни', en: '{days} working days left' },
  'breakEven.howTitle': { bg: 'Откъде идва числото', en: 'Where the number comes from' },
  'breakEven.payroll': { bg: 'Заплати и осигуровки', en: 'Payroll' },
  'breakEven.recurring': { bg: 'Периодични разходи', en: 'Recurring expenses' },
  'breakEven.depreciation': { bg: 'Амортизация', en: 'Depreciation' },
  'breakEven.fixedTotal': { bg: 'Постоянни разходи за месеца', en: 'Fixed costs this month' },
  'breakEven.margin': { bg: 'Обичаен марж', en: 'Usual margin' },
  'breakEven.marginLastMonths': {
    bg: 'Маржът е от последните три пълни месеца: каква част от продажбите остава след стоката и материалите.',
    en: 'The margin is from the last three full months: the share of sales left after goods and materials.',
  },
  'breakEven.marginThisMonth': {
    bg: 'Маржът е от месеца досега - ще стане по-точен след първия пълен месец.',
    en: 'The margin is from the month so far - it gets more accurate after the first full month.',
  },
  'breakEven.formula': {
    bg: 'Точка на рентабилност = постоянни разходи ÷ марж. Оценка е: реалната печалба зависи от покупките през месеца.',
    en: 'Break-even = fixed costs ÷ margin. An estimate: the real profit depends on what is bought during the month.',
  },
  'breakEven.addFixedCosts': {
    bg: 'Добавете заплатите и периодичните разходи (наем, абонаменти), за да виждате дневната цел за излизане на нула.',
    en: 'Add payroll and recurring expenses (rent, subscriptions) to see the daily target for breaking even.',
  },

  // The VAT to pay on Home (backend routers/vat.py)
  'vat.title': { bg: 'ДДС за внасяне', en: 'VAT to pay' },
  'vat.reclaimTitle': { bg: 'ДДС за възстановяване', en: 'VAT to reclaim' },
  'vat.monthSoFar': { bg: 'За {month} досега', en: 'For {month} so far' },
  'vat.forMonth': { bg: 'За {month}', en: 'For {month}' },
  'vat.forPeriod': { bg: 'За периода', en: 'For the period' },
  'vat.payBy': { bg: 'плащане до {date}', en: 'pay by {date}' },
  'vat.expected': { bg: 'Очаквано за целия месец', en: 'Expected for the whole month' },
  'vat.expectedHint': { bg: 'прогнозата е по темпото досега', en: 'the forecast follows the pace so far' },
  'vat.toReclaim': { bg: 'за възстановяване', en: 'to reclaim' },
  'vat.parts': {
    bg: 'ДДС от продажби {sales} − за приспадане {purchases}',
    en: 'VAT on sales {sales} − deductible {purchases}',
  },
  'vat.previous': {
    bg: 'ДДС за {month}: {amount} – плащане до {date}',
    en: 'VAT for {month}: {amount} – pay by {date}',
  },
  'vat.previousReclaim': {
    bg: 'ДДС за {month}: {amount} за възстановяване – декларация до {date}',
    en: 'VAT for {month}: {amount} to reclaim – return by {date}',
  },

  // The period's margins on Home (backend routers/margins.py)
  'margins.title': { bg: 'Маржове', en: 'Margins' },
  'margins.gross': { bg: 'Брутен', en: 'Gross' },
  'margins.operating': { bg: 'Оперативен', en: 'Operating' },
  'margins.net': { bg: 'Нетен', en: 'Net' },
  'margins.pp': { bg: 'п.п.', en: 'pp' },
  'margins.ofSales': { bg: 'от {amount} продажби', en: 'of {amount} in sales' },
  'margins.ofSalesNoVat': { bg: 'от {amount} продажби без ДДС', en: 'of {amount} in sales excl. VAT' },
  'margins.versus': { bg: 'спрямо {range}', en: 'vs {range}' },
  'margins.sales': { bg: 'Продажби', en: 'Sales' },
  'margins.salesNoVat': { bg: 'Продажби без ДДС', en: 'Sales excl. VAT' },
  'margins.goods': { bg: 'Стока и материали', en: 'Goods and materials' },
  'margins.grossProfit': { bg: 'Брутна печалба', en: 'Gross profit' },
  'margins.payroll': { bg: 'Заплати и осигуровки', en: 'Payroll' },
  'margins.recurring': { bg: 'Периодични разходи (наем, ток, абонаменти)', en: 'Recurring costs (rent, utilities, subscriptions)' },
  'margins.depreciation': { bg: 'Амортизация', en: 'Depreciation' },
  'margins.operatingProfit': { bg: 'Оперативна печалба', en: 'Operating profit' },
  'margins.tax': { bg: 'Данък върху печалбата ({rate}%)', en: 'Profit tax ({rate}%)' },
  'margins.netProfit': { bg: 'Нетна печалба', en: 'Net profit' },
  'margins.grossHint': {
    bg: 'Брутен марж – колко остава от продажбите след стоката и материалите.',
    en: 'Gross margin – what is left of the sales after the goods and materials.',
  },
  'margins.operatingHint': {
    bg: 'Оперативен марж – и след заплатите, периодичните разходи и амортизацията.',
    en: 'Operating margin – also after payroll, recurring costs and depreciation.',
  },
  'margins.netHint': {
    bg: 'Нетен марж – и след данъка върху печалбата ({rate}%). Приблизителен: данъкът се дължи за цялата година.',
    en: 'Net margin – also after the profit tax ({rate}%). Approximate: the tax is due on the whole year.',
  },
  'margins.vatNote': {
    bg: 'Без ДДС – той е пари на държавата, не продажби. Затова оперативната печалба може да е по-малка от „Печалба“ горе.',
    en: 'Without VAT – it is the state\'s money, not sales. So the operating profit can be lower than Profit above.',
  },
  'margins.recurringNote': {
    bg: 'Периодичните разходи се броят по дни от месеца, като заплатите – маржът не пада в деня, в който е платен наемът.',
    en: 'Recurring costs count by the days of their month, like payroll – the margin does not drop on the day the rent is paid.',
  },
  'margins.noRunningCosts': {
    bg: 'Оперативният марж се показва, щом има въведени заплати, наем или други постоянни разходи – без тях е колкото брутния.',
    en: 'The operating margin shows once payroll, rent or other running costs are entered – without them it equals the gross margin.',
  },
  'margins.payrollExpected': {
    bg: 'Заплатите, които още не са въведени, се броят по заплатите в Екип: {amount}.',
    en: 'Salaries not entered yet count by the salaries in Team: {amount}.',
  },
  'margins.noRecurring': {
    bg: 'Добавете наема, тока и абонаментите като периодични разходи – дотогава се броят към стоката и брутният марж излиза по-нисък.',
    en: 'Add rent, utilities and subscriptions as recurring expenses – until then they count as goods and the gross margin reads lower.',
  },

  // The month's pack for the accountant (Н4)
  'accountantPack.title': { bg: 'Пакет за счетоводителя', en: 'Pack for the accountant' },
  'accountantPack.exportDesc': {
    bg: 'Покупки, продажби, издадени фактури, снимки и заплати за месеца - с проверка и изпращане по имейл',
    en: 'Purchases, sales, issued invoices, scans and payroll for the month - checked and sent by email',
  },
  'accountantPack.whatIsIn': { bg: 'Какво съдържа', en: 'What it holds' },
  'accountantPack.purchases': { bg: 'Покупки (фактури)', en: 'Purchases (invoices)' },
  'accountantPack.withScans': { bg: '{count} (със снимка: {scanned})', en: '{count} ({scanned} scanned)' },
  'accountantPack.revenueDays': { bg: 'Дни с оборот', en: 'Days with revenue' },
  'accountantPack.issued': { bg: 'Издадени фактури', en: 'Invoices issued' },
  'accountantPack.creditNotes': { bg: 'Кредитни известия', en: 'Credit notes' },
  'accountantPack.payroll': { bg: 'Заплати (ведомости)', en: 'Payroll entries' },
  'accountantPack.check': { bg: 'Проверка', en: 'Check' },
  'accountantPack.allThere': { bg: 'Не липсва нищо', en: 'Nothing is missing' },
  'accountantPack.send': { bg: 'Изпращане', en: 'Sending' },
  'accountantPack.lastSent': { bg: 'Изпратен на {date} до {email}.', en: 'Sent on {date} to {email}.' },
  'accountantPack.emailPlaceholder': { bg: 'Имейл на счетоводителя', en: 'The accountant\'s email' },
  'accountantPack.enterEmail': { bg: 'Въведете имейла на счетоводителя', en: 'Enter the accountant\'s email' },
  'accountantPack.emailUnavailable': {
    bg: 'Изпращането на имейли не е настроено на този сървър - изтеглете пакета и го изпратете сами.',
    en: 'Sending email is not set up on this server - download the pack and send it yourself.',
  },
  'accountantPack.sendButton': { bg: 'Изпрати на счетоводителя', en: 'Send to the accountant' },
  'accountantPack.sent': { bg: 'Изпратено до {email}', en: 'Sent to {email}' },
  'accountantPack.download': { bg: 'Изтегли пакета (ZIP)', en: 'Download the pack (ZIP)' },
  'accountantPack.contents': {
    bg: 'В пакета: дневник на покупките и продажбите (Excel), издадените фактури и кредитни известия (PDF), снимките на покупките, заплатите (Excel) и справка с проверката.',
    en: 'In the pack: the purchases and sales ledger (Excel), the invoices and credit notes issued (PDF), the purchase scans, the payroll (Excel) and a summary with the check.',
  },

  // Cash flow (Н1)
  'cashFlow.title': { bg: 'Паричен поток', en: 'Cash flow' },
  'cashFlow.moneyNow': { bg: 'Пари сега', en: 'Money now' },
  'cashFlow.enterMoneyNow': {
    bg: 'Колко пари има бизнесът сега - в брой и в банката? Прогнозата тръгва от тях.',
    en: 'How much money does the business have now - in cash and in the bank? The forecast starts from it.',
  },
  'cashFlow.enteredOn': { bg: 'Въведено на {date}. Обновявайте го, за да е точна прогнозата.', en: 'Entered on {date}. Keep it current for an accurate forecast.' },
  'cashFlow.cash': { bg: 'В брой', en: 'Cash' },
  'cashFlow.bank': { bg: 'В банката', en: 'In the bank' },
  'cashFlow.saveMoneyNow': { bg: 'Запази', en: 'Save' },
  'cashFlow.enterAmounts': { bg: 'Въведете сумите', en: 'Enter the amounts' },
  'cashFlow.positionSaved': { bg: 'Наличността е запазена', en: 'Money now saved' },
  'cashFlow.days': { bg: '{days} дни', en: '{days} days' },
  'cashFlow.runsShort': {
    bg: 'Около {date} парите може да не стигнат: най-ниско {amount} на {lowest}.',
    en: 'Around {date} the money may run short: lowest {amount} on {lowest}.',
  },
  'cashFlow.inDays': { bg: 'След {days} дни', en: 'In {days} days' },
  'cashFlow.lowest': { bg: 'Най-ниско ({date})', en: 'Lowest ({date})' },
  'cashFlow.comesIn': { bg: 'Идва', en: 'In' },
  'cashFlow.goesOut': { bg: 'Излиза', en: 'Out' },
  'cashFlow.usualRevenue': {
    bg: 'Обичаен оборот: средно {amount} на ден, общо {total} в периода.',
    en: 'Usual revenue: {amount} a day on average, {total} in the period.',
  },
  'cashFlow.overdueReceivables': {
    bg: 'Просрочени вземания {amount} не са в прогнозата - ако бъдат платени, ще има повече.',
    en: 'Overdue receivables of {amount} are not in the forecast - if paid, there will be more.',
  },
  'cashFlow.whatComesAndGoes': { bg: 'Какво идва и излиза', en: 'What comes and goes' },
  'cashFlow.nothingAhead': { bg: 'Няма плащания и постъпления напред.', en: 'Nothing to pay or receive ahead.' },
  'cashFlow.overdue': { bg: 'Просрочено - за плащане сега', en: 'Overdue - to pay now' },
  'cashFlow.kind.receivable': { bg: 'Вземане', en: 'Receivable' },
  'cashFlow.kind.revenue': { bg: 'Оборот', en: 'Revenue' },
  'cashFlow.kind.invoice': { bg: 'Фактура', en: 'Invoice' },
  'cashFlow.kind.recurring': { bg: 'Периодичен', en: 'Recurring' },
  'cashFlow.kind.payroll': { bg: 'Заплати', en: 'Payroll' },
  'cashFlow.kind.vat': { bg: 'ДДС', en: 'VAT' },
  'cashFlow.payDay': { bg: 'Ден за заплати', en: 'Pay day' },
  'cashFlow.payDayHint': {
    bg: 'На кое число плащате заплатите (31 = последният ден на месеца).',
    en: 'Which day of the month salaries are paid (31 = the last day of the month).',
  },
  'cashFlow.payDayInvalid': { bg: 'Въведете число от 1 до 31', en: 'Enter a number from 1 to 31' },
  'cashFlow.payDaySaved': { bg: 'Денят за заплати е запазен', en: 'Pay day saved' },
  'cashFlow.fromStatement': { bg: 'Обнови от банково извлечение', en: 'Update from a bank statement' },
  'cashFlow.kind.subscription': { bg: 'Абонамент', en: 'Subscription' },
  'cashFlow.kind.personal': { bg: 'Лично', en: 'Personal' },

  // Scanning without a connection (Н12)
  'scanQueue.offlineTitle': { bg: 'Няма връзка с интернет', en: 'No internet connection' },
  'scanQueue.offlineText': {
    bg: 'Снимката е направена. Добавете още страници, ако има, и я запазете - ще бъде разпозната сама, щом се появи връзка, и ще ви чака тук за преглед.',
    en: 'The photo is taken. Add more pages if there are any and save it - it is read on its own once the connection is back and waits here to be reviewed.',
  },
  'scanQueue.saveForLater': { bg: 'Запази и снимай следваща', en: 'Save and scan the next one' },
  'scanQueue.saved': { bg: 'Запазено - ще се разпознае, щом има връзка', en: 'Saved - it is read once there is a connection' },
  'scanQueue.saveFailed': { bg: 'Снимката не може да се запази на устройството', en: 'The photo could not be kept on the device' },
  'scanQueue.title': { bg: 'Снимки, направени без връзка ({count})', en: 'Photos taken offline ({count})' },
  'scanQueue.readNow': { bg: 'Разпознай сега', en: 'Read now' },
  'scanQueue.status.waiting': { bg: 'Ще се разпознае, щом има връзка', en: 'Read once there is a connection' },
  'scanQueue.status.reading': { bg: 'Разпознава се…', en: 'Reading…' },
  'scanQueue.status.ready': { bg: 'Разпозната - чака преглед', en: 'Read - waiting for review' },
  'scanQueue.status.failed': { bg: 'Не беше разпозната', en: 'Could not be read' },
  'scanQueue.failed': { bg: 'Не беше разпозната - опитайте пак', en: 'Could not be read - try again' },
  'scanQueue.review': { bg: 'Прегледай', en: 'Review' },
  'scanQueue.retry': { bg: 'Опитай пак', en: 'Try again' },
  'scanQueue.readyToast': { bg: 'Разпознати снимки: {count} - чакат преглед в „Сканиране“', en: 'Photos read: {count} - waiting for review in "Scan"' },
  'scanQueue.deleteTitle': { bg: 'Изтриване на снимката', en: 'Delete the photo' },
  'scanQueue.deleteBody': { bg: 'Снимката ще бъде изтрита от устройството, без да се записва фактура.', en: 'The photo is deleted from the device and no invoice is saved.' },

  // The business's locations (Н11)
  'locations.title': { bg: 'Обекти', en: 'Locations' },
  'locations.menuDesc': { bg: 'Магазини, обекти, клонове - всеки поотделно и един до друг', en: 'Shops, sites, branches - each on its own and side by side' },
  'locations.intro': {
    bg: 'Ако бизнесът ви има повече от едно място - магазини, обекти, клонове - въведете ги тук. Оборотът, покупките, разходите, издадените документи и служителите могат да се отбелязват към обект, а тук ги виждате един до друг. Обектите заедно с общата част винаги дават същите числа като Статистиката.',
    en: 'If your business has more than one place - shops, sites, branches - add them here. Revenue, purchases, expenses, issued documents and employees can be marked for a location, and here you see them side by side. The locations together with the shared part always add up to the same numbers as Statistics.',
  },
  'locations.empty': { bg: 'Още няма обекти. Без тях програмата работи както досега - за целия бизнес.', en: 'No locations yet. Without them the program works as before - for the whole business.' },
  'locations.add': { bg: 'Нов обект', en: 'New location' },
  'locations.name': { bg: 'Име на обекта', en: 'Location name' },
  'locations.namePlaceholder': { bg: 'напр. Магазин Център', en: 'e.g. Downtown shop' },
  'locations.nameRequired': { bg: 'Посочете името на обекта', en: 'Enter the location name' },
  'locations.address': { bg: 'Адрес (по желание)', en: 'Address (optional)' },
  'locations.saved': { bg: 'Обектът е запазен', en: 'Location saved' },
  'locations.manage': { bg: 'Обектите ви', en: 'Your locations' },
  'locations.closed': { bg: 'затворен', en: 'closed' },
  'locations.close': { bg: 'Затвори обекта', en: 'Close the location' },
  'locations.closeHint': {
    bg: 'Затворен обект не се предлага в новите записи, а въведеното за него остава негово.',
    en: 'A closed location is not offered for new records; what was entered for it stays its.',
  },
  'locations.reopen': { bg: 'Отвори отново', en: 'Reopen' },
  'locations.reopened': { bg: 'Обектът е отворен отново', en: 'Location reopened' },
  'locations.closedToast': { bg: 'Обектът е затворен', en: 'Location closed' },
  'locations.deleteConfirm': {
    bg: 'Да изтрия ли обекта? Изтрива се само обект, за който няма въведени записи - иначе го затворете.',
    en: 'Delete this location? Only a location with nothing entered for it can be deleted - otherwise close it.',
  },
  'locations.period.month': { bg: 'Този месец', en: 'This month' },
  'locations.period.lastMonth': { bg: 'Миналия месец', en: 'Last month' },
  'locations.period.year': { bg: 'Тази година', en: 'This year' },
  'locations.income': { bg: 'Приходи', en: 'Income' },
  'locations.expense': { bg: 'Разходи', en: 'Expenses' },
  'locations.margin': { bg: 'Марж', en: 'Margin' },
  'locations.part.till': { bg: 'каса', en: 'till' },
  'locations.part.issued': { bg: 'издадени фактури', en: 'issued invoices' },
  'locations.part.purchases': { bg: 'покупки', en: 'purchases' },
  'locations.part.offBook': { bg: 'разходи без фактура', en: 'off-book expenses' },
  'locations.part.payroll': { bg: 'заплати', en: 'payroll' },
  'locations.perDay': { bg: '{amount} на ден с оборот ({days} дни)', en: '{amount} per day with revenue ({days} days)' },
  'locations.noRevenueDays': { bg: 'Няма въведен оборот за периода', en: 'No revenue entered for the period' },
  'locations.team': { bg: '{count} служители', en: '{count} employees' },
  'locations.teamOne': { bg: '1 служител', en: '1 employee' },
  'locations.shared': { bg: 'Общо, без обект', en: 'Shared, no location' },
  'locations.sharedHint': {
    bg: 'Каквото не е отбелязано към обект: амортизации, покупки за целия бизнес, дни, въведени преди да има обекти.',
    en: 'What is not marked for a location: depreciation, purchases for the whole business, days entered before there were locations.',
  },
  'locations.total': { bg: 'Целият бизнес', en: 'The whole business' },
  'locations.totalHint': { bg: 'Същите числа като в Статистиката за периода.', en: 'The same numbers as in Statistics for the period.' },
  'locations.pick': { bg: 'Обект', en: 'Location' },
  'locations.none': { bg: 'Без обект', en: 'No location' },
  'locations.noneWhole': { bg: 'За целия бизнес', en: 'Whole business' },
  'locations.noneShared': { bg: 'Без обект (общо)', en: 'No location (shared)' },
  'locations.noneTeam': { bg: 'Във всички обекти', en: 'At all locations' },
  'locations.employeeLabel': { bg: 'Работи в обект', en: 'Works at' },
  'locations.revenueHint': {
    bg: 'Въвеждате оборота на този обект за деня - общият оборот на деня е сборът от обектите.',
    en: "You enter this location's revenue for the day - the day's total is the sum of the locations.",
  },
  'locations.revenueNoneHint': {
    bg: 'Частта от деня, която не е на никой обект (например въведена преди да има обекти).',
    en: 'The part of the day that belongs to no location (for example, entered before there were locations).',
  },

  // The business's own deadlines (Н10)
  'deadlines.title': { bg: 'Срокове', en: 'Deadlines' },
  'deadlines.menuDesc': { bg: 'Застраховки, прегледи, договори, срокове към счетоводителя', en: 'Insurance, inspections, contracts, dates for the accountant' },
  'deadlines.intro': {
    bg: 'Вашите срокове - въвеждате ги вие, с колко дни по-рано да ви напомня програмата и дали се повтарят. Програмата не тълкува закони, само ви напомня за датите, които сте задали.',
    en: 'Your deadlines - you enter them, how many days ahead to be reminded and whether they repeat. The program reads no law, it only reminds you of the dates you set.',
  },
  'deadlines.empty': { bg: 'Още няма срокове. Добавете с „+“.', en: 'No deadlines yet. Add one with "+".' },
  'deadlines.overdue': { bg: 'Просрочени', en: 'Overdue' },
  'deadlines.soon': { bg: 'Наближават', en: 'Coming up' },
  'deadlines.later': { bg: 'По-нататък', en: 'Later' },
  'deadlines.done': { bg: 'Приключени', en: 'Finished' },
  'deadlines.inDays': { bg: 'след {days} дни', en: 'in {days} days' },
  'deadlines.today': { bg: 'днес', en: 'today' },
  'deadlines.tomorrow': { bg: 'утре', en: 'tomorrow' },
  'deadlines.lateBy': { bg: 'просрочен с {days} дни', en: '{days} days late' },
  'deadlines.markDone': { bg: 'Готово', en: 'Done' },
  'deadlines.doneNext': { bg: 'Отбелязано. Следващият срок е {date}.', en: 'Done. The next one is {date}.' },
  'deadlines.doneFinal': { bg: 'Отбелязано като приключено.', en: 'Marked as finished.' },
  'deadlines.add': { bg: 'Нов срок', en: 'New deadline' },
  'deadlines.what': { bg: 'Какво', en: 'What' },
  'deadlines.whatPlaceholder': { bg: 'напр. Застраховка на обекта', en: 'e.g. Building insurance' },
  'deadlines.date': { bg: 'Дата', en: 'Date' },
  'deadlines.repeat': { bg: 'Повтаря се', en: 'Repeats' },
  'deadlines.repeat.none': { bg: 'Еднократно', en: 'Once' },
  'deadlines.repeat.monthly': { bg: 'Всеки месец', en: 'Monthly' },
  'deadlines.repeat.quarterly': { bg: 'На 3 месеца', en: 'Quarterly' },
  'deadlines.repeat.half_yearly': { bg: 'На 6 месеца', en: 'Every 6 months' },
  'deadlines.repeat.yearly': { bg: 'Всяка година', en: 'Yearly' },
  'deadlines.remind': { bg: 'Напомни ми ... дни по-рано', en: 'Remind me ... days before' },
  'deadlines.amount': { bg: 'Сума (по желание)', en: 'Amount (optional)' },
  'deadlines.notes': { bg: 'Бележка', en: 'Note' },
  'deadlines.next': { bg: 'Следващи: {dates}', en: 'Next: {dates}' },
  'deadlines.saved': { bg: 'Срокът е запазен', en: 'Deadline saved' },
  'deadlines.invalid': { bg: 'Посочете какво и дата', en: 'Enter what and a date' },
  'deadlines.deleteConfirm': { bg: 'Срокът ще бъде изтрит.', en: 'The deadline will be deleted.' },
  'deadlines.category.insurance': { bg: 'Застраховка', en: 'Insurance' },
  'deadlines.category.inspection': { bg: 'Преглед', en: 'Inspection' },
  'deadlines.category.contract': { bg: 'Договор', en: 'Contract' },
  'deadlines.category.accountant': { bg: 'Счетоводство', en: 'Accounting' },
  'deadlines.category.tax': { bg: 'Данъци и такси', en: 'Taxes and fees' },
  'deadlines.category.license': { bg: 'Разрешително', en: 'License' },
  'deadlines.category.other': { bg: 'Друго', en: 'Other' },
  'briefing.cta.deadlines': { bg: 'Виж сроковете', en: 'View the deadlines' },

  // The business's own selling prices (Н8)
  'priceList.title': { bg: 'Ценоразпис и марж', en: 'Prices and margin' },
  'priceList.intro': {
    bg: 'Вашите продажни цени - същите във фактурите, сметките и офертите. Посочете от какво е направен всеки артикул и програмата ще смята себестойността от последните покупки и ще каже, когато доставчик поскъпне.',
    en: 'Your selling prices - the same on invoices, bills and quotes. Say what each one is made of and the program works out its cost from the latest purchases and tells you when a supplier gets dearer.',
  },
  'priceList.empty': { bg: 'Още няма цени. Добавете с „+“ или от продаваното досега по-долу.', en: 'No prices yet. Add one with "+" or from what was sold so far below.' },
  'priceList.withVat': { bg: '{amount} с ДДС', en: '{amount} with VAT' },
  'priceList.withoutVat': { bg: '{amount} без ДДС', en: '{amount} without VAT' },
  'priceList.perUnit': { bg: 'за 1 {unit}', en: 'per {unit}' },
  'priceList.margin': { bg: 'Марж {percent}%', en: 'Margin {percent}%' },
  'priceList.cost': { bg: 'Себестойност {amount}', en: 'Cost {amount}' },
  'priceList.noCost': { bg: 'Без себестойност - посочете от какво е', en: 'No cost yet - say what it is made of' },
  'priceList.dropped': {
    bg: 'Маржът падна от {then}% на {now}%. За същия марж: {price}.',
    en: 'The margin fell from {then}% to {now}%. To keep it: {price}.',
  },
  'priceList.setNew': { bg: 'Нова цена {price}', en: 'New price {price}' },
  'priceList.keep': { bg: 'Остави цената', en: 'Keep the price' },
  'priceList.sold': { bg: 'Продавано, но без цена в списъка', en: 'Sold, but not in the list' },
  'priceList.add': { bg: 'Нова цена', en: 'New price' },
  'priceList.name': { bg: 'Име', en: 'Name' },
  'priceList.unit': { bg: 'Мярка', en: 'Unit' },
  'priceList.price': { bg: 'Цена без ДДС', en: 'Price without VAT' },
  'priceList.priceNoVat': { bg: 'Цена', en: 'Price' },
  'priceList.vatRate': { bg: 'ДДС %', en: 'VAT %' },
  'priceList.madeOf': { bg: 'От какво е (за 1 {unit})', en: 'Made of (per {unit})' },
  'priceList.madeOfHint': {
    bg: 'Изберете купените артикули от фактурите на доставчиците и колко от всеки влиза в 1 продаван (напр. 0.009 кг кафе и 0.15 л мляко).',
    en: 'Pick the items bought on supplier invoices and how much of each goes into one sold (e.g. 0.009 kg of coffee and 0.15 l of milk).',
  },
  'priceList.searchPurchase': { bg: 'Търси купен артикул…', en: 'Search a purchased item…' },
  'priceList.lastBought': { bg: 'последно {price} за {unit} · {supplier}', en: 'last {price} per {unit} · {supplier}' },
  'priceList.saved': { bg: 'Цената е запазена', en: 'Price saved' },
  'priceList.invalid': { bg: 'Въведете име и цена', en: 'Enter a name and a price' },
  'priceList.deleteConfirm': { bg: 'Цената излиза от ценоразписа. Издадените документи не се променят.', en: 'The price leaves the list. Documents issued stay as they are.' },
  'priceList.fromList': { bg: 'от ценоразписа', en: 'from the price list' },
  'briefing.cta.margins': { bg: 'Виж цените', en: 'View the prices' },

  // Payment reminders to customers (Н6)
  'reminders.title': { bg: 'Напомняния за плащане', en: 'Payment reminders' },
  'reminders.intro': {
    bg: 'Програмата предлага напомняне на падежа, 7 и 14 дни след него. Прочетете го, променете каквото искате и изпратете - нищо не тръгва само.',
    en: 'The program suggests a reminder on the due date, 7 and 14 days after it. Read it, change what you like and send it - nothing goes by itself.',
  },
  'reminders.emailOff': {
    bg: 'Изпращането на имейли не е настроено - копирайте текста или го споделете и после отбележете, че е изпратено.',
    en: 'Email is not set up - copy or share the text, then mark it as sent.',
  },
  'reminders.suggested': { bg: 'За изпращане сега', en: 'To send now' },
  'reminders.other': { bg: 'Други неплатени след падежа', en: 'Other unpaid past the due date' },
  'reminders.none': { bg: 'Няма неплатени документи след падежа.', en: 'Nothing unpaid past its due date.' },
  'reminders.stage.due': { bg: 'Падеж днес', en: 'Due today' },
  'reminders.stage.week': { bg: '7 дни след падежа', en: '7 days past due' },
  'reminders.stage.two_weeks': { bg: '14 дни след падежа', en: '14 days past due' },
  'reminders.dueOn': { bg: 'падеж {date}', en: 'due {date}' },
  'reminders.daysLate': { bg: 'закъснение {days} дни', en: '{days} days late' },
  'reminders.left': { bg: 'Остават', en: 'Left' },
  'reminders.email': { bg: 'Имейл на клиента', en: 'Customer email' },
  'reminders.subject': { bg: 'Тема', en: 'Subject' },
  'reminders.message': { bg: 'Текст', en: 'Message' },
  'reminders.withPdf': { bg: 'Документът се прилага като PDF.', en: 'The document goes along as a PDF.' },
  'reminders.send': { bg: 'Изпрати', en: 'Send' },
  'reminders.sendAgain': { bg: 'Изпрати напомняне', en: 'Send a reminder' },
  'reminders.share': { bg: 'Сподели текста', en: 'Share the text' },
  'reminders.markSent': { bg: 'Изпратих го по друг начин', en: 'I sent it another way' },
  'reminders.skip': { bg: 'Пропусни', en: 'Skip' },
  'reminders.sent': { bg: 'Напомнянето е изпратено до {email}', en: 'Reminder sent to {email}' },
  'reminders.recorded': { bg: 'Отбелязано', en: 'Noted' },
  'reminders.copied': { bg: 'Текстът е копиран', en: 'The text was copied' },
  'reminders.enterEmail': { bg: 'Въведете имейла на клиента', en: 'Enter the customer\'s email' },
  'reminders.last': { bg: 'Последно: {date} ({how})', en: 'Last: {date} ({how})' },
  'reminders.channel.email': { bg: 'имейл', en: 'email' },
  'reminders.channel.other': { bg: 'по друг начин', en: 'another way' },
  'reminders.channel.skipped': { bg: 'пропуснато', en: 'skipped' },
  'reminders.link': { bg: 'Напомняния за плащане', en: 'Payment reminders' },

  // Invoices that repeat (Н7)
  'recurringInvoices.title': { bg: 'Повтарящи се фактури', en: 'Repeating invoices' },
  'recurringInvoices.intro': {
    bg: 'Абонамент, наем, месечна услуга: всеки месец на избрания ден фактурата е готова - проверявате я и я издавате с едно докосване. Един месец никога не се издава два пъти.',
    en: 'A subscription, a rent, a monthly service: each month on the chosen day the invoice is ready - check it and issue it with one tap. A month is never issued twice.',
  },
  'recurringInvoices.empty': {
    bg: 'Няма повтарящи се фактури. Направете от издадена фактура - бутонът ↻ при нея в „Фактури, оферти и сметки“, или тук с „+“.',
    en: 'No repeating invoices yet. Make one from an issued invoice - its ↻ button in "Invoices, quotes and bills", or here with "+".',
  },
  'recurringInvoices.perMonth': { bg: '{amount} на месец', en: '{amount} a month' },
  'recurringInvoices.everyDay': { bg: 'всеки месец на {day}-о число', en: 'every month on day {day}' },
  'recurringInvoices.lastDay': { bg: 'всеки месец на последния ден', en: 'every month on its last day' },
  'recurringInvoices.state.ready': { bg: 'Готова за {month}', en: 'Ready for {month}' },
  'recurringInvoices.state.upcoming': { bg: 'Готова на {date}', en: 'Ready on {date}' },
  'recurringInvoices.state.issued': { bg: 'Издадена № {number}', en: 'Issued No. {number}' },
  'recurringInvoices.state.paused': { bg: 'На пауза', en: 'Paused' },
  'recurringInvoices.state.ended': { bg: 'Приключила', en: 'Ended' },
  'recurringInvoices.issue': { bg: 'Издай за {month}', en: 'Issue for {month}' },
  'recurringInvoices.issueNow': { bg: 'Издай сега', en: 'Issue now' },
  'recurringInvoices.confirmTitle': { bg: 'Издаване на фактура', en: 'Issue the invoice' },
  'recurringInvoices.confirmText': {
    bg: 'Фактура към {customer} за {amount}, с дата днес{due}.',
    en: 'An invoice to {customer} for {amount}, dated today{due}.',
  },
  'recurringInvoices.confirmDue': { bg: ' и падеж след {days} дни', en: ' and due in {days} days' },
  'recurringInvoices.issued': { bg: 'Издадена фактура № {number}', en: 'Invoice No. {number} issued' },
  'recurringInvoices.fromInvoice': { bg: 'От издадена фактура', en: 'From an issued invoice' },
  'recurringInvoices.pickInvoice': { bg: 'Изберете фактура за повтаряне', en: 'Choose an invoice to repeat' },
  'recurringInvoices.noInvoices': { bg: 'Още няма издадени фактури.', en: 'No invoices issued yet.' },
  'recurringInvoices.created': { bg: 'Фактурата ще се повтаря всеки месец', en: 'The invoice will repeat every month' },
  'recurringInvoices.makeRecurring': { bg: 'Повтаряй всеки месец', en: 'Repeat every month' },
  'recurringInvoices.makeRecurringText': {
    bg: 'Всеки месец на {day}-о число ще имате готова фактура към {customer} със същите редове - издавате я с едно докосване.',
    en: 'Every month on day {day} an invoice to {customer} with the same lines will be ready - issued with one tap.',
  },
  'recurringInvoices.edit': { bg: 'Повтаряща се фактура', en: 'Repeating invoice' },
  'recurringInvoices.day': { bg: 'Ден от месеца (31 = последният)', en: 'Day of the month (31 = the last)' },
  'recurringInvoices.dueDays': { bg: 'Дни за плащане', en: 'Days to pay' },
  'recurringInvoices.endMonth': { bg: 'Последен месец (ГГГГ-ММ, по желание)', en: 'Last month (YYYY-MM, optional)' },
  'recurringInvoices.active': { bg: 'Активна', en: 'Active' },
  'recurringInvoices.lines': { bg: 'Редове', en: 'Lines' },
  'recurringInvoices.monthHint': { bg: '„{месец}“ в ред или бележка става месецът: „Абонамент за ноември 2026“.', en: '"{month}" in a line or note becomes the month: "Subscription for November 2026".' },
  'recurringInvoices.notes': { bg: 'Бележка', en: 'Note' },
  'recurringInvoices.addLine': { bg: 'Добави ред', en: 'Add a line' },
  'recurringInvoices.history': { bg: 'Издадени: {list}', en: 'Issued: {list}' },
  'recurringInvoices.deleteConfirm': {
    bg: 'Фактурата спира да се повтаря. Издадените досега остават.',
    en: 'The invoice stops repeating. Those issued so far stay.',
  },
  'recurringInvoices.saved': { bg: 'Запазено', en: 'Saved' },
  'recurringInvoices.invalid': { bg: 'Проверете деня, дните за плащане и редовете', en: 'Check the day, the days to pay and the lines' },
  'receivables.fromStatement': { bg: 'Плащания от банково извлечение', en: 'Payments from a bank statement' },

  // A bank statement (Н2)
  'bankStatement.title': { bg: 'Банково извлечение', en: 'Bank statement' },
  'bankStatement.intro': {
    bg: 'Изтеглете извлечението от онлайн банкирането като CSV, Excel (.xlsx), MT940 или XML (CAMT.053). Програмата ще намери кое движение коя неплатена фактура от доставчик плаща и кое вземане от клиент покрива. Нищо не се записва, преди да потвърдите.',
    en: 'Download the statement from online banking as CSV, Excel (.xlsx), MT940 or XML (CAMT.053). The program finds which unpaid supplier invoice each movement pays and which customer debt it settles. Nothing is saved until you confirm.',
  },
  'bankStatement.pick': { bg: 'Избери файл', en: 'Choose a file' },
  'bankStatement.reading': { bg: 'Чета извлечението…', en: 'Reading the statement…' },
  'bankStatement.period': { bg: '{count} движения · {from} – {to}', en: '{count} movements · {from} – {to}' },
  'bankStatement.moneyIn': { bg: 'Постъпления', en: 'Money in' },
  'bankStatement.moneyOut': { bg: 'Плащания', en: 'Money out' },
  'bankStatement.skipped': { bg: '{count} реда не можаха да се прочетат - проверете ги в банката.', en: '{count} rows could not be read - check them in the bank.' },
  'bankStatement.otherCurrency': {
    bg: '{count} движения в друга валута са пропуснати - програмата работи в евро.',
    en: '{count} movements in another currency were left out - the program works in euro.',
  },
  'bankStatement.onlyReceivables': {
    bg: 'Виждате само вземанията от клиенти - плащанията към доставчици се отразяват от човек с право да управлява фактури.',
    en: 'You see only customer debts - payments to suppliers are recorded by someone who manages invoices.',
  },
  'bankStatement.onlyInvoices': {
    bg: 'Виждате само фактурите от доставчици - постъпленията от клиенти се отразяват от човек с право да въвежда приходи.',
    en: 'You see only supplier invoices - money from customers is recorded by someone who enters revenue.',
  },
  'bankStatement.section.sure': { bg: 'Сигурни съвпадения', en: 'Certain matches' },
  'bankStatement.section.sureHint': { bg: 'Отметнати са - махнете отметката, ако нещо не е вярно.', en: 'Ticked - untick anything that is not right.' },
  'bankStatement.section.ask': { bg: 'За проверка', en: 'To check' },
  'bankStatement.section.askHint': { bg: 'Вероятни, но не сигурни - отметнете, каквото е вярно.', en: 'Likely, not certain - tick what is right.' },
  'bankStatement.section.entered': { bg: 'Вече въведени', en: 'Already entered' },
  'bankStatement.section.enteredHint': {
    bg: 'Тези плащания вече са в програмата - няма да бъдат записани втори път.',
    en: 'These payments are already in the program - they will not be recorded a second time.',
  },
  'bankStatement.section.none': { bg: 'Без документ', en: 'No document' },
  'bankStatement.section.noneHint': {
    bg: 'Няма неплатен документ за тях (такси, заплати, разходи без фактура…). Програмата не прави разход от тях - ако е разход, въведете го ръчно.',
    en: 'No unpaid document for them (fees, salaries, expenses without an invoice…). The program makes no expense of them - enter one by hand if it is.',
  },
  'bankStatement.section.applied': { bg: 'Отразени от това извлечение', en: 'Recorded from this statement' },
  'bankStatement.reason.number_amount': { bg: 'Номерът на документа и сумата съвпадат', en: 'The document number and the sum match' },
  'bankStatement.reason.numbers_amount': { bg: 'Номерата на документите и сумата съвпадат', en: 'The document numbers and the sum match' },
  'bankStatement.reason.name_amount': { bg: 'Контрагентът и сумата съвпадат', en: 'The other side and the sum match' },
  'bankStatement.reason.name_all': { bg: 'Плаща всички документи на контрагента', en: 'Pays all of the other side\'s documents' },
  'bankStatement.reason.number_partial': { bg: 'Плаща част от документа', en: 'Pays part of the document' },
  'bankStatement.reason.name_partial': { bg: 'Плаща част от документа', en: 'Pays part of the document' },
  'bankStatement.reason.number_over': { bg: 'Сумата е повече от дължимото - отразява се дължимото', en: 'More than is owed - what is owed is recorded' },
  'bankStatement.reason.number_amount_one_of': { bg: 'Сумата съвпада с един от посочените документи', en: 'The sum matches one of the documents named' },
  'bankStatement.reason.numbers_partial': { bg: 'Посочени са няколко документа - сумата не стига за всички', en: 'Several documents named - the sum does not cover them all' },
  'bankStatement.reason.name_amount_several': { bg: 'Няколко документа са с тази сума - изберете кой', en: 'Several documents have this sum - choose which' },
  'bankStatement.reason.name_combined': { bg: 'Сумата съвпада с няколко документа заедно', en: 'The sum matches several documents together' },
  'bankStatement.reason.name_no_amount': { bg: 'Контрагентът има неплатени документи, но сумата не съвпада', en: 'The other side has unpaid documents, but the sum does not match' },
  'bankStatement.reason.amount_only': { bg: 'Съвпада само сумата - проверете', en: 'Only the sum matches - check it' },
  'bankStatement.reason.no_match': { bg: 'Няма документ за това движение', en: 'No document for this movement' },
  'bankStatement.reason.by_hand': { bg: 'Въведено на ръка на {date} ({amount})', en: 'Entered by hand on {date} ({amount})' },
  'bankStatement.reason.other_statement': { bg: 'Отразено от друго извлечение', en: 'Recorded from another statement' },
  'bankStatement.recordAnyway': { bg: 'Друго плащане е - отрази и него', en: 'It is another payment - record it too' },
  'bankStatement.orChoose': { bg: 'Или изберете:', en: 'Or choose:' },
  'bankStatement.payFor': { bg: 'Отрази като плащане по:', en: 'Record as a payment on:' },
  'bankStatement.owes': { bg: 'остават {amount}', en: '{amount} left' },
  'bankStatement.balanceTitle': { bg: 'Наличност в банката', en: 'Money in the bank' },
  'bankStatement.balanceSet': {
    bg: 'Крайното салдо {amount} към {date} да стане наличността в банката (за паричния поток)',
    en: 'Make the closing balance {amount} on {date} the money in the bank (for the cash flow)',
  },
  'bankStatement.balanceNow': { bg: 'Сега в програмата: {amount} към {date}', en: 'Now in the program: {amount} on {date}' },
  'bankStatement.balanceNewer': {
    bg: 'В програмата има по-нова наличност ({amount} към {date}) - тя остава.',
    en: 'The program has a newer amount ({amount} on {date}) - it stays.',
  },
  'bankStatement.toRecord': { bg: 'Ще бъдат отразени {count} плащания', en: '{count} payments will be recorded' },
  'bankStatement.toSuppliers': { bg: 'към доставчици {amount}', en: 'to suppliers {amount}' },
  'bankStatement.fromCustomers': { bg: 'от клиенти {amount}', en: 'from customers {amount}' },
  'bankStatement.apply': { bg: 'Отрази', en: 'Record' },
  'bankStatement.nothingChosen': { bg: 'Не е избрано нищо за отразяване', en: 'Nothing chosen to record' },
  'bankStatement.doneTitle': { bg: 'Готово', en: 'Done' },
  'bankStatement.doneApplied': { bg: 'Отразени плащания: {count}', en: 'Payments recorded: {count}' },
  'bankStatement.doneAlready': { bg: 'Вече бяха отразени: {count}', en: 'Already recorded: {count}' },
  'bankStatement.doneBalance': { bg: 'Наличността в банката е обновена.', en: 'The money in the bank was updated.' },
  'bankStatement.doneFailed': { bg: 'Не бяха отразени:', en: 'Not recorded:' },
  'bankStatement.another': { bg: 'Друго извлечение', en: 'Another statement' },
  'bankStatement.close': { bg: 'Затвори', en: 'Close' },

  // What the business uses ("Какво ползвам")
  'modules.title': { bg: 'Какво ползва бизнесът', en: 'What the business uses' },
  'modules.hint': {
    bg: 'Изключете това, което не ползвате - изчезва от менютата, Начало и напомнянията. Въведеното остава и се връща, щом го включите отново.',
    en: 'Turn off what you do not use - it leaves the menus, Home and the reminders. What was entered stays and comes back when you turn it on again.',
  },
  'modules.till': { bg: 'Каса и джобче', en: 'Till and pocket money' },
  'modules.tillHint': { bg: 'Дневен оборот от касата, в брой и с карта, джобче, средно на ден', en: 'Daily till revenue, cash and card, pocket money, average per day' },
  'modules.billing': { bg: 'Издадени фактури и клиенти', en: 'Issued invoices and customers' },
  'modules.billingHint': { bg: 'Фактури, кредитни известия, сметки и оферти към клиенти; вземания', en: 'Invoices, credit notes, bills and quotes to customers; receivables' },
  'modules.team': { bg: 'Екип и график', en: 'Team and schedule' },
  'modules.teamHint': { bg: 'Работен график, календар и съобщения', en: 'Work schedule, calendar and messages' },
  'modules.payroll': { bg: 'Заплати и отпуски', en: 'Payroll and leave' },
  'modules.payrollHint': { bg: 'Служители, ведомости, изплащане, отпуски', en: 'Employees, payslips, pay runs, leave' },
  'modules.assets': { bg: 'Активи', en: 'Assets' },
  'modules.assetsHint': { bg: 'Дълготрайни активи и амортизация', en: 'Fixed assets and depreciation' },
  'modules.wallet': { bg: 'Лични пари на собственика', en: 'Owner\'s personal money' },
  'modules.walletHint': { bg: 'Личен портфейл и лични вложения в бизнеса', en: 'Personal wallet and personal money put into the business' },
  'home.billingTitle': { bg: 'Клиенти', en: 'Customers' },
  'home.newInvoice': { bg: 'Фактура', en: 'Invoice' },
  'home.billingIssued': { bg: 'Издадени фактури', en: 'Invoices issued' },
  'home.billingIssuedCount': { bg: '{count} бр.', en: '{count} issued' },
  'home.billingOwed': { bg: 'Дължат клиенти', en: 'Customers owe' },
  'home.billingOwedCount': { bg: '{count} бр.', en: '{count} open' },
  'home.billingOverdue': { bg: 'Просрочени', en: 'Overdue' },

  // Join Company screen
  'joinCompany.title': { bg: 'Присъединяване по покана', en: 'Join by Invitation' },
  'joinCompany.enterCode': { bg: 'Въведете код за покана', en: 'Enter an invitation code' },
  'joinCompany.invitationCode': { bg: 'Код за покана', en: 'Invitation code' },
  'joinCompany.receiveCodeHint': { bg: 'Получавате го от собственика на фирмата', en: 'You receive this from the company owner' },
  'joinCompany.join': { bg: 'Присъедини се', en: 'Join' },
  'joinCompany.codeValidityHint': { bg: 'Кодовете за покана са валидни 7 дни и могат да бъдат използвани само от имейла, за който са издадени (ако е зададен такъв).', en: 'Invitation codes are valid for 7 days and can only be used by the email they were issued to (if one was specified).' },
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

  // Stable across renders (only changes when the language itself does) - a
  // fresh t on every render breaks any useCallback/useEffect that lists it
  // as a dependency (e.g. a useFocusEffect-driven load()), causing that
  // effect to re-fire on every render instead of just on focus, which can
  // stomp local unsaved state with a freshly re-fetched server value.
  const t = useCallback((key: string): string => {
    const translation = translations[key];
    if (!translation) {
      console.warn(`Missing translation for key: ${key}`);
      return key;
    }
    return translation[language] || translation['bg'] || key;
  }, [language]);

  const dateLocale = language === 'bg' ? dateFnsBg : dateFnsEnUS;

  return { t, language, dateLocale };
}

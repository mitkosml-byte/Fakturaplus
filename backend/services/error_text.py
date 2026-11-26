"""The server's messages in English (English everywhere): every refusal the
server sends is written in Bulgarian at its place in the code; when the app
runs in English (it says so with the X-App-Language header) the message is
given in English instead - by its exact words, or by a pattern for the ones
with a number, a name or an amount in them. A message not found here goes
out as it is. tests/test_error_text.py keeps every message the code can
send covered.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from services.month_names import MONTHS_BG, MONTHS_EN

EXACT: Dict[str, str] = {
    'Нещо се обърка на сървъра. Опитайте отново.': 'Something went wrong on the server. Try again.',
    'AI акаунтът на приложението няма достатъчен баланс в момента. Моля, свържете се със системния администратор.': "The app's AI account has no balance right now. Please contact the system administrator.",
    'AI асистентът не може да отговори на този въпрос.': 'The AI assistant cannot answer this question.',
    'AI не можа да даде съвет за тези данни.': 'The AI could not give advice for these numbers.',
    'AI разпознаването временно не е налично. Моля, въведете данните ръчно.': 'AI recognition is temporarily unavailable. Please enter the data by hand.',
    'AI разпознаването временно не е налично. Моля, въведете оборота ръчно.': 'AI recognition is temporarily unavailable. Please enter the takings by hand.',
    'AI разпознаването не е конфигурирано правилно на сървъра. Моля, въведете данните ръчно.': 'AI recognition is not set up correctly on the server. Please enter the data by hand.',
    'AI услугата е временно претоварена. Моля, опитайте отново след малко.': 'The AI service is temporarily overloaded. Please try again in a moment.',
    'AI услугата е временно претоварена. Опитайте отново след малко.': 'The AI service is temporarily overloaded. Try again in a moment.',
    'AI услугата за разпознаване е временно претоварена. Моля, опитайте отново след малко.': 'The AI recognition service is temporarily overloaded. Please try again in a moment.',
    'AI функцията не е конфигурирана на сървъра.': 'The AI feature is not set up on the server.',
    'AI функцията не е конфигурирана правилно на сървъра.': 'The AI feature is not set up correctly on the server.',
    'PDF извлечение не се чете - изтеглете го от банката като CSV, Excel, MT940 или XML.': 'A PDF statement cannot be read - download it from the bank as CSV, Excel, MT940 or XML.',
    'XML файлът не може да бъде прочетен.': 'The XML file cannot be read.',
    'counted_in_expenses трябва да е true/false': 'counted_in_expenses must be true/false',
    'Активът не е намерен': 'Asset not found',
    'Алармата не е намерена': 'Alert not found',
    'Архивът е заключен с парола - въведете я': 'The backup is locked with a password - enter it',
    'Бележката не е намерена': 'Note not found',
    'В MT940 файла няма движения.': 'The MT940 file has no transactions.',
    'В XML файла няма банково извлечение (CAMT.053).': 'The XML file holds no bank statement (CAMT.053).',
    'В извлечението няма движения с дата и сума.': 'The statement has no transactions with a date and an amount.',
    'В извлечението няма движения.': 'The statement has no transactions.',
    'В този месец няма плащане по този разход': 'This expense has no payment in this month',
    'Вече е възстановена': 'Already restored',
    'Вече има активна покана за този контакт': 'There is already an active invitation for this contact',
    'Вече има ведомост за този служител за този месец': 'This employee already has payroll for this month',
    'Вече сте член на фирма. Първо напуснете текущата фирма.': 'You are already a member of a business. Leave your current business first.',
    'Вече съществува фактура с това ID': 'An invoice with this ID already exists',
    'Вземането вече е платено': 'The receivable is already paid',
    'Вземането не е намерено': 'Receivable not found',
    'Вие сте единственият собственик на фирма с други членове. Добавете друг собственик, преди да напуснете.': 'You are the only owner of a business with other members. Add another owner before you leave.',
    'Включете втора стъпка при вход (Профил → Сигурност), за да продължите.': 'Turn on a second step at sign-in (Profile → Security) to continue.',
    'Втората стъпка вече е включена': 'The second step is already on',
    'Втората стъпка не е включена': 'The second step is not on',
    'Въведете имейл или телефон': 'Enter an email or a phone number',
    'Въведете имейла на счетоводителя': "Enter the accountant's email",
    'Въведете код на поканата': 'Enter the invitation code',
    'Въведете код от приложението или резервен код': 'Enter a code from the app or a recovery code',
    'Въведете паролата си, за да потвърдите изтриването на акаунта': 'Enter your password to confirm deleting the account',
    'Въведете текущата парола': 'Enter your current password',
    'Въведи номера на известието, както е отпечатан': "Enter the note's number as printed",
    'Въведи номера на фактурата, както е отпечатан': "Enter the invoice's number as printed",
    'Възстановяването на парола временно не е налично. Моля, свържете се с администратора.': 'Password recovery is temporarily unavailable. Please contact the administrator.',
    'Въпросът е твърде дълъг.': 'The question is too long.',
    'Въпросът не може да бъде празен.': 'The question cannot be empty.',
    'Генерирането на Excel файлове не е налично на сървъра.': 'Excel files cannot be made on the server.',
    'Грешен код': 'Wrong code',
    'Грешен код - проверете часа на телефона и опитайте пак': 'Wrong code - check the time on your phone and try again',
    'Грешка при връзка с AI услугата за разпознаване.': 'Could not reach the AI recognition service.',
    'Грешка при връзка с AI услугата.': 'Could not reach the AI service.',
    'Грешка при разпознаване на ведомостта': 'The payroll could not be read',
    'Грешка при свързване с платежната система.': 'Could not reach the payment system.',
    'Грешна парола': 'Wrong password',
    'Грешна парола за архива': 'Wrong password for the backup',
    'Грешна текуща парола': 'Wrong current password',
    'Денят се записва в момента и от друг - опитайте отново': 'Someone else is saving this day right now - try again',
    'Дневният архив не е настроен': 'The daily backup is not set up',
    'Днес бяха изпратени много кодове - опитайте отново утре': 'Many codes were sent today - try again tomorrow',
    'Добавете поне един ред': 'Add at least one line',
    'Документът вече е анулиран': 'The document is already cancelled',
    'Документът вече съществува': 'The document already exists',
    'Документът е анулиран - платеното е за връщане': 'The document is cancelled - what was paid is to be returned',
    'Документът не е намерен': 'Document not found',
    'За обекта има въведени записи - затворете го вместо да го изтривате': 'This location has records - close it instead of deleting it',
    'Записът вече съществува': 'The record already exists',
    'Записът не е намерен': 'Record not found',
    'Започнете отначало - кодът изтече': 'Start again - the code has expired',
    'Заявката е твърде голяма за AI услугата.': 'The request is too large for the AI service.',
    'Заявката не е намерена': 'Request not found',
    'Изберете между 2 и 5 доставчика за сравнение': 'Choose between 2 and 5 suppliers to compare',
    'Изберете парола за архива - с нея се отваря файлът от имейла': 'Choose a password for the backup - it opens the file from the email',
    'Изберете фактурата, към която е известието': 'Choose the invoice the note is for',
    'Избраната дата не е официален празник': 'The chosen date is not an official holiday',
    'Избраният потребител не е от вашата фирма': 'The chosen user is not from your business',
    'Изображението е твърде голямо за AI услугата. Моля, използвайте по-малка снимка.': 'The picture is too large for the AI service. Please use a smaller photo.',
    'Изображението е твърде голямо. Моля, използвайте по-малка снимка (до ~10MB на страница).': 'The picture is too large. Please use a smaller photo (up to ~10MB per page).',
    'Изпращането на имейли не е настроено': 'Sending email is not set up',
    'Изпращането на имейли не е настроено - изпратете напомнянето по друг начин.': 'Sending email is not set up - send the reminder another way.',
    'Изпращането на имейли не е настроено - изтеглете пакета': 'Sending email is not set up - download the pack',
    'Изпращането на имейли не е настроено - ползвайте приложение за кодове': 'Sending email is not set up - use an authenticator app',
    'Имейлът не беше изпратен - опитайте отново след малко.': 'The email was not sent - try again in a moment.',
    'Имейлът не можа да бъде изпратен - опитайте пак или изтеглете пакета': 'The email could not be sent - try again or download the pack',
    'Името на клиента е задължително': "The customer's name is required",
    'Името трябва да е поне 2 символа': 'The name must be at least 2 characters',
    'Клиентът не е намерен': 'Customer not found',
    'Крайната дата е преди началната': 'The end date is before the start date',
    'Кредитното известие не е покупка - актив се свързва с фактурата, с която е купен': 'A credit note is not a purchase - an asset is linked to the invoice it was bought with',
    'Кредитното известие не може да е с дата преди фактурата': 'A credit note cannot be dated before its invoice',
    'Кредитното известие не се плаща': 'A credit note is not paid',
    'Към фактурата има кредитно известие - първо анулирайте него': 'The invoice has a credit note - cancel that first',
    'Липсва company_id': 'company_id is missing',
    'Липсва изображение': 'The picture is missing',
    'Месецът е във вида ГГГГ-ММ': 'The month is written as YYYY-MM',
    'Моля, посочете причина за корекцията': 'Please give a reason for the correction',
    'Наличността е за днес или минал ден': 'Stock is for today or a past day',
    'Напишете основанието (напр. отстъпка, върната стока)': 'Write the reason (e.g. a discount, returned goods)',
    'Не можах да разпозная фактурата': 'The invoice could not be recognised',
    'Не можах да разчета отчета - въведете оборота ръчно': 'The report could not be read - enter the takings by hand',
    'Не може да се промени ЕИК на фирма с други потребители': 'The EIK of a business with other users cannot be changed',
    'Не можете да премахнете единствения собственик на фирмата.': "You cannot remove the business's only owner.",
    'Не можете да премахнете себе си': 'You cannot remove yourself',
    'Не можете да променяте собствената си роля на собственик': 'You cannot change your own owner role',
    'Не намирам колоните на извлечението - трябват поне дата и сума (или дебит и кредит). Изтеглете го от банката като CSV или Excel.': "The statement's columns were not found - it needs at least a date and an amount (or debit and credit). Download it from the bank as CSV or Excel.",
    'Не сте влезли в системата': 'You are not signed in',
    'Не сте сред собствениците, чието одобрение се изисква за тази заявка': 'You are not among the owners whose approval this request needs',
    'Не сте член на фирма': 'You are not a member of a business',
    'Не успяхме да разпознаем лица във ведомостта. Моля, проверете файла или въведете данните ръчно.': 'No people could be recognised in the payroll. Please check the file or enter the data by hand.',
    'Невалиден ден': 'Invalid day',
    'Невалиден или изтекъл код': 'Invalid or expired code',
    'Невалиден или изтекъл код - поискайте нов': 'Invalid or expired code - ask for a new one',
    'Невалиден имейл адрес': 'Invalid email address',
    'Невалиден имейл или парола': 'Invalid email or password',
    'Невалиден месец': 'Invalid month',
    'Невалиден месец „в сила от“': 'Invalid "valid from" month',
    'Невалиден период': 'Invalid period',
    'Невалиден получател': 'Invalid recipient',
    'Невалиден срок за плащане': 'Invalid payment term',
    'Невалиден срок на офертата': 'Invalid validity of the quote',
    'Невалиден статус': 'Invalid status',
    'Невалиден тип бележка': 'Invalid note type',
    'Невалиден тип повторение': 'Invalid repeat type',
    'Невалиден формат на снимката': 'Invalid picture format',
    'Невалидна видимост': 'Invalid visibility',
    'Невалидна дата': 'Invalid date',
    'Невалидна дата - ден и месец': 'Invalid date - day and month',
    'Невалидна дата на издаване': 'Invalid issue date',
    'Невалидна роля за покана': 'Invalid role for an invitation',
    'Невалидна роля. Допустими: owner, manager, staff, accountant': 'Invalid role. Allowed: owner, manager, staff, accountant',
    'Невалидна сесия': 'Invalid session',
    'Невалидна стойност на ставка': 'Invalid rate value',
    'Невалидно действие за този сигнал': 'Invalid action for this signal',
    'Непознат пакет': 'Unknown package',
    'Непознат тип за импорт': 'Unknown import type',
    'Непознат тип за импорт.': 'Unknown import type.',
    'Нов код може след минута - проверете и папката за нежелана поща': 'A new code can be sent in a minute - check the spam folder too',
    'Нормата трябва да е положително число': 'The rate must be a positive number',
    'Няма архив за този ден': 'There is no backup for this day',
    'Няма данни за обновяване': 'No data to update',
    'Няма достъп': 'No access',
    'Няма запазени данни за възстановяване на тази фактура': 'No saved data to restore this invoice',
    'Няма запазени данни за възстановяване на този документ': 'No saved data to restore this document',
    'Няма запазени данни за възстановяване на този запис': 'No saved data to restore this record',
    'Няма изключение за тази дата': 'No exception for this date',
    'Няма корекция за тази дата': 'No adjustment for this date',
    'Няма отработени часове с положителна сума за този период': 'No hours worked with a positive amount in this period',
    'Няма промени': 'No changes',
    'Няма свързана фирма': 'No linked business',
    'Няма ставки в сила от този месец': 'No rates valid from this month',
    'Няма фирма': 'No business',
    'Нямате активна фирма': 'You have no active business',
    'Нямате достъп до тази фирма': 'You have no access to this business',
    'Нямате достъп до този разговор': 'You have no access to this conversation',
    'Нямате оставащи сканирания. Купете пакет, за да продължите.': 'You have no scans left. Buy a package to continue.',
    'Нямате права да виждате паричния поток': 'You may not see the cash flow',
    'Нямате права да виждате печалбата': 'You may not see the profit',
    'Нямате права да виждате статистиката': 'You may not see the statistics',
    'Нямате права да виждате чужд график': "You may not see someone else's schedule",
    'Нямате права за тази операция': 'You may not do this',
    'Нямате право да отхвърлите тази заявка': 'You may not reject this request',
    'Нямате свързана фирма. Първо създайте фирма.': 'You have no linked business. Create a business first.',
    'Нямате фирма': 'You have no business',
    'Обектът не е намерен': 'Location not found',
    'Оборотът за деня е разделен по ставки ДДС - въведете го по ставки или с една ставка за целия ден': "The day's takings are split by VAT rate - enter them by rate or with one rate for the whole day",
    'От офертата вече е направен документ - тя е приета': 'A document was already made from the quote - it is accepted',
    'От тази оферта вече е направен документ': 'A document was already made from this quote',
    'Отработените часове трябва да са положително число': 'Hours worked must be a positive number',
    'Отрицателна сума е възможна само при кредитно известие - изберете вида на документа': 'A negative amount is only possible on a credit note - choose the type of document',
    'Отчетът не можа да бъде разчетен - опитайте отново или го въведете ръчно.': 'The report could not be read - try again or enter it by hand.',
    'Офертата не е намерена': 'Quote not found',
    'Паролата трябва да е поне 8 символа': 'The password must be at least 8 characters',
    'Паролата трябва да съдържа поне една буква': 'The password must contain at least one letter',
    'Паролата трябва да съдържа поне една цифра': 'The password must contain at least one digit',
    'Периодичният разход започва от по-късен месец': 'The recurring expense starts from a later month',
    'Периодичният разход не е намерен': 'Recurring expense not found',
    'Периодът е твърде голям (максимум 5 години)': 'The period is too long (5 years at most)',
    'Платената сума не може да е отрицателна': 'The paid amount cannot be negative',
    'Платената сума не може да надвишава общата сума на фактурата': 'The paid amount cannot be more than the invoice total',
    'Плащането не е намерено': 'Payment not found',
    'Плащането не може да е с бъдеща дата': 'A payment cannot be dated in the future',
    'Плащания се въвеждат за фактури по банков път - тази е платена на място': 'Payments are entered for invoices paid by bank transfer - this one was paid on the spot',
    'Плащанията по фактура се въвеждат едно по едно, с датата си': "An invoice's payments are entered one by one, each with its date",
    'Повтарящ се график трябва да има крайна дата': 'A recurring schedule needs an end date',
    'Повтарящата се фактура не е активна за този месец': 'The recurring invoice is not active for this month',
    'Повтарящата се фактура не е намерена': 'Recurring invoice not found',
    'Поддържат се само .csv, .xlsx и .xls файлове.': 'Only .csv, .xlsx and .xls files are supported.',
    'Поканата вече не е активна': 'The invitation is no longer active',
    'Поканата е изтекла': 'The invitation has expired',
    'Поканата не е намерена': 'Invitation not found',
    'Покупката на сканирания временно не е налична. Моля, опитайте по-късно.': 'Buying scans is temporarily unavailable. Please try later.',
    'Посочете името и цената': 'Give the name and the price',
    'Посочете името на обекта': "Give the location's name",
    'Посочете какво': 'Say what',
    'Посочете какво и до кога': 'Say what and by when',
    'Посочете клиента': 'Give the customer',
    'Посочи доставчика, от когото идва фактурата - по него програмата я разпознава всеки месец': 'Give the supplier the invoice comes from - the program recognises it by them every month',
    'Потребител с този имейл вече е член на фирмата': 'A user with this email is already a member of the business',
    'Потребител с този имейл вече съществува': 'A user with this email already exists',
    'Потребителят не е намерен': 'User not found',
    'Потребителят не е намерен в екипа': 'User not found in the team',
    'Потребителят не е намерен в тази фирма': 'User not found in this business',
    'Потребителят не е от вашата фирма': 'The user is not from your business',
    'Празен файл': 'Empty file',
    'Първо потвърдете имейла си с кода, който ви изпратихме - после влезте във фирмата.': 'First confirm your email with the code we sent you - then join the business.',
    'Разговорът не е намерен': 'Conversation not found',
    'Различни разфасовки не се обединяват - сравни ги по цена за кг, л или брой.': 'Different pack sizes are not merged - compare them by price per kg, l or piece.',
    'Разходът не е намерен': 'Expense not found',
    'Само авторът на бележката може да я изтрие': "Only the note's author may delete it",
    'Само собственик може да вижда тези заявки': 'Only an owner may see these requests',
    'Само собственик може да одобрява': 'Only an owner may approve',
    'Само собственик може да отхвърля': 'Only an owner may reject',
    'Само собственикът избира какво ползва бизнесът': 'Only the owner chooses what the business uses',
    'Само собственикът или управителят могат да анулират или изтрият издадена фактура': 'Only the owner or the manager may cancel or delete an issued invoice',
    'Само създателят може да изтрива това събитие': 'Only the creator may delete this event',
    'Само създателят може да редактира това събитие': 'Only the creator may edit this event',
    'Само титулярът може да управлява лични разходи': 'Only the owner may manage personal expenses',
    'Само титулярят може да вижда покани': 'Only the owner may see invitations',
    'Само титулярят може да вижда резервните копия': 'Only the owner may see the backups',
    'Само титулярят може да вижда статуса на резервните копия': 'Only the owner may see the backup status',
    'Само титулярят може да възстановява резервно копие': 'Only the owner may restore a backup',
    'Само титулярят може да изпраща покани': 'Only the owner may send invitations',
    'Само титулярят може да отменя покани': 'Only the owner may cancel invitations',
    'Само титулярят може да прави резервно копие': 'Only the owner may make a backup',
    'Само титулярят може да премахва потребители': 'Only the owner may remove users',
    'Само титулярят може да променя роли': 'Only the owner may change roles',
    'Само титулярят може да редактира данните на фирмата': "Only the owner may edit the business's details",
    'Сесията е изтекла': 'The session has expired',
    'Сигнал за пари в риск може само да се отложи': 'A signal about money at risk can only be put off',
    'Сливането не е намерено': 'Merge not found',
    'Служителят не е намерен': 'Employee not found',
    'Смяната не е намерена': 'Shift not found',
    'Снимката е твърде голяма (до ~10MB).': 'The photo is too large (up to ~10MB).',
    'Снимката е твърде голяма. Моля, използвайте по-малка снимка.': 'The photo is too large. Please use a smaller photo.',
    'Сроковете се водят от собственика или управителя': 'Deadlines are kept by the owner or the manager',
    'Срокът вече е отбелязан или датата му е сменена': 'The deadline is already marked or its date has changed',
    'Срокът не е намерен': 'Deadline not found',
    'Ставките не може да са отрицателни': 'Rates cannot be negative',
    'Старият Excel формат (.xls) не се чете - изтеглете извлечението като CSV или .xlsx.': 'The old Excel format (.xls) cannot be read - download the statement as CSV or .xlsx.',
    'Събитието не е намерено': 'Event not found',
    'Съобщението е празно': 'The message is empty',
    'Сървърът не успя да се свърже с AI услугата (мрежов проблем).': 'The server could not reach the AI service (network problem).',
    'Сървърът не успя да се свърже с AI услугата (мрежов проблем). Моля, опитайте отново след малко.': 'The server could not reach the AI service (network problem). Please try again in a moment.',
    'Състоянието на програмата вижда собственикът': "The program's status is seen by the owner",
    'Тази дата не е част от графика на тази смяна': "This date is not part of this shift's schedule",
    'Тази покана е издадена за друг имейл адрес': 'This invitation was issued for another email address',
    'Тази фактура вече е свързана с друг актив': 'This invoice is already linked to another asset',
    'Текстът е задължителен': 'The text is required',
    'Това движение от извлечението вече е отразено по вземането': 'This statement transaction is already recorded on the receivable',
    'Това движение от извлечението вече е отразено по фактурата': 'This statement transaction is already recorded on the invoice',
    'Това действие не може да бъде възстановено': 'This action cannot be restored',
    'Това е едно и също име': 'It is the same name',
    'Това е заплата по график - промени или отмени плащането от Графика': 'This is pay by the schedule - change or cancel the payment from the Schedule',
    'Това напомняне вече е изпратено или отложено': 'This reminder was already sent or put off',
    'Това са единствените ставки - промени ги, вместо да ги триеш': 'These are the only rates - change them instead of deleting them',
    'Този въпрос вече не е актуален - обнови списъка': 'This question is no longer current - refresh the list',
    'Този месец вече е записан': 'This month is already recorded',
    'Този месец вече е платен': 'This month is already paid',
    'Трябва да зададете и start_date, и end_date (или нито едно от двете за текущия месец)': 'Set both start_date and end_date (or neither for the current month)',
    'Файлът е над 5 MB - изтеглете извлечение за по-кратък период.': 'The file is over 5 MB - download a statement for a shorter period.',
    'Файлът е празен.': 'The file is empty.',
    'Файлът е твърде голям (макс. 15MB).': 'The file is too large (15MB at most).',
    'Файлът не е банково извлечение.': 'The file is not a bank statement.',
    'Файлът не е валиден Excel (.xlsx) - изтеглете извлечението като CSV или .xlsx.': 'The file is not a valid Excel (.xlsx) - download the statement as CSV or .xlsx.',
    'Файлът не е резервно копие на Фактура+': 'The file is not a Faktura+ backup',
    'Файлът не изглежда да е валиден Excel файл.': 'The file does not look like a valid Excel file.',
    'Файлът не можа да бъде прочетен - запазете го като CSV UTF-8 и опитайте отново.': 'The file could not be read - save it as CSV UTF-8 and try again.',
    'Файлът не съдържа никакви редове с данни.': 'The file holds no rows of data.',
    'Файлът съдържа само заглавен ред, без данни.': 'The file holds only a header row, no data.',
    'Фактурата вече е платена': 'The invoice is already paid',
    'Фактурата е анулирана': 'The invoice is cancelled',
    'Фактурата е издадена в друга програма - документът е там': 'The invoice was issued in another program - the document is there',
    'Фактурата не е намерена': 'Invoice not found',
    'Фирма с този ЕИК вече съществува. Използвайте код за присъединяване.': 'A business with this EIK already exists. Use a join code.',
    'Фирмата не е намерена': 'Business not found',
    'Цената не е намерена': 'Price not found',
    'Цените се определят от собственика или управителя': 'Prices are set by the owner or the manager',
    'Част от този период вече е маркирана като платена': 'Part of this period is already marked as paid',
    'Четенето на Excel файлове не е налично на сървъра - изтеглете извлечението като CSV.': 'Excel files cannot be read on the server - download the statement as CSV.',
    'Четенето на Excel файлове не е налично на сървъра.': 'Excel files cannot be read on the server.',
}

# Parts that fill a message: a document, a field, a month - in English.
WORDS: Dict[str, str] = {
    "Фактура": "Invoice",
    "Кредитно известие": "Credit note",
    "фактура": "invoice",
    "кредитно известие": "credit note",
    "дата на фактурата": "invoice date",
    "дата на падеж": "due date",
    "издадения документ": "the issued document",
    "ЕИК": "EIK",
    "адрес": "address",
    "другият собственик": "the other owner",
    "№": "No.",
    "Категория I – Сгради, съоръжения, предавателни устройства": "Category I - Buildings, facilities, transmission devices",
    "Категория II – Машини, производствено оборудване, апаратура": "Category II - Machines, production equipment, apparatus",
    "Категория III – Превозни средства (без леки автомобили), пътни настилки": "Category III - Vehicles (not cars), road surfaces",
    "Категория IV – Компютри, периферни устройства, софтуер": "Category IV - Computers, peripherals, software",
    "Категория V – Леки автомобили": "Category V - Cars",
    "Категория VI – Активи с ограничен срок на ползване по договор/закон (нормата = 100% / срока в години)":
        "Category VI - Assets with a limited term of use by contract/law (rate = 100% / term in years)",
    "Категория VII – Други амортизируеми активи": "Category VII - Other depreciable assets",
}
for _bg, _en in zip(MONTHS_BG, MONTHS_EN):
    WORDS[_bg] = _en


def words(text: str) -> str:
    """A part of a message in English: as a whole, or word by word for a
    list ("ЕИК и адрес"), a month ("ноември 2026") or a document
    ("фактура № 0000000012")."""
    if text in WORDS:
        return WORDS[text]
    if text in EXACT:
        return EXACT[text]
    out = re.sub(r"\bи\b", "and", text)
    for bg in sorted(WORDS, key=len, reverse=True):
        out = out.replace(bg, WORDS[bg])
    return out


# (pattern, English) - the named parts are put in as they are, or through
# words() when their name ends in _w, or through to_english() when it ends
# in _t (a message inside a message).
PATTERNS: List[Tuple[str, str]] = [
    (r"Грешка: (?P<e_t>.*)", "Error: {e_t}"),
    (r"Грешка при сканиране: (?P<e_t>.*)", "Scanning failed: {e_t}"),
    (r"При двама собственици премахването на съдружник изисква взаимно съгласие - (?P<name_w>.+?) трябва сам да напусне "
     r"доброволно, или добавете трети собственик, чието независимо одобрение да разреши въпроса\.",
     "With two owners, removing a partner needs mutual consent - {name_w} has to leave of their own accord, "
     "or add a third owner whose independent approval settles it."),
    (r"Попълнете (?P<fields_w>.+) на фирмата, преди да издадете фактура",
     "Fill in the business's {fields_w} before issuing an invoice"),
    (r"Първото плащане може да е най-много (?P<n>\d+) месеца назад", "The first payment can be at most {n} months back"),
    (r"Твърде много грешни кодове - опитайте отново след (?P<n>\d+) минути", "Too many wrong codes - try again in {n} minutes"),
    (r"Твърде много страници \(макс\. (?P<n>\d+)\)\.", "Too many pages (at most {n})."),
    (r"Твърде много снимки \(макс\. (?P<n>\d+)\)\.", "Too many photos (at most {n})."),
    (r"Паролата за архива трябва да е поне (?P<n>\d+) знака", "The backup password must be at least {n} characters"),
    (r"Фактурата за (?P<month_w>.+) вече е издадена - № (?P<number>.+)", "The invoice for {month_w} is already issued - No. {number}"),
    (r"Фактурата за (?P<month_w>.+) се издава в момента", "The invoice for {month_w} is being issued right now"),
    (r"(?P<name>.+) вече е платен\(а\) по график за дни от (?P<period>\d{2}\.\d{4})\. Ведомостта ще се добави към това "
     r"плащане - потвърди, само ако наистина са две отделни плащания\.",
     "{name} was already paid by the schedule for days of {period}. The payroll will be added to that payment - "
     "confirm only if these really are two separate payments."),
    (r"(?P<name>.+) вече има ведомост за (?P<months>.+)\. Плащането по график ще се добави към нея - потвърди, само ако "
     r"наистина са две отделни плащания\.",
     "{name} already has payroll for {months}. The payment by the schedule will be added to it - "
     "confirm only if these really are two separate payments."),
    (r"Нормата не може да надвишава (?P<rate>[\d.]+)% за (?P<label_w>.+)", "The rate cannot exceed {rate}% for {label_w}"),
    (r"Невалидна (?P<what_w>дата на фактурата|дата на падеж)", "Invalid {what_w}"),
    (r"(?P<what_w>Фактура|Кредитно известие) с номер (?P<number>.+?) от (?P<supplier>.+) вече е (?:добавена|добавено) от "
     r"(?P<by>.+)!", "{what_w} number {number} from {supplier} has already been added by {by}!"),
    (r"(?P<what_w>Фактура|Кредитно известие) с номер (?P<number>.+?) от (?P<supplier>.+) вече е (?:добавена|добавено)!",
     "{what_w} number {number} from {supplier} has already been added!"),
    (r"Остават (?P<amount>.+) - плащането е по-голямо", "{amount} remains - the payment is larger"),
    (r"Вече има (?P<what_w>фактура|кредитно известие) с номер (?P<number>.+) от този доставчик",
     "There is already a {what_w} numbered {number} from this supplier"),
    (r"№ (?P<number>.+) вече е на нов документ - този не може да се върне със същия номер",
     "No. {number} is already on a new document - this one cannot come back with the same number"),
    (r"Пакетът е (?P<size>[\d.]+) MB - твърде голям за имейл\. Изтеглете го и го изпратете с друга услуга\.",
     "The pack is {size} MB - too large for an email. Download it and send it another way."),
    (r"Вземането е по (?P<label_w>.+) - маха се само с анулиране на фактурата",
     "The receivable is for {label_w} - it goes only by cancelling the invoice"),
    (r"Известието е по-голямо от остатъка по фактурата \((?P<amount>.+)\)",
     "The note is larger than what remains on the invoice ({amount})"),
    (r"Вече има клиент с ЕИК (?P<eik>\S+): (?P<name>.+)", "There is already a customer with EIK {eik}: {name}"),
    (r"Сумата е по (?P<label_w>.+) - променя се с кредитно известие или с анулиране",
     "The amount is set by {label_w} - it changes with a credit note or by cancelling"),
    (r"Клиентът е по (?P<label_w>.+) и не се променя тук", "The customer is set by {label_w} and does not change here"),
    (r"Фактура № (?P<number>.+) току-що беше издадена - опитайте отново", "Invoice No. {number} was just issued - try again"),
    (r"Фактура № (?P<number>.+) вече е въведена", "Invoice No. {number} is already entered"),
    (r"Фактура № (?P<number>.+) вече е издадена", "Invoice No. {number} is already issued"),
    (r"№ (?P<number>.+) вече е издаден", "No. {number} is already issued"),
    (r"№ (?P<number>.+) току-що беше издаден - опитайте отново", "No. {number} was just issued - try again"),
    (r"„(?P<name>.+)“ вече е в ценоразписа", "“{name}” is already in the price list"),
    (r"Сборът по ставки ДДС \((?P<a>.+)\) не е равен на фискализирания оборот \((?P<b>.+)\)",
     "The sum by VAT rates ({a}) does not equal the fiscal takings ({b})"),
    (r"Непознат модул: (?P<names>.+)", "Unknown module: {names}"),
    (r"Обект „(?P<name>.+)“ вече има", "A location “{name}” already exists"),
    (r"Вие сте единственият собственик на фирма с други членове \((?P<names>.+)\)\. Добавете друг собственик или "
     r"прехвърлете правата, преди да изтриете акаунта си\.",
     "You are the only owner of a business with other members ({names}). Add another owner or hand over the "
     "rights before deleting your account."),
    (r"Извлечението е с над (?P<n>\d+) движения - изтеглете го за по-кратък период\.",
     "The statement has over {n} transactions - download it for a shorter period."),
    (r"Невалидна дата '(?P<value>.*)' - очаква се ГГГГ-ММ-ДД", "Invalid date '{value}' - expected YYYY-MM-DD"),
    (r"Извлечението е в (?P<currency>\S+), а програмата работи в евро - изтеглете извлечението на сметката в евро\.",
     "The statement is in {currency}, while the program works in euro - download the statement of the euro account."),
]
_COMPILED: List[Tuple["re.Pattern[str]", str]] = [(re.compile(f"^(?:{p})$", re.DOTALL), en) for p, en in PATTERNS]


def to_english(text: str) -> str:
    """The message in English - or as it is, when it is not known."""
    if not isinstance(text, str) or not text:
        return text
    if text in EXACT:
        return EXACT[text]
    for pattern, english in _COMPILED:
        found = pattern.match(text)
        if not found:
            continue
        parts: Dict[str, str] = {}
        for name, value in found.groupdict().items():
            value = value or ""
            if name.endswith("_w"):
                value = words(value)
            elif name.endswith("_t"):
                value = to_english(value)
            parts[name] = value
        return english.format(**parts)
    return text


def wants_english(language: Optional[str]) -> bool:
    return (language or "").strip().lower().startswith("en")


def localize(detail: Any) -> Any:
    """A refusal's detail in English: its text, or the message of one that
    also carries a code for the app."""
    if isinstance(detail, str):
        return to_english(detail)
    if isinstance(detail, dict) and isinstance(detail.get("message"), str):
        return {**detail, "message": to_english(detail["message"])}
    return detail

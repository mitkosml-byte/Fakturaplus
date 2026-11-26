// The main paths of an owner, in a real browser on a phone-sized screen:
// open an account, get past the first start, enter the day's takings and an
// expense, see them on Home and in Statistics, make a backup, sign out and
// back in. An invented business and invented numbers.
const { test, expect } = require('@playwright/test');

const PASSWORD = 'Passw0rd1';

test.beforeEach(async ({ context }) => {
  // The app checks the connection against an outside address: answered here.
  await context.route(/generate_204|connectivitycheck|captive/, (route) => route.fulfill({ status: 204, body: '' }));
});

// The first start: one question, then a short tour - skipped.
async function pastFirstStart(page) {
  for (let i = 0; i < 12; i += 1) {
    const next = ['Пропусни', 'Разбрах', 'Напред', 'Готово'];
    let tapped = false;
    for (const label of next) {
      const button = page.getByText(label, { exact: true });
      if (await button.count()) {
        await button.first().click();
        tapped = true;
        await page.waitForTimeout(400);
        break;
      }
    }
    if (!tapped) return;
  }
}

async function fillByPlaceholder(page, values) {
  const inputs = page.locator('input');
  const placeholders = await inputs.evaluateAll((els) => els.map((e) => e.placeholder || ''));
  for (let i = 0; i < placeholders.length; i += 1) {
    const p = placeholders[i].toLowerCase();
    for (const [pattern, value] of values) {
      if (pattern.test(p)) {
        await inputs.nth(i).fill(value);
        break;
      }
    }
  }
}

test('an owner opens an account and works through a day', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const email = `proba.${Date.now()}@example.com`;

  // Open an account.
  await page.goto('/login');
  await page.getByText('Регистрация', { exact: true }).first().click();
  await fillByPlaceholder(page, [[/имейл|email/, email], [/парол|password/, PASSWORD], [/име|name/, 'Проба Собственик']]);
  await page.getByText('Регистрация', { exact: true }).last().click();
  await expect(page.getByText('Главна', { exact: true }).first()).toBeVisible();
  await pastFirstStart(page);

  // The day's takings from Home.
  await page.getByText('Дневен оборот', { exact: true }).first().click();
  await page.getByPlaceholder('0.00').first().fill('1234,50');
  await page.getByText('Запиши', { exact: true }).last().click();
  await expect(page.getByText('Оборотът е записан')).toBeVisible();
  // Money is written with a no-break space: 1 234,50 €.
  await expect(page.getByText(/1\s234,50/).first()).toBeVisible();

  // An expense without an invoice (the action is named by the owner's own
  // word for it; its hint says what it is).
  await page.getByRole('button').filter({ hasText: 'без фактура' }).first().click();
  await page.getByPlaceholder(/гориво/).fill('Гориво за бус');
  await page.getByPlaceholder('0.00').last().fill('80');
  await page.getByText('Добави разход', { exact: true }).last().click();
  await expect(page.getByText(/^80,00\s€$/).first()).toBeVisible();

  // Statistics for the month.
  await page.getByText('Статистики', { exact: false }).last().click();
  await expect(page.getByText(/Месец/).first()).toBeVisible();
  await expect(page.getByText(/1\s028,75/).first()).toBeVisible();

  // A backup of the data, made by hand.
  await page.goto('/backup');
  const download = page.waitForEvent('download');
  await page.getByText('Създай Backup', { exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);

  // Sign out and back in.
  await page.goto('/profile');
  await page.getByText('Изход', { exact: true }).last().click();
  const confirm = page.getByText('Изход', { exact: true });
  if (await confirm.count() > 1) await confirm.last().click();
  await expect(page.getByPlaceholder(/имейл|email/i).first()).toBeVisible();
  await fillByPlaceholder(page, [[/имейл|email/, email], [/парол|password/, PASSWORD]]);
  await page.getByText('Вход', { exact: true }).last().click();
  await expect(page.getByText('Главна', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/1\s234,50/).first()).toBeVisible();

  expect(errors).toEqual([]);
});

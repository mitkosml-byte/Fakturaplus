import { useLanguageStore } from '../i18n';

// One way to write money on every screen (Л11): "18 844,00 €" - thousands
// apart, a decimal comma, two decimals, the euro sign after; in English
// "18,844.00 €". For what is shown only: a value typed into a field or sent
// to the server stays a plain number.
//
// Built by hand rather than with Intl: phones do not all carry the
// Bulgarian locale, and the same number must read the same everywhere.
// The spaces are non-breaking, so "18 844,00 €" never splits over lines.
const NBSP = '\u00A0';

export function formatAmount(value: number | null | undefined, decimals: 0 | 2 | 3 = 2): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const english = useLanguageStore.getState().language === 'en';
  const fixed = Math.abs(n).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, english ? ',' : NBSP);
  // No "-0,00": a minus only on what is still below zero once rounded.
  const sign = n < 0 && Number(fixed) !== 0 ? '-' : '';
  return `${sign}${grouped}${fraction !== undefined ? (english ? '.' : ',') + fraction : ''}`;
}

export function formatMoney(value: number | null | undefined, decimals: 0 | 2 = 2): string {
  return `${formatAmount(value, decimals)}${NBSP}€`;
}

// An amount as typed into a field: "1234,56", "1234.56", "1 234,56",
// "1.234,56" or "1,234.56" - a decimal comma or point, spaces and a
// thousands mark allowed. Every field that takes an amount, a quantity, a
// rate or hours reads it here, so "12,50" is never saved as 12.
//
// NaN when nothing in it reads as a number (an empty field), for the forms
// that tell an empty field from a zero; parseAmount gives 0 instead.
export function readAmount(text: string | null | undefined): number {
  let value = String(text ?? '').replace(/[\s\u00A0]/g, '');
  const comma = value.lastIndexOf(',');
  const point = value.lastIndexOf('.');
  if (comma > -1 && point > -1) {
    // Both: the last one marks the decimals, the other groups thousands.
    value = comma > point ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (comma > -1) {
    // One comma marks the decimals; several group thousands ("1,234,567").
    value = value.indexOf(',') === comma ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if (point > -1 && value.indexOf('.') !== point) {
    value = value.replace(/\./g, '');
  }
  const amount = parseFloat(value);
  return Number.isFinite(amount) ? amount : NaN;
}

// The same, with 0 for a field that holds no number.
export function parseAmount(text: string | null | undefined): number {
  const amount = readAmount(text);
  return Number.isNaN(amount) ? 0 : amount;
}

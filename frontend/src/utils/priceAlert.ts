// What a price alert (or a scan-time price hint) means in plain words: its
// cost in EUR a month, or - when the new unit price is exactly a pack
// multiple of the usual one - the question "is this a pack of N?", since
// that is almost always a misread pack rather than a real +500% rise.

import { formatAmount } from './money';

type Translate = (key: string) => string;

export interface PriceMeaningInput {
  kind?: 'price_change' | 'pack_suspect' | 'pack_rule' | null;
  direction?: 'increase' | 'decrease' | null;
  old_price: number | null;
  pack_multiple?: number | null;
  monthly_impact?: number | null;
}

// k when (newQty, newPrice) is (oldQty x k, oldPrice / k) for a whole k >= 2:
// the same line re-read as k times as many pieces at 1/k the price. Same
// rule as the backend's detect_pack_multiple.
export function detectPackMultiple(oldQty: number, oldPrice: number, newQty: number, newPrice: number): number | null {
  if (![oldQty, oldPrice, newQty, newPrice].every((v) => Number.isFinite(v) && v > 0)) return null;
  const k = Math.round(newQty / oldQty);
  if (k < 2 || k > 100) return null;
  if (Math.abs(newQty - oldQty * k) > 0.01 * newQty) return null;
  if (Math.abs(newPrice * k - oldPrice) > 0.02 * oldPrice) return null;
  return k;
}

// A price in the alert texts - the one money format (Л11); the texts carry the €.
export function formatEur(value: number): string {
  return formatAmount(value);
}

// A price per kg / l / piece: two decimals, three below 0.10 (a gram-sized
// price would otherwise read as 0.00).
export function formatUnitPrice(value: number): string {
  return formatAmount(value, Math.abs(value) >= 0.1 ? 2 : 3);
}

export function isPackSuspect(alert: PriceMeaningInput): boolean {
  return alert.kind === 'pack_suspect' && !!alert.pack_multiple;
}

export function priceAlertMeaning(alert: PriceMeaningInput, t: Translate): string | null {
  if (isPackSuspect(alert)) {
    return t(alert.direction === 'decrease' ? 'priceAlert.packQuestionDown' : 'priceAlert.packQuestionUp')
      .replace(/\{k\}/g, String(alert.pack_multiple))
      .replace('{old}', formatEur(alert.old_price ?? 0));
  }
  if (alert.monthly_impact) {
    const sign = alert.monthly_impact > 0 ? '+' : '−';
    return t('priceAlert.monthlyImpact').replace('{amount}', `${sign}${formatEur(Math.abs(alert.monthly_impact))}`);
  }
  return null;
}

// What a price alert (or a scan-time price hint) means in plain words: its
// cost in EUR a month, or - when the new unit price is exactly a pack
// multiple of the usual one - the question "is this a pack of N?", since
// that is almost always a misread pack rather than a real +500% rise.

type Translate = (key: string) => string;

export interface PriceMeaningInput {
  kind?: 'price_change' | 'pack_suspect' | null;
  direction?: 'increase' | 'decrease' | null;
  old_price: number;
  pack_multiple?: number | null;
  monthly_impact?: number | null;
}

export function formatEur(value: number): string {
  const abs = Math.abs(value);
  return abs >= 10 ? String(Math.round(value)) : value.toFixed(2);
}

export function isPackSuspect(alert: PriceMeaningInput): boolean {
  return alert.kind === 'pack_suspect' && !!alert.pack_multiple;
}

export function priceAlertMeaning(alert: PriceMeaningInput, t: Translate): string | null {
  if (isPackSuspect(alert)) {
    return t(alert.direction === 'decrease' ? 'priceAlert.packQuestionDown' : 'priceAlert.packQuestionUp')
      .replace(/\{k\}/g, String(alert.pack_multiple))
      .replace('{old}', formatEur(alert.old_price));
  }
  if (alert.monthly_impact) {
    const sign = alert.monthly_impact > 0 ? '+' : '−';
    return t('priceAlert.monthlyImpact').replace('{amount}', `${sign}${formatEur(Math.abs(alert.monthly_impact))}`);
  }
  return null;
}

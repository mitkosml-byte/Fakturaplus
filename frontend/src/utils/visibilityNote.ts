// What a viewer with partial access is actually looking at, in one plain
// sentence: which parts the totals leave out, and so which profit the
// profit card shows. The server folds a hidden field out of every total
// (see get_financial_visibility), so "some data is hidden" alone left the
// reader guessing whether the profit is the company's or a smaller one.

import type { FinancialVisibility } from '../types';

type Translate = (key: string) => string;

export function restrictedDataNote(
  visibility: FinancialVisibility | null | undefined,
  t: Translate,
): string | null {
  if (!visibility) return null;
  if (visibility.statistics === false) return t('visibility.noStatistics');

  const leftOut: string[] = [];
  if (visibility.pocket_money === false) leftOut.push(t('visibility.pocketMoney'));
  if (visibility.off_book_expenses === false) leftOut.push(t('visibility.offBookExpenses'));
  // The salaries are seen by whoever keeps the payroll.
  if (visibility.payroll === false) leftOut.push(t('visibility.payroll'));
  // "a, b and c"
  const items = leftOut.length > 1
    ? `${leftOut.slice(0, -1).join(t('visibility.listSeparator'))}${t('visibility.and')}${leftOut[leftOut.length - 1]}`
    : leftOut.join('');

  if (visibility.profit === false) {
    return leftOut.length
      ? `${t('visibility.totalsWithout').replace('{items}', items)} ${t('visibility.profitHidden')}`
      : t('visibility.profitHidden');
  }
  if (!leftOut.length) return null;
  return t('visibility.profitWithout').replace('{items}', items);
}

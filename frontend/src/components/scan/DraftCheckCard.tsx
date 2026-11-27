import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import { formatAmount } from '../../utils/money';
import { InvoiceDraftCheck, InvoiceDraftFix } from '../../types';

// Do the amounts of a scanned invoice add up before it is saved: the lines
// against the base, the base and VAT against the total - and, when they do
// not, the likely cause and a one-tap fix. Moved out of scan.tsx (the large
// files split step by step); the check is still asked for and held there.

type Translate = (key: string) => string;
type HeaderProblem = NonNullable<InvoiceDraftCheck['header']>;
type LinesProblem = NonNullable<InvoiceDraftCheck['lines']>;
type LineFlag = InvoiceDraftCheck['line_flags'][number];

const money = (value: number) => formatAmount(Math.abs(value));

export const headerProblemText = (t: Translate, header: HeaderProblem) =>
  t('scanCheck.headerMismatch')
    .replace('{expected}', money(header.expected_total))
    .replace('{total}', money(header.total_amount));

export const linesProblemText = (t: Translate, lines: LinesProblem) =>
  t('scanCheck.linesMismatch')
    .replace('{sum}', money(lines.sum))
    .replace('{base}', money(lines.base))
    .replace('{diff}', money(lines.difference));

const causeText = (t: Translate, lines: LinesProblem, lineName: (index: number | null) => string): string | null => {
  switch (lines.cause) {
    case 'line_values':
      return lines.index != null
        ? t('scanCheck.causeLineValuesOne').replace('{name}', lineName(lines.index))
        : t('scanCheck.causeLineValues').replace('{n}', String(lines.fixes.length));
    case 'vat_included':
      return t('scanCheck.causeVatIncluded');
    case 'duplicate_line':
      return t('scanCheck.causeDuplicate').replace('{name}', lineName(lines.remove_index));
    case 'decimal_slip':
      return t('scanCheck.causeDecimal')
        .replace('{name}', lineName(lines.index))
        .replace('{price}', String(lines.fixes[0]?.unit_price ?? ''));
    case 'missing_line':
      return t('scanCheck.causeMissing').replace('{diff}', money(lines.difference));
    case 'extra':
      return t('scanCheck.causeExtra').replace('{diff}', money(lines.difference));
    default:
      return null;
  }
};

type Props = {
  check: InvoiceDraftCheck;
  /** False from an edit until the check for it comes back: the old answer
   * shows dimmed, without its fix buttons (a second tap must not apply a
   * fix twice). */
  fresh: boolean;
  lineFlags: Record<number, LineFlag>;
  /** A line's name as the owner typed it, or '?'. */
  lineName: (index: number | null) => string;
  onApplyFixes: (fixes: InvoiceDraftFix[]) => void;
  onSetQuantity: (index: number, quantity: string) => void;
  onRemoveLine: (index: number) => void;
  onAddLine: () => void;
};

export function DraftCheckCard({ check, fresh, lineFlags, lineName, onApplyFixes, onSetQuantity, onRemoveLine, onAddLine }: Props) {
  const { t } = useTranslation();
  const lines = check.lines;
  const problem = !!check.header || (!!lines && !lines.ok);
  const fixButton = (label: string, onPress: () => void) => (
    <TouchableOpacity style={styles.packFixButton} onPress={onPress}>
      <Ionicons name="construct-outline" size={14} color={COLORS.warning} />
      <Text style={styles.packFixButtonText}>{label}</Text>
    </TouchableOpacity>
  );
  let action: React.ReactNode = null;
  if (lines && !lines.ok && fresh) {
    if (lines.cause === 'line_values' && lines.fixes.length > 1) {
      action = fixButton(t('scanCheck.fixLinePrices').replace('{n}', String(lines.fixes.length)), () => onApplyFixes(lines.fixes));
    } else if (lines.cause === 'line_values' && lines.fixes.length === 1) {
      // One line off: its price or its quantity was misread - offer both
      // readings that give the printed value, as on the line itself.
      const flag = lineFlags[lines.fixes[0].index];
      const index = lines.fixes[0].index;
      action = (
        <View style={styles.lineFixRow}>
          {fixButton(t('scanCheck.setPrice').replace('{price}', String(lines.fixes[0].unit_price)), () => onApplyFixes(lines.fixes))}
          {flag?.quantity != null && fixButton(
            t('scanCheck.setQuantity').replace('{qty}', String(flag.quantity)),
            () => onSetQuantity(index, String(flag.quantity)),
          )}
        </View>
      );
    } else if (lines.cause === 'decimal_slip' && lines.fixes.length === 1) {
      action = fixButton(t('scanCheck.setPrice').replace('{price}', String(lines.fixes[0].unit_price)), () => onApplyFixes(lines.fixes));
    } else if (lines.cause === 'vat_included') {
      action = fixButton(t('scanCheck.fixVatIncluded'), () => onApplyFixes(lines.fixes));
    } else if (lines.cause === 'duplicate_line' && lines.remove_index != null) {
      const index = lines.remove_index;
      action = fixButton(t('scanCheck.removeDuplicate'), () => onRemoveLine(index));
    } else if (lines.cause === 'missing_line') {
      action = fixButton(t('scanCheck.addMissingLine'), onAddLine);
    }
  }
  const cause = lines && !lines.ok && fresh ? causeText(t, lines, lineName) : null;
  return (
    <View style={[styles.checkCard, problem ? styles.checkCardWarn : styles.checkCardOk, !fresh && styles.checkCardStale]}>
      {check.header && (
        <View style={styles.checkRow}>
          <Ionicons name="alert-circle" size={16} color={COLORS.warning} />
          <Text style={[styles.checkText, styles.checkTitle]}>{headerProblemText(t, check.header)}</Text>
        </View>
      )}
      {lines && (lines.ok ? (
        <View style={styles.checkRow}>
          <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
          <Text style={[styles.checkText, { color: COLORS.success }]}>
            {t('scanCheck.allGood').replace('{sum}', money(lines.sum))}
          </Text>
        </View>
      ) : (
        <View style={check.header ? styles.checkSpaced : undefined}>
          <View style={styles.checkRow}>
            <Ionicons name="alert-circle" size={16} color={COLORS.warning} />
            <Text style={[styles.checkText, styles.checkTitle]}>{linesProblemText(t, lines)}</Text>
          </View>
          {cause && <Text style={styles.checkCause}>{cause}</Text>}
          {action && <View style={styles.checkActions}>{action}</View>}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  packFixButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.warning + '60',
    backgroundColor: COLORS.warning + '15',
  },
  packFixButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.warning,
  },
  checkCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
  },
  checkCardWarn: {
    borderColor: COLORS.warning,
  },
  checkCardOk: {
    borderColor: COLORS.success,
  },
  checkCardStale: {
    opacity: 0.55,
  },
  checkSpaced: {
    marginTop: 8,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  checkText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  checkTitle: {
    color: 'white',
    fontWeight: '600',
  },
  checkCause: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
    marginTop: 6,
    marginLeft: 22,
  },
  checkActions: {
    marginLeft: 22,
  },
  lineFixRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});

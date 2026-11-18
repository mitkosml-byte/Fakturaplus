import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from '../../i18n';
import { api } from '../../services/api';
import type { BillingOverview } from '../../types';
import { COLORS } from '../../theme/colors';
import { CountUp } from '../CountUp';
import { formatMoney } from '../../utils/money';

type Props = {
  startDate: string;
  endDate: string;
  // Can the viewer issue invoices? Then "+ Фактура" is right here.
  canIssue: boolean;
  // Changes whenever Home reloads, so the card follows.
  refreshSignal?: unknown;
  // The overview as Home loaded it (Л14) - given, no request of its own.
  overview?: BillingOverview | null;
};

// Home for a business that invoices (У2, У3): what it issued in the period,
// what customers owe now and what of that is overdue - and "+ Фактура",
// its main action, one tap away instead of three screens in.
export function BillingOverviewCard({ startDate, endDate, canIssue, refreshSignal, overview: loaded }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [fetched, setOverview] = useState<BillingOverview | null>(null);
  const overview = loaded !== undefined ? loaded : fetched;

  useEffect(() => {
    if (loaded !== undefined) return undefined;
    let cancelled = false;
    api.getBillingOverview(startDate, endDate)
      .then((data) => { if (!cancelled) setOverview(data); })
      .catch(() => { if (!cancelled) setOverview(null); });
    return () => { cancelled = true; };
  }, [startDate, endDate, refreshSignal, loaded]);

  const overdue = (overview?.total_overdue || 0) > 0;
  const money = (n: number) => `${formatMoney(n)}`;

  return (
    <View style={[styles.card, overdue && styles.cardOverdue]}>
      <View style={styles.header}>
        <Ionicons name="document-text" size={22} color={COLORS.primary} />
        <Text style={styles.title} numberOfLines={1}>{t('home.billingTitle')}</Text>
        {canIssue && (
          <TouchableOpacity
            style={styles.newInvoice}
            onPress={() => router.push({ pathname: '/billing-documents', params: { new: 'invoice' } })}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={18} color="white" />
            <Text style={styles.newInvoiceText}>{t('home.newInvoice')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.line} onPress={() => router.push('/billing-documents')}>
        <View style={styles.lineText}>
          <Text style={styles.label} numberOfLines={1}>{t('home.billingIssued')}</Text>
          <Text style={styles.sub}>{t('home.billingIssuedCount').replace('{count}', String(overview?.issued_count || 0))}</Text>
        </View>
        <CountUp value={overview?.issued_total || 0} formatter={money} style={styles.value} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.line} onPress={() => router.push('/receivables')}>
        <View style={styles.lineText}>
          <Text style={styles.label} numberOfLines={1}>{t('home.billingOwed')}</Text>
          <Text style={styles.sub}>{t('home.billingOwedCount').replace('{count}', String(overview?.unpaid_count || 0))}</Text>
        </View>
        <CountUp value={overview?.total_owed || 0} formatter={money} style={[styles.value, { color: COLORS.success }]} />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.line, styles.lineLast]} onPress={() => router.push('/receivables')}>
        <View style={styles.lineText}>
          <Text style={styles.label} numberOfLines={1}>{t('home.billingOverdue')}</Text>
          <Text style={styles.sub}>{t('home.billingOwedCount').replace('{count}', String(overview?.overdue_count || 0))}</Text>
        </View>
        <CountUp
          value={overview?.total_overdue || 0}
          formatter={money}
          style={[styles.value, { color: overdue ? COLORS.danger : COLORS.textSecondary }]}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  cardOverdue: { borderColor: COLORS.danger },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  title: { flex: 1, fontSize: 16, fontWeight: '600', color: 'white' },
  newInvoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  newInvoiceText: { color: 'white', fontSize: 14, fontWeight: '600' },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  lineLast: { borderBottomWidth: 0, paddingBottom: 0 },
  lineText: { flex: 1 },
  label: { fontSize: 14, color: COLORS.textSubtle, fontWeight: '500' },
  value: { fontSize: 18, fontWeight: '700', color: 'white' },
  sub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
});

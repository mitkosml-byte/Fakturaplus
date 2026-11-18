import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../services/api';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';
import type { GettingStarted } from '../../types';

type Props = {
  companyId: string | null | undefined;
  showRevenue: boolean;
  showInvoice: boolean;
  showIssued: boolean;
  onAddRevenue: () => void;
  // Home's numbers refresh it: a step done shows as done.
  refreshSignal?: unknown;
  onStatus?: (status: GettingStarted) => void;
};

// "Започни оттук" (Л5): an empty Home says what to do first instead of
// showing zeros - the day's revenue, a supplier invoice from a photo, an
// invoice to a customer, each only where the business has it - and ticks
// each off once done. Gone when all are done or when closed.
export function GettingStartedCard({ companyId, showRevenue, showInvoice, showIssued, onAddRevenue, refreshSignal, onStatus }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [status, setStatus] = useState<GettingStarted | null>(null);
  const [hidden, setHidden] = useState(true);
  const hiddenKey = companyId ? `getting_started_hidden_${companyId}` : null;

  useEffect(() => {
    if (!hiddenKey) return;
    AsyncStorage.getItem(hiddenKey).then((value) => setHidden(!!value)).catch(() => setHidden(false));
  }, [hiddenKey]);

  useEffect(() => {
    let alive = true;
    api.getGettingStarted()
      .then((data) => {
        if (!alive) return;
        setStatus(data);
        onStatus?.(data);
      })
      .catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal, companyId]);

  const steps = [
    ...(showRevenue ? [{ key: 'revenue', icon: 'cash' as const, label: t('startHere.revenue'), done: !!status?.revenue, onPress: onAddRevenue }] : []),
    ...(showInvoice ? [{ key: 'invoice', icon: 'scan' as const, label: t('startHere.invoice'), done: !!status?.invoice, onPress: () => router.push('/(tabs)/scan') }] : []),
    ...(showIssued ? [{
      key: 'issued', icon: 'document-text' as const, label: t('startHere.issued'), done: !!status?.issued,
      onPress: () => router.push({ pathname: '/billing-documents', params: { new: 'invoice' } }),
    }] : []),
  ];
  if (!status || hidden || steps.length === 0 || steps.every((step) => step.done)) return null;

  const hide = () => {
    setHidden(true);
    if (hiddenKey) AsyncStorage.setItem(hiddenKey, '1').catch(() => undefined);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="flag" size={18} color={COLORS.primary} />
        <Text style={styles.title}>{t('startHere.title')}</Text>
        <TouchableOpacity onPress={hide} hitSlop={8}>
          <Text style={styles.hide}>{t('startHere.hide')}</Text>
        </TouchableOpacity>
      </View>
      {steps.map((step, index) => (
        <TouchableOpacity
          key={step.key}
          style={[styles.step, index > 0 && styles.stepDivider]}
          onPress={step.onPress}
          disabled={step.done}
          accessibilityRole="button"
        >
          <Ionicons
            name={step.done ? 'checkmark-circle' : step.icon}
            size={22}
            color={step.done ? COLORS.success : COLORS.primary}
          />
          <Text style={[styles.stepText, step.done && styles.stepDone]}>{step.label}</Text>
          {!step.done && <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { flex: 1, color: 'white', fontSize: 16, fontWeight: '700' },
  hide: { color: COLORS.textMuted, fontSize: 12 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  stepDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  stepText: { flex: 1, color: 'white', fontSize: 14, fontWeight: '600' },
  stepDone: { color: COLORS.textMuted, textDecorationLine: 'line-through', fontWeight: '400' },
});

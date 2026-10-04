import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';
import { ModalBlurBackdrop } from './ModalBlurBackdrop';

// The loud counterpart to Home's passive wallet teaser - surfaces once per
// calendar month, only when personal withdrawals have actually crossed the
// owner's own danger threshold (see /personal-wallet/summary's status).
// Same re-check-on-navigation + persisted-dismissal pattern as
// PriceAlertPopup, but keyed per MONTH rather than per alert id, since
// there's one ongoing status here, not a list of distinct events - once
// acknowledged for this month, it stays quiet even if the figure drifts
// further, and resets naturally next month.
const RECHECK_INTERVAL_MS = 5 * 60 * 1000;
const DISMISSED_MONTH_KEY = 'dismissed_wallet_alert_month';

export function WalletAlertPopup() {
  const { isAuthenticated, hasPermission } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const segments = useSegments();

  const [visible, setVisible] = useState(false);
  const [safeToSpend, setSafeToSpend] = useState(0);
  const [spentPercent, setSpentPercent] = useState<number | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const dismissedMonthRef = useRef<string | null>(null);
  const lastCheckRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        dismissedMonthRef.current = await AsyncStorage.getItem(DISMISSED_MONTH_KEY);
      } catch {
        dismissedMonthRef.current = null;
      } finally {
        setStorageLoaded(true);
      }
    })();
  }, []);

  const currentMonthKey = () => new Date().toISOString().slice(0, 7);

  const checkAlert = useCallback(async () => {
    if (!isAuthenticated || !hasPermission('view_personal_wallet') || !storageLoaded) return;
    const now = Date.now();
    if (now - lastCheckRef.current < RECHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;
    try {
      const summary = await api.getPersonalWalletSummary();
      if (summary.status === 'danger' && dismissedMonthRef.current !== currentMonthKey()) {
        setSafeToSpend(summary.safe_to_spend);
        setSpentPercent(summary.spent_percent_of_profit);
        setVisible(true);
      }
    } catch (error) {
      console.error('Error checking wallet alert:', error);
    }
  }, [isAuthenticated, hasPermission, storageLoaded]);

  useEffect(() => {
    if (isAuthenticated) checkAlert();
  }, [isAuthenticated, storageLoaded, segments.join('/')]);

  const closePopup = async () => {
    const month = currentMonthKey();
    dismissedMonthRef.current = month;
    try {
      await AsyncStorage.setItem(DISMISSED_MONTH_KEY, month);
    } catch (error) {
      console.error('Error persisting wallet alert dismissal:', error);
    }
    setVisible(false);
  };

  const openWallet = () => {
    setVisible(false);
    router.push('/personal-expenses');
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={closePopup}>
      <View style={styles.overlay}>
        <ModalBlurBackdrop />
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="alert-circle" size={28} color={COLORS.danger} />
            <Text style={styles.title}>{t('wallet.statusDanger')}</Text>
            <TouchableOpacity onPress={closePopup} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            {spentPercent !== null
              ? `${t('wallet.spentThisMonth')}: ${spentPercent.toFixed(0)}% ${t('wallet.ofProfit')}`
              : t('wallet.safeToSpendHint')}
          </Text>

          <View style={styles.safeRow}>
            <Text style={styles.safeLabel}>{t('wallet.safeToSpend')}</Text>
            <Text style={[styles.safeValue, { color: safeToSpend >= 0 ? COLORS.warning : COLORS.danger }]}>
              {safeToSpend.toFixed(2)} €
            </Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={closePopup}>
              <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={openWallet}>
              <Text style={styles.primaryBtnText}>{t('wallet.homeTeaserOpen')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: '#EF444440',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
  },
  closeBtn: {
    padding: 4,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 14,
  },
  safeRow: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  safeLabel: { fontSize: 13, color: COLORS.textSecondary },
  safeValue: { fontSize: 18, fontWeight: 'bold' },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  secondaryBtnText: { color: COLORS.textSecondary, fontWeight: '600', fontSize: 14 },
  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.danger,
  },
  primaryBtnText: { color: 'white', fontWeight: '600', fontSize: 14 },
});

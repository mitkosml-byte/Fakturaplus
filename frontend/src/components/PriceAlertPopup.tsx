import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';

// Surfaces unread price-increase alerts "loudly" as a blocking popup, on top
// of their existing passive listing in Statistics -> Items. Re-checks
// whenever the user returns to a screen (segments change) rather than on a
// timer, since that's the cheapest reliable proxy for "app is in active use"
// available without push infrastructure.
//
// This is meant to inform once, not nag - a dismissed alert is remembered in
// AsyncStorage (not just in-memory) precisely so a page refresh or app
// restart doesn't bring the same still-unread alert back as a popup. The
// passive list in Statistics -> Items is unaffected and still shows it as
// unread; only the pop-up is suppressed once seen.
const RECHECK_INTERVAL_MS = 5 * 60 * 1000;
const DISMISSED_IDS_KEY = 'dismissed_price_alert_popup_ids';
const MAX_STORED_DISMISSED_IDS = 300;

export function PriceAlertPopup() {
  const { isAuthenticated, hasPermission } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const segments = useSegments();

  const [alerts, setAlerts] = useState<any[]>([]);
  const [visible, setVisible] = useState(false);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  const lastCheckRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DISMISSED_IDS_KEY);
        dismissedIdsRef.current = new Set(raw ? JSON.parse(raw) : []);
      } catch (error) {
        dismissedIdsRef.current = new Set();
      } finally {
        setStorageLoaded(true);
      }
    })();
  }, []);

  const persistDismissed = async (ids: Set<string>) => {
    let idsArray = Array.from(ids);
    if (idsArray.length > MAX_STORED_DISMISSED_IDS) {
      idsArray = idsArray.slice(idsArray.length - MAX_STORED_DISMISSED_IDS);
    }
    dismissedIdsRef.current = new Set(idsArray);
    try {
      await AsyncStorage.setItem(DISMISSED_IDS_KEY, JSON.stringify(idsArray));
    } catch (error) {
      console.error('Error persisting dismissed price alerts:', error);
    }
  };

  const checkAlerts = useCallback(async () => {
    if (!isAuthenticated || !hasPermission('view_statistics') || !storageLoaded) return;
    const now = Date.now();
    if (now - lastCheckRef.current < RECHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;
    try {
      const data = await api.getPriceAlerts('unread');
      const fresh = (data.alerts || []).filter((a: any) => !dismissedIdsRef.current.has(a.id));
      if (fresh.length > 0) {
        setAlerts(fresh);
        setVisible(true);
      }
    } catch (error) {
      // Silent - this is a secondary notification, not core functionality.
      console.error('Error checking price alerts:', error);
    }
  }, [isAuthenticated, hasPermission, storageLoaded]);

  useEffect(() => {
    if (isAuthenticated) checkAlerts();
  }, [isAuthenticated, storageLoaded, segments.join('/')]);

  const closePopup = () => {
    const updated = new Set(dismissedIdsRef.current);
    alerts.forEach((a) => updated.add(a.id));
    persistDismissed(updated);
    setVisible(false);
  };

  const goToStatistics = () => {
    closePopup();
    router.push('/(tabs)/stats');
  };

  if (!visible || alerts.length === 0) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={closePopup}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="alert-circle" size={28} color="#EF4444" />
            <Text style={styles.title}>{t('priceAlertPopup.title')}</Text>
            <TouchableOpacity onPress={closePopup} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            {alerts.length === 1
              ? t('priceAlertPopup.subtitleSingle')
              : t('priceAlertPopup.subtitleMultiple').replace('{count}', String(alerts.length))}
          </Text>

          <ScrollView style={styles.list}>
            {alerts.slice(0, 6).map((alert) => (
              <View key={alert.id} style={styles.alertRow}>
                <View style={styles.alertInfo}>
                  <Text style={styles.alertItemName} numberOfLines={1}>{alert.item_name}</Text>
                  <Text style={styles.alertSupplier}>{alert.supplier}</Text>
                </View>
                <View style={styles.alertPrices}>
                  <Text style={styles.alertOldPrice}>{alert.old_price.toFixed(2)}€</Text>
                  <Ionicons name="arrow-forward" size={13} color="#64748B" />
                  <Text style={styles.alertNewPrice}>{alert.new_price.toFixed(2)}€</Text>
                </View>
                <View style={styles.changeBadge}>
                  <Text style={styles.changeText}>+{alert.change_percent}%</Text>
                </View>
              </View>
            ))}
            {alerts.length > 6 && (
              <Text style={styles.moreText}>
                {t('priceAlertPopup.more').replace('{count}', String(alerts.length - 6))}
              </Text>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={closePopup}>
              <Text style={styles.secondaryBtnText}>{t('priceAlertPopup.dismiss')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={goToStatistics}>
              <Text style={styles.primaryBtnText}>{t('priceAlertPopup.viewDetails')}</Text>
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
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
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
    color: '#94A3B8',
    marginBottom: 14,
  },
  list: {
    maxHeight: 320,
  },
  alertRow: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertInfo: {
    flex: 1,
  },
  alertItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  alertSupplier: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  alertPrices: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  alertOldPrice: {
    fontSize: 11,
    color: '#64748B',
    textDecorationLine: 'line-through',
  },
  alertNewPrice: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  changeBadge: {
    backgroundColor: '#EF444420',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  changeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#EF4444',
  },
  moreText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
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
    backgroundColor: '#334155',
  },
  secondaryBtnText: {
    color: '#CBD5E1',
    fontWeight: '600',
    fontSize: 14,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#EF4444',
  },
  primaryBtnText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
});

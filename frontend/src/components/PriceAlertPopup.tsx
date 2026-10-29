import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n';
import { COLORS } from '../theme/colors';
import { Toast } from '../utils/toast';

// Surfaces unread price-change alerts, on top of their existing passive
// listing in Statistics -> Items. Re-checks whenever the user returns to
// a screen (segments change) rather than on a timer, since that's the
// cheapest reliable proxy for "app is in active use" available without
// push infrastructure.
//
// Module 3 audit finding: this used to be a Modal (a full backdrop that
// blocks every tap on the screen behind it) for something that usually
// isn't urgent - a price moving a few percent almost never needs the
// user's immediate, undivided attention the way an error or a confirm
// dialog does. It's now a floating card anchored to the top of the
// screen with no backdrop at all: the rest of the app underneath stays
// fully visible and tappable, and this can be read (or ignored and
// scrolled past) at the user's own pace.
//
// "Seen" state lives ONLY in the backend's own `status` field - there used
// to be a second, parallel "seen" cache in local AsyncStorage, which is
// exactly why old alerts kept resurfacing: it was capped at 300 entries and
// completely disconnected from the real status (Statistics -> Items could
// show an alert as already read/dismissed while this popup, on a different
// device or after the cache evicted it, popped it up again as "new"). A
// single source of truth fixes that for good: closing this popup marks
// every alert it showed as "read" on the server, exactly like the
// checkmark in Statistics -> Items does.
const RECHECK_INTERVAL_MS = 5 * 60 * 1000;

export function PriceAlertPopup() {
  const { isAuthenticated, hasPermission } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const segments = useSegments();

  const [alerts, setAlerts] = useState<any[]>([]);
  const [visible, setVisible] = useState(false);
  const lastCheckRef = useRef(0);

  const checkAlerts = useCallback(async () => {
    if (!isAuthenticated || !hasPermission('view_statistics')) return;
    const now = Date.now();
    if (now - lastCheckRef.current < RECHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;
    try {
      const data = await api.getPriceAlerts('unread');
      if ((data.alerts || []).length > 0) {
        setAlerts(data.alerts);
        setVisible(true);
      }
    } catch (error) {
      // Silent - this is a secondary notification, not core functionality.
      console.error('Error checking price alerts:', error);
    }
  }, [isAuthenticated, hasPermission]);

  useEffect(() => {
    if (isAuthenticated) checkAlerts();
  }, [isAuthenticated, segments.join('/')]);

  const closePopup = () => {
    setVisible(false);
    alerts.forEach((a) => {
      api.updatePriceAlert(a.id, 'read').catch((error) => console.error('Error marking price alert read:', error));
    });
  };

  const viewInvoice = (alert: any) => {
    setVisible(false);
    api.updatePriceAlert(alert.id, 'read').catch((error) => console.error('Error marking price alert read:', error));
    router.push({ pathname: '/(tabs)/invoices', params: { invoiceId: alert.invoice_id } });
  };

  const muteAlert = async (alert: any) => {
    try {
      await api.createPriceAlertMute(alert.item_name, alert.supplier);
      await api.updatePriceAlert(alert.id, 'read');
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
      Toast.success(t('priceAlertPopup.muted'));
    } catch (error) {
      console.error('Error muting price alert:', error);
    }
  };

  const goToStatistics = () => {
    closePopup();
    router.push('/(tabs)/stats');
  };

  if (!visible || alerts.length === 0) return null;

  return (
    <View style={styles.floatingWrap} pointerEvents="box-none">
      <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="alert-circle" size={28} color={COLORS.danger} />
            <Text style={styles.title}>{t('priceAlertPopup.title')}</Text>
            <TouchableOpacity onPress={closePopup} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            {alerts.length === 1
              ? t('priceAlertPopup.subtitleSingle')
              : t('priceAlertPopup.subtitleMultiple').replace('{count}', String(alerts.length))}
          </Text>

          <ScrollView style={styles.list}>
            {alerts.slice(0, 6).map((alert) => {
              const isDecrease = alert.direction === 'decrease';
              return (
                <View key={alert.id} style={styles.alertRow}>
                  <View style={styles.alertTopLine}>
                    <View style={styles.alertInfo}>
                      <Text style={styles.alertItemName} numberOfLines={1}>{alert.item_name}</Text>
                      <Text style={styles.alertSupplier} numberOfLines={1}>
                        {alert.supplier} · {t('priceAlertPopup.invoiceRef').replace('{number}', alert.invoice_number)}
                      </Text>
                    </View>
                    <View style={styles.alertPrices}>
                      <Text style={styles.alertOldPrice}>{alert.old_price.toFixed(2)}€</Text>
                      <Ionicons name="arrow-forward" size={13} color={COLORS.textMuted} />
                      <Text style={[styles.alertNewPrice, isDecrease && styles.alertNewPriceDecrease]}>
                        {alert.new_price.toFixed(2)}€
                      </Text>
                    </View>
                    <View style={[styles.changeBadge, isDecrease && styles.changeBadgeDecrease]}>
                      <Text style={[styles.changeText, isDecrease && styles.changeTextDecrease]}>
                        {alert.change_percent > 0 ? '+' : ''}{alert.change_percent}%
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.alertBasisText}>
                    {(alert.baseline_purchase_count || 1) > 1
                      ? t('priceAlertPopup.basisMultiple').replace('{count}', String(alert.baseline_purchase_count))
                      : t('priceAlertPopup.basisSingle')}
                  </Text>
                  <View style={styles.alertRowActions}>
                    <TouchableOpacity style={styles.alertRowActionBtn} onPress={() => viewInvoice(alert)}>
                      <Ionicons name="document-text-outline" size={13} color={COLORS.primary} />
                      <Text style={styles.alertRowActionText}>{t('priceAlertPopup.viewInvoice')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.alertRowActionBtn} onPress={() => muteAlert(alert)}>
                      <Ionicons name="notifications-off-outline" size={13} color={COLORS.textMuted} />
                      <Text style={styles.alertRowActionTextMuted}>{t('priceAlertPopup.muteItem')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
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
  );
}

const styles = StyleSheet.create({
  floatingWrap: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    zIndex: 50,
    elevation: 10,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: '#EF444440',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
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
  list: {
    maxHeight: 360,
  },
  alertRow: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  alertTopLine: {
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
    color: COLORS.textMuted,
    marginTop: 2,
  },
  alertPrices: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  alertOldPrice: {
    fontSize: 11,
    color: COLORS.textMuted,
    textDecorationLine: 'line-through',
  },
  alertNewPrice: {
    fontSize: 13,
    fontWeight: 'bold',
    color: COLORS.danger,
  },
  alertNewPriceDecrease: {
    color: COLORS.success,
  },
  changeBadge: {
    backgroundColor: '#EF444420',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  changeBadgeDecrease: {
    backgroundColor: '#22C55E20',
  },
  changeText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.danger,
  },
  changeTextDecrease: {
    color: COLORS.success,
  },
  alertBasisText: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 6,
  },
  alertRowActions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
  },
  alertRowActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  alertRowActionText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
  },
  alertRowActionTextMuted: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  moreText: {
    fontSize: 12,
    color: COLORS.textMuted,
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
    backgroundColor: COLORS.border,
  },
  secondaryBtnText: {
    color: COLORS.textSubtle,
    fontWeight: '600',
    fontSize: 14,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.danger,
  },
  primaryBtnText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
});

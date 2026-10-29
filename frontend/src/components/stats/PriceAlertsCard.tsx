import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../../i18n';
import { COLORS } from '../../theme/colors';

// Extracted from stats.tsx (Module 1 audit finding #4 - its own named
// example of a "clean extraction candidate"). Pure presentation + the
// callbacks it needs - all data loading/mutation stays in stats.tsx,
// which still owns the underlying price-alert state.
type Props = {
  priceAlerts: any[];
  unreadAlerts: number;
  onOpenSettings: () => void;
  onViewInvoice: (alert: any) => void;
  onMute: (alert: any) => void;
  onMarkRead: (alertId: string) => void;
  onDismiss: (alertId: string) => void;
};

export function PriceAlertsCard({ priceAlerts, unreadAlerts, onOpenSettings, onViewInvoice, onMute, onMarkRead, onDismiss }: Props) {
  const { t } = useTranslation();
  const visibleAlerts = priceAlerts.filter((a) => a.status !== 'dismissed');

  return (
    <View style={styles.priceAlertsCard}>
      <View style={styles.priceAlertsHeader}>
        <Ionicons name="alert-circle" size={24} color={COLORS.danger} />
        <Text style={styles.priceAlertsTitle}>{t('stats.priceAlerts')}</Text>
        {unreadAlerts > 0 && (
          <View style={styles.alertCountBadge}>
            <Text style={styles.alertCountText}>{unreadAlerts}</Text>
          </View>
        )}
        <TouchableOpacity onPress={onOpenSettings} style={styles.alertSettingsBtn} accessibilityLabel={t('priceAlertSettings.title')}>
          <Ionicons name="settings-outline" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>
      </View>

      {visibleAlerts.length === 0 ? (
        <Text style={styles.alertsEmptyText}>{t('stats.priceAlertsEmpty')}</Text>
      ) : (
        visibleAlerts.slice(0, 5).map((alert) => {
          const isDecrease = alert.direction === 'decrease';
          return (
            <View key={alert.id} style={[styles.alertItem, alert.status === 'unread' && styles.alertItemUnread]}>
              <View style={styles.alertInfo}>
                <Text style={styles.alertItemName} numberOfLines={1}>{alert.item_name}</Text>
                <Text style={styles.alertSupplier}>
                  {alert.supplier} · {t('priceAlertPopup.invoiceRef').replace('{number}', alert.invoice_number)}
                </Text>
                <View style={styles.alertPrices}>
                  <Text style={styles.alertOldPrice}>{alert.old_price.toFixed(2)}€</Text>
                  <Ionicons name="arrow-forward" size={14} color={COLORS.textMuted} />
                  <Text style={[styles.alertNewPrice, isDecrease && { color: COLORS.success }]}>{alert.new_price.toFixed(2)}€</Text>
                  <View style={[styles.alertChangeBadge, isDecrease && { backgroundColor: '#22C55E20' }]}>
                    <Text style={[styles.alertChangeText, isDecrease && { color: COLORS.success }]}>
                      {alert.change_percent > 0 ? '+' : ''}{alert.change_percent}%
                    </Text>
                  </View>
                </View>
                <Text style={styles.alertBasisText}>
                  {(alert.baseline_purchase_count || 1) > 1
                    ? t('priceAlertPopup.basisMultiple').replace('{count}', String(alert.baseline_purchase_count))
                    : t('priceAlertPopup.basisSingle')}
                </Text>
                <View style={styles.alertRowLinks}>
                  <TouchableOpacity onPress={() => onViewInvoice(alert)} style={styles.alertRowLinkBtn}>
                    <Ionicons name="document-text-outline" size={12} color={COLORS.primary} />
                    <Text style={styles.alertRowLinkText}>{t('priceAlertPopup.viewInvoice')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onMute(alert)} style={styles.alertRowLinkBtn}>
                    <Ionicons name="notifications-off-outline" size={12} color={COLORS.textMuted} />
                    <Text style={styles.alertRowLinkTextMuted}>{t('priceAlertPopup.muteItem')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.alertActions}>
                {alert.status === 'unread' && (
                  <TouchableOpacity style={styles.alertActionBtn} onPress={() => onMarkRead(alert.id)}>
                    <Ionicons name="checkmark" size={18} color={COLORS.success} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.alertActionBtn} onPress={() => onDismiss(alert.id)}>
                  <Ionicons name="close" size={18} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  priceAlertsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.danger,
  },
  priceAlertsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  priceAlertsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.danger,
    flex: 1,
  },
  alertCountBadge: {
    backgroundColor: COLORS.danger,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  alertCountText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  alertItemUnread: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.danger,
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
    gap: 6,
    marginTop: 6,
  },
  alertOldPrice: {
    fontSize: 12,
    color: COLORS.textMuted,
    textDecorationLine: 'line-through',
  },
  alertNewPrice: {
    fontSize: 13,
    fontWeight: 'bold',
    color: COLORS.danger,
  },
  alertChangeBadge: {
    backgroundColor: '#EF444420',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  alertChangeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.danger,
  },
  alertActions: {
    flexDirection: 'row',
    gap: 8,
  },
  alertActionBtn: {
    padding: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
  },
  alertSettingsBtn: {
    padding: 4,
  },
  alertsEmptyText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: 12,
  },
  alertBasisText: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  alertRowLinks: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 6,
  },
  alertRowLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  alertRowLinkText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
  },
  alertRowLinkTextMuted: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
});

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from '../../i18n';
import { api } from '../../services/api';
import { Alert } from '../../utils/alert';
import { Toast } from '../../utils/toast';
import { COLORS } from '../../theme/colors';
import { formatMoney } from '../../utils/money';
import { Expandable } from '../Expandable';
import type { ReorderPlan, ReorderPlanItem, ReorderPlanSupplier, ReorderStatus } from '../../types';

const STATUS_COLOR: Record<ReorderStatus, string> = {
  order: COLORS.danger,
  soon: COLORS.warning,
  ok: COLORS.textMuted,
};
const STATUS_KEY: Record<ReorderStatus, string> = {
  order: 'reorder.statusOrder',
  soon: 'reorder.statusSoon',
  ok: 'reorder.statusOk',
};
const STALE_KEY = '__stale__';

// Item names come as written on the invoices, often all lower case.
const named = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

type Props = {
  plan: ReorderPlan | null;
};

// The ordering assistant in one card (it used to be two that repeated each
// other): the suppliers first, closed, each saying how many items are due
// and what the order is usually worth - the ones with something to order
// on top - opening on its items, the quantity in bold; one tap copies the
// order to send. Apart, the items long not bought: asked about, never
// ordered, hidden once no longer used (back when bought again).
export function ReorderPlanCard({ plan }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  if (!plan) return null;
  const stale = plan.stale.filter((item) => !hidden[item.item_key]);
  if (plan.suppliers.length === 0 && stale.length === 0) return null;

  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const itemsCount = (count: number) =>
    count === 1 ? t('reorder.itemOne') : t('reorder.itemMany').replace('{count}', String(count));

  const summary = (group: ReorderPlanSupplier) => {
    const parts: string[] = [];
    if (group.to_order > 0) parts.push(t('reorder.toOrder').replace('{count}', String(group.to_order)));
    if (group.soon > 0) parts.push(t('reorder.soon').replace('{count}', String(group.soon)));
    if (parts.length > 0 && group.order_value > 0) parts.push(`~${formatMoney(group.order_value)}`);
    if (parts.length === 0) parts.push(t('reorder.allGood'), itemsCount(group.items.length));
    return parts.join(' · ');
  };

  const quantity = (item: ReorderPlanItem) =>
    item.recommended_quantity > 0 ? `~${item.recommended_quantity} ${item.unit}` : null;

  const copyOrder = async (group: ReorderPlanSupplier) => {
    const due = group.items.filter((item) => item.status === 'order' || item.status === 'soon');
    const lines = (due.length > 0 ? due : group.items).map((item) =>
      item.recommended_quantity > 0
        ? `• ${named(item.item_name)} – ${item.recommended_quantity} ${item.unit}`
        : `• ${named(item.item_name)}`);
    const text = [t('reorder.orderFor').replace('{supplier}', group.supplier), ...lines].join('\n');
    try {
      await Clipboard.setStringAsync(text);
      Toast.success(t('reorder.copied'));
    } catch {
      // No clipboard here: the order is shown to copy by hand.
      Alert.alert(t('reorder.copy'), text);
    }
  };

  const hide = async (item: ReorderPlanItem) => {
    setHidden((prev) => ({ ...prev, [item.item_key]: true }));
    try {
      await api.hideFromReorderPlan(item.item_key);
      Toast.success(t('reorder.hidden'));
    } catch (error: any) {
      setHidden((prev) => ({ ...prev, [item.item_key]: false }));
      Alert.alert(t('common.error'), error.message);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="cart" size={20} color={COLORS.info} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('reorder.title')}</Text>
          <Text style={styles.subtitle}>{t('reorder.subtitle')}</Text>
        </View>
      </View>

      {plan.suppliers.map((group) => {
        const expanded = !!open[group.supplier];
        return (
          <View key={group.supplier} style={styles.group}>
            <TouchableOpacity
              style={styles.groupRow}
              onPress={() => toggle(group.supplier)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
            >
              <View style={[styles.dot, { backgroundColor: STATUS_COLOR[group.status] }]} />
              <View style={styles.groupText}>
                <Text style={styles.supplier} numberOfLines={2}>{group.supplier}</Text>
                <Text
                  style={[styles.groupSummary, group.status !== 'ok' && { color: STATUS_COLOR[group.status] }]}
                  numberOfLines={2}
                >
                  {summary(group)}
                </Text>
              </View>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <Expandable expanded={expanded}>
              <View style={styles.groupBody}>
                {group.items.map((item) => {
                  const status = item.status || 'ok';
                  const amount = quantity(item);
                  return (
                    <View key={item.item_key} style={styles.item}>
                      <View style={styles.itemText}>
                        <Text style={styles.itemName}>{named(item.item_name)}</Text>
                        {amount && <Text style={styles.itemQuantity}>{amount}</Text>}
                        <Text style={styles.itemRhythm}>
                          {t('reorder.rhythm')
                            .replace('{median}', String(item.median_days_between))
                            .replace('{days}', String(item.days_since_last))}
                          {item.suppliers_count > 1 ? ` · ${t('reorder.alsoOthers')}` : ''}
                        </Text>
                      </View>
                      <View style={[styles.chip, { borderColor: STATUS_COLOR[status] }]}>
                        <Text style={[styles.chipText, { color: status === 'ok' ? COLORS.textSecondary : STATUS_COLOR[status] }]}>
                          {t(STATUS_KEY[status])}
                        </Text>
                      </View>
                    </View>
                  );
                })}
                <TouchableOpacity style={styles.copy} onPress={() => copyOrder(group)} accessibilityRole="button">
                  <Ionicons name="copy-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.copyText}>{t('reorder.copy')}</Text>
                </TouchableOpacity>
              </View>
            </Expandable>
          </View>
        );
      })}

      {stale.length > 0 && (
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.groupRow}
            onPress={() => toggle(STALE_KEY)}
            accessibilityRole="button"
            accessibilityState={{ expanded: !!open[STALE_KEY] }}
          >
            <Ionicons name="time-outline" size={16} color={COLORS.textMuted} style={styles.staleIcon} />
            <View style={styles.groupText}>
              <Text style={styles.staleTitle}>{t('reorder.staleTitle').replace('{count}', String(stale.length))}</Text>
              <Text style={styles.groupSummary}>{t('reorder.staleHint')}</Text>
            </View>
            <Ionicons name={open[STALE_KEY] ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <Expandable expanded={!!open[STALE_KEY]}>
            <View style={styles.groupBody}>
              {stale.map((item) => (
                <View key={item.item_key} style={styles.item}>
                  <View style={styles.itemText}>
                    <Text style={styles.itemName}>{named(item.item_name)}</Text>
                    <Text style={styles.itemRhythm}>
                      {t('reorder.staleRhythm')
                        .replace('{supplier}', item.last_supplier)
                        .replace('{median}', String(item.median_days_between))
                        .replace('{days}', String(item.days_since_last))}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.hide} onPress={() => hide(item)} accessibilityRole="button">
                    <Text style={styles.hideText}>{t('reorder.hide')}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </Expandable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '700', color: 'white' },
  subtitle: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2, lineHeight: 16 },
  group: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  groupText: { flex: 1, minWidth: 0 },
  supplier: { fontSize: 15, fontWeight: '700', color: 'white' },
  groupSummary: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  groupBody: { paddingBottom: 12, gap: 10 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  itemText: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 14, color: 'white', fontWeight: '500' },
  itemQuantity: { fontSize: 15, color: 'white', fontWeight: '800', marginTop: 2 },
  itemRhythm: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  chip: { borderWidth: 1, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  chipText: { fontSize: 12, fontWeight: '700' },
  copy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 10,
  },
  copyText: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  staleIcon: { width: 10, textAlign: 'center' },
  staleTitle: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  hide: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  hideText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
});

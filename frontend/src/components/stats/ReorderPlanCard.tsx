import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { parseISO } from 'date-fns/parseISO';
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
  ordered: COLORS.info,
  ok: COLORS.textMuted,
};
const STATUS_KEY: Record<ReorderStatus, string> = {
  order: 'reorder.statusOrder',
  soon: 'reorder.statusSoon',
  ordered: 'reorder.statusOrdered',
  ok: 'reorder.statusOk',
};
const STALE_KEY = '__stale__';

type IconName = keyof typeof Ionicons.glyphMap;

// Days come as "YYYY-MM-DD": read as that calendar day here.
const dayOf = (text: string) => {
  const [year, month, day] = text.split('-').map(Number);
  return new Date(year, month - 1, day);
};
// 0 = Monday, as the plan counts weekdays.
const weekdayOf = (day: Date) => (day.getDay() + 6) % 7;

// Item names come as written on the invoices, often all lower case.
const named = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

type Props = {
  plan: ReorderPlan | null;
  // After "Поръчано" (or its undo): the plan again.
  onChanged?: () => void;
};

// The ordering assistant in one card (it used to be two that repeated each
// other): the suppliers first, closed, each saying how many items are due
// and what the order is usually worth - the ones with something to order
// on top - opening on its items, the quantity in bold; one tap copies the
// order to send, another marks it "Поръчано" so nobody orders it twice.
// A supplier with fixed delivery days (read from its invoice dates) says
// its next delivery and the day to order for it - at least the day before
// - and, opened, a public holiday on that delivery, what an order came
// without and a delivery with no invoice. Apart, the items long not
// bought: asked about, never ordered, hidden once no longer used (back
// when bought again).
export function ReorderPlanCard({ plan, onChanged }: Props) {
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
    if (parts.length === 0 && group.ordered > 0) {
      const latest = group.items.map((item) => item.ordered?.at).filter((at): at is string => !!at).sort().pop();
      parts.push(latest ? t('reorder.orderedWhen').replace('{when}', when(latest)) : t('reorder.statusOrdered'));
    }
    if (parts.length === 0) parts.push(t('reorder.allGood'), itemsCount(group.items.length));
    return parts.join(' · ');
  };

  // The supplier's next order: what is due for its next delivery (fixed
  // days) or due at all (no fixed days).
  const due = (group: ReorderPlanSupplier) =>
    group.items.filter((item) => item.in_next_order ?? (item.status === 'order' || item.status === 'soon'));

  const weekdaysShort = t('reorder.weekdaysShort').split(',');
  // "пт, 21.11"
  const dayLabel = (text: string) => {
    const day = dayOf(text);
    return `${weekdaysShort[weekdayOf(day)]}, ${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}`;
  };
  // "поръчай днес", "поръчай утре", "поръчай до чт".
  const orderByLabel = (text: string) => {
    const days = differenceInCalendarDays(dayOf(text), new Date());
    if (days < 0) return t('reorder.orderNow');
    if (days === 0) return t('reorder.orderToday');
    if (days === 1) return t('reorder.orderTomorrow');
    return t('reorder.orderBy').replace('{day}', weekdaysShort[weekdayOf(dayOf(text))]);
  };
  const deliveryDays = (group: ReorderPlanSupplier) =>
    t('reorder.delivers').replace('{days}', (group.schedule || []).map((weekday) => weekdaysShort[weekday]).join(', '))
    + (group.schedule_changed ? ` · ${t('reorder.newDays')}` : '');
  // Under a supplier with fixed days: its next delivery and when to order
  // for it - or, with nothing due, the days it delivers.
  const deliveryLine = (group: ReorderPlanSupplier) => {
    if (!group.schedule?.length) return null;
    if (due(group).length > 0 && group.next_delivery && group.order_by) {
      return `${t('reorder.deliveryOn').replace('{day}', dayLabel(group.next_delivery))} · ${orderByLabel(group.order_by)}`;
    }
    return deliveryDays(group);
  };
  // Opened: what needs a look - an order that came without something, a
  // delivery with no invoice, a holiday on the next one - and the days.
  const notes = (group: ReorderPlanSupplier) => {
    const list: { key: string; icon: IconName; color: string; text: string }[] = [];
    if (group.missing) {
      list.push({
        key: 'missing', icon: 'alert-circle', color: COLORS.danger,
        text: t('reorder.missing').replace('{day}', dayLabel(group.missing.date))
          .replace('{items}', group.missing.items.map(named).join(', ')),
      });
    }
    if (group.no_invoice) {
      list.push({
        key: 'invoice', icon: 'document-text', color: COLORS.warning,
        text: t('reorder.noInvoice').replace('{day}', dayLabel(group.no_invoice)),
      });
    }
    if (group.holiday) {
      list.push({
        key: 'holiday', icon: 'flag', color: COLORS.warning,
        text: named(t('reorder.holiday').replace('{day}', dayLabel(group.holiday.date)).replace('{name}', group.holiday.name)),
      });
    }
    if (group.schedule?.length && due(group).length > 0) {
      list.push({ key: 'days', icon: 'calendar-outline', color: COLORS.textSecondary, text: deliveryDays(group) });
    }
    return list;
  };
  const needsLook = (group: ReorderPlanSupplier) => !!(group.missing || group.no_invoice || group.holiday);

  // "днес", "вчера", "преди 3 дни".
  const when = (at: string) => {
    const days = Math.max(0, differenceInCalendarDays(new Date(), parseISO(at)));
    return days === 0 ? t('reorder.today') : days === 1 ? t('reorder.yesterday') : t('reorder.daysAgo').replace('{count}', String(days));
  };

  const orderedLine = (item: ReorderPlanItem) => {
    if (!item.ordered) return null;
    const text = item.ordered.by ? t('reorder.orderedWhenBy') : t('reorder.orderedWhen');
    return text.replace('{when}', when(item.ordered.at)).replace('{name}', item.ordered.by || '');
  };

  const quantity = (item: ReorderPlanItem) =>
    item.recommended_quantity > 0 ? `~${item.recommended_quantity} ${item.unit}` : null;

  const copyOrder = async (group: ReorderPlanSupplier) => {
    // What is due; else what was marked ordered (to send again); else all.
    const ordered = group.items.filter((item) => item.status === 'ordered');
    const chosen = due(group).length > 0 ? due(group) : ordered.length > 0 ? ordered : group.items;
    const lines = chosen.map((item) =>
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

  const markOrdered = async (group: ReorderPlanSupplier) => {
    const keys = due(group).map((item) => item.item_key);
    if (keys.length === 0) return;
    try {
      const { order_ids: orderIds } = await api.markReorderOrdered(keys);
      onChanged?.();
      Toast.undo(t('reorder.markedOrdered'), async () => {
        try {
          await api.undoReorderOrdered(keys, orderIds);
        } finally {
          onChanged?.();
        }
      }, undefined, { icon: 'checkmark-circle', color: COLORS.info });
    } catch (error: any) {
      Alert.alert(t('common.error'), error.message);
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
                {deliveryLine(group) && <Text style={styles.deliveryLine} numberOfLines={2}>{deliveryLine(group)}</Text>}
              </View>
              {needsLook(group) && <Ionicons name="alert-circle" size={18} color={COLORS.warning} />}
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <Expandable expanded={expanded}>
              <View style={styles.groupBody}>
                {notes(group).map((note) => (
                  <View key={note.key} style={styles.note}>
                    <Ionicons name={note.icon} size={16} color={note.color} />
                    <Text style={[styles.noteText, { color: note.color === COLORS.textSecondary ? COLORS.textSecondary : 'white' }]}>
                      {note.text}
                    </Text>
                  </View>
                ))}
                {group.items.map((item) => {
                  const status = item.status || 'ok';
                  const amount = quantity(item);
                  // Due for a later delivery than the supplier's next one.
                  const later = !!item.delivery && item.delivery !== group.next_delivery && (status === 'order' || status === 'soon');
                  return (
                    <View key={item.item_key} style={styles.item}>
                      <View style={styles.itemText}>
                        <Text style={styles.itemName}>{named(item.item_name)}</Text>
                        {amount && (
                          <Text style={styles.itemQuantity}>
                            {amount}
                            {item.usual_for_weekday && item.delivery ? (
                              <Text style={styles.itemUsual}>
                                {` · ${t('reorder.usually').replace('{day}', t('reorder.onWeekdays').split(',')[weekdayOf(dayOf(item.delivery))])}`}
                              </Text>
                            ) : null}
                          </Text>
                        )}
                        <Text style={styles.itemRhythm}>
                          {t('reorder.rhythm')
                            .replace('{median}', String(item.median_days_between))
                            .replace('{days}', String(item.days_since_last))}
                          {item.suppliers_count > 1 ? ` · ${t('reorder.alsoOthers')}` : ''}
                          {later && item.delivery ? ` · ${t('reorder.deliveryOn').replace('{day}', dayLabel(item.delivery)).toLowerCase()}` : ''}
                        </Text>
                        {item.missing_on && (
                          <Text style={styles.itemMissing}>{t('reorder.missingItem').replace('{day}', dayLabel(item.missing_on))}</Text>
                        )}
                        {item.ordered && <Text style={styles.itemOrdered}>{orderedLine(item)}</Text>}
                      </View>
                      <View style={[styles.chip, { borderColor: STATUS_COLOR[status] }]}>
                        <Text style={[styles.chipText, { color: status === 'ok' ? COLORS.textSecondary : STATUS_COLOR[status] }]}>
                          {t(STATUS_KEY[status])}
                        </Text>
                      </View>
                    </View>
                  );
                })}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.copy} onPress={() => copyOrder(group)} accessibilityRole="button">
                    <Ionicons name="copy-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.copyText} numberOfLines={1}>{t('reorder.copy')}</Text>
                  </TouchableOpacity>
                  {due(group).length > 0 && (
                    <TouchableOpacity style={styles.ordered} onPress={() => markOrdered(group)} accessibilityRole="button">
                      <Ionicons name="checkmark" size={16} color="white" />
                      <Text style={styles.orderedText} numberOfLines={1}>{t('reorder.markOrdered')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
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
  deliveryLine: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  noteText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 },
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
  itemOrdered: { fontSize: 12, color: COLORS.info, marginTop: 2, fontWeight: '600' },
  itemUsual: { fontSize: 12, color: COLORS.textSecondary, fontWeight: '500' },
  itemMissing: { fontSize: 12, color: COLORS.danger, marginTop: 2, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10 },
  copy: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  copyText: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: COLORS.primary },
  ordered: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.info,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  orderedText: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: 'white' },
  staleIcon: { width: 10, textAlign: 'center' },
  staleTitle: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  hide: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  hideText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
});

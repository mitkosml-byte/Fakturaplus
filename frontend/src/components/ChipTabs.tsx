import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { COLORS } from '../theme/colors';
import { DURATION, EASING } from '../theme/motion';

export type ChipTabOption<T extends string> = {
  key: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  badge?: number;
};

type Props<T extends string> = {
  options: ChipTabOption<T>[];
  active: T;
  onChange: (key: T) => void;
};

// Motion Design System: "Category tab / chip switch" - a sliding pill
// tracks the active chip (fast/standard), rather than each chip
// independently swapping its own background instantly. First built for
// Profile's category selector; reused here for Stats' tab and period
// rows instead of duplicating the same pill-tracking logic three times.
export function ChipTabs<T extends string>({ options, active, onChange }: Props<T>) {
  const rowRef = useRef<View>(null);
  const chipRefs = useRef<Partial<Record<string, any>>>({});
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const prevKeysRef = useRef<string | null>(null);

  const movePillTo = (key: string, animate: boolean) => {
    const node = chipRefs.current[key];
    const row = rowRef.current;
    if (!node || !row) return;
    // @ts-ignore - measureLayout is exposed by the host component both the
    // View and the TouchableOpacity ref forward to on native and web.
    node.measureLayout(
      row,
      (x: number, _y: number, width: number) => {
        if (animate) {
          pillX.value = withTiming(x, { duration: DURATION.fast, easing: EASING.standard });
          pillWidth.value = withTiming(width, { duration: DURATION.fast, easing: EASING.standard });
        } else {
          pillX.value = x;
          pillWidth.value = width;
        }
      },
      () => {}
    );
  };

  const keysSignature = options.map((o) => o.key).join(',');
  useEffect(() => {
    // Re-snap (no animation - not a user action) whenever the option set
    // itself changes, e.g. a permission-gated tab appearing/disappearing
    // a beat after this screen's first paint shifts every chip after it.
    const isFirst = prevKeysRef.current === null;
    prevKeysRef.current = keysSignature;
    movePillTo(active, !isFirst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSignature, active]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: pillWidth.value,
  }));

  return (
    <View ref={rowRef} style={styles.row}>
      <Animated.View style={[styles.pill, pillStyle]} />
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.key}
          ref={(node) => { chipRefs.current[opt.key] = node; }}
          style={styles.chip}
          onPress={() => onChange(opt.key)}
        >
          {opt.icon && (
            <View style={styles.iconWrap}>
              <Ionicons name={opt.icon} size={16} color={active === opt.key ? 'white' : COLORS.textMuted} />
              {!!opt.badge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{opt.badge}</Text>
                </View>
              )}
            </View>
          )}
          <Text style={[styles.chipText, active === opt.key && styles.chipTextActive]}>{opt.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  pill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  iconWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipText: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
    textAlign: 'center',
  },
  chipTextActive: {
    color: 'white',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: COLORS.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
  },
});

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore, ToastItem } from '../stores/toastStore';
import { COLORS } from '../theme/colors';
import { DURATION, EASING } from '../theme/motion';

const ICONS: Record<ToastItem['variant'], keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  info: 'information-circle',
  undo: 'trash-outline',
};

const ICON_COLORS: Record<ToastItem['variant'], string> = {
  success: COLORS.success,
  info: COLORS.info,
  undo: COLORS.danger,
};

// One toast at a time, mounted once near the root (see app/_layout.tsx) -
// Motion Design System: enters sliding up + fading in (fast/easeOut),
// holds for its duration, exits the same way in reverse (fast/easeIn).
// Tapping the body dismisses early; the action button (used by the undo
// variant) fires its callback and dismisses without waiting out the hold.
export function ToastHost() {
  const current = useToastStore((s) => s.current);
  const dismissCurrent = useToastStore((s) => s.dismissCurrent);
  const insets = useSafeAreaInsets();

  const translateY = useSharedValue(40);
  const opacity = useSharedValue(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemRef = useRef<ToastItem | null>(null);
  itemRef.current = current;

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const animateOutAndAdvance = () => {
    clearTimer();
    translateY.value = withTiming(40, { duration: DURATION.fast, easing: EASING.easeIn });
    opacity.value = withTiming(0, { duration: DURATION.fast, easing: EASING.easeIn }, (finished) => {
      if (finished) runOnJS(dismissCurrent)();
    });
  };

  useEffect(() => {
    if (!current) return;
    translateY.value = withTiming(0, { duration: DURATION.fast, easing: EASING.easeOut });
    opacity.value = withTiming(1, { duration: DURATION.fast, easing: EASING.easeOut });
    timerRef.current = setTimeout(animateOutAndAdvance, current.duration);
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!current) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + 84 }]}>
      <Animated.View style={[styles.toast, animatedStyle]}>
        <Pressable style={styles.body} onPress={animateOutAndAdvance}>
          <Ionicons name={ICONS[current.variant]} size={20} color={ICON_COLORS[current.variant]} />
          <Text style={styles.message} numberOfLines={2}>
            {current.message}
          </Text>
        </Pressable>
        {current.actionLabel && (
          <Pressable
            style={styles.action}
            onPress={() => {
              current.onAction?.();
              animateOutAndAdvance();
            }}
          >
            <Text style={styles.actionText}>{current.actionLabel}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    maxWidth: 480,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  message: {
    flex: 1,
    color: COLORS.textLight,
    fontSize: 14,
    fontWeight: '600',
  },
  action: {
    marginLeft: 12,
    paddingHorizontal: 4,
  },
  actionText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },
});

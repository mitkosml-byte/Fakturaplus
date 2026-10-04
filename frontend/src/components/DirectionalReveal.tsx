import React, { useLayoutEffect, useRef } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { DURATION, EASING } from '../theme/motion';

type Props = {
  // Identifies "which period's data this is" - changing it (to a value
  // this component hasn't shown before) triggers the reveal.
  revealKey: string;
  children: React.ReactNode;
};

export type DirectionalRevealHandle = {
  setDirection: (direction: 1 | -1) => void;
};

// Motion Design System #17 (Home/Stats period navigation): new data enters
// from the direction of travel - a small offset + fade, not a full
// off-screen throw (which fights the cards' own variable height) - rather
// than the numbers just jumping to their new values. The ‹ › buttons call
// `setDirection` right before changing the period state, so this knows
// which way to enter from by the time the new data actually renders.
export function useDirectionalReveal(revealKey: string) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const pendingDirection = useRef<1 | -1 | 0>(0);
  const lastKey = useRef<string | null>(null);

  useLayoutEffect(() => {
    const isFirst = lastKey.current === null;
    lastKey.current = revealKey;
    if (isFirst) return;
    const dir = pendingDirection.current;
    pendingDirection.current = 0;
    if (dir === 0) {
      // A non-directional change (mode switch, manual date edit) - a plain
      // cross-fade, not a slide (no "direction" to communicate here).
      opacity.value = 0;
      opacity.value = withTiming(1, { duration: DURATION.standard, easing: EASING.easeOut });
      return;
    }
    translateX.value = dir * 16;
    opacity.value = 0;
    translateX.value = withTiming(0, { duration: DURATION.standard, easing: EASING.standard });
    opacity.value = withTiming(1, { duration: DURATION.standard, easing: EASING.easeOut });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return { style, setDirection: (d: 1 | -1) => { pendingDirection.current = d; } };
}

export function DirectionalReveal({ revealKey, children }: Props) {
  const { style } = useDirectionalReveal(revealKey);
  return <Animated.View style={style}>{children}</Animated.View>;
}

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, runOnJS, Easing } from 'react-native-reanimated';
import { COLORS } from '../theme/colors';

type Props = {
  trigger: boolean;
  onDone?: () => void;
};

// A brief radiant pulse behind whatever it's placed inside (absolutely
// filled, non-interactive) - reserved for a genuine milestone (the period
// turning profitable, say), never a routine save. A confetti burst would
// read as gimmicky on a finance app; a soft expanding glow doesn't.
// Fires once per `trigger` flip to true, then calls onDone so the caller
// can reset it for the next occurrence.
export function CelebrationGlow({ trigger, onDone }: Props) {
  const scale = useSharedValue(0.6);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!trigger) return;
    scale.value = 0.6;
    opacity.value = 0.5;
    scale.value = withTiming(1.8, { duration: 900, easing: Easing.out(Easing.cubic) });
    opacity.value = withSequence(
      withTiming(0.5, { duration: 50 }),
      withTiming(0, { duration: 850, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished && onDone) runOnJS(onDone)();
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, style]} />;
}

const styles = StyleSheet.create({
  ring: {
    borderRadius: 999,
    backgroundColor: COLORS.success,
  },
});

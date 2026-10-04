import React, { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';

type Props = {
  name: React.ComponentProps<typeof Ionicons>['name'];
  size?: number;
  color?: string;
};

// A slow, calm vertical drift (not a spin or a bounce - this sits on an
// empty-state screen, it shouldn't demand attention) so a "nothing here
// yet" screen reads as alive rather than static. Loops for as long as the
// icon stays mounted.
export function AnimatedEmptyIcon({ name, size = 48, color = COLORS.textMuted }: Props) {
  const translateY = useSharedValue(0);

  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, []);

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Animated.View style={style}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}

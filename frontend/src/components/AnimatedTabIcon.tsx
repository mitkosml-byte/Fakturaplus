import React, { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from 'react-native-reanimated';
import { DURATION, EASING } from '../theme/motion';

type Props = {
  focused: boolean;
  children: React.ReactNode;
};

// A small pop (1 -> 1.18 -> 1) the moment a tab becomes focused, so
// switching tabs reads as a deliberate, alive transition instead of the
// icon just silently swapping color. Does nothing while already focused -
// only the focus transition itself triggers it.
export function AnimatedTabIcon({ focused, children }: Props) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (focused) {
      scale.value = withSequence(
        withTiming(1.18, { duration: DURATION.micro, easing: EASING.easeOut }),
        withTiming(1, { duration: DURATION.fast, easing: EASING.standard })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

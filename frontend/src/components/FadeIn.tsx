import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { DURATION, EASING } from '../theme/motion';

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

// Motion Design System #5: once a loading spinner gives way to real
// content, the content fades in instead of popping in at full opacity -
// a calmer handoff for the "spinner → data" moment that recurs across
// the stats/report screens. Runs once per mount, so re-use it only on
// content that's freshly mounted when loading finishes (not on content
// that stays mounted across re-renders).
export function FadeIn({ children, style }: Props) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: DURATION.standard, easing: EASING.easeOut });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

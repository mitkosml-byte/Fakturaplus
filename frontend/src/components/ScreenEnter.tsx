import React, { useEffect } from 'react';
import { Platform, StyleProp, ViewStyle, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { DURATION, EASING } from '../theme/motion';

type Props = {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

// Motion Design System #1 (screen transitions): react-navigation's
// native-stack renders each screen as a plain swapped view on web (no
// animation support there at all - confirmed against react-native-screens'
// own Screen.web.tsx), while `animation` in the root Stack's screenOptions
// already covers iOS/Android for free via the native APIs. This wrapper
// is the web-only fix for the resulting instant cut: it slides its
// content in from the right and fades it in on mount, once, so a pushed
// screen on web reads as "I moved somewhere" instead of "data appeared".
//
// Native is deliberately left alone here - it already gets the real
// native-stack transition, and stacking this on top of it would violate
// Principle #4 (one motion per event).
export function ScreenEnter({ style, children }: Props) {
  const { width } = useWindowDimensions();
  const translateX = useSharedValue(Platform.OS === 'web' ? width * 0.08 : 0);
  const opacity = useSharedValue(Platform.OS === 'web' ? 0 : 1);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    translateX.value = withTiming(0, { duration: DURATION.standard, easing: EASING.easeOut });
    opacity.value = withTiming(1, { duration: DURATION.standard, easing: EASING.easeOut });
    // Runs once on mount - a pushed screen is a fresh mount every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  return (
    <Animated.View style={[{ flex: 1 }, style, animatedStyle]}>{children}</Animated.View>
  );
}

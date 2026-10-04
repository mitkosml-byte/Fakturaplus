import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withDelay, withTiming } from 'react-native-reanimated';
import { DURATION, EASING, STAGGER_MS } from '../theme/motion';

type Props = {
  index: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

// OCR reveal choreography (Motion Design System, flagship moment):
// recognized fields populate top-to-bottom in a single pass, each
// cross-fading from empty to filled - never typed out character by
// character, which reads as a gimmick rather than a result. Mounting
// this wrapper (the form it's used in is conditionally rendered, so it
// mounts fresh every time a scan completes) is what triggers the reveal;
// `index` only staggers each field's start time.
export function StaggerReveal({ index, children, style }: Props) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(
      Math.min(index, 5) * STAGGER_MS,
      withTiming(1, { duration: DURATION.standard, easing: EASING.easeOut })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

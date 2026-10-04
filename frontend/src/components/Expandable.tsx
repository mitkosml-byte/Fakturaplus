import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { DURATION, EASING } from '../theme/motion';

type Props = {
  expanded: boolean;
  children: React.ReactNode;
};

// Motion Design System: "Expand / collapse" — height animates to the
// measured content height (and opacity along with it) instead of the
// content just appearing/disappearing and shoving everything below it.
// The content is always mounted (off-screen when collapsed) so its
// natural height can be measured via onLayout before it's ever shown.
export function Expandable({ expanded, children }: Props) {
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useSharedValue(expanded ? 1 : 0);
  const measuredRef = useRef(false);

  const onLayout = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    if (height > 0 && height !== contentHeight) {
      setContentHeight(height);
      if (!measuredRef.current && expanded) {
        measuredRef.current = true;
        progress.value = 1;
      }
    }
  };

  React.useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: DURATION.deliberate,
      easing: EASING.standard,
    });
  }, [expanded]);

  const containerStyle = useAnimatedStyle(() => ({
    height: progress.value * contentHeight,
    opacity: progress.value,
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <View style={styles.measure} onLayout={onLayout}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});

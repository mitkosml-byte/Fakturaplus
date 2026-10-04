import React, { useEffect, useRef } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { DURATION, EASING } from '../theme/motion';

type Props = {
  label: string;
  color: string;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
};

// Motion Design System #25: a brief highlight on the role badge itself
// when a role actually changes (not on first mount), so a permission
// update reads as "this changed" instead of the badge silently having
// different text the next time you look at it. Takes the caller's own
// badge/text styles as-is (no layout changes) and only adds the pulse.
export function RoleBadge({ label, color, style, textStyle }: Props) {
  const highlight = useSharedValue(0);
  const prevLabel = useRef(label);

  useEffect(() => {
    if (prevLabel.current !== label) {
      prevLabel.current = label;
      highlight.value = 1;
      highlight.value = withTiming(0, { duration: DURATION.narrative, easing: EASING.easeOut });
    }
  }, [label]);

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: highlight.value,
  }));

  return (
    <View style={[style, styles.clip]}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color }, highlightStyle]} />
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});

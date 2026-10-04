import React from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { DURATION, EASING } from '../theme/motion';

type Props = {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: 'button';
  testID?: string;
};

// Drop-in replacement for TouchableOpacity on the taps that matter (Save,
// Buy, Delete) - Motion Design System #9: primary/destructive actions get
// a brief scale-down-and-back in addition to the opacity drop, so they
// read as deliberately firmer than a passive settings row.
//
// Built on Pressable's onPressIn/onPressOut rather than
// react-native-gesture-handler's GestureDetector: GestureDetector fails
// under RN-Web's `display:contents` wrapper on the RN version this app
// runs (see the tab-bar swipe's own PanResponder workaround), and this
// component is used across the web build too.
export function PressableScale({
  onPress,
  onLongPress,
  disabled,
  style,
  children,
  accessibilityLabel,
  accessibilityRole,
  testID,
}: Props) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const pressIn = () => {
    scale.value = withTiming(0.97, { duration: DURATION.micro, easing: EASING.easeOut });
    opacity.value = withTiming(0.7, { duration: DURATION.micro, easing: EASING.easeOut });
  };

  const pressOut = () => {
    scale.value = withTiming(1, { duration: DURATION.micro, easing: EASING.easeOut });
    opacity.value = withTiming(1, { duration: DURATION.micro, easing: EASING.easeOut });
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      testID={testID}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { PanResponder } from 'react-native';
import { BlurView } from 'expo-blur';
import { COLORS } from '../theme/colors';
import { DURATION, EASING, SHEET_SPRING } from '../theme/motion';

type Props = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

// Motion Design System #3 (sharpened from the audit's first pass): one
// shared bottom-sheet pattern - backdrop fades in, sheet rises on
// standard/easeOut, a drag handle supports rubber-band drag-to-dismiss
// released with a critically damped spring (no overshoot - this handles
// money, not a social feed). Replaces the stock <Modal animationType=
// "slide"> wherever a screen's own overlay is actually bottom-anchored
// (justifyContent: 'flex-end') - a screen styled as a CENTERED dialog is
// a different thing and keeps its own treatment; converting it to a
// sheet would be a layout change, which is out of scope here.
//
// PanResponder rather than react-native-gesture-handler: GestureDetector
// wraps children in a "display: contents" div on web, which breaks
// pointer-in-bounds detection there (the same reason the tab bar swipe
// uses PanResponder) - this component needs to work on the web build too.
export function BottomSheet({ visible, onClose, children, style }: Props) {
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(height);
  const backdropOpacity = useSharedValue(0);
  const dragStartY = useRef(0);

  const animateOut = (onDone?: () => void) => {
    translateY.value = withTiming(height, { duration: DURATION.fast, easing: EASING.easeIn }, (finished) => {
      if (finished && onDone) runOnJS(onDone)();
    });
    backdropOpacity.value = withTiming(0, { duration: DURATION.fast, easing: EASING.easeIn });
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = withTiming(0, { duration: DURATION.standard, easing: EASING.easeOut });
      backdropOpacity.value = withTiming(0.6, { duration: DURATION.standard, easing: EASING.easeOut });
    } else if (mounted) {
      animateOut(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        dragStartY.current = translateY.value;
      },
      onPanResponderMove: (_evt, gesture) => {
        // Tracks the finger 1:1; rubber-band resistance going upward past
        // the sheet's resting position instead of letting it fly off past
        // the top of the screen.
        const next = dragStartY.current + gesture.dy;
        translateY.value = next < 0 ? next / 3 : next;
      },
      onPanResponderRelease: (_evt, gesture) => {
        const draggedFar = gesture.dy > 120 || gesture.vy > 0.8;
        if (draggedFar) {
          animateOut(onClose);
        } else {
          translateY.value = withSpring(0, SHEET_SPRING);
        }
      },
    })
  ).current;

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        {/* Blurs whatever is behind the sheet instead of just dimming it -
            the glass/frosted look a native sheet is expected to have.
            BlurView has a web implementation (CSS backdrop-filter), so this
            works on the web build too. */}
        <BlurView intensity={32} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdrop]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => animateOut(onClose)} />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.sheet, style, sheetStyle]}>
          <View {...panResponder.panHandlers} style={styles.dragHandleArea}>
            <View style={styles.dragHandle} />
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: '#000',
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  dragHandleArea: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
  },
});

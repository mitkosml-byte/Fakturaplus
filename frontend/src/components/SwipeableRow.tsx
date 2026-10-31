import React, { useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';

type SwipeAction = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
};

type Props = {
  children: React.ReactNode;
  // Revealed swiping the row LEFT (action sits on the right) - the
  // destructive slot, e.g. delete.
  rightAction?: SwipeAction;
  // Revealed swiping the row RIGHT (action sits on the left) - the
  // positive slot, e.g. edit / mark paid / mark done.
  leftAction?: SwipeAction;
};

// Thin wrapper around react-native-gesture-handler's Swipeable, so every
// list screen gets the same swipe-to-act gesture instead of only small icon
// taps. A screen that only wants one direction simply omits the other prop.
export function SwipeableRow({ children, rightAction, leftAction }: Props) {
  const ref = useRef<Swipeable>(null);

  const runAndClose = (action: SwipeAction) => {
    ref.current?.close();
    action.onPress();
  };

  function renderRightActions(progress: Animated.AnimatedInterpolation<number>) {
    if (!rightAction) return null;
    const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [76, 0] });
    return (
      <Animated.View style={{ transform: [{ translateX }] }}>
        <TouchableOpacity
          style={[styles.action, { backgroundColor: rightAction.color }]}
          onPress={() => runAndClose(rightAction)}
        >
          <Ionicons name={rightAction.icon} size={20} color="white" />
          <Text style={styles.actionText} numberOfLines={1}>{rightAction.label}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  function renderLeftActions(progress: Animated.AnimatedInterpolation<number>) {
    if (!leftAction) return null;
    const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-76, 0] });
    return (
      <Animated.View style={{ transform: [{ translateX }] }}>
        <TouchableOpacity
          style={[styles.action, { backgroundColor: leftAction.color }]}
          onPress={() => runAndClose(leftAction)}
        >
          <Ionicons name={leftAction.icon} size={20} color="white" />
          <Text style={styles.actionText} numberOfLines={1}>{leftAction.label}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  if (!rightAction && !leftAction) return <>{children}</>;

  return (
    <Swipeable
      ref={ref}
      friction={2}
      overshootRight={false}
      overshootLeft={false}
      renderRightActions={rightAction ? renderRightActions : undefined}
      renderLeftActions={leftAction ? renderLeftActions : undefined}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    width: 76,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  actionText: { color: 'white', fontSize: 11, fontWeight: '700' },
});

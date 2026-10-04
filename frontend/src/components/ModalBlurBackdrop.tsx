import React from 'react';
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';

type Props = {
  tint?: 'dark' | 'light' | 'default';
  intensity?: number;
  overlayColor?: string;
  style?: StyleProp<ViewStyle>;
};

// Frosted-glass backdrop for centered dialogs (<Modal transparent> screens
// that aren't bottom-anchored, so they use their own overlay rather than
// the shared BottomSheet - see that component's note on the distinction).
// Absolutely positioned and non-interactive, so it drops behind a modal's
// existing content without changing its layout or tap-to-dismiss behavior.
export function ModalBlurBackdrop({ tint = 'dark', intensity = 32, overlayColor = 'rgba(0,0,0,0.45)', style }: Props) {
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]} />
    </View>
  );
}

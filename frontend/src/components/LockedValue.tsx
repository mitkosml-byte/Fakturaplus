import React from 'react';
import { View, Text, StyleSheet, StyleProp, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { COLORS } from '../theme/colors';

type Props = {
  // Matched against the real value's own text style (font size/weight/
  // color) so the blurred placeholder sits at the same size and doesn't
  // make the card jump when a permission is later granted.
  textStyle?: StyleProp<TextStyle>;
  fakeText?: string;
  iconSize?: number;
};

// A believable-looking number, blurred via a BlurView overlay (same
// absolute-overlay-on-top-of-content technique as ModalBlurBackdrop), with
// a small lock badge on top - used wherever a real financial figure would
// go but this viewer lacks view_statistics. Never renders anything derived
// from the real summary - the backend already sends null for every such
// field, so there is nothing sensitive behind the blur, only this
// component's own static placeholder text.
export function LockedValue({ textStyle, fakeText = '000.00 €', iconSize = 14 }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={[textStyle, styles.fakeText]} numberOfLines={1}>
        {fakeText}
      </Text>
      <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.lockBadge}>
        <Ionicons name="lock-closed" size={iconSize} color={COLORS.textLight} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 6,
  },
  fakeText: {
    opacity: 0.55,
  },
  lockBadge: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { GLOW, useDayPart } from '../theme/dayPart';

// The greeting card's sky behind a whole screen: two soft lights in the
// colours of the time of day at the top, and a tint that fades down. It
// sits under the screen's content, takes no touch and loads no image - a
// screen draws it first inside its dark overlay.

let nextId = 0;

export function AmbientGlow() {
  const part = useDayPart();
  const [first, second] = GLOW[part];
  // Each glow its own gradient names: several screens stay mounted at once
  // on the web, and a name shared with a hidden one would draw nothing.
  const id = useRef(`ambient${++nextId}`).current;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={[`${first}2B`, `${first}00`]} style={styles.tint} />
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={`${id}a`} cx="12" cy="4" r="58" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={first} stopOpacity="0.42" />
            <Stop offset="1" stopColor={first} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`${id}b`} cx="96" cy="24" r="46" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={second} stopOpacity="0.26" />
            <Stop offset="1" stopColor={second} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id}a)`} />
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id}b)`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 360,
  },
});

import React, { useRef, useState } from 'react';
import { View, PanResponder, StyleSheet, ViewStyle } from 'react-native';

// A minimal drag-to-set slider built on core RN primitives only (View +
// PanResponder) instead of @react-native-community/slider - that package's
// web implementation calls react-dom's findDOMNode, which React 19 (this
// app's React version) removed entirely, crashing the whole screen on web
// with "_reactDom.default.findDOMNode is not a function". This avoids the
// dependency, and the version-compatibility risk, altogether.
interface SimpleSliderProps {
  value: number;
  minimumValue: number;
  maximumValue: number;
  step?: number;
  onValueChange: (value: number) => void;
  minimumTrackTintColor: string;
  maximumTrackTintColor: string;
  thumbTintColor: string;
  style?: ViewStyle;
}

export function SimpleSlider({
  value, minimumValue, maximumValue, step = 1, onValueChange,
  minimumTrackTintColor, maximumTrackTintColor, thumbTintColor, style,
}: SimpleSliderProps) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const updateFromX = (x: number) => {
    if (widthRef.current <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / widthRef.current));
    let next = minimumValue + ratio * (maximumValue - minimumValue);
    if (step > 0) next = Math.round(next / step) * step;
    next = Math.max(minimumValue, Math.min(maximumValue, next));
    onValueChange(next);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => updateFromX(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => updateFromX(evt.nativeEvent.locationX),
    })
  ).current;

  const pct = maximumValue > minimumValue ? (value - minimumValue) / (maximumValue - minimumValue) : 0;
  const clampedPct = Math.max(0, Math.min(1, pct));

  return (
    <View
      style={[styles.touchArea, style]}
      onLayout={(e) => { widthRef.current = e.nativeEvent.layout.width; setWidth(e.nativeEvent.layout.width); }}
      {...panResponder.panHandlers}
    >
      <View style={[styles.track, { backgroundColor: maximumTrackTintColor }]}>
        <View style={[styles.fill, { backgroundColor: minimumTrackTintColor, width: `${clampedPct * 100}%` }]} />
      </View>
      {width > 0 && (
        <View
          style={[
            styles.thumb,
            { backgroundColor: thumbTintColor, left: Math.max(0, Math.min(width - 20, clampedPct * width - 10)) },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  touchArea: { height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  thumb: { position: 'absolute', width: 20, height: 20, borderRadius: 10, top: 8 },
});

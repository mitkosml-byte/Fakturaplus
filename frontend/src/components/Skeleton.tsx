import React, { useEffect, useState } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle, DimensionValue } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../theme/colors';

type Props = {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
};

const SHIMMER_WIDTH = 140;
const SWEEP_DURATION = 1100;

// A single shimmering placeholder block. Screens compose several of these
// into the shape of their real content (a row, a card, a stat tile) so the
// loading state previews the layout that's about to appear, instead of a
// centered spinner that tells the user nothing about what's coming.
export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useSharedValue(-SHIMMER_WIDTH);

  useEffect(() => {
    if (trackWidth === 0) return;
    translateX.value = -SHIMMER_WIDTH;
    translateX.value = withRepeat(
      withTiming(trackWidth + SHIMMER_WIDTH, { duration: SWEEP_DURATION, easing: Easing.linear }),
      -1,
      false
    );
  }, [trackWidth]);

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View
      style={[styles.base, { width, height, borderRadius }, style]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      {trackWidth > 0 && (
        <Animated.View style={[StyleSheet.absoluteFill, { width: SHIMMER_WIDTH }, sweepStyle]}>
          <LinearGradient
            colors={['transparent', 'rgba(255,255,255,0.16)', 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

// Preset shape for a list row with a leading icon/avatar circle and two
// lines of text (invoice rows, audit log entries, team member rows...).
export function SkeletonRow({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      <Skeleton width={36} height={36} borderRadius={10} />
      <View style={styles.rowText}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="40%" height={12} style={{ marginTop: 8 }} />
      </View>
      <Skeleton width={56} height={18} />
    </View>
  );
}

// Preset shape for a small stat tile (label + big number), as used in the
// summary strips on Home/Stats/Budget.
export function SkeletonStat({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.stat, style]}>
      <Skeleton width="60%" height={11} />
      <Skeleton width="80%" height={20} style={{ marginTop: 8 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  rowText: {
    flex: 1,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
});

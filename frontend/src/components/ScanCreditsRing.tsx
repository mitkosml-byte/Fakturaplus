import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedReaction,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { DURATION, EASING } from '../theme/motion';
import { COLORS } from '../theme/colors';

const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Props = {
  remaining: number;
  quota: number;
  color: string;
  label: string;
  // The value this ring showed the last time it was on screen, or null on
  // a screen's first-ever paint. Sharpened #22 (Motion Design Audit): the
  // ring shows its TRUE value instantly every time this screen opens -
  // never performed, never drawing in from 0 - and animates only the
  // delta right after it actually changed because of something the user
  // did (a purchase landing, a scan being spent).
  animateFrom: number | null;
};

export function ScanCreditsRing({ remaining, quota, color, label, animateFrom }: Props) {
  const fraction = quota > 0 ? remaining / quota : 0;
  const fromFraction = quota > 0 && animateFrom !== null ? animateFrom / quota : fraction;

  const progress = useSharedValue(animateFrom !== null ? fromFraction : fraction);
  const animatedCount = useSharedValue(animateFrom !== null ? animateFrom : remaining);
  const [shownNumber, setShownNumber] = React.useState(animateFrom ?? remaining);

  useAnimatedReaction(
    () => animatedCount.value,
    (value, prevValue) => {
      if (value !== prevValue) {
        runOnJS(setShownNumber)(Math.round(value));
      }
    }
  );

  useEffect(() => {
    if (animateFrom !== null) {
      progress.value = fromFraction;
      animatedCount.value = animateFrom;
      progress.value = withTiming(fraction, { duration: DURATION.standard, easing: EASING.standard });
      animatedCount.value = withTiming(remaining, { duration: DURATION.standard, easing: EASING.standard });
    } else {
      progress.value = fraction;
      animatedCount.value = remaining;
      setShownNumber(remaining);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, quota]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRCUMFERENCE * (1 - progress.value),
  }));

  return (
    <View style={styles.wrapper}>
      <Svg width={84} height={84} viewBox="0 0 84 84">
        <Circle cx={42} cy={42} r={RADIUS} fill="none" stroke={COLORS.border} strokeWidth={8} />
        <AnimatedCircle
          cx={42}
          cy={42}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          animatedProps={animatedProps}
          rotation={-90}
          origin="42, 42"
        />
      </Svg>
      <View style={styles.textWrap}>
        <Text style={styles.number}>{shownNumber}/{quota}</Text>
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: 84, height: 84 },
  textWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: { fontSize: 17, fontWeight: '700', color: 'white' },
  label: { fontSize: 9, color: COLORS.textMuted, marginTop: 2 },
});

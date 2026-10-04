import React, { useEffect, useRef, useState } from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';
import { useSharedValue, useAnimatedReaction, withTiming, runOnJS } from 'react-native-reanimated';
import { DURATION, EASING } from '../theme/motion';

type Props = {
  value: number;
  formatter?: (n: number) => string;
  style?: StyleProp<TextStyle>;
};

// Shows its TRUE value instantly on first mount - never a performed count
// from 0, which would just add a delay every time a screen opens - and
// tweens only the delta when `value` actually changes afterward (a new
// invoice landing, a filter switching totals). Same philosophy as
// ScanCreditsRing's animateFrom handling; this is the plain-Text version
// for any number that doesn't need a ring (Home/Stats/Budget totals,
// invoice amounts).
export function CountUp({ value, formatter = (n) => n.toFixed(2), style }: Props) {
  const animated = useSharedValue(value);
  const [shown, setShown] = useState(value);
  const mounted = useRef(false);

  useAnimatedReaction(
    () => animated.value,
    (current, previous) => {
      if (current !== previous) {
        runOnJS(setShown)(current);
      }
    }
  );

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      animated.value = value;
      setShown(value);
      return;
    }
    animated.value = withTiming(value, { duration: DURATION.deliberate, easing: EASING.standard });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <Text style={style}>{formatter(shown)}</Text>;
}

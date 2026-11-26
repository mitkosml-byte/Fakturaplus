import { useEffect, useState } from 'react';
import { DEFAULT_PERIOD_STATE, PeriodState } from './periodRange';

// One chosen period for every report screen - Home, Statistics, suppliers,
// items, the tips. Picking October on one screen shows October on the next,
// instead of each screen silently answering a different period. Kept in
// memory for the session (a plain module-level value with subscribers, so
// no provider is needed around the tabs).
let current: PeriodState = DEFAULT_PERIOD_STATE;
const listeners = new Set<(next: PeriodState) => void>();

export function setSharedPeriod(next: PeriodState): void {
  current = next;
  listeners.forEach((listener) => listener(next));
}

export function getSharedPeriod(): PeriodState {
  return current;
}

export function useSharedPeriod(): [PeriodState, (next: PeriodState) => void] {
  const [state, setState] = useState<PeriodState>(current);
  useEffect(() => {
    listeners.add(setState);
    // Another screen may have changed it while this one was not mounted.
    setState(current);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return [state, setSharedPeriod];
}

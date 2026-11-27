import { useEffect, useState } from 'react';

// The sky of the moment: the time of day the app takes its colours from -
// the greeting card's gradient on Home, and the soft glow behind every
// screen (components/AmbientGlow). One place, so the two never disagree.

export type DayPart = 'morning' | 'day' | 'evening' | 'night';

export function dayPartAt(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'day';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

export function dayPartNow(): DayPart {
  return dayPartAt(new Date().getHours());
}

// The greeting card: from its top left to its bottom right.
export const SKY: Record<DayPart, [string, string]> = {
  morning: ['#3F3477', '#1E3A5F'],
  day: ['#1F4F82', '#14304F'],
  evening: ['#4A2A5E', '#1B1F3B'],
  night: ['#1E1B4B', '#0F172A'],
};

// Behind the screens: two lights, the first top left and the second on the
// right - violet and sunrise amber in the morning, blue and sea green by
// day, purple and sunset pink in the evening, indigo and deep blue at night.
export const GLOW: Record<DayPart, [string, string]> = {
  morning: ['#8B5CF6', '#F59E0B'],
  day: ['#3B82F6', '#14B8A6'],
  evening: ['#A855F7', '#EC4899'],
  night: ['#6366F1', '#1D4ED8'],
};

// One clock for every screen that follows the sky: it looks every five
// minutes and tells the screens only when the part of the day changes.
const listeners = new Set<(part: DayPart) => void>();
let current: DayPart = dayPartNow();
let timer: ReturnType<typeof setInterval> | null = null;

function watch(listener: (part: DayPart) => void): () => void {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      const next = dayPartNow();
      if (next !== current) {
        current = next;
        listeners.forEach((notify) => notify(next));
      }
    }, 5 * 60 * 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useDayPart(): DayPart {
  const [part, setPart] = useState<DayPart>(() => {
    current = dayPartNow();
    return current;
  });
  useEffect(() => watch(setPart), []);
  return part;
}

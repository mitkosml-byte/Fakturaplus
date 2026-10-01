import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  differenceInCalendarDays,
  addDays,
  type Locale,
} from 'date-fns';

// Shared period-navigation model for any screen that shows totals for "a
// period" (Home's dashboard cards, Stats' overview cards) - lets a user step
// back to any past day/week/month/year, or an arbitrary custom range,
// instead of being stuck on whatever the backend defaults to (current
// month). offset counts how many whole periods back from "now" we are;
// offset 0 is always the current, still-in-progress period. Weeks run
// Monday-Sunday to match the calendar/closed-days convention used elsewhere
// in the app (see closed-days.tsx).
export type PeriodMode = 'day' | 'week' | 'month' | 'year' | 'range';

export interface PeriodState {
  mode: PeriodMode;
  offset: number;
  rangeStart?: Date;
  rangeEnd?: Date;
}

export interface PeriodBounds {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
}

export const DEFAULT_PERIOD_STATE: PeriodState = { mode: 'month', offset: 0 };

export function getPeriodBounds(state: PeriodState, now: Date = new Date()): PeriodBounds {
  if (state.mode === 'range' && state.rangeStart && state.rangeEnd) {
    const start = state.rangeStart;
    const end = state.rangeEnd;
    const lengthDays = differenceInCalendarDays(end, start) + 1;
    const prevEnd = subDays(start, 1);
    const prevStart = subDays(prevEnd, lengthDays - 1);
    return { start, end, prevStart, prevEnd };
  }

  switch (state.mode) {
    case 'day': {
      const start = subDays(now, state.offset);
      return { start, end: start, prevStart: subDays(start, 1), prevEnd: subDays(start, 1) };
    }
    case 'week': {
      const anchor = subWeeks(now, state.offset);
      const start = startOfWeek(anchor, { weekStartsOn: 1 });
      const end = endOfWeek(anchor, { weekStartsOn: 1 });
      return { start, end, prevStart: subWeeks(start, 1), prevEnd: subWeeks(end, 1) };
    }
    case 'year': {
      const anchor = subYears(now, state.offset);
      const start = startOfYear(anchor);
      const end = endOfYear(anchor);
      return { start, end, prevStart: subYears(start, 1), prevEnd: subYears(end, 1) };
    }
    case 'month':
    default: {
      const anchor = subMonths(now, state.offset);
      const start = startOfMonth(anchor);
      const end = endOfMonth(anchor);
      return { start, end, prevStart: subMonths(start, 1), prevEnd: subMonths(end, 1) };
    }
  }
}

export function formatPeriodLabel(state: PeriodState, bounds: PeriodBounds, locale: Locale): string {
  switch (state.mode) {
    case 'day':
      return format(bounds.start, 'd MMMM yyyy', { locale });
    case 'week':
      return `${format(bounds.start, 'd MMM', { locale })} - ${format(bounds.end, 'd MMM yyyy', { locale })}`;
    case 'year':
      return format(bounds.start, 'yyyy', { locale });
    case 'range':
      return `${format(bounds.start, 'd.MM.yyyy')} - ${format(bounds.end, 'd.MM.yyyy')}`;
    case 'month':
    default:
      return format(bounds.start, 'LLLL yyyy', { locale });
  }
}

// yyyy-MM-dd, the wire format every date-range backend endpoint expects.
export function toApiDate(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export { addDays };

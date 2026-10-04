/**
 * Shared motion tokens for Фактура+ - see the "FACTURA+ Motion Design
 * System" doc for the full spec and rationale. These are the only
 * duration/easing values any animated component should use; a new value
 * is a change to that doc, not a one-off choice in a screen.
 */
import { Easing } from 'react-native-reanimated';

export const DURATION = {
  instant: 0,
  micro: 100,
  fast: 160,
  standard: 220,
  deliberate: 320,
  narrative: 480,
} as const;

// Cubic-bezier values for use where a library wants raw numbers (e.g.
// react-native-reanimated's withTiming easing, or CSS on web) rather than
// the Easing helpers below.
export const BEZIER = {
  easeOut: [0.16, 1, 0.3, 1] as const,
  easeIn: [0.7, 0, 0.84, 0] as const,
  standard: [0.4, 0, 0.2, 1] as const,
};

export const EASING = {
  easeOut: Easing.bezier(...BEZIER.easeOut),
  easeIn: Easing.bezier(...BEZIER.easeIn),
  standard: Easing.bezier(...BEZIER.standard),
};

// Critically damped - the one place a spring is allowed (bottom sheet
// drag-release settle). Tuned for zero overshoot.
export const SHEET_SPRING = {
  damping: 28,
  stiffness: 280,
  mass: 1,
  overshootClamping: true,
};

// Stagger offset for field-by-field reveals (OCR result, list import).
export const STAGGER_MS = 20;
export const STAGGER_MS_MAX_ITEMS = 5;

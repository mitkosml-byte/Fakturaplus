import { Platform } from 'react-native';
import * as ExpoHaptics from 'expo-haptics';

// expo-haptics has no web implementation and the haptics hardware doesn't
// exist there anyway - every call below is a silent no-op on web, matching
// the Motion Design System's haptic feedback map (native platforms only).
const isNative = Platform.OS !== 'web';

function safe(fn: () => Promise<void>) {
  if (!isNative) return;
  fn().catch(() => {
    // Haptics failing is never worth surfacing to the user or retrying.
  });
}

export const Haptics = {
  // Primary action success: invoice saved, payment confirmed, scan completed.
  success() {
    safe(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light));
  },
  // Destructive confirmation: delete invoice, remove user.
  destructive() {
    safe(() => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Medium));
  },
  // Pull-to-refresh crossing its trigger point, chip/segment selection.
  selection() {
    safe(() => ExpoHaptics.selectionAsync());
  },
  // Permission/role change taking effect.
  notify() {
    safe(() => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success));
  },
  // Validation/request failure is deliberately NOT mapped here - the
  // Motion Design System calls for visual-only feedback on failure, since
  // a haptic on failure reads as punitive.
};

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// One-time onboarding tutorial, shown automatically the first time a given
// user logs in, and reopenable anytime after via the floating "?" button
// (see OnboardingTutorial.tsx). Keyed per-user (not a single global flag) so
// a shared device correctly re-shows it to a genuinely new account, and so
// switching accounts on the same device doesn't skip it for the second user.
const seenKey = (userId: string) => `onboarding_seen_${userId}`;

interface OnboardingState {
  isVisible: boolean;
  checkedUserId: string | null;
  open: () => void;
  close: () => void;
  checkAndMaybeOpen: (userId: string) => Promise<void>;
  markSeen: (userId: string) => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  isVisible: false,
  checkedUserId: null,

  open: () => set({ isVisible: true }),
  close: () => set({ isVisible: false }),

  // Runs once per user per app session - checks the persisted flag and
  // auto-opens the tutorial only if this user has never dismissed it.
  checkAndMaybeOpen: async (userId: string) => {
    if (!userId || get().checkedUserId === userId) return;
    set({ checkedUserId: userId });
    try {
      const seen = await AsyncStorage.getItem(seenKey(userId));
      if (!seen) {
        set({ isVisible: true });
      }
    } catch (error) {
      // Storage unavailable - fail silently, don't block app usage over it.
    }
  },

  markSeen: async (userId: string) => {
    set({ isVisible: false });
    try {
      await AsyncStorage.setItem(seenKey(userId), '1');
    } catch (error) {
      // Non-critical - worst case the tutorial reappears next login.
    }
  },
}));

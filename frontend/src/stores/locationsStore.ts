import { useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { api } from '../services/api';
import type { BusinessLocation } from '../types';

// The business's locations (Н11): shops, sites, branches. Loaded once per
// company - the forms pick from them; a business without locations never
// sees a picker. The location picked last on this device comes first next
// time: someone at one shop picks it once.

const LAST_KEY = 'fakturaplus.lastLocation.v1';

interface LocationsState {
  companyId: string | null;
  locations: BusinessLocation[];
  lastUsed: string | null;
  load: (companyId: string | null) => Promise<void>;
  reload: () => Promise<void>;
  remember: (locationId: string | null) => void;
}

export const useLocationsStore = create<LocationsState>((set, get) => ({
  companyId: null,
  locations: [],
  lastUsed: null,

  load: async (companyId) => {
    if (companyId !== get().companyId) set({ companyId, locations: [], lastUsed: null });
    if (!companyId) return;
    try {
      const [locations, stored] = await Promise.all([
        api.getLocations(),
        AsyncStorage.getItem(`${LAST_KEY}:${companyId}`).catch(() => null),
      ]);
      if (get().companyId !== companyId) return;  // moved to another company meanwhile
      set({ locations, lastUsed: stored && locations.some((l) => l.id === stored && l.is_active) ? stored : null });
    } catch {
      // Offline or a hiccup: keep what is shown.
    }
  },

  reload: async () => {
    await get().load(get().companyId);
  },

  remember: (locationId) => {
    set({ lastUsed: locationId });
    const companyId = get().companyId;
    if (companyId) AsyncStorage.setItem(`${LAST_KEY}:${companyId}`, locationId ?? '').catch(() => undefined);
  },
}));

// The open locations a form picks from (a closed one stays on what was
// already entered for it), and the one a new record starts with.
export function useLocationChoice() {
  const locations = useLocationsStore((state) => state.locations);
  const lastUsed = useLocationsStore((state) => state.lastUsed);
  return useMemo(() => {
    const active = locations.filter((l) => l.is_active);
    const fallback = active.find((l) => l.id === lastUsed)?.id ?? active[0]?.id ?? null;
    return { all: locations, active, fallback };
  }, [locations, lastUsed]);
}

export function locationName(locations: BusinessLocation[], id: string | null | undefined): string | null {
  if (!id) return null;
  return locations.find((l) => l.id === id)?.name ?? null;
}

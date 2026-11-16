import { create } from 'zustand';
import { api } from '../services/api';
import type { BusinessModule, BusinessModules } from '../types';

// The parts of the program this business uses ("Какво ползвам"), set by
// the owner. A part left out leaves the menus, Home's cards and the
// signals; what was entered in it stays and comes back with it. Until the
// business's choice arrives every part shows - as for every business that
// never chose.
export const ALL_MODULES: BusinessModules = {
  till: true, billing: true, team: true, payroll: true, assets: true, wallet: true,
};

export const MODULE_ORDER: BusinessModule[] = ['till', 'billing', 'team', 'payroll', 'assets', 'wallet'];

interface ModulesState {
  modules: BusinessModules;
  canEdit: boolean;
  companyId: string | null;
  load: (companyId: string | null) => Promise<void>;
  save: (changes: Partial<BusinessModules>) => Promise<void>;
}

export const useModulesStore = create<ModulesState>((set) => ({
  modules: ALL_MODULES,
  canEdit: false,
  companyId: null,

  load: async (companyId) => {
    if (!companyId) {
      set({ modules: ALL_MODULES, canEdit: false, companyId: null });
      return;
    }
    try {
      const result = await api.getModules();
      set({ modules: { ...ALL_MODULES, ...result.modules }, canEdit: result.can_edit, companyId });
    } catch {
      // Offline or a hiccup: keep what is shown rather than hide anything.
    }
  },

  save: async (changes) => {
    const result = await api.updateModules(changes);
    set({ modules: { ...ALL_MODULES, ...result.modules }, canEdit: result.can_edit });
  },
}));

// Whether the business uses a part of the program.
export function useModules() {
  const modules = useModulesStore((state) => state.modules);
  return { modules, uses: (module: BusinessModule) => modules[module] !== false };
}

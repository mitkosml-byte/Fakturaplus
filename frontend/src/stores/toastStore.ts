import { create } from 'zustand';

export type ToastVariant = 'success' | 'info' | 'undo';

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
}

interface ToastState {
  current: ToastItem | null;
  queue: ToastItem[];
  show: (item: Omit<ToastItem, 'id'>) => void;
  dismissCurrent: () => void;
}

let counter = 0;

// One toast on screen at a time - later ones queue rather than stack, so
// the user never has to read two overlapping messages at once (Motion
// Design System principle #4: one motion per event).
export const useToastStore = create<ToastState>((set, get) => ({
  current: null,
  queue: [],

  show: (item) => {
    const toast: ToastItem = { ...item, id: `t${++counter}` };
    const { current, queue } = get();
    if (current) {
      set({ queue: [...queue, toast] });
    } else {
      set({ current: toast });
    }
  },

  dismissCurrent: () => {
    const { queue } = get();
    const [next, ...rest] = queue;
    set({ current: next ?? null, queue: rest });
  },
}));

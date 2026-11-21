import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { api } from '../services/api';
import type { OCRResult } from '../types';

// Scanning without a connection (Н12): the photo is taken at once and kept
// on the phone; when the connection comes back it is read on its own - the
// person reviews it and saves it as any scan. Nothing is saved as an invoice
// before they do. On a phone the pages are files in the app's own folder;
// in a browser (rarely offline) they are kept with the list itself.

export type QueuedScanStatus = 'waiting' | 'reading' | 'ready' | 'failed';

export interface QueuedScan {
  id: string;
  // Read under the company it was taken for - never another one's.
  companyId: string | null;
  createdAt: string;
  mode: 'purchase' | 'sales';
  pages: string[];
  status: QueuedScanStatus;
  result?: OCRResult;
  error?: string;
  // Out of scans when it was read: tried again only when asked.
  noCredits?: boolean;
}

const STORAGE_KEY = 'fakturaplus.scanQueue.v1';
const FOLDER = 'scan-queue/';

function fileSystem(): any | null {
  if (Platform.OS === 'web') return null;
  // The top-level "expo-file-system" export is SDK 54's new File/Directory
  // API; documentDirectory and the string helpers live under legacy -
  // loaded only on a phone, never in the web build.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-file-system/legacy');
}

async function savePages(id: string, pages: string[]): Promise<string[]> {
  const fs = fileSystem();
  if (!fs) return pages;
  const folder = `${fs.documentDirectory}${FOLDER}`;
  await fs.makeDirectoryAsync(folder, { intermediates: true }).catch(() => undefined);
  const saved: string[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const path = `${folder}${id}-${index}.jpg`;
    await fs.writeAsStringAsync(path, pages[index].replace(/^data:image\/\w+;base64,/, ''), { encoding: 'base64' });
    saved.push(path);
  }
  return saved;
}

async function readPages(pages: string[]): Promise<string[]> {
  const fs = fileSystem();
  if (!fs) return pages;
  return Promise.all(pages.map(async (path) => `data:image/jpeg;base64,${await fs.readAsStringAsync(path, { encoding: 'base64' })}`));
}

async function deletePages(pages: string[]): Promise<void> {
  const fs = fileSystem();
  if (!fs) return;
  await Promise.all(pages.map((path) => fs.deleteAsync(path, { idempotent: true }).catch(() => undefined)));
}

// The request never reached the server (api.fetch marks it) - kept, not failed.
export function isNetworkError(error: any): boolean {
  return error?.network === true
    || (!error?.status && /network|fetch|internet|timed? ?out|aborted/i.test(String(error?.message || error)));
}

interface ScanQueueState {
  items: QueuedScan[];
  loaded: boolean;
  processing: boolean;
  load: () => Promise<void>;
  enqueue: (pages: string[], mode: QueuedScan['mode'], companyId: string | null) => Promise<void>;
  // Reads what waits for this company; returns how many became ready.
  processPending: (companyId: string | null) => Promise<number>;
  retry: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  // A ready scan taken out to review: its pages (ready to show and send
  // again with the invoice) and what was read.
  take: (id: string) => Promise<{ pages: string[]; result: OCRResult; mode: QueuedScan['mode'] } | null>;
}

export const useScanQueueStore = create<ScanQueueState>((set, get) => {
  const persist = async (items: QueuedScan[]) => {
    set({ items });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full (a browser): the list still lives until the app closes.
    }
  };
  const update = (id: string, change: Partial<QueuedScan>) =>
    persist(get().items.map((item) => (item.id === id ? { ...item, ...change } : item)));

  return {
    items: [],
    loaded: false,
    processing: false,

    load: async () => {
      if (get().loaded) return;
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        const items: QueuedScan[] = stored ? JSON.parse(stored) : [];
        // One cut off mid-read (the app closed) waits again.
        set({ items: items.map((item) => (item.status === 'reading' ? { ...item, status: 'waiting' } : item)), loaded: true });
      } catch {
        set({ loaded: true });
      }
    },

    enqueue: async (pages, mode, companyId) => {
      await get().load();
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const saved = await savePages(id, pages);
      await persist([...get().items, { id, companyId, createdAt: new Date().toISOString(), mode, pages: saved, status: 'waiting' }]);
    },

    processPending: async (companyId) => {
      await get().load();
      if (get().processing) return 0;
      set({ processing: true });
      let ready = 0;
      try {
        for (const item of get().items) {
          if (item.status !== 'waiting' || item.companyId !== companyId) continue;
          await update(item.id, { status: 'reading', error: undefined });
          try {
            const result = await api.scanInvoice(await readPages(item.pages));
            await update(item.id, { status: 'ready', result });
            ready += 1;
          } catch (error: any) {
            if (isNetworkError(error)) {
              // Still no connection: it waits, and so does everything after it.
              await update(item.id, { status: 'waiting' });
              break;
            }
            await update(item.id, { status: 'failed', error: error?.message || String(error), noCredits: error?.status === 402 });
          }
        }
      } finally {
        set({ processing: false });
      }
      return ready;
    },

    retry: async (id) => {
      await update(id, { status: 'waiting', error: undefined, noCredits: false });
    },

    remove: async (id) => {
      const item = get().items.find((entry) => entry.id === id);
      if (item) await deletePages(item.pages);
      await persist(get().items.filter((entry) => entry.id !== id));
    },

    take: async (id) => {
      const item = get().items.find((entry) => entry.id === id);
      if (!item || item.status !== 'ready' || !item.result) return null;
      const pages = await readPages(item.pages);
      await get().remove(id);
      return { pages, result: item.result, mode: item.mode };
    },
  };
});

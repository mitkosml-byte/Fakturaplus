import { Platform } from 'react-native';
import { api } from '../services/api';
import type { ClientErrorReport } from '../types';

// Errors the app meets on a phone or in a browser go to the program's own
// error log (POST /client-errors), next to the server's - the owner sees
// them on the "Състояние" screen. Each one is sent once per session, at
// most MAX_PER_SESSION in all, and only the unexpected: an answer from the
// server with an error status, or no connection, is already handled where
// it happened.

const MAX_PER_SESSION = 10;

let currentScreen = '';
let sentCount = 0;
const sent = new Set<string>();

// The screen as its route ("/supplier/[name]"), not its values - kept by
// the root layout as the person moves.
export function setCurrentScreen(segments: readonly string[]): void {
  currentScreen = `/${segments.join('/')}`;
}

// Noise every browser makes, and failures that are no fault of the app.
const IGNORED = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Failed to fetch/i,
  /Network request failed/i,
  /Load failed/i,
  /NetworkError/i,
  /AbortError/i,
];

function platform(): ClientErrorReport['platform'] {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

export function reportError(error: unknown, kind: ClientErrorReport['kind'] = 'error'): void {
  try {
    const err = error instanceof Error ? (error as Error & { status?: number; network?: boolean }) : null;
    if (err && (typeof err.status === 'number' || err.network)) return;
    const message = (err ? `${err.name}: ${err.message}` : String(error ?? '')).trim().slice(0, 1000);
    if (!message || IGNORED.some((pattern) => pattern.test(message))) return;
    const key = `${kind}|${currentScreen}|${message}`;
    if (sent.has(key) || sentCount >= MAX_PER_SESSION) return;
    sent.add(key);
    sentCount += 1;
    void api.reportClientError({
      message,
      stack: err?.stack ? err.stack.slice(0, 8000) : undefined,
      screen: currentScreen || undefined,
      kind,
      platform: platform(),
    });
  } catch {
    // Reporting an error never makes another one.
  }
}

let installed = false;

export function installErrorReporter(): void {
  if (installed) return;
  installed = true;
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (event) => reportError(event.error ?? event.message, 'error'));
    window.addEventListener('unhandledrejection', (event) => reportError(event.reason, 'promise'));
    return;
  }
  const errorUtils = (globalThis as { ErrorUtils?: {
    getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
    setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
  } }).ErrorUtils;
  const previous = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    reportError(error, 'error');
    previous?.(error, isFatal);
  });
}

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const KEY = 'session_token';

// On the web, when the app and its server share one origin (the app has no
// server address of its own, or the very same one), the session is only
// the server's httponly cookie: no script on the page can read it, so
// nothing injected into the page could carry the session away. Across two
// sites - the app on one onrender.com address and the server on another -
// browsers such as Safari block that cookie, so the token is kept as before.
const MODE_KEY = 'session_mode';

// Where the cookie did not reach the server after a login (something in
// between dropped it), the token is used as before - remembered here.
export function keepTokenSession(): void {
  try {
    window.localStorage.setItem(MODE_KEY, 'token');
  } catch {
    // no storage: the token is still used for this visit
  }
  tokenSessionThisVisit = true;
}

let tokenSessionThisVisit = false;

function tokenSessionChosen(): boolean {
  if (tokenSessionThisVisit) return true;
  try {
    return window.localStorage.getItem(MODE_KEY) === 'token';
  } catch {
    return false;
  }
}

export function cookieOnlySession(): boolean {
  if (Platform.OS !== 'web') return false;
  if (tokenSessionChosen()) return false;
  const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
  if (!base) return true;
  try {
    return typeof window !== 'undefined' && new URL(base).origin === window.location.origin;
  } catch {
    return false;
  }
}

// Persists the session token so a reload/app restart can restore the
// session. On native this uses the OS keychain (expo-secure-store) rather
// than AsyncStorage's plain, unencrypted storage; on web there's no OS
// keychain to use, so AsyncStorage (backed by localStorage) is the only
// option anyway.
export async function getStoredToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (cookieOnlySession()) {
      // A token an earlier version kept here is let go of.
      await AsyncStorage.removeItem(KEY).catch(() => undefined);
      return null;
    }
    return AsyncStorage.getItem(KEY);
  }
  return SecureStore.getItemAsync(KEY);
}

export async function setStoredToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (!cookieOnlySession()) await AsyncStorage.setItem(KEY, token);
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function removeStoredToken(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

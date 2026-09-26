import { Platform } from 'react-native';
import { api } from '../services/api';

// Public VAPID key - not secret, safe to ship in client code (it's only
// usable to SUBSCRIBE a browser to push from this app's own backend, never
// to send push or to read anything).
const VAPID_PUBLIC_KEY = 'BG5n5W382MNqBPUBfGWEOg-u8tYLKabgYMgRg_SOvdH0SdC18IIgcoRjlxUQejEViK1cZ9dvYmvZtfwOMcVhr7M';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  );
}

export type PushStatus = 'unsupported' | 'default' | 'granted' | 'denied';

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported() || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'granted' : 'default';
  }
  return Notification.permission as PushStatus;
}

// Requests permission (if needed), registers the service worker, subscribes
// to push, and tells the backend about the new subscription. Safe to call
// again if already subscribed (subscribe() returns the existing one).
export async function enablePushNotifications(): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { ok: false, error: 'unsupported' };
  }
  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, error: 'denied' };
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: 'invalid_subscription' };
    }
    await api.subscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'unknown' };
  }
}

export async function disablePushNotifications(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.unsubscribePush(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
}

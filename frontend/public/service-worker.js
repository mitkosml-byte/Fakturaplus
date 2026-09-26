// Web Push service worker for Фактура+. Lives at the site root (Expo's
// static web export copies frontend/public/* verbatim into dist/) so its
// default scope covers the whole app - required for push events to reach
// it regardless of which screen the tab was last on, or if no tab is open
// at all.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'Фактура+', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Фактура+';
  const options = {
    body: payload.body || '',
    icon: '/notification-icon.png',
    badge: '/notification-icon.png',
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetPath = data.type === 'calendar' ? '/calendar' : '/messages';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) {
            client.navigate(targetPath).catch(() => {});
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetPath);
      }
    })
  );
});

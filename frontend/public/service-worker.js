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

// Where a notification leads. A push that names its screen (the morning
// review names the signal's own screen) goes there; route groups such as
// "(tabs)" are not part of a web address. Before, everything but a calendar
// reminder opened Messages - a budget or invoice warning included.
function targetPathFor(data) {
  if (typeof data.route === 'string' && data.route.startsWith('/')) {
    const path = data.route.replace(/\/\([^/)]*\)/g, '');
    return path === '' || path.startsWith('?') ? '/' + path : path;
  }
  switch (data.type) {
    case 'calendar':
      return '/calendar';
    case 'message':
      return data.conversation_id
        ? '/message-thread?conversationId=' + encodeURIComponent(data.conversation_id)
        : '/messages';
    case 'budget':
      return '/budget';
    case 'scan_credit_depletion':
      return '/scan-credits';
    case 'price_alert':
      return '/stats?tab=items';
    default:
      return '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetPath = targetPathFor(data);

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

// Service Worker Push & Notification Handlers for SECRETARIA DA IGREJA
self.addEventListener('push', function (event) {
  let payload = {
    title: 'Secretaria da Igreja',
    body: 'Nova atualização registrada na secretaria da sua igreja.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'sec-igreja-push',
    data: { url: '/' },
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        ...payload,
        ...parsed,
        data: parsed.data || { url: '/' },
      };
    } catch {
      const text = event.data.text();
      if (text) {
        payload.body = text;
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      renotify: true,
      data: payload.data,
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});

self.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== 'SHOW_NOTIFICATION') return;
  const payload = event.data.payload || {};
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Secretaria da Igreja', {
      body: payload.body || '',
      icon: payload.icon || '/pwa-192x192.png',
      badge: payload.badge || '/pwa-192x192.png',
      tag: payload.tag || 'sec-igreja-event',
      renotify: true,
      data: payload.data || { url: '/' },
    })
  );
});

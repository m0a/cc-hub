// Custom notification click handler for CC Hub PWA
// This file is imported by the main service worker via importScripts
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('navigate' in client) {
          const url = sessionId ? `/?notify-session=${sessionId}` : '/';
          return client.navigate(url).then((c) => c?.focus());
        }
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        const url = sessionId ? `/?notify-session=${sessionId}` : '/';
        return self.clients.openWindow(url);
      }
    })
  );
});

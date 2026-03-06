// Custom notification click handler for CC Hub PWA
// Version: 0.0.61-1
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Send log to all clients so it appears in frontend.log
      for (const c of clientList) {
        c.postMessage({ type: 'sw-log', message: `[SW v0.0.61-1] notificationclick sessionId=${sessionId} clients=${clientList.length}` });
      }
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

// Log when this script is loaded
self.addEventListener('activate', () => {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const c of clients) {
      c.postMessage({ type: 'sw-log', message: '[SW v0.0.61-1] activated' });
    }
  });
});

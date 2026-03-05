// Custom notification click handler for CC Hub PWA
// This file is imported by the main service worker via importScripts
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window and navigate to the session
      for (const client of clientList) {
        if ('focus' in client) {
          if (sessionId) {
            client.postMessage({ type: 'navigate-session', sessionId });
          }
          return client.focus();
        }
      }
      // Open a new window with session parameter if none exists
      if (self.clients.openWindow) {
        const url = sessionId ? `/?session=${sessionId}` : '/';
        return self.clients.openWindow(url);
      }
    })
  );
});

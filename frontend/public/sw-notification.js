// Custom notification click handler for CC Hub PWA
// This file is imported by the main service worker via importScripts
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;
  console.log('[SW] notificationclick, sessionId:', sessionId);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      console.log('[SW] clients found:', clientList.length);
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus().then((focusedClient) => {
            if (sessionId && focusedClient) {
              console.log('[SW] posting navigate-session to focused client');
              focusedClient.postMessage({ type: 'navigate-session', sessionId });
            }
            return focusedClient;
          });
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

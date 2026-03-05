// Custom notification click handler for CC Hub PWA
// This file is imported by the main service worker via importScripts
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Focus existing CC Hub window or open a new one
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open a new window if none exists
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});

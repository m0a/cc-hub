// Custom notification click handler for CC Hub PWA
// Version: 0.2.4-1
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;
  const peerId = event.notification.data?.peerId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Send log to all clients so it appears in frontend.log
      for (const c of clientList) {
        c.postMessage({ type: 'sw-log', message: `[SW v0.2.4-1] notificationclick sessionId=${sessionId} peerId=${peerId} clients=${clientList.length}` });
      }
      const client = clientList.find((candidate) => 'focus' in candidate);
      if (client) {
        if (sessionId) {
          client.postMessage({ type: 'notification-click', sessionId, peerId });
        }
        return client.focus();
      }
      if (self.clients.openWindow) {
        const params = new URLSearchParams();
        if (sessionId) params.set('notify-session', sessionId);
        if (peerId) params.set('notify-peer', peerId);
        const url = params.size > 0 ? `/?${params.toString()}` : '/';
        return self.clients.openWindow(url);
      }
    })
  );
});

// Log when this script is loaded
self.addEventListener('activate', () => {
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const c of clients) {
      c.postMessage({ type: 'sw-log', message: '[SW v0.2.4-1] activated' });
    }
  });
});

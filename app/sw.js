// ===============================
//  Task Force Orion SOG — Service Worker
// ===============================

const CACHE_NAME = 'Task Force Orion-v1';
const STATIC_ASSETS = [
  '/app.html',
  '/login.html',
  '../styles.css',
  '../icons/icon-192.png',
  '../icons/icon-512.png',
  '../icons/maskable-icon-512.png'
];

// -------------------------------
// Install — cache static assets
// -------------------------------
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// -------------------------------
// Activate — clean old caches
// -------------------------------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// -------------------------------
// Fetch — cache-first strategy
// -------------------------------
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then(cached => {
      return (
        cached ||
        fetch(req).catch(() =>
          // fallback for offline navigation
          req.mode === 'navigate' ? caches.match('/app.html') : null
        )
      );
    })
  );
});

// -------------------------------
// Push Notifications
// -------------------------------
self.addEventListener('push', event => {
  let data = {};

  try {
    data = event.data.json();
  } catch {
    data = { title: 'Notification', body: event.data?.text() || '' };
  }

  const title = data.title || 'Update';
  const options = {
    body: data.body || '',
    icon: '../icons/icon-192.png',
    badge: '../icons/icon-192.png',
    data: {
      url: data.url || '/app.html'
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// -------------------------------
// Notification Click
// -------------------------------
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/app.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsList => {
      for (const client of clientsList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// Pipnosis AI Trading - Service Worker
// Network-first strategy — never serve stale app code

const CACHE_VERSION = '1779745293859';
const CACHE_NAME = `pipnosis-cache-v${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error('[SW] Installation failed:', error);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('pipnosis-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
      .then(() => {
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((client) => {
            client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION });
          });
        });
      })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== location.origin ||
      url.pathname.includes('/functions/') ||
      url.pathname.includes('supabase.co')) {
    return;
  }

  // Navigation — always network, offline fallback only
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match('/index.html') || new Response('Offline', { status: 503 });
      })
    );
    return;
  }

  // Hashed assets — cache first (immutable, hash changes on content change)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return response;
        });
      })
    );
    return;
  }

  // Precached static assets — cache first for speed
  if (PRECACHE_ASSETS.some(asset => url.pathname === asset)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  // Everything else — network only, no caching
  event.respondWith(
    fetch(request).catch(() => {
      return caches.match(request).then((cached) => {
        return cached || new Response('Offline', { status: 503 });
      });
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Pipnosis',
    body: 'You have a new trading alert.',
    icon: '/icon-192.png',
    badge: '/notification-badge.png',
    tag: 'pipnosis-alert',
    data: {}
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: parsed.title || payload.title,
        body: parsed.body || payload.body,
        icon: parsed.icon || payload.icon,
        badge: parsed.badge || payload.badge,
        tag: parsed.tag || payload.tag,
        data: parsed.data || {}
      };
    } catch (e) {
      const text = event.data.text();
      if (text) payload.body = text;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      data: payload.data,
      vibrate: [200, 100, 200],
      requireInteraction: false
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url && 'focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

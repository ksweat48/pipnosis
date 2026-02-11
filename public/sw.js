// Pipnosis AI Trading - Service Worker
// Version-based caching for PWA functionality

const CACHE_VERSION = '1770781819668'; // Matches version.json
const CACHE_NAME = `pipnosis-cache-v${CACHE_VERSION}`;
const RUNTIME_CACHE = `pipnosis-runtime-v${CACHE_VERSION}`;

// Essential files to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/version.json'
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching essential assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[SW] Service worker installed successfully');
        return self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('[SW] Installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              // Remove old caches that don't match current version
              return cacheName.startsWith('pipnosis-') &&
                     cacheName !== CACHE_NAME &&
                     cacheName !== RUNTIME_CACHE;
            })
            .map((cacheName) => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        return self.clients.claim(); // Take control immediately
      })
  );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip cross-origin requests and API calls
  if (url.origin !== location.origin ||
      url.pathname.includes('/functions/') ||
      url.pathname.includes('supabase.co')) {
    return;
  }

  // Network-first strategy with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Clone the response before caching
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(RUNTIME_CACHE)
            .then((cache) => {
              cache.put(request, responseClone);
            })
            .catch(() => {
              // Silent fail on cache write errors
            });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              console.log('[SW] Serving from cache:', request.url);
              return cachedResponse;
            }

            // If it's a navigation request, serve index.html from cache
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }

            // No cache available
            return new Response('Offline - resource not cached', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// Message event - handle SKIP_WAITING from update manager
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING message');
    self.skipWaiting();
  }
});

// Notify clients when update is available
self.addEventListener('updatefound', () => {
  console.log('[SW] Update found');
});

console.log(`[SW] Service Worker v${CACHE_VERSION} loaded`);

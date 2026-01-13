// Pipnosis PWA Service Worker
// Enables installation and "Add to Home Screen" functionality

const BUILD_VERSION = '1.0.0-mkd38pt1';
const CACHE_NAME = `pipnosis-v${BUILD_VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/notification-badge.png',
  '/Pipnosis icon.png'
];

// Install event - cache static assets and skip waiting
self.addEventListener('install', (event) => {
  console.log(`[Service Worker] Installing version ${BUILD_VERSION}`);

  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(STATIC_ASSETS);
        console.log(`[Service Worker] Static assets cached`);

        // Skip waiting to activate immediately
        await self.skipWaiting();
        console.log(`[Service Worker] Skipped waiting - activating now`);
      } catch (error) {
        console.error('[Service Worker] Installation error:', error);
      }
    })()
  );
});

// Message handler for skip waiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] Received SKIP_WAITING message');
    self.skipWaiting();
  }
});

// Activate event - clean up old caches and take control immediately
self.addEventListener('activate', (event) => {
  console.log(`[Service Worker] Activating version ${BUILD_VERSION}`);
  event.waitUntil(
    (async () => {
      try {
        // Delete all old caches
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log(`[Service Worker] Deleting old cache: ${name}`);
              return caches.delete(name);
            })
        );

        // Take control of all clients immediately
        await self.clients.claim();
        console.log(`[Service Worker] Claimed all clients`);

        // Notify all clients of the new version
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((client) => {
          client.postMessage({
            type: 'VERSION_ACTIVATED',
            version: BUILD_VERSION
          });
        });

        console.log(`[Service Worker] ✅ Activation complete: ${BUILD_VERSION}`);
      } catch (error) {
        console.error('[Service Worker] Activation error:', error);
      }
    })()
  );
});

// Fetch event - intelligent caching strategy
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome extensions and other protocols
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // CRITICAL: Never cache index.html or version.json - always fetch from network
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/version.json') {
    event.respondWith(
      fetch(event.request, {
        cache: 'no-cache',
        headers: new Headers({
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        })
      }).catch(() => {
        // Only on network failure, use cache as fallback
        return caches.match(event.request);
      })
    );
    return;
  }

  // For static assets, use stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Cache successful responses
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch((error) => {
          console.warn('[SW] Fetch failed:', url.pathname, error);
          return cachedResponse; // Fallback to cache
        });

      // Return cached version immediately if available, update in background
      return cachedResponse || fetchPromise;
    })
  );
});

// =============================================================================
// PUSH NOTIFICATION HANDLERS
// =============================================================================

// Vibration patterns for different notification types
const VIBRATION_PATTERNS = {
  'trade-signal': [200, 100, 200],
  'trade-entry': [100, 50, 100, 50, 100],
  'trade-closed-profit': [100, 50, 150, 50, 200],
  'trade-closed-loss': [200, 50, 150, 50, 100],
  'mid-trade-urgent': [500],
  'goal-achieved': [100, 50, 100, 50, 100, 50, 100, 50, 100]
};

// Get vibration pattern based on notification type and data
function getVibrationPattern(type, data) {
  if (type === 'trade-closed') {
    return data.profit > 0 ? VIBRATION_PATTERNS['trade-closed-profit'] : VIBRATION_PATTERNS['trade-closed-loss'];
  }
  return VIBRATION_PATTERNS[type] || [200];
}

// Get notification icon based on type
// Use full URL for Android to properly display colored icon
// Using 192x192 size for optimal notification display
function getNotificationIcon(type) {
  const origin = self.location.origin;
  return `${origin}/icon-192.png`;
}

// Get notification badge (monochrome icon for Android status bar)
// Note: Android requires a monochrome icon (white silhouette on transparent)
// Using 96x96 monochrome badge for Android status bar
function getNotificationBadge() {
  const origin = self.location.origin;
  return `${origin}/notification-badge.png`;
}

// Get notification color based on type and data
function getNotificationColor(type, data) {
  switch (type) {
    case 'trade-signal':
      return '#3B82F6'; // Blue for signals
    case 'trade-entry':
      return '#10B981'; // Green for entries
    case 'trade-closed':
      return data.profit > 0 ? '#10B981' : '#EF4444'; // Green for profit, red for loss
    case 'mid-trade-alert':
      return '#F59E0B'; // Orange for mid-trade alerts
    case 'goal-achieved':
      return '#8B5CF6'; // Purple for achievements
    default:
      return '#3B82F6';
  }
}

// Push event - receive and display notification
self.addEventListener('push', (event) => {
  console.log('[SW Push] ==================== PUSH EVENT RECEIVED ====================');
  console.log('[SW Push] Event:', event);
  console.log('[SW Push] Event.data:', event.data);

  if (!event.data) {
    console.log('[SW Push] ERROR: No data in push event');
    return;
  }

  try {
    const payload = event.data.json();
    console.log('[SW Push] Parsed payload:', JSON.stringify(payload, null, 2));

    const { title, body, icon, badge, data, tag, vibrate } = payload;

    const notificationOptions = {
      body: body || 'New notification from Pipnosis',
      icon: icon || getNotificationIcon(data?.type),
      vibrate: vibrate || getVibrationPattern(data?.type, data),
      data: data || {},
      tag: tag || data?.type || 'default',
      requireInteraction: data?.priority === 'urgent',
      silent: false,
      renotify: true
    };

    // Only set badge if explicitly provided (Android needs monochrome icon)
    const badgeIcon = badge || getNotificationBadge();
    if (badgeIcon) {
      notificationOptions.badge = badgeIcon;
    }

    // Add action buttons based on notification type
    const actionIcon = `${self.location.origin}/icon-192.png`;
    if (data?.type === 'trade-signal') {
      notificationOptions.actions = [
        { action: 'view', title: 'View Signal', icon: actionIcon },
        { action: 'dismiss', title: 'Dismiss', icon: actionIcon }
      ];
    } else if (data?.type === 'trade-entry') {
      notificationOptions.actions = [
        { action: 'view', title: 'View Position', icon: actionIcon },
        { action: 'dismiss', title: 'Dismiss', icon: actionIcon }
      ];
    } else if (data?.type === 'trade-closed') {
      notificationOptions.actions = [
        { action: 'view', title: 'View Details', icon: actionIcon },
        { action: 'dismiss', title: 'Dismiss', icon: actionIcon }
      ];
    } else if (data?.type === 'mid-trade-alert') {
      notificationOptions.actions = [
        { action: 'view', title: 'View Trade', icon: actionIcon },
        { action: 'dismiss', title: 'Dismiss', icon: actionIcon }
      ];
    } else if (data?.type === 'goal-achieved') {
      notificationOptions.actions = [
        { action: 'view', title: 'View Achievement', icon: actionIcon },
        { action: 'dismiss', title: 'Dismiss', icon: actionIcon }
      ];
    }

    console.log('[SW Push] Showing notification with title:', title || 'Pipnosis');
    console.log('[SW Push] Notification options:', notificationOptions);

    event.waitUntil(
      self.registration.showNotification(title || 'Pipnosis', notificationOptions)
        .then(() => {
          console.log('[SW Push] ✅ Notification shown successfully!');
        })
        .catch((error) => {
          console.error('[SW Push] ❌ Error showing notification:', error);
        })
    );
  } catch (error) {
    console.error('[SW Push] ❌ Error parsing push event:', error);

    // Show fallback notification
    event.waitUntil(
      self.registration.showNotification('Pipnosis', {
        body: 'New notification (error parsing data)',
        icon: `${self.location.origin}/icon-192.png`,
        badge: `${self.location.origin}/notification-badge.png`,
        vibrate: [200],
        requireInteraction: false,
        silent: false
      })
    );
  }
});

// Notification click event - handle user interaction
self.addEventListener('notificationclick', (event) => {
  console.log('[Push] Notification clicked:', event.notification.tag);

  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;

  // Dismiss action - just close the notification
  if (action === 'dismiss') {
    return;
  }

  // Determine target URL based on notification type
  let targetUrl = '/';

  switch (data.type) {
    case 'trade-signal':
      targetUrl = '/smart-goal-mode';
      break;
    case 'trade-entry':
      targetUrl = '/positions';
      break;
    case 'trade-closed':
      targetUrl = '/ai-journal';
      break;
    case 'mid-trade-alert':
      targetUrl = `/positions?trade=${data.trade_id}`;
      break;
    case 'goal-achieved':
      targetUrl = `/smart-goal-mode?session=${data.goal_session_id}`;
      break;
    default:
      targetUrl = '/';
  }

  // Open the app or focus existing tab
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if app is already open
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus().then(() => {
              // Navigate to target URL
              return client.postMessage({
                type: 'NOTIFICATION_CLICKED',
                url: targetUrl,
                data: data
              });
            });
          }
        }

        // If app is not open, open new window
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// Notification close event - track dismissals
self.addEventListener('notificationclose', (event) => {
  console.log('[Push] Notification closed:', event.notification.tag);

  const data = event.notification.data || {};

  // Send dismissal event to analytics if needed
  event.waitUntil(
    self.registration.getNotifications().then((notifications) => {
      console.log('[Push] Remaining notifications:', notifications.length);
    })
  );
});

// service-worker.js
// Robust service worker optimized for PWAs and iOS apple-touch-icon behavior.
// Customize ASSETS_TO_CACHE to match the exact paths where you host files.

const CACHE_VERSION = 'v2'; // bump this on deploy to force cache refresh
const CACHE_NAME = `phone-keypad-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
  '/',                    // prefer root
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',

  // icons (ensure these paths exactly match files you uploaded)
  '/apple-touch-icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon-32x32.png',

  // optional assets referenced by your app (add any additional images you need cached)
  '/numpad.png',
];

// Utility to detect image requests (used to provide an image fallback instead of HTML)
function isImageRequest(request) {
  if (request.destination && request.destination === 'image') return true;
  try {
    const url = new URL(request.url);
    return /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname);
  } catch (e) {
    return false;
  }
}

// Install: cache the app shell
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        // Use addAll for speed but guard against single-file failures.
        try {
          await cache.addAll(ASSETS_TO_CACHE);
        } catch (err) {
          // If addAll fails (one file missing), add individually to salvage what we can.
          console.warn('SW: cache.addAll failed — falling back to individual caching', err);
          await Promise.all(
            ASSETS_TO_CACHE.map(async (asset) => {
              try {
                await cache.add(asset);
              } catch (e) {
                console.warn('SW: failed to cache', asset, e);
              }
            })
          );
        }
      })
  );
});

// Activate: remove old caches and take control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k !== CACHE_NAME)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests here; let non-GET pass to network.
  if (req.method !== 'GET') {
    return;
  }

  const reqUrl = new URL(req.url);

  // Navigation requests (HTML pages): network-first, fallback to cached index.html
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          // Update cached index.html so we have latest offline copy
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
          return networkResponse;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For other GET requests: try cache first, then network.
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        return cached;
      }

      return fetch(req)
        .then((networkResponse) => {
          // Only cache successful same-origin responses to avoid CORS issues.
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          // Cache same-origin resources
          if (reqUrl.origin === self.location.origin) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              try {
                cache.put(req, clone);
              } catch (e) {
                // Some requests (opaque responses) may throw; ignore gracefully.
                console.warn('SW: cache.put failed for', req.url, e);
              }
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Network failed and nothing in cache -> provide sensible fallbacks:
          if (isImageRequest(req)) {
            // Return the apple-touch icon or any cached icon as an image fallback
            return caches.match('/apple-touch-icon-180.png');
          }
          // For other assets, return a generic 503 response (don't return index.html for assets)
          return new Response(null, { status: 503, statusText: 'Service Unavailable' });
        });
    })
  );
});

// Allow web app to command SW to skip waiting and activate immediately
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

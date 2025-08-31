// service-worker.js (improved)
const CACHE_VERSION = 'v3';
const CACHE_NAME = `phone-keypad-${CACHE_VERSION}`;
const PRECACHE = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.json',
  '/apple-touch-icon-180.png', '/icon-192.png', '/icon-512.png', '/favicon-32x32.png',
  '/numpad.png', '/offline.html'
];

const RUNTIME_CACHE = 'runtime-cache-v1';
const IMAGE_CACHE = 'image-cache-v1';
const MAX_IMAGE_ENTRIES = 60;
const MAX_RUNTIME_ENTRIES = 80;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE).catch(async (err) => {
        // If addAll fails, try to add one-by-one so we still salvage assets.
        console.warn('SW: addAll failed, fall back to individual adds', err);
        for (const url of PRECACHE) {
          try { await cache.add(url); } catch(e) { console.warn('SW: failed to cache', url, e); }
        }
      }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME && !k.startsWith('persist-')).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Utility: trim cache to a max number of items (FIFO)
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    const deleteCount = keys.length - maxItems;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

function isImageRequest(req) {
  if (req.destination && req.destination === 'image') return true;
  try {
    const url = new URL(req.url);
    return /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname);
  } catch (e) { return false; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const reqUrl = new URL(req.url);

  // Navigation requests: network first, fallback to cached offline page
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(req);
        // update cache copy of index.html for offline
        const copy = networkResponse.clone();
        const cache = await caches.open(CACHE_NAME);
        cache.put('/index.html', copy).catch(()=>{});
        return networkResponse;
      } catch (err) {
        const cached = await caches.match(req) || await caches.match('/offline.html') || await caches.match('/index.html');
        return cached || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Images: try cache-first, then network, fallback to cached apple icon
  if (isImageRequest(req)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.status === 200) {
          cache.put(req, resp.clone()).catch(()=>{});
          trimCache(IMAGE_CACHE, MAX_IMAGE_ENTRIES);
        }
        return resp;
      } catch (err) {
        const fallback = await caches.match('/apple-touch-icon-180.png');
        return fallback || Response.error();
      }
    })());
    return;
  }

  // Other GET requests: try cache first, fallback to network and cache
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const resp = await fetch(req);
      if (resp && resp.status === 200 && reqUrl.origin === self.location.origin) {
        cache.put(req, resp.clone()).catch(()=>{});
        trimCache(CACHE_NAME, 200);
      }
      return resp;
    } catch (err) {
      // If nothing cached and network fails => give 503
      return new Response(null, { status: 503, statusText: 'Service Unavailable' });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// NeonPass Progressive Web App Service Worker
const CACHE_NAME = 'neonpass-v2.1.0';

const STATIC_ASSETS = [
  '/',
  '/logo.svg',
  '/favicon.svg',
  '/favicon.ico',
  '/logo-192.png',
  '/logo-512.png',
  '/logo-maskable-192.png',
  '/logo-maskable-512.png',
  '/apple-touch-icon.png',
  '/site.webmanifest'
];

// Install: pre-cache shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-caching non-fatal warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch handler:
// - API and Admin: Network-only
// - HTML & JavaScript (.js): Network-first with cache fallback (ensures immediate updates)
// - Static assets (images, icons, fonts): Cache-first with network fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-GET and chrome-extension
  if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // Network-only for dynamic API endpoints & admin
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) {
    return;
  }

  // Scripts (.js) and HTML Navigation: Network-first with cache fallback
  const isCodeOrNav = req.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.html');
  if (isCodeOrNav) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 200 && url.origin === self.location.origin) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('/') : null)))
    );
    return;
  }

  // Static Media / Assets: Cache-first, fallback to network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.status === 200 && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      });
    })
  );
});
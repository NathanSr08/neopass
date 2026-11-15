// NeonPass Progressive Web App Service Worker
const CACHE_NAME = 'neonpass-v1.1.0';

const STATIC_ASSETS = [
  '/',
  '/app.js',
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

// Fetch: Network-first for navigation, Cache-first for static assets, Network-only for API
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-GET and chrome-extension
  if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // Network-only for dynamic API endpoints & admin
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) {
    return;
  }

  // HTML Navigation: Network-first with cache fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Static Assets: Cache-first, fallback to network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cache successful local GET responses
        if (res.status === 200 && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      });
    })
  );
});
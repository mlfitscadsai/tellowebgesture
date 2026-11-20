const CACHE_NAME = 'aerohand-offline-v2';

// Core shell + lightweight ML weights + MediaPipe HandLandmarker model
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/logo.png',
  '/favicon.png',
  '/manifest.webmanifest',
  '/models/keypoint_classifier_weights.json',
  '/models/hand_landmarker.task',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  // Cache-first for immutable ML models, MediaPipe WASM binaries, and Vite hashed assets
  const isCacheFirst =
    url.pathname.startsWith('/models/') ||
    url.pathname.startsWith('/wasm/') ||
    url.pathname.startsWith('/assets/') ||
    url.pathname === '/logo.png' ||
    url.pathname === '/favicon.png';

  if (isCacheFirst) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Network-first with offline cache fallback for HTML/navigation
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html'))),
  );
});

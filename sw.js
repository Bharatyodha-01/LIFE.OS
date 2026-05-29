/**
 * LIFE OS — Service Worker
 * Enables offline use and installability (PWA).
 */
const CACHE_NAME = 'lifeos-pwa-v8-brand-mobile';
const OFFLINE_URL = './offline.html';

/** App shell — works offline after first visit */
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './style.css?v=20260529-brand-mobile',
  './script.js',
  './script.js?v=20260529-key-context',
  './script.js?v=20260529-brand-mobile',
  './charts.js',
  './manifest.json',
  './offline.html',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('Precache failed:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Navigation: network first, fallback to cached app
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() =>
          caches.match('./index.html').then((r) => r || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Same-origin assets: network first so updated JS/CSS is not trapped by an old PWA cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() =>
        caches.match(event.request)
      )
    );
    return;
  }

  // External (fonts): network with cache fallback
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => cached)
    )
  );
});

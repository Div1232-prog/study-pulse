'use strict';

/* StudyPulse offline app shell. User data remains in browser LocalStorage. */
const CACHE_PREFIX = 'studypulse-';
const CACHE_NAME = 'studypulse-shell-v1-4';

// These three files are required by the application and were supplied together.
const CORE_ASSETS = ['./index.html', './style.css', './app.js'];

// Other files are referenced by the existing HTML / previous shell definition,
// but were not part of this source delivery. Cache them only when they exist.
const OPTIONAL_ASSETS = [
  './manifest.webmanifest',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const scopeUrl = new URL(self.registration.scope);
const indexUrl = new URL('./index.html', scopeUrl).href;
const shellAssetUrls = new Set(
  [...CORE_ASSETS, ...OPTIONAL_ASSETS].map((path) => new URL(path, scopeUrl).href)
);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Missing core resources should fail installation; the app cannot run without them.
    await cache.addAll(CORE_ASSETS.map((path) => new Request(new URL(path, scopeUrl), { cache: 'reload' })));

    // Missing optional branding/PWA files must not block the core app shell.
    await Promise.all(OPTIONAL_ASSETS.map(async (path) => {
      const url = new URL(path, scopeUrl).href;
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response && response.ok && response.status !== 206 && response.type !== 'opaque') {
          await cache.put(url, response.clone());
        }
      } catch (error) {
        // Optional resource is unavailable; continue installing the app shell.
      }
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const fallback = await cache.match(indexUrl);
        if (fallback) return fallback;
        return new Response(
          'StudyPulse is unavailable offline. Please reconnect and try again.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Intercept only known app-shell resources. Other same-origin GET requests pass through.
  if (!shellAssetUrls.has(url.href)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && response.ok && response.status !== 206 && response.type !== 'opaque') {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      return new Response(
        'This StudyPulse resource is unavailable offline.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }
  })());
});

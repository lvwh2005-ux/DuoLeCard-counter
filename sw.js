'use strict';
const PREFIX = 'duole-card-counter-';
const CACHE = PREFIX + 'v2';
const ASSETS = ['./', './index.html', './counter.js?v=2', './app.js?v=2', './manifest.webmanifest', './icon.svg'];
const ASSET_URLS = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const isDocument = event.request.mode === 'navigate';
  if (!isDocument && !ASSET_URLS.has(url.href)) return;
  // Network first keeps the published app current; cached files support offline use.
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== 'opaque') {
        const copy = response.clone();
        const cacheKey = isDocument ? new URL('./index.html', scope).href : event.request;
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(cacheKey, copy)));
      }
      return response;
    } catch (error) {
      const cached = await caches.match(isDocument ? new URL('./index.html', scope).href : event.request);
      if (cached) return cached;
      throw error;
    }
  })());
});

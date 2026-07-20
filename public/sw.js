/* TaskFlow service worker — enables "Add to Home Screen" / installable PWA and
   makes the app shell resilient offline. Deliberately conservative:
   - Only ever touches same-origin GET requests. Supabase, Google Fonts and any
     other cross-origin traffic is passed straight through, untouched.
   - Navigations are network-first (so you always get fresh HTML when online),
     falling back to the cached shell when offline.
   - Static assets (JS/CSS/images) are stale-while-revalidate for instant loads. */

const CACHE = 'taskflow-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never intercept Supabase/fonts/etc.

  // App navigations: try the network, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put('/index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        const cached = await cache.match('/index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // Static assets: serve from cache immediately, refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
        return res;
      })
      .catch(() => cached);
    return cached || network;
  })());
});

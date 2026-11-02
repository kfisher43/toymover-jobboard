// Toymover driver app: caches the app shell only. API calls (Supabase) are never cached.
const CACHE = 'toymover-app-v2';
const SHELL = ['./', './index.html', './app.js', './style.css', './supabase.js', './manifest.webmanifest', './pdf-lib.min.js', './leaflet.js', './leaflet.css',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // Supabase, signed photo URLs: network only
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return; // ../bols, ../photos: network only
  // network first, fall back to cache so the shell opens offline and updates are picked up
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});

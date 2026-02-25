/* ─── Sea Lamp PWA — sw.js ─── */
/* Updated: 2026-02-25 01:15:00 UTC */
const CACHE = 'sealamp-pwa-v5';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

/* Install — cache shell */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

/* Activate — clean old caches */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Fetch — network-first for HTML/JS (fresh), cache-first for static (CSS/images) */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  
  const isDynamic = url.pathname.endsWith('.html') || url.pathname.endsWith('.js');
  
  if (isDynamic) {
    /* Network-first for dynamic files (always try fresh) */
    e.respondWith(
      fetch(e.request)
        .then(r => {
          if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    /* Cache-first for static assets */
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});

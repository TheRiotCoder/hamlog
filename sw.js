/* HamLog service worker – offline app shell (cache-first, versioned). Bump VERSION on every release. */
const VERSION = 'hamlog-v1.0.0';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/hamdata.js',
  './js/adif.js',
  './js/db.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('hamlog-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // e.g. links to qrz.com go straight to the network

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(hit => hit || fetch(req)).catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});

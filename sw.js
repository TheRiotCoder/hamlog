/* HamLog service worker – offline app shell (cache-first, versioned). Bump VERSION on every release. */
const VERSION = 'hamlog-v1.3.0';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/hamdata.js',
  './js/adif.js',
  './js/field.js',
  './js/ops.js',
  './js/vaultcrypto.js',
  './js/bio.js',
  './js/vault.js',
  './js/lookup.js',
  './js/lookupui.js',
  './js/db.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

// 1.3.0 (ported from SatPass 1.3.5): Cloudflare Pages redirects /index.html -> / ("clean URLs"), so the install fetch of ./index.html answers with a
// REDIRECTED response. Chrome refuses to serve a redirected response to a navigation ("a redirected response was used for a request whose redirect mode
// is not follow") and shows an error page. So no redirected response is ever cached or served: each is rebuilt as a plain 200 Response.
function plain(res) { return res && res.redirected ? res.blob().then(b => new Response(b, { status: 200, statusText: 'OK', headers: res.headers })) : Promise.resolve(res); }

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => Promise.all(ASSETS.map(u =>
    fetch(new Request(u, { cache: 'reload' })).then(r => { if (!r.ok) throw new Error('precache ' + u + ' ' + r.status); return plain(r); }).then(r => cache.put(u, r))))));
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
      caches.match('./index.html').then(hit => hit || caches.match('./')).then(hit => hit || fetch(req)).then(plain)
        .catch(() => caches.match('./index.html').then(plain))
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return plain(hit);
      return fetch(req).then(res => {
        if (res && res.ok && res.type === 'basic' && !res.redirected) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});

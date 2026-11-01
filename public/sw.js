// Caches the app shell so it opens with no internet. Bump VERSION after changing any file.
const VERSION = 'moneybook-fb-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'xlsx-lite.js', 'firebase-sync.js', 'firebase-config.js', 'manifest.webmanifest', 'seed.json',
               'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Same-origin GETs: network first (fresh code when online), cache fallback (offline).
// Firebase (Auth/Firestore) calls are cross-origin and pass straight through.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

// Cache only public offline UI assets. Never cache '/', credentials, auth, API or note data.
const CACHE = 'byte-back-offline-v1';
const ASSETS = ['/offline.html','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('byte-back-offline-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.mode !== 'navigate' || req.method !== 'GET' || new URL(req.url).pathname !== '/' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req).catch(async () => {
    const offline = await caches.match('/offline.html');
    return offline || Response.error();
  }));
});

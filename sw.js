// Spendings Tracker service worker: lets the app open offline.
// App files are network-first, so a new version shows up on the next load
// whenever you're online; the cached copy is only used when the network isn't.

const CACHE = 'money-tracker-v2';
const FONT_CACHE = 'money-tracker-fonts';
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('money-tracker') && key !== CACHE && key !== FONT_CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  network.catch(() => {}); // a failure is handled below; this just keeps the console quiet
  try {
    // A slow connection shouldn't hold the app hostage: after 4s, use the cached copy.
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true })
      ?? (request.mode === 'navigate' ? await cache.match('./') : undefined);
    return cached ?? network;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached ?? network;
}

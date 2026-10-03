// Spendings Tracker service worker: opens the app instantly, online or off.
//
// App files are answered from the saved copy straight away and refreshed in the
// background, so opening the app never waits on the network (a slow connection
// used to mean seconds of blank screen). Changing CACHE below installs a whole
// new set of files at once and tells the open page, which offers a reload.

const CACHE = 'money-tracker-v6';
const FONT_CACHE = 'money-tracker-fonts';
const APP_FILES = [
  './',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// Files are saved under their address without the ?query, so ?v=5 or ?add reach the same copy.
const keyOf = url => {
  const u = new URL(url, self.location);
  u.search = '';
  u.hash = '';
  return u.href;
};

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'reload' skips the browser's own cache, so the saved set is always the latest and complete.
    await Promise.all(APP_FILES.map(async file => {
      const res = await fetch(new Request(file, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${file}: ${res.status}`);
      await cache.put(keyOf(file), res);
    }));
    await self.skipWaiting();
  })());
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
    event.respondWith(appFile(event));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function appFile(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  const key = keyOf(request.url);
  const cached = await cache.match(key, { ignoreVary: true });
  const refresh = revalidate(cache, key, request);
  event.waitUntil(refresh.catch(() => {})); // keep the worker alive until the saved copy is updated
  if (cached) return cached;
  try {
    return await refresh;
  } catch {
    // Offline and never saved: any page in the app opens the app.
    return (request.mode === 'navigate' && await cache.match(keyOf('./'), { ignoreVary: true })) || Response.error();
  }
}

// no-cache: always ask the server (a cheap 304 when nothing changed), so a fix
// is saved for the next open instead of after the host's 10-minute cache.
async function revalidate(cache, key, request) {
  const res = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
  if (!res.ok) return res;
  // A page can't be answered with a redirected response, so save a plain copy.
  const clean = res.redirected
    ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
    : res;
  await cache.put(key, clean.clone());
  return clean;
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

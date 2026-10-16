// App shell cache: precache the shell, serve Vite's hashed assets and the icons cache-first, and leave
// everything else to the network: pages, /api, /admin and the app's /_serverFn data calls.
const CACHE = "pergent-v4";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];
const STATIC = /^\/(assets\/|icon|apple-touch-icon|manifest\.webmanifest$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;

  // Navigations: network first, the last cached front page when offline (pages are server-rendered).
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  if (!STATIC.test(url.pathname)) return;

  // Hashed assets and icons: cache first, fill the cache on miss.
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ??
        fetch(event.request).then((res) => {
          if (res.ok) caches.open(CACHE).then((cache) => cache.put(event.request, res.clone()));
          return res;
        }),
    ),
  );
});

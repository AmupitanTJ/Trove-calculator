/* TROVE Calc — offline-first static cache for standalone / PWA use */
const CACHE_NAME = "trove-calc-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./manifest.json",
  "./browserconfig.xml",
  "./favicon.ico",
  "./favicon.svg",
  "./favicon/favicon.ico",
  "./favicon/favicon.svg",
  "./favicon/favicon-16x16.png",
  "./favicon/favicon-32x32.png",
  "./icons/apple-touch-icon.png",
  "./icons/android-chrome-192x192.png",
  "./icons/android-chrome-512x512.png",
  "./icons/maskable-512x512.png",
  "./assets/logo.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network first, offline fallback to shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", clone));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static assets: cache first, then network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

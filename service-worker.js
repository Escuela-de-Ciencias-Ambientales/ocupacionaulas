const CACHE_NAME = "edeca-reservas-v2";
const APP_SHELL = [
  "./index.html",
  "./ingreso.html",
  "./reservas.html",
  "./usuarios.html",
  "./mis-giras.html",
  "./config.js",
  "./field-labels.css",
  "./field-labels.js",
  "./ingreso.css",
  "./ingreso.js",
  "./mis-giras.css",
  "./mis-giras.js",
  "./password-toggle.js",
  "./pwa-install.js",
  "./reservas.css",
  "./reservas.js",
  "./usuarios.css",
  "./usuarios.js",
  "./vehiculos-publicos.js",
  "./vehiculos.css",
  "./vehiculos.js",
  "./visit-counter.js",
  "./vehiculo-mitsubishi-l200.webp",
  "./vehiculo-toyota-hilux.webp",
  "./manifest.webmanifest",
  "./logo-edeca.png",
  "./logo-una.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (!response.ok) return response;
        return caches.open(CACHE_NAME)
          .then((cache) => cache.put(event.request, response.clone()))
          .then(() => response);
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      }))
  );
});

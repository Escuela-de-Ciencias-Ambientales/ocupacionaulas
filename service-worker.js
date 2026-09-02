const CACHE_NAME = "edeca-reservas-v29";
const APP_SHELL = [
  "./index.html",
  "./ingreso.html",
  "./reservas.html",
  "./autorizaciones-equipos.html",
  "./autorizaciones-equipos.css",
  "./autorizaciones-equipos.js",
  "./solicitar-equipo.html",
  "./solicitar-equipo.css",
  "./solicitar-equipo.js",
  "./bodega-equipos.html",
  "./bodega-equipos.css",
  "./bodega-equipos.js",
  "./student-view.css",
  "./navigation-enhancements.css",
  "./navigation-enhancements.js",
  "./tramites-vehiculos.html",
  "./usuarios.html",
  "./mis-giras.html",
  "./tramites-vehiculos.css",
  "./tramites-vehiculos.js",
  "./conserjeria.css",
  "./conserjeria-publico.js",
  "./conserjeria-admin.css",
  "./conserjeria-admin.js",
  "./vehicle-locations.js",
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
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});

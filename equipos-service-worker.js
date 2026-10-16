const CACHE = 'edeca-equipos-v2';
const PAGE = new URL('solicitar-equipo.html', self.location).href;
const SHELL = ['solicitar-equipo.html', 'solicitar-equipo.js', 'equipos-pwa-install.js', 'config.js', 'shared-utils.js', 'design-tokens.css', 'shared-header.css', 'solicitar-equipo.css', 'request-signature.css', 'sigep-brand.css', 'equipment-responsive.css', 'visual-system.css', 'navigation-enhancements.css', 'sigep-logo.png', 'logo-una.png', 'manifest-equipos.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('edeca-equipos-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = event.request.mode === 'navigate' && url.pathname === new URL(PAGE).pathname;
  if (!navigation && !SHELL.some(path => new URL(path, self.location).pathname === url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(event.request, { ignoreSearch: true }) || (navigation && await cache.match(PAGE)) || Response.error();
  }));
});

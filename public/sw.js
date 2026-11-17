// Fonctionnement hors connexion de MyMeals.
// - La page : le réseau d'abord (pour toujours charger la dernière version), la copie en cache sinon.
// - Les fichiers versionnés (/assets/…) : le cache d'abord, ils ne changent jamais.
// - Les appels à Google ne passent jamais par le cache.
const CACHE = 'mymeals-v1';
const SHELL = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

function remember(request, response) {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => remember('./', response))
        .catch(async () => (await caches.match('./')) ?? Response.error()),
    );
    return;
  }
  if (url.pathname.includes('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then((response) => remember(request, response))));
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => remember(request, response))
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});

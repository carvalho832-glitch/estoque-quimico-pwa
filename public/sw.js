const CACHE_NAME = 'quimstock-v58';
const APP_SHELL = ['./', './index.html', './cloud.html', './manifest.webmanifest', './icon.svg', './facc-logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isAppAsset = sameOrigin && (event.request.mode === 'navigate' || /\.(?:js|css|html)$/.test(url.pathname));

  if (isAppAsset) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || (await caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && sameOrigin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { data: { body: event.data.text() } };
  }

  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || 'QuimStock';
  const body = notification.body || data.body || 'Há uma nova atualização no estoque.';
  const url = data.url || './';
  const tag = data.notificationKey || data.tag || undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon.svg',
      badge: './icon.svg',
      tag,
      data: { ...data, url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.registration.scope).href;
  const scopeUrl = self.registration.scope;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const quimStockClient = clients.find((client) => client.url.startsWith(scopeUrl));
      if (quimStockClient) {
        if ('navigate' in quimStockClient && quimStockClient.url !== targetUrl) {
          await quimStockClient.navigate(targetUrl);
        }
        return quimStockClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

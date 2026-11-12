// Service worker : l'appli s'ouvre instantanément (fichiers en cache) et se met à jour
// en arrière-plan. Les données et les photos, elles, viennent toujours de Supabase.
const CACHE = 'notre-calendrier-v5';
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'animals.js', 'api.js', 'excel.js', 'duo.js', 'app.js', 'manifest.webmanifest',
  'icons/app-192.png', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.hostname.endsWith('supabase.co')) return;
  // Réseau d'abord (dernière version), cache si hors ligne.
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});

// Notifications envoyées par la fonction Supabase « notify » : { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Notre Calendrier', {
    body: data.body || '',
    icon: 'icons/app-192.png',
    badge: 'icons/app-192.png',
    tag: data.tag,
    renotify: !!data.tag,
    data: { url: data.url || './' },
  }));
});

// Toucher la notification ouvre l'appli au bon endroit (question, rappels…).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((w) => 'focus' in w);
    if (open) return open.navigate(url).then((w) => (w || open).focus()).catch(() => open.focus());
    return self.clients.openWindow(url);
  }));
});

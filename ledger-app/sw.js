// 记账本 Service Worker —— 离线缓存应用外壳
const CACHE = 'ledger-cache-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/storage.js',
  './js/charts.js',
  './js/parse.js',
  './assets/icon.svg',
  './assets/icon-180.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // 仅缓存 GET 请求，其余走网络
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const net = fetch(event.request).then(resp => {
        // 仅缓存同源静态资源
        if (resp && resp.status === 200 && new URL(event.request.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

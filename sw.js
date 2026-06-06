// Service Worker — 网络优先，离线回退
const CACHE_NAME = 'daily-planner-v2';

// 安装
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 请求：网络优先，失败时用缓存
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 网络成功，更新缓存
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => {
        // 离线时用缓存
        return caches.match(event.request);
      })
  );
});

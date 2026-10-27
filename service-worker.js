const CACHE_NAME = 'waimai-cache-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './assets/tailwind.css',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './avatar.png',
  './stamp.png',
  './timeline.png',
  './assets/campus-banner.jpg',
  './assets/campus-avatar.png',
  './assets/workbench-card-ai.jpg',
  './assets/workbench-card-wb.jpg'
];

// 安装：预缓存核心资源
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => Promise.all(
      cacheNames.map(cacheName => {
        if (cacheName !== CACHE_NAME) {
          return caches.delete(cacheName);
        }
      })
    )).then(() => self.clients.claim())
  );
});

// 拦截请求：
// - 页面导航（HTML）：网络优先，断网才回退缓存，保证新版本能立刻生效
// - 其他同源静态资源：缓存优先 + 后台更新
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') {
    return;
  }

  const isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return; // 跨域（如 Tailwind CDN）交给浏览器默认策略
  }

  event.respondWith(
    caches.match(req).then(hit => {
      const network = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});

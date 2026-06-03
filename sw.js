/* ======================================================================
   LocalBook — Service Worker
   ====================================================================== */

const CACHE = 'localbook-v1.2.0';
const STATIC_ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/lib/lunar.min.js',
  'manifest.json',
  'icon.svg',
  'version.json'
];

/* ---- 安装：预缓存静态资源 ---- */
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

/* ---- 激活：清理旧缓存 ---- */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ---- 拦截请求：网络优先，缓存兜底 ---- */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;

  // HTML → 网络优先（确保每次打开拿到最新版）
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // 静态资源 → 缓存优先
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

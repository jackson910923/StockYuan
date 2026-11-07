/*
 * StockYuan Service Worker v6
 * - 只快取「App 殼層」與「AI 報告」（以去除 ?t= 之固定鍵存放，永遠只保留一份）
 * - 絕不攔截/快取第三方 API（即時報價、新聞），避免舊版 SW 每次開啟累積數 MB 快取、
 *   撐爆手機儲存空間而被瀏覽器整站清除（包含自選股）的問題
 * - HTML / JS / CSS / 報告：網路優先（ETag 重新驗證），離線時回退快取
 */
const VERSION = '6.0.0';
const SHELL_CACHE = `sy-shell-${VERSION}`;
const DATA_CACHE = 'sy-data-v1';
const FONT_CACHE = 'sy-fonts-v1';
const KEEP = new Set([SHELL_CACHE, DATA_CACHE, FONT_CACHE]);

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/app.css',
  './assets/js/app.js',
  './assets/js/util.js',
  './assets/js/store.js',
  './assets/js/api.js',
  './assets/js/ui.js',
  './assets/js/charts.js',
  './assets/js/views.js',
  './assets/js/stock.js',
  './vendor/lightweight-charts-4.2.3.js',
  './assets/img/logo.webp',
  './assets/img/m1.webp',
  './assets/img/m2.webp',
  './assets/img/m3.webp',
  './assets/img/m4.webp',
  './assets/img/m5.webp',
  './assets/img/m6.webp',
  './icon-192.png',
];

const scopeUrl = new URL(self.registration.scope);
const normKey = url => {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  if (u.pathname === scopeUrl.pathname) u.pathname += 'index.html';
  return u.href;
};

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      Promise.all(
        SHELL.map(path =>
          fetch(new Request(path, { cache: 'reload' }))
            .then(resp => (resp.ok ? cache.put(normKey(resp.url || new URL(path, scopeUrl).href), resp) : null))
            .catch(() => null)
        )
      )
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // 清除舊版（含 v5.x 無限累積的 stockyuan-* 快取）
      await Promise.all(keys.filter(k => !KEEP.has(k)).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', event => {
  if (event.data === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  }
});

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  const key = normKey(request.url);
  try {
    const ctrl = new AbortController();
    const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    const resp = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin', signal: ctrl.signal });
    if (timer) clearTimeout(timer);
    if (resp.ok && !resp.redirected) {
      cache.put(key, resp.clone()).catch(() => {});
      return resp;
    }
    if (resp.redirected) return fetch(request);
    const hit = await cache.match(key);
    return hit || resp;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await caches.match(normKey(new URL('./index.html', scopeUrl).href));
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const key = normKey(request.url);
  const hit = await cache.match(key);
  if (hit) return hit;
  const resp = await fetch(request);
  if (resp.ok) cache.put(key, resp.clone()).catch(() => {});
  return resp;
}

async function fontCache(request) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then(resp => {
      // 只存 CORS 正常回應（opaque 回應在配額計算會被膨脹到數 MB）
      if (resp.ok && resp.type !== 'opaque') cache.put(request, resp.clone()).catch(() => {});
      return resp;
    })
    .catch(() => hit || Response.error());
  return hit || refresh;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) {
    // 只處理 Google Fonts；其他第三方（報價、新聞 API）一律直連，不經 SW、不快取
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      event.respondWith(fontCache(req));
    }
    return;
  }
  if (!url.pathname.startsWith(scopeUrl.pathname)) return;

  const path = url.pathname;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL_CACHE, 5000));
  } else if (path.endsWith('/data/latest_report.json')) {
    event.respondWith(networkFirst(req, DATA_CACHE, 0));
  } else if (/\.(?:js|css|json|html)$/.test(path)) {
    event.respondWith(networkFirst(req, SHELL_CACHE, 0));
  } else if (/\.(?:png|webp|jpg|jpeg|svg|ico)$/.test(path)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
  }
  // 其他（如 .apk 下載）不攔截
});

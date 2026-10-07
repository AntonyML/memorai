var CACHE = 'memorai-v0.3.2';
var URLS = [
  // Cache the complete Connections module, styles and worker for first-use offline.
  // Includes responsive fitting, semantic curves and contrast-safe theme tokens.
  '/',
  'index.html',
  'css/style.css',
  'assets/vendor.js',
  'js/state.js',
  'js/utils.js',
  'js/dialogs.js',
  'js/icons.js',
  'js/storage.js',
  'js/notes.js',
  'js/knowledge.js',
  'js/http.js',
  'js/offline.js',
  'js/sync.js',
  'js/image.js',
  'js/ui.js',
  'js/connections.js',
  'js/connections/adapters/app.js',
  'js/connections/animation/tween.js',
  'js/connections/domain/graph.js',
  'js/connections/domain/relations.js',
  'js/connections/export-pdf.js',
  'js/connections/index.js',
  'js/connections/interaction/keyboard.js',
  'js/connections/interaction/pointer.js',
  'js/connections/interaction/viewport.js',
  'js/connections/layout/force.js',
  'js/connections/layout/geometry.js',
  'js/connections/layout/index.js',
  'js/connections/layout/layered.js',
  'js/connections/layout/shared.js',
  'js/connections/layout/smart.js',
  'js/connections/render/edges.js',
  'js/connections/render/elements.js',
  'js/connections/render/measure.js',
  'js/connections/render/nodes.js',
  'js/connections/render/svg.js',
  'js/connections/state/history.js',
  'js/connections/state/layoutRunner.js',
  'js/connections/state/store.js',
  'js/connections/styles/connections.css',
  'js/connections/styles/tokens.css',
  'js/connections/types.js',
  'js/connections/ui/filters.js',
  'js/connections/ui/noteList.js',
  'js/connections/ui/toolbar.js',
  'js/connections/workers/layout.worker.js',
  'js/insights.js',
  'js/gestures.js',
  'js/workspace.js',
  'js/app.js',
  'favicon.svg',
  'favicon-16.png',
  'favicon-32.png',
  'favicon-192.png',
  'favicon-512.png',
  'og-image.png',
  'manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'
];

var ALLOWED_ORIGINS = [
  self.location.origin,
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

function isCacheable(url) {
  return ALLOWED_ORIGINS.indexOf(new URL(url).origin) !== -1;
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(
        URLS.map(function (url) {
          if (new URL(url, self.location.origin).origin === self.location.origin) return cache.add(url);
          return cache.add(url).catch(function () { /* Optional fonts use the system-font fallback. */ });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key.indexOf('memorai-') === 0 && key !== CACHE; }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // Private workspace snapshots always come from the live local server.
  var requestURL = new URL(e.request.url);
  if (!isCacheable(e.request.url)) return;
  if (requestURL.origin === self.location.origin && (requestURL.pathname.indexOf('/api/') === 0 || requestURL.pathname === '/config.json')) return;
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (response) {
        if (response && response.status === 200 && isCacheable(e.request.url)) {
          var clone = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      });
    })
  );
});

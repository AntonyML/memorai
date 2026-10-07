import { expect, test } from 'bun:test';
import vm from 'node:vm';

const source = await Bun.file(new URL('../sw.js', import.meta.url)).text();
const origin = 'http://localhost:8080';

function worker({ failAdd, offline = false, cached = {}, cacheKeys = [] } = {}) {
  const handlers = new Map();
  const entries = new Map(Object.entries(cached).map(([path, body]) => [new URL(path, origin).href, new Response(body)]));
  const calls = { add: [], match: [], put: [], deleted: [], fetch: [], warnings: [], skipped: 0, claimed: 0 };
  const cache = {
    async add(path) {
      calls.add.push(path);
      if (failAdd?.(path)) throw new Error(`Asset unavailable: ${path}`);
      entries.set(new URL(path, origin).href, new Response(`Cached ${path}`));
    },
    async put(request, response) { calls.put.push(request.url); entries.set(request.url, response); }
  };
  const context = {
    URL,
    self: {
      location: { origin },
      addEventListener(type, handler) { handlers.set(type, handler); },
      async skipWaiting() { calls.skipped++; },
      clients: { async claim() { calls.claimed++; } }
    },
    caches: {
      async open() { return cache; },
      async match(request) { calls.match.push(request.url); return entries.get(request.url)?.clone(); },
      async keys() { return cacheKeys; },
      async delete(key) { calls.deleted.push(key); return true; }
    },
    async fetch(request) {
      calls.fetch.push(request.url);
      if (offline) throw new Error('Network unavailable');
      return new Response('Live public asset');
    },
    console: { warn(...args) { calls.warnings.push(args); } }
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  return {
    calls,
    currentCache: context.CACHE,
    lifecycle(type) {
      let completion;
      handlers.get(type)({ waitUntil(promise) { completion = promise; } });
      return completion;
    },
    request(url, method = 'GET') {
      let response;
      handlers.get('fetch')({
        request: new Request(new URL(url, origin), { method }),
        respondWith(promise) { response = promise; }
      });
      return response;
    }
  };
}

test('missing local offline asset prevents a partial worker from activating', async () => {
  const instance = worker({ failAdd: path => path === 'assets/vendor.js' });
  await expect(instance.lifecycle('install')).rejects.toThrow('Asset unavailable: assets/vendor.js');
  expect(instance.calls.skipped).toBe(0);
});

test('optional Google Fonts failure still permits worker installation and activation', async () => {
  const instance = worker({ failAdd: path => new URL(path, origin).origin === 'https://fonts.googleapis.com' });
  await instance.lifecycle('install');
  await instance.lifecycle('activate');
  expect(instance.calls.skipped).toBe(1);
  expect(instance.calls.claimed).toBe(1);
  expect(instance.calls.warnings).toHaveLength(1);
});

test('private APIs, server config, GitHub and POST bypass the service worker cache', () => {
  const instance = worker();
  const requests = [
    ['/api/notes?revision=2', 'GET'],
    ['/api/images', 'GET'],
    ['/config.json?updated=1', 'GET'],
    ['https://api.github.com/repos/example/notebook/contents/notes', 'GET'],
    ['/index.html', 'POST']
  ];
  for (const [url, method] of requests) expect(instance.request(url, method)).toBeUndefined();
  expect(instance.calls.match).toHaveLength(0);
  expect(instance.calls.put).toHaveLength(0);
  expect(instance.calls.fetch).toHaveLength(0);
});

test('cached local vendor libraries load without a network connection', async () => {
  const instance = worker({ offline: true, cached: { '/assets/vendor.js': 'offline browser libraries' } });
  const response = await instance.request('/assets/vendor.js');
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('offline browser libraries');
  expect(instance.calls.fetch).toHaveLength(0);
});

test('activation deletes older memorai caches and preserves other applications', async () => {
  const cacheKeys = ['memorai-v0.1.9', 'memorai-v0.2.0', 'other-app-v1', 'memorai-tools'];
  const instance = worker({ cacheKeys });
  // CacheStorage can be shared by several applications on the same origin.
  cacheKeys.push(instance.currentCache);
  await instance.lifecycle('activate');
  expect(instance.calls.deleted).toEqual(['memorai-v0.1.9', 'memorai-v0.2.0', 'memorai-tools']);
  expect(instance.calls.deleted).not.toContain(instance.currentCache);
  expect(instance.calls.deleted).not.toContain('other-app-v1');
  expect(instance.calls.claimed).toBe(1);
});

test('origin matching rejects lookalike font domains and unrelated CDNs', () => {
  const instance = worker();
  for (const url of [
    'https://fonts.googleapis.com.example.test/font.css',
    'https://fonts.gstatic.com.example.test/font.woff2',
    'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js',
    'http://fonts.googleapis.com/font.css'
  ]) expect(instance.request(url)).toBeUndefined();
  expect(instance.calls.match).toHaveLength(0);
});

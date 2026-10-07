import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticHandler } from '../scripts/server.js';

let server;
let fixture;

beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'memorai-server-'));
  await mkdir(join(fixture, 'js'));
  await mkdir(join(fixture, 'css'));
  await mkdir(join(fixture, '.git'));
  await Bun.write(join(fixture, 'index.html'), '<!DOCTYPE html><title>memorai</title>');
  await Bun.write(join(fixture, 'js/app.js'), 'window.App = {};');
  await Bun.write(join(fixture, 'css/style.css'), 'body { color: white; }');
  await Bun.write(join(fixture, 'manifest.json'), '{"name":"memorai"}');
  await Bun.write(join(fixture, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  await Bun.write(join(fixture, '.git/config'), 'private repository settings');
  await Bun.write(join(fixture, 'package.json'), '{"private":true}');
  await Bun.write(join(fixture, 'js/.private.js'), 'private');
  server = Bun.serve({ hostname: 'localhost', port: 0, fetch: await createStaticHandler(fixture) });
});

afterAll(async () => {
  server?.stop(true);
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

test('serves the app and PWA assets with browser-compatible content types', async () => {
  for (const [path, mime] of [
    ['/', 'text/html'],
    ['/js/app.js', 'javascript'],
    ['/css/style.css', 'text/css'],
    ['/manifest.json', 'application/json'],
    ['/sw.js', 'javascript']
  ]) {
    const response = await fetch(new URL(path, server.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(mime);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toBe('');
  }
});

test('HEAD reports file size without sending the body', async () => {
  const response = await fetch(new URL('/index.html', server.url), { method: 'HEAD' });
  expect(response.status).toBe(200);
  expect(Number(response.headers.get('content-length'))).toBeGreaterThan(0);
  expect(await response.text()).toBe('');
});

test('missing config and assets return 404 rather than the HTML app', async () => {
  for (const path of ['/config.json', '/js/missing.js', '/unknown', '/js']) {
    const response = await fetch(new URL(path, server.url));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
  }
});

test('reads optional config and source edits on the next request', async () => {
  await Bun.write(join(fixture, 'config.json'), '{"title":"My Notes"}');
  let response = await fetch(new URL('/config.json', server.url));
  expect(await response.json()).toEqual({ title: 'My Notes' });
  await Bun.write(join(fixture, 'js/app.js'), 'window.App = { updated: true };');
  response = await fetch(new URL('/js/app.js', server.url));
  expect(await response.text()).toContain('updated: true');
});

test('rejects writes, private files, and encoded Windows or traversal paths', async () => {
  const response = await fetch(server.url, { method: 'POST' });
  expect(response.status).toBe(405);
  expect(response.headers.get('allow')).toBe('GET, HEAD');
  for (const path of [
    '/.git/config', '/.codegraph/graph.db', '/package.json', '/scripts/server.js',
    '/js/.private.js', '/js/%2e%2e%2fpackage.json', '/js/%2e%2e%5cpackage.json',
    '/js/C%3a/private', '/js/app.js%3a%24DATA', '/js/app.js%00'
  ]) {
    expect((await fetch(new URL(path, server.url))).status).toBe(404);
  }
  expect((await fetch(new URL('/js/%ZZ', server.url))).status).toBe(400);
});

test('does not follow a public symlink to a file outside the web root', async () => {
  const outside = join(fixture, 'outside');
  const webroot = join(fixture, 'webroot');
  await mkdir(outside);
  await mkdir(join(webroot, 'js'), { recursive: true });
  await Bun.write(join(outside, 'secret.js'), 'private');
  await symlink(outside, join(webroot, 'js/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const handler = await createStaticHandler(webroot);
  const response = await handler(new Request('http://localhost/js/linked/secret.js'));
  expect(response.status).toBe(404);
});

test('does not follow a public symlink into a private directory inside the web root', async () => {
  await symlink(join(fixture, '.git'), join(fixture, 'js/private'), process.platform === 'win32' ? 'junction' : 'dir');
  const response = await fetch(new URL('/js/private/config', server.url));
  expect(response.status).toBe(404);
});

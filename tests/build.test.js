import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildSite } from '../scripts/build.js';
import { createStaticHandler } from '../scripts/server.js';
import { PROJECT_ROOT } from '../scripts/site.js';

test('build produces a static deployment with local libraries and offline assets', async () => {
  const output = await buildSite();
  const html = await Bun.file(join(output, 'index.html')).text();
  expect(html).toBe(await Bun.file(join(PROJECT_ROOT, 'index.html')).text());

  // All local URLs in HTML and the worker must still resolve after deployment.
  const worker = await Bun.file(join(output, 'sw.js')).text();
  expect(worker).toBe(await Bun.file(join(PROJECT_ROOT, 'sw.js')).text());
  const precache = worker.match(/var URLS = \[([\s\S]*?)\];/)[1];
  const urls = [
    ...[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]),
    ...[...precache.matchAll(/'([^']+)'/g)].map(match => match[1])
  ].filter(url => !/^(?:https?:|#)/.test(url));
  const handler = await createStaticHandler(output);
  expect(await Bun.file(join(output, 'assets', 'vendor.js')).exists()).toBe(true);
  expect(await Bun.file(join(output, 'assets', 'vendor.js')).text()).toBe(
    await Bun.file(join(PROJECT_ROOT, 'assets', 'vendor.js')).text()
  );
  for (const url of urls) {
    const response = await handler(new Request(new URL(url, 'http://localhost/')));
    expect(response.status).toBe(200);
  }

  for (const path of ['config.json', 'package.json', 'bun.lock', 'AGENTS.md', 'AGENT_NOTES.md', 'README.md', '.git', '.codegraph', '.memorai', 'node_modules', 'scripts', 'tests']) {
    expect(await Bun.file(join(output, path)).exists()).toBe(false);
  }

  // Rebuilds must remove stale artifacts, including a previously added config.
  await Bun.write(join(output, 'stale.js'), 'old asset');
  await Bun.write(join(output, 'config.json'), '{"title":"old config"}');
  await buildSite();
  expect(await Bun.file(join(output, 'stale.js')).exists()).toBe(false);
  expect(await Bun.file(join(output, 'config.json')).exists()).toBe(false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import vm from 'node:vm';
import { PROJECT_ROOT, isPublicPath } from '../../scripts/site.js';

// Follow the browser's local import graph, including its separately loaded worker.
// JSDoc imports describe types and do not request a runtime asset.
async function runtimeAssets() {
  const html = await readFile(join(PROJECT_ROOT, 'index.html'), 'utf8');
  const assets = new Set(['js/connections.js']);
  for (const [, path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (path.startsWith('js/connections/')) assets.add(path);
  }
  const modules = new Map();
  const queue = [...assets].filter(path => path.endsWith('.js'));
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    if (modules.has(path)) continue;
    const source = (await readFile(join(PROJECT_ROOT, path), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    const imports = [
      ...[...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map(match => match[1]),
      ...[...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1])
    ];
    const resolve = specifier => {
      assert.match(specifier, /^\.\.?\//, `Connections must use native local imports: ${path} -> ${specifier}`);
      const dependency = posix.normalize(posix.join(posix.dirname(path), specifier));
      assert.ok(dependency.startsWith('js/connections/'), `Dependency escaped Connections: ${path} -> ${dependency}`);
      assert.ok(dependency.endsWith('.js'), `Browser module requires a JavaScript extension: ${dependency}`);
      assets.add(dependency);
      queue.push(dependency);
      return dependency;
    };
    modules.set(path, imports.map(resolve));
    for (const [, worker] of source.matchAll(/new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) resolve(worker);
  }
  return { assets, modules };
}

test('Connections runtime resources exist and are allowed by the static server', async () => {
  const { assets } = await runtimeAssets();
  assert.ok(assets.has('js/connections/workers/layout.worker.js'), 'Include the worker before its first large graph');
  for (const path of assets) {
    assert.ok(isPublicPath(path), `Static hosts cannot serve ${path}`);
    const information = await stat(join(PROJECT_ROOT, path));
    assert.ok(information.isFile() && information.size > 0, `Missing runtime resource: ${path}`);
  }
});

test('Connections runtime modules have no circular dependencies', async () => {
  const { modules } = await runtimeAssets();
  const complete = new Set();
  const visiting = new Set();
  function visit(path, chain) {
    assert.ok(!visiting.has(path), `Circular dependency: ${[...chain, path].join(' -> ')}`);
    if (complete.has(path)) return;
    visiting.add(path);
    for (const dependency of modules.get(path) || []) visit(dependency, [...chain, path]);
    visiting.delete(path);
    complete.add(path);
  }
  for (const path of modules.keys()) visit(path, []);
});

test('Connections precache covers module imports and the worker for offline reloads', async () => {
  const { assets } = await runtimeAssets();
  const source = await readFile(join(PROJECT_ROOT, 'sw.js'), 'utf8');
  const context = { URL, self: { location: { origin: 'http://localhost:8080' }, addEventListener() {} } };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  const precached = new Set(context.URLS.map(path => new URL(path, context.self.location.origin).pathname.slice(1)));
  for (const path of assets) assert.ok(precached.has(path), `Offline Connections is missing ${path}`);
});

test('the classic PDF integration preserves existing app date and slug helpers', async () => {
  const formatDate = timestamp => `Note timestamp ${timestamp}`;
  const slugify = title => `App slug ${title}`;
  const app = { formatDate, slugify };
  const source = await readFile(join(PROJECT_ROOT, 'js/connections/export-pdf.js'), 'utf8');
  const context = { App: app };
  vm.runInNewContext(source, context, { filename: 'export-pdf.js' });
  assert.equal(context.App, app);
  assert.equal(app.formatDate, formatDate);
  assert.equal(app.slugify, slugify);
  assert.equal(app.formatDate(172800000), 'Note timestamp 172800000');
  assert.equal(app.slugify('Context note'), 'App slug Context note');
  assert.equal(typeof app.exportConnectionsPdf, 'function');
});

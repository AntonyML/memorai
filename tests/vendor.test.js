import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { buildVendor, VENDOR_OUTPUT } from '../scripts/vendor.js';

const fixtures = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    const target = resolve(fixture);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('memorai-vendor-test-')) {
      throw new Error('Refusing to remove a directory outside vendor test fixtures.');
    }
    await rm(target, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'memorai-vendor-test-'));
  fixtures.push(directory);
  return directory;
}

test('vendor builds a deterministic browser IIFE with bundled imports', async () => {
  const directory = await fixture();
  const entrypoint = join(directory, 'entry.js');
  const output = join(directory, 'assets', 'vendor.js');
  await Bun.write(join(directory, 'value.js'), 'export const value = "offline-libraries-ready";');
  await Bun.write(entrypoint, 'import { value } from "./value.js"; globalThis.__vendorSmoke = value;');

  expect(await buildVendor({ entrypoint, output })).toBe(output);
  const first = await Bun.file(output).text();
  expect(first).toContain('offline-libraries-ready');
  expect(first).not.toMatch(/\b(?:import|export)\s/);
  expect(first).not.toContain('sourceMappingURL');
  expect(first).not.toContain('./value.js');
  await buildVendor({ entrypoint, output });
  expect(await Bun.file(output).text()).toBe(first);
});

test('failed vendor builds preserve the previous bundle', async () => {
  const directory = await fixture();
  const entrypoint = join(directory, 'entry.js');
  const output = join(directory, 'assets', 'vendor.js');
  await Bun.write(output, 'previous browser libraries');
  await Bun.write(entrypoint, 'import "./missing-library.js";');

  await expect(buildVendor({ entrypoint, output })).rejects.toThrow('Unable to build local browser libraries');
  expect(await Bun.file(output).text()).toBe('previous browser libraries');
});

test('production bundle exposes the offline vanilla library interface', async () => {
  await buildVendor();
  const bundle = await Bun.file(VENDOR_OUTPUT).text();
  for (const name of ['axios', 'lodash', 'anime', 'Chart', 'luxon', 'Hammer', 'rxdb', 'openNotebook']) {
    expect(bundle).toMatch(new RegExp(`(?:\\{|,)${name}:`));
  }
  expect(bundle).toContain('.marked=');
  expect(bundle).toContain('.hljs=');
  expect(bundle).toContain('.DOMPurify=');
  expect(bundle).not.toContain('sourceMappingURL');
});

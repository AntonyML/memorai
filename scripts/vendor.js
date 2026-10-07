import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PROJECT_ROOT } from './site.js';

export const VENDOR_ENTRYPOINT = join(PROJECT_ROOT, 'scripts', 'browser-libs.js');
export const VENDOR_OUTPUT = join(PROJECT_ROOT, 'assets', 'vendor.js');

// Ship the pinned browser dependencies with the app so its first offline reload
// does not need a package CDN. Generate outside dist before a deployment clean.
export async function buildVendor({ entrypoint = VENDOR_ENTRYPOINT, output = VENDOR_OUTPUT } = {}) {
  const destination = resolve(output);
  let result;
  try {
    result = await Bun.build({
      entrypoints: [resolve(entrypoint)],
      target: 'browser',
      format: 'iife',
      minify: true,
      sourcemap: 'none',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') }
    });
  } catch (error) {
    const details = error.errors?.map(log => String(log)).join('\n') || error.message;
    throw new Error(`Unable to build local browser libraries.\n${details}`, { cause: error });
  }
  if (!result.success) {
    const details = result.logs.map(log => String(log)).join('\n');
    throw new Error(`Unable to build local browser libraries.\n${details}`);
  }
  if (result.outputs.length !== 1) {
    throw new Error('Browser libraries must build into one self-contained file.');
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.vendor-${randomUUID()}.tmp`);
  try {
    await Bun.write(temporary, result.outputs[0]);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return destination;
}

if (import.meta.main) {
  const output = await buildVendor();
  console.log(`Local browser libraries ready at ${output} (${Bun.file(output).size} bytes)`);
}

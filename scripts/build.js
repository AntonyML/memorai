import { copyFile, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { PROJECT_ROOT, PUBLIC_DIRECTORIES, PUBLIC_FILES } from './site.js';
import { buildVendor } from './vendor.js';

async function copyPublicFile(source, destination) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    throw new Error(`Public assets must be regular files: ${basename(source)}`);
  }
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) {
      if (entry.startsWith('.')) continue;
      await copyPublicFile(join(source, entry), join(destination, entry));
    }
  } else if (info.isFile()) {
    await copyFile(source, destination);
  }
}

export async function buildSite() {
  // A dependency error should leave the previous deployment intact.
  await buildVendor();
  // The only cleanup target is this checkout's generated dist/ directory.
  const output = resolve(PROJECT_ROOT, 'dist');
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  for (const name of PUBLIC_FILES) {
    await copyPublicFile(join(PROJECT_ROOT, name), join(output, name));
  }
  for (const name of PUBLIC_DIRECTORIES) {
    const source = join(PROJECT_ROOT, name);
    try {
      await lstat(source);
    } catch (error) {
      if (error.code === 'ENOENT' && ['assets', 'images'].includes(name)) continue;
      throw error;
    }
    await copyPublicFile(source, join(output, name));
  }

  return output;
}

if (import.meta.main) {
  const output = await buildSite();
  console.log(`Static site ready at ${output}`);
  console.log('config.json is excluded; add it explicitly to the deployment if needed.');
}
